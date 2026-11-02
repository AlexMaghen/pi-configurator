"""Wi-Fi through NetworkManager's D-Bus API (dbus-fast), the default network stack on Pi OS.

Why D-Bus and not `nmcli`: no text output to parse (SSIDs can contain any byte, including the
`:` nmcli uses as a separator), typed values, and the same dbus-fast connection the BLE layer
already needs. Calls are made as plain method calls with explicit signatures (no
introspection round trips), and state changes are polled rather than followed through signals,
which keeps the code short and easy to reason about.

NOT RUN ON A REAL PI YET. The object paths, interfaces, property names and constants below are
from the NetworkManager D-Bus reference (1.4x, as shipped in Trixie); the spots most worth
checking on hardware are marked "VERIFY ON PI".
"""

import asyncio
import logging
from collections.abc import Callable
from typing import Any, Final

from ..protocol.rpc import WifiSecurity
from .interfaces import AdapterError, WifiConnectResult, WifiNetwork, WifiStatus

log = logging.getLogger(__name__)

NM: Final = "org.freedesktop.NetworkManager"
NM_PATH: Final = "/org/freedesktop/NetworkManager"
SETTINGS_PATH: Final = "/org/freedesktop/NetworkManager/Settings"
I_NM: Final = NM
I_PROPS: Final = "org.freedesktop.DBus.Properties"
I_DEVICE: Final = "org.freedesktop.NetworkManager.Device"
I_WIRELESS: Final = "org.freedesktop.NetworkManager.Device.Wireless"
I_AP: Final = "org.freedesktop.NetworkManager.AccessPoint"
I_ACTIVE: Final = "org.freedesktop.NetworkManager.Connection.Active"
I_IP4: Final = "org.freedesktop.NetworkManager.IP4Config"
I_SETTINGS: Final = "org.freedesktop.NetworkManager.Settings"
I_CONNECTION: Final = "org.freedesktop.NetworkManager.Settings.Connection"

DEVICE_TYPE_WIFI: Final = 2  # NM_DEVICE_TYPE_WIFI
ACTIVE_ACTIVATING: Final = 1  # NM_ACTIVE_CONNECTION_STATE_*
ACTIVE_ACTIVATED: Final = 2
ACTIVE_DEACTIVATED: Final = 4
WIRELESS_TYPE: Final = "802-11-wireless"

# NM80211ApFlags / NM80211ApSecurityFlags
AP_FLAGS_PRIVACY: Final = 0x1
SEC_KEY_MGMT_PSK: Final = 0x100
SEC_KEY_MGMT_802_1X: Final = 0x200
SEC_KEY_MGMT_SAE: Final = 0x400
SEC_KEY_MGMT_EAP_SUITE_B_192: Final = 0x2000


def security_from_flags(flags: int, wpa_flags: int, rsn_flags: int) -> WifiSecurity:
    """Maps an access point's NM flags to the protocol's security names."""
    both = wpa_flags | rsn_flags
    if both & (SEC_KEY_MGMT_802_1X | SEC_KEY_MGMT_EAP_SUITE_B_192):
        return "enterprise"
    if rsn_flags & SEC_KEY_MGMT_SAE and not rsn_flags & SEC_KEY_MGMT_PSK:
        return "wpa3"
    if rsn_flags & SEC_KEY_MGMT_PSK:
        return "wpa2"
    if wpa_flags & SEC_KEY_MGMT_PSK:
        return "wpa"
    if rsn_flags & SEC_KEY_MGMT_SAE:
        return "wpa3"
    if flags & AP_FLAGS_PRIVACY and both == 0:
        return "wep"
    return "open"  # includes OWE ("enhanced open"), which needs no password


def strongest_per_ssid(networks: list[WifiNetwork]) -> list[WifiNetwork]:
    """One entry per SSID (several access points often share one), strongest first."""
    best: dict[str, WifiNetwork] = {}
    for n in networks:
        if not n.ssid:
            continue  # hidden networks broadcast no name
        seen = best.get(n.ssid)
        if seen is None or n.signal > seen.signal:
            best[n.ssid] = WifiNetwork(
                n.ssid, n.signal, n.security, n.in_use or (seen is not None and seen.in_use)
            )
        elif n.in_use:
            best[n.ssid] = WifiNetwork(seen.ssid, seen.signal, seen.security, True)
    return sorted(best.values(), key=lambda n: -n.signal)


