"""Where the service keeps its files. Every path can be moved with an environment variable or a
command-line flag, which is how the tests (and a dev Mac) run without touching /etc."""

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_CONFIG = Path("/etc/pi-configurator/config.json")
DEFAULT_STATE_DIR = Path("/var/lib/pi-configurator")
DEFAULT_HOSTS = Path("/etc/hosts")
DEFAULT_MODEL_FILE = Path("/proc/device-tree/model")


@dataclass(frozen=True, slots=True)
class Paths:
    config: Path = DEFAULT_CONFIG
    state_dir: Path = DEFAULT_STATE_DIR
    hosts: Path = DEFAULT_HOSTS
    model_file: Path = DEFAULT_MODEL_FILE

    @property
    def store(self) -> Path:
        """values.json, read by other programs through pi-configurator-client."""
        return self.state_dir / "values.json"

    @property
    def state(self) -> Path:
        return self.state_dir / "state.json"

    @classmethod
    def from_env(cls) -> "Paths":
        env = os.environ.get
        return cls(
            config=Path(env("PI_CONFIGURATOR_CONFIG", str(DEFAULT_CONFIG))),
            state_dir=Path(env("PI_CONFIGURATOR_STATE_DIR", str(DEFAULT_STATE_DIR))),
            hosts=Path(env("PI_CONFIGURATOR_HOSTS_FILE", str(DEFAULT_HOSTS))),
            model_file=Path(env("PI_CONFIGURATOR_MODEL_FILE", str(DEFAULT_MODEL_FILE))),
        )


def read_model(path: Path) -> str | None:
    """The board name, e.g. "Raspberry Pi 4 Model B Rev 1.5", or None off a Pi."""
    try:
        text = path.read_bytes().rstrip(b"\x00").decode(errors="replace").strip()
    except OSError:
        return None
    return text or None
