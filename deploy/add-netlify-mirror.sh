#!/usr/bin/env bash
# One-time, on the Oracle box: let the app copy the novel from the v1 Netlify site (asks for its passphrase).
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Run init-env.sh first."; exit 1; }
read -rsp "Netlify Tachivel passphrase (hidden): " P; echo
[ -n "$P" ] || exit 1
grep -v '^NETLIFY_PASSPHRASE=' .env > .env.tmp || true
printf "NETLIFY_PASSPHRASE='%s'\n" "$P" >> .env.tmp
chmod 600 .env.tmp && mv .env.tmp .env
echo "Saved. Restarting the app…"
docker compose -f compose.yaml up -d app >/dev/null
sleep 8
docker compose -f compose.yaml logs --since 1m app | grep -i "netlify mirror" | tail -3 || echo "(no mirror log yet; it checks every 15 minutes)"
