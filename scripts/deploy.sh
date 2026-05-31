#!/usr/bin/env bash
# Sync local source to the Pi and (optionally) restart the service.
# Usage: bash scripts/deploy.sh [--restart]
set -euo pipefail

REMOTE=${REMOTE:-slashbin@192.168.1.14}
DEST=${DEST:-/home/slashbin/phoenix-pos}

cd "$(dirname "$0")/.."

echo "==> rsync to $REMOTE:$DEST"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git --exclude .env \
  ./ "$REMOTE:$DEST/"

echo "==> npm install + build on Pi"
ssh "$REMOTE" "cd $DEST && npm install --omit=optional && npm run build"

if [[ "${1:-}" == "--restart" ]]; then
  echo "==> restart service"
  ssh "$REMOTE" "sudo systemctl restart phoenix-pos && sudo systemctl status phoenix-pos --no-pager -l | head -15"
fi
echo "Done."
