"""Splitting messages into BLE-sized frames and joining them back (protocol/src/framing.ts).

    byte 0      flags: 0x01 FIRST, 0x02 LAST, 0x04 ENCRYPTED (a sealed session message)
    byte 1      frame index within the message, 0, 1, 2 ... wrapping at 256
    bytes 2-5   FIRST frame only: total message length, uint32 big-endian
    rest        payload bytes

A one-frame message has FIRST and LAST both set. The frame size is the negotiated ATT MTU
minus 3; 20 bytes is the smallest allowed.
"""

from dataclasses import dataclass
from typing import Final

FLAG_FIRST: Final = 0x01
FLAG_LAST: Final = 0x02
FLAG_ENCRYPTED: Final = 0x04
MIN_FRAME_SIZE: Final = 20
#: The largest attribute value Bluetooth allows (ATT), so the largest frame. BlueZ cuts anything
#: longer, and an iPhone negotiates MTU 517, which would otherwise give 514-byte frames.
MAX_FRAME_SIZE: Final = 512
MAX_MESSAGE_BYTES: Final = 256 * 1024

_FIRST_HEADER = 6
_NEXT_HEADER = 2


class FramingError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class Message:
    payload: bytes
    encrypted: bool


def frame_size_for_mtu(mtu: int | None) -> int:
    """Frame size for a negotiated ATT MTU: MTU - 3, kept between 20 and 512 bytes."""
    if mtu is None:
        return MIN_FRAME_SIZE
    return min(MAX_FRAME_SIZE, max(MIN_FRAME_SIZE, mtu - 3))


def split_message(payload: bytes, encrypted: bool, frame_size: int) -> list[bytes]:
    if frame_size < MIN_FRAME_SIZE:
        raise FramingError(f"frame size must be at least {MIN_FRAME_SIZE}")
    if frame_size > MAX_FRAME_SIZE:
        raise FramingError(f"frame size must be at most {MAX_FRAME_SIZE}")
    if len(payload) > MAX_MESSAGE_BYTES:
        raise FramingError("message too large")
    frames: list[bytes] = []
    offset = 0
    index = 0
    while True:
        first = index == 0
        header = _FIRST_HEADER if first else _NEXT_HEADER
        take = min(frame_size - header, len(payload) - offset)
        last = offset + take >= len(payload)
        flags = (
            (FLAG_FIRST if first else 0)
            | (FLAG_LAST if last else 0)
            | (FLAG_ENCRYPTED if encrypted else 0)
        )
        head = bytes([flags, index & 0xFF])
        if first:
            head += len(payload).to_bytes(4, "big")
        frames.append(head + payload[offset : offset + take])
        offset += take
        index += 1
        if offset >= len(payload):
            return frames


class FrameAssembler:
    """Collects frames from one direction and returns each message when its last frame arrives.

    Any out-of-order frame raises and resets, so a broken message can't leak into the next one.
    """

    def __init__(self) -> None:
        self._buffer: bytearray | None = None
        self._total = 0
        self._next_index = 0
        self._encrypted = False

    def push(self, frame: bytes) -> Message | None:
        try:
            return self._accept(frame)
        except FramingError:
            self.reset()
            raise

    def reset(self) -> None:
        self._buffer = None
        self._total = 0
        self._next_index = 0
        self._encrypted = False

    def _accept(self, frame: bytes) -> Message | None:
        if len(frame) < _NEXT_HEADER:
            raise FramingError("frame too short")
        flags, index = frame[0], frame[1]
        first = bool(flags & FLAG_FIRST)
        last = bool(flags & FLAG_LAST)
        encrypted = bool(flags & FLAG_ENCRYPTED)

        if first:
            # `is not None`: an empty bytearray (a zero-length message) is still a message.
            if self._buffer is not None:
                raise FramingError("new message started before the last one ended")
            if index != 0 or len(frame) < _FIRST_HEADER:
                raise FramingError("bad first frame")
            total = int.from_bytes(frame[2:6], "big")
            if total > MAX_MESSAGE_BYTES:
                raise FramingError("message too large")
            self._buffer = bytearray()
            self._total = total
            self._encrypted = encrypted
            body = frame[_FIRST_HEADER:]
        else:
            if self._buffer is None:
                raise FramingError("continuation frame without a first frame")
            if index != (self._next_index & 0xFF):
                raise FramingError("frame out of order")
            if encrypted != self._encrypted:
                raise FramingError("encrypted flag changed mid-message")
            body = frame[_NEXT_HEADER:]

        buffer = self._buffer
        if len(buffer) + len(body) > self._total:
            raise FramingError("more bytes than announced")
        buffer.extend(body)
        self._next_index += 1

        if not last:
            return None
        if len(buffer) != self._total:
            raise FramingError("fewer bytes than announced")
        message = Message(payload=bytes(buffer), encrypted=self._encrypted)
        self.reset()
        return message
