"""Config rules and value checks against the shared config-cases.json and value-cases.json."""

import copy
from typing import Any, cast, get_args

import pytest
from pi_configurator.protocol import config_models
from pi_configurator.protocol.config import (
    FIELD_CLASSES,
    ConfigInvalid,
    load_config_file,
    parse_config,
)
from pi_configurator.protocol.js_regex import js_test, translate
from pi_configurator.protocol.jsonutil import JsonObject, js_length
from pi_configurator.protocol.values import describe_field, validate_value

from .vectors import EXAMPLES, load_vector

CONFIG = load_vector("config-cases.json")
VALUES = load_vector("value-cases.json")


def merged(case: dict[str, Any]) -> dict[str, Any]:
    out = copy.deepcopy(CONFIG["base"])
    out.update(copy.deepcopy(case["config"]))
    return out


@pytest.mark.parametrize("case", CONFIG["cases"], ids=lambda c: c["name"])
def test_config_cases(case: dict[str, Any]) -> None:
    data = merged(case)
    if case["outcome"] == "valid":
        parse_config(data)
        return
    with pytest.raises(ConfigInvalid) as caught:
        parse_config(data)
    codes = [i.code for i in caught.value.issues]
    if case["outcome"] == "shape":
        assert codes and all(c == "shape" for c in codes)
    else:
        assert codes == case["codes"]


def field_of(raw: dict[str, Any]) -> Any:
    for cls in FIELD_CLASSES:
        if get_args(cls.model_fields["type"].annotation)[0] == raw["type"]:
            return cls.model_validate(raw, strict=True)
    raise AssertionError(raw["type"])


@pytest.mark.parametrize(
    "case", VALUES["cases"], ids=lambda c: f"{c['field']['type']}:{c['value']!r}"
)
def test_value_cases(case: dict[str, Any]) -> None:
    error = validate_value(field_of(case["field"]), case["value"])
    assert (error is None) == case["ok"], error


def test_example_config_is_valid() -> None:
    config = load_config_file(EXAMPLES / "ballspi" / "config.json")
    assert config.name == "BallsPi"
    assert config.permissions.allow_reboot


def test_generated_aliases_match_types() -> None:
    expected = ["string", "integer", "number", "boolean", "select", "wifi"]
    got = [get_args(cls.model_fields["type"].annotation)[0] for cls in FIELD_CLASSES]
    assert got == expected
    assert config_models.ConfigFile is not None


def test_nulls_and_bools_are_shape_errors() -> None:
    base = merged({"config": {}})
    for patch in (
        {"permissions": None},
        {"permissions": {"allowReboot": None}},
        {"version": True},
        {
            "settings": [
                {
                    "key": "a",
                    "label": "A",
                    "type": "string",
                    "group": None,
                    "target": {"store": True},
                }
            ]
        },
        {
            "settings": [
                {
                    "key": "a",
                    "label": "A",
                    "type": "integer",
                    "default": True,
                    "target": {"store": True},
                }
            ]
        },
        {
            "settings": [
                {
                    "key": "a",
                    "label": "A",
                    "type": "integer",
                    "default": "5",
                    "target": {"store": True},
                }
            ]
        },
        {"bluetooth": {"name": "\u00e9" * 15}},  # 30 bytes
        {
            "settings": [
                {
                    "key": "w",
                    "label": "W",
                    "type": "wifi",
                    "target": {"system": "wifi"},
                    "default": {"ssid": "x" * 33},
                }
            ]
        },
    ):
        data = cast(JsonObject, {**base, **patch})
        with pytest.raises(ConfigInvalid) as caught:
            parse_config(data)
        assert {i.code for i in caught.value.issues} == {"shape"}, patch


def test_js_regex_translation() -> None:
    # `$` means end of input in JavaScript, not "before a trailing newline".
    assert js_test("^[a-z]+$", "abc")
    assert not js_test("^[a-z]+$", "abc\n")
    assert js_test("[$]", "a$b")  # inside a class it's a literal
    assert js_test(r"\$", "$")
    assert not js_test(
        r"^\d+$", "\u0661\u0662\u0663"
    )  # Arabic-Indic digits: \d is ASCII-only in JS
    assert translate("(?<year>[0-9]{4})-\\k<year>") == "(?P<year>[0-9]{4})-(?P=year)"
    assert translate("(?<=a)b(?<!c)") == "(?<=a)b(?<!c)"


def test_js_length_counts_utf16() -> None:
    assert js_length("abc") == 3
    assert js_length("\U0001f600") == 2
    f = field_of(
        {"key": "s", "label": "S", "type": "string", "maxLength": 1, "target": {"store": True}}
    )
    assert validate_value(f, "\U0001f600") is not None  # 2 code units, like JavaScript


def test_integer_accepts_integral_float() -> None:
    f = field_of({"key": "i", "label": "I", "type": "integer", "target": {"store": True}})
    assert validate_value(f, 10.0) is None
    assert validate_value(f, float("nan")) is not None
    assert validate_value(f, float("inf")) is not None


def test_describe_field_hides_secrets() -> None:
    secret: JsonObject = {
        "key": "k",
        "label": "K",
        "type": "string",
        "secret": True,
        "default": "x",
        "target": {"store": True},
    }
    assert "default" not in describe_field(secret)
    wifi: JsonObject = {
        "key": "w",
        "label": "W",
        "type": "wifi",
        "target": {"system": "wifi"},
        "default": {"ssid": "a", "password": "12345678"},
    }
    assert describe_field(wifi)["default"] == {"ssid": "a"}
    assert wifi["default"] == {"ssid": "a", "password": "12345678"}  # the original is untouched
    plain: JsonObject = {
        "key": "p",
        "label": "P",
        "type": "string",
        "default": "x",
        "target": {"store": True},
    }
    assert describe_field(plain) == plain
