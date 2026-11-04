"""The store reader. The service writes values.json atomically (temp file + rename), so a read
never sees half a file; this reader re-reads it whenever its inode, modification time or size
changes.

File shape: {"values": {KEY: saved value}, "defaults": {KEY: config default}}. A key's value is
the saved one if there is one, else the default, else missing.

Change notifications (`on_change`, `on_setting`) run on a daemon thread that re-reads the file
and compares values. It wakes when the service's D-Bus signal says something was saved (with
dbus-fast installed: `pip install "pi-configurator-client[dbus]"`), else polls every second. With
the signal it still checks every 30 seconds, for changes made without one (the service applying
new config defaults at startup, a hand-edited file). Plain polling needs no dependencies and
works the same on Linux and macOS.
"""

import json
import logging
import os
import threading
from collections.abc import Callable
from pathlib import Path
from typing import Final, TypeVar, cast, overload

from .dbus_signal import ChangeSignal

log = logging.getLogger(__name__)

DEFAULT_PATH: Final = Path("/var/lib/pi-configurator/values.json")
#: Overrides the default path (handy in tests and on a dev machine).
PATH_ENV: Final = "PI_CONFIGURATOR_STORE"

type Value = bool | int | float | str | list[Value] | dict[str, Value] | None
T = TypeVar("T")
#: Called with the keys whose effective value changed.
Listener = Callable[[set[str]], None]
#: Called with a key's old and new effective value; None when it has none.
SettingListener = Callable[[Value, Value], None]

#: How often the watcher checks the file while the D-Bus signal is there to wake it.
SIGNAL_CHECK_S: Final = 30.0


class StoreError(Exception):
    """The store file exists but can't be read or isn't what the service writes."""


class _Missing:
    pass


_MISSING: Final = _Missing()


