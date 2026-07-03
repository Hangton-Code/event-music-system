#!/usr/bin/env bash
# Auto-update: pull the latest code from GitHub and rebuild only if something
# changed. Safe to run on a schedule (cron/systemd timer) — it's a no-op when
# already up to date.
set -euo pipefail
cd "$(dirname "$0")"

git fetch --quiet origin main
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "$(date '+%F %T') — already up to date"
  exit 0
fi

echo "$(date '+%F %T') — update found, pulling and rebuilding..."
git pull --ff-only origin main
docker compose up -d --build
docker image prune -f >/dev/null 2>&1 || true
echo "$(date '+%F %T') — updated to $(git rev-parse --short HEAD)"
