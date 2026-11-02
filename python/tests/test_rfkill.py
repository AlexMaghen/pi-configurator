"""Clearing Bluetooth's rfkill soft block through a fake /sys/class/rfkill."""

from pathlib import Path

from pi_configurator.ble.rfkill import bluetooth_blocks, unblock_bluetooth


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
