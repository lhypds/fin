#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Restarting..."

cd "$ROOT"
if git remote get-url origin &> /dev/null; then
  echo "Pulling latest code..."
  git pull --ff-only
else
  echo "No git remote configured, skipping pull"
fi

"$ROOT/setup.sh"

"$ROOT/stop.sh"
"$ROOT/start.sh"
