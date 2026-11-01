// Tachimanga .tmb → Mihon-format backup (.tachibk) that Suwayomi can restore.
// A .tmb is a zip holding contents.zip, which holds tachimanga.db: Tachidesk's own schema (Tachimanga runs Suwayomi inside).
// We read the library from it and write the protobuf Mihon/Suwayomi expect (field numbers from Mihon's Backup*.kt), gzipped.
import { unzipSync, gzipSync } from "fflate";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------- Minimal protobuf writer ----------
const enc = new TextEncoder();
function varint(out, v) {
  let n = BigInt.asUintN(64, BigInt(v));
  while (n > 127n) { out.push(Number((n & 127n) | 128n)); n >>= 7n; }
  out.push(Number(n));
}
const key = (out, field, wire) => varint(out, (field << 3) | wire);
function msg(fields) { // fields: [fieldNo, type, value] with type int | bool | string | float | bytes
  const out = [];
  for (const [f, t, v] of fields) {
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (t === "int" || t === "bool") { key(out, f, 0); varint(out, t === "bool" ? (v ? 1 : 0) : v); }
    else if (t === "float") { key(out, f, 5); const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); out.push(...b); }
    else { const b = t === "string" ? enc.encode(v) : v; key(out, f, 2); varint(out, b.length); for (let i = 0; i < b.length; i += 65536) out.push(...b.subarray(i, i + 65536)); }
  }
  return Uint8Array.from(out);
}
const ms = (t) => { const n = Number(t) || 0; return n && n < 1e12 ? n * 1000 : n; }; // Tachidesk stores seconds in most columns

export function backupFromDb(db) {
  const has = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some((x) => x.name === c);
  const cats = db.prepare(`SELECT id, name, "order" AS ord FROM category WHERE ${has("category", "is_delete") ? "COALESCE(is_delete, 0) = 0 AND" : ""} COALESCE(is_default, 0) = 0 ORDER BY "order"`).all();
  const order = new Map(cats.map((c, i) => [c.id, i + 1]));
  const mangaCats = new Map();
  for (const r of db.prepare("SELECT manga, category FROM categorymanga").all()) if (order.has(r.category)) (mangaCats.get(r.manga) || mangaCats.set(r.manga, []).get(r.manga)).push(order.get(r.category));
  const history = new Map();
  for (const r of db.prepare(`SELECT manga_id, last_chapter_id, last_read_at, read_duration FROM history ${has("history", "is_delete") ? "WHERE COALESCE(is_delete, 0) = 0" : ""}`).all()) history.set(r.last_chapter_id, r);
  const sources = new Map(db.prepare("SELECT CAST(id AS TEXT) AS id, name FROM source").all().map((s) => [s.id, s.name]));
  const chaptersOf = db.prepare("SELECT * FROM chapter WHERE manga = ? ORDER BY source_order");
  // Source ids are 64-bit and overflow JS numbers, so they come out as text.
  const library = db.prepare("SELECT id, url, title, artist, author, description, genre, status, thumbnail_url, in_library_at, CAST(source AS TEXT) AS source_id FROM manga WHERE in_library = 1").all();

  const parts = [];
  const usedSources = new Set();
  let chapterCount = 0, readCount = 0;
  for (const m of library) {
    usedSources.add(m.source_id);
    const chapters = chaptersOf.all(m.id);
    const hist = [];
    const chMsgs = chapters.map((c) => {
      chapterCount++; if (c.read) readCount++;
      const h = history.get(c.id);
      if (h) hist.push(msg([[1, "string", c.url], [2, "int", ms(h.last_read_at)], [3, "int", Number(h.read_duration) || 0]]));
      else if (c.last_read_at) hist.push(msg([[1, "string", c.url], [2, "int", ms(c.last_read_at)]]));
      return msg([[1, "string", c.url], [2, "string", c.name || ""], [3, "string", c.scanlator], [4, "bool", !!c.read], [5, "bool", !!c.bookmark],
        [6, "int", Number(c.last_page_read) || 0], [7, "int", ms(c.fetched_at)], [8, "int", ms(c.date_upload)], [9, "float", Number(c.chapter_number)], [10, "int", Number(c.source_order) || 0]]);
    });
    const genre = (m.genre || "").split(",").map((g) => g.trim()).filter(Boolean);
    const fields = [[1, "int", BigInt(m.source_id)], [2, "string", m.url], [3, "string", m.title], [4, "string", m.artist], [5, "string", m.author], [6, "string", m.description],
      [8, "int", Number(m.status) || 0], [9, "string", m.thumbnail_url], [13, "int", ms(m.in_library_at)], [100, "bool", true]];
    const body = [msg(fields)];
    for (const g of genre) body.push(msg([[7, "string", g]]));
    for (const c of chMsgs) body.push(msg([[16, "bytes", c]]));
    for (const o of mangaCats.get(m.id) || []) body.push(msg([[17, "int", o]]));
    for (const h of hist) body.push(msg([[104, "bytes", h]]));
    parts.push(msg([[1, "bytes", concat(body)]]));
  }
  for (const c of cats) parts.push(msg([[2, "bytes", msg([[1, "string", c.name], [2, "int", order.get(c.id)]])]]));
  for (const id of usedSources) parts.push(msg([[101, "bytes", msg([[1, "string", sources.get(id) || ""], [2, "int", BigInt(id)]])]]));
  return { backup: concat(parts), stats: { series: library.length, chapters: chapterCount, read: readCount, categories: cats.length, sources: usedSources.size } };
}
function concat(arrs) { const n = arrs.reduce((s, a) => s + a.length, 0); const out = new Uint8Array(n); let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; } return out; }

// bytes of a .tmb → { file: gzipped .tachibk bytes, stats }
export async function convertTmb(bytes) {
  const outer = unzipSync(bytes, { filter: (f) => f.name === "contents.zip" });
  if (!outer["contents.zip"]) throw new Error("This doesn't look like a Tachimanga backup (no contents.zip inside).");
  const inner = unzipSync(outer["contents.zip"], { filter: (f) => /(^|\/)tachimanga\.db$/.test(f.name) });
  const dbBytes = Object.values(inner)[0];
  if (!dbBytes) throw new Error("The backup has no tachimanga.db inside.");
  const dir = await mkdtemp(join(tmpdir(), "tmb-"));
  try {
    await writeFile(join(dir, "t.db"), dbBytes);
    const db = new DatabaseSync(join(dir, "t.db"), { readOnly: true });
    try { const { backup, stats } = backupFromDb(db); return { file: gzipSync(backup), stats }; } finally { db.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
}
