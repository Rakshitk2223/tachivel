// Bookmark sync: stores one small JSON bookmark per sync code in Netlify Blobs.
// Only the reading position and settings are stored; the book itself never leaves the device.
import { getStore } from "@netlify/blobs";

export const config = { path: "/api/sync" };

// XXXX-XXXX-XXXX-XXXX from a 32-letter alphabet: 80 bits, not guessable.
const CODE = /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/;
const MAX_BODY = 4096;
const THEMES = new Set(["ember", "dark", "light"]);

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function keyFor(code) {
  // Store under a hash so the blob keys never contain the code itself.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : null);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

// Keep only the fields we know, with sane types and sizes.
export function cleanBookmark(b) {
  if (!b || typeof b !== "object") return null;
  const at = typeof b.at === "number" && Number.isFinite(b.at) ? b.at : null;
  const book = str(b.book, 300);
  if (!at || !book) return null;
  return {
    at,
    book,
    chKey: str(b.chKey, 300),
    sText: str(b.sText, 1500),
    ch: int(b.ch, 0, 100000),
    s: int(b.s, 0, 100000),
    rate: typeof b.rate === "number" && b.rate >= 0.6 && b.rate <= 2.5 ? b.rate : null,
    voice: str(b.voice, 300),
    theme: THEMES.has(b.theme) ? b.theme : null,
    size: int(b.size, 10, 48),
  };
}

export async function handle(req, store) {
  const code = (req.headers.get("x-sync-code") || "").trim().toUpperCase();
  if (!CODE.test(code)) return json({ error: "That sync code isn't valid." }, 400);
  const key = await keyFor(code);

  if (req.method === "GET") {
    return json((await store.get(key, { type: "json" })) || null);
  }
  if (req.method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ error: "Bookmark too large." }, 413);
    let body;
    try { body = JSON.parse(text); } catch { return json({ error: "Bookmark isn't valid JSON." }, 400); }
    const next = cleanBookmark(body);
    if (!next) return json({ error: "Bookmark is missing the book or time." }, 400);
    // Last write wins: an older bookmark (from a device that was behind) never overwrites a newer one.
    const current = await store.get(key, { type: "json" });
    if (current && current.at >= next.at) return json(current);
    await store.setJSON(key, next);
    return json(next);
  }
  return json({ error: "Use GET or PUT." }, 405);
}

export default (req) => handle(req, getStore("bookmarks"));
