# Comics mode: findings and plan

Status: **parked**. Only the Novels/Comics switch and the "Coming later" placeholder are built. These are notes so we can pick it up later without redoing the research.

## Goal

Stop using Tachimanga on the iPhone (we're not paying for premium). The replacement has to do what the free tier does today:

- read comics;
- switch themes;
- switch reading layout (webtoon / paged);
- remember progress;
- fetch new chapters.

It should also sync across devices, which Tachimanga's free tier can't.

## What the backup told us (`backups/tachimanga/*.tmb`, 2026-09-29)

- **Tachimanga runs Suwayomi (Tachidesk) under the hood.** Its prefs are named `suwayomi.tachidesk.*`, and `tachimanga.db` uses Tachidesk's schema (Manga, Chapter, Extension, Source, Category, History). So moving to a Suwayomi server keeps the same engine.
- **File layout:** `.tmb` is a zip holding `meta.json` and `contents.zip`. Inside that are `tachimanga.db` (SQLite), `extensions/*.jar`, `prefs/*.plist` and `pref*.json`.
- **Library:**
  - 829 titles, all from the **Keiyoushi** repo;
  - 26 extensions installed;
  - 37.5k of the 50.7k chapters on the SFW sources are marked read.
- **Main sources:** MangaK, Asura Scans, ManhuaUS, Bato, AllManga, Comick, Weeb Central, Manhua Plus, MangaDex, Flame Comics, Manganato.
- **No backup elsewhere:**
  - no trackers (AniList/MAL);
  - no Tachimanga cloud sync;
  - **the phone is the only live copy.** Export a fresh `.tmb` now and then.
- **A parser already exists:** NoteHaven has a working `.tmb` reader at `~/Projects/personal/NoteHaven/src/lib/tachimanga/parse-core.ts`.

## Why the browser can't do it alone

- Extensions are Android/JVM code (`.jar`), so a browser can't run them.
- Sources block requests that come from other sites (CORS), and several sit behind Cloudflare.
- Something has to run on a server.

## The plan

1. **Server: Suwayomi-Server**, with **Suwayomi-WebUI** bundled.
   - Suwayomi-WebUI is already a full reader PWA:
     - library;
     - updates;
     - webtoon and paged reading;
     - themes;
     - progress stored on the server, so every device shares it.
   - **Use it as-is first.** Build nothing until it's been tried.
2. **Cloudflare bypass: FlareSolverr** (or Byparr, which uses the same API), running alongside.
   - Suwayomi has built-in settings for it: `flareSolverrEnabled` and `flareSolverrUrl` (default `http://localhost:8191`).
   - Also turn on `flareSolverrAsResponseFallback`. Users report 403 errors when it's off.
3. **Migration:** convert `tachimanga.db` into a Mihon-format backup and restore that into Suwayomi.
   - This is a one-off script: protobuf plus gzip, reading the db through NoteHaven's parser logic.
   - We haven't found any sign that Tachimanga itself exports `.tachibk`.
4. **Access from the phone:** use Tailscale (free).
   - The server stays off the public internet.
   - `tailscale serve` gives it HTTPS, which an https PWA needs.
5. **Tachivel's part, later and optional:**
   - At first the Comics tab just opens the Suwayomi WebUI.
   - Write a custom Tachivel-styled reader over Suwayomi's GraphQL API only if the stock UI annoys us.

## Hosting (free, always on)

| Option | What you get | Verdict |
|---|---|---|
| **Oracle Cloud Always Free** | Ampere A1 Arm, cut to **2 OCPU / 12 GB** on 2026-06-15; 200 GB disk; generous egress | **Pick.** Only free option with enough RAM for Suwayomi plus FlareSolverr's Chromium. |
| Old laptop / Mac mini / Pi at home | Whatever it has, plus Tailscale | Good fallback, and nobody can reclaim it. Costs electricity and needs a box that never sleeps. |
| Google Cloud e2-micro | 1 GB RAM, US regions only, tiny free egress (1 GB/month in most listings) | No. Too small for Chromium, and manga pages blow through the egress. |
| Render / Koyeb / HF Spaces free | 512 MB–16 GB, but they sleep and the disk resets | No. They sleep and forget the library. |

### Oracle catches

- **Idle reclaim:** a free instance is reclaimed if CPU (95th percentile), network *and* memory all stay under ~15% for 7 days.
  - Suwayomi's scheduled library updates plus a modest shape (e.g. 1 OCPU / 6 GB) should keep it above that.
  - Watch the first weeks.
- A1 capacity is often "out of host capacity" in busy regions, and Always Free A1 only works in the **home region** picked at signup. Pick a region with A1 capacity (Mumbai or Hyderabad are closest).
- Signup needs a card for verification. Oracle cut the limits quietly in 2026 and could do it again, so keep backups off the box.

## Open questions

- Hosting decision (Oracle vs a box at home).
- How well Asura (a big part of the library and Cloudflare-heavy) works through FlareSolverr in practice.
- Whether the stock WebUI on iPhone is good enough, or Tachivel builds its own reader.

## Sources

- Oracle free tier cut: [InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/), [Heise](https://www.heise.de/en/news/Oracle-halves-free-cloud-resources-11334516.html), [Oracle docs](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm)
- Suwayomi FlareSolverr config: [Configuring Suwayomi-Server](https://github.com/Suwayomi/Suwayomi-Server/wiki/Configuring-Suwayomi%E2%80%90Server), [issue #1591](https://github.com/Suwayomi/Suwayomi-Server/issues/1591), [Docker image](https://github.com/Suwayomi/Suwayomi-Server-docker)
- Suwayomi-WebUI releases: [v20260722.01](https://newreleases.io/project/github/Suwayomi/Suwayomi-WebUI/release/v20260722.01)
