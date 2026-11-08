"""Reading settings, and keeping the code in step with config-template/config.json."""

import json
import logging
from pathlib import Path
from typing import Any

import pytest
from pi_configurator_client import Store, StoreError

from sample_service.settings import ARTIST_NAME, AUTOSTART, COLOR, VOLUME, Color, Settings

from .support import write_store

TEMPLATE = Path(__file__).resolve().parents[3] / "config-template" / "config.json"


def template_items() -> dict[str, dict[str, Any]]:
    config = json.loads(TEMPLATE.read_text())
    group = next(g for g in config["appSettings"] if g["groupName"] == "Sample Service")
    return {item["key"]: item for item in group["items"]}


def test_matches_the_config_template() -> None:
    items = template_items()
    assert list(items) == [COLOR, VOLUME, AUTOSTART, ARTIST_NAME]
    assert [items[k]["type"] for k in items] == ["select", "integer", "boolean", "string"]
    assert [o["value"] for o in items[COLOR]["options"]] == [c.value for c in Color]
    # The built-in fallbacks are the file's defaults, so both give the same first start.
    fallback = Settings()
    assert items[COLOR]["default"] == fallback.color
    assert items[VOLUME]["default"] == fallback.volume
    assert items[AUTOSTART]["default"] == fallback.autostart
    assert items[ARTIST_NAME]["default"] == fallback.artist_name


def test_saved_values_win_over_defaults(tmp_path: Path) -> None:
    path = write_store(
        tmp_path,
        values={VOLUME: 75, ARTIST_NAME: "  Nina Simone "},
        defaults={COLOR: "blue", VOLUME: 40, AUTOSTART: False, ARTIST_NAME: ""},
    )
    assert Settings.load(Store(path, dbus=False)) == Settings(
        color=Color.BLUE, volume=75, autostart=False, artist_name="Nina Simone"
    )


def test_no_store_file_means_built_in_defaults(tmp_path: Path) -> None:
    assert Settings.load(Store(tmp_path / "missing.json", dbus=False)) == Settings()


def test_a_value_that_does_not_fit_falls_back(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    path = write_store(tmp_path, values={COLOR: "orange", VOLUME: "loud"})
    with caplog.at_level(logging.WARNING):
        settings = Settings.load(Store(path, dbus=False))
    assert (settings.color, settings.volume) == (Color.WARM_WHITE, 40)
    assert "color" in caplog.text and "volume" in caplog.text


def test_an_unreadable_store_is_an_error(tmp_path: Path) -> None:
    path = tmp_path / "values.json"
    path.write_text("not json")
    with pytest.raises(StoreError):
        Settings.load(Store(path, dbus=False))


def test_changes_from_names_the_changed_fields() -> None:
    before = Settings()
    after = Settings(volume=10, artist_name="Björk")
    assert after.changes_from(before) == ["volume", "artist_name"]
    assert before.changes_from(before) == []
