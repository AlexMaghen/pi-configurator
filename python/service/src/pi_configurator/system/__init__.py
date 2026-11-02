"""System adapters: the parts of the Pi the service changes, behind small async interfaces.

`interfaces.py` defines them, `fakes.py` has in-memory versions for tests, and the real ones are
`networkmanager.py` (Wi-Fi over D-Bus), `commands.py` (hostnamectl, timedatectl, systemctl).
"""
