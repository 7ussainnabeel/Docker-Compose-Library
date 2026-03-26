#!/usr/bin/env bash
set -euo pipefail

STACK_DIR="/opt/prepper-system"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${1:-base}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root: sudo ./scripts/install-prepperpi.sh [base|full]"
  exit 1
fi

if [[ "${PROFILE}" != "base" && "${PROFILE}" != "full" ]]; then
  echo "Invalid profile '${PROFILE}'. Use: base or full"
  exit 1
fi

echo "[1/7] Installing core packages..."
apt-get update
apt-get install -y docker.io docker-compose-plugin hostapd dnsmasq ufw rsync curl
systemctl enable docker
systemctl start docker

echo "[2/7] Deploying stack files to ${STACK_DIR}..."
mkdir -p "${STACK_DIR}"
rsync -a --delete --exclude '.git' --exclude '.github' "${SRC_DIR}/" "${STACK_DIR}/"

if [[ ! -f "${STACK_DIR}/.env" ]]; then
  cp "${STACK_DIR}/.env.example" "${STACK_DIR}/.env"
fi

echo "[3/7] Applying AP network configuration..."
cp "${STACK_DIR}/system/network/hostapd.conf" /etc/hostapd/hostapd.conf
cp "${STACK_DIR}/system/network/dnsmasq.conf" /etc/dnsmasq.conf
if ! grep -q "static ip_address=192.168.4.1/24" /etc/dhcpcd.conf; then
  cat "${STACK_DIR}/system/network/dhcpcd.conf.snippet" >> /etc/dhcpcd.conf
fi

if grep -q '^#\?DAEMON_CONF=' /etc/default/hostapd; then
  sed -i 's|^#\?DAEMON_CONF=.*|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd
else
  echo 'DAEMON_CONF="/etc/hostapd/hostapd.conf"' >> /etc/default/hostapd
fi

systemctl unmask hostapd || true
systemctl enable hostapd dnsmasq
systemctl restart dhcpcd
systemctl restart hostapd
systemctl restart dnsmasq

echo "[4/7] Applying local firewall policy..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 5060/udp
ufw allow 10000:10100/udp
ufw --force enable

echo "[5/7] Installing systemd stack service..."
cp "${STACK_DIR}/system/prepper-stack.service" /etc/systemd/system/prepper-stack.service
systemctl daemon-reload
systemctl enable prepper-stack.service

echo "[6/7] Building and starting stack (${PROFILE})..."
cd "${STACK_DIR}"
if [[ "${PROFILE}" == "full" ]]; then
  docker compose --profile full build
  docker compose --profile full up -d
else
  docker compose build
  docker compose up -d
fi

echo "[7/7] Bootstrap complete"
echo "Dashboard: http://192.168.4.1"
if [[ "${PROFILE}" == "base" ]]; then
  echo "Base profile active: AI and Maps are disabled."
  echo "Enable later with: cd ${STACK_DIR} && docker compose --profile full up -d ollama maps"
fi
