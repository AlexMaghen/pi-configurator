"""The service end to end, through frames: handshake, describe, get, set, status events."""

import asyncio
import json
import stat

from pi_configurator.protocol.gatt import SESSION_IDLE_TIMEOUT_S
from pi_configurator.system.interfaces import WifiConnectResult

from .conftest import PASSWORD, MakeWorld, World


async def test_full_flow(world: World) -> None:
    await world.service.startup()
    info = world.service.device_info().to_json()
    assert info == {
        "protocol": 1,
        "name": "TestPi",
        "model": "Raspberry Pi 4 Model B Rev 1.5",
        "serviceVersion": "0.1.0",
    }

    phone = world.phone()
    finish = await phone.unlock(PASSWORD)
    assert finish["result"]["idleTimeoutS"] == SESSION_IDLE_TIMEOUT_S
    assert finish["_encrypted"] is False

    described = await phone.result("settings.describe")
    fields = {f["key"]: f for f in described["fields"]}
    assert described["permissions"] == {"allowReboot": False, "allowAccessChanges": False}
    assert [f["key"] for f in described["fields"]][:3] == ["wifi", "hostname", "tz"]
    assert "password" not in fields["wifi"]["default"]
    assert fields["tz"]["options"][0] == {
        "value": "America/Los_Angeles",
        "label": "America/Los Angeles",
    }
    assert "default" not in fields["API_KEY"]

    values = (await phone.result("settings.get"))["values"]
    assert values["DISPENSE_MS"] == {"secret": False, "value": 800, "source": "default"}
    assert values["API_KEY"] == {"secret": True, "set": False, "source": "none"}
    assert values["hostname"] == {"secret": False, "value": "raspberrypi", "source": "system"}
    assert values["tz"] == {"secret": False, "value": "Etc/UTC", "source": "system"}
    assert values["wifi"] == {"secret": False, "value": None, "source": "none"}

    phone.events.clear()
    result = await phone.result(
        "settings.set",
        {
            "values": {
                "DISPENSE_MS": 1000,
                "STREAM_URL": "https://example.com/live",
                "API_KEY": "s3cret value",
                "hostname": "ballspi",
                "tz": "America/New_York",
                "wifi": {"ssid": "Home", "password": "home-password"},
            }
        },
    )
    assert all(r == {"ok": True} for r in result["results"].values()), result
    assert result["restarted"] == ["app.service", "other.service"]
    assert world.systemd.restarted == ["app.service", "other.service"]  # once each
    kinds = [e["kind"] for e in phone.events]
    assert kinds == [
        "hostname.changed",
        "timezone.changed",
        "wifi.connecting",
        "wifi.connected",
        "store.saved",
        "service.restarting",
        "service.restarted",
        "service.restarting",
        "service.restarted",
    ]
    assert all(e["_encrypted"] for e in phone.events)
    assert "192.168.1.40" in phone.events[3]["message"]

    assert world.hostname.name == "ballspi"
    assert world.timezone.zone == "America/New_York"
    store = world.store_json
    assert store["values"] == {
        "DISPENSE_MS": 1000,
        "STREAM_URL": "https://example.com/live",
        "API_KEY": "s3cret value",
    }
    assert store["defaults"] == {
        "DISPENSE_MS": 800,
        "STREAM_URL": "",
        "ENABLED": True,
        "SERIAL": "X1",
    }
    assert stat.S_IMODE(world.paths.store.stat().st_mode) == 0o640

    env = (world.tmp / "app" / ".env.production").read_text()
    assert "DISPENSE_MS=1000\n" in env
    assert "API_KEY='s3cret value'\n" in env
    assert "ENABLED=true\n" in env

    values = (await phone.result("settings.get", {"keys": ["DISPENSE_MS", "API_KEY", "wifi"]}))[
        "values"
    ]
    assert values["DISPENSE_MS"]["source"] == "saved"
    assert values["API_KEY"] == {"secret": True, "set": True, "source": "saved"}
    assert values["wifi"]["value"]["ssid"] == "Home"
    assert values["wifi"]["value"]["connected"] is True

    networks = (await phone.result("wifi.scan"))["networks"]
    assert [n["ssid"] for n in networks] == ["Home", "Cafe"]


