#!/usr/bin/env bash
set -euo pipefail

cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

ADMIN_USER="${FILEBROWSER_ADMIN_USER:-admin}"
ADMIN_PASS="${FILEBROWSER_ADMIN_PASS:-ChangeMe-Offline-Admin}"
OPS_USER="${FILEBROWSER_OPS_USER:-ops}"
OPS_PASS="${FILEBROWSER_OPS_PASS:-ChangeMe-Offline-Ops}"

if ! docker compose ps filebrowser >/dev/null 2>&1; then
  echo "Filebrowser service is not running. Start stack first."
  exit 1
fi

# Create or update admin user.
if docker compose exec -T filebrowser filebrowser users ls | grep -q "${ADMIN_USER}"; then
  docker compose exec -T filebrowser filebrowser users update "${ADMIN_USER}" --password "${ADMIN_PASS}" --perm.admin
else
  docker compose exec -T filebrowser filebrowser users add "${ADMIN_USER}" "${ADMIN_PASS}" --perm.admin
fi

# Create or update limited operations user (no admin).
if docker compose exec -T filebrowser filebrowser users ls | grep -q "${OPS_USER}"; then
  docker compose exec -T filebrowser filebrowser users update "${OPS_USER}" --password "${OPS_PASS}"
else
  docker compose exec -T filebrowser filebrowser users add "${OPS_USER}" "${OPS_PASS}"
fi

echo "Security bootstrap applied."
echo "Admin user: ${ADMIN_USER}"
echo "Ops user: ${OPS_USER}"
