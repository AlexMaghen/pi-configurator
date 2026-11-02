"""Wrong-password backoff (gatt.ts AUTH_BACKOFF), shared by every connection, kept in memory.

The first 5 wrong passwords are free. After that each attempt must wait: 30 s after the 5th
failure, doubling with every further failure, capped at 15 minutes. A right password resets it.
Restarting the service also resets it; that takes root, which already defeats the password.
"""

import math
from collections.abc import Callable

from ..protocol.gatt import AUTH_FIRST_WAIT_S, AUTH_FREE_ATTEMPTS, AUTH_MAX_WAIT_S


class AuthBackoff:
    def __init__(self, clock: Callable[[], float]) -> None:
        self._clock = clock
        self.failures = 0
        self._last_failure = 0.0

    def wait_s(self) -> float:
        """The wait that applies after the failures so far."""
        if self.failures < AUTH_FREE_ATTEMPTS:
            return 0
        return min(AUTH_FIRST_WAIT_S * 2 ** (self.failures - AUTH_FREE_ATTEMPTS), AUTH_MAX_WAIT_S)

    def retry_after_s(self) -> int | None:
        """Whole seconds until the next attempt is allowed, or None when it is allowed now."""
        remaining = self._last_failure + self.wait_s() - self._clock()
        return math.ceil(remaining) if remaining > 0 else None

    def record_failure(self) -> None:
        self.failures += 1
        self._last_failure = self._clock()

    def record_success(self) -> None:
        self.failures = 0