async def test_small_frames_carry_large_messages(world: World) -> None:
    world.timezone.zones = [f"Area/City_{i:03d}" for i in range(400)]
    phone = await world.unlocked_phone(frame_size=20)
    described = await phone.result("settings.describe")
    tz = next(f for f in described["fields"] if f["key"] == "tz")
    assert len(tz["options"]) == 400
    assert phone.frames_in > 500


async def test_set_validates_everything_first(world: World) -> None:
    await world.service.startup()
    phone = await world.unlocked_phone()
    error = await phone.error(
        "settings.set",
        {
            "values": {
                "DISPENSE_MS": 1010,  # off step
                "STREAM_URL": "not a url",
                "nope": 1,
                "hostname": None,
                "SERIAL": "Y",
                "ENABLED": False,  # fine on its own, but nothing may be saved
                "tz": "Mars/Olympus",
            }
        },
    )
    assert error["code"] == "invalid_params"
    assert set(error["details"]) == {
        "DISPENSE_MS",
        "STREAM_URL",
        "nope",
        "hostname",
        "SERIAL",
        "tz",
    }
    assert world.store_json["values"] == {}
    assert world.systemd.restarted == []


async def test_hostname_with_newline_is_refused(world: World) -> None:
    phone = await world.unlocked_phone()
    error = await phone.error("settings.set", {"values": {"hostname": "evil\n"}})
    assert error["code"] == "invalid_params"
    assert world.hostname.history == []


async def test_null_resets_store_field(world: World) -> None:
    phone = await world.unlocked_phone()
    await phone.result("settings.set", {"values": {"DISPENSE_MS": 1500}})
    world.systemd.restarted.clear()
    result = await phone.result("settings.set", {"values": {"DISPENSE_MS": None}})
    assert result["results"] == {"DISPENSE_MS": {"ok": True}}
    assert result["restarted"] == ["app.service"]
    assert "DISPENSE_MS" not in world.store_json["values"]
    values = (await phone.result("settings.get", {"keys": ["DISPENSE_MS"]}))["values"]
    assert values["DISPENSE_MS"] == {"secret": False, "value": 800, "source": "default"}

    # Resetting a key that was never saved changes nothing, so nothing restarts.
    world.systemd.restarted.clear()
    result = await phone.result("settings.set", {"values": {"DISPENSE_MS": None}})
    assert result["restarted"] == []


async def test_integral_float_is_saved_as_int(world: World) -> None:
    phone = await world.unlocked_phone()
    await phone.result("settings.set", {"values": {"DISPENSE_MS": 900.0}})
    assert world.store_json["values"]["DISPENSE_MS"] == 900
    assert isinstance(world.store_json["values"]["DISPENSE_MS"], int)


async def test_wifi_failure_and_restart_failure(world: World) -> None:
    phone = await world.unlocked_phone()
    world.systemd.failing = {"app.service"}
    result = await phone.result(
        "settings.set",
        {"values": {"wifi": {"ssid": "Home", "password": "wrong-password"}, "DISPENSE_MS": 300}},
    )
    assert result["results"]["wifi"]["ok"] is False
    assert result["results"]["DISPENSE_MS"] == {"ok": True}
    assert result["restarted"] == []
    kinds = [e["kind"] for e in phone.events]
    assert "wifi.failed" in kinds
    assert "service.failed" in kinds


async def test_wifi_open_network_and_saved_profile(world: World) -> None:
    phone = await world.unlocked_phone()
    result = await phone.result("settings.set", {"values": {"wifi": {"ssid": "Cafe"}}})
    assert result["results"]["wifi"] == {"ok": True}
    # Re-joining a saved network without a password reuses its secret.
    world.wifi.saved["Home"] = "home-password"
    result = await phone.result(
        "settings.set", {"values": {"wifi": {"ssid": "Home", "hidden": True}}}
    )
    assert result["results"]["wifi"] == {"ok": True}
    assert world.wifi.connects[-1] == ("Home", None, True)


