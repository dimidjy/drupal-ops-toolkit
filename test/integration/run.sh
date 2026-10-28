#!/usr/bin/env bash
# Starts the SSH bastion + target, runs the integration tests, tears down.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose -f "$here/docker-compose.yml")

key_dir=$(mktemp -d)
trap '"${compose[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$key_dir"' EXIT
ssh-keygen -q -t ed25519 -N '' -C dops-integration -f "$key_dir/id_ed25519"
export AUTHORIZED_KEY
AUTHORIZED_KEY=$(cat "$key_dir/id_ed25519.pub")

"${compose[@]}" up -d --build --wait
cd "$here/../.."
DOPS_IT_KEY="$key_dir/id_ed25519" npx vitest run --config vitest.integration.config.js
