"""In-memory system adapters for tests (and for trying the service on a Mac)."""

from dataclasses import dataclass, field

from .interfaces import (
    AdapterError,
    SystemAdapters,
    WifiConnectResult,
    WifiNetwork,
    WifiStatus,
)


@dataclass
class FakeWifi:
    networks: list[WifiNetwork] = field(default_factory=list[WifiNetwork])
    #: SSID -> password the fake "access point" accepts ("" for open networks).
    passwords: dict[str, str] = field(default_factory=dict[str, str])
    saved: dict[str, str] = field(default_factory=dict[str, str])
    current: WifiStatus | None = None
    connects: list[tuple[str, str | None, bool]] = field(
        default_factory=list[tuple[str, str | None, bool]]
    )

    async def status(self) -> WifiStatus | None:
        return self.current

    async def scan(self) -> list[WifiNetwork]:
        return list(self.networks)

    async def connect(self, ssid: str, password: str | None, hidden: bool) -> WifiConnectResult:
        self.connects.append((ssid, password, hidden))
        expected = self.passwords.get(ssid)
        given = self.saved.get(ssid, "") if password is None else password
        if expected is None:
            return WifiConnectResult(ok=False, error=f"Network {ssid!r} not found")
        if given != expected:
            return WifiConnectResult(ok=False, error="Wrong Wi-Fi password")
        self.saved[ssid] = given
        self.current = WifiStatus(ssid=ssid, connected=True, ipv4="192.168.1.40", signal=70)
        return WifiConnectResult(ok=True, ipv4="192.168.1.40")

    async def has_saved_networks(self) -> bool:
        return bool(self.saved)


@dataclass
class FakeHostname:
    name: str = "raspberrypi"
    fail: bool = False
    history: list[str] = field(default_factory=list[str])

    async def get(self) -> str:
        return self.name

    async def set(self, name: str) -> None:
        if self.fail:
            raise AdapterError("hostnamectl failed")
        self.name = name
        self.history.append(name)


@dataclass
class FakeTimezone:
    zone: str = "Etc/UTC"
    zones: list[str] = field(
        default_factory=lambda: [
            "America/Los_Angeles",
            "America/New_York",
            "Etc/UTC",
            "Europe/London",
        ]
    )
    history: list[str] = field(default_factory=list[str])

    async def get(self) -> str:
        return self.zone

    async def available(self) -> list[str]:
        return list(self.zones)

    async def set(self, zone: str) -> None:
        if zone not in self.zones:
            raise AdapterError(f"Unknown time zone {zone}")
        self.zone = zone
        self.history.append(zone)


@dataclass
class FakeSystemd:
    restarted: list[str] = field(default_factory=list[str])
    failing: set[str] = field(default_factory=set[str])
    reboots: int = 0

    async def restart(self, unit: str) -> None:
        if unit in self.failing:
            raise AdapterError(f"Job for {unit} failed")
        self.restarted.append(unit)

    async def reboot(self) -> None:
        self.reboots += 1


def fake_system() -> tuple[SystemAdapters, FakeWifi, FakeHostname, FakeTimezone, FakeSystemd]:
    wifi, hostname, timezone, systemd = FakeWifi(), FakeHostname(), FakeTimezone(), FakeSystemd()
    return SystemAdapters(wifi, hostname, timezone, systemd), wifi, hostname, timezone, systemd
