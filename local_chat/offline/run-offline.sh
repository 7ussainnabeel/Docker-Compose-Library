#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-docker}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OFFLINE_DIR="$ROOT_DIR/offline"

if [[ ! -d "$OFFLINE_DIR" ]]; then
  echo "Offline folder not found: $OFFLINE_DIR"
  exit 1
fi

run_docker() {
  echo "Starting in Docker offline mode"

  if ! docker image inspect local_chat-lan-messenger:latest >/dev/null 2>&1; then
    if [[ -f "$OFFLINE_DIR/lan-messenger-image.tar" ]]; then
      echo "Loading app image from tar"
      docker load -i "$OFFLINE_DIR/lan-messenger-image.tar"
    else
      echo "Missing $OFFLINE_DIR/lan-messenger-image.tar"
      exit 1
    fi
  fi

  if ! docker image inspect node:20-bookworm-slim >/dev/null 2>&1; then
    if [[ -f "$OFFLINE_DIR/node20-bookworm-slim.tar" ]]; then
      echo "Loading base image from tar"
      docker load -i "$OFFLINE_DIR/node20-bookworm-slim.tar"
    fi
  fi

  cd "$ROOT_DIR"
  docker compose up -d --no-build
  docker compose ps

  echo
  echo "LAN Messenger is running offline with Docker"
  echo "Open: http://<host-lan-ip>:3000"
}

run_npm() {
  echo "Starting in npm offline mode"

  if [[ ! -d "$ROOT_DIR/backend/node_modules" ]]; then
    [[ -f "$OFFLINE_DIR/backend-node_modules.tgz" ]] || { echo "Missing backend-node_modules.tgz"; exit 1; }
    tar -xzf "$OFFLINE_DIR/backend-node_modules.tgz" -C "$ROOT_DIR/backend"
  fi

  if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
    [[ -f "$OFFLINE_DIR/frontend-node_modules.tgz" ]] || { echo "Missing frontend-node_modules.tgz"; exit 1; }
    tar -xzf "$OFFLINE_DIR/frontend-node_modules.tgz" -C "$ROOT_DIR/frontend"
  fi

  if [[ ! -d "$ROOT_DIR/frontend/dist" ]]; then
    if [[ -f "$OFFLINE_DIR/frontend-dist.tgz" ]]; then
      tar -xzf "$OFFLINE_DIR/frontend-dist.tgz" -C "$ROOT_DIR/frontend"
    else
      echo "Missing frontend-dist.tgz and frontend/dist"
      exit 1
    fi
  fi

  echo "Starting backend (Ctrl+C to stop)"
  cd "$ROOT_DIR/backend"
  npm start
}

case "$MODE" in
  docker)
    run_docker
    ;;
  npm)
    run_npm
    ;;
  *)
    echo "Usage: ./offline/run-offline.sh [docker|npm]"
    exit 1
    ;;
esac
