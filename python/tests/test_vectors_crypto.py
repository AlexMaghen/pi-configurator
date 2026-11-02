"""SRP, session and framing against the shared vectors in packages/protocol/test-vectors."""

import pytest
from pi_configurator.protocol import srp
from pi_configurator.protocol.framing import (
    FLAG_ENCRYPTED,
    FLAG_FIRST,
    FLAG_LAST,
    FrameAssembler,
    FramingError,
    frame_size_for_mtu,
    split_message,
)
from pi_configurator.protocol.jsonutil import b64decode, b64encode
from pi_configurator.protocol.session import (
    Channel,
    SessionError,
    derive_key,
    phone_session,
    pi_session,
)

from .vectors import load_vector

SRP = load_vector("srp.json")
SESSION = load_vector("session.json")
FRAMING = load_vector("framing.json")
G = srp.GROUP_3072_SHA512


def h(name: str) -> int:
    return int(SRP[name], 16)


def b(name: str) -> bytes:
    return bytes.fromhex(SRP[name])


# --------------------------------------------------------------------------------------------
# SRP
# --------------------------------------------------------------------------------------------


def test_srp_intermediate_values() -> None:
    salt = b("salt")
    assert SRP["identity"] == srp.SRP_IDENTITY
    assert srp.compute_k(G) == h("k")
    assert srp.compute_x(G, srp.SRP_IDENTITY, SRP["password"], salt) == h("x")
    assert srp.compute_verifier(G, srp.SRP_IDENTITY, SRP["password"], salt) == h("v")
    A = srp.compute_A(G, h("a"))
    B = srp.compute_B(G, h("b"), h("v"))
    assert srp.to_bytes(A, G.n_length) == b("A")
    assert srp.to_bytes(B, G.n_length) == b("B")
    u = srp.compute_u(G, A, B)
    assert u == h("u")
    x = h("x")
    S_client = srp.client_S(G, B, h("a"), x, u)
    S_server = srp.server_S(G, A, h("v"), u, h("b"))
    assert S_client == S_server
    K = srp.compute_session_key(G, S_server)
    assert K == b("K")
    M1 = srp.compute_M1(G, srp.SRP_IDENTITY, salt, A, B, K)
    assert M1 == b("M1")
    assert srp.compute_M2(G, A, M1, K) == b("M2")


def test_srp_server_and_client_classes() -> None:
    verifier = srp.SrpVerifier.from_password(SRP["password"], salt=b("salt"))
    assert verifier.verifier == h("v")
    server = srp.SrpServer(verifier, b("A"), secret=b("b"))
    assert server.B == b("B")
    client = srp.SrpClient(SRP["password"], secret=b("a"))
    assert client.A == b("A")
    M1 = client.respond(b("salt"), server.B)
    assert M1 == b("M1")
    result = server.verify(M1)
    assert result.M2 == b("M2")
    assert result.session_key == b("K")
    client.verify_server(result.M2)
    assert client.session_key == b("K")


def test_srp_wrong_password() -> None:
    verifier = srp.SrpVerifier.from_password(SRP["password"], salt=b("salt"))
    server = srp.SrpServer(verifier, b("A"), secret=b("b"))
    wrong = srp.SrpClient(SRP["wrongPassword"], secret=b("a"))
    M1 = wrong.respond(b("salt"), server.B)
    assert M1 == b("wrongM1")
    with pytest.raises(srp.SrpError):
        server.verify(M1)


def test_srp_base64_forms() -> None:
    forms = SRP["base64"]
    for name in ("A", "B", "salt", "M1", "M2"):
        assert b64encode(b(name)) == forms[name]
        assert b64decode(forms[name]) == b(name)
    # Padding may be left out.
    assert b64decode(forms["salt"].rstrip("=")) == b("salt")
    with pytest.raises(ValueError):
        b64decode("abc!")


def test_srp_rejects_degenerate_A() -> None:
    verifier = srp.SrpVerifier.from_password("pw")
    for bad in (0, G.N, 2 * G.N):
        with pytest.raises(srp.SrpError):
            srp.SrpServer(verifier, srp.to_bytes(bad, G.n_length + 1))


def test_srp_random_round_trip() -> None:
    verifier = srp.SrpVerifier.from_password("hunter2-hunter2")
    client = srp.SrpClient("hunter2-hunter2")
    server = srp.SrpServer(verifier, client.A)
    result = server.verify(client.respond(verifier.salt, server.B))
    client.verify_server(result.M2)
    assert client.session_key == result.session_key


