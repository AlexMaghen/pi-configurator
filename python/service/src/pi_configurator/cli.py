"""Command line: `pi-configurator run | check [path] | set-access [path] | fields-from-pydantic`.

Paths default to the Pi locations and can be moved with flags or environment variables
(PI_CONFIGURATOR_CONFIG, PI_CONFIGURATOR_STATE_DIR, PI_CONFIGURATOR_HOSTS_FILE), e.g. for tests.

Exit codes: 0 ok, 1 runtime failure, 2 the config file is invalid (the systemd unit doesn't
restart on 2: it would only fail again).
"""

import argparse
import asyncio
import logging
import os
import signal
import sys
from dataclasses import replace
from pathlib import Path

from . import __version__
from .paths import Paths
from .protocol.config import ConfigInvalid, load_config_file
from .protocol.jsonutil import dumps_pretty

log = logging.getLogger("pi_configurator")

EXIT_CONFIG_INVALID = 2


def _paths(args: argparse.Namespace) -> Paths:
    paths = Paths.from_env()
    if getattr(args, "config", None):
        paths = replace(paths, config=Path(args.config))
    if getattr(args, "state_dir", None):
        paths = replace(paths, state_dir=Path(args.state_dir))
    if getattr(args, "hosts_file", None):
        paths = replace(paths, hosts=Path(args.hosts_file))
    return paths


def cmd_check(args: argparse.Namespace) -> int:
    path = Path(args.path) if args.path else _paths(args).config
    try:
        config = load_config_file(path)
    except ConfigInvalid as err:
        print(
            f"{path}: {len(err.issues)} problem{'s' if len(err.issues) != 1 else ''}",
            file=sys.stderr,
        )
        for issue in err.issues:
            print(f"  {issue}", file=sys.stderr)
        return EXIT_CONFIG_INVALID
    print(f"{path}: OK ({len(config.fields)} settings, Bluetooth name {config.name!r})")
    return 0


MIN_PASSWORD = 8  # same minimum the app asks for when changing the password from the phone


def _ask_access(current_name: str) -> tuple[str, str | None]:
    """Asks for the Bluetooth name and the access password. Enter keeps each as it is in the
    config (password None); a new password is asked for twice."""
    import getpass

    name = input(f"Bluetooth name [{current_name}]: ").strip() or current_name
    while True:
        password = getpass.getpass("Access password [enter to keep default]: ")
        if not password:
            return name, None
        if len(password) < MIN_PASSWORD:
            print(f"Too short: use at least {MIN_PASSWORD} characters.", file=sys.stderr)
            continue
        if getpass.getpass("Again: ") != password:
            print("The two passwords don't match.", file=sys.stderr)
            continue
        return name, password


def cmd_set_access(args: argparse.Namespace) -> int:
    from .core.configfile import rewrite_config
    from .protocol.jsonutil import JsonObject

    path = Path(args.path) if args.path else _paths(args).config
    try:
        current = load_config_file(path)
    except ConfigInvalid as err:
        print(f"{path}: fix the config first ({len(err.issues)} problems)", file=sys.stderr)
        return EXIT_CONFIG_INVALID
    if args.name is None and not args.password_stdin:
        name, password = _ask_access(current.name)
    else:
        name = args.name or current.name
        password = sys.stdin.readline().rstrip("\r\n") if args.password_stdin else None
        if password is not None and len(password) < MIN_PASSWORD:
            print(f"the password needs at least {MIN_PASSWORD} characters", file=sys.stderr)
            return EXIT_CONFIG_INVALID

    def change(data: JsonObject) -> None:
        bluetooth = data.setdefault("bluetooth", {})
        access = data.setdefault("access", {})
        assert isinstance(bluetooth, dict) and isinstance(access, dict)
        bluetooth["name"] = name
        if password is not None:
            access["password"] = password

    try:
        rewrite_config(path, change)
    except ConfigInvalid as err:
        print(f"not saved: {len(err.issues)} problem(s)", file=sys.stderr)
        for issue in err.issues:
            print(f"  {issue}", file=sys.stderr)
        return EXIT_CONFIG_INVALID
    kept = "changed" if password is not None else "unchanged"
    print(f"{path}: saved (Bluetooth name {name!r}, password {kept}).")
    print("If the service is running, restart it to use them:")
    print("  sudo systemctl restart pi-configurator")
    return 0