def wireless_settings(
    ssid: str, password: str | None, hidden: bool, key_mgmt: str
) -> dict[str, dict[str, Any]]:
    """Settings for a new NetworkManager profile (a{sa{sv}} before Variant wrapping)."""
    from dbus_fast import Variant

    settings: dict[str, dict[str, Any]] = {
        "connection": {
            "id": Variant("s", ssid),
            "type": Variant("s", WIRELESS_TYPE),
            "autoconnect": Variant("b", True),
        },
        WIRELESS_TYPE: {
            "ssid": Variant("ay", ssid.encode()),
            "mode": Variant("s", "infrastructure"),
            "hidden": Variant("b", hidden),
        },
        "ipv4": {"method": Variant("s", "auto")},
        "ipv6": {"method": Variant("s", "auto")},
    }
    if password:
        settings["802-11-wireless-security"] = {
            "key-mgmt": Variant("s", key_mgmt),
            "psk": Variant("s", password),
        }
    return settings


class NetworkManagerWifi:
    """WifiAdapter over NetworkManager. Connects to the system bus on first use."""

    def __init__(
        self,
        interface: str | None = None,
        connect_timeout_s: float = 45,
        scan_wait_s: float = 6,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self._interface = interface
        self._connect_timeout = connect_timeout_s
        self._scan_wait = scan_wait_s
        self._bus: Any = None
        self._loop_clock = clock

    # -- D-Bus plumbing ------------------------------------------------------------------------

    async def _get_bus(self) -> Any:
        if self._bus is None:
            from dbus_fast import BusType
            from dbus_fast.aio import MessageBus

            self._bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
        return self._bus

    async def _call(
        self,
        path: str,
        interface: str,
        member: str,
        signature: str = "",
        body: list[Any] | None = None,
    ) -> list[Any]:
        from dbus_fast import Message, MessageType

        bus = await self._get_bus()
        reply = await bus.call(
            Message(
                destination=NM,
                path=path,
                interface=interface,
                member=member,
                signature=signature,
                body=body or [],
            )
        )
        if reply.message_type == MessageType.ERROR:
            detail = reply.body[0] if reply.body else ""
            raise AdapterError(f"NetworkManager: {detail or reply.error_name}")
        return list(reply.body)

    async def _prop(self, path: str, interface: str, name: str) -> Any:
        (variant,) = await self._call(path, I_PROPS, "Get", "ss", [interface, name])
        return variant.value

    def _now(self) -> float:
        return self._loop_clock() if self._loop_clock else asyncio.get_running_loop().time()

    async def _device(self) -> str:
        (devices,) = await self._call(NM_PATH, I_NM, "GetDevices")
        for path in devices:
            if await self._prop(path, I_DEVICE, "DeviceType") != DEVICE_TYPE_WIFI:
                continue
            if self._interface and await self._prop(path, I_DEVICE, "Interface") != self._interface:
                continue
            return str(path)
        raise AdapterError("No Wi-Fi device found")

    async def _access_point(self, path: str, active_ap: str) -> WifiNetwork:
        ssid_bytes = bytes(await self._prop(path, I_AP, "Ssid"))
        security = security_from_flags(
            int(await self._prop(path, I_AP, "Flags")),
            int(await self._prop(path, I_AP, "WpaFlags")),
            int(await self._prop(path, I_AP, "RsnFlags")),
        )
        return WifiNetwork(
            ssid=ssid_bytes.decode("utf-8", errors="replace"),
            signal=int(await self._prop(path, I_AP, "Strength")),
            security=security,
            in_use=path == active_ap,
        )

    # -- WifiAdapter ---------------------------------------------------------------------------

    async def status(self) -> WifiStatus | None:
        device = await self._device()
        active = str(await self._prop(device, I_DEVICE, "ActiveConnection"))
        if active == "/":
            return None
        if await self._prop(active, I_ACTIVE, "Type") != WIRELESS_TYPE:
            return None
        state = int(await self._prop(active, I_ACTIVE, "State"))
        ssid = str(await self._prop(active, I_ACTIVE, "Id"))
        signal: int | None = None
        ap = str(await self._prop(device, I_WIRELESS, "ActiveAccessPoint"))
        if ap != "/":
            network = await self._access_point(ap, ap)
            ssid, signal = network.ssid or ssid, network.signal
        return WifiStatus(
            ssid=ssid,
            connected=state == ACTIVE_ACTIVATED,
            ipv4=await self._ipv4(device),
            signal=signal,
        )

    async def _ipv4(self, device: str) -> str | None:
        ip4 = str(await self._prop(device, I_DEVICE, "Ip4Config"))
        if ip4 == "/":
            return None
        addresses = await self._prop(ip4, I_IP4, "AddressData")  # aa{sv}
        for entry in addresses:
            address = entry.get("address")
            if address is not None:
                return str(address.value)
        return None

    async def scan(self) -> list[WifiNetwork]:
        device = await self._device()
        before = await self._last_scan(device)
        try:
            await self._call(device, I_WIRELESS, "RequestScan", "a{sv}", [{}])
        except AdapterError as err:
            # NM refuses a scan while one is running or right after one; the list is still fresh.
            log.info("RequestScan: %s", err)
        else:
            deadline = self._now() + self._scan_wait
            while self._now() < deadline and await self._last_scan(device) == before:
                await asyncio.sleep(0.5)
        active_ap = str(await self._prop(device, I_WIRELESS, "ActiveAccessPoint"))
        (paths,) = await self._call(device, I_WIRELESS, "GetAllAccessPoints")
        networks: list[WifiNetwork] = []
        for path in paths:
            try:
                networks.append(await self._access_point(str(path), active_ap))
            except AdapterError:
                continue  # the AP went away mid-scan
        return strongest_per_ssid(networks)

    async def _last_scan(self, device: str) -> int:
        # LastScan (int64 ms, CLOCK_BOOTTIME) exists since NM 1.12. VERIFY ON PI.
        try:
            return int(await self._prop(device, I_WIRELESS, "LastScan"))
        except AdapterError:
            return -1

    async def _saved_wifi(self) -> list[tuple[str, dict[str, dict[str, Any]]]]:
        (paths,) = await self._call(SETTINGS_PATH, I_SETTINGS, "ListConnections")
        out: list[tuple[str, dict[str, dict[str, Any]]]] = []
        for path in paths:
            (settings,) = await self._call(str(path), I_CONNECTION, "GetSettings")
            conn = settings.get("connection", {})
            kind = conn.get("type")
            if kind is not None and kind.value == WIRELESS_TYPE:
                out.append((str(path), settings))
        return out

    async def has_saved_networks(self) -> bool:
        return bool(await self._saved_wifi())

    async def _key_mgmt_for(self, device: str, ssid: str) -> str:
        """ "sae" for WPA3-only networks, "wpa-psk" for everything else with a password."""
        try:
            for n in await self.scan():
                if n.ssid == ssid and n.security == "wpa3":
                    return "sae"
        except AdapterError:
            pass
        return "wpa-psk"

    async def connect(self, ssid: str, password: str | None, hidden: bool) -> WifiConnectResult:
        from dbus_fast import Variant

        device = await self._device()
        existing: str | None = None
        existing_settings: dict[str, dict[str, Any]] = {}
        for path, settings in await self._saved_wifi():
            wireless = settings.get(WIRELESS_TYPE, {})
            saved_ssid = wireless.get("ssid")
            if saved_ssid is not None and bytes(saved_ssid.value) == ssid.encode():
                existing, existing_settings = path, settings
                break

        created = False
        if existing is None:
            key_mgmt = await self._key_mgmt_for(device, ssid) if password else "wpa-psk"
            settings = wireless_settings(ssid, password, hidden, key_mgmt)
            connection, active = await self._call(
                NM_PATH, I_NM, "AddAndActivateConnection", "a{sa{sv}}oo", [settings, device, "/"]
            )
            existing, created = str(connection), True
        else:
            if password is not None:
                # Update replaces the whole profile; GetSettings left the secrets out, so the new
                # security section carries the new one. VERIFY ON PI with a WPA3 network.
                updated = {k: dict(v) for k, v in existing_settings.items()}
                updated[WIRELESS_TYPE]["hidden"] = Variant("b", hidden)
                updated[WIRELESS_TYPE].pop("security", None)  # legacy back-reference key
                if password:
                    key_mgmt = await self._key_mgmt_for(device, ssid)
                    updated["802-11-wireless-security"] = {
                        "key-mgmt": Variant("s", key_mgmt),
                        "psk": Variant("s", password),
                    }
                else:
                    updated.pop("802-11-wireless-security", None)
                await self._call(existing, I_CONNECTION, "Update", "a{sa{sv}}", [updated])
            (active,) = await self._call(
                NM_PATH, I_NM, "ActivateConnection", "ooo", [existing, device, "/"]
            )

        result = await self._wait_active(str(active), device)
        if not result.ok and created:
            # Don't leave a profile with a wrong password behind for NM to keep retrying.
            try:
                await self._call(existing, I_CONNECTION, "Delete")
            except AdapterError as err:
                log.warning("couldn't remove the failed profile: %s", err)
        return result

    async def _wait_active(self, active: str, device: str) -> WifiConnectResult:
        deadline = self._now() + self._connect_timeout
        while self._now() < deadline:
            try:
                state = int(await self._prop(active, I_ACTIVE, "State"))
            except AdapterError:
                # The active-connection object disappears when activation fails.
                return WifiConnectResult(ok=False, error="Couldn't connect (check the password)")
            if state == ACTIVE_ACTIVATED:
                ip: str | None = None
                for _ in range(10):  # DHCP may finish just after "activated"
                    ip = await self._ipv4(device)
                    if ip:
                        break
                    await asyncio.sleep(0.5)
                return WifiConnectResult(ok=True, ipv4=ip)
            if state == ACTIVE_DEACTIVATED:
                return WifiConnectResult(ok=False, error="Couldn't connect (check the password)")
            await asyncio.sleep(0.5)
        return WifiConnectResult(ok=False, error="Timed out joining the network")
