"""Test helpers: a values.json written the way the pi-configurator service writes it."""

import json
import os
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any


def write_store(
    tmp_path: Path, values: dict[str, Any] | None = None, defaults: dict[str, Any] | None = None
) -> Path:
    """Writes values.json atomically (temp file, then rename), like the service does."""
    path = tmp_path / "values.json"
    temp = tmp_path / "values.json.tmp"
    temp.write_text(json.dumps({"values": values or {}, "defaults": defaults or {}}))
    os.replace(temp, path)
    return path


def wait_until(condition: Callable[[], bool], timeout_s: float = 5.0) -> None:
    deadline = time.monotonic() + timeout_s
    while not condition():
        if time.monotonic() > deadline:
            raise AssertionError("timed out waiting")
        time.sleep(0.01)
