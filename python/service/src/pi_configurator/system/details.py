"""The device report behind `system.details`: hardware, operating system, network, Bluetooth
and the service, as titled sections of label / value lines.

Everything is read from /proc, /sys, /etc and a few commands that ship with Raspberry Pi OS
(vcgencmd, nmcli, bluetoothctl, ip). Each line is read on its own and simply left out when it
can't be, so the report works on any Linux and never fails as a whole. The parsing helpers are
pure functions so they can be tested off the Pi.
"""

import asyncio
import contextlib
import os
import platform
import shutil
import socket
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Final

from .. import __version__
from ..protocol.jsonutil import JsonObject
from ..protocol.rpc import PROTOCOL_VERSION
from .commands import run

Section = tuple[str, list[tuple[str, str]]]

COMMAND_TIMEOUT_S: Final = 5


# -- formatting --------------------------------------------------------------------------------


def format_bytes(n: float) -> str:
    """1536 -> "1.5 KB"; binary units, as `df -h` and the phone show storage."""
    for unit in ("bytes", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:,.0f} {unit}" if unit == "bytes" else f"{n:,.1f} {unit}"
        n /= 1024
    return f"{n:,.1f} TB"


def format_duration(seconds: float) -> str:
    """93784 -> "1 day, 2 h 3 min"; 300 -> "5 min"."""
    minutes = int(seconds // 60)
    days, minutes = divmod(minutes, 24 * 60)
    hours, minutes = divmod(minutes, 60)
    clock = f"{hours} h {minutes} min" if hours or days else f"{minutes} min"
    return f"{days:,} day{'s' if days != 1 else ''}, {clock}" if days else clock


# -- parsing -----------------------------------------------------------------------------------


def parse_key_values(text: str, sep: str = ":") -> dict[str, str]:
    """`Key: value` lines (cpuinfo, meminfo) -> {key: value}; the first of a repeated key wins."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        key, found, value = line.partition(sep)
        if found and key.strip() and key.strip() not in out:
            out[key.strip()] = value.strip()
    return out


def parse_os_release(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in text.splitlines():
        key, found, value = line.partition("=")
        if found:
            out[key.strip()] = value.strip().strip('"')
    return out


def parse_meminfo_kb(text: str, key: str) -> int | None:
    """meminfo's "MemTotal:  1888912 kB" -> bytes."""
    value = parse_key_values(text).get(key)
    if not value:
        return None
    try:
        return int(value.split()[0]) * 1024
    except ValueError:
        return None


def describe_throttled(output: str) -> str:
    """`vcgencmd get_throttled` ("throttled=0x50005") in words. Bits from the Raspberry Pi docs."""
    try:
        bits = int(output.strip().partition("=")[2], 16)
    except ValueError:
        return output.strip()
    if bits == 0:
        return "No (power and temperature have been fine since boot)"
    now = {0: "under-voltage", 1: "CPU frequency capped", 2: "throttled", 3: "temperature limit"}
    names = [name for bit, name in now.items() if bits & (1 << bit)]
    past = [name for bit, name in now.items() if bits & (1 << (bit + 16))]
    parts: list[str] = []
    if names:
        parts.append("now: " + ", ".join(names))
    if past:
        parts.append("since boot: " + ", ".join(past))
    return f"{'; '.join(parts)} ({output.strip().partition('=')[2]})"


def split_nmcli(line: str) -> list[str]:
    """One `nmcli -t -e yes` line -> fields (`:` separates; `\\:` and `\\\\` are escaped)."""
    fields: list[str] = []
    current: list[str] = []
    escaped = False
    for ch in line:
        if escaped:
            current.append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
        elif ch == ":":
            fields.append("".join(current))
            current = []
        else:
            current.append(ch)
    fields.append("".join(current))
    return fields


def parse_nmcli_device(text: str) -> dict[str, list[str]]:
    """`nmcli -t dev show wlan0` -> {"IP4.ADDRESS": ["192.168.6.15/22"], ...}."""
    out: dict[str, list[str]] = {}
    for line in text.splitlines():
        key, found, value = line.partition(":")
        if found and value:
            out.setdefault(key.split("[")[0], []).append(value)
    return out


def parse_bluetoothctl_show(text: str) -> dict[str, str]:
    """`bluetoothctl show` -> {"Address": ..., "Name": ..., "Alias": ..., "Powered": ...}."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        if line.startswith("Controller "):
            out["Address"] = line.split()[1]
            continue
        key, found, value = line.strip().partition(":")
        if found and key and key not in out:
            out[key] = value.strip()
    return out


def gatt_client_setting(text: str) -> str | None:
    """The [GATT] Client value in BlueZ's main.conf, or None when it isn't set (default true)."""
    section = ""
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("["):
            section = line
        elif section == "[GATT]" and not line.startswith("#"):
            key, found, value = line.partition("=")
            if found and key.strip() == "Client":
                return value.strip()
    return None


# -- collecting --------------------------------------------------------------------------------


def _read(path: str) -> str | None:
    try:
        return Path(path).read_text(errors="replace").replace("\0", " ").strip()
    except OSError:
        return None


async def _cmd(*args: str) -> str | None:
    if shutil.which(args[0]) is None:
        return None
    try:
        return (await run(*args, timeout=COMMAND_TIMEOUT_S)).strip()
    except Exception:  # a missing line is fine; the report must not fail
        return None


class DeviceDetails:
    """Collects the report. `read` and `cmd` are injectable for tests."""

    def __init__(
        self,
        read: Callable[[str], str | None] = _read,
        cmd: Callable[..., Awaitable[str | None]] = _cmd,
    ) -> None:
        self._read = read
        self._cmd = cmd

    async def collect(self, bluetooth_name: str, settings_count: int) -> JsonObject:
        hardware, os_section, network, bluetooth = await asyncio.gather(
            self._hardware(), self._os(), self._network(), self._bluetooth(bluetooth_name)
        )
        service: Section = (
            "pi-configurator",
            [
                ("Version", __version__),
                ("Protocol", str(PROTOCOL_VERSION)),
                ("Bluetooth name", bluetooth_name),
                ("Settings in config", f"{settings_count:,}"),
            ],
        )
        sections = [hardware, os_section, network, bluetooth, service]
        return {
            "sections": [
                {"title": title, "items": [{"label": k, "value": v} for k, v in items if v]}
                for title, items in sections
                if any(v for _, v in items)
            ]
        }

    async def _hardware(self) -> Section:
        items: list[tuple[str, str]] = []
        add = items.append
        if model := self._read("/proc/device-tree/model"):
            add(("Model", model))
        cpuinfo = parse_key_values(self._read("/proc/cpuinfo") or "")
        if revision := cpuinfo.get("Revision"):
            add(("Revision code", revision))
        serial = self._read("/proc/device-tree/serial-number") or cpuinfo.get("Serial")
        if serial:
            add(("Serial number", serial))
        compatible = (self._read("/proc/device-tree/compatible") or "").split()
        soc = next((c.split(",")[1].upper() for c in compatible if c.startswith("brcm,")), None)
        cores = os.cpu_count()
        cpu = ", ".join(p for p in (soc, f"{cores} cores" if cores else None) if p)
        if max_khz := self._read("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq"):
            with contextlib.suppress(ValueError):
                cpu += f", up to {int(max_khz) / 1_000_000:.1f} GHz"
        if cpu:
            add(("Processor", cpu))
        if temp := self._read("/sys/class/thermal/thermal_zone0/temp"):
            with contextlib.suppress(ValueError):
                add(("CPU temperature", f"{int(temp) / 1000:.1f} °C"))
        if throttled := await self._cmd("vcgencmd", "get_throttled"):
            add(("Throttling", describe_throttled(throttled)))
        if volts := await self._cmd("vcgencmd", "measure_volts", "core"):
            add(("Core voltage", volts.partition("=")[2] or volts))
        meminfo = self._read("/proc/meminfo") or ""
        total, available = (parse_meminfo_kb(meminfo, k) for k in ("MemTotal", "MemAvailable"))
        if total:
            free = f", {format_bytes(available)} available" if available else ""
            add(("Memory", f"{format_bytes(total)}{free}"))
        try:
            disk = shutil.disk_usage("/")
            add(("Storage", f"{format_bytes(disk.total)}, {format_bytes(disk.free)} free"))
        except OSError:
            pass
        if firmware := await self._cmd("vcgencmd", "version"):
            add(("Firmware", firmware.splitlines()[0].strip()))
        return "Hardware", items

    async def _os(self) -> Section:
        items: list[tuple[str, str]] = []
        add = items.append
        release = parse_os_release(self._read("/etc/os-release") or "")
        if name := release.get("PRETTY_NAME"):
            add(("Operating system", name))
        if issue := self._read("/boot/firmware/issue.txt"):
            add(("Image", issue.splitlines()[0]))
        add(("Kernel", platform.release()))
        add(("Architecture", platform.machine()))
        add(("Hostname", socket.gethostname()))
        try:
            zone = os.readlink("/etc/localtime").split("zoneinfo/")[-1]
            add(("Time zone", zone))
        except OSError:
            pass
        add(("Local time", time.strftime("%Y-%m-%d %H:%M %Z")))
        if uptime := self._read("/proc/uptime"):
            with contextlib.suppress(ValueError):
                add(("Uptime", format_duration(float(uptime.split()[0]))))
        add(("Python", platform.python_version()))
        return "Operating system", items

    async def _network(self) -> Section:
        items: list[tuple[str, str]] = []
        add = items.append
        wifi_fields = "IN-USE,SSID,BSSID,CHAN,FREQ,RATE,SIGNAL,SECURITY"
        wifi_list = await self._cmd(
            "nmcli", "-t", "-e", "yes", "-f", wifi_fields, "dev", "wifi", "list", "--rescan", "no"
        )
        current = next(
            (split_nmcli(line) for line in (wifi_list or "").splitlines() if line.startswith("*")),
            None,
        )
        if current and len(current) >= 8:
            _, ssid, bssid, chan, freq, rate, signal, security = current[:8]
            add(("Wi-Fi network", ssid or "(hidden)"))
            add(("Signal", f"{signal}%"))
            add(("Band and channel", f"{_band(freq)}, channel {chan} ({freq})"))
            add(("Link speed", rate))
            add(("Security", security or "Open"))
            add(("Access point", bssid))
        elif wifi_list is not None:
            add(("Wi-Fi network", "Not connected"))
        dev_fields = "GENERAL.HWADDR,IP4.ADDRESS,IP4.GATEWAY,IP4.DNS,IP6.ADDRESS"
        dev_show = await self._cmd("nmcli", "-t", "-f", dev_fields, "dev", "show", "wlan0")
        dev = parse_nmcli_device(dev_show or "")
        for label, key in (
            ("IPv4 address", "IP4.ADDRESS"),
            ("Gateway", "IP4.GATEWAY"),
            ("DNS", "IP4.DNS"),
            ("IPv6 addresses", "IP6.ADDRESS"),
        ):
            if values := [v for v in dev.get(key, []) if v and v != "--"]:
                add((label, ", ".join(values)))
        if mac := (dev.get("GENERAL.HWADDR") or [None])[0]:
            add(("Wi-Fi MAC address", mac))
        if eth := self._read("/sys/class/net/eth0/address"):
            state = self._read("/sys/class/net/eth0/operstate")
            link = {"up": ", connected", None: ""}.get(state, ", not connected")
            add(("Ethernet", f"{eth.upper()}{link}"))
        if country := await self._cmd("raspi-config", "nonint", "get_wifi_country"):
            add(("Wi-Fi country", country))
        return "Network", items

    async def _bluetooth(self, advertised: str) -> Section:
        items: list[tuple[str, str]] = []
        add = items.append
        show = parse_bluetoothctl_show(await self._cmd("bluetoothctl", "show") or "")
        if address := show.get("Address"):
            add(("Adapter address", address))
        add(("Advertised name", advertised))
        if powered := show.get("Powered"):
            add(("Powered", powered))
        if version := await self._cmd("bluetoothctl", "--version"):
            add(("BlueZ", version.split()[-1]))
        conf = self._read("/etc/bluetooth/main.conf")
        if conf is not None:
            client = gatt_client_setting(conf)
            add(
                (
                    "GATT client role",
                    "Off" if client == "false" else "On (pairing prompts on iPhones)",
                )
            )
        return "Bluetooth", items


def _band(freq: str) -> str:
    """ "5765 MHz" -> "5 GHz"."""
    try:
        mhz = int(freq.split()[0])
    except (ValueError, IndexError):
        return freq
    return "2.4 GHz" if mhz < 3000 else "5 GHz" if mhz < 5925 else "6 GHz"
