# Deploying Tachivel to the Oracle box

Cost: $0. Everything here runs on the Always Free A1 server you already have. It needs no new Oracle resources.

| Piece | Where |
|---|---|
| `compose.yaml` | Four containers: app (web + API), Suwayomi, FlareSolverr, Tinyauth. Each listens on 127.0.0.1 only |
| `Dockerfile` | Builds the web app, then the Node API image |
| `Caddyfile.tachivel` | Goes into the host's `/etc/caddy/Caddyfile`. Caddy is the only public door |
| `setup-storage.sh` | One-time setup: creates the 30 GB Tachivel disk at `/srv/tachivel` |

## First deploy (in order)
1. DNS at Namecheap: add A records for `tachivel` and `auth`, both pointing to `129.225.103.66`.
2. On the box: `git clone` the repo, then run `bash deploy/setup-storage.sh`.
3. Create `deploy/.env` by hand with these variables:
   - `UPLOAD_TOKEN`
   - `PROXY_SECRET`: Caddy sends it with every request; the app ignores identity headers without it. Give Caddy the same value with `sudo systemctl edit caddy` (`Environment=TACHIVEL_PROXY_SECRET=...`).
   - `TINYAUTH_SECRET`
   - `TINYAUTH_USERS`
   - `ALLOWED_EMAIL`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `SUWAYOMI_TAG`, `FLARESOLVERR_TAG`, `TINYAUTH_TAG`: pin exact versions.

   Generate secrets with `openssl rand -hex 32`. The Tinyauth user line comes from Tinyauth's `user create` command.
4. `cd deploy && docker compose up -d --build`
5. Append `Caddyfile.tachivel` to `/etc/caddy/Caddyfile`, then run `sudo systemctl reload caddy`.

## Later deploys
`git pull && cd deploy && docker compose up -d --build`

## Before the first deploy, check
- The env variable names for the Suwayomi and Tinyauth tags you pin. Both projects have renamed variables between major versions.
- That the Google OAuth redirect URI matches Tinyauth's docs for that version: `https://auth.rakshiit.me/...`
