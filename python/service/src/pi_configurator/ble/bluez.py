"""The BlueZ GATT server: one service with info / rpc-in / rpc-out (gatt.ts), plus advertising.

Linux only; needs BlueZ 5.6x+ (Pi OS Trixie ships 5.8x) and the system D-Bus. Built directly on
dbus-fast rather than bluez-peripheral: we need the per-write `device` and `mtu` options BlueZ
passes, control over notifications, and the same D-Bus library the NetworkManager adapter
uses, and the GATT side is only three characteristics.

NOT RUN ON A REAL PI YET. Spots that depend on BlueZ behaviour I could not test are marked
"VERIFY ON PI":
  - the `mtu` option in WriteValue (BlueZ >= 5.62; we fall back to the 20-byte minimum);
  - how BlueZ splits a 29-byte LocalName plus the 128-bit UUID between advertising data and
    scan response;
  - pacing of long notification bursts (a full timezone list is ~100 frames at MTU 185).
"""

import asyncio
import logging
from typing import Annotated, Any, Final

from dbus_fast import BusType, DBusError, Message, MessageType, Variant
from dbus_fast.aio import MessageBus
from dbus_fast.annotations import DBusBool, DBusObjectPath, DBusSignature, DBusStr
from dbus_fast.constants import PropertyAccess
from dbus_fast.service import ServiceInterface, dbus_method, dbus_property

from ..core.service import Service
from ..protocol.gatt import INFO_UUID, RPC_IN_UUID, RPC_OUT_UUID, SERVICE_UUID
from .bridge import BleBridge, ChannelBusy

log = logging.getLogger(__name__)

BLUEZ: Final = "org.bluez"
# The advertisement lives outside the GATT application's subtree, so the GetManagedObjects
# answer BlueZ asks for during RegisterApplication lists only GATT objects.
APP_PATH: Final = "/org/piconfigurator/gatt"
SERVICE_PATH: Final = f"{APP_PATH}/service0"
ADVERT_PATH: Final = "/org/piconfigurator/advertisement0"

Options = Annotated[dict[str, Variant], DBusSignature("a{sv}")]
Bytes = Annotated[bytes, DBusSignature("ay")]
StrList = Annotated[list[str], DBusSignature("as")]

#: Frames sent before yielding to the event loop, so a long reply doesn't starve other work.
NOTIFY_BURST: Final = 8


def _option(options: dict[str, Variant], name: str) -> Any:
    v = options.get(name)
    return None if v is None else v.value


class GattService(ServiceInterface):
    def __init__(self) -> None:
        super().__init__("org.bluez.GattService1")

    @dbus_property(access=PropertyAccess.READ)
    def UUID(self) -> DBusStr:
        return SERVICE_UUID

    @dbus_property(access=PropertyAccess.READ)
    def Primary(self) -> DBusBool:
        return True


class _Characteristic(ServiceInterface):
    def __init__(self, uuid: str, flags: list[str]) -> None:
        super().__init__("org.bluez.GattCharacteristic1")
        self._uuid = uuid
        self._flags = flags

    @dbus_property(access=PropertyAccess.READ)
    def UUID(self) -> DBusStr:
        return self._uuid

    @dbus_property(access=PropertyAccess.READ)
    def Service(self) -> DBusObjectPath:
        return SERVICE_PATH

    @dbus_property(access=PropertyAccess.READ)
    def Flags(self) -> StrList:
        return self._flags


class InfoCharacteristic(_Characteristic):
    def __init__(self, bridge: BleBridge) -> None:
        super().__init__(INFO_UUID, ["read"])
        self._bridge = bridge

    @dbus_method()
    def ReadValue(self, options: Options) -> Bytes:
        offset = _option(options, "offset") or 0
        return self._bridge.read_info(int(offset))


