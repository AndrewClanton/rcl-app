#!/bin/sh
# Installs the Royale print relay on a Raspberry Pi (Raspberry Pi OS).
# Run from this folder:  sudo sh install.sh
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "Run it with sudo:  sudo sh install.sh"
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is missing. Install it with:  sudo apt install -y python3"
  exit 1
fi

HERE=$(cd "$(dirname "$0")" && pwd)

# Files copied over from Windows can carry Windows line endings; strip them.
for f in rcl_print_relay.py rcl-print-relay.service rcl-print-relay.conf.example; do
  sed -i 's/\r$//' "$HERE/$f"
done

install -d -m 755 /opt/rcl-print-relay
install -m 755 "$HERE/rcl_print_relay.py" /opt/rcl-print-relay/rcl_print_relay.py
install -m 644 "$HERE/rcl-print-relay.service" /etc/systemd/system/rcl-print-relay.service

if [ ! -f /etc/rcl-print-relay.conf ]; then
  install -m 600 "$HERE/rcl-print-relay.conf.example" /etc/rcl-print-relay.conf
  echo "Created /etc/rcl-print-relay.conf"
fi
chmod 600 /etc/rcl-print-relay.conf

systemctl daemon-reload
systemctl enable rcl-print-relay >/dev/null

if grep -q "PASTE-THE" /etc/rcl-print-relay.conf; then
  echo
  echo "Almost done. Put the relay's ID and password in the settings file:"
  echo "  sudo nano /etc/rcl-print-relay.conf"
  echo "then start it:"
  echo "  sudo systemctl restart rcl-print-relay"
else
  systemctl restart rcl-print-relay
  echo "Started. Check on it with:  systemctl status rcl-print-relay"
fi
