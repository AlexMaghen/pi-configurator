"""The service: reads its settings at start, then applies each change from the phone as it arrives.

How it uses pi-configurator, in order:

1. `Store()` opens /var/lib/pi-configurator/values.json (or $PI_CONFIGURATOR_STORE). Reading needs
   this program's user in the `pi-configurator` group; the systemd unit in ../../deploy does that.
2. `store.on_change(...)` hears every save. Its listener runs on the client's background thread,
   so it only queues a note; the main thread does the work, so device code never runs on two
   threads at once.
3. `Settings.load(store)` reads every setting at once: the saved value, else the config default.
4. On each note, the main thread loads the settings again, compares them with the last ones and
   applies only what changed. Comparing whole snapshots (rather than trusting the changed keys)
   also covers SIGHUP reloads and settings that change back before the main thread gets there.
5. `store.close()` on the way out stops the background thread.

Settings fall into two kinds, and most real services have both:

- Live: color, volume and artist name are applied the moment they change.
- At start: autostart only matters when the service starts, so a change is logged and used at
  the next start. (A setting that truly needs a restart could instead use
  `"onChange": {"restart": ["sample-service.service"]}` in the config file.)

Signals: SIGTERM and SIGINT stop the service; SIGHUP (`systemctl reload sample-service`) reloads
every setting.
"""

import argparse
import logging
import signal
from enum import Enum, auto
from queue import SimpleQueue
from types import FrameType

from pi_configurator_client import Store, StoreError

from . import __version__
from .device import Device
from .settings import Settings

log = logging.getLogger("sample_service")


class Command(Enum):
    RELOAD = auto()
    STOP = auto()


class SampleService:
    def __init__(self, store: Store, device: Device, *, poll_interval_s: float = 1.0) -> None:
        """`poll_interval_s` is how often the client checks values.json when the D-Bus signal
        isn't there (tests make it short)."""
        self.store = store
        self.device = device
        self.poll_interval_s = poll_interval_s
        self.settings = Settings()
        # SimpleQueue.put is safe to call from signal handlers and other threads.
        self._inbox: SimpleQueue[Command] = SimpleQueue()

    # -- called from other threads and signal handlers ------------------------------------------

    def reload(self) -> None:
        self._inbox.put(Command.RELOAD)

    def stop(self) -> None:
        self._inbox.put(Command.STOP)

    # -- the main thread -------------------------------------------------------------------------

    def run(self) -> None:
        """Runs until `stop()`."""
        # Listen first, then read: a save between the two then still arrives as a reload. The
        # client passes the changed keys; `_refresh` works them out again from the snapshots, so
        # a plain "something changed" is all the main thread needs.
        self.store.on_change(lambda _keys: self.reload(), interval_s=self.poll_interval_s)
        self.settings = self._load() or Settings()
        log.info("settings: %s", self.settings)
        self._apply_all(self.settings)
        if self.settings.autostart:
            self.device.play()

        try:
            while self._inbox.get() is not Command.STOP:
                self._refresh()
        finally:
            self.device.stop()
            self.store.close()
            log.info("stopped")

    def _load(self) -> Settings | None:
        try:
            return Settings.load(self.store)
        except StoreError as err:
            log.error("%s (is this user in the pi-configurator group?)", err)
            return None

    def _refresh(self) -> None:
        new = self._load()
        if new is None:
            return  # keep the last good settings; the next change tries again
        previous, self.settings = self.settings, new
        for name in new.changes_from(previous):
            log.info("%s: %r -> %r", name, getattr(previous, name), getattr(new, name))
            self._apply(name, new)

    def _apply_all(self, settings: Settings) -> None:
        for name in ("color", "volume", "artist_name"):
            self._apply(name, settings)

    def _apply(self, name: str, settings: Settings) -> None:
        match name:
            case "color":
                self.device.set_color(settings.color)
            case "volume":
                self.device.set_volume(settings.volume)
            case "artist_name":
                self.device.show_artist(settings.artist_name)
            case "autostart":
                log.info("autostart is used at the next start")
            case _:
                raise ValueError(f"no handler for setting {name!r}")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="sample-service",
        description="Reads its settings from pi-configurator and applies changes as they arrive.",
    )
    parser.add_argument("--store", help="values.json to read (default: pi-configurator's)")
    parser.add_argument("--version", action="version", version=__version__)
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
    service = SampleService(Store(args.store), Device())

    def on_signal(signum: int, _frame: FrameType | None) -> None:
        if signum == signal.SIGHUP:
            service.reload()
        else:
            service.stop()

    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, on_signal)
    log.info("sample-service %s reading %s", __version__, service.store.path)
    service.run()