class RpcInCharacteristic(_Characteristic):
    def __init__(self, bridge: BleBridge) -> None:
        super().__init__(RPC_IN_UUID, ["write"])
        self._bridge = bridge

    @dbus_method()
    def WriteValue(self, value: Bytes, options: Options) -> None:
        device = _option(options, "device")
        mtu = _option(options, "mtu")  # VERIFY ON PI: present since BlueZ 5.62
        if _option(options, "offset"):
            # Frames always fit one ATT write, so a prepared (long) write is a client bug.
            raise DBusError("org.bluez.Error.InvalidOffset", "long writes are not supported")
        if device is None:
            raise DBusError("org.bluez.Error.Failed", "no device in write options")
        try:
            self._bridge.write(str(device), bytes(value), int(mtu) if mtu is not None else None)
        except ChannelBusy as err:
            raise DBusError("org.bluez.Error.NotPermitted", f"busy: {err}") from err


class RpcOutCharacteristic(_Characteristic):
    """Notify-only. Each frame is sent by changing the Value property (PropertiesChanged)."""

    def __init__(self) -> None:
        super().__init__(RPC_OUT_UUID, ["notify"])
        self._value = b""
        self._notifying = False
        self._queue: asyncio.Queue[bytes] = asyncio.Queue()
        self._sender: asyncio.Task[None] | None = None

    @dbus_property(access=PropertyAccess.READ)
    def Value(self) -> Bytes:
        return self._value

    @dbus_property(access=PropertyAccess.READ)
    def Notifying(self) -> DBusBool:
        return self._notifying

    @dbus_method()
    def StartNotify(self) -> None:
        self._notifying = True
        self.emit_properties_changed({"Notifying": True})

    @dbus_method()
    def StopNotify(self) -> None:
        self._notifying = False
        self.emit_properties_changed({"Notifying": False})

    def notify(self, frame: bytes) -> None:
        """Queues a frame; the sender task emits them in order."""
        if self._sender is None or self._sender.done():
            self._sender = asyncio.get_running_loop().create_task(self._send_loop())
        self._queue.put_nowait(frame)

    async def _send_loop(self) -> None:
        sent = 0
        while True:
            frame = await self._queue.get()
            if not self._notifying:
                log.warning("dropping a frame: the phone hasn't subscribed to rpc-out")
                continue
            self._value = frame
            self.emit_properties_changed({"Value": frame})
            sent += 1
            if sent % NOTIFY_BURST == 0 or self._queue.empty():
                await asyncio.sleep(0)  # VERIFY ON PI: may need a real delay for long bursts


class Advertisement(ServiceInterface):
    def __init__(self, name: str) -> None:
        super().__init__("org.bluez.LEAdvertisement1")
        # Not `self.name`: ServiceInterface uses that for the D-Bus interface name.
        self._local_name = name

    @dbus_property(access=PropertyAccess.READ)
    def Type(self) -> DBusStr:
        return "peripheral"

    @dbus_property(access=PropertyAccess.READ)
    def ServiceUUIDs(self) -> StrList:
        return [SERVICE_UUID]

    @dbus_property(access=PropertyAccess.READ)
    def LocalName(self) -> DBusStr:
        # VERIFY ON PI: 3 (flags) + 18 (UUID) leaves 10 bytes in the advertising data; BlueZ is
        # expected to put a longer name in the scan response.
        return self._local_name

    @dbus_property(access=PropertyAccess.READ)
    def Discoverable(self) -> DBusBool:
        return True

    @dbus_method()
    def Release(self) -> None:
        log.info("BlueZ released the advertisement")


