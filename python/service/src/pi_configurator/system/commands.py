"""Adapters that shell out to systemd's tools: hostnamectl, timedatectl and systemctl.

These are the documented, stable interfaces on Pi OS (Trixie ships systemd 257); their D-Bus
equivalents would need polkit handling for no gain while the service runs as root.
Arguments are always passed as a list (no shell), and every value was validated first.
"""

import asyncio
import logging
import os
import re
import socket
from pathlib import Path
from typing import Final

from ..core.atomic import atomic_write
from .interfaces import AdapterError

log = logging.getLogger(__name__)

#: RFC 1123 host label. Enforced by the service whatever pattern the config gives, since the
#: value ends up in /etc/hosts.
HOSTNAME_RE: Final = re.compile(r"[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\Z")


async def run(*args: str, timeout: float = 30) -> str:
    """Runs a command and returns stdout. Raises AdapterError with stderr on failure."""
    try:
        proc = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except OSError as err:
        raise AdapterError(f"{args[0]}: {err.strerror}") from err
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except TimeoutError as e:
        proc.kill()
        await proc.wait()
        raise AdapterError(f"{args[0]} timed out") from e
    if proc.returncode != 0:
        detail = err.decode(errors="replace").strip() or f"exit status {proc.returncode}"
        raise AdapterError(f"{' '.join(args[:2])}: {detail}")
    return out.decode(errors="replace")


def update_hosts_text(text: str, new_name: str) -> str:
    """Points the Debian-style `127.0.1.1 <hostname>` line at the new name (adds it if missing)."""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        fields = line.split("#", 1)[0].split()
        if fields and fields[0] == "127.0.1.1":
            lines[i] = f"127.0.1.1\t{new_name}"
            break
    else:
        lines.append(f"127.0.1.1\t{new_name}")
    return "\n".join(lines) + "\n"


class Hostname:
    def __init__(self, hosts_file: Path = Path("/etc/hosts")) -> None:
        self._hosts = hosts_file

    async def get(self) -> str:
        return socket.gethostname()

    async def set(self, name: str) -> None:
        if not HOSTNAME_RE.match(name):
            raise AdapterError("Not a valid hostname")
        # Hosts first: sudo and other tools resolve the new name as soon as it changes.
        try:
            old = self._hosts.read_text(encoding="utf-8") if self._hosts.exists() else ""
            mode = self._hosts.stat().st_mode & 0o777 if self._hosts.exists() else 0o644
            atomic_write(self._hosts, update_hosts_text(old, name).encode(), mode=mode)
        except OSError as err:
            raise AdapterError(f"Couldn't update {self._hosts}: {err.strerror}") from err
        await run("hostnamectl", "set-hostname", name)


class Timezone:
    def __init__(self) -> None:
        self._zones: list[str] | None = None

    async def get(self) -> str:
        return (await run("timedatectl", "show", "--property=Timezone", "--value")).strip()

    async def available(self) -> list[str]:
        if self._zones is None:
            out = await run("timedatectl", "list-timezones")
            self._zones = [z for z in (line.strip() for line in out.splitlines()) if z]
        return self._zones

    async def set(self, zone: str) -> None:
        if zone not in await self.available():
            raise AdapterError(f"Unknown time zone {zone}")
        await run("timedatectl", "set-timezone", zone)


class Systemd:
    def __init__(self, restart_timeout_s: float = 120) -> None:
        self._timeout = restart_timeout_s

    async def restart(self, unit: str) -> None:
        await run("systemctl", "restart", unit, timeout=self._timeout)

    async def reboot(self) -> None:
        log.warning("rebooting at the phone's request")
        if os.environ.get("PI_CONFIGURATOR_NO_REBOOT"):
            log.warning("PI_CONFIGURATOR_NO_REBOOT is set; not rebooting")
            return
        await run("systemctl", "reboot")
