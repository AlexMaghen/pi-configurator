"""SRP-6a password check (RFC 5054 math), mirrored from packages/protocol/src/srp.ts.

pi-configurator uses the RFC 5054 3072-bit group (g = 5) with SHA-512:

    x  = H(s | H(I | ":" | P))          v = g^x mod N
    k  = H(N | PAD(g))                  u = H(PAD(A) | PAD(B))
    A  = g^a mod N                      B = (k*v + g^b) mod N
    S  = (B - k*g^x)^(a + u*x) mod N    (phone)
    S  = (A * v^u)^b mod N              (Pi)
    K  = H(PAD(S))
    M1 = H(H(N) XOR H(PAD(g)) | H(I) | s | PAD(A) | PAD(B) | K)
    M2 = H(PAD(A) | M1 | K)

`|` is byte concatenation, numbers are big-endian, PAD() left-pads to the length of N, and I is
the fixed identity "pi-configurator". Tested against packages/protocol/test-vectors/srp.json.
"""

import hashlib
import hmac
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from typing import Final

HashFn = Callable[[bytes], bytes]


@dataclass(frozen=True, slots=True)
class SrpGroup:
    N: int
    g: int
    hash: HashFn

    @property
    def n_length(self) -> int:
        return (self.N.bit_length() + 7) // 8


def _hex(text: str) -> int:
    return int("".join(text.split()), 16)


def _sha1(data: bytes) -> bytes:
    return hashlib.sha1(data).digest()


def _sha512(data: bytes) -> bytes:
    return hashlib.sha512(data).digest()


#: RFC 5054 Appendix A.1, with SHA-1. Only used to check against the RFC's own test vectors.
GROUP_1024_SHA1: Final = SrpGroup(
    N=_hex("""
        EEAF0AB9 ADB38DD6 9C33F80A FA8FC5E8 60726187 75FF3C0B 9EA2314C
        9C256576 D674DF74 96EA81D3 383B4813 D692C6E0 E0D5D8E2 50B98BE4
        8E495C1D 6089DAD1 5DC7D7B4 6154D6B6 CE8EF4AD 69B15D49 82559B29
        7BCF1885 C529F566 660E57EC 68EDBC3C 05726CC0 2FD4CBF4 976EAA9A
        FD5138FE 8376435B 9FC61D2F C0EB06E3"""),
    g=2,
    hash=_sha1,
)

#: RFC 5054 Appendix A.4 with SHA-512: the group pi-configurator uses.
GROUP_3072_SHA512: Final = SrpGroup(
    N=_hex("""
        FFFFFFFF FFFFFFFF C90FDAA2 2168C234 C4C6628B 80DC1CD1 29024E08
        8A67CC74 020BBEA6 3B139B22 514A0879 8E3404DD EF9519B3 CD3A431B
        302B0A6D F25F1437 4FE1356D 6D51C245 E485B576 625E7EC6 F44C42E9
        A637ED6B 0BFF5CB6 F406B7ED EE386BFB 5A899FA5 AE9F2411 7C4B1FE6
        49286651 ECE45B3D C2007CB8 A163BF05 98DA4836 1C55D39A 69163FA8
        FD24CF5F 83655D23 DCA3AD96 1C62F356 208552BB 9ED52907 7096966D
        670C354E 4ABC9804 F1746C08 CA18217C 32905E46 2E36CE3B E39E772C
        180E8603 9B2783A2 EC07A28F B5C55DF0 6F4C52C9 DE2BCBF6 95581718
        3995497C EA956AE5 15D22618 98FA0510 15728E5A 8AAAC42D AD33170D
        04507A33 A85521AB DF1CBA64 ECFB8504 58DBEF0A 8AEA7157 5D060C7D
        B3970F85 A6E1E4C7 ABF5AE8C DB0933D7 1E8C94E0 4A25619D CEE3D226
        1AD2EE6B F12FFA06 D98A0864 D8760273 3EC86A64 521F2B18 177B200C
        BBE11757 7A615D6C 770988C0 BAD946E2 08E24FA0 74E5AB31 43DB5BFC
        E0FD108E 4B82D120 A93AD2CA FFFFFFFF FFFFFFFF"""),
    g=5,
    hash=_sha512,
)

