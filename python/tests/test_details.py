"""The device report (system/details.py), from output captured on a Raspberry Pi 4."""

import asyncio
from typing import Any

from pi_configurator.system.details import (
    DeviceDetails,
    describe_throttled,
    format_bytes,
    format_duration,
    gatt_client_setting,
    parse_bluetoothctl_show,
    parse_nmcli_device,
    split_nmcli,
)

FILES = {
    "/proc/device-tree/model": "Raspberry Pi 4 Model B Rev 1.5",
    "/proc/device-tree/serial-number": "100000003e4eb37b",
    "/proc/device-tree/compatible": "raspberrypi,4-model-b brcm,bcm2711",
    "/proc/cpuinfo": "processor\t: 0\nRevision\t: b03115\nSerial\t\t: 100000003e4eb37b\n",
    "/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq": "1800000",
    "/sys/class/thermal/thermal_zone0/temp": "45764",
    "/proc/meminfo": "MemTotal:        1888912 kB\nMemAvailable:    1466888 kB\n",
    "/etc/os-release": 'PRETTY_NAME="Debian GNU/Linux 13 (trixie)"\nID=debian\n',
    "/boot/firmware/issue.txt": "Raspberry Pi reference 2026-10-06\nGenerated using pi-gen",
    "/proc/uptime": "66075.48 263551.00",
    "/sys/class/net/eth0/address": "e4:5f:01:86:fa:38",
    "/sys/class/net/eth0/operstate": "down",
    "/etc/bluetooth/main.conf": "[General]\n[GATT]\n#Cache = always\nClient = false\n[CSIS]\n",
}

COMMANDS = {
    ("vcgencmd", "get_throttled"): "throttled=0x0",
    ("vcgencmd", "measure_volts", "core"): "volt=0.9560V",
    ("vcgencmd", "version"): "Sep 14 2026 14:49:30 \nCopyright (c) 2012 Broadcom",
    (
        "nmcli",
        "dev",
        "wifi",
    ): "*:MaghenNet:18\\:90\\:88\\:D4\\:85\\:46:153:5765 MHz:270 Mbit/s:92:WPA2\n"
    " :Neighbour:AA\\:BB\\:CC\\:DD\\:EE\\:FF:6:2437 MHz:130 Mbit/s:40:WPA2",
    ("nmcli", "dev", "show"): "GENERAL.HWADDR:E4:5F:01:86:FA:3A\nIP4.ADDRESS[1]:192.168.6.15/22\n"
    "IP4.GATEWAY:192.168.4.1\nIP4.DNS[1]:192.168.4.1\nIP6.ADDRESS[1]:fe80::e65f:1ff:fe86:fa3a/64",
    ("raspi-config", "nonint", "get_wifi_country"): "US",
    ("bluetoothctl", "show"): "Controller E4:5F:01:86:FA:3B (public)\n\tName: ThatThing\n"
    "\tAlias: Crapula\n\tPowered: yes",
    ("bluetoothctl", "--version"): "bluetoothctl: 5.82",
}


async def fake_cmd(*args: str) -> str | None:
    for key, out in COMMANDS.items():
        if all(part in args for part in key):
            return out
    return None


def report(details: dict[str, Any]) -> dict[str, dict[str, str]]:
    return {s["title"]: {i["label"]: i["value"] for i in s["items"]} for s in details["sections"]}


def test_full_report_from_a_pi_4() -> None:
    details = DeviceDetails(read=FILES.get, cmd=fake_cmd)
    r = report(asyncio.run(details.collect("Crapula", 12)))
    assert list(r) == ["Hardware", "Operating system", "Network", "Bluetooth", "pi-configurator"]
    hw = r["Hardware"]
    assert hw["Model"] == "Raspberry Pi 4 Model B Rev 1.5"
    assert hw["Serial number"] == "100000003e4eb37b"
    assert hw["Processor"].startswith("BCM2711, ") and hw["Processor"].endswith("up to 1.8 GHz")
    assert hw["CPU temperature"] == "45.8 °C"
    assert hw["Throttling"].startswith("No")
    assert hw["Memory"] == "1.8 GB, 1.4 GB available"
    assert hw["Firmware"] == "Sep 14 2026 14:49:30"
    os_ = r["Operating system"]
    assert os_["Operating system"] == "Debian GNU/Linux 13 (trixie)"
    assert os_["Image"] == "Raspberry Pi reference 2026-10-06"
    assert os_["Uptime"] == "18 h 21 min"
    net = r["Network"]
    assert net["Wi-Fi network"] == "MaghenNet"
    assert net["Access point"] == "18:90:88:D4:85:46"
    assert net["Band and channel"] == "5 GHz, channel 153 (5765 MHz)"
    assert net["Signal"] == "92%"
    assert net["IPv4 address"] == "192.168.6.15/22"
    assert net["Ethernet"] == "E4:5F:01:86:FA:38, not connected"
    assert net["Wi-Fi country"] == "US"
    bt = r["Bluetooth"]
    assert bt["Adapter address"] == "E4:5F:01:86:FA:3B"
    assert bt["BlueZ"] == "5.82"
    assert bt["GATT client role"] == "Off"
    assert r["pi-configurator"]["Settings in config"] == "12"


def test_missing_everything_still_reports() -> None:
    async def nothing(*_args: str) -> None:
        return None

    r = report(asyncio.run(DeviceDetails(read=lambda _p: None, cmd=nothing).collect("X", 1_200)))
    assert "Model" not in r.get("Hardware", {})
    assert r["pi-configurator"]["Settings in config"] == "1,200"
    assert "Wi-Fi network" not in r.get("Network", {})


def test_helpers() -> None:
    assert format_bytes(15065628672) == "14.0 GB"
    assert format_bytes(512) == "512 bytes"
    assert format_duration(300) == "5 min"
    assert format_duration(93784) == "1 day, 2 h 3 min"
    assert format_duration(3 * 86400) == "3 days, 0 h 0 min"
    assert describe_throttled("throttled=0x50005") == (
        "now: under-voltage, throttled; since boot: under-voltage, throttled (0x50005)"
    )
    assert split_nmcli("*:My\\:Net:a\\\\b") == ["*", "My:Net", "a\\b"]
    assert parse_nmcli_device("IP4.DNS[1]:1.1.1.1\nIP4.DNS[2]:8.8.8.8\nIP4.GATEWAY:--")[
        "IP4.DNS"
    ] == ["1.1.1.1", "8.8.8.8"]
    assert (
        parse_bluetoothctl_show("Controller AA:BB (public)\n\tPowered: yes")["Address"] == "AA:BB"
    )
    assert gatt_client_setting("[GATT]\n#Client = true\n[CSIS]\nClient = false\n") is None
    assert gatt_client_setting("[GATT]\nClient = false\n") == "false"
