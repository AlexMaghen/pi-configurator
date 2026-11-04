"""Listens for the service's `org.piconfigurator.Settings1.Changed` signal on the system D-Bus.

The signal is only a nudge: on each one the store re-reads values.json and works out itself which
values changed, so a forged or repeated signal costs one file read and nothing else. It needs
dbus-fast (`pip install "pi-configurator-client[dbus]"`); without it, or with no system bus (a Mac,
a container), `connected` stays False and the store keeps polling every second.

Runs its own asyncio loop on a daemon thread, so programs that aren't async can use it. If the
bus goes away (D-Bus restarted) it reconnects every few seconds, and the store polls meanwhile.
"""

import asyncio
import contextlib
import logging
import threading
from typing import Final

log = logging.getLogger(__name__)

# The same names as pi_configurator.system.settings_signal (tests check they match).
OBJECT_PATH: Final = "/org/piconfigurator/settings"
INTERFACE: Final = "org.piconfigurator.Settings1"
MEMBER: Final = "Changed"
MATCH_RULE: Final = f"type='signal',path='{OBJECT_PATH}',interface='{INTERFACE}',member='{MEMBER}'"

RECONNECT_S: Final = 5.0


class ChangeSignal:
    def __init__(self, wake: threading.Event) -> None:
        self._wake = wake
        self._stop = threading.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stopping: asyncio.Event | None = None
        self._thread: threading.Thread | None = None
        #: True while subscribed; the store polls slowly then, and every second otherwise.
        self.connected = False

    def start(self) -> None:
        self._thread = threading.Thread(
            target=lambda: asyncio.run(self._listen()), name="pi-configurator-dbus", daemon=True
        )
        self._thread.start()

    def close(self) -> None:
        self._stop.set()
        loop, stopping = self._loop, self._stopping
        if loop is not None and stopping is not None:
            # The loop may already have finished between the check and the call.
            with contextlib.suppress(RuntimeError):
                loop.call_soon_threadsafe(stopping.set)
        if self._thread is not None:
            self._thread.join(timeout=5)
            self._thread = None

    async def _listen(self) -> None:
        try:
            from dbus_fast import BusType, Message, MessageType
            from dbus_fast.aio import MessageBus
        except ImportError:
            log.debug("dbus-fast isn't installed; polling values.json instead")
            return

        stopping = asyncio.Event()
        self._stopping = stopping
        self._loop = asyncio.get_running_loop()
        if self._stop.is_set():
            return

        def on_message(message: Message) -> None:
            if (
                message.message_type == MessageType.SIGNAL
                and message.path == OBJECT_PATH
                and message.interface == INTERFACE
                and message.member == MEMBER
            ):
                self._wake.set()

        while not self._stop.is_set():
            try:
                bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
                bus.add_message_handler(on_message)
                await bus.call(
                    Message(
                        destination="org.freedesktop.DBus",
                        path="/org/freedesktop/DBus",
                        interface="org.freedesktop.DBus",
                        member="AddMatch",
                        signature="s",
                        body=[MATCH_RULE],
                    )
                )
            except Exception as err:
                log.debug("no system D-Bus (%s); polling values.json instead", err)
                if await _wait(stopping, RECONNECT_S):
                    return
                continue

            self.connected = True
            self._wake.set()  # anything saved while we weren't listening
            gone = asyncio.ensure_future(bus.wait_for_disconnect())
            stop = asyncio.ensure_future(stopping.wait())
            await asyncio.wait({gone, stop}, return_when=asyncio.FIRST_COMPLETED)
            self.connected = False
            stop.cancel()
            if not gone.done():
                bus.disconnect()
                gone.cancel()
                return
            log.debug("lost the system D-Bus; polling until it's back")
            if await _wait(stopping, RECONNECT_S):
                return


async def _wait(event: asyncio.Event, timeout: float) -> bool:
    """Waits up to `timeout` seconds; True if `event` was set (time to stop)."""
    try:
        await asyncio.wait_for(event.wait(), timeout)
    except TimeoutError:
        return False
    return True
