"""Clearing rfkill soft blocks (Bluetooth, Wi-Fi) through a fake /sys/class/rfkill."""

from pathlib import Path

from pi_configurator.system.rfkill import (
    bluetooth_blocks,
    unblock_bluetooth,
    unblock_wifi,
    wifi_blocks,
)


def _radio(root: Path, entry: str, kind: str, name: str, soft: str, hard: str = "0") -> Path:
    path = root / entry
    path.mkdir(parents=True)
    (path / "type").write_text(f"{kind}\n")
    (path / "name").write_text(f"{name}\n")
    (path / "soft").write_text(f"{soft}\n")
    (path / "hard").write_text(f"{hard}\n")
    return path


def test_unblocks_only_soft_blocked_bluetooth(tmp_path: Path) -> None:
    bt = _radio(tmp_path, "rfkill0", "bluetooth", "hci0", soft="1")
    wifi = _radio(tmp_path, "rfkill1", "wlan", "phy0", soft="1")
    _radio(tmp_path, "rfkill2", "bluetooth", "hci1", soft="0")

    assert [b.name for b in bluetooth_blocks(tmp_path) if b.soft] == ["hci0"]
    assert unblock_bluetooth(tmp_path) == ["hci0"]
    assert (bt / "soft").read_text().strip() == "0"
    assert (wifi / "soft").read_text().strip() == "1"  # Wi-Fi is left alone
    assert unblock_bluetooth(tmp_path) == []  # nothing left to do


def test_reports_hard_block(tmp_path: Path) -> None:
    _radio(tmp_path, "rfkill0", "bluetooth", "hci0", soft="0", hard="1")
    blocks = bluetooth_blocks(tmp_path)
    assert blocks[0].hard and not blocks[0].soft
    assert unblock_bluetooth(tmp_path) == []


def test_no_rfkill_directory(tmp_path: Path) -> None:
    assert bluetooth_blocks(tmp_path / "missing") == []
    assert unblock_bluetooth(tmp_path / "missing") == []


def test_unblocks_only_soft_blocked_wifi(tmp_path: Path) -> None:
    bt = _radio(tmp_path, "rfkill0", "bluetooth", "hci0", soft="1")
    wifi = _radio(tmp_path, "rfkill1", "wlan", "phy0", soft="1")

    assert [b.name for b in wifi_blocks(tmp_path) if b.soft] == ["phy0"]
    assert unblock_wifi(tmp_path) == ["phy0"]
    assert (wifi / "soft").read_text().strip() == "0"
    assert (bt / "soft").read_text().strip() == "1"  # Bluetooth is left alone
