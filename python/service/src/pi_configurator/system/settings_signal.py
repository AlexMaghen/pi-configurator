"""Announces saved settings on the system D-Bus, so programs on the Pi hear about a change at once.

After each save that changes store values, the service emits

    signal  org.piconfigurator.Settings1.Changed(as keys)
    path    /org/piconfigurator/settings
    sender  org.piconfigurator (the well-known name, when the D-Bus policy lets it own the name)

with the store keys whose value changed. The signal carries key names only, never values:
programs still read the values from values.json, whose file permissions decide who may. So the
signal can go to anyone on the bus, and a forged one only makes a listener re-read the file.

pi-configurator-client listens for it (`Store.on_change`, `Store.on_setting`); from a shell:

    dbus-monitor --system "type='signal',interface='org.piconfigurator.Settings1'"

The names are repeated in pi_configurator_client.store (the client doesn't depend on the
service); a test checks they match.
"""

import logging
from typing import Annotated, Final

from dbus_fast import BusType, DBusError, RequestNameReply
from dbus_fast.aio import MessageBus
from dbus_fast.annotations import DBusSignature
from dbus_fast.service import ServiceInterface, signal

log = logging.getLogger(__name__)

BUS_NAME: Final = "org.piconfigurator"
OBJECT_PATH: Final = "/org/piconfigurator/settings"
INTERFACE: Final = "org.piconfigurator.Settings1"

StrList = Annotated[list[str], DBusSignature("as")]


class SettingsInterface(ServiceInterface):
    def __init__(self) -> None:
        super().__init__(INTERFACE)

    @signal()
    def Changed(self, keys: StrList) -> StrList:
        return keys


class SettingsSignal:
    """Owns its own system-bus connection, separate from BlueZ's, so either can fail alone."""

    def __init__(self) -> None:
        self._bus: MessageBus | None = None
        self._interface = SettingsInterface()

    async def start(self) -> None:
        self._bus = bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
        bus.export(OBJECT_PATH, self._interface)
        try:
            reply = await bus.request_name(BUS_NAME)
            if reply not in (RequestNameReply.PRIMARY_OWNER, RequestNameReply.ALREADY_OWNER):
                log.warning("D-Bus name %s is taken (%s); announcing without it", BUS_NAME, reply)
        except DBusError as err:
            # No policy file (/etc/dbus-1/system.d/org.piconfigurator.conf): the signal still
            # goes out from the connection's unique name, and listeners match on path/interface.
            log.warning("couldn't own D-Bus name %s: %s", BUS_NAME, err)
        log.info("announcing setting changes on D-Bus (%s)", INTERFACE)

    async def changed(self, keys: list[str]) -> None:
        if self._bus is None or not self._bus.connected:
            return
        self._interface.Changed(keys)

    def close(self) -> None:
        if self._bus is not None:
            self._bus.disconnect()
            self._bus = None
