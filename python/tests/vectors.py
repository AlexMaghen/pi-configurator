"""Loads the shared contract files from packages/protocol (the TypeScript source of truth)."""

import json
from pathlib import Path
from typing import Any, cast

PROTOCOL = Path(__file__).resolve().parents[2] / "packages" / "protocol"
VECTORS = PROTOCOL / "test-vectors"
SCHEMAS = PROTOCOL / "json-schema"
EXAMPLES = Path(__file__).resolve().parents[2] / "examples"


def load_vector(name: str) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads((VECTORS / name).read_text()))


def load_schema(name: str) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads((SCHEMAS / name).read_text()))
