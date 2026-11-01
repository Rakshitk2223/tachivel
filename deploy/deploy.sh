#!/usr/bin/env bash
# Every deploy, on the Oracle box: pull, rebuild, restart, check.
#   bash deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f deploy/.env ] || { echo "No deploy/.env yet. Run: bash deploy/init-env.sh"; exit 1; }
mountpoint -q /srv/tachivel || { echo "/srv/tachivel isn't mounted. Run: bash deploy/setup-storage.sh"; exit 1; }

git pull --ff-only
docker compose -f deploy/compose.yaml up -d --build --remove-orphans
docker image prune -f >/dev/null

# Caddy imports deploy/Caddyfile.tachivel straight from this repo; add the import once, then reload on every deploy.
LINE="import $(pwd)/deploy/Caddyfile.tachivel"
grep -qxF "$LINE" /etc/caddy/Caddyfile || echo "$LINE" | sudo tee -a /etc/caddy/Caddyfile >/dev/null
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
# Restart (not reload) so Caddy always has its secret from the environment; rakshiit.me blinks for about a second.
sudo systemctl restart caddy

for i in $(seq 1 30); do curl -fs http://127.0.0.1:47620/healthz >/dev/null && break; sleep 2; done
curl -fs http://127.0.0.1:47620/healthz >/dev/null && echo "App: up" || { echo "App didn't come up:"; docker compose -f deploy/compose.yaml logs --tail 30 app; exit 1; }
curl -s -o /dev/null -w "Login service: %{http_code}\n" http://127.0.0.1:47630/api/context/app
curl -s -o /dev/null -w "Comics server: %{http_code}\n" -H 'content-type: application/json' -d '{"query":"{ aboutServer { version } }"}' http://127.0.0.1:4567/api/graphql
docker compose -f deploy/compose.yaml ps --format 'table {{.Service}}\t{{.Status}}'
