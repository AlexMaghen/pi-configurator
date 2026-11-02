"""The service's own state file (`/var/lib/pi-configurator/state.json`).

Holds what must survive restarts but isn't a setting: so far only whether the first-start
defaults for system fields have been applied (design.md section 3.3).
"""

import logging
from datetime import UTC, datetime
from pathlib import Path

from ..protocol.jsonutil import Json, JsonError, JsonObject, dumps_pretty, loads
from .atomic import atomic_write

log = logging.getLogger(__name__)


class StateFile:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> JsonObject:
        try:
            data = loads(self.path.read_bytes())
        except FileNotFoundError:
            return {}
        except (OSError, JsonError) as err:
            log.warning("ignoring unreadable state file %s: %s", self.path, err)
            return {}
        return data if isinstance(data, dict) else {}

    def save(self, state: JsonObject) -> None:
        atomic_write(self.path, dumps_pretty(state).encode(), mode=0o600)

    @property
    def first_start_defaults_applied(self) -> bool:
        return self.load().get("firstStartDefaultsApplied") is True

    def mark_first_start_defaults_applied(self, applied: list[str]) -> None:
        state = self.load()
        state["firstStartDefaultsApplied"] = True
        state["firstStartDefaultsAppliedAt"] = datetime.now(UTC).isoformat(timespec="seconds")
        keys: list[Json] = [*applied]
        state["firstStartDefaults"] = keys
        self.save(state)
