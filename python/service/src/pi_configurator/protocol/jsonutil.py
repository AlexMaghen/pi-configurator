"""JSON helpers that behave like the phone's `JSON.parse` / `JSON.stringify`.

Python's json module accepts NaN and Infinity by default; JavaScript does not, so they are
refused here. Lengths are measured in UTF-16 code units, which is what JavaScript's
`string.length` counts (zod `.min()` / `.max()` and the `minLength` rules use it).
"""

import base64
import json
import re
from typing import Final

type Json = bool | int | float | str | list[Json] | dict[str, Json] | None
type JsonObject = dict[str, Json]


class JsonError(ValueError):
    pass


def _refuse_constant(name: str) -> object:
    raise JsonError(f"{name} is not valid JSON")


def loads(data: str | bytes) -> Json:
    try:
        value: Json = json.loads(data, parse_constant=_refuse_constant)
    except (json.JSONDecodeError, UnicodeDecodeError) as err:
        raise JsonError(str(err)) from err
    return value


def dumps(value: object) -> str:
    """Compact, like JSON.stringify(value). Non-ASCII is kept as UTF-8."""
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def dumps_pretty(value: object) -> str:
    """Two-space indent with a trailing newline, like JSON.stringify(value, null, 2) + "\\n"."""
    return json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n"


def js_length(text: str) -> int:
    """`text.length` in JavaScript: UTF-16 code units (astral characters count as 2)."""
    return len(text.encode("utf-16-le")) // 2


def utf8_length(text: str) -> int:
    return len(text.encode("utf-8"))


def is_number(value: object) -> bool:
    """A JSON number. `bool` is an `int` subclass in Python, so it is excluded explicitly."""
    return isinstance(value, int | float) and not isinstance(value, bool)


_B64_RE: Final = re.compile(r"[A-Za-z0-9+/]*={0,2}\Z")


def b64encode(data: bytes) -> str:
    """Standard padded base64, the encoding for every binary value in RPC messages."""
    return base64.b64encode(data).decode("ascii")


def b64decode(text: str) -> bytes:
    """Decodes standard base64; padding may be left out (the phone's decoder allows that too)."""
    if not _B64_RE.match(text):
        raise ValueError("invalid base64")
    clean = text.rstrip("=")
    if len(clean) % 4 == 1:
        raise ValueError("invalid base64")
    return base64.b64decode(clean + "=" * (-len(clean) % 4))
