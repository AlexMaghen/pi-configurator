"""The command line: check, fields-from-pydantic, and the generated models being current."""

import io
import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Literal, cast

import pytest
from pi_configurator.cli import main
from pi_configurator.protocol.config import parse_config
from pi_configurator.protocol.jsonutil import JsonObject
from pi_configurator.pydantic_fields import fields_from_model
from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from .vectors import CONFIG_TEMPLATE

PYTHON_ROOT = Path(__file__).resolve().parents[1]


def test_check_example(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["check", str(CONFIG_TEMPLATE)]) == 0
    assert "OK (12 settings" in capsys.readouterr().out


def test_check_reports_codes(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    bad = {
        "version": 1,
        "bluetooth": {"name": "X"},
        "access": {"password": "p"},
        "settings": [
            {
                "key": "a",
                "label": "A",
                "type": "integer",
                "min": 5,
                "max": 1,
                "target": {"store": True},
            },
            {"key": "a", "label": "A", "type": "string", "target": {"store": True}},
        ],
    }
    path = tmp_path / "config.json"
    path.write_text(json.dumps(bad))
    assert main(["check", str(path)]) == 2
    err = capsys.readouterr().err
    assert "[min_above_max]" in err and "[duplicate_key]" in err
    assert "settings.1.key" in err

    path.write_text("{")
    assert main(["check", str(path)]) == 2
    assert main(["check", str(tmp_path / "missing.json")]) == 2


class DemoSettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="BALLS_", extra="ignore")

    name: str = "Ballsey"
    port: int = Field(51826, ge=1024, le=65535, description="HomeKit port")
    open_finish_seconds: float = 20
    home_on_start: bool = True
    pincode: str | None = None
    button_gpio: int | None = 26
    mode: Literal["auto", "manual"] = "auto"
    api_key: SecretStr = SecretStr("")
    tags: list[str] = []


def test_fields_from_pydantic() -> None:
    entries, skipped = fields_from_model(DemoSettings, group="Balls", restart=["balls.service"])
    assert skipped == ["tags"]
    objs = [cast(dict[str, Any], e) for e in entries]
    by_key = {e["key"]: e for e in objs}
    assert list(by_key) == [
        "BALLS_NAME",
        "BALLS_PORT",
        "BALLS_OPEN_FINISH_SECONDS",
        "BALLS_HOME_ON_START",
        "BALLS_PINCODE",
        "BALLS_BUTTON_GPIO",
        "BALLS_MODE",
        "BALLS_API_KEY",
    ]
    assert by_key["BALLS_PORT"] == {
        "key": "BALLS_PORT",
        "label": "Port",
        "help": "HomeKit port",
        "type": "integer",
        "min": 1024,
        "max": 65535,
        "default": 51826,
        "target": {"store": True},
        "group": "Balls",
        "onChange": {"restart": ["balls.service"]},
    }
    assert by_key["BALLS_API_KEY"]["secret"] is True
    assert by_key["BALLS_MODE"]["options"][1] == {"value": "manual", "label": "Manual"}
    assert "default" not in by_key["BALLS_PINCODE"]
    # The output is a valid config, env export included.
    config: JsonObject = {
        "version": 1,
        "bluetooth": {"name": "X"},
        "access": {"password": "p"},
        "export": {"envFile": "/tmp/x.env"},
        "settings": entries,
    }
    parse_config(config)


def test_fields_from_pydantic_command(capsys: pytest.CaptureFixture[str]) -> None:
    assert main(["fields-from-pydantic", "tests.test_cli:DemoSettings"]) == 0
    out = capsys.readouterr()
    assert json.loads(out.out)[0]["key"] == "BALLS_NAME"
    assert "skipped tags" in out.err


def test_generated_models_are_current() -> None:
    result = subprocess.run(
        [sys.executable, str(PYTHON_ROOT / "scripts" / "generate_models.py"), "--check"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr


def _copy_template(tmp_path: Path) -> Path:
    path = tmp_path / "config.json"
    path.write_bytes(CONFIG_TEMPLATE.read_bytes())
    path.chmod(0o600)
    return path


def test_set_access_name_and_password(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    path = _copy_template(tmp_path)
    monkeypatch.setattr("sys.stdin", io.StringIO("a-new-password\n"))
    assert main(["set-access", str(path), "--name", "Kitchen Pi", "--password-stdin"]) == 0
    data = json.loads(path.read_text())
    assert data["bluetooth"]["name"] == "Kitchen Pi"
    assert data["access"]["password"] == "a-new-password"
    assert len(data["settings"]) == 12  # the rest of the file is kept
    assert "saved" in capsys.readouterr().out


def test_set_access_interactive(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = _copy_template(tmp_path)
    answers = iter(["short", "long-enough-1", "long-enough-1"])

    def keep_current_name(_prompt: str) -> str:
        return ""

    def next_password(_prompt: str) -> str:
        return next(answers)

    monkeypatch.setattr("builtins.input", keep_current_name)
    monkeypatch.setattr("getpass.getpass", next_password)
    assert main(["set-access", str(path)]) == 0
    data = json.loads(path.read_text())
    assert data["bluetooth"]["name"] == "BallsPi"
    assert data["access"]["password"] == "long-enough-1"


def test_set_access_refuses_bad_values(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = _copy_template(tmp_path)
    before = path.read_bytes()
    monkeypatch.setattr("sys.stdin", io.StringIO("short\n"))
    assert main(["set-access", str(path), "--password-stdin"]) == 2
    assert main(["set-access", str(path), "--name", "x" * 30]) == 2  # over 29 bytes
    assert path.read_bytes() == before
