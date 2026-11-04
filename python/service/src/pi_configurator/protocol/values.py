"""Checking a value the phone wants to save, and preparing settings for the phone.

Mirrors packages/protocol/src/values.ts. The app runs the TypeScript copy to show errors early;
this one is the authority. Both are tested against test-vectors/value-cases.json (acceptance must
agree; messages may differ).
"""

import math
import re
from typing import Final, cast

from .config import (
    BooleanField,
    IntegerField,
    NumberField,
    SelectField,
    SettingField,
    StringField,
)
from .js_regex import compile_js
from .jsonutil import Json, JsonObject, is_number, js_length

# The same expressions as values.ts, written so Python's `re` means the same thing (`\Z` for
# JavaScript's `$`, explicit A-Z instead of the `i` flag).
_URL: Final = re.compile(r"^[A-Za-z][A-Za-z0-9+.-]*://\S+\Z")
_EMAIL: Final = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+\Z")


def js_number(n: float) -> str:
    """A number the way JavaScript prints it in a template string (100, not 100.0)."""
    if isinstance(n, float) and n.is_integer() and abs(n) < 2**53:
        return str(int(n))
    return str(n)


def validate_value(f: SettingField, value: object) -> str | None:
    """The reason a value was refused, or None when it's fine. Messages are shown to users."""
    if f.readOnly:
        return "This setting can't be changed"
    if isinstance(f, StringField):
        if not isinstance(value, str):
            return "Must be text"
        n = js_length(value)
        if f.minLength is not None and n < f.minLength:
            return f"Must be at least {f.minLength} characters"
        if f.maxLength is not None and n > f.maxLength:
            return f"Must be at most {f.maxLength} characters"
        if f.pattern is not None and compile_js(f.pattern).search(value) is None:
            return "Not in the expected format"
        if f.format == "url" and value != "" and not _URL.match(value):
            return "Must be a URL"
        if f.format == "email" and value != "" and not _EMAIL.match(value):
            return "Must be an email address"
        return None
    if isinstance(f, IntegerField | NumberField):
        if not is_number(value) or not math.isfinite(cast(float, value)):
            return "Must be a number"
        number = cast(float, value)
        if isinstance(f, IntegerField) and not float(number).is_integer():
            return "Must be a whole number"
        if f.min is not None and number < f.min:
            return f"Must be at least {js_number(f.min)}"
        if f.max is not None and number > f.max:
            return f"Must be at most {js_number(f.max)}"
        if f.step is not None:
            steps = (number - (f.min or 0)) / f.step
            if abs(steps - round(steps)) > 1e-9:
                return f"Must be in steps of {js_number(f.step)}"
        return None
    if isinstance(f, BooleanField):
        return None if isinstance(value, bool) else "Must be on or off"
    assert isinstance(f, SelectField)
    if not isinstance(value, str) or all(o.value != value for o in f.options):
        return "Must be one of the choices"
    return None


def normalize_value(f: SettingField, value: object) -> object:
    """A validated value in its stored form: integers sent as 10.0 are kept as 10."""
    if isinstance(f, IntegerField) and isinstance(value, float):
        return int(value)
    return value


def describe_groups(groups: Json) -> list[Json]:
    """The config's raw `appSettings` as sent by settings.describe: secret defaults removed.

    Works on the raw JSON so the phone gets exactly what was written. The input is untouched.
    """
    out: list[Json] = []
    for group in cast(list[JsonObject], groups or []):
        items = [_describe_item(item) for item in cast(list[JsonObject], group["items"])]
        out.append({**group, "items": cast(list[Json], items)})
    return out


def _describe_item(raw: JsonObject) -> JsonObject:
    if raw.get("type") == "string" and raw.get("secret") is True and "default" in raw:
        return {k: v for k, v in raw.items() if k != "default"}
    return dict(raw)


def is_secret(f: SettingField) -> bool:
    """Whether a field's value is hidden from the phone."""
    return isinstance(f, StringField) and f.secret is True
