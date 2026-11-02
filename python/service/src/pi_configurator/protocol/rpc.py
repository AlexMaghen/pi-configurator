"""RPC messages exchanged over rpc-in / rpc-out (packages/protocol/src/rpc.ts).

Every message is one JSON object, UTF-8 encoded, then (after the handshake) sealed as a whole by
session.py, then split into frames by framing.py. The handshake (`auth.*`) and errors before it
are plain text; everything else is refused until the session is unlocked.

Params are checked with the small strict models below; results are built as plain JSON and
checked against json-schema/rpc.schema.json in the tests.
"""

from dataclasses import dataclass
from typing import Annotated, Final, Literal, get_args

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints

from .jsonutil import Json, JsonObject, js_length

PROTOCOL_VERSION: Final = 1

MethodName = Literal[
    "auth.start",
    "auth.finish",
    "settings.describe",
    "settings.get",
    "settings.set",
    "wifi.scan",
    "system.reboot",
    "access.setPassword",
    "access.setName",
]
METHOD_NAMES: Final[tuple[MethodName, ...]] = get_args(MethodName)
#: Methods that work without an unlocked session.
UNAUTHENTICATED_METHODS: Final[frozenset[MethodName]] = frozenset({"auth.start", "auth.finish"})

ErrorCode = Literal[
    "bad_request",  # not valid JSON or not a known envelope
    "unknown_method",
    "invalid_params",  # params failed validation; `details` has per-field messages
    "unauthenticated",  # method needs a session
    "auth_failed",  # wrong password
    "rate_limited",  # too many wrong passwords; `details.retryAfterS`
    "forbidden",  # a permission in the config is off
    "busy",  # another change is still being applied
    "internal",
]

StatusKind = Literal[
    "wifi.connecting",
    "wifi.connected",
    "wifi.failed",
    "hostname.changed",
    "timezone.changed",
    "store.saved",
    "service.restarting",
    "service.restarted",
    "service.failed",
    "system.rebooting",
    "session.ending",
]

ValueSource = Literal["saved", "default", "system", "none"]
WifiSecurity = Literal["open", "wep", "wpa", "wpa2", "wpa3", "enterprise"]


class RpcError(Exception):
    """Raised by a method handler; becomes `{id, error: {code, message, details?}}`."""

    def __init__(self, code: ErrorCode, message: str, details: JsonObject | None = None) -> None:
        super().__init__(message)
        self.code: ErrorCode = code
        self.message = message
        self.details = details

    def to_json(self) -> JsonObject:
        out: JsonObject = {"code": self.code, "message": self.message}
        if self.details is not None:
            out["details"] = self.details
        return out


def response(request_id: int, result: Json) -> JsonObject:
    return {"id": request_id, "result": result}


def error_response(request_id: int, error: RpcError) -> JsonObject:
    return {"id": request_id, "error": error.to_json()}


def status_event(
    kind: StatusKind, message: str, *, key: str | None = None, unit: str | None = None
) -> JsonObject:
    event: JsonObject = {"event": "status", "kind": kind, "message": message}
    if key is not None:
        event["key"] = key
    if unit is not None:
        event["unit"] = unit
    return event


@dataclass(frozen=True, slots=True)
class DeviceInfo:
    """Readable without a session from the `info` characteristic."""

    name: str
    service_version: str
    model: str | None = None

    def to_json(self) -> JsonObject:
        out: JsonObject = {"protocol": PROTOCOL_VERSION, "name": self.name}
        if self.model is not None:
            out["model"] = self.model
        out["serviceVersion"] = self.service_version
        return out


# ---------------------------------------------------------------------------------------------
# Params. Strict (no coercion) and closed (no unknown keys), like the zod `.strict()` objects.
# ---------------------------------------------------------------------------------------------

_B64 = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9+/]*={0,2}$")]


def _js_len_between(lo: int, hi: int | None) -> AfterValidator:
    def check(value: str) -> str:
        n = js_length(value)
        if n < lo or (hi is not None and n > hi):
            limit = f"{lo} to {hi}" if hi is not None else f"at least {lo}"
            raise ValueError(f"must be {limit} characters")
        return value

    return AfterValidator(check)


class _Params(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class EmptyParams(_Params):
    pass


class AuthStartParams(_Params):
    A: _B64


class AuthFinishParams(_Params):
    M1: _B64


class SettingsGetParams(_Params):
    keys: list[str] | None = None


class SettingsSetParams(_Params):
    # Each value is checked against its field by validate_value, which gives per-key messages.
    values: dict[str, Json]


class SetPasswordParams(_Params):
    password: Annotated[str, _js_len_between(1, 128)]


class SetNameParams(_Params):
    name: Annotated[str, _js_len_between(1, None)]
