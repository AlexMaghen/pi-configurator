"""The service end to end: start, a save from the phone, a reload, stop."""

import threading
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
from pi_configurator_client import Store

from sample_service.app import SampleService, main
from sample_service.device import Device
from sample_service.settings import ARTIST_NAME, AUTOSTART, COLOR, VOLUME, Settings

from .support import wait_until, write_store

DEFAULTS = {COLOR: "warm-white", VOLUME: 40, AUTOSTART: True, ARTIST_NAME: ""}


@dataclass
class Running:
    tmp_path: Path
    service: SampleService
    device: Device
    thread: threading.Thread

    def save(self, **values: object) -> None:
        """What the phone does: the service writes the new values.json."""
        write_store(self.tmp_path, values=values, defaults=DEFAULTS)


@pytest.fixture
def running(tmp_path: Path) -> Iterator[Running]:
    path = write_store(tmp_path, defaults=DEFAULTS)
    device = Device()
    service = SampleService(Store(path, dbus=False), device, poll_interval_s=0.02)
    thread = threading.Thread(target=service.run, daemon=True)
    thread.start()
    wait_until(lambda: device.playing)
    yield Running(tmp_path, service, device, thread)
    service.stop()
    thread.join(timeout=5)


def test_starts_with_the_config_defaults(running: Running) -> None:
    assert (running.device.color, running.device.volume) == ("warm-white", 40)
    assert running.device.playing  # autostart


def test_applies_a_change_while_running(running: Running) -> None:
    running.save(volume=80, artistName="Miles Davis")
    wait_until(lambda: running.device.artist_name == "Miles Davis")
    assert running.device.volume == 80
    assert running.service.settings == Settings(volume=80, artist_name="Miles Davis")


def test_autostart_waits_for_the_next_start(running: Running) -> None:
    running.save(autostart=False, color="red")
    wait_until(lambda: running.device.color == "red")
    assert not running.service.settings.autostart
    assert running.device.playing  # still playing until the service restarts


def test_reload_reads_everything_again(running: Running) -> None:
    running.service.store.close()  # no watcher: only the reload can pick the change up
    running.save(color="purple")
    running.service.reload()
    wait_until(lambda: running.device.color == "purple")


def test_stop_stops_the_device(running: Running) -> None:
    running.service.stop()
    running.thread.join(timeout=5)
    assert not running.thread.is_alive()
    assert not running.device.playing


def test_main_shows_its_version(capsys: pytest.CaptureFixture[str]) -> None:
    with pytest.raises(SystemExit):
        main(["--version"])
    assert capsys.readouterr().out.strip() == "0.1.0"
