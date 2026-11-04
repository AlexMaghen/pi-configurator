"""Store file, env-file export, first-start defaults, state file and the client Store."""

import stat
import threading
import time
from pathlib import Path

import pytest
from dotenv import dotenv_values
from pi_configurator.core.store import (
    ENV_BEGIN,
    ENV_END,
    EnvExport,
    StoreFile,
    env_value,
    merge_env_text,
)
from pi_configurator.protocol.jsonutil import Json
from pi_configurator_client import Store, StoreError

from .conftest import MakeWorld, World


@pytest.mark.parametrize(
    "value",
    [
        "plain",
        "",
        "with space",
        "it's",
        'say "hi"',
        "line1\nline2",
        "a=b",
        "$HOME",
        "back\\slash",
        "\u00fcn\u00efcode",
        "#hash",
    ],
)
def test_env_values_round_trip_through_python_dotenv(tmp_path: Path, value: str) -> None:
    env = tmp_path / ".env"
    EnvExport(env).write([("KEY", value), ("NUM", 5), ("ON", True), ("RATIO", 0.25)])
    assert dotenv_values(env) == {"KEY": value, "NUM": "5", "ON": "true", "RATIO": "0.25"}


def test_env_value_forms() -> None:
    assert env_value("abc") == "abc"
    assert env_value("a b") == "'a b'"
    assert env_value("it's") == '"it\'s"'
    assert env_value(False) == "false"
    assert env_value(800) == "800"


def test_env_block_keeps_other_lines(tmp_path: Path) -> None:
    env = tmp_path / ".env.production"
    env.write_text("# Production settings\nHK_HARDWARE=real\nBALLS_NAME=Ballsey\n")
    env.chmod(0o644)
    EnvExport(env).write([("BALLS_NAME", "Disco")])
    EnvExport(env).write([("BALLS_NAME", "Disco 2"), ("X", 1)])
    text = env.read_text()
    assert text.startswith("# Production settings\nHK_HARDWARE=real\nBALLS_NAME=Ballsey\n\n")
    assert text.count(ENV_BEGIN) == 1 and text.count(ENV_END) == 1
    assert dotenv_values(env) == {"HK_HARDWARE": "real", "BALLS_NAME": "Disco 2", "X": "1"}
    assert stat.S_IMODE(env.stat().st_mode) == 0o644  # mode kept


def test_new_env_file_is_private(tmp_path: Path) -> None:
    env = tmp_path / ".env"
    EnvExport(env).write([("K", "v")])
    assert stat.S_IMODE(env.stat().st_mode) == 0o600
    assert merge_env_text("", "x\n") == "x\n"


def test_corrupt_store_is_moved_aside(tmp_path: Path) -> None:
    path = tmp_path / "values.json"
    path.write_text("{oops")
    assert StoreFile(path, group=None).load_values() == {}
    assert not path.exists()
    assert len(list(tmp_path.glob("values.json.corrupt-*"))) == 1


async def test_startup_writes_defaults_and_keeps_saved(world: World) -> None:
    world.paths.store.parent.mkdir(parents=True, exist_ok=True)
    world.paths.store.write_text(
        '{"values": {"DISPENSE_MS": 1200, "OLD_KEY": "kept"}, "defaults": {}}'
    )
    world.service = type(world.service)(
        world.service.config, world.paths, world.service.system, store_group=None
    )
    await world.service.startup()
    assert world.store_json["values"] == {"DISPENSE_MS": 1200, "OLD_KEY": "kept"}
    assert world.store_json["defaults"]["DISPENSE_MS"] == 800
    env = dotenv_values(world.tmp / "app" / ".env.production")
    assert env == {"DISPENSE_MS": "1200", "STREAM_URL": "", "ENABLED": "true", "SERIAL": "X1"}


async def test_startup_survives_missing_env_dir(make_world: MakeWorld, tmp_path: Path) -> None:
    world = make_world()
    (tmp_path / "app").rmdir()
    await world.service.startup()  # logs a warning, doesn't fail
    assert world.paths.store.exists()


async def test_first_start_defaults_once(world: World) -> None:
    applied = await world.service.apply_first_start_defaults()
    assert applied == ["wifi", "hostname", "tz"]
    assert world.hostname.name == "testpi"
    assert world.timezone.zone == "America/Los_Angeles"
    assert world.wifi.connects == [("Home", "home-password", False)]
    assert world.service.state.first_start_defaults_applied
    state = world.service.state.load()
    assert state["firstStartDefaults"] == ["wifi", "hostname", "tz"]

    world.hostname.name = "raspberrypi"
    assert await world.service.apply_first_start_defaults() == []
    world.service.start_first_start_defaults()
    await world.service.wait_background()
    assert world.hostname.name == "raspberrypi"


async def test_first_start_defaults_respect_existing_system(world: World) -> None:
    world.hostname.name = "mypi"
    world.timezone.zone = "Europe/London"
    world.wifi.saved["Office"] = "office-pass"
    world.service.start_first_start_defaults()
    await world.service.wait_background()
    assert world.hostname.history == []
    assert world.timezone.history == []
    assert world.wifi.connects == []
    assert world.service.state.first_start_defaults_applied


