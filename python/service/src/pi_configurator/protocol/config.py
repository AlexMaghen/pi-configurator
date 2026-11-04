"""The config file (`/etc/pi-configurator/config.json`), mirroring packages/protocol/src/config.ts.

The shape comes from `config_models.py`, generated from the shared JSON Schema. Two things the
schema can't carry are added here:

- shape refinements zod has but JSON Schema doesn't (the Bluetooth name's byte limit, no `null`
  anywhere), reported with code "shape";
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

#: The Pi's own settings, in the order Device & Network shows them. Their keys are reserved.
SystemSetting = Literal["wifi", "hostname", "timezone"]
SYSTEM_SETTINGS: Final[tuple[SystemSetting, ...]] = get_args(SystemSetting)
ItemType = Literal["string", "integer", "number", "boolean", "select"]

# The generator names the item variants after their position in the schema's `oneOf`.
# tests/test_vectors_config.py checks each alias still has the `type` it claims.
ConfigFile = models.ConfigFile
DeviceSettings = models.DeviceSettings
SettingGroup = models.AppSetting
StringField = models.Items
IntegerField = models.Items1
NumberField = models.Items2
BooleanField = models.Items3
SelectField = models.Items4
SelectOption = models.Option
SettingField = StringField | IntegerField | NumberField | BooleanField | SelectField
#: An item's or a group's onChange (the generator makes one class per place it appears).
OnChange = (
    models.OnChange
    | models.OnChange1
    | models.OnChange2
    | models.OnChange3
    | models.OnChange4
    | models.OnChange5
)
FIELD_CLASSES: Final = (
    StringField,
    IntegerField,
    NumberField,
    BooleanField,
    SelectField,
)

ConfigIssueCode = Literal[
    "shape",  # the JSON shape is wrong (zod would fail to parse); Python-side only
    "duplicate_key",
    "reserved_key",
    "duplicate_group",
    "min_above_max",
    "default_out_of_range",
    "default_not_on_step",
    "default_pattern_mismatch",
    "default_length",
    "default_not_an_option",
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
}


def _item_shape_issues(groups: Json) -> list[ConfigIssue]:
    """Checks each item against the variant its `type` names, for errors that point at the
    real problem (a plain union reports a failure against every variant)."""
    if not isinstance(groups, list):
        return []  # the full model check reports it
    issues: list[ConfigIssue] = []
    for g, group in enumerate(groups):
        items = group.get("items") if isinstance(group, dict) else None
        if not isinstance(items, list):
            continue
        for i, item in enumerate(items):
            at = ("appSettings", g, "items", i)
            kind = item.get("type") if isinstance(item, dict) else None
            cls = _CLASS_FOR_TYPE.get(kind) if isinstance(kind, str) else None
            if cls is None:
                issues.append(ConfigIssue((*at, "type"), "shape", "unknown setting type"))
                continue
            try:
                cls.model_validate(item, strict=True)
            except ValidationError as err:
                issues.extend(
                    ConfigIssue((*at, *issue.path), "shape", issue.message)
                    for issue in _shape_issues(err)
                )
    return issues


def _refinement_issues(config: ConfigFile) -> list[ConfigIssue]:
    issues: list[ConfigIssue] = []
    if utf8_length(config.bluetooth.name) > MAX_BLUETOOTH_NAME_BYTES:
        issues.append(
            ConfigIssue(("bluetooth", "name"), "shape", "Bluetooth name is longer than 29 bytes")
        )
    return issues


def _steps_off(value: float, base: float, step: float) -> bool:
    steps = (value - base) / step
    return abs(steps - round(steps)) > 1e-9


def check_config(config: ConfigFile) -> list[ConfigIssue]:
    """Checks the rules JSON Schema can't express. Returns no issues for a valid config."""
    issues: list[ConfigIssue] = []
    seen_keys: dict[str, str] = {}
    seen_groups: dict[str, int] = {}
    env_export = config.export is not None and config.export.envFile != ""

    for g, group in enumerate(config.appSettings or []):
        if group.groupName in seen_groups:
            issues.append(
                ConfigIssue(
                    ("appSettings", g, "groupName"),
                    "duplicate_group",
                    f'Group "{group.groupName}" is already used by '
                    f"appSettings[{seen_groups[group.groupName]}]",
                )
            )
        else:
            seen_groups[group.groupName] = g

        for i, f in enumerate(group.items):

            def add(prop: str, code: ConfigIssueCode, message: str, *more: str | int) -> None:
                issues.append(
                    ConfigIssue(("appSettings", g, "items", i, prop, *more), code, message)  # noqa: B023
                )

            if f.key in SYSTEM_SETTINGS:
                add(
                    "key",
                    "reserved_key",
                    f'Key "{f.key}" is reserved for the Pi\'s own {f.key} setting',
                )
            elif f.key in seen_keys:
                add("key", "duplicate_key", f'Key "{f.key}" is already used by {seen_keys[f.key]}')
            else:
                seen_keys[f.key] = f"appSettings[{g}].items[{i}]"
            if env_export and not ENV_KEY_PATTERN.match(f.key):
                add("key", "env_key_invalid", f'Key "{f.key}" can\'t be written to an env file')

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
                values: set[str] = set()
                for j, o in enumerate(f.options):
                    if o.value in values:
                        add(
                            "options",
                            "duplicate_option",
                            f'Option "{o.value}" is listed twice',
                            j,
                            "value",
                        )
                    values.add(o.value)
                if f.default is not None and f.default not in values:
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
    """A config that passed every check, with the raw JSON kept for describe and rewrites.

    `fields` are the app setting items across every group, in order; `system` are the Pi's own
    settings `deviceSettings` turns on, in the fixed order.
    """

    model: ConfigFile
    raw: JsonObject
    fields: list[SettingField] = field(init=False)
    by_key: dict[str, SettingField] = field(init=False)
    on_change: dict[str, OnChange | None] = field(init=False)
    system: list[SystemSetting] = field(init=False)

    def __post_init__(self) -> None:
        groups = self.model.appSettings or []
        fields = [f for g in groups for f in g.items]
        on_change = {f.key: f.onChange or g.onChange for g in groups for f in g.items}
        device = self.model.deviceSettings
        system = [s for s in SYSTEM_SETTINGS if device is not None and _is_on(getattr(device, s))]
        object.__setattr__(self, "fields", fields)
        object.__setattr__(self, "by_key", {f.key: f for f in fields})
        object.__setattr__(self, "on_change", on_change)
        object.__setattr__(self, "system", system)

    @property
    def name(self) -> str:
        return self.model.bluetooth.name

    @property
    def password(self) -> str:
        return self.model.access.password

    @property
    def permissions(self) -> Permissions:
        d = self.model.deviceSettings
        if d is None:
            return Permissions()
        return Permissions(bool(d.allowReboot), bool(d.allowAccessChanges))

    @property
    def env_file(self) -> Path | None:
        e = self.model.export
        return Path(e.envFile) if e is not None else None

    def system_default(self, setting: SystemSetting) -> str | None:
        """The first-start default for the hostname or time zone, when the config gives one."""
        d = self.model.deviceSettings
        value: object = getattr(d, setting, None) if d is not None else None
        default: object = getattr(value, "default", None)
        return default if isinstance(default, str) else None


def _is_on(value: object) -> bool:
    return value is not None and value is not False


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
    field_issues = _item_shape_issues(data.get("appSettings"))
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
