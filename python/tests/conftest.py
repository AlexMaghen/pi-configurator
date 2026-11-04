"""Shared fixtures: a service on fake system adapters with all files in a temp directory."""

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest
from pi_configurator.core.service import Service
from pi_configurator.paths import Paths
from pi_configurator.protocol.config import load_config_file
from pi_configurator.system.fakes import (
    FakeHostname,
    FakeSystemd,
    FakeTimezone,
    FakeWifi,
    fake_system,
)
from pi_configurator.system.interfaces import WifiNetwork

from .phone import Phone

PASSWORD = "correct horse battery"


def base_config(env_file: Path | None = None, **permissions: bool) -> dict[str, Any]:
    config: dict[str, Any] = {
        "version": 1,
        "bluetooth": {"name": "TestPi"},
        "access": {"password": PASSWORD},
        "deviceSettings": {
            "wifi": True,
            "hostname": {"default": "testpi"},
            "timezone": {"label": "Zone", "default": "America/Los_Angeles"},
            "allowReboot": False,
            "allowAccessChanges": False,
            **permissions,
        },
        "appSettings": [
            {"groupName": "App", "onChange": {"restart": ["app.service"]}, "items": [
                {"key": "DISPENSE_MS", "label": "Dispense", "type": "integer", "min": 100,
                 "max": 5000, "step": 50, "default": 800},
                {"key": "STREAM_URL", "label": "Stream", "type": "string", "format": "url",
                 "default": "", "onChange": {"restart": ["app.service", "other.service"]}},
                {"key": "API_KEY", "label": "API key", "type": "string", "secret": True},
            ]},
            {"groupName": "Other", "items": [
                {"key": "ENABLED", "label": "Enabled", "type": "boolean", "default": True},
                {"key": "SERIAL", "label": "Serial", "type": "string", "readOnly": True,
                 "default": "X1"},
            ]},
        ],
    }  # fmt: skip
    if env_file is not None:
        config["export"] = {"envFile": str(env_file)}
    return config


def items_by_key(config: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The config's app setting items by key, for tests that change one."""
    return {i["key"]: i for g in config["appSettings"] for i in g["items"]}


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@dataclass
class World:
    tmp: Path
    paths: Paths
    clock: Clock
    service: Service
    wifi: FakeWifi
    hostname: FakeHostname
    timezone: FakeTimezone
    systemd: FakeSystemd
    sleeps: list[float] = field(default_factory=list[float])

    def phone(self, frame_size: int = 182) -> Phone:
        return Phone(self.service, frame_size)

    async def unlocked_phone(self, frame_size: int = 182) -> Phone:
        phone = self.phone(frame_size)
        finish = await phone.unlock(PASSWORD)
        assert "result" in finish, finish
        return phone

    @property
    def store_json(self) -> dict[str, Any]:
        return json.loads(self.paths.store.read_text())


MakeWorld = Callable[..., World]


@pytest.fixture
def make_world(tmp_path: Path) -> MakeWorld:
    def make(config: dict[str, Any] | None = None, env: bool = True, **permissions: bool) -> World:
        env_file = tmp_path / "app" / ".env.production"
        env_file.parent.mkdir(exist_ok=True)
        data = (
            config if config is not None else base_config(env_file if env else None, **permissions)
        )
        config_path = tmp_path / "etc" / "config.json"
        config_path.parent.mkdir(exist_ok=True)
        config_path.write_text(json.dumps(data, indent=2))
        config_path.chmod(0o600)
        paths = Paths(
            config=config_path,
            state_dir=tmp_path / "state",
            hosts=tmp_path / "hosts",
            model_file=tmp_path / "model",
        )
        (tmp_path / "model").write_bytes(b"Raspberry Pi 4 Model B Rev 1.5\x00")
        system, wifi, hostname, timezone, systemd = fake_system()
        wifi.networks = [
            WifiNetwork("Home", 80, "wpa2", False),
            WifiNetwork("Cafe", 40, "open", False),
        ]
        wifi.passwords = {"Home": "home-password", "Cafe": ""}
        clock = Clock()
        sleeps: list[float] = []

        async def fake_sleep(seconds: float) -> None:
            sleeps.append(seconds)

        service = Service(
            load_config_file(config_path),
            paths,
            system,
            clock=clock,
            sleep=fake_sleep,
            store_group=None,
        )
        return World(tmp_path, paths, clock, service, wifi, hostname, timezone, systemd, sleeps)

    return make


@pytest.fixture
def world(make_world: MakeWorld) -> World:
    return make_world()
