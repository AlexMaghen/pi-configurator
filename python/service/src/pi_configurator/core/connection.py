"""One phone's connection: frames in, frames out, and the session state in between.

    conn = service.connect(sink=send_notifications, frame_size=182)
    conn.receive(frame)      # for each write to rpc-in; must run inside the event loop
    await conn.drain()       # (tests) wait until every request has been answered

`receive` assembles frames into messages, decrypts them in order and starts each request as its
own task, so a slow request (joining Wi-Fi) doesn't hold up the BLE write that delivered it, and
the phone can still read values meanwhile. Replies and status events are sealed (when the
session is unlocked), framed and handed to `sink` one message at a time, in the order they are
produced, which keeps both GCM counters in step.

Before the handshake only plain-text `auth.*` requests are accepted. After it, every request
must be encrypted; a message that fails to decrypt ends the session (session.ts).
"""

import asyncio
import logging
from collections.abc import Callable
from typing import TYPE_CHECKING, Final

from ..protocol.framing import MIN_FRAME_SIZE, FrameAssembler, FramingError, split_message
from ..protocol.jsonutil import Json, JsonError, JsonObject, dumps, loads
from ..protocol.rpc import (
    METHOD_NAMES,
    UNAUTHENTICATED_METHODS,
    ErrorCode,
    MethodName,
    RpcError,
    error_response,
    response,
    status_event,
)
from ..protocol.session import SessionChannels, SessionError, pi_session
from ..protocol.srp import SrpServer

if TYPE_CHECKING:
    from .service import Service

log = logging.getLogger(__name__)

#: Requests one connection may have in flight before new ones get `busy`.
MAX_IN_FLIGHT: Final = 8

FrameSink = Callable[[list[bytes]], None]


