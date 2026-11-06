"""NetworkManagerWifi switching the Wi-Fi radio on before a scan (fake D-Bus, fake rfkill)."""

from pathlib import Path
from typing import Any

import pytest
from pi_configurator.system.interfaces import AdapterError
from pi_configurator.system.networkmanager import (
    I_NM,
    I_PROPS,
    I_WIRELESS,
    NM_PATH,
    NetworkManagerWifi,
)

DEVICE = "/org/freedesktop/NetworkManager/Devices/3"


class FakeNM(NetworkManagerWifi):
    """Answers the few D-Bus calls a scan makes. The device stays unavailable (state 20) until
    both the rfkill soft block is cleared and NetworkManager's Wi-Fi switch is on."""

    def __init__(self, rfkill_root: Path, wireless_enabled: bool) -> None:
        self.ticks = 0.0
        super().__init__(
            scan_wait_s=0, radio_wait_s=2, clock=lambda: self.ticks, rfkill_root=rfkill_root
        )
        self.wireless_enabled = wireless_enabled
        self.sets: list[str] = []

    def _soft_blocked(self) -> bool:
        return (self._rfkill_root / "rfkill1" / "soft").read_text().strip() == "1"

    async def _device(self) -> str:
        return DEVICE

    async def _prop(self, path: str, interface: str, name: str) -> Any:
        self.ticks += 0.5
        match (interface, name):
            case (_, "State"):
                return 20 if self._soft_blocked() or not self.wireless_enabled else 30
            case (_, "WirelessEnabled"):
                return self.wireless_enabled
            case (_, "LastScan"):
                return 0
            case (_, "ActiveAccessPoint"):
                return "/"
            case _:
                raise AssertionError(f"unexpected property {interface}.{name}")

    async def _call(
        self, path: str, interface: str, member: str, signature: str = "", body: Any = None
    ) -> list[Any]:
        if (interface, member) == (I_PROPS, "Set"):
            assert body is not None and body[:2] == [I_NM, "WirelessEnabled"] and path == NM_PATH
            self.wireless_enabled = bool(body[2].value)
            self.sets.append("WirelessEnabled")
            return []
        if (interface, member) == (I_WIRELESS, "RequestScan"):
            if self._soft_blocked() or not self.wireless_enabled:
                raise AdapterError("NetworkManager: Scanning not allowed while unavailable")
            return []
        if (interface, member) == (I_WIRELESS, "GetAllAccessPoints"):
            return [[]]
        raise AssertionError(f"unexpected call {interface}.{member}")


def _wlan(root: Path, soft: str, hard: str = "0") -> None:
    path = root / "rfkill1"
    path.mkdir(parents=True)
    (path / "type").write_text("wlan\n")
    (path / "name").write_text("phy0\n")
    (path / "soft").write_text(f"{soft}\n")
    (path / "hard").write_text(f"{hard}\n")


async def test_scan_unblocks_a_soft_blocked_radio(tmp_path: Path) -> None:
    _wlan(tmp_path, soft="1")
    nm = FakeNM(tmp_path, wireless_enabled=True)
    assert await nm.scan() == []
    assert (tmp_path / "rfkill1" / "soft").read_text().strip() == "0"
    assert nm.sets == []


async def test_scan_turns_on_networkmanagers_wifi_switch(tmp_path: Path) -> None:
    _wlan(tmp_path, soft="0")
    nm = FakeNM(tmp_path, wireless_enabled=False)
    await nm.scan()
    assert nm.sets == ["WirelessEnabled"]


async def test_radio_already_on_is_left_alone(tmp_path: Path) -> None:
    _wlan(tmp_path, soft="0")
    nm = FakeNM(tmp_path, wireless_enabled=True)
    await nm.scan()
    assert nm.sets == []


async def test_hard_block_is_reported(tmp_path: Path) -> None:
    _wlan(tmp_path, soft="0", hard="1")
    nm = FakeNM(tmp_path, wireless_enabled=True)
    nm._soft_blocked = lambda: True  # type: ignore[method-assign]  # a hard block keeps it down
    with pytest.raises(AdapterError, match="hardware"):
        await nm.scan()
