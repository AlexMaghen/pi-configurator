"""The config file (`/etc/pi-configurator/config.json`), mirroring packages/protocol/src/config.ts.

The shape comes from `config_models.py`, generated from the shared JSON Schema. Two things the
schema can't carry are added here:

- shape refinements zod has but JSON Schema doesn't (Bluetooth name and SSID byte limits, the
  Wi-Fi password rule, no `null` anywhere), reported with code "shape";
- `check_config`, the cross-field rules, with the same issue codes as the TypeScript `checkConfig`.

Both are tested against packages/protocol/test-vectors/config-cases.json.
"""

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Final, Literal, cast, get_args

from pydantic import ValidationError

from . import config_models as models
from .js_regex import compile_js
from .jsonutil import Json, JsonError, JsonObject, js_length, loads, utf8_length

#: Longest Bluetooth name that fits a scan response next to our 128-bit service UUID.
MAX_BLUETOOTH_NAME_BYTES: Final = 29
#: Keys written to an env file must also be valid shell variable names.
ENV_KEY_PATTERN: Final = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")

SystemHandler = Literal["wifi", "hostname", "timezone"]
SYSTEM_HANDLERS: Final[tuple[SystemHandler, ...]] = get_args(SystemHandler)
FieldType = Literal["string", "integer", "number", "boolean", "select", "wifi"]

# The generator names the field variants after their position in the schema's `oneOf`.
# tests/test_generated.py checks each alias still has the `type` it claims.
ConfigFile = models.ConfigFile
StringField = models.Settings
IntegerField = models.Settings1
NumberField = models.Settings2
BooleanField = models.Settings3
SelectField = models.Settings4
WifiField = models.Settings5
SelectOption = models.Option
SettingField = StringField | IntegerField | NumberField | BooleanField | SelectField | WifiField
FIELD_CLASSES: Final = (
    StringField,
    IntegerField,
    NumberField,
    BooleanField,
    SelectField,
    WifiField,
)

#: Which field type each system handler needs.
HANDLER_FIELD_TYPE: Final[dict[SystemHandler, FieldType]] = {
    "wifi": "wifi",
    "hostname": "string",
    "timezone": "select",
}

ConfigIssueCode = Literal[
    "shape",  # the JSON shape is wrong (zod would fail to parse); Python-side only
    "duplicate_key",
    "handler_type_mismatch",
    "duplicate_handler",
    "wifi_needs_handler",
    "min_above_max",
    "default_out_of_range",
    "default_not_on_step",
    "default_pattern_mismatch",
    "default_length",
    "default_not_an_option",
    "options_required",
    "duplicate_option",
    "bad_pattern",
    "env_key_invalid",
    "length_min_above_max",
]

Path_ = tuple[str | int, ...]


@dataclass(frozen=True, slots=True)
class ConfigIssue:
    """A broken rule. `path` points at the offending property."""

    path: Path_
    code: ConfigIssueCode
    message: str

    def __str__(self) -> str:
        where = ".".join(str(p) for p in self.path) or "(root)"
        return f"{where}: {self.message} [{self.code}]"


class ConfigInvalid(Exception):
    def __init__(self, issues: list[ConfigIssue]) -> None:
        super().__init__("; ".join(str(i) for i in issues))
        self.issues = issues


def handler_of(f: SettingField) -> SystemHandler | None:
    """The system handler a field uses, or None for a store field."""
    system: object = getattr(f.target, "system", None)
    return cast(SystemHandler, system) if isinstance(system, str) else None


def is_store(f: SettingField) -> bool:
    return handler_of(f) is None


def wifi_value_error(value: object) -> str | None:
    """The `WifiValue` rules from config.ts; None when the value is fine."""
    if not isinstance(value, dict):
        return "Not a valid Wi-Fi network"
    obj = cast(dict[str, object], value)
    extra = set(obj) - {"ssid", "password", "hidden"}
    if extra:
        return f"Unknown property {sorted(extra)[0]!r}"
    ssid = obj.get("ssid")
    if not isinstance(ssid, str) or ssid == "":
        return "Enter the network name"
    if utf8_length(ssid) > 32:
        return "SSID is longer than 32 bytes"
    if "password" in obj:
        password = obj["password"]
        if not isinstance(password, str):
            return "Wi-Fi password must be text"
        if password != "" and not 8 <= js_length(password) <= 63:
            return "Wi-Fi password must be 8 to 63 characters"
    if "hidden" in obj and not isinstance(obj["hidden"], bool):
        return "hidden must be true or false"
    return None


