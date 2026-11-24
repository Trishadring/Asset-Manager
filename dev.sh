#!/bin/bash
set -e

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

nvm use 24 2>/dev/null || { echo "Run: nvm install 24"; exit 1; }

export NODE_ENV=development
export PORT="${PORT:-8080}"

case "${1:-server}" in
  server)
    pnpm --filter @workspace/api-server run dev
    ;;
  accounting)
    pnpm --filter @workspace/accounting run dev
    ;;
  *)
    echo "Usage: $0 {server|accounting}"
    exit 1
    ;;
esac
