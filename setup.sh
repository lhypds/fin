#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "Setting up..."

# Create .env from .env.example if not present
if [ ! -f "$ROOT/.env" ]; then
  echo "Creating .env from .env.example..."
  cp "$ROOT/.env.example" "$ROOT/.env"
fi

# Create data/users.json (login accounts) from users.example.json if not present
if [ ! -f "$ROOT/data/users.json" ]; then
  echo "Creating data/users.json from users.example.json..."
  mkdir -p "$ROOT/data"
  cp "$ROOT/users.example.json" "$ROOT/data/users.json"
fi

# Install pm2 globally if not present
if ! command -v pm2 &> /dev/null; then
  echo "Installing pm2..."
  npm install -g pm2
fi

if command -v pnpm &> /dev/null; then
  PKG=pnpm
else
  PKG=npm
fi

cd "$ROOT"
echo "Installing dependencies with $PKG..."
"$PKG" install

echo "Building frontend..."
"$PKG" run build

echo ""
echo "Setup complete."
echo "Put your OPENAI_API_KEY in .env, set the login accounts in data/users.json, then run ./start.sh to start the app"
