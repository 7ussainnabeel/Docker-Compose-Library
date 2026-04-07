#!/bin/bash
set -e

# Always run from this script's folder so compose.yaml is used.
cd "$(dirname "$0")"

echo "Pulling latest images..."
docker compose pull

echo "Recreating services..."
docker compose up -d --force-recreate

echo "Update complete."