def _find_nulls(value: Json, path: Path_, out: list[ConfigIssue]) -> None:
    # Nothing in the config is nullable; zod's `.optional()` refuses null while the generated
    # `X | None` models would accept it.
    if value is None:
        out.append(ConfigIssue(path, "shape", "null is not allowed here"))
    elif isinstance(value, dict):
        for k, v in value.items():
            _find_nulls(v, (*path, k), out)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            _find_nulls(v, (*path, i), out)


def _shape_issues(error: ValidationError) -> list[ConfigIssue]:
    issues: list[ConfigIssue] = []
    for e in error.errors(include_url=False):
        # Union errors carry the variant class name in `loc`; keep only real path parts.
        loc = tuple(p for p in e["loc"] if isinstance(p, int) or not p[:1].isupper())
        issues.append(ConfigIssue(loc, "shape", e["msg"]))
    return issues


_CLASS_FOR_TYPE: Final[dict[str, type[SettingField]]] = {
    "string": StringField,
    "integer": IntegerField,
    "number": NumberField,
    "boolean": BooleanField,
    "select": SelectField,
    "wifi": WifiField,
}


def _field_shape_issues(settings: Json) -> list[ConfigIssue]:
    """Checks each field against the variant its `type` names, for errors that point at the
    real problem (a plain union reports a failure against every variant)."""
    if not isinstance(settings, list):
        return []  # the full model check reports it
    issues: list[ConfigIssue] = []
    for i, item in enumerate(settings):
        kind = item.get("type") if isinstance(item, dict) else None
        cls = _CLASS_FOR_TYPE.get(kind) if isinstance(kind, str) else None
        if cls is None:
            issues.append(ConfigIssue(("settings", i, "type"), "shape", "unknown field type"))
            continue
        try:
            cls.model_validate(item, strict=True)
        except ValidationError as err:
            issues.extend(
                ConfigIssue(("settings", i, *issue.path), "shape", issue.message)
                for issue in _shape_issues(err)
            )
    return issues


def _refinement_issues(config: ConfigFile) -> list[ConfigIssue]:
    issues: list[ConfigIssue] = []
    if utf8_length(config.bluetooth.name) > MAX_BLUETOOTH_NAME_BYTES:
        issues.append(
            ConfigIssue(("bluetooth", "name"), "shape", "Bluetooth name is longer than 29 bytes")
        )
    for i, f in enumerate(config.settings):
        if isinstance(f, WifiField) and f.default is not None:
            problem = wifi_value_error(f.default.model_dump(exclude_none=True))
            if problem:
                issues.append(ConfigIssue(("settings", i, "default"), "shape", problem))
    return issues


def _steps_off(value: float, base: float, step: float) -> bool:
    steps = (value - base) / step
    return abs(steps - round(steps)) > 1e-9


def check_config(config: ConfigFile) -> list[ConfigIssue]:
    """Checks the rules JSON Schema can't express. Returns no issues for a valid config."""
    issues: list[ConfigIssue] = []
    seen_keys: dict[str, int] = {}
    seen_handlers: dict[SystemHandler, int] = {}
    env_export = config.export is not None and config.export.envFile != ""

    for i, f in enumerate(config.settings):

        def add(prop: str, code: ConfigIssueCode, message: str, *more: str | int) -> None:
            issues.append(ConfigIssue(("settings", i, prop, *more), code, message))  # noqa: B023

        if f.key in seen_keys:
            add(
                "key",
                "duplicate_key",
                f'Key "{f.key}" is already used by settings[{seen_keys[f.key]}]',
            )
        else:
            seen_keys[f.key] = i

        handler = handler_of(f)
        if handler is None:
            if f.type == "wifi":
                add("target", "wifi_needs_handler", "Wi-Fi fields must use the wifi system handler")
            if env_export and not ENV_KEY_PATTERN.match(f.key):
                add("key", "env_key_invalid", f'Key "{f.key}" can\'t be written to an env file')
        else:
            needed = HANDLER_FIELD_TYPE[handler]
            if f.type != needed:
                add(
                    "type",
                    "handler_type_mismatch",
                    f'The {handler} handler needs a field of type "{needed}"',
                )
            if handler in seen_handlers:
                add(
                    "target",
                    "duplicate_handler",
                    f"The {handler} handler is already used by settings[{seen_handlers[handler]}]",
                )
            else:
                seen_handlers[handler] = i

        if isinstance(f, IntegerField | NumberField):
            lo, hi, step, d = f.min, f.max, f.step, f.default
            if lo is not None and hi is not None and lo > hi:
                add("min", "min_above_max", "min is above max")
            if d is not None:
                if (lo is not None and d < lo) or (hi is not None and d > hi):
                    add("default", "default_out_of_range", "default is outside min/max")
                if step is not None and _steps_off(d, lo or 0, step):
                    add("default", "default_not_on_step", "default is not on a step")
        elif isinstance(f, StringField):
            pattern: re.Pattern[str] | None = None
            if f.pattern is not None:
                try:
                    pattern = compile_js(f.pattern)
                except re.error:
                    add("pattern", "bad_pattern", "pattern is not a valid regular expression")
            lo_len, hi_len = f.minLength, f.maxLength
            if lo_len is not None and hi_len is not None and lo_len > hi_len:
                add("minLength", "length_min_above_max", "minLength is above maxLength")
            d = f.default
            if d is not None:
                if pattern is not None and pattern.search(d) is None:
                    add("default", "default_pattern_mismatch", "default doesn't match pattern")
                n = js_length(d)
                if (lo_len is not None and n < lo_len) or (hi_len is not None and n > hi_len):
                    add("default", "default_length", "default is outside minLength/maxLength")
        elif isinstance(f, SelectField):
            if f.options is None and handler != "timezone":
                add(
                    "options",
                    "options_required",
                    "select fields need options (only timezone may leave them out)",
                )
            values: set[str] = set()
            for j, o in enumerate(f.options or []):
                if o.value in values:
                    add(
                        "options",
                        "duplicate_option",
                        f'Option "{o.value}" is listed twice',
                        j,
                        "value",
                    )
                values.add(o.value)
            if f.default is not None and f.options is not None and f.default not in values:
                add("default", "default_not_an_option", "default is not one of the options")

    return issues


