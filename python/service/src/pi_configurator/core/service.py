"""The service: shared state behind every connection, and the RPC methods from rpc.ts.

One Service runs per device. It owns the loaded config, the SRP verifier (from the plain-text
password, with a random salt per start), the wrong-password backoff shared by all connections,
the store and env-file writers, and the system adapters. Connections call `dispatch`.

settings.set, access.* and system.reboot hold one lock while they apply, so two phones (or a
phone and the first-start defaults) never change things at the same time; a second change
meanwhile gets `busy`. Reads don't take the lock.
"""

import asyncio
import contextlib
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Final, cast

from pydantic import BaseModel, ValidationError

from .. import __version__
from ..paths import Paths, read_model
from ..protocol.config import (
    MAX_BLUETOOTH_NAME_BYTES,
    ConfigInvalid,
    LoadedConfig,
    SelectField,
    SettingField,
    StringField,
    WifiField,
    handler_of,
)
from ..protocol.gatt import SESSION_IDLE_TIMEOUT_S, UNLOCK_TIMEOUT_S
from ..protocol.jsonutil import Json, JsonObject, b64decode, b64encode, utf8_length
from ..protocol.rpc import (
    AuthFinishParams,
    AuthStartParams,
    DeviceInfo,
    EmptyParams,
    MethodName,
    RpcError,
    SetNameParams,
    SetPasswordParams,
    SettingsGetParams,
    SettingsSetParams,
    StatusKind,
    ValueSource,
    status_event,
)
from ..protocol.srp import SrpError, SrpServer, SrpVerifier
from ..protocol.values import describe_field, is_secret, normalize_value, validate_value
from ..system.commands import HOSTNAME_RE
from ..system.interfaces import AdapterError, SystemAdapters
from .backoff import AuthBackoff
from .configfile import rewrite_config
from .connection import Connection, FrameSink
from .state import StateFile
from .store import EnvExport, StoreFile

log = logging.getLogger(__name__)

#: Hostnames that count as "nothing set" for first-start defaults (Pi OS factory values).
UNSET_HOSTNAMES: Final = frozenset({"", "localhost", "raspberrypi"})
#: Time zones that count as "nothing set" for first-start defaults.
UNSET_TIMEZONES: Final = frozenset({"", "UTC", "Etc/UTC", "Universal", "Etc/Universal"})
#: The example password from the docs; the service warns while it is still in use.
EXAMPLE_PASSWORDS: Final = frozenset({"1234", "change-me-1234"})

# Order system handlers are applied in a save: quick ones first, Wi-Fi (slow, may drop the
# phone's link when the radio retunes) last.
_HANDLER_ORDER: Final = {"hostname": 0, "timezone": 1, "wifi": 2}

NameChanged = Callable[[str], Awaitable[None]]
Sleep = Callable[[float], Awaitable[None]]


def _parse[M: BaseModel](model: type[M], params: JsonObject) -> M:
    try:
        return model.model_validate(params)
    except ValidationError as err:
        details: JsonObject = {}
        for e in err.errors(include_url=False):
            where = ".".join(str(p) for p in e["loc"]) or "params"
            details[where] = e["msg"]
        raise RpcError("invalid_params", "Invalid parameters", details) from err


def _decode(text: str, what: str) -> bytes:
    try:
        return b64decode(text)
    except ValueError as err:
        raise RpcError(
            "invalid_params", f"{what} is not valid base64", {what: "invalid base64"}
        ) from err


@dataclass(frozen=True, slots=True)
class _Applied:
    ok: bool
    changed: bool = False
    error: str | None = None

    def to_json(self) -> JsonObject:
        return {"ok": True} if self.ok else {"ok": False, "error": self.error or "Failed"}