class BluezServer:
    def __init__(self, service: Service) -> None:
        self._service = service
        self._bus: MessageBus | None = None
        self._adapter = ""
        self._connected: dict[str, bool] = {}
        self._rpc_out = RpcOutCharacteristic()
        self.bridge = BleBridge(service, self._rpc_out.notify, self._device_connected)
        self._advert = Advertisement(service.config.name)

    async def _call(
        self,
        path: str,
        interface: str,
        member: str,
        signature: str = "",
        body: list[Any] | None = None,
    ) -> list[Any]:
        assert self._bus is not None
        reply = await self._bus.call(
            Message(
                destination=BLUEZ,
                path=path,
                interface=interface,
                member=member,
                signature=signature,
                body=body or [],
            )
        )
        if reply.message_type == MessageType.ERROR:
            raise RuntimeError(f"{interface}.{member}: {reply.error_name} {reply.body}")
        return list(reply.body)

    async def _find_adapter(self) -> str:
        (objects,) = await self._call(
            "/", "org.freedesktop.DBus.ObjectManager", "GetManagedObjects"
        )
        for path, interfaces in objects.items():
            if (
                "org.bluez.GattManager1" in interfaces
                and "org.bluez.LEAdvertisingManager1" in interfaces
            ):
                return str(path)
        raise RuntimeError("no Bluetooth adapter with GATT server and LE advertising support")

    def _device_connected(self, device: str) -> bool:
        return self._connected.get(device, True)

    def _on_message(self, msg: Message) -> bool:
        """Follows Device1.Connected so a phone that goes away releases the channel."""
        path = msg.path
        if msg.message_type != MessageType.SIGNAL or not path:
            return False
        if not path.startswith(self._adapter + "/"):
            return False
        if msg.interface == "org.freedesktop.DBus.Properties" and msg.member == "PropertiesChanged":
            iface, changed = msg.body[0], msg.body[1]
            if iface == "org.bluez.Device1" and "Connected" in changed:
                connected = bool(changed["Connected"].value)
                self._connected[path] = connected
                if not connected:
                    self.bridge.disconnected(path)
        elif (
            msg.interface == "org.freedesktop.DBus.ObjectManager"
            and msg.member == "InterfacesRemoved"
        ):
            self._connected.pop(msg.body[0], None)
            self.bridge.disconnected(msg.body[0])
        return False

    async def _set_adapter(self, prop: str, signature: str, value: Any) -> None:
        await self._call(
            self._adapter,
            "org.freedesktop.DBus.Properties",
            "Set",
            "ssv",
            ["org.bluez.Adapter1", prop, Variant(signature, value)],
        )

    async def start(self) -> None:
        self._bus = bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
        self._adapter = await self._find_adapter()
        log.info("using Bluetooth adapter %s", self._adapter)
        await self._set_adapter("Powered", "b", True)
        # The GAP device name; iOS shows it (and caches it) once connected.
        await self._set_adapter("Alias", "s", self._service.config.name)

        bus.add_message_handler(self._on_message)
        for rule in (
            "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.Properties',"
            "member='PropertiesChanged',arg0='org.bluez.Device1'",
            "type='signal',sender='org.bluez',interface='org.freedesktop.DBus.ObjectManager',member='InterfacesRemoved'",
        ):
            await bus.call(
                Message(
                    destination="org.freedesktop.DBus",
                    path="/org/freedesktop/DBus",
                    interface="org.freedesktop.DBus",
                    member="AddMatch",
                    signature="s",
                    body=[rule],
                )
            )

        bus.export(SERVICE_PATH, GattService())
        bus.export(f"{SERVICE_PATH}/char0", InfoCharacteristic(self.bridge))
        bus.export(f"{SERVICE_PATH}/char1", RpcInCharacteristic(self.bridge))
        bus.export(f"{SERVICE_PATH}/char2", self._rpc_out)
        # BlueZ calls our GetManagedObjects (answered by dbus-fast) during this call.
        await self._call(
            self._adapter, "org.bluez.GattManager1", "RegisterApplication", "oa{sv}", [APP_PATH, {}]
        )
        await self._advertise()
        self._service.on_name_changed = self.rename
        log.info("advertising as %r", self._service.config.name)

    async def _advertise(self) -> None:
        assert self._bus is not None
        self._bus.export(ADVERT_PATH, self._advert)
        await self._call(
            self._adapter,
            "org.bluez.LEAdvertisingManager1",
            "RegisterAdvertisement",
            "oa{sv}",
            [ADVERT_PATH, {}],
        )

    async def rename(self, name: str) -> None:
        """Re-advertises under a new name (access.setName)."""
        assert self._bus is not None
        await self._call(
            self._adapter,
            "org.bluez.LEAdvertisingManager1",
            "UnregisterAdvertisement",
            "o",
            [ADVERT_PATH],
        )
        self._bus.unexport(ADVERT_PATH, self._advert)
        self._advert = Advertisement(name)
        await self._set_adapter("Alias", "s", name)
        await self._advertise()
        log.info("now advertising as %r", name)

    async def run_forever(self) -> None:
        assert self._bus is not None
        await self._bus.wait_for_disconnect()
