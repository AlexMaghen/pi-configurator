"""Wrong-password backoff (shared across connections), the idle timeout and the unlock timeout."""

from pi_configurator.core.backoff import AuthBackoff
from pi_configurator.protocol.gatt import SESSION_IDLE_TIMEOUT_S, UNLOCK_TIMEOUT_S

from .conftest import PASSWORD, World


def test_backoff_schedule() -> None:
    now = [0.0]
    b = AuthBackoff(lambda: now[0])
    waits: list[float] = []
    for _ in range(12):
        b.record_failure()
        waits.append(b.wait_s())
    assert waits == [0, 0, 0, 0, 30, 60, 120, 240, 480, 900, 900, 900]
    assert b.retry_after_s() == 900
    now[0] += 899.5
    assert b.retry_after_s() == 1
    now[0] += 1
    assert b.retry_after_s() is None
    b.record_success()
    assert b.wait_s() == 0


async def test_rate_limit_is_shared_across_connections(world: World) -> None:
    for _ in range(5):
        assert (await world.phone().unlock("wrong"))["error"]["code"] == "auth_failed"
    error = (await world.phone().unlock(PASSWORD))["error"]
    assert error["code"] == "rate_limited"
    assert error["details"] == {"retryAfterS": 30}

    world.clock.now += 30
    assert (await world.phone().unlock("wrong again"))["error"]["code"] == "auth_failed"
    world.clock.now += 59
    assert (await world.phone().unlock(PASSWORD))["error"]["details"] == {"retryAfterS": 1}
    world.clock.now += 1
    assert "result" in await world.phone().unlock(PASSWORD)
    assert world.service.backoff.failures == 0


async def test_rate_limit_also_checked_at_finish(world: World) -> None:
    """A handshake started before the lockout can't be used to keep guessing."""
    from pi_configurator.protocol.jsonutil import b64encode
    from pi_configurator.protocol.srp import SrpClient

    early = world.phone()
    start = await early.call("auth.start", {"A": b64encode(SrpClient("x").A)}, encrypt=False)
    assert "result" in start
    for _ in range(5):
        await world.phone().unlock("wrong")
    error = await early.error("auth.finish", {"M1": b64encode(b"\x00" * 64)}, encrypt=False)
    assert error["code"] == "rate_limited"


async def test_idle_timeout(world: World) -> None:
    phone = await world.unlocked_phone()
    world.clock.now += SESSION_IDLE_TIMEOUT_S - 1
    await phone.result("settings.get", {"keys": ["ENABLED"]})  # activity resets the timer
    world.clock.now += SESSION_IDLE_TIMEOUT_S - 1
    world.service.sweep_idle()
    assert phone.conn.unlocked
    world.clock.now += 2
    world.service.sweep_idle()
    assert not phone.conn.unlocked
    assert phone.events[-1]["kind"] == "session.ending"
    assert phone.events[-1]["_encrypted"] is True
    assert (await phone.error("settings.get", {}))["code"] == "unauthenticated"


async def test_unlock_timeout_disconnects_a_phone_that_never_unlocks(world: World) -> None:
    idle = world.phone()
    world.clock.now += UNLOCK_TIMEOUT_S - 1
    world.service.sweep_idle()
    assert idle.conn in world.service.connections
    world.clock.now += 2
    world.service.sweep_idle()
    assert idle.conn not in world.service.connections and idle.conn.closed


async def test_unlock_timeout_uses_the_transport_hang_up(world: World) -> None:
    hung_up: list[str] = []
    conn = world.service.connect(lambda frames: None, hang_up=lambda: hung_up.append("x"))
    world.clock.now += UNLOCK_TIMEOUT_S + 1
    world.service.sweep_idle()
    assert hung_up == ["x"]  # the transport frees the channel and calls disconnect itself
    world.service.disconnect(conn)


async def test_unlock_timeout_restarts_when_a_session_ends(world: World) -> None:
    phone = await world.unlocked_phone()
    world.clock.now += UNLOCK_TIMEOUT_S * 3  # unlocked: never dropped for being locked
    await phone.result("settings.get", {"keys": ["ENABLED"]})
    world.service.sweep_idle()
    assert phone.conn.unlocked
    world.clock.now += SESSION_IDLE_TIMEOUT_S + 1
    world.service.sweep_idle()  # session ends; the phone gets a fresh unlock window
    assert not phone.conn.unlocked and phone.conn in world.service.connections
    world.clock.now += UNLOCK_TIMEOUT_S - 1
    world.service.sweep_idle()
    assert phone.conn in world.service.connections
    world.clock.now += 2
    world.service.sweep_idle()
    assert phone.conn not in world.service.connections
