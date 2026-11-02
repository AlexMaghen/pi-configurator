"""Running the config's JavaScript `pattern` strings with Python's `re`, the way the phone does.

The phone runs `new RegExp(pattern).test(value)`: an unanchored search, no flags. Python's
`re.search` is the same search, but a few details differ and are translated here:

- `$` in JavaScript matches only at the very end; in Python it also matches before a final
  newline, so "abc\\n" would pass "^[a-z]+$". Each `$` outside a character class becomes `\\Z`.
  (This matters: a hostname with a trailing newline must not get through.)
- `\\d`, `\\w`, `\\b` are ASCII-only in JavaScript (no `u` flag); `re.ASCII` does the same.
- Named groups `(?<name>...)` and back-references `\\k<name>` become `(?P<name>...)`, `(?P=name)`.

Config authors should stay in the common subset (classes, quantifiers, groups, alternation,
anchors). Syntax only one side knows (Python's `(?P<n>)`, `\\Z`, inline flags; JavaScript's
`\\u{...}`, `[^]`) may be accepted by one side and refused by the other.
"""

import re
from functools import lru_cache


def translate(pattern: str) -> str:
    out: list[str] = []
    i = 0
    in_class = False
    n = len(pattern)
    while i < n:
        ch = pattern[i]
        if ch == "\\" and i + 1 < n:
            nxt = pattern[i + 1]
            if nxt == "k" and not in_class and i + 2 < n and pattern[i + 2] == "<":
                end = pattern.find(">", i + 3)
                if end != -1:
                    out.append(f"(?P={pattern[i + 3 : end]})")
                    i = end + 1
                    continue
            out.append(pattern[i : i + 2])
            i += 2
            continue
        if in_class:
            if ch == "]":
                in_class = False
            out.append(ch)
        elif ch == "[":
            in_class = True
            out.append(ch)
            # A `]` right after `[` or `[^` is a literal in Python but ends an empty class in JS;
            # both are rare enough that the common subset just avoids them.
        elif ch == "$":
            out.append(r"\Z")
        elif pattern.startswith("(?<", i) and not pattern.startswith(("(?<=", "(?<!"), i):
            out.append("(?P<")
            i += 3
            continue
        else:
            out.append(ch)
        i += 1
    return "".join(out)


@lru_cache(maxsize=256)
def compile_js(pattern: str) -> re.Pattern[str]:
    """Compiles a JavaScript pattern for Python. Raises `re.error` when it isn't valid."""
    return re.compile(translate(pattern), re.ASCII)


def js_test(pattern: str, value: str) -> bool:
    """`new RegExp(pattern).test(value)`."""
    return compile_js(pattern).search(value) is not None
