"""Interfaces for the system adapters the service uses, and the values they return."""

from dataclasses import dataclass
from typing import Protocol

from ..protocol.jsonutil import JsonObject
from ..protocol.rpc import WifiSecurity


class AdapterError(Exception):
    """A system change or query failed. The message is shown to the phone user."""


@dataclass(frozen=True, slots=True)
class WifiStatus:
    """The current Wi-Fi connection (rpc.ts WifiValueState.value)."""

    ssid: str
    connected: bool
    ipv4: str | None = None
    signal: int | None = None

    def to_json(self) -> JsonObject:
        out: JsonObject = {"ssid": self.ssid, "connected": self.connected}
        if self.ipv4 is not None:
            out["ipv4"] = self.ipv4
        if self.signal is not None:
            out["signal"] = max(0, min(100, self.signal))
        return out


@dataclass(frozen=True, slots=True)
class WifiNetwork:
    """A network seen by the Pi's radio (rpc.ts WifiNetwork)."""

    ssid: str
    signal: int
    security: WifiSecurity
    in_use: bool

    def to_json(self) -> JsonObject:
        return {
            "ssid": self.ssid,
            "signal": max(0, min(100, self.signal)),
            "security": self.security,
            "inUse": self.in_use,
        }


@dataclass(frozen=True, slots=True)
class WifiConnectResult:
    ok: bool
    ipv4: str | None = None
    error: str | None = None


class WifiAdapter(Protocol):
    async def status(self) -> WifiStatus | None:
        """The active (or activating) Wi-Fi connection, or None."""
        ...

    async def scan(self) -> list[WifiNetwork]:
        """Nearby networks, one entry per SSID (the strongest), hidden SSIDs left out."""
        ...

    async def connect(self, ssid: str, password: str | None, hidden: bool) -> WifiConnectResult:
        """Joins a network and waits until it is up or has failed.

        `password` None reuses a saved profile's secret if there is one (otherwise: open
        network); "" means an open network; anything else is the WPA passphrase.
        """
        ...

    async def has_saved_networks(self) -> bool:
        """Whether any Wi-Fi profile exists (used for first-start defaults)."""
        ...


class HostnameAdapter(Protocol):
    async def get(self) -> str: ...

    async def set(self, name: str) -> None:
        """Sets the hostname and keeps the 127.0.1.1 line in /etc/hosts in step."""
        ...


class TimezoneAdapter(Protocol):
    async def get(self) -> str: ...

    async def available(self) -> list[str]: ...

    async def set(self, zone: str) -> None: ...


class SystemdAdapter(Protocol):
    async def restart(self, unit: str) -> None: ...

    async def reload(self, unit: str) -> None:
        """`systemctl reload`: the unit's ExecReload= (usually SIGHUP), without a restart."""
        ...

    async def reboot(self) -> None: ...


class DetailsAdapter(Protocol):
    async def collect(self, bluetooth_name: str, settings_count: int) -> JsonObject:
        """The `system.details` result: {"sections": [{"title", "items": [{"label", "value"}]}]}."""
        ...


@dataclass(slots=True)
class SystemAdapters:
    wifi: WifiAdapter
    hostname: HostnameAdapter
    timezone: TimezoneAdapter
    systemd: SystemdAdapter
    #: Optional so tests and other platforms can leave it out; `system.details` then reports
    #: only the service section.
    details: DetailsAdapter | None = None
