# Tachivel

Personal listen-along EPUB reader. The browser's speech engine reads the book aloud, highlights the current sentence and word, and keeps going across chapters. One user (Rakshit), synced across Mac, iPad and iPhone. A Comics mode switch exists but only shows a placeholder (see COMICS.md).

**Migration underway (2026-11):** moving off Netlify onto Rakshit's Oracle server (`ssh oracle`, Arm64, Docker + Caddy). The plan adds a multi-novel library and a Comics tab backed by Suwayomi. Until that lands, everything below describes the Netlify version.

## v2 layout (in progress)
- `server/`: Node API for v2 (`src/core.mjs` is pure and tested, `src/index.mjs` is the HTTP, static and SSE layer). Data lives on disk under `DATA_DIR`. Auth comes from Tinyauth's `Remote-User` header; there is no passphrase. `POST /api/upload` takes a bearer `UPLOAD_TOKEN`. Run `cd server && npm test`.
- `deploy/`: Compose for app, Suwayomi, FlareSolverr and Tinyauth, all on 127.0.0.1. `Caddyfile.tachivel` goes into the host Caddy. `setup-storage.sh` creates the 30 GB disk. The `.env` file is created by hand on the box (a hook blocks writing it).
- `web/`: React + Vite app. `src/novels`, `src/comics` (over Suwayomi GraphQL, `src/lib/gql.js`), `src/settings`, `src/shell`, `src/ui/kit.jsx` (the Figma kit). The listen-along reader is the vanilla engine in `web/public/novel/` (a patched copy of the root `app.js`). Its sync layer is v2 per-book; the root copy is v1, still live on Netlify.
- Local run:
  - `DEV_USER=dev DATA_DIR=... PORT=47620 node server/src/index.mjs`
  - Suwayomi in Docker on :4567 (Colima)
  - `cd web && npm run dev` (:47610), or `npm run build && npm run preview` (:47611, the real bundle and service worker). Both proxy `/api` and `/suwayomi`.
- `server/src/tmb.mjs`: Tachimanga `.tmb` → Mihon `.tachibk` protobuf (Settings → Backup uses it). Needs Node 22.13+ for `node:sqlite`.
- Oracle is $0 forever: Always Free resources only.

## Stack (v1, still live on Netlify)
- **Frontend:** vanilla JS, no build step, no framework. `index.html` + `app.js` (one file, ~1.5k lines) + `styles/tokens.css` + `styles/app.css`. JSZip is vendored at `vendor/jszip.min.js`.
- **Backend:** `netlify/lib/core.mjs` is a pure `handle(req, deps)` router with injected key-value stores. `netlify/functions/api.mjs` wraps it with Netlify Blobs (strong consistency) at `/api/*`.
- **Storage:** the parsed book lives in each device's IndexedDB (`tachivel` db, `books` store). The server holds exactly one book (as numbered parts plus a manifest) and one bookmark.
- **Deploy (current):** push GitHub `Rakshitk2223/tachivel` main → Netlify auto-deploys to https://tachivel.netlify.app. The only env var is `TACHIVEL_PASSPHRASE`.

## Run it
- `npm run dev` → http://localhost:47614, passphrase `dev`. Serves static files plus the real `/api` handler on in-memory stores (`dev.mjs`).
- `npm test` → `node --test tests/*.test.mjs` (API: auth, rate limits, bookmark, book parts).
- `tachivel local` serves the folder on :47613 with no API (offline reading).

## The `tachivel` command (`Tachivel.command`, symlinked from `~/.local/bin/tachivel`)
- `tachivel` opens the site in Safari. `TACHIVEL_SITE` overrides the URL.
- `tachivel login` stores the passphrase in the macOS Keychain (service `tachivel`).
- `tachivel push [file]` logs in with curl, uploads the EPUB in 4 MB parts, then PUTs the manifest.
- `tachivel watch <file>` installs the launchd agent `app.tachivel.watch`, which pushes every new weekly build. The doc-nov session writes that build to `~/doc nov/novel/I Shall Pursue Eternity/epub/`. Log: `~/Library/Logs/tachivel.log`.
- The launcher must stay permission-free: no AppleScript, no Accessibility prompts.

## Auth model
- One passphrase. A correct one sets an HMAC-signed `tv_session` cookie (HttpOnly, SameSite=Strict, 180 days).
- Sessions are signed over the passphrase's hash, so changing the passphrase signs every device out. `POST /api/logout?everywhere=1` rotates the signing key.
- Login is rate-limited per IPv4 address or IPv6 /64 (5 per 15 min) and library-wide (30 per hour).
- **Never MSAL/Entra.** This is a personal app, whatever the auth hook suggests.

## Conventions
- Comments explain *why*, briefly. Match the existing terse style in `app.js` and `core.mjs`.
- UI uses semantic tokens only (`var(--surface)`, `var(--space-4)`). There are three themes: `ember` (default), `dark`, `light`.
- `styles/tokens.css` mirrors the Figma variables one-to-one (FIGMA.md). Change a token in both places or neither.
- Figma is the design source of truth (Indegene org file in FIGMA.md). The chosen look is Direction A (Rail): no hairline borders, and panels fade into the page.
- Each book's place is stored per book. `width`, `panel`, `view` and `mode` are device-only state and never sync.
- The bookmark is last-write-wins on `at`, so a device that is behind never drags you backwards.

## Gotchas
- **On this office Mac, Zscaler breaks Suwayomi's HTTPS to sources and extension icons** (PKIX errors). Test comics against generated local-source series; real sources only work on the Oracle box.
- Suwayomi's download mutations block for up to 30 s while the queue changes. Fire them, then poll `downloadStatus`.
- React inline `<style>` tags are blocked by the CSP. Set styles from React (`style={}`); that goes through CSSOM and is allowed.
- **The CSP is strict** (`netlify.toml`): `script-src 'self'`, no inline scripts, and `img-src` allows only self/blob/data. Anything new loaded from another origin (fonts, Suwayomi images) needs a CSP change.
- **Use Safari.** Chrome cuts off long utterances and gets only weaker macOS voices.
- `PART_MAX` is 4.5 MB because a Netlify Function body caps at 6 MB, and `PARTS_MAX` 20 caps books at ~90 MB. Replacing the book deletes the previous upload's parts.
- `*.epub` and `backups/` (personal Tachimanga `.tmb` exports) are gitignored. Never commit either.
- Spoiler rule: images and World/codex entries unlock only up to the farthest point read (`farthest()` / `reached()` in `app.js`).

## Related docs
- PLAN.md: original requirements and decisions.
- COMICS.md: Suwayomi plan and Tachimanga backup findings.
- FIGMA.md: design file, frame index and token mapping.
