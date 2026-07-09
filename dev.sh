#!/bin/bash
set -e

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

nvm use 24 2>/dev/null || { echo "Run: nvm install 24"; exit 1; }

export DATABASE_URL="postgresql://asset_manager:asset_manager@localhost:5432/asset_manager"
export NODE_ENV=development
export REPL_ID=local-dev
export PORT="${PORT:-8080}"

# Ensure postgres is running
if ! docker ps --format '{{.Names}}' | grep -q asset-manager-pg; then
  echo "Starting PostgreSQL..."
  docker start asset-manager-pg 2>/dev/null || docker run -d --name asset-manager-pg \
    -e POSTGRES_DB=asset_manager \
    -e POSTGRES_USER=asset_manager \
    -e POSTGRES_PASSWORD=asset_manager \
    -p 5432:5432 postgres:16-alpine
  sleep 2
fi

case "${1:-server}" in
  db-push)
    pnpm --filter @workspace/db run push
    ;;
  server)
    pnpm --filter @workspace/api-server run dev
    ;;
  accounting)
    pnpm --filter @workspace/accounting run dev
    ;;
  *)
    echo "Usage: $0 {server|accounting|db-push}"
    exit 1
    ;;
esac
