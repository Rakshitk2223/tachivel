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
# The first copy is a ~40 MB download from Netlify: wait for it instead of guessing.
for i in $(seq 1 45); do
  line=$(docker compose -f compose.yaml logs --since 2m app 2>/dev/null | grep -i "netlify mirror" | tail -1)
  [ -n "$line" ] && { echo "${line#*| }"; exit 0; }
  sleep 2
done
echo "Still downloading; check later with: docker compose -f $(pwd)/compose.yaml logs app | grep -i mirror"
