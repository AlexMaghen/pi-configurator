"""Rewriting config.json for access.setPassword / access.setName.

The file on disk is read, changed in one place and written back atomically (mode 0600), so
everything else in it, including edits made since the service started, is kept as written.
"""

from collections.abc import Callable
from pathlib import Path

from ..protocol.config import LoadedConfig, parse_config
from ..protocol.jsonutil import JsonObject, dumps_pretty, loads
from .atomic import atomic_write


def rewrite_config(path: Path, change: Callable[[JsonObject], None]) -> LoadedConfig:
    """Applies `change` to the parsed file, checks the result and writes it.

    Returns the parsed new file. Raises ConfigInvalid (nothing written) if the result fails
    the config rules, OSError if it can't be read or written.
    """
    data = loads(path.read_bytes())
    if not isinstance(data, dict):
        raise ValueError(f"{path} is not a JSON object")
    change(data)
    loaded = parse_config(data)
    st = path.stat()
    atomic_write(path, dumps_pretty(data).encode(), mode=0o600, uid=st.st_uid, gid=st.st_gid)
    return loaded