async def test_busy_while_applying(world: World) -> None:
    phone = await world.unlocked_phone()
    gate = asyncio.Event()
    original = world.wifi.connect

    async def slow_connect(ssid: str, password: str | None, hidden: bool) -> WifiConnectResult:
        await gate.wait()
        return await original(ssid, password, hidden)

    world.wifi.connect = slow_connect
    first = phone.send(
        "settings.set", {"values": {"wifi": {"ssid": "Home", "password": "home-password"}}}
    )
    for _ in range(5):
        await asyncio.sleep(0)
    other = phone.send("settings.set", {"values": {"DISPENSE_MS": 300}})
    for _ in range(5):
        await asyncio.sleep(0)
    # Reads still work while a change is being applied.
    reading = phone.send("settings.get", {"keys": ["DISPENSE_MS"]})
    for _ in range(5):
        await asyncio.sleep(0)
    gate.set()
    await phone.conn.drain()
    replies = {m["id"]: m for m in phone.inbox}
    assert replies[other]["error"]["code"] == "busy"
    assert "result" in replies[reading]
    assert replies[first]["result"]["results"]["wifi"] == {"ok": True}


async def test_permissions_off(world: World) -> None:
    phone = await world.unlocked_phone()
    for method, params in (
        ("system.reboot", {}),
        ("access.setPassword", {"password": "new-password-1"}),
        ("access.setName", {"name": "Other"}),
    ):
        assert (await phone.error(method, params))["code"] == "forbidden"
    assert world.systemd.reboots == 0


async def test_reboot(make_world: MakeWorld) -> None:
    world = make_world(allowReboot=True)
    phone = await world.unlocked_phone()
    assert await phone.result("system.reboot", {}) == {"rebooting": True}
    assert phone.events[-1]["kind"] == "system.rebooting"
    await world.service.wait_background()
    assert world.systemd.reboots == 1
    assert 1 in world.sleeps


async def test_set_password(make_world: MakeWorld) -> None:
    world = make_world(allowAccessChanges=True)
    before = json.loads(world.paths.config.read_text())
    phone = await world.unlocked_phone()
    bystander = await world.unlocked_phone()
    assert await phone.result("access.setPassword", {"password": "brand-new-pass"}) == {}

    after = json.loads(world.paths.config.read_text())
    assert after["access"]["password"] == "brand-new-pass"
    before["access"]["password"] = "brand-new-pass"
    assert after == before  # everything else kept
    assert stat.S_IMODE(world.paths.config.stat().st_mode) == 0o600

    assert bystander.events[-1]["kind"] == "session.ending"
    assert bystander.session is None
    assert (await bystander.error("settings.get", {}, encrypt=False))["code"] == "unauthenticated"
    # The changing phone keeps its session.
    assert "values" in await phone.result("settings.get", {"keys": ["ENABLED"]})

    assert (await world.phone().unlock(PASSWORD))["error"]["code"] == "auth_failed"
    assert "result" in await world.phone().unlock("brand-new-pass")


async def test_set_name(make_world: MakeWorld) -> None:
    world = make_world(allowAccessChanges=True)
    renamed: list[str] = []

    async def on_name(name: str) -> None:
        renamed.append(name)

    world.service.on_name_changed = on_name
    phone = await world.unlocked_phone()
    assert (await phone.error("access.setName", {"name": "x" * 30}))["code"] == "invalid_params"
    assert await phone.result("access.setName", {"name": "KitchenPi"}) == {}
    assert renamed == ["KitchenPi"]
    assert json.loads(world.paths.config.read_text())["bluetooth"]["name"] == "KitchenPi"
    assert world.service.device_info().name == "KitchenPi"
    # The session survives a rename.
    assert "fields" in await phone.result("settings.describe")


