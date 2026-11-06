"""Clearing a radio's rfkill soft block, like `rfkill unblock bluetooth` or `rfkill unblock wifi`.

Bluetooth: when it's switched off (Pi OS desktop menu, `rfkill block`, or a setting kept across
reboots by systemd-rfkill), BlueZ still lists the adapter but refuses to power it with a bare
"Failed". The service needs the radio, so it clears the soft block itself.

Wi-Fi: Raspberry Pi OS keeps the Wi-Fi radio soft-blocked until a Wi-Fi country is set, and
Raspberry Pi Imager only clears that when it's given a network to join. On a card written
without Wi-Fi, NetworkManager reports the device as unavailable and every scan comes back
empty, so the service clears this block before scanning or joining.

A hard block (a physical switch or firmware) can't be cleared from software and is only
reported. systemd-rfkill saves the new state at shutdown, so an unblock lasts across reboots.

Works through /sys/class/rfkill, so it needs no extra package.
"""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

log = logging.getLogger(__name__)

RFKILL = Path("/sys/class/rfkill")

#: rfkill's names for the two radio types the service uses.
RadioType = Literal["bluetooth", "wlan"]


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


def blocks(kind: RadioType, root: Path = RFKILL) -> list[RadioBlock]:
    """The radios of one type that rfkill knows about, with their soft and hard block state."""
    radios: list[RadioBlock] = []
    if not root.is_dir():
        return radios
    for entry in sorted(root.iterdir()):
        if _read(entry / "type") != kind:
            continue
        radios.append(
            RadioBlock(
                name=_read(entry / "name") or entry.name,
                soft=_read(entry / "soft") == "1",
                hard=_read(entry / "hard") == "1",
            )
        )
    return radios


def unblock(kind: RadioType, root: Path = RFKILL) -> list[str]:
    """Clears the soft block on every radio of one type; returns the names it unblocked."""
    unblocked: list[str] = []
    if not root.is_dir():
        return unblocked
    for entry in sorted(root.iterdir()):
        if _read(entry / "type") != kind or _read(entry / "soft") != "1":
            continue
        try:
            (entry / "soft").write_text("0")
        except OSError as err:
            log.warning("couldn't unblock %s: %s", entry.name, err)
            continue
        unblocked.append(_read(entry / "name") or entry.name)
    return unblocked


def bluetooth_blocks(root: Path = RFKILL) -> list[RadioBlock]:
    return blocks("bluetooth", root)


def unblock_bluetooth(root: Path = RFKILL) -> list[str]:
    return unblock("bluetooth", root)


def wifi_blocks(root: Path = RFKILL) -> list[RadioBlock]:
    return blocks("wlan", root)


def unblock_wifi(root: Path = RFKILL) -> list[str]:
    return unblock("wlan", root)
