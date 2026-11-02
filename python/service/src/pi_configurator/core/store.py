"""The key/value store other programs on the Pi read, and the optional env-file export.

Store file (`/var/lib/pi-configurator/values.json`), written only by the service, atomically,
mode 0640, group `pi-configurator` (add an app's user to that group to let it read):

    {"values": {"KEY": <saved value>, ...}, "defaults": {"KEY": <config default>, ...}}

The defaults are copied in so the client package never needs the root-only config file.

Env file (`export.envFile`): every store field with a value, as KEY=value lines inside a marked
block at the end of the file. Lines outside the block are kept as they are, so a hand-written
.env.production keeps working; python-dotenv and systemd both let the later (managed) line win.
"""

import logging
import os
import re
import time
from pathlib import Path
from typing import Final

from ..protocol.jsonutil import Json, JsonError, JsonObject, dumps, dumps_pretty, loads
from .atomic import atomic_write, group_id

log = logging.getLogger(__name__)

STORE_GROUP: Final = "pi-configurator"
ENV_BEGIN: Final = "# >>> pi-configurator: managed block, changes here are overwritten >>>"
ENV_END: Final = "# <<< pi-configurator <<<"

# Characters that need no quoting in either python-dotenv or systemd's EnvironmentFile=.
_BARE: Final = re.compile(r"[A-Za-z0-9_./:@%+,=-]*\Z")


class StoreFile:
    def __init__(self, path: Path, group: str | None = STORE_GROUP) -> None:
        self.path = path
        self._group = group

    def load_values(self) -> dict[str, Json]:
        """Saved values. A corrupt file is moved aside (never silently overwritten)."""
        try:
            data = loads(self.path.read_bytes())
        except FileNotFoundError:
            return {}
        except (OSError, JsonError) as err:
            aside = self.path.with_name(f"{self.path.name}.corrupt-{int(time.time())}")
            log.error("store file %s is unreadable (%s); moved to %s", self.path, err, aside)
            try:
                self.path.rename(aside)
            except OSError:
                log.exception("couldn't move the store file aside")
                raise
            return {}
        values = data.get("values") if isinstance(data, dict) else None
        return dict(values) if isinstance(values, dict) else {}

    def write(self, values: dict[str, Json], defaults: dict[str, Json]) -> None:
        body: JsonObject = {"values": dict(values), "defaults": dict(defaults)}
        atomic_write(
            self.path, dumps_pretty(body).encode(), mode=0o640, uid=0, gid=group_id(self._group)
        )


def env_value(value: Json) -> str:
    """One value in a form python-dotenv and systemd's EnvironmentFile= both read back exactly.

    Plain values are written bare, anything else in single quotes (no escapes, no `$`
    expansion in either reader). Only a value with a single quote or a line break needs double
    quotes; `${...}` inside such a value would be expanded by python-dotenv, which is logged.
    """
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return dumps(value)
    if not isinstance(value, str):
        return env_value(dumps(value))
    if _BARE.match(value):
        return value
    if "'" not in value and "\n" not in value and "\r" not in value:
        return f"'{value}'"
    if "${" in value:
        log.warning("an env value contains '${'; python-dotenv may expand it")
    escaped = (
        value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n").replace("\r", "\\r")
    )
    return f'"{escaped}"'


def render_env_block(items: list[tuple[str, Json]]) -> str:
    lines = [ENV_BEGIN, *(f"{key}={env_value(value)}" for key, value in items), ENV_END]
    return "\n".join(lines) + "\n"


def merge_env_text(existing: str, block: str) -> str:
    """Replaces the managed block in `existing` (or appends one), keeping every other line."""
    kept: list[str] = []
    inside = False
    for line in existing.splitlines():
        if line.strip() == ENV_BEGIN:
            inside = True
        elif line.strip() == ENV_END and inside:
            inside = False
        elif not inside:
            kept.append(line)
    while kept and not kept[-1].strip():
        kept.pop()
    head = "\n".join(kept)
    return f"{head}\n\n{block}" if head else block


class EnvExport:
    def __init__(self, path: Path) -> None:
        self.path = path

    def write(self, items: list[tuple[str, Json]]) -> None:
        """Rewrites the managed block. An existing file keeps its owner and mode; a new one gets
        the owner of its directory and mode 0600 (it may hold secrets)."""
        try:
            st = self.path.stat()
            existing = self.path.read_text(encoding="utf-8")
            mode, uid, gid = st.st_mode & 0o777, st.st_uid, st.st_gid
        except FileNotFoundError:
            existing = ""
            parent = self.path.parent.stat()
            mode, uid, gid = 0o600, parent.st_uid, parent.st_gid
        text = merge_env_text(existing, render_env_block(items))
        atomic_write(self.path, text.encode(), mode=mode, uid=uid, gid=gid)
        log.info("wrote %d settings to %s", len(items), self.path)


def store_group_exists() -> bool:
    return group_id(STORE_GROUP) is not None


def running_as_root() -> bool:
    return os.geteuid() == 0