class Store:
    def __init__(self, path: Path | str | None = None, *, dbus: bool = True) -> None:
        """`dbus=False` skips the D-Bus signal and always polls (tests, or no system bus)."""
        self.path = Path(path or os.environ.get(PATH_ENV) or DEFAULT_PATH)
        self._lock = threading.Lock()
        self._stamp: tuple[int, int, int] | None = None
        self._values: dict[str, Value] = {}
        self._defaults: dict[str, Value] = {}
        self._listeners: list[Listener] = []
        self._setting_listeners: list[tuple[str, SettingListener]] = []
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._wake = threading.Event()
        self._signal = ChangeSignal(self._wake) if dbus else None

    # -- reading -------------------------------------------------------------------------------

    def _file_stamp(self) -> tuple[int, int, int] | None:
        try:
            st = self.path.stat()
        except FileNotFoundError:
            return None
        return (st.st_ino, st.st_mtime_ns, st.st_size)

    def reload(self) -> None:
        """Re-reads the file if it changed since the last read (each getter calls this)."""
        stamp = self._file_stamp()
        with self._lock:
            if stamp == self._stamp and (stamp is not None or not self._values):
                return
            if stamp is None:
                self._values, self._defaults, self._stamp = {}, {}, None
                return
            try:
                data = json.loads(self.path.read_bytes())
            except FileNotFoundError:
                self._values, self._defaults, self._stamp = {}, {}, None
                return
            except (OSError, ValueError) as err:
                raise StoreError(f"can't read {self.path}: {err}") from err
            if not isinstance(data, dict):
                raise StoreError(f"{self.path} is not a JSON object")
            obj = cast(dict[str, object], data)
            values, defaults = obj.get("values", {}), obj.get("defaults", {})
            if not isinstance(values, dict) or not isinstance(defaults, dict):
                raise StoreError(f"{self.path} has no values/defaults objects")
            self._values = cast(dict[str, Value], values)
            self._defaults = cast(dict[str, Value], defaults)
            self._stamp = stamp

    def snapshot(self) -> dict[str, Value]:
        """Every key with a value: defaults overlaid with saved values."""
        self.reload()
        with self._lock:
            return {**self._defaults, **self._values}

    def is_saved(self, key: str) -> bool:
        """Whether the phone saved this key (as opposed to it falling back to the default)."""
        self.reload()
        with self._lock:
            return key in self._values

    @overload
    def get(self, key: str) -> Value: ...
    @overload
    def get(self, key: str, default: T) -> Value | T: ...
    def get(self, key: str, default: object = None) -> object:
        """The saved value, else the config default, else `default`."""
        self.reload()
        with self._lock:
            if key in self._values:
                return self._values[key]
            if key in self._defaults:
                return self._defaults[key]
        return default

    def _typed(
        self, key: str, default: object, check: Callable[[object], bool], kind: str
    ) -> object:
        value = self.get(key, _MISSING)
        if value is _MISSING:
            if default is _MISSING:
                raise KeyError(key)
            return default
        if not check(value):
            raise TypeError(f"{key} is {type(value).__name__}, not {kind}")
        return value

    def get_str(self, key: str, default: str | _Missing = _MISSING) -> str:
        """A string. KeyError if missing (and no default), TypeError if not a string."""
        return cast(str, self._typed(key, default, lambda v: isinstance(v, str), "str"))

    def get_int(self, key: str, default: int | _Missing = _MISSING) -> int:
        def check(v: object) -> bool:
            return (isinstance(v, int) and not isinstance(v, bool)) or (
                isinstance(v, float) and v.is_integer()
            )

        return int(cast(float, self._typed(key, default, check, "int")))

    def get_float(self, key: str, default: float | _Missing = _MISSING) -> float:
        def check(v: object) -> bool:
            return isinstance(v, int | float) and not isinstance(v, bool)

        return float(cast(float, self._typed(key, default, check, "float")))

    def get_bool(self, key: str, default: bool | _Missing = _MISSING) -> bool:
        return cast(bool, self._typed(key, default, lambda v: isinstance(v, bool), "bool"))

    # -- change notifications ------------------------------------------------------------------

    def on_change(self, listener: Listener, interval_s: float = 1.0) -> None:
        """Calls `listener(changed_keys)` from a background thread whenever effective values
        change. `interval_s` is how often to poll when the D-Bus signal isn't available. The
        first listener starts the watcher; `close()` stops it."""
        self._listeners.append(listener)
        self._start_watching(interval_s)

    @overload
    def on_setting(
        self, key: str, listener: None = None, *, interval_s: float = 1.0
    ) -> Callable[[SettingListener], SettingListener]: ...
    @overload
    def on_setting(
        self, key: str, listener: SettingListener, *, interval_s: float = 1.0
    ) -> SettingListener: ...
    def on_setting(
        self, key: str, listener: SettingListener | None = None, *, interval_s: float = 1.0
    ) -> SettingListener | Callable[[SettingListener], SettingListener]:
        """Calls `listener(old, new)` when one key's effective value changes. Also a decorator:

        @store.on_setting("BALLS_DISPENSE_MS")
        def setting_updated(old, new): ...
        """

        def register(fn: SettingListener) -> SettingListener:
            self._setting_listeners.append((key, fn))
            self._start_watching(interval_s)
            return fn

        return register if listener is None else register(listener)

    def _start_watching(self, interval_s: float) -> None:
        if self._thread is not None:
            return
        if self._signal is not None:
            self._signal.start()
        self._thread = threading.Thread(
            target=self._watch, args=(interval_s,), name="pi-configurator-store", daemon=True
        )
        self._thread.start()

    def _watch(self, interval_s: float) -> None:
        try:
            last = self.snapshot()
        except StoreError:
            last = {}
        while not self._stop.is_set():
            signalled = self._signal is not None and self._signal.connected
            self._wake.wait(SIGNAL_CHECK_S if signalled else interval_s)
            self._wake.clear()
            if self._stop.is_set():
                break
            try:
                current = self.snapshot()
            except StoreError:
                continue  # keep the last good values and try again next time
            changed = {
                k
                for k in last.keys() | current.keys()
                if last.get(k, _MISSING) != current.get(k, _MISSING)
            }
            previous, last = last, current
            if changed:
                self._notify(changed, previous, current)

    def _notify(
        self, changed: set[str], previous: dict[str, Value], current: dict[str, Value]
    ) -> None:
        for listener in list(self._listeners):
            try:
                listener(changed)
            except Exception:
                log.exception("a pi-configurator change listener failed")
        for key, setting_listener in list(self._setting_listeners):
            if key in changed:
                try:
                    setting_listener(previous.get(key), current.get(key))
                except Exception:
                    log.exception("a pi-configurator listener for %s failed", key)

    def close(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._signal is not None:
            self._signal.close()
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None