@dataclass(frozen=True, slots=True)
class Permissions:
    allow_reboot: bool = False
    allow_access_changes: bool = False

    def to_json(self) -> JsonObject:
        return {"allowReboot": self.allow_reboot, "allowAccessChanges": self.allow_access_changes}


@dataclass(frozen=True)
class LoadedConfig:
    """A config that passed every check, with the raw JSON kept for describe and rewrites."""

    model: ConfigFile
    raw: JsonObject
    fields: list[SettingField] = field(init=False)
    raw_fields: dict[str, JsonObject] = field(init=False)
    by_key: dict[str, SettingField] = field(init=False)

    def __post_init__(self) -> None:
        settings = cast(list[JsonObject], self.raw["settings"])
        object.__setattr__(self, "fields", list(self.model.settings))
        object.__setattr__(self, "by_key", {f.key: f for f in self.model.settings})
        object.__setattr__(self, "raw_fields", {cast(str, r["key"]): r for r in settings})

    @property
    def name(self) -> str:
        return self.model.bluetooth.name

    @property
    def password(self) -> str:
        return self.model.access.password

    @property
    def permissions(self) -> Permissions:
        p = self.model.permissions
        if p is None:
            return Permissions()
        return Permissions(bool(p.allowReboot), bool(p.allowAccessChanges))

    @property
    def env_file(self) -> Path | None:
        e = self.model.export
        return Path(e.envFile) if e is not None else None

    def handler_field(self, handler: SystemHandler) -> SettingField | None:
        return next((f for f in self.fields if handler_of(f) == handler), None)


def parse_config(data: Json) -> LoadedConfig:
    """Checks a parsed config.json. Raises ConfigInvalid listing every problem found."""
    if not isinstance(data, dict):
        raise ConfigInvalid([ConfigIssue((), "shape", "the config must be a JSON object")])
    nulls: list[ConfigIssue] = []
    _find_nulls(data, (), nulls)
    if nulls:
        raise ConfigInvalid(nulls)
    if isinstance(data.get("version"), bool):  # True == 1 in Python, so Literal[1] lets it in
        raise ConfigInvalid([ConfigIssue(("version",), "shape", "version must be 1")])
    field_issues = _field_shape_issues(data.get("settings"))
    if field_issues:
        raise ConfigInvalid(field_issues)
    try:
        model = ConfigFile.model_validate(data, strict=True)
    except ValidationError as err:
        raise ConfigInvalid(_shape_issues(err)) from err
    issues = _refinement_issues(model)
    if issues:
        raise ConfigInvalid(issues)
    issues = check_config(model)
    if issues:
        raise ConfigInvalid(issues)
    return LoadedConfig(model=model, raw=data)


def load_config_file(path: Path) -> LoadedConfig:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as err:
        raise ConfigInvalid(
            [ConfigIssue((), "shape", f"can't read {path}: {err.strerror}")]
        ) from err
    try:
        data = loads(text)
    except JsonError as err:
        raise ConfigInvalid([ConfigIssue((), "shape", f"{path} is not valid JSON: {err}")]) from err
    return parse_config(data)
