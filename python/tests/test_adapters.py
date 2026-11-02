"""Pure parts of the system adapters and the BLE layer (the D-Bus calls themselves need a Pi)."""

import asyncio
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from pi_configurator.ble.bridge import BleBridge, ChannelBusy
from pi_configurator.protocol.framing import FrameAssembler, split_message
from pi_configurator.system.commands import HOSTNAME_RE, Hostname, update_hosts_text
from pi_configurator.system.interfaces import AdapterError, WifiNetwork
from pi_configurator.system.networkmanager import (
    AP_FLAGS_PRIVACY,
    SEC_KEY_MGMT_802_1X,
    SEC_KEY_MGMT_PSK,
    SEC_KEY_MGMT_SAE,
    security_from_flags,
    strongest_per_ssid,
    wireless_settings,
)

from .conftest import World


def test_security_mapping() -> None:
    assert security_from_flags(0, 0, 0) == "open"
    assert security_from_flags(AP_FLAGS_PRIVACY, 0, 0) == "wep"
    assert security_from_flags(AP_FLAGS_PRIVACY, SEC_KEY_MGMT_PSK, 0) == "wpa"
    assert security_from_flags(AP_FLAGS_PRIVACY, SEC_KEY_MGMT_PSK, SEC_KEY_MGMT_PSK) == "wpa2"
    assert (
        security_from_flags(AP_FLAGS_PRIVACY, 0, SEC_KEY_MGMT_PSK | SEC_KEY_MGMT_SAE) == "wpa2"
    )  # transition
    assert security_from_flags(AP_FLAGS_PRIVACY, 0, SEC_KEY_MGMT_SAE) == "wpa3"
    assert security_from_flags(AP_FLAGS_PRIVACY, 0, SEC_KEY_MGMT_802_1X) == "enterprise"


def test_strongest_per_ssid() -> None:
    nets = [
        WifiNetwork("Home", 40, "wpa2", True),
        WifiNetwork("Home", 70, "wpa2", False),
        WifiNetwork("", 90, "open", False),
        WifiNetwork("Cafe", 55, "open", False),
    ]
    assert strongest_per_ssid(nets) == [
        WifiNetwork("Home", 70, "wpa2", True),
        WifiNetwork("Cafe", 55, "open", False),
    ]


def test_wireless_settings_shape() -> None:
    s = wireless_settings("Home", "secret-pass", True, "sae")
    assert s["802-11-wireless"]["ssid"].value == b"Home"
    assert s["802-11-wireless"]["hidden"].value is True
    assert s["802-11-wireless-security"]["key-mgmt"].value == "sae"
    assert "802-11-wireless-security" not in wireless_settings("Cafe", "", False, "wpa-psk")


def test_hosts_update() -> None:
    debian = "127.0.0.1\tlocalhost\n::1\t\tlocalhost ip6-localhost\n\n127.0.1.1\t\traspberrypi\n"
    out = update_hosts_text(debian, "ballspi")
    assert out == "127.0.0.1\tlocalhost\n::1\t\tlocalhost ip6-localhost\n\n127.0.1.1\tballspi\n"
    assert update_hosts_text("127.0.0.1 localhost\n", "x").endswith("127.0.1.1\tx\n")
    assert HOSTNAME_RE.match("ballspi-2")
    for bad in ("-a", "a-", "a b", "a\n", "a" * 64, ""):
        assert not HOSTNAME_RE.match(bad), bad


async def test_hostname_adapter_refuses_bad_names(tmp_path: Path) -> None:
    hosts = tmp_path / "hosts"
    hosts.write_text("127.0.1.1 old\n")
    with pytest.raises(AdapterError):
        await Hostname(hosts).set("bad name")
    assert hosts.read_text() == "127.0.1.1 old\n"


# --------------------------------------------------------------------------------------------
# BLE bridge
# --------------------------------------------------------------------------------------------


def test_info_long_read(world: World) -> None:
    bridge = BleBridge(world.service, lambda frame: None)
    full = bridge.read_info()
    assert json.loads(full)["name"] == "TestPi"
    assert bridge.read_info(20) == full[20:]


