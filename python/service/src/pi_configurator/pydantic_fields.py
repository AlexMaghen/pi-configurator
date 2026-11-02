"""`pi-configurator fields-from-pydantic module:Class`: config field entries from a settings class.

Reads a pydantic (or pydantic-settings) model's fields and prints `settings` entries for
config.json, so a device that already has a settings class (BallsPi) doesn't have to type them
out. The keys are the environment variable names pydantic-settings reads (env_prefix + field
name, upper-cased unless the class is case-sensitive), which is what the env-file export writes.

Mapping: str/Path -> string, int -> integer, float -> number, bool -> boolean, Literal or Enum
of strings -> select, SecretStr -> secret string; `X | None` is treated as X. Ge/Gt/Le/Lt become
min/max, min_length/max_length/pattern carry over. Anything else (lists, dicts, nested models)
is skipped with a note on stderr. Every entry targets the store; edit the output as needed.
"""

import enum
import importlib
import sys
import types
from pathlib import Path
from typing import Any, Literal, Union, cast, get_args, get_origin

from pydantic import BaseModel, SecretStr
from pydantic.fields import FieldInfo
from pydantic_core import PydanticUndefined

from .protocol.jsonutil import Json, JsonObject


def load_class(spec: str) -> type[BaseModel]:
    module_name, _, class_name = spec.partition(":")
    if not module_name or not class_name:
        raise ValueError("expected module:Class, e.g. balls.settings:BallsSettings")
    sys.path.insert(0, str(Path.cwd()))
    obj = getattr(importlib.import_module(module_name), class_name)
    if not (isinstance(obj, type) and issubclass(obj, BaseModel)):
        raise TypeError(f"{spec} is not a pydantic model class")
    return obj


def _strip_optional(annotation: Any) -> tuple[Any, bool]:
    origin = get_origin(annotation)
    if origin in (Union, types.UnionType):
        args = [a for a in get_args(annotation) if a is not type(None)]
        if len(args) == 1:
            return args[0], True
    return annotation, False


def _label(name: str) -> str:
    return name.replace("_", " ").strip().capitalize() or name


def _env_key(model: type[BaseModel], name: str, info: FieldInfo) -> str:
    config = cast(dict[str, Any], model.model_config)
    alias = info.validation_alias if isinstance(info.validation_alias, str) else info.alias
    key = alias or f"{config.get('env_prefix', '')}{name}"
    return key if config.get("case_sensitive") else key.upper()


def _apply_metadata(entry: JsonObject, info: FieldInfo) -> None:
    for m in info.metadata:
        for attr, prop in (("ge", "min"), ("gt", "min"), ("le", "max"), ("lt", "max")):
            v = getattr(m, attr, None)
            if isinstance(v, int | float) and not isinstance(v, bool):
                entry[prop] = v
        for attr in ("min_length", "max_length"):
            v = getattr(m, attr, None)
            if isinstance(v, int):
                entry["minLength" if attr == "min_length" else "maxLength"] = v
        pattern = getattr(m, "pattern", None)
        if isinstance(pattern, str):
            entry["pattern"] = pattern


def _json_default(value: Any) -> Json | None:
    if value is None or value is PydanticUndefined:
        return None
    if isinstance(value, enum.Enum):
        value = value.value
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, bool | int | float | str):
        return value
    return None


def field_entry(model: type[BaseModel], name: str, info: FieldInfo) -> JsonObject | None:
    annotation, _optional = _strip_optional(info.annotation)
    entry: JsonObject = {
        "key": _env_key(model, name, info),
        "label": info.title or _label(name),
    }
    if info.description:
        entry["help"] = info.description
    default = _json_default(info.default)

    if annotation is SecretStr:
        entry["type"] = "string"
        entry["secret"] = True
        raw = info.default.get_secret_value() if isinstance(info.default, SecretStr) else None
        default = raw
    elif annotation is bool:
        entry["type"] = "boolean"
    elif annotation is int:
        entry["type"] = "integer"
    elif annotation is float:
        entry["type"] = "number"
    elif annotation in (str, Path):
        entry["type"] = "string"
    elif get_origin(annotation) is Literal and all(
        isinstance(a, str) for a in get_args(annotation)
    ):
        entry["type"] = "select"
        entry["options"] = [{"value": a, "label": _label(a)} for a in get_args(annotation)]
    elif isinstance(annotation, type) and issubclass(annotation, enum.Enum):
        members = [m.value for m in annotation]
        if not all(isinstance(v, str) for v in members):
            return None
        entry["type"] = "select"
        entry["options"] = [{"value": v, "label": _label(v)} for v in members]
    else:
        return None

    _apply_metadata(entry, info)
    if default is not None and not (isinstance(default, bool) and entry["type"] != "boolean"):
        entry["default"] = default
    entry["target"] = {"store": True}
    return entry


def fields_from_model(
    model: type[BaseModel], group: str | None = None, restart: list[str] | None = None
) -> tuple[list[Json], list[str]]:
    """Returns (entries, names of skipped fields)."""
    entries: list[Json] = []
    skipped: list[str] = []
    for name, info in model.model_fields.items():
        entry = field_entry(model, name, info)
        if entry is None:
            skipped.append(name)
            continue
        if group:
            entry["group"] = group
        if restart:
            units: list[Json] = [*restart]
            entry["onChange"] = {"restart": units}
        entries.append(entry)
    return entries, skipped