# --------------------------------------------------------------------------------------------
# Client
# --------------------------------------------------------------------------------------------


async def test_client_reads_service_store(world: World) -> None:
    await world.service.startup()
    phone = await world.unlocked_phone()
    await phone.result("settings.set", {"values": {"DISPENSE_MS": 1500, "API_KEY": "k"}})
    store = Store(world.paths.store)
    assert store.get_int("DISPENSE_MS") == 1500
    assert store.is_saved("DISPENSE_MS")
    assert store.get_bool("ENABLED") is True
    assert not store.is_saved("ENABLED")
    assert store.get_str("API_KEY") == "k"
    assert store.get_str("STREAM_URL") == ""
    assert store.get_float("DISPENSE_MS") == 1500.0
    assert store.get("MISSING") is None
    assert store.get_int("MISSING", 7) == 7
    with pytest.raises(KeyError):
        store.get_str("MISSING")
    with pytest.raises(TypeError):
        store.get_int("API_KEY")
    with pytest.raises(TypeError):
        store.get_int("ENABLED")  # a bool is not an int here

    await phone.result("settings.set", {"values": {"DISPENSE_MS": None}})
    assert store.get_int("DISPENSE_MS") == 800  # back to the default, file re-read


def write_store(
    path: Path, values: dict[str, Json], defaults: dict[str, Json] | None = None
) -> None:
    StoreFile(path, group=None).write(values, defaults or {})


def test_client_missing_file_and_env_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "values.json"
    monkeypatch.setenv("PI_CONFIGURATOR_STORE", str(path))
    store = Store()
    assert store.path == path
    assert store.snapshot() == {}
    write_store(path, {"A": 1})
    assert store.get_int("A") == 1
    path.unlink()
    assert store.get("A") is None
    path.write_text("[]")
    with pytest.raises(StoreError):
        store.get("A")


def test_client_on_change(tmp_path: Path) -> None:
    path = tmp_path / "values.json"
    write_store(path, {"A": 1}, {"B": 2})
    store = Store(path, dbus=False)
    seen: list[set[str]] = []
    got = threading.Event()

    def listener(keys: set[str]) -> None:
        seen.append(keys)
        got.set()

    store.on_change(listener, interval_s=0.02)
    try:
        time.sleep(0.05)
        write_store(path, {"A": 1, "B": 3}, {"B": 2})
        assert got.wait(2)
        assert seen[0] == {"B"}
    finally:
        store.close()


def test_client_on_setting(tmp_path: Path) -> None:
    path = tmp_path / "values.json"
    write_store(path, {"A": 1}, {"B": 2})
    store = Store(path, dbus=False)
    seen: list[tuple[str, object, object]] = []
    got = threading.Event()

    @store.on_setting("B", interval_s=0.02)
    def b_updated(old: object, new: object) -> None:
        seen.append(("B", old, new))
        got.set()

    def broken(old: object, new: object) -> None:
        raise RuntimeError("listener bug")

    store.on_setting("C", broken)
    store.on_setting("A", lambda old, new: seen.append(("A", old, new)))
    try:
        time.sleep(0.05)
        write_store(path, {"A": 1, "B": 3, "C": 1}, {"B": 2})  # C's listener fails: logged only
        assert got.wait(2)
        assert seen == [("B", 2, 3)]
        got.clear()
        write_store(path, {"A": 1, "C": 1}, {})  # B gone entirely: new is None
        assert got.wait(2)
        assert seen == [("B", 2, 3), ("B", 3, None)]
    finally:
        store.close()


def test_client_wakes_on_signal(tmp_path: Path) -> None:
    """The D-Bus signal only sets the wake event; the store then re-reads at once."""
    path = tmp_path / "values.json"
    write_store(path, {"A": 1}, {})
    store = Store(path, dbus=False)
    got = threading.Event()
    store.on_change(lambda keys: got.set(), interval_s=60)
    try:
        time.sleep(0.05)
        write_store(path, {"A": 2}, {})
        assert not got.wait(0.2)  # a minute to the next poll
        store._wake.set()  # pyright: ignore[reportPrivateUsage]
        assert got.wait(2)
    finally:
        store.close()


def test_client_without_system_bus_still_polls(tmp_path: Path) -> None:
    """With dbus on (the default) and no system bus here, changes still arrive by polling."""
    path = tmp_path / "values.json"
    write_store(path, {"A": 1}, {})
    store = Store(path)
    got = threading.Event()
    store.on_change(lambda keys: got.set(), interval_s=0.02)
    try:
        time.sleep(0.05)
        write_store(path, {"A": 2}, {})
        assert got.wait(2)
    finally:
        store.close()


def test_dbus_names_match_the_service() -> None:
    from pi_configurator.system import settings_signal as service
    from pi_configurator_client import dbus_signal as client

    assert (client.OBJECT_PATH, client.INTERFACE) == (service.OBJECT_PATH, service.INTERFACE)
    assert client.MEMBER in service.SettingsInterface.__dict__