async def test_bridge_one_phone_at_a_time(world: World) -> None:
    sent: list[bytes] = []
    connected = {"/org/bluez/hci0/dev_A": True, "/org/bluez/hci0/dev_B": True}
    bridge = BleBridge(world.service, sent.append, lambda d: connected.get(d, False))
    request = json.dumps({"id": 1, "method": "settings.get"}).encode()

    for frame in split_message(request, False, 20):
        bridge.write("/org/bluez/hci0/dev_A", frame, mtu=23)
    await world.service.wait_background()
    for conn in world.service.connections:
        await conn.drain()
    assert all(len(f) <= 20 for f in sent)
    assembler = FrameAssembler()
    messages = [m for m in (assembler.push(f) for f in sent) if m is not None]
    assert json.loads(messages[0].payload)["error"]["code"] == "unauthenticated"

    with pytest.raises(ChannelBusy):
        bridge.write("/org/bluez/hci0/dev_B", b"\x03\x00\x00\x00\x00\x00", mtu=185)

    # A larger MTU from the owner raises its frame size.
    bridge.write("/org/bluez/hci0/dev_A", b"\x03\x00\x00\x00\x00\x00", mtu=185)
    assert next(iter(world.service.connections)).frame_size == 182

    # Once A is gone (even without the signal), B gets the channel.
    connected["/org/bluez/hci0/dev_A"] = False
    bridge.write("/org/bluez/hci0/dev_B", b"\x03\x00\x00\x00\x00\x00", mtu=None)
    assert bridge.owner == "/org/bluez/hci0/dev_B"
    assert len(world.service.connections) == 1
    bridge.disconnected("/org/bluez/hci0/dev_B")
    assert bridge.owner is None and not world.service.connections


def test_gatt_objects_build() -> None:
    """dbus-fast checks every method/property signature when the objects are created."""
    pytest.importorskip("dbus_fast")
    from pi_configurator.ble import bluez

    for iface in (
        bluez.GattService(),
        bluez.RpcOutCharacteristic(),
        bluez.Advertisement("TestPi"),
    ):
        xml = iface.introspect()
        assert xml.name.startswith("org.bluez.")
    rpc_out = bluez.RpcOutCharacteristic()
    names = {m.name for m in rpc_out.introspect().methods}
    assert names == {"StartNotify", "StopNotify"}
    props = {p.name: p.signature for p in rpc_out.introspect().properties}
    assert props == {"UUID": "s", "Service": "o", "Flags": "as", "Value": "ay", "Notifying": "b"}


def _dbus_fn(iface: object, member: str) -> Callable[..., Any]:
    """The undecorated method dbus-fast calls for `member` (the decorator drops its result)."""
    return getattr(type(iface), member).__dict__["__DBUS_METHOD"].fn


async def test_gatt_handlers(world: World) -> None:
    pytest.importorskip("dbus_fast")
    from dbus_fast import DBusError, Variant
    from pi_configurator.ble import bluez

    sent: list[bytes] = []
    bridge = BleBridge(world.service, sent.append)
    info = bluez.InfoCharacteristic(bridge)
    value = _dbus_fn(info, "ReadValue")(info, {"offset": Variant("q", 5)})
    assert value == bridge.read_info()[5:]

    rpc_in = bluez.RpcInCharacteristic(bridge)
    write = _dbus_fn(rpc_in, "WriteValue")
    frame = split_message(json.dumps({"id": 1, "method": "wifi.scan"}).encode(), False, 182)[0]
    write(
        rpc_in, frame, {"device": Variant("o", "/org/bluez/hci0/dev_A"), "mtu": Variant("q", 185)}
    )
    for conn in world.service.connections:
        await conn.drain()
    assert sent and json.loads(sent[0][6:])["error"]["code"] == "unauthenticated"
    with pytest.raises(DBusError):
        write(rpc_in, frame, {"device": Variant("o", "/org/bluez/hci0/dev_B")})
    with pytest.raises(DBusError):
        write(rpc_in, frame, {})  # no device
    with pytest.raises(DBusError):
        write(
            rpc_in,
            frame,
            {"device": Variant("o", "/org/bluez/hci0/dev_A"), "offset": Variant("q", 3)},
        )

    rpc_out = bluez.RpcOutCharacteristic()
    _dbus_fn(rpc_out, "StartNotify")(rpc_out)
    rpc_out.notify(b"frame-1")
    rpc_out.notify(b"frame-2")
    await asyncio.sleep(0.01)
    assert rpc_out._value == b"frame-2"  # pyright: ignore[reportPrivateUsage]
