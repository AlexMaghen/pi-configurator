"""The encrypted session that follows a successful SRP handshake (packages/protocol/src/session.ts).

    phone->pi key = HKDF-SHA256(ikm = K, salt = empty, info = "pi-configurator/1 phone->pi", 32)
    pi->phone key = HKDF-SHA256(ikm = K, salt = empty, info = "pi-configurator/1 pi->phone", 32)

Each message is sealed with AES-256-GCM. The 12-byte nonce is 4 zero bytes followed by a 64-bit
big-endian counter that starts at 0 and goes up by one per message in that direction. The counter
is not sent; a dropped, repeated or reordered message fails to decrypt, and that ends the session.
The additional data is the ASCII string "pi-configurator/1". Sealed message = ciphertext | tag.
"""

from dataclasses import dataclass
from typing import Final

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

SESSION_AAD: Final = b"pi-configurator/1"
INFO_PHONE_TO_PI: Final = "pi-configurator/1 phone->pi"
INFO_PI_TO_PHONE: Final = "pi-configurator/1 pi->phone"


class SessionError(Exception):
    pass


def derive_key(session_key: bytes, info: str) -> bytes:
    # cryptography treats salt=None as HashLen zero bytes, which is what RFC 5869 (and noble)
    # do for an empty salt, so both give the same PRK.
    return HKDF(algorithm=hashes.SHA256(), length=32, salt=None, info=info.encode()).derive(
        session_key
    )


def nonce_for(counter: int) -> bytes:
    return b"\x00" * 4 + counter.to_bytes(8, "big")


class Channel:
    """One direction of a session: either sealing (sender) or opening (receiver)."""

    def __init__(self, key: bytes) -> None:
        self._aead = AESGCM(key)
        self._counter = 0

    @property
    def counter(self) -> int:
        return self._counter

    def seal(self, plaintext: bytes) -> bytes:
        sealed = self._aead.encrypt(nonce_for(self._counter), plaintext, SESSION_AAD)
        self._counter += 1
        return sealed

    def open(self, sealed: bytes) -> bytes:
        try:
            plain = self._aead.decrypt(nonce_for(self._counter), sealed, SESSION_AAD)
        except InvalidTag as err:
            raise SessionError("message failed to decrypt; the session must be restarted") from err
        self._counter += 1
        return plain


@dataclass(slots=True)
class SessionChannels:
    send: Channel
    receive: Channel


def pi_session(session_key: bytes) -> SessionChannels:
    """Both directions from the Pi's point of view."""
    return SessionChannels(
        send=Channel(derive_key(session_key, INFO_PI_TO_PHONE)),
        receive=Channel(derive_key(session_key, INFO_PHONE_TO_PI)),
    )


def phone_session(session_key: bytes) -> SessionChannels:
    """Both directions from the phone's point of view (tests and the test client)."""
    return SessionChannels(
        send=Channel(derive_key(session_key, INFO_PHONE_TO_PI)),
        receive=Channel(derive_key(session_key, INFO_PI_TO_PHONE)),
    )