#: The SRP identity. There is one password per device, so the user name is fixed.
SRP_IDENTITY: Final = "pi-configurator"
#: Random salt length used by the service (the vectors use 16 bytes too).
SALT_BYTES: Final = 16
#: Length of the random private exponents a and b.
SECRET_BYTES: Final = 32


class SrpError(Exception):
    pass


def to_bytes(n: int, length: int | None = None) -> bytes:
    """Big-endian bytes, left-padded to `length` when given, otherwise as short as possible."""
    minimal = n.to_bytes(max(1, (n.bit_length() + 7) // 8), "big")
    if length is None:
        return minimal
    if len(minimal) > length:
        raise ValueError("number does not fit")
    return minimal.rjust(length, b"\x00")


def from_bytes(data: bytes) -> int:
    return int.from_bytes(data, "big")


def _pad(group: SrpGroup, n: int) -> bytes:
    return to_bytes(n, group.n_length)


def _h(group: SrpGroup, *parts: bytes) -> bytes:
    return group.hash(b"".join(parts))


def _hn(group: SrpGroup, *parts: bytes) -> int:
    return from_bytes(_h(group, *parts))


def compute_k(group: SrpGroup) -> int:
    return _hn(group, to_bytes(group.N), _pad(group, group.g))


def compute_x(group: SrpGroup, identity: str, password: str, salt: bytes) -> int:
    return _hn(group, salt, _h(group, f"{identity}:{password}".encode()))


def compute_verifier(group: SrpGroup, identity: str, password: str, salt: bytes) -> int:
    return pow(group.g, compute_x(group, identity, password, salt), group.N)


def compute_u(group: SrpGroup, A: int, B: int) -> int:
    return _hn(group, _pad(group, A), _pad(group, B))


def compute_A(group: SrpGroup, a: int) -> int:
    return pow(group.g, a, group.N)


def compute_B(group: SrpGroup, b: int, v: int) -> int:
    return (compute_k(group) * v + pow(group.g, b, group.N)) % group.N


def client_S(group: SrpGroup, B: int, a: int, x: int, u: int) -> int:
    """Premaster secret on the phone (client) side."""
    base = (B - compute_k(group) * pow(group.g, x, group.N)) % group.N
    return pow(base, a + u * x, group.N)


def server_S(group: SrpGroup, A: int, v: int, u: int, b: int) -> int:
    """Premaster secret on the Pi (server) side."""
    return pow((A * pow(v, u, group.N)) % group.N, b, group.N)


def compute_session_key(group: SrpGroup, S: int) -> bytes:
    return _h(group, _pad(group, S))


def compute_M1(group: SrpGroup, identity: str, salt: bytes, A: int, B: int, K: bytes) -> bytes:
    h_n = _h(group, to_bytes(group.N))
    h_g = _h(group, _pad(group, group.g))
    xor = bytes(x ^ y for x, y in zip(h_n, h_g, strict=True))
    return _h(group, xor, _h(group, identity.encode()), salt, _pad(group, A), _pad(group, B), K)


def compute_M2(group: SrpGroup, A: int, M1: bytes, K: bytes) -> bytes:
    return _h(group, _pad(group, A), M1, K)


def proofs_equal(a: bytes, b: bytes) -> bool:
    """Constant-time comparison of two proofs."""
    return hmac.compare_digest(a, b)


@dataclass(frozen=True, slots=True)
class SrpVerifier:
    """What the Pi keeps in memory: a random salt and the verifier computed from the password."""

    salt: bytes
    verifier: int

    @classmethod
    def from_password(
        cls,
        password: str,
        salt: bytes | None = None,
        group: SrpGroup = GROUP_3072_SHA512,
        identity: str = SRP_IDENTITY,
    ) -> "SrpVerifier":
        salt = secrets.token_bytes(SALT_BYTES) if salt is None else salt
        return cls(salt=salt, verifier=compute_verifier(group, identity, password, salt))


@dataclass(frozen=True, slots=True)
class SrpResult:
    session_key: bytes
    M2: bytes


class SrpServer:
    """The Pi's side of one handshake: created on auth.start, used once on auth.finish."""

    def __init__(
        self,
        verifier: SrpVerifier,
        A: bytes,
        secret: bytes | None = None,
        group: SrpGroup = GROUP_3072_SHA512,
        identity: str = SRP_IDENTITY,
    ) -> None:
        secret = secrets.token_bytes(SECRET_BYTES) if secret is None else secret
        if len(secret) < SECRET_BYTES:
            raise SrpError("server secret must be at least 32 bytes")
        a_int = from_bytes(A)
        if a_int % group.N == 0:
            raise SrpError("client sent an invalid A")
        self._group = group
        self._identity = identity
        self._verifier = verifier
        self._A = a_int
        self._b = from_bytes(secret)
        self._B = compute_B(group, self._b, verifier.verifier)
        self.B: bytes = _pad(group, self._B)

    @property
    def salt(self) -> bytes:
        return self._verifier.salt

    def verify(self, M1: bytes) -> SrpResult:
        """Checks the phone's proof. Returns the session key and M2; raises on a wrong password."""
        group = self._group
        u = compute_u(group, self._A, self._B)
        K = compute_session_key(
            group, server_S(group, self._A, self._verifier.verifier, u, self._b)
        )
        expected = compute_M1(group, self._identity, self._verifier.salt, self._A, self._B, K)
        if not proofs_equal(M1, expected):
            raise SrpError("wrong password")
        return SrpResult(session_key=K, M2=compute_M2(group, self._A, M1, K))


class SrpClient:
    """The phone's side, for tests and the development client.

    client = SrpClient(password)
    send auth.start {A: client.A}
    M1 = client.respond(salt, B)     -> send auth.finish {M1}
    client.verify_server(M2)         -> raises if the Pi didn't prove the password
    client.session_key               -> feed into session.phone_session
    """

    def __init__(
        self,
        password: str,
        secret: bytes | None = None,
        group: SrpGroup = GROUP_3072_SHA512,
        identity: str = SRP_IDENTITY,
    ) -> None:
        secret = secrets.token_bytes(SECRET_BYTES) if secret is None else secret
        if len(secret) < SECRET_BYTES:
            raise SrpError("client secret must be at least 32 bytes")
        self._password = password
        self._group = group
        self._identity = identity
        self._a = from_bytes(secret)
        self._A = compute_A(group, self._a)
        self.A: bytes = _pad(group, self._A)
        self._key: bytes | None = None
        self._m1: bytes | None = None

    def respond(self, salt: bytes, B_bytes: bytes) -> bytes:
        group = self._group
        B = from_bytes(B_bytes)
        if B % group.N == 0:
            raise SrpError("server sent an invalid B")
        u = compute_u(group, self._A, B)
        if u == 0:
            raise SrpError("u is zero")
        x = compute_x(group, self._identity, self._password, salt)
        self._key = compute_session_key(group, client_S(group, B, self._a, x, u))
        self._m1 = compute_M1(group, self._identity, salt, self._A, B, self._key)
        return self._m1

    def verify_server(self, M2: bytes) -> None:
        if self._key is None or self._m1 is None:
            raise SrpError("respond() must be called first")
        if not proofs_equal(M2, compute_M2(self._group, self._A, self._m1, self._key)):
            raise SrpError("the device did not prove it knows the password")

    @property
    def session_key(self) -> bytes:
        if self._key is None:
            raise SrpError("respond() must be called first")
        return self._key