class Service:
    def __init__(
        self,
        config: LoadedConfig,
        paths: Paths,
        system: SystemAdapters,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Sleep = asyncio.sleep,
        verifier: SrpVerifier | None = None,
        store_group: str | None = "pi-configurator",
    ) -> None:
        self.config = config
        self.paths = paths
        self.system = system
        self.clock = clock
        self._sleep = sleep
        self.verifier = verifier or SrpVerifier.from_password(config.password)
        self.backoff = AuthBackoff(clock)
        self.store = StoreFile(paths.store, group=store_group)
        self.state = StateFile(paths.state)
        self.connections: set[Connection] = set()
        self.on_name_changed: NameChanged | None = None
        self.model = read_model(paths.model_file)
        self._lock = asyncio.Lock()
        self._background: set[asyncio.Task[None]] = set()
        self._values: dict[str, Json] = self.store.load_values()

    # -- connections ---------------------------------------------------------------------------

    def connect(
        self,
        sink: FrameSink,
        frame_size: int = 20,
        name: str = "connection",
        hang_up: Callable[[], None] | None = None,
    ) -> Connection:
        conn = Connection(self, sink, frame_size, name, hang_up)
        self.connections.add(conn)
        return conn

    def disconnect(self, conn: Connection) -> None:
        conn.close()
        self.connections.discard(conn)

    def device_info(self) -> DeviceInfo:
        return DeviceInfo(name=self.config.name, service_version=__version__, model=self.model)

    def sweep_idle(self) -> None:
        """Ends sessions idle for longer than SESSION_IDLE_TIMEOUT_S, and disconnects phones that
        have been connected without a session for longer than UNLOCK_TIMEOUT_S."""
        for conn in list(self.connections):
            if conn.unlocked and conn.idle_for() > SESSION_IDLE_TIMEOUT_S:
                conn.end_session("Locked after 10 minutes without activity")
            elif not conn.unlocked and conn.locked_for() > UNLOCK_TIMEOUT_S:
                log.info("%s: not unlocked within %d s, disconnecting", conn.name, UNLOCK_TIMEOUT_S)
                if conn.hang_up is not None:
                    conn.hang_up()
                else:
                    self.disconnect(conn)

    async def run_idle_sweeper(self, interval_s: float = 15) -> None:
        while True:
            await self._sleep(interval_s)
            self.sweep_idle()

    # -- startup -------------------------------------------------------------------------------

    def warn_about_password(self) -> None:
        password = self.config.password
        if password in EXAMPLE_PASSWORDS:
            log.warning(
                "the access password is still the example value; change it in %s", self.paths.config
            )
        elif len(password) < 8:
            log.warning("the access password is shorter than 8 characters")

    async def startup(self) -> None:
        """Brings the store (and env file) up to date with the config's defaults.

        A config default that changed takes effect at once for every key the phone never set.
        """
        async with self._lock:
            self._write_store()
            # Logged by _write_env; not fatal at startup (the app may not be installed yet).
            with contextlib.suppress(OSError):
                self._write_env()

    def start_first_start_defaults(self) -> None:
        """Applies system-field defaults once, in the background (Wi-Fi can take a while)."""
        if self.state.first_start_defaults_applied:
            return
        self._spawn(self.apply_first_start_defaults())

    async def apply_first_start_defaults(self) -> list[str]:
        """Applies each system field's default if the system has nothing set, then records that
        this has happened so it never runs again (design.md 3.3). Returns the keys applied."""
        applied: list[str] = []
        async with self._lock:
            if self.state.first_start_defaults_applied:
                return applied
            for f in self.config.fields:
                handler = handler_of(f)
                if handler is None or f.default is None:
                    continue
                try:
                    if await self._apply_first_default(f):
                        applied.append(f.key)
                except Exception as err:
                    log.warning("first-start default for %s failed: %s", f.key, err)
            try:
                self.state.mark_first_start_defaults_applied(applied)
            except OSError:
                log.exception("couldn't record first-start defaults in %s", self.state.path)
        if applied:
            log.info("applied first-start defaults: %s", ", ".join(applied))
        return applied

    async def _apply_first_default(self, f: SettingField) -> bool:
        handler, sys = handler_of(f), self.system
        if handler == "hostname" and isinstance(f, StringField) and f.default is not None:
            if (await sys.hostname.get()).lower() not in UNSET_HOSTNAMES:
                return False
            await sys.hostname.set(f.default)
            return True
        if handler == "timezone" and isinstance(f, SelectField) and f.default is not None:
            if await sys.timezone.get() not in UNSET_TIMEZONES:
                return False
            await sys.timezone.set(f.default)
            return True
        if handler == "wifi" and isinstance(f, WifiField) and f.default is not None:
            if await sys.wifi.has_saved_networks():
                return False
            d = f.default
            result = await sys.wifi.connect(
                d.ssid, d.password if d.password is not None else "", bool(d.hidden)
            )
            if not result.ok:
                log.warning("first-start Wi-Fi %s: %s", d.ssid, result.error)
            return True
        return False

    async def shutdown(self) -> None:
        for task in list(self._background):
            task.cancel()
        await asyncio.gather(*self._background, return_exceptions=True)

    def _spawn(self, coro: Awaitable[object]) -> None:
        async def wrapper() -> None:
            try:
                await coro
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("background task failed")

        task = asyncio.get_running_loop().create_task(wrapper())
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    async def wait_background(self) -> None:
        """(tests) Waits for background work such as first-start defaults."""
        while self._background:
            await asyncio.gather(*list(self._background), return_exceptions=True)

    # -- store ---------------------------------------------------------------------------------

    def _store_fields(self) -> list[SettingField]:
        return [f for f in self.config.fields if handler_of(f) is None]

    def _defaults(self) -> dict[str, Json]:
        return {f.key: cast(Json, f.default) for f in self._store_fields() if f.default is not None}

    def _effective(self, f: SettingField) -> tuple[Json, ValueSource]:
        if f.key in self._values:
            return self._values[f.key], "saved"
        if f.default is not None:
            return cast(Json, f.default), "default"
        return None, "none"

    def _write_store(self) -> None:
        self.store.write(self._values, self._defaults())

    def _write_env(self) -> None:
        path = self.config.env_file
        if path is None:
            return
        items: list[tuple[str, Json]] = []
        for f in self._store_fields():
            value, _source = self._effective(f)
            if value is not None:
                items.append((f.key, value))
        try:
            EnvExport(path).write(items)
        except OSError as err:
            # The app may not be installed yet; the next save tries again.
            log.warning("couldn't write env file %s: %s", path, err)
            raise

    # -- dispatch ------------------------------------------------------------------------------

    async def dispatch(self, conn: Connection, method: MethodName, params: JsonObject) -> Json:
        match method:
            case "auth.start":
                return self._auth_start(conn, _parse(AuthStartParams, params))
            case "auth.finish":
                return self._auth_finish(conn, _parse(AuthFinishParams, params))
            case "settings.describe":
                _parse(EmptyParams, params)
                return await self._describe()
            case "settings.get":
                return await self._get(_parse(SettingsGetParams, params))
            case "settings.set":
                return await self._set(conn, _parse(SettingsSetParams, params))
            case "wifi.scan":
                _parse(EmptyParams, params)
                return await self._scan()
            case "system.details":
                _parse(EmptyParams, params)
                return await self._details()
            case "system.reboot":
                _parse(EmptyParams, params)
                return await self._reboot(conn)
            case "access.setPassword":
                return await self._set_password(conn, _parse(SetPasswordParams, params))
            case "access.setName":
                return await self._set_name(_parse(SetNameParams, params))

    # -- auth ----------------------------------------------------------------------------------

    def _check_backoff(self) -> None:
        retry = self.backoff.retry_after_s()
        if retry is not None:
            raise RpcError(
                "rate_limited",
                f"Too many wrong passwords; try again in {retry} s",
                {"retryAfterS": retry},
            )

    def _auth_start(self, conn: Connection, p: AuthStartParams) -> Json:
        self._check_backoff()
        A = _decode(p.A, "A")
        conn.drop_session()  # a new handshake replaces any session
        try:
            conn.pending_srp = SrpServer(self.verifier, A)
        except SrpError as err:
            raise RpcError("invalid_params", str(err), {"A": str(err)}) from err
        return {"salt": b64encode(conn.pending_srp.salt), "B": b64encode(conn.pending_srp.B)}

    def _auth_finish(self, conn: Connection, p: AuthFinishParams) -> Json:
        self._check_backoff()
        server, conn.pending_srp = conn.pending_srp, None
        if server is None:
            raise RpcError("bad_request", "Call auth.start first")
        M1 = _decode(p.M1, "M1")
        try:
            result = server.verify(M1)
        except SrpError as err:
            self.backoff.record_failure()
            log.warning("%s: wrong password (%d in a row)", conn.name, self.backoff.failures)
            raise RpcError("auth_failed", "Wrong password") from err
        self.backoff.record_success()
        conn.start_session(result.session_key)
        return {"M2": b64encode(result.M2), "idleTimeoutS": SESSION_IDLE_TIMEOUT_S}

    # -- settings ------------------------------------------------------------------------------

    async def _describe(self) -> Json:
        fields: list[Json] = []
        for f in self.config.fields:
            described = describe_field(self.config.raw_fields[f.key])
            if handler_of(f) == "timezone" and isinstance(f, SelectField) and f.options is None:
                # "Leave options out to get the full list": the phone needs it for a picker.
                try:
                    zones = await self.system.timezone.available()
                    options: list[Json] = [
                        {"value": z, "label": z.replace("_", " ")} for z in zones
                    ]
                    described["options"] = options
                except AdapterError as err:
                    log.warning("couldn't list time zones: %s", err)
            fields.append(described)
        return {"fields": fields, "permissions": self.config.permissions.to_json()}

    async def _get(self, p: SettingsGetParams) -> Json:
        keys = p.keys if p.keys is not None else [f.key for f in self.config.fields]
        unknown = [k for k in keys if k not in self.config.by_key]
        if unknown:
            details: JsonObject = {k: "Unknown setting" for k in unknown}
            raise RpcError("invalid_params", "Unknown settings", details)
        values: JsonObject = {}
        for key in keys:
            values[key] = await self._value_state(self.config.by_key[key])
        return {"values": values}

    async def _value_state(self, f: SettingField) -> JsonObject:
        handler = handler_of(f)
        if handler is None:
            value, source = self._effective(f)
            if is_secret(f):
                return {"secret": True, "set": value is not None and value != "", "source": source}
            return {"secret": False, "value": value, "source": source}
        try:
            if handler == "wifi":
                status = await self.system.wifi.status()
                if status is None:
                    return {"secret": False, "value": None, "source": "none"}
                return {"secret": False, "value": status.to_json(), "source": "system"}
            if handler == "hostname":
                return {
                    "secret": False,
                    "value": await self.system.hostname.get(),
                    "source": "system",
                }
            return {"secret": False, "value": await self.system.timezone.get(), "source": "system"}
        except Exception as err:
            log.warning("couldn't read %s from the system: %s", f.key, err)
            return {"secret": False, "value": None, "source": "none"}

    async def _check_set_value(self, f: SettingField, value: Json) -> str | None:
        handler = handler_of(f)
        if value is None:
            if handler is not None:
                return "This setting can't be cleared"
            return "This setting can't be changed" if f.readOnly else None
        error = validate_value(f, value)
        if error is not None:
            return error
        if handler == "hostname" and isinstance(value, str) and not HOSTNAME_RE.match(value):
            return "Use letters, digits and hyphens (up to 63, not starting or ending with -)"
        if handler == "timezone" and isinstance(f, SelectField) and f.options is None:
            try:
                if value not in await self.system.timezone.available():
                    return "Unknown time zone"
            except AdapterError as err:
                return f"Couldn't check the time zone: {err}"
        return None

    async def _set(self, conn: Connection, p: SettingsSetParams) -> Json:
        # 1. Validate everything; nothing is applied if anything is refused.
        errors: JsonObject = {}
        for key, value in p.values.items():
            f = self.config.by_key.get(key)
            problem = "Unknown setting" if f is None else await self._check_set_value(f, value)
            if problem is not None:
                errors[key] = problem
        if errors:
            raise RpcError("invalid_params", "Some values were refused; nothing was saved", errors)
        if self._lock.locked():
            raise RpcError("busy", "Another change is still being applied")

        async with self._lock:
            results: dict[str, _Applied] = {}
            fields = [self.config.by_key[k] for k in p.values]

            # 2. System handlers, quickest first.
            system_fields = sorted(
                (f for f in fields if handler_of(f) is not None),
                key=lambda f: _HANDLER_ORDER[handler_of(f) or "wifi"],
            )
            for f in system_fields:
                results[f.key] = await self._apply_system(conn, f, p.values[f.key])

            # 3. Store fields: one atomic write, then the env file.
            store_fields = [f for f in fields if handler_of(f) is None]
            if store_fields:
                results.update(self._apply_store(conn, store_fields, p.values))

            # 4. Restart each unit named by a changed field, once, after everything is written.
            units: list[str] = []
            for f in self.config.fields:
                applied = results.get(f.key)
                if applied is None or not applied.changed or f.onChange is None:
                    continue
                for item in f.onChange.restart or []:
                    if item.root not in units:
                        units.append(item.root)
            restarted: list[Json] = []
            for unit in units:
                conn.send(status_event("service.restarting", f"Restarting {unit}", unit=unit))
                try:
                    await self.system.systemd.restart(unit)
                except Exception as err:
                    log.warning("restart %s failed: %s", unit, err)
                    conn.send(
                        status_event("service.failed", f"Couldn't restart {unit}: {err}", unit=unit)
                    )
                    continue
                restarted.append(unit)
                conn.send(status_event("service.restarted", f"Restarted {unit}", unit=unit))

        out: JsonObject = {key: results[key].to_json() for key in p.values}
        return {"results": out, "restarted": restarted}

    async def _apply_system(self, conn: Connection, f: SettingField, value: Json) -> _Applied:
        handler = handler_of(f)

        def event(kind: StatusKind, message: str) -> None:
            conn.send(status_event(kind, message, key=f.key))

        try:
            if handler == "hostname" and isinstance(value, str):
                if await self.system.hostname.get() == value:
                    return _Applied(ok=True)
                await self.system.hostname.set(value)
                event("hostname.changed", f"Hostname is now {value}")
                return _Applied(ok=True, changed=True)
            if handler == "timezone" and isinstance(value, str):
                if await self.system.timezone.get() == value:
                    return _Applied(ok=True)
                await self.system.timezone.set(value)
                event("timezone.changed", f"Time zone is now {value}")
                return _Applied(ok=True, changed=True)
            if handler == "wifi" and isinstance(value, dict):
                ssid = cast(str, value["ssid"])
                password = value.get("password")
                event("wifi.connecting", f"Connecting to {ssid}")
                result = await self.system.wifi.connect(
                    ssid,
                    password if isinstance(password, str) else None,
                    value.get("hidden") is True,
                )
                if not result.ok:
                    message = result.error or "Couldn't connect"
                    event("wifi.failed", f"Couldn't connect to {ssid}: {message}")
                    return _Applied(ok=False, error=message)
                ip = f", IP {result.ipv4}" if result.ipv4 else ""
                event("wifi.connected", f"Connected to {ssid}{ip}")
                return _Applied(ok=True, changed=True)
        except AdapterError as err:
            if handler == "wifi":
                event("wifi.failed", str(err))
            return _Applied(ok=False, error=str(err))
        except Exception:
            log.exception("applying %s failed", f.key)
            return _Applied(ok=False, error="Something went wrong on the device")
        return _Applied(ok=False, error="Unsupported value")

    def _apply_store(
        self, conn: Connection, fields: list[SettingField], values: dict[str, Json]
    ) -> dict[str, _Applied]:
        before = dict(self._values)
        changed: set[str] = set()
        for f in fields:
            new = values[f.key]
            if new is None:
                self._values.pop(f.key, None)
            else:
                self._values[f.key] = cast(Json, normalize_value(f, new))
            if before.get(f.key, _MISSING) != self._values.get(f.key, _MISSING):
                changed.add(f.key)
        try:
            self._write_store()
        except OSError as err:
            log.exception("couldn't write the store")
            self._values = before
            return {
                f.key: _Applied(ok=False, error=f"Couldn't save: {err.strerror}") for f in fields
            }
        conn.send(
            status_event(
                "store.saved", f"Saved {len(fields)} setting{'s' if len(fields) != 1 else ''}"
            )
        )
        try:
            self._write_env()
        except OSError as err:
            message = f"Saved, but couldn't update {self.config.env_file}: {err.strerror}"
            return {f.key: _Applied(ok=False, error=message) for f in fields}
        return {f.key: _Applied(ok=True, changed=f.key in changed) for f in fields}

    async def _scan(self) -> Json:
        try:
            networks = await self.system.wifi.scan()
        except AdapterError as err:
            raise RpcError("internal", f"Wi-Fi scan failed: {err}") from err
        out: list[Json] = [n.to_json() for n in sorted(networks, key=lambda n: -n.signal)]
        return {"networks": out}

    # -- system and access ---------------------------------------------------------------------

    async def _details(self) -> Json:
        name, count = self.config.name, len(self.config.fields)
        if self.system.details is not None:
            return await self.system.details.collect(name, count)
        items: list[Json] = [
            {"label": "Version", "value": __version__},
            {"label": "Bluetooth name", "value": name},
            {"label": "Settings in config", "value": f"{count:,}"},
        ]
        return {"sections": [{"title": "pi-configurator", "items": items}]}

    async def _reboot(self, conn: Connection) -> Json:
        if not self.config.permissions.allow_reboot:
            raise RpcError(
                "forbidden", "Rebooting from the phone is turned off (permissions.allowReboot)"
            )
        if self._lock.locked():
            raise RpcError("busy", "Another change is still being applied")
        conn.send(status_event("system.rebooting", "Rebooting in a moment"))

        async def reboot_soon() -> None:
            await self._sleep(1)
            async with self._lock:
                await self.system.systemd.reboot()

        self._spawn(reboot_soon())
        return {"rebooting": True}

    def _check_access_changes(self) -> None:
        if not self.config.permissions.allow_access_changes:
            raise RpcError(
                "forbidden",
                "Changing access from the phone is turned off (permissions.allowAccessChanges)",
            )
        if self._lock.locked():
            raise RpcError("busy", "Another change is still being applied")

    def _rewrite(self, change: Callable[[JsonObject], None]) -> LoadedConfig:
        try:
            return rewrite_config(self.paths.config, change)
        except ConfigInvalid as err:
            raise RpcError("internal", f"config.json no longer passes its checks: {err}") from err
        except (OSError, ValueError) as err:
            raise RpcError("internal", f"Couldn't rewrite config.json: {err}") from err

    def _replace_config_access(
        self, *, name: str | None = None, password: str | None = None
    ) -> None:
        """Updates the running config; the rest stays what the service started with."""
        model, raw = self.config.model, dict(self.config.raw)
        if name is not None:
            model = model.model_copy(
                update={"bluetooth": model.bluetooth.model_copy(update={"name": name})}
            )
            raw["bluetooth"] = {**cast(JsonObject, raw["bluetooth"]), "name": name}
        if password is not None:
            model = model.model_copy(
                update={"access": model.access.model_copy(update={"password": password})}
            )
            raw["access"] = {**cast(JsonObject, raw["access"]), "password": password}
        self.config = LoadedConfig(model=model, raw=raw)

    async def _set_password(self, conn: Connection, p: SetPasswordParams) -> Json:
        self._check_access_changes()
        async with self._lock:

            def change(data: JsonObject) -> None:
                access = data.get("access")
                if not isinstance(access, dict):
                    raise ValueError("config.json has no access section")
                access["password"] = p.password

            self._rewrite(change)
            self._replace_config_access(password=p.password)
            self.verifier = SrpVerifier.from_password(p.password)
            for other in list(self.connections):
                other.pending_srp = None
                if other is not conn:
                    other.end_session("The access password was changed; unlock again")
            self.warn_about_password()
            log.info("access password changed from %s", conn.name)
        return {}

    async def _set_name(self, p: SetNameParams) -> Json:
        self._check_access_changes()
        if utf8_length(p.name) > MAX_BLUETOOTH_NAME_BYTES:
            raise RpcError(
                "invalid_params",
                "Name is too long",
                {"name": f"At most {MAX_BLUETOOTH_NAME_BYTES} bytes"},
            )
        async with self._lock:

            def change(data: JsonObject) -> None:
                bluetooth = data.get("bluetooth")
                if not isinstance(bluetooth, dict):
                    raise ValueError("config.json has no bluetooth section")
                bluetooth["name"] = p.name

            self._rewrite(change)
            self._replace_config_access(name=p.name)
            log.info("Bluetooth name changed to %s", p.name)
            if self.on_name_changed is not None:
                try:
                    await self.on_name_changed(p.name)
                except Exception:
                    log.exception("re-advertising under the new name failed")
        return {}


class _Missing:
    pass


_MISSING: Final = _Missing()
