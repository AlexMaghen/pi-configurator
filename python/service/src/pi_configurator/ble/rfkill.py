"""Clearing the Bluetooth radio's rfkill soft block, like `rfkill unblock bluetooth`.

When Bluetooth is switched off (Pi OS desktop menu, `rfkill block`, or a setting kept across
reboots by systemd-rfkill), BlueZ still lists the adapter but refuses to power it with a bare
"Failed". The service needs the radio, so it clears the soft block itself. A hard block (a
physical switch) can't be cleared from software and is only reported.

Works through /sys/class/rfkill, so it needs no extra package.
"""

import logging
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger(__name__)

RFKILL = Path("/sys/class/rfkill")


@dataclass(frozen=True)
class RadioBlock:
    name: str
    soft: bool
    hard: bool


def _read(path: Path) -> str:
    try:
        return path.read_text().strip()
    except OSError:
        return ""


def bluetooth_blocks(root: Path = RFKILL) -> list[RadioBlock]:
    """The Bluetooth radios rfkill knows about, with their soft and hard block state."""
    radios: list[RadioBlock] = []
    if not root.is_dir():
        return radios
    for entry in sorted(root.iterdir()):
        if _read(entry / "type") != "bluetooth":
            continue
        radios.append(
            RadioBlock(
                name=_read(entry / "name") or entry.name,
                soft=_read(entry / "soft") == "1",
                hard=_read(entry / "hard") == "1",
            )
        )
    return radios


def unblock_bluetooth(root: Path = RFKILL) -> list[str]:
    """Clears the soft block on every Bluetooth radio; returns the names it unblocked."""
    unblocked: list[str] = []
    if not root.is_dir():
        return unblocked
    for entry in sorted(root.iterdir()):
        if _read(entry / "type") != "bluetooth" or _read(entry / "soft") != "1":
            continue
        try:
            (entry / "soft").write_text("0")
        except OSError as err:
            log.warning("couldn't unblock %s: %s", entry.name, err)
            continue
        unblocked.append(_read(entry / "name") or entry.name)
    return unblocked
