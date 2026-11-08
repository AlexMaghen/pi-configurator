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
    wifi_value_error,
)
from pi_configurator.protocol.js_regex import js_test, translate
from pi_configurator.protocol.jsonutil import Json, JsonObject, js_length
from pi_configurator.protocol.values import describe_groups, validate_value

from .vectors import CONFIG_TEMPLATE, load_vector

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
    if case["field"]["type"] == "wifi":
        error = wifi_value_error(case["value"])
    else:
        error = validate_value(field_of(case["field"]), case["value"])
    assert (error is None) == case["ok"], error


def test_example_config_is_valid() -> None:
    config = load_config_file(CONFIG_TEMPLATE)
    assert config.name == "SampleDevice"
    assert config.permissions.allow_reboot
    assert config.system == ["wifi", "hostname", "timezone"]
    assert config.system_default("hostname") == "SampleDevice"
    # One item of each kind samples/sample-service reads; none restarts a unit (it listens).
    assert [f.type for f in config.fields] == ["select", "integer", "boolean", "string"]
    assert config.on_change["volume"] is None


def test_generated_aliases_match_types() -> None:
    expected = ["string", "integer", "number", "boolean", "select"]
    got = [get_args(cls.model_fields["type"].annotation)[0] for cls in FIELD_CLASSES]
    assert got == expected
    assert config_models.ConfigFile is not None


def test_nulls_and_bools_are_shape_errors() -> None:
    base = merged({"config": {}})

    def items(*entries: dict[str, Any]) -> dict[str, Any]:
        return {"appSettings": [{"groupName": "G", "items": list(entries)}]}

    for patch in (
        {"deviceSettings": None},
        {"deviceSettings": {"allowReboot": None}},
        {"version": True},
        items({"key": "a", "label": "A", "type": "string", "help": None}),
        items({"key": "a", "label": "A", "type": "integer", "default": True}),
        items({"key": "a", "label": "A", "type": "integer", "default": "5"}),
        {"bluetooth": {"name": "\u00e9" * 15}},  # 30 bytes
        {"deviceSettings": {"hostname": {"default": "a" * 64}}},
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
    f = field_of({"key": "s", "label": "S", "type": "string", "maxLength": 1})
    assert validate_value(f, "\U0001f600") is not None  # 2 code units, like JavaScript


def test_integer_accepts_integral_float() -> None:
    f = field_of({"key": "i", "label": "I", "type": "integer"})
    assert validate_value(f, 10.0) is None
    assert validate_value(f, float("nan")) is not None
    assert validate_value(f, float("inf")) is not None


def test_describe_groups_hides_secrets() -> None:
    secret: JsonObject = {
        "key": "k",
        "label": "K",
        "type": "string",
        "secret": True,
        "default": "x",
    }
    plain: JsonObject = {"key": "p", "label": "P", "type": "string", "default": "x"}
    groups: list[Json] = [{"groupName": "G", "help": "h", "items": [secret, plain]}]
    described = cast(list[JsonObject], describe_groups(groups))
    items = cast(list[JsonObject], described[0]["items"])
    assert "default" not in items[0]
    assert items[1] == plain
    assert described[0]["help"] == "h"
    assert "default" in secret  # the original is untouched
