#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "${1:-}" in
  prepare)
    "$ROOT_DIR/offline/prepare-offline.sh"
    ;;
  run)
    "$ROOT_DIR/offline/run-offline.sh" "${2:-docker}"
    ;;
  *)
    cat <<EOF
Usage:
  ./offline/offline.sh prepare
  ./offline/offline.sh run docker
  ./offline/offline.sh run npm
EOF
    exit 1
    ;;
esac