async def test_unauthenticated_requests(world: World) -> None:
    phone = world.phone()
    for method in (
        "settings.describe",
        "settings.get",
        "settings.set",
        "wifi.scan",
        "system.reboot",
    ):
        assert (await phone.error(method, {}))["code"] == "unauthenticated"
    # An encrypted message with no session.
    phone.send_raw(b"\x00" * 40, encrypted=True)
    await phone.conn.drain()
    assert phone.inbox.pop()["error"]["code"] == "unauthenticated"


async def test_auth_finish_without_start(world: World) -> None:
    phone = world.phone()
    assert (await phone.error("auth.finish", {"M1": "AAAA"}))["code"] == "bad_request"
    assert (await phone.error("auth.start", {"A": "!!"}))["code"] == "invalid_params"
    assert (await phone.error("auth.start", {"A": "AAAA"}))["code"] == "invalid_params"  # A = 0


async def test_bad_envelopes(world: World) -> None:
    phone = world.phone()
    phone.send_raw(b"{not json", encrypted=False)
    phone.send_raw(b"[1,2]", encrypted=False)
    phone.send_raw(json.dumps({"id": 0, "method": "auth.start"}).encode(), encrypted=False)
    phone.send_raw(json.dumps({"id": True, "method": "auth.start"}).encode(), encrypted=False)
    phone.send_raw(json.dumps({"id": 5, "method": "shell.exec"}).encode(), encrypted=False)
    phone.send_raw(
        json.dumps({"id": 6, "method": "auth.start", "params": []}).encode(), encrypted=False
    )
    phone.send_raw(
        json.dumps({"id": 7, "method": "auth.start", "params": {"A": "AA", "x": 1}}).encode(),
        encrypted=False,
    )
    await phone.conn.drain()
    codes = [(m["id"], m["error"]["code"]) for m in phone.inbox]
    assert codes == [
        (0, "bad_request"),
        (0, "bad_request"),
        (0, "bad_request"),
        (0, "bad_request"),
        (5, "unknown_method"),
        (6, "bad_request"),
        (7, "invalid_params"),
    ]


async def test_garbled_frame_ends_session(world: World) -> None:
    phone = await world.unlocked_phone()
    phone.conn.receive(bytes([0x00, 0x05]) + b"junk")  # continuation without a first frame
    assert phone.events[-1]["kind"] == "session.ending"
    assert not phone.conn.unlocked


async def test_decrypt_failure_ends_session(world: World) -> None:
    phone = await world.unlocked_phone()
    assert phone.session is not None
    phone.session.send.seal(b"skipped")  # phone's counter moves on; the Pi's doesn't
    phone.send("settings.get", {})
    await phone.conn.drain()
    assert phone.events[-1]["kind"] == "session.ending"
    assert not phone.conn.unlocked


async def test_plain_auth_start_replaces_session(world: World) -> None:
    phone = await world.unlocked_phone()
    assert phone.conn.unlocked
    finish = await phone.unlock(PASSWORD)
    assert "result" in finish
    assert "values" in await phone.result("settings.get", {"keys": ["ENABLED"]})


async def test_encrypted_auth_is_refused(world: World) -> None:
    phone = await world.unlocked_phone()
    assert (await phone.error("auth.start", {"A": "AAAA"}, encrypt=True))["code"] == "bad_request"


async def test_disconnect_forgets_connection(world: World) -> None:
    phone = await world.unlocked_phone()
    world.service.disconnect(phone.conn)
    assert phone.conn not in world.service.connections
    assert not phone.conn.unlocked
    phone.conn.receive(b"\x03\x00\x00\x00\x00\x00")  # ignored after close
    assert phone.inbox == []


async def test_device_details(world: World) -> None:
    phone = await world.unlocked_phone()
    # No collector in the test world: only the service's own section (checked against the
    # schema by the phone).
    report = await phone.result("system.details", {})
    assert [s["title"] for s in report["sections"]] == ["pi-configurator"]
    assert {"label": "Bluetooth name", "value": world.service.config.name} in report["sections"][0][
        "items"
    ]
    locked = world.phone()
    assert (await locked.error("system.details", {}))["code"] == "unauthenticated"
