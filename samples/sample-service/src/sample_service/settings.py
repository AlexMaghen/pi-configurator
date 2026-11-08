"""The service's settings, read from the pi-configurator store into one typed, immutable object.

Each field matches an item in the "Sample Service" group of config-template/config.json:

| Field         | Store key    | Config type                            |
|---------------|--------------|----------------------------------------|
| `color`       | `color`      | `select` (one of the `Color` values)   |
| `volume`      | `volume`     | `integer`, 0 to 100 in steps of 5      |
| `autostart`   | `autostart`  | `boolean`                              |
| `artist_name` | `artistName` | `string`, up to 60 characters          |

The store gives each key's saved value, else the config file's `default`. The defaults below are
only a last resort, for when the store has neither (pi-configurator not installed yet, or a key
the config file doesn't have), so the program always starts.

pi-configurator checks every value against the config file before saving it, so a well-matched
program never sees a bad one. If the config file and this code ever disagree (a renamed option,
a changed type), the field falls back to its default with a warning instead of crashing.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass, fields
from enum import StrEnum
from typing import Final, Self

from pi_configurator_client import Store, StoreError

log = logging.getLogger(__name__)

# The keys, exactly as in the config file.
COLOR: Final = "color"
VOLUME: Final = "volume"
AUTOSTART: Final = "autostart"
ARTIST_NAME: Final = "artistName"


class Color(StrEnum):
    """The `options` values of the `color` item."""

    WARM_WHITE = "warm-white"
    COOL_WHITE = "cool-white"
    RED = "red"
    GREEN = "green"
    BLUE = "blue"
    PURPLE = "purple"

    def __repr__(self) -> str:
        return repr(self.value)  # 'blue' in the logs, not <Color.BLUE: 'blue'>


@dataclass(frozen=True, slots=True)
class Settings:
    color: Color = Color.WARM_WHITE
    volume: int = 40
    autostart: bool = True
    artist_name: str = ""

    @classmethod
    def load(cls, store: Store) -> Self:
        """Reads every setting. Raises StoreError if values.json exists but can't be read (most
        often: this program's user isn't in the `pi-configurator` group)."""
        fallback = cls()
        return cls(
            color=_read(COLOR, fallback.color, lambda: Color(store.get_str(COLOR, fallback.color))),
            volume=_read(VOLUME, fallback.volume, lambda: store.get_int(VOLUME, fallback.volume)),
            autostart=_read(
                AUTOSTART, fallback.autostart, lambda: store.get_bool(AUTOSTART, fallback.autostart)
            ),
            artist_name=_read(
                ARTIST_NAME,
                fallback.artist_name,
                lambda: store.get_str(ARTIST_NAME, fallback.artist_name).strip(),
            ),
        )

    def changes_from(self, previous: Self) -> list[str]:
        """The names of the fields that differ from `previous`, in field order."""
        return [f.name for f in fields(self) if getattr(self, f.name) != getattr(previous, f.name)]


def _read[T](key: str, fallback: T, read: Callable[[], T]) -> T:
    try:
        return read()
    except StoreError:
        raise
    except (TypeError, ValueError) as err:
        # TypeError: the stored value has another type; ValueError: not one of the Color values.
        log.warning("%s: %s; using %r", key, err, fallback)
        return fallback