def cmd_fields(args: argparse.Namespace) -> int:
    from .pydantic_fields import fields_from_model, load_class

    model = load_class(args.spec)
    entries, skipped = fields_from_model(
        model, group=args.group, restart=args.restart, reload=args.reload
    )
    for name in skipped:
        print(f"skipped {name}: type not supported", file=sys.stderr)
    sys.stdout.write(dumps_pretty(entries))
    return 0


async def _run(paths: Paths) -> int:
    from .core.service import Service
    from .system.commands import Hostname, Systemd, Timezone
    from .system.details import DeviceDetails
    from .system.interfaces import SystemAdapters
    from .system.networkmanager import NetworkManagerWifi

    try:
        config = load_config_file(paths.config)
    except ConfigInvalid as err:
        log.error("%s is invalid; not starting", paths.config)
        for issue in err.issues:
            log.error("  %s", issue)
        return EXIT_CONFIG_INVALID

    system = SystemAdapters(
        wifi=NetworkManagerWifi(),
        hostname=Hostname(paths.hosts),
        timezone=Timezone(),
        systemd=Systemd(),
        details=DeviceDetails(),
    )
    service = Service(config, paths, system)
    service.warn_about_password()
    await service.startup()

    from .system.settings_signal import SettingsSignal

    # Not fatal: programs that poll values.json still see changes, a second or so later.
    announcer = SettingsSignal()
    try:
        await announcer.start()
        service.on_settings_changed = announcer.changed
    except Exception as err:
        log.warning("not announcing setting changes on D-Bus: %s", err)

    from .ble.bluez import BluezServer  # Linux only: imported here so everything else runs anywhere

    server = BluezServer(service)
    await server.start()
    service.start_first_start_defaults()
    sweeper = asyncio.create_task(service.run_idle_sweeper())

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    bus_gone = asyncio.create_task(server.run_forever())
    stopped = asyncio.create_task(stop.wait())
    done, _ = await asyncio.wait({bus_gone, stopped}, return_when=asyncio.FIRST_COMPLETED)
    sweeper.cancel()
    await service.shutdown()
    announcer.close()
    if bus_gone in done:
        log.error("lost the D-Bus connection")
        return 1
    log.info("stopping")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    paths = _paths(args)
    log.info("pi-configurator %s starting (config %s)", __version__, paths.config)
    return asyncio.run(_run(paths))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pi-configurator", description="Set up this Raspberry Pi over Bluetooth LE."
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="run the service (Bluetooth LE)")
    run.add_argument("--config", help="config file (default /etc/pi-configurator/config.json)")
    run.add_argument(
        "--state-dir", help="store and state directory (default /var/lib/pi-configurator)"
    )
    run.add_argument(
        "--hosts-file", help="hosts file kept in step with the hostname (default /etc/hosts)"
    )
    run.set_defaults(func=cmd_run)

    check = sub.add_parser("check", help="validate a config file and list its problems")
    check.add_argument(
        "path", nargs="?", help="config file (default /etc/pi-configurator/config.json)"
    )
    check.set_defaults(func=cmd_check)

    access = sub.add_parser(
        "set-access",
        help="set the Bluetooth name and access password (asks for both when given no options)",
    )
    access.add_argument(
        "path", nargs="?", help="config file (default /etc/pi-configurator/config.json)"
    )
    access.add_argument("--name", help="new Bluetooth name (at most 29 bytes)")
    access.add_argument(
        "--password-stdin", action="store_true", help="read the new password from standard input"
    )
    access.set_defaults(func=cmd_set_access)

    fields = sub.add_parser(
        "fields-from-pydantic", help="print config field entries for a settings class"
    )
    fields.add_argument("spec", help="module:Class, e.g. balls.settings:BallsSettings")
    fields.add_argument("--group", help="group to put the fields in")
    fields.add_argument(
        "--restart", action="append", help="unit to restart when one changes (repeatable)"
    )
    fields.add_argument(
        "--reload", action="append", help="unit to reload when one changes (repeatable)"
    )
    fields.set_defaults(func=cmd_fields)
    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(
        level=os.environ.get("PI_CONFIGURATOR_LOG_LEVEL", "INFO").upper(),
        format="%(levelname)s %(name)s: %(message)s",  # journald adds the timestamp
    )
    args = build_parser().parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
