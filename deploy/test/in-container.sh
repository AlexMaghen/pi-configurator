#!/usr/bin/env bash
# Runs inside debian:trixie. Simulates a fresh Pi OS: curl is preinstalled there, and systemd
# can't run in a container, so systemctl is a stub that logs its calls.
set -uo pipefail
apt-get update -qq >/dev/null && apt-get install -y -qq curl expect >/dev/null 2>&1
cat > /usr/local/bin/systemctl <<'X'
#!/bin/sh
echo "systemctl $*" >> /test/systemctl.log
X
chmod +x /usr/local/bin/systemctl
useradd -m pi
export PI_CONFIGURATOR_URL=file:///test/main.tar.gz
# get.sh as `curl .../deploy/get.sh` would fetch it
tar -xzf /test/main.tar.gz -O pi-configurator-main/deploy/get.sh > /tmp/get.sh

pw() { /opt/pi-configurator/venv/bin/python -c 'import json;d=json.load(open("/etc/pi-configurator/config.json"));print(d["bluetooth"]["name"], "|", d["access"]["password"])'; }

echo "################ RUN 1: first install, piped, no terminal"
: > /test/systemctl.log
cat /tmp/get.sh | bash -s -- --reader pi; echo "exit=$?"
echo "--- config:"; pw
echo "--- systemctl calls:"; cat /test/systemctl.log

echo "################ RUN 2: answer the prompts on a terminal (short password first)"
: > /test/systemctl.log
rm /etc/pi-configurator/config.json  # back to a first install
expect <<'X'
set timeout 600
spawn bash /tmp/get.sh
expect "Bluetooth name"
send "Kitchen Pi\r"
expect "Access password"
send "short\r"
expect "Too short"
expect "Access password"
send "long-enough-1\r"
expect "Again: "
send "long-enough-1\r"
expect eof
catch wait result
puts "exit=[lindex $result 3]"
X
echo "--- config:"; pw
echo "--- systemctl calls:"; cat /test/systemctl.log
cp /etc/pi-configurator/config.json /test/kitchen.json

echo "################ RUN 2b: first install, pressing Enter to keep the config's name and password"
: > /test/systemctl.log
rm /etc/pi-configurator/config.json  # back to a first install
expect <<'X'
set timeout 600
spawn bash /tmp/get.sh
expect "Bluetooth name"
send "\r"
expect "enter to keep default"
send "\r"
expect eof
catch wait result
puts "exit=[lindex $result 3]"
X
echo "--- config:"; pw
echo "--- systemctl calls:"; cat /test/systemctl.log
cp /test/kitchen.json /etc/pi-configurator/config.json  # RUN 3 updates RUN 2's config

echo "################ RUN 3: update (config kept, no prompt)"
: > /test/systemctl.log
cat /tmp/get.sh | bash; echo "exit=$?"
echo "--- config:"; pw
echo "--- systemctl calls:"; cat /test/systemctl.log

echo "################ RUN 4: a broken --config on a first install is refused, nothing installed"
: > /test/systemctl.log
mv /etc/pi-configurator/config.json /tmp/kept.json
printf '{"version": 1, "bluetooth": {"name": "%s"}, "access": {"password": ""}, "settings": []}' \
  "Name-that-is-far-too-long-for-bluetooth" > /tmp/broken.json
cat /tmp/get.sh | bash -s -- --config /tmp/broken.json; echo "exit=$?"
echo "--- config installed: $([[ -e /etc/pi-configurator/config.json ]] && echo yes || echo no)"
echo "--- systemctl calls:"; cat /test/systemctl.log
mv /tmp/kept.json /etc/pi-configurator/config.json

echo "################ CHECKS"
pi-configurator check
pi-configurator --version
ls -ld /etc/pi-configurator /etc/pi-configurator/config.json /var/lib/pi-configurator /opt/pi-configurator/src
getent group pi-configurator
ls -l /etc/systemd/system/pi-configurator.service
/opt/pi-configurator/venv/bin/python -c 'import pi_configurator_client; print("client ok")'
