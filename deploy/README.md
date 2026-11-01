# Deploying Tachivel to the Oracle box

Cost: $0. Everything here runs on the Always Free A1 server you already have. It needs no new Oracle resources.

| File | What it's for |
|---|---|
| `compose.yaml` | Four containers: app (web + API), Suwayomi, FlareSolverr, Tinyauth v5. Each has its own network and listens on 127.0.0.1 only |
| `Caddyfile.tachivel` | Imported by the host's Caddy, which is the only public door |
| `setup-storage.sh` | One-time setup: creates the 30 GB Tachivel disk at `/srv/tachivel` |
| `init-env.sh` | One-time setup: writes `deploy/.env` and gives Caddy its shared secret. Asks for your Google client, Gmail and a password; generates every other secret itself |
| `deploy.sh` | Every deploy: pull, rebuild, restart, health check |

## First deploy
1. DNS at Namecheap: add A records `tachivel` and `auth`, both pointing to `129.225.103.66`.
2. Google OAuth client, type Web application. Redirect URI: `https://auth.rakshiit.me/api/oauth/callback/google`.
3. On the box, run these in order:
   - `sudo mkdir -p /srv/apps && sudo chown ubuntu: /srv/apps`
   - `git clone https://github.com/Rakshitk2223/tachivel.git /srv/apps/tachivel`
   - `bash /srv/apps/tachivel/deploy/setup-storage.sh`
   - `bash /srv/apps/tachivel/deploy/init-env.sh`
   - `bash /srv/apps/tachivel/deploy/deploy.sh`

## Novel mirror from Netlify
The office laptop can only reach `tachivel.netlify.app`, so the weekly ISPE build is pushed there. The app here checks Netlify every 15 minutes and files each new build on its own shelf as a newer copy, so your place is kept. Reading places are not synced between the two sites.
Turn it on once with `bash /srv/apps/tachivel/deploy/add-netlify-mirror.sh`. It asks for the v1 passphrase.

## Later deploys
`bash /srv/apps/tachivel/deploy/deploy.sh`

## Pinned versions
Suwayomi v2.4.2435, FlareSolverr v3.5.1 and Tinyauth v5.0.6. All three are arm64 images, and their setting names were checked against the images themselves. To bump one, set `SUWAYOMI_TAG`, `FLARESOLVERR_TAG` or `TINYAUTH_TAG` in `.env`.

Settings passed in `compose.yaml` override the in-app ones on every restart. That's why only the fixed wiring lives there.