def test_rfc5054_1024_sha1_vector() -> None:
    """RFC 5054 Appendix B, for the generic SRP math (k, x, v, A, B, u, S)."""
    g = srp.GROUP_1024_SHA1
    salt = bytes.fromhex("BEB25379D1A8581EB5A727673A2441EE")
    a = int("60975527035CF2AD1989806F0407210BC81EDC04E2762A56AFD529DDDA2D4393", 16)
    b_ = int("E487CB59D31AC550471E81F00F6928E01DDA08E974A004F49E61F5D105284D20", 16)
    assert srp.compute_k(g) == int("7556AA045AEF2CDD07ABAF0F665C3E818913186F", 16)
    x = srp.compute_x(g, "alice", "password123", salt)
    assert x == int("94B7555AABE9127CC58CCF4993DB6CF84D16C124", 16)
    v = srp.compute_verifier(g, "alice", "password123", salt)
    A = srp.compute_A(g, a)
    B = srp.compute_B(g, b_, v)
    u = srp.compute_u(g, A, B)
    assert u == int("CE38B9593487DA98554ED47D70A7AE5F462EF019", 16)
    expected_S = int(
        "B0DC82BABCF30674AE450C0287745E7990A3381F63B387AAF271A10D233861E3"
        "59B48220F7C4693C9AE12B0A6F67809F0876E2D013800D6C41BB59B6D5979B5C"
        "00A172B4A2A5903A0BDCAF8A709585EB2AFAFA8F3499B200210DCC1F10EB3394"
        "3CD67FC88A2F39A4BE5BEC4EC0A3212DC346D7E474B29EDE8A469FFECA686E5A",
        16,
    )
    assert srp.client_S(g, B, a, x, u) == expected_S
    assert srp.server_S(g, A, v, u, b_) == expected_S


# --------------------------------------------------------------------------------------------
# Session
# --------------------------------------------------------------------------------------------


def test_session_keys() -> None:
    K = bytes.fromhex(SESSION["K"])
    for direction in ("phoneToPi", "piToPhone"):
        entry = SESSION["keys"][direction]
        assert derive_key(K, entry["info"]).hex() == entry["key"]


def test_session_messages() -> None:
    K = bytes.fromhex(SESSION["K"])
    phone, pi = phone_session(K), pi_session(K)
    for msg in SESSION["phoneToPi"]:
        assert phone.send.counter == msg["counter"]
        sealed = phone.send.seal(msg["plaintext"].encode())
        assert sealed.hex() == msg["sealed"]
        assert pi.receive.open(sealed).decode() == msg["plaintext"]
    for msg in SESSION["piToPhone"]:
        sealed = pi.send.seal(msg["plaintext"].encode())
        assert sealed.hex() == msg["sealed"]
        assert phone.receive.open(sealed).decode() == msg["plaintext"]


def test_session_replay_and_tamper_fail() -> None:
    K = bytes.fromhex(SESSION["K"])
    first = bytes.fromhex(SESSION["phoneToPi"][0]["sealed"])
    receiver = pi_session(K).receive
    receiver.open(first)
    with pytest.raises(SessionError):
        receiver.open(first)  # replay: counter moved on
    tampered = bytearray(bytes.fromhex(SESSION["phoneToPi"][0]["sealed"]))
    tampered[0] ^= 1
    with pytest.raises(SessionError):
        Channel(derive_key(K, "pi-configurator/1 phone->pi")).open(bytes(tampered))


# --------------------------------------------------------------------------------------------
# Framing
# --------------------------------------------------------------------------------------------


@pytest.mark.parametrize("case", FRAMING["cases"], ids=lambda c: c["name"])
def test_framing_vectors(case: dict[str, object]) -> None:
    payload = bytes.fromhex(str(case["payload"]))
    encrypted = bool(case["encrypted"])
    frames = split_message(payload, encrypted, int(str(case["frameSize"])))
    assert [f.hex() for f in frames] == case["frames"]
    assembler = FrameAssembler()
    results = [assembler.push(f) for f in frames]
    assert all(r is None for r in results[:-1])
    message = results[-1]
    assert message is not None
    assert message.payload == payload
    assert message.encrypted == encrypted


def test_framing_errors_reset() -> None:
    frames = split_message(bytes(range(100)), False, 20)
    a = FrameAssembler()
    a.push(frames[0])
    with pytest.raises(FramingError):
        a.push(frames[2])  # skipped one
    with pytest.raises(FramingError):
        a.push(frames[1])  # assembler was reset, so this has no first frame
    assert a.push(split_message(b"ok", False, 20)[0]) is not None
    with pytest.raises(FramingError):
        a.push(b"\x00")
    with pytest.raises(FramingError):
        a.push(bytes([FLAG_FIRST | FLAG_LAST, 0, 0, 0, 0, 5]) + b"abc")  # fewer than announced
    with pytest.raises(FramingError):
        a.push(bytes([FLAG_FIRST | FLAG_LAST, 0, 0, 0, 0, 1]) + b"abc")  # more than announced
    with pytest.raises(FramingError):
        a.push(bytes([FLAG_FIRST, 0, 0x7F, 0, 0, 0]))  # too large
    a.push(bytes([FLAG_FIRST | FLAG_ENCRYPTED, 0, 0, 0, 0, 4]) + b"ab")
    with pytest.raises(FramingError):
        a.push(bytes([FLAG_LAST, 1]) + b"cd")  # encrypted flag changed
    with pytest.raises(FramingError):
        split_message(b"", False, 19)


def test_frame_size_for_mtu() -> None:
    for case in FRAMING["frameSizeForMtu"]:
        assert frame_size_for_mtu(case["mtu"]) == case["frameSize"], case
    assert frame_size_for_mtu(517) == 512  # an iPhone's MTU: capped at the attribute limit
    with pytest.raises(FramingError):
        split_message(b"x", False, 513)
