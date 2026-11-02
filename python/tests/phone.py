"""A test phone: the app's side of the protocol in Python (framing, SRP client, session).

It talks to a real Connection through frames only, exactly as the BLE layer would, and checks
every message it receives against json-schema/rpc.schema.json.
"""

import json
from dataclasses import dataclass, field
from typing import Any, cast

from jsonschema import Draft202012Validator
from pi_configurator.core.connection import Connection
from pi_configurator.core.service import Service
from pi_configurator.protocol.framing import FrameAssembler, split_message
from pi_configurator.protocol.jsonutil import b64decode
from pi_configurator.protocol.session import SessionChannels, phone_session
from pi_configurator.protocol.srp import SrpClient

from .vectors import load_schema

RPC_SCHEMA = load_schema("rpc.schema.json")
# Typed as Any: jsonschema's validator classes are only partly annotated.
RESPONSE: Any = Draft202012Validator(RPC_SCHEMA["response"])
STATUS: Any = Draft202012Validator(RPC_SCHEMA["statusEvent"])
RESULTS: dict[str, Any] = {
    name: Draft202012Validator(m["result"]) for name, m in RPC_SCHEMA["methods"].items()
}


@dataclass
class Phone:
    service: Service
    frame_size: int = 182
    conn: Connection = field(init=False)
    session: SessionChannels | None = None
    inbox: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])
    events: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])
    frames_in: int = 0
    _assembler: FrameAssembler = field(default_factory=FrameAssembler)
    _next_id: int = 1
    _sent: dict[int, str] = field(default_factory=dict[int, str])

    def __post_init__(self) -> None:
        self.conn = self.service.connect(self._on_frames, self.frame_size, name="test-phone")

    def _on_frames(self, frames: list[bytes]) -> None:
        for frame in frames:
            assert len(frame) <= self.frame_size
            self.frames_in += 1
            message = self._assembler.push(frame)
            if message is None:
                continue
            payload = message.payload
            if message.encrypted:
                assert self.session is not None, "encrypted message before the session"
                payload = self.session.receive.open(payload)
            obj = cast(dict[str, Any], json.loads(payload))
            obj["_encrypted"] = message.encrypted
            plain = {k: v for k, v in obj.items() if k != "_encrypted"}
            if obj.get("event") == "status":
                STATUS.validate(plain)
                self.events.append(obj)
                if obj["kind"] == "session.ending":
                    self.session = None
            else:
                RESPONSE.validate(plain)
                method = self._sent.get(obj["id"])
                if "result" in obj and method is not None:
                    RESULTS[method].validate(obj["result"])
                self.inbox.append(obj)

    def send_raw(self, payload: bytes, encrypted: bool) -> None:
        for frame in split_message(payload, encrypted, self.frame_size):
            self.conn.receive(frame)

    def send(
        self, method: str, params: dict[str, Any] | None = None, *, encrypt: bool | None = None
    ) -> int:
        request_id = self._next_id
        self._next_id += 1
        self._sent[request_id] = method
        body: dict[str, Any] = {"id": request_id, "method": method}
        if params is not None:
            body["params"] = params
        data = json.dumps(body).encode()
        seal = self.session is not None if encrypt is None else encrypt
        if seal:
            assert self.session is not None
            data = self.session.send.seal(data)
        self.send_raw(data, seal)
        return request_id

    async def call(
        self, method: str, params: dict[str, Any] | None = None, **kw: Any
    ) -> dict[str, Any]:
        """Sends a request and returns its response envelope ({id, result} or {id, error})."""
        request_id = self.send(method, params, **kw)
        await self.conn.drain()
        for i, msg in enumerate(self.inbox):
            if msg.get("id") == request_id:
                return self.inbox.pop(i)
        raise AssertionError(f"no response to {method}; inbox={self.inbox} events={self.events}")

    async def result(self, method: str, params: dict[str, Any] | None = None) -> Any:
        reply = await self.call(method, params)
        assert "result" in reply, reply
        return reply["result"]

    async def error(
        self, method: str, params: dict[str, Any] | None = None, **kw: Any
    ) -> dict[str, Any]:
        reply = await self.call(method, params, **kw)
        assert "error" in reply, reply
        return cast(dict[str, Any], reply["error"])

    async def unlock(self, password: str) -> dict[str, Any]:
        """Runs the SRP handshake; returns the auth.finish response envelope."""
        client = SrpClient(password)
        from pi_configurator.protocol.jsonutil import b64encode

        start = await self.call("auth.start", {"A": b64encode(client.A)}, encrypt=False)
        if "error" in start:
            return start
        salt, B = b64decode(start["result"]["salt"]), b64decode(start["result"]["B"])
        M1 = client.respond(salt, B)
        finish = await self.call("auth.finish", {"M1": b64encode(M1)}, encrypt=False)
        if "result" in finish:
            client.verify_server(b64decode(finish["result"]["M2"]))
            self.session = phone_session(client.session_key)
        return finish
