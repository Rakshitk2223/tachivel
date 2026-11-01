// Tachivel API: your novels, your place in each, and your settings. One user.
// Sign-in happens before a request gets here (Tinyauth in front of Caddy), which sets Remote-User.
// The one exception is POST /api/upload, which takes a bearer token so scripts can push a new EPUB.
// Pure request handling with an injected store, so it can be unit-tested without a server.
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { epubMeta, sameTitle } from "./epub.mjs";
import { convertTmb } from "./tmb.mjs";

export const BOOK_MAX = 200 * 1024 * 1024;
const THEMES = new Set(["ember", "dark", "light", "snow", "midnight", "moss", "plum"]);

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const fail = (error, status) => json({ error }, status);

// Compare hashes, not strings, so timing doesn't leak how much of the token was right.
function sameToken(given, expected) {
  if (!given || !expected) return false;
  const h = (s) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(expected));
}

// ---------- Bookmark (one per book) ----------
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : null);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
export function cleanBookmark(b) {
  if (!b || typeof b !== "object") return null;
  const at = typeof b.at === "number" && Number.isFinite(b.at) ? b.at : null;
  if (!at) return null;
  return {
    at,
    chKey: str(b.chKey, 300), sText: str(b.sText, 1500),
    ch: int(b.ch, 0, 100000), s: int(b.s, 0, 100000),
    far: b.far && typeof b.far === "object" ? { ch: int(b.far.ch, 0, 100000), s: int(b.far.s, 0, 100000) } : null,
  };
}
// Settings that follow you between devices. Layout choices (panel, width) stay per device.
export function cleanSettings(v) {
  if (!v || typeof v !== "object" || !(typeof v.at === "number" && Number.isFinite(v.at))) return null;
  return {
    at: v.at,
    theme: THEMES.has(v.theme) ? v.theme : null,
    nightTheme: THEMES.has(v.nightTheme) ? v.nightTheme : null,
    followSystem: typeof v.followSystem === "boolean" ? v.followSystem : null,
    voice: str(v.voice, 300),
    rate: typeof v.rate === "number" && v.rate >= 0.6 && v.rate <= 2.5 ? v.rate : null,
    size: int(v.size, 10, 48),
  };
}

// ---------- Books ----------
async function addBook(store, bytes, { replace, name, now }) {
  if (!bytes.byteLength) return fail("The file is empty.", 400);
  if (bytes.byteLength > BOOK_MAX) return fail("Books over 200 MB aren't supported.", 413);
  const meta = epubMeta(bytes);
  if (!meta) return fail("That doesn't look like an EPUB.", 415);
  const books = await store.listBooks();
  let target = null;
  if (replace === "auto") target = books.find((b) => sameTitle(b.title, meta.title)) || null;
  else if (replace && replace !== "new") {
    target = books.find((b) => b.id === replace);
    if (!target) return fail("The book you're replacing isn't in your library any more.", 404);
  }
  const sha = createHash("sha256").update(bytes).digest("hex");
  if (target?.sha === sha) return json({ book: target, replaced: false, unchanged: true }, 200, { "x-unchanged": "1" });
  const book = {
    id: target?.id || randomUUID().slice(0, 8),
    title: meta.title || str(name, 300)?.replace(/\.epub$/i, "") || "Untitled",
    author: meta.author,
    name: str(name, 300),
    size: bytes.byteLength,
    sha,
    version: (target?.version || 0) + 1,
    addedAt: target?.addedAt || now,
    uploadedAt: now,
  };
  await store.putBook(book, bytes);
  return json({ book, replaced: !!target }, target ? 200 : 201);
}

// The identity header is only believed when Caddy's shared secret comes with it: Suwayomi runs third-party
// extension code on the same machine, and that code must not be able to claim to be you.
export function trustedUser(req, proxySecret) {
  if (proxySecret && !sameToken(req.headers.get("x-tachivel-proxy"), proxySecret)) return null;
  return req.headers.get("remote-user") || req.headers.get("remote-email") || null;
}

