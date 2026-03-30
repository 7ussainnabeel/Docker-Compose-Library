#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OFFLINE_DIR="$ROOT_DIR/offline"

have_npm() {
  command -v npm >/dev/null 2>&1
}

mkdir -p "$OFFLINE_DIR"

echo "[1/8] Preparing backend dependencies"
cd "$ROOT_DIR/backend"
if have_npm; then
  npm ci
elif [[ -d node_modules ]]; then
  echo "npm not found, reusing existing backend/node_modules"
else
  echo "npm is not available and backend/node_modules is missing"
  exit 1
fi

echo "[2/8] Preparing frontend dependencies"
cd "$ROOT_DIR/frontend"
if have_npm; then
  npm ci
elif [[ -d node_modules ]]; then
  echo "npm not found, reusing existing frontend/node_modules"
else
  echo "npm is not available and frontend/node_modules is missing"
  exit 1
fi

echo "[3/8] Ensuring frontend build output"
if [[ -d "$ROOT_DIR/frontend/dist" ]]; then
  echo "Using existing frontend/dist"
elif have_npm; then
  cd "$ROOT_DIR/frontend"
  npm run build
else
  echo "frontend/dist missing and npm is not available; will extract dist from Docker image after build"
fi

echo "[4/8] Building Docker image"
cd "$ROOT_DIR"
docker compose build

if [[ ! -d "$ROOT_DIR/frontend/dist" ]]; then
  echo "[5/8] Extracting frontend/dist from Docker image"
  tmp_container="offline-dist-extract-$$"
  docker create --name "$tmp_container" local_chat-lan-messenger:latest >/dev/null
  docker cp "$tmp_container:/app/frontend/dist" "$ROOT_DIR/frontend/dist"
  docker rm "$tmp_container" >/dev/null
fi

echo "[6/8] Creating npm dependency bundles"
tar -czf "$OFFLINE_DIR/backend-node_modules.tgz" -C "$ROOT_DIR/backend" node_modules package.json package-lock.json
tar -czf "$OFFLINE_DIR/frontend-node_modules.tgz" -C "$ROOT_DIR/frontend" node_modules package.json package-lock.json
tar -czf "$OFFLINE_DIR/frontend-dist.tgz" -C "$ROOT_DIR/frontend" dist

echo "[7/8] Saving Docker images"
docker save local_chat-lan-messenger:latest -o "$OFFLINE_DIR/lan-messenger-image.tar"
docker save node:20-bookworm-slim -o "$OFFLINE_DIR/node20-bookworm-slim.tar"

echo "[8/8] Writing metadata"
cat > "$OFFLINE_DIR/offline-manifest.txt" <<EOF
Created: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Project: LAN Messenger local_chat
Docker image: local_chat-lan-messenger:latest
Included files:
- backend-node_modules.tgz
- frontend-node_modules.tgz
- frontend-dist.tgz
- lan-messenger-image.tar
- node20-bookworm-slim.tar
EOF

cat <<EOF

Offline assets are ready in:
$OFFLINE_DIR

Use:
  ./offline/run-offline.sh docker
or:
  ./offline/run-offline.sh npm
EOF
