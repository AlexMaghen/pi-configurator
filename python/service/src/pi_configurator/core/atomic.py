"""Atomic file writes: temp file in the same directory, fsync, rename, fsync the directory.

Readers (the client package, BallsPi's settings loader) see either the old file or the new
one, never half of it, even across a power cut.
"""

import contextlib
import grp
import logging
import os
import tempfile
from pathlib import Path

log = logging.getLogger(__name__)


def group_id(name: str | None) -> int | None:
    """The gid of a group, or None when it doesn't exist (e.g. on a dev Mac)."""
    if name is None:
        return None
    try:
        return grp.getgrnam(name).gr_gid
    except KeyError:
        return None


def atomic_write(
    path: Path,
    data: bytes,
    *,
    mode: int,
    uid: int | None = None,
    gid: int | None = None,
) -> None:
    """Replaces `path` with `data`. Ownership is only changed when running as root."""
    directory = path.parent
    directory.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(dir=directory, prefix=f".{path.name}.", suffix=".tmp")
    tmp = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as f:
            os.fchmod(f.fileno(), mode)
            if os.geteuid() == 0 and (uid is not None or gid is not None):
                os.fchown(f.fileno(), -1 if uid is None else uid, -1 if gid is None else gid)
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            tmp.unlink()
        raise
    _fsync_dir(directory)


def _fsync_dir(directory: Path) -> None:
    try:
        dir_fd = os.open(directory, os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(dir_fd)
    except OSError:
        pass  # not supported on every platform/filesystem; the rename itself is still atomic
    finally:
        os.close(dir_fd)
