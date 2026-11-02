"""Between the GATT characteristics and the core: which phone is talking, at what MTU.

BlueZ sends a notification to every device that subscribed to rpc-out; an external GATT
application can't address one device. Encrypted replies meant for one phone would reach
another and break its session, so v1 serves **one phone at a time**: the first device that
writes to rpc-in owns the channel until it disconnects, and writes from any other device are
refused (the phone sees an ATT error and can say "busy"). The core itself handles any number
of connections; this restriction lives only here.
"""

import logging
from collections.abc import Callable

from ..core.connection import Connection
from ..core.service import Service
from ..protocol.framing import frame_size_for_mtu
from ..protocol.jsonutil import dumps

log = logging.getLogger(__name__)


class ChannelBusy(Exception):
    """Another phone owns rpc-in / rpc-out right now."""


class BleBridge:
    def __init__(
        self,
        service: Service,
        notify: Callable[[bytes], None],
        is_connected: Callable[[str], bool] | None = None,
    ) -> None:
        self._service = service
        self._notify = notify
        self._is_connected = is_connected
        self.owner: str | None = None
        self._conn: Connection | None = None

    def read_info(self, offset: int = 0) -> bytes:
        """The `info` characteristic. BlueZ reads long values in pieces, passing `offset`."""
        return dumps(self._service.device_info().to_json()).encode()[offset:]

    def write(self, device: str, value: bytes, mtu: int | None) -> None:
        """A write to rpc-in from `device` (its D-Bus object path)."""
        if self.owner is not None and self.owner != device:
            # A missed disconnect signal would otherwise lock everyone out.
            if self._is_connected is not None and not self._is_connected(self.owner):
                self.disconnected(self.owner)
            else:
                raise ChannelBusy(f"{self.owner} is connected")
        if self._conn is None or self.owner is None:
            self.owner = device
            self._conn = self._service.connect(
                self._send_frames, frame_size_for_mtu(mtu), name=device.rsplit("/", 1)[-1]
            )
            log.info("%s connected (MTU %s)", device, mtu)
        elif mtu is not None:
            self._conn.frame_size = frame_size_for_mtu(mtu)
        self._conn.receive(value)

    def disconnected(self, device: str) -> None:
        if device != self.owner or self._conn is None:
            return
        log.info("%s disconnected", device)
        self._service.disconnect(self._conn)
        self._conn = None
        self.owner = None

    def _send_frames(self, frames: list[bytes]) -> None:
        for frame in frames:
            self._notify(frame)