class Connection:
    def __init__(
        self,
        service: "Service",
        sink: FrameSink,
        frame_size: int = MIN_FRAME_SIZE,
        name: str = "connection",
        hang_up: Callable[[], None] | None = None,
    ) -> None:
        self.service = service
        #: Asks the transport to drop this phone (e.g. a Bluetooth disconnect); set by the
        #: transport, None in tests and transports that can't.
        self.hang_up = hang_up
        self.name = name
        self.frame_size = frame_size
        self._sink = sink
        self._clock = service.clock
        self._assembler = FrameAssembler()
        self._session: SessionChannels | None = None
        self.pending_srp: SrpServer | None = None
        self.last_activity = self._clock()
        #: When this connection last became locked: on connecting, and whenever a session ends.
        self.locked_since = self._clock()
        self._tasks: set[asyncio.Task[None]] = set()
        self.closed = False

    # -- session -------------------------------------------------------------------------------

    @property
    def unlocked(self) -> bool:
        return self._session is not None

    def start_session(self, session_key: bytes) -> None:
        self._session = pi_session(session_key)
        self.pending_srp = None
        self.last_activity = self._clock()
        log.info("%s: session unlocked", self.name)

    def end_session(self, message: str) -> None:
        """Tells the phone (if it can still read us) and drops the keys."""
        if self._session is None:
            return
        self.send(status_event("session.ending", message))
        self._session = None
        self.pending_srp = None
        self.locked_since = self._clock()
        log.info("%s: session ended: %s", self.name, message)

    def drop_session(self) -> None:
        """Forgets the session without telling the phone (it is starting a new handshake and may
        already have thrown its keys away, so an encrypted notice would only confuse it)."""
        self._session = None
        self.pending_srp = None
        self.locked_since = self._clock()

    def idle_for(self) -> float:
        return self._clock() - self.last_activity

    def locked_for(self) -> float:
        """Seconds without an unlocked session (0 while unlocked)."""
        return 0.0 if self.unlocked else self._clock() - self.locked_since

    # -- input ---------------------------------------------------------------------------------

    def receive(self, frame: bytes) -> None:
        """Handles one frame written to rpc-in. Never raises."""
        if self.closed:
            return
        try:
            message = self._assembler.push(frame)
        except FramingError as err:
            log.warning("%s: bad frame: %s", self.name, err)
            if self.unlocked:
                # The phone's send counter moved on with the broken message; ours can't follow.
                self.end_session("A message was garbled; unlock again")
            else:
                self.send(
                    error_response(0, RpcError("bad_request", f"Bad frame: {err}")), encrypted=False
                )
            return
        if message is None:
            return

        encrypted = message.encrypted
        if encrypted:
            if self._session is None:
                self.send(
                    error_response(0, RpcError("unauthenticated", "No session; unlock first")),
                    encrypted=False,
                )
                return
            try:
                payload = self._session.receive.open(message.payload)
            except SessionError:
                log.warning("%s: message failed to decrypt", self.name)
                self.end_session("A message failed to decrypt; unlock again")
                return
            self.last_activity = self._clock()
        else:
            payload = message.payload

        self._handle(payload, encrypted)

    def _handle(self, payload: bytes, encrypted: bool) -> None:
        def fail(request_id: int, code: ErrorCode, text: str) -> None:
            self.send(error_response(request_id, RpcError(code, text)), encrypted=encrypted)

        try:
            request = loads(payload)
        except JsonError:
            return fail(0, "bad_request", "Not valid JSON")
        if not isinstance(request, dict):
            return fail(0, "bad_request", "A request must be a JSON object")
        raw_id = request.get("id")
        if not isinstance(raw_id, int) or isinstance(raw_id, bool) or not 1 <= raw_id <= 0xFFFF:
            return fail(0, "bad_request", "id must be an integer from 1 to 65535")
        request_id = raw_id
        method = request.get("method")
        params: Json = request.get("params", {})
        if not isinstance(method, str):
            return fail(request_id, "bad_request", "method must be a string")
        if not isinstance(params, dict):
            return fail(request_id, "bad_request", "params must be an object")
        if set(request) - {"id", "method", "params"}:
            return fail(request_id, "bad_request", "Unknown property in request")
        if method not in METHOD_NAMES:
            return fail(request_id, "unknown_method", f"Unknown method {method}")
        name: MethodName = method

        if name in UNAUTHENTICATED_METHODS:
            if encrypted:
                return fail(request_id, "bad_request", "auth.* requests are sent in plain text")
        elif not encrypted:
            return fail(request_id, "unauthenticated", "Unlock the device first")

        if len(self._tasks) >= MAX_IN_FLIGHT:
            return fail(request_id, "busy", "Too many requests at once")
        task = asyncio.get_running_loop().create_task(
            self._run(request_id, name, params, encrypted)
        )
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(
        self, request_id: int, method: MethodName, params: JsonObject, encrypted: bool
    ) -> None:
        try:
            result = await self.service.dispatch(self, method, params)
            reply = response(request_id, result)
        except RpcError as err:
            reply = error_response(request_id, err)
        except Exception:
            log.exception("%s: %s failed", self.name, method)
            reply = error_response(
                request_id, RpcError("internal", "Something went wrong on the device")
            )
        if encrypted and not self.unlocked:
            return  # the session ended while this was running; nobody can read the reply
        self.send(reply, encrypted=encrypted)

    async def drain(self) -> None:
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)

    # -- output --------------------------------------------------------------------------------

    def send(self, message: JsonObject, *, encrypted: bool | None = None) -> None:
        """Seals (when unlocked, unless `encrypted=False`), frames and hands one message on."""
        if self.closed:
            return
        seal = self.unlocked if encrypted is None else encrypted
        data = dumps(message).encode()
        if seal:
            if self._session is None:
                return
            data = self._session.send.seal(data)
        try:
            self._sink(split_message(data, seal, self.frame_size))
        except Exception:
            log.exception("%s: couldn't send", self.name)

    def close(self) -> None:
        """The phone disconnected: forget the session. Running requests are left to finish (a
        settings.set half-applied would be worse than one nobody hears back from)."""
        self.closed = True
        self._session = None
        self.pending_srp = None
