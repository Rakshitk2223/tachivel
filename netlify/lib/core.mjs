// Tachivel cloud: one passphrase, one library (the current book + your bookmark).
// Pure request handling with injected stores so it can be unit-tested without Netlify.

const COOKIE = "tv_session";
const SESSION_DAYS = 180;
const MAX_FAILS = 5;                      // wrong passphrases allowed per window, per IP
const FAIL_WINDOW = 15 * 60 * 1000;
export const PART_MAX = 4.5 * 1024 * 1024; // a Netlify Function body tops out at 6 MB
const PARTS_MAX = 20;                     // ~90 MB books
const THEMES = new Set(["ember", "dark", "light"]);
const enc = new TextEncoder();

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });
const fail = (error, status) => json({ error }, status);

async function sha256(text) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

// Compare hashes, not strings, so timing doesn't leak how much of the passphrase was right.
async function samePassphrase(given, expected) {
  const [a, b] = await Promise.all([sha256(given), sha256(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// The signing key is random, created on first use and kept in a private store.
async function signingKey(secrets) {
  let raw = await secrets.get("session-key", { type: "arrayBuffer" });
  if (!raw) {
    await secrets.set("session-key", crypto.getRandomValues(new Uint8Array(32)).buffer);
    raw = await secrets.get("session-key", { type: "arrayBuffer" }); // re-read: if two logins raced, both use the winner
  }
  return crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}
async function makeSession(secrets, now) {
  const exp = now + SESSION_DAYS * 86400 * 1000;
  const sig = await crypto.subtle.sign("HMAC", await signingKey(secrets), enc.encode(`v1.${exp}`));
  return `${exp}.${b64url(sig)}`;
}
async function validSession(req, secrets, now) {
  const m = /(?:^|;\s*)tv_session=([^;]+)/.exec(req.headers.get("cookie") || "");
  if (!m) return false;
  const [exp, sig] = m[1].split(".");
  if (!sig || !(Number(exp) > now)) return false;
  try {
    return await crypto.subtle.verify("HMAC", await signingKey(secrets), fromB64url(sig), enc.encode(`v1.${exp}`));
  } catch { return false; }
}
const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// ---------- Bookmark ----------
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : null);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);
export function cleanBookmark(b) {
  if (!b || typeof b !== "object") return null;
  const at = typeof b.at === "number" && Number.isFinite(b.at) ? b.at : null;
  const book = str(b.book, 300);
  if (!at || !book) return null;
  return {
    at, book,
    chKey: str(b.chKey, 300), sText: str(b.sText, 1500),
    ch: int(b.ch, 0, 100000), s: int(b.s, 0, 100000),
    rate: typeof b.rate === "number" && b.rate >= 0.6 && b.rate <= 2.5 ? b.rate : null,
    voice: str(b.voice, 300), theme: THEMES.has(b.theme) ? b.theme : null, size: int(b.size, 10, 48),
  };
}

// ---------- Router ----------
// deps: { stores: { library, secrets, limits }, passphrase, ip, now }
export async function handle(req, deps) {
  const { stores, passphrase, ip = "unknown" } = deps;
  const now = deps.now ?? Date.now();
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const method = req.method;

  if (path === "/api/login" && method === "POST") {
    if (!passphrase) return fail("Tachivel has no passphrase set yet. Add TACHIVEL_PASSPHRASE in Netlify's environment variables.", 503);
    const limitKey = `fail-${hex(await sha256(ip)).slice(0, 32)}`;
    const rec = (await stores.limits.get(limitKey, { type: "json" })) || { n: 0, since: now };
    const fresh = now - rec.since > FAIL_WINDOW ? { n: 0, since: now } : rec;
    if (fresh.n >= MAX_FAILS) return fail("Too many wrong tries. Wait 15 minutes and try again.", 429);
    let given = "";
    try { given = String((await req.json()).passphrase || ""); } catch {}
    if (!given || given.length > 500 || !(await samePassphrase(given, passphrase))) {
      await stores.limits.setJSON(limitKey, { n: fresh.n + 1, since: fresh.since });
      return fail("That passphrase isn't right.", 401);
    }
    await stores.limits.delete(limitKey);
    return json({ in: true }, 200, { "set-cookie": cookie(await makeSession(stores.secrets, now), SESSION_DAYS * 86400) });
  }
  if (path === "/api/logout" && method === "POST") {
    return json({ in: false }, 200, { "set-cookie": cookie("", 0) });
  }

  // Everything below needs a session.
  if (!(await validSession(req, stores.secrets, now))) return fail("Sign in first.", 401);
  const lib = stores.library;

  if (path === "/api/me" && method === "GET") return json({ in: true });

  if (path === "/api/bookmark") {
    if (method === "GET") return json((await lib.get("bookmark", { type: "json" })) || null);
    if (method === "PUT") {
      const text = await req.text();
      if (text.length > 4096) return fail("Bookmark too large.", 413);
      let next;
      try { next = cleanBookmark(JSON.parse(text)); } catch { return fail("Bookmark isn't valid JSON.", 400); }
      if (!next) return fail("Bookmark is missing the book or time.", 400);
      // Last write wins: a device that was behind never drags you backwards.
      const current = await lib.get("bookmark", { type: "json" });
      if (current && current.at >= next.at) return json(current);
      await lib.setJSON("bookmark", next);
      return json(next);
    }
  }

  // The book is stored as numbered parts under an upload id; the manifest points at the finished upload.
  if (path === "/api/book") {
    if (method === "GET") return json((await lib.get("book", { type: "json" })) || null);
    if (method === "PUT") {
      let m;
      try { m = await req.json(); } catch { return fail("Manifest isn't valid JSON.", 400); }
      const upload = str(m?.upload, 40);
      const parts = int(m?.parts, 1, PARTS_MAX);
      if (!upload || !/^[a-z0-9-]+$/.test(upload) || !parts) return fail("Manifest is incomplete.", 400);
      for (let i = 0; i < parts; i++) {
        if (!(await lib.getMetadata(`part/${upload}/${i}`))) return fail(`Part ${i + 1} of ${parts} is missing. Upload again.`, 409);
      }
      const manifest = { upload, parts, size: int(m.size, 1, PARTS_MAX * PART_MAX), name: str(m.name, 300), title: str(m.title, 300), at: now };
      const previous = await lib.get("book", { type: "json" });
      await lib.setJSON("book", manifest);
      if (previous?.upload && previous.upload !== upload) {
        for (let i = 0; i < (previous.parts || 0); i++) await lib.delete(`part/${previous.upload}/${i}`);
      }
      return json(manifest);
    }
  }
  const part = /^\/api\/book\/parts\/([a-z0-9-]{1,40})\/(\d{1,2})$/.exec(path);
  if (part) {
    const key = `part/${part[1]}/${part[2]}`;
    if (+part[2] >= PARTS_MAX) return fail("Too many parts.", 400);
    if (method === "PUT") {
      const body = await req.arrayBuffer();
      if (!body.byteLength || body.byteLength > PART_MAX) return fail("Part is empty or too large.", 413);
      await lib.set(key, body);
      return json({ ok: true, bytes: body.byteLength });
    }
    if (method === "GET") {
      const data = await lib.get(key, { type: "arrayBuffer" });
      if (!data) return fail("Part not found.", 404);
      return new Response(data, { headers: { "content-type": "application/octet-stream", "cache-control": "private, max-age=31536000, immutable" } });
    }
  }
  return fail("Not found.", 404);
}
