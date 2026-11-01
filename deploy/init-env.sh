#!/usr/bin/env bash
# One-time, on the Oracle box: writes deploy/.env and gives Caddy its shared secret.
# Generates every secret itself; asks only for your Google client, your Gmail and a password.
#   bash deploy/init-env.sh
set -euo pipefail
cd "$(dirname "$0")"
ENV=.env
if [ -f "$ENV" ]; then read -rp ".env already exists. Replace it? [y/N] " a; [ "$a" = "y" ] || exit 0; fi

read -rp "Google OAuth client ID: " GID
read -rsp "Google OAuth client secret (hidden): " GSECRET; echo
read -rp "Your Gmail address (the only one allowed in): " EMAIL
read -rp "Backup username for password sign-in [rakshit]: " USERNAME; USERNAME=${USERNAME:-rakshit}
read -rsp "Password for $USERNAME (hidden): " PASS; echo

TAG=$(grep -o 'tinyauth:${TINYAUTH_TAG:-[^}]*' compose.yaml | sed 's/.*:-//')
USERLINE=$(docker run --rm "ghcr.io/steveiliop56/tinyauth:$TAG" user create --username "$USERNAME" --password "$PASS" 2>&1 | grep -o "$USERNAME:[^ ]*" | head -1)
[ -n "$USERLINE" ] || { echo "Couldn't create the Tinyauth user."; exit 1; }
PROXY=$(openssl rand -hex 32)

umask 077
# Single quotes keep Compose from treating the $ signs in the password hash as variables.
cat > "$ENV" <<CONF
UPLOAD_TOKEN='$(openssl rand -hex 32)'
PROXY_SECRET='$PROXY'
TINYAUTH_USERS='$USERLINE'
ALLOWED_EMAIL='$EMAIL'
GOOGLE_CLIENT_ID='$GID'
GOOGLE_CLIENT_SECRET='$GSECRET'
CONF
echo "Wrote deploy/.env (readable only by you)."

# Caddy reads the same secret from its own environment.
sudo mkdir -p /etc/systemd/system/caddy.service.d
printf '[Service]\nEnvironment=TACHIVEL_PROXY_SECRET=%s\n' "$PROXY" | sudo tee /etc/systemd/system/caddy.service.d/tachivel.conf >/dev/null
sudo chmod 600 /etc/systemd/system/caddy.service.d/tachivel.conf
sudo systemctl daemon-reload
echo "Gave Caddy the shared secret. Next: bash deploy/deploy.sh"