// deps: { store, uploadToken, proxySecret, now, notify(change) }
export async function handle(req, deps) {
  const { store, notify = () => {} } = deps;
  const now = deps.now ?? Date.now();
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const method = req.method;
  const user = trustedUser(req, deps.proxySecret);

  // Scripts (the weekly EPUB build) upload with a token instead of a sign-in. Same-title books are replaced in place.
  if (path === "/api/upload" && method === "POST") {
    const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") || "")?.[1];
    if (!sameToken(token, deps.uploadToken)) return fail("Upload token missing or wrong.", 401);
    const res = await addBook(store, new Uint8Array(await req.arrayBuffer()), { replace: "auto", name: url.searchParams.get("name"), now });
    if (res.ok && !res.headers.has("x-unchanged")) notify({ type: "books" });
    return res;
  }

  if (!user) return fail("Sign in first.", 401);

  if (path === "/api/me" && method === "GET") return json({ user });
  if (path === "/api/storage" && method === "GET") return json(await store.disk());
  // Tachimanga backup in, Suwayomi-restorable backup out (the app then hands it to Suwayomi's restore).
  if (path === "/api/tachimanga/convert" && method === "POST") {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.byteLength || bytes.byteLength > BOOK_MAX) return fail("The backup is empty or too large.", 413);
    try {
      const { file, stats } = await convertTmb(bytes);
      return new Response(file, { headers: { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="tachimanga.tachibk"', "x-stats": JSON.stringify(stats), "cache-control": "no-store" } });
    } catch (e) { return fail(e.message, 422); }
  }

  if (path === "/api/books" && method === "GET") return json(await store.listBooks());
  // ?replace=<id> replaces that book, ?replace=auto matches by title, anything else adds a new one.
  if (path === "/api/books" && method === "POST") {
    const res = await addBook(store, new Uint8Array(await req.arrayBuffer()), { replace: url.searchParams.get("replace"), name: url.searchParams.get("name"), now });
    if (res.ok && !res.headers.has("x-unchanged")) notify({ type: "books" });
    return res;
  }
  const bookPath = /^\/api\/books\/([^/]+)(\/file)?$/.exec(path);
  if (bookPath) {
    const id = bookPath[1];
    if (!store.validId(id)) return fail("Not found.", 404);
    const book = await store.getBook(id);
    if (!book) return fail("Not found.", 404);
    if (bookPath[2] && method === "GET") {
      // The sha is in the URL the app uses, so the file can be cached forever on each device.
      if (req.headers.get("if-none-match") === `"${book.sha}"`) return new Response(null, { status: 304 });
      const f = await store.bookFile(id);
      if (!f) return fail("The file is missing.", 404);
      return new Response(f.stream(), { headers: { "content-type": "application/epub+zip", "content-length": String(f.size), etag: `"${book.sha}"`, "cache-control": "private, max-age=31536000, immutable" } });
    }
    if (!bookPath[2] && method === "GET") return json(book);
    if (!bookPath[2] && method === "DELETE") { await store.deleteBook(id); notify({ type: "books" }); return json({ deleted: id }); }
  }

  if (path === "/api/progress" && method === "GET") return json(await store.allProgress());
  const prog = /^\/api\/progress\/([^/]+)$/.exec(path);
  if (prog && method === "PUT") {
    const id = prog[1];
    if (!store.validId(id) || !(await store.getBook(id))) return fail("Not found.", 404);
    const text = await req.text();
    if (text.length > 4096) return fail("Bookmark too large.", 413);
    let next;
    try { next = cleanBookmark(JSON.parse(text)); } catch { return fail("Bookmark isn't valid JSON.", 400); }
    if (!next) return fail("Bookmark is missing its time.", 400);
    // Last write wins: a device that was behind never drags you backwards.
    const current = await store.getProgress(id);
    if (current && current.at >= next.at) return json(current);
    await store.putProgress(id, next);
    notify({ type: "progress", id });
    return json(next);
  }

  if (path === "/api/settings" && method === "GET") return json(await store.getSettings());
  if (path === "/api/settings" && method === "PUT") {
    let next;
    try { next = cleanSettings(await req.json()); } catch { return fail("Settings aren't valid JSON.", 400); }
    if (!next) return fail("Settings are missing their time.", 400);
    const current = await store.getSettings();
    if (current && current.at >= next.at) return json(current);
    await store.putSettings(next);
    notify({ type: "settings" });
    return json(next);
  }

  return fail("Not found.", 404);
}
