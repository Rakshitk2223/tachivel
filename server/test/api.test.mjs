import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { handle } from "../src/core.mjs";
import { fileStore } from "../src/store.mjs";
import { sameTitle } from "../src/epub.mjs";

const TOKEN = "weekly-build-token";
const epub = (title, author = "Someone", extra = "") => zipSync({
  mimetype: strToU8("application/epub+zip"),
  "META-INF/container.xml": strToU8('<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>'),
  "OEBPS/content.opf": strToU8(`<package><metadata><dc:title>${title}</dc:title><dc:creator>${author}</dc:creator></metadata></package>`),
  "OEBPS/ch1.xhtml": strToU8(`<p>Chapter one ${extra}</p>`),
});

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "tachivel-"));
  const store = fileStore(dir);
  const changes = [];
  let clock = 1000;
  const call = (method, path, body, headers = { "remote-user": "rakshit" }) => {
    const init = { method, headers };
    if (body !== undefined) init.body = body instanceof Uint8Array || typeof body === "string" ? body : JSON.stringify(body);
    return handle(new Request(`https://x${path}`, init), { store, uploadToken: TOKEN, now: clock++, notify: (c) => changes.push(c) });
  };
  return { call, changes, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

test("nothing works without a signed-in user", async () => {
  const s = await setup();
  for (const [m, p] of [["GET", "/api/me"], ["GET", "/api/books"], ["POST", "/api/books"], ["GET", "/api/progress"], ["PUT", "/api/settings"]]) {
    assert.equal((await s.call(m, p, undefined, {})).status, 401, `${m} ${p}`);
  }
  await s.cleanup();
});

test("upload reads title and author from the EPUB, lists it, and serves the file back intact", async () => {
  const s = await setup();
  const bytes = epub("I Shall Pursue Eternity", "Rakshit Kumar");
  const res = await s.call("POST", "/api/books?name=ISPE.epub", bytes);
  assert.equal(res.status, 201);
  const { book } = await res.json();
  assert.equal(book.title, "I Shall Pursue Eternity");
  assert.equal(book.author, "Rakshit Kumar");
  assert.equal(book.version, 1);
  const list = await (await s.call("GET", "/api/books")).json();
  assert.deepEqual(list.map((b) => b.id), [book.id]);
  const file = await s.call("GET", `/api/books/${book.id}/file`);
  assert.equal(file.headers.get("etag"), `"${book.sha}"`);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  assert.equal((await s.call("GET", `/api/books/${book.id}/file`, undefined, { "remote-user": "rakshit", "if-none-match": `"${book.sha}"` })).status, 304);
  assert.deepEqual(s.changes, [{ type: "books" }]);
  await s.cleanup();
});

test("replacing a book keeps its id and your place; a new copy can also sit beside it", async () => {
  const s = await setup();
  const { book } = await (await s.call("POST", "/api/books", epub("Lord of the Mysteries"))).json();
  await s.call("PUT", `/api/progress/${book.id}`, { at: 5, ch: 12, s: 3 });
  const r = await (await s.call("POST", `/api/books?replace=${book.id}`, epub("Lord of the Mysteries", "Someone", "v2"))).json();
  assert.equal(r.replaced, true);
  assert.equal(r.book.id, book.id);
  assert.equal(r.book.version, 2);
  assert.equal(r.book.addedAt, book.addedAt);
  assert.equal((await (await s.call("GET", "/api/progress")).json())[book.id].ch, 12);
  const side = await (await s.call("POST", "/api/books?replace=new", epub("Lord of the Mysteries", "Someone", "v3"))).json();
  assert.notEqual(side.book.id, book.id);
  assert.equal((await (await s.call("GET", "/api/books")).json()).length, 2);
  await s.cleanup();
});

test("token upload replaces the book with the same title, ignores identical files, and rejects bad tokens", async () => {
  const s = await setup();
  const first = await (await s.call("POST", "/api/books", epub("I Shall Pursue Eternity"))).json();
  const auth = { authorization: `Bearer ${TOKEN}` };
  const up = await s.call("POST", "/api/upload?name=x.epub", epub("I Shall Pursue Eternity (v236)", "x", "new chapter"), auth);
  assert.equal(up.status, 200);
  const body = await up.json();
  assert.equal(body.book.id, first.book.id);
  const again = await (await s.call("POST", "/api/upload", epub("I Shall Pursue Eternity (v236)", "x", "new chapter"), auth)).json();
  assert.equal(again.unchanged, true);
  assert.equal(s.changes.filter((c) => c.type === "books").length, 2, "an identical re-upload doesn't wake every device");
  assert.equal((await s.call("POST", "/api/upload", epub("x"), { authorization: "Bearer nope" })).status, 401);
  assert.equal((await s.call("POST", "/api/upload", epub("x"), {})).status, 401);
  // The token only opens the upload door, nothing else.
  assert.equal((await s.call("GET", "/api/books", undefined, auth)).status, 401);
  await s.cleanup();
});

test("non-EPUBs and unknown replace targets are refused", async () => {
  const s = await setup();
  assert.equal((await s.call("POST", "/api/books", new TextEncoder().encode("not a zip"))).status, 415);
  assert.equal((await s.call("POST", "/api/books?replace=deadbeef", epub("x"))).status, 404);
  assert.equal((await s.call("GET", "/api/books/..%2Fsettings")).status, 404);
  await s.cleanup();
});

test("progress: newest wins per book, junk is dropped, unknown books are refused", async () => {
  const s = await setup();
  const { book } = await (await s.call("POST", "/api/books", epub("Shadow Slave"))).json();
  assert.equal((await (await s.call("PUT", `/api/progress/${book.id}`, { at: 10, ch: 4, s: 2, junk: "x".repeat(10) })).json()).ch, 4);
  assert.equal((await (await s.call("PUT", `/api/progress/${book.id}`, { at: 9, ch: 1, s: 0 })).json()).ch, 4);
  assert.equal((await s.call("PUT", `/api/progress/${book.id}`, { ch: 1 })).status, 400);
  assert.equal((await s.call("PUT", "/api/progress/nope", { at: 11 })).status, 404);
  const all = await (await s.call("GET", "/api/progress")).json();
  assert.equal(all[book.id].junk, undefined);
  await s.cleanup();
});

test("settings sync: newest wins, unknown themes are dropped", async () => {
  const s = await setup();
  assert.equal((await (await s.call("PUT", "/api/settings", { at: 5, theme: "plum", rate: 1.25 })).json()).theme, "plum");
  assert.equal((await (await s.call("PUT", "/api/settings", { at: 4, theme: "snow" })).json()).theme, "plum");
  assert.equal((await (await s.call("PUT", "/api/settings", { at: 6, theme: "neon" })).json()).theme, null);
  await s.cleanup();
});

test("deleting a book removes its file and progress", async () => {
  const s = await setup();
  const { book } = await (await s.call("POST", "/api/books", epub("Reverend Insanity"))).json();
  await s.call("PUT", `/api/progress/${book.id}`, { at: 1, ch: 1, s: 1 });
  assert.equal((await s.call("DELETE", `/api/books/${book.id}`)).status, 200);
  assert.equal((await s.call("GET", `/api/books/${book.id}`)).status, 404);
  assert.deepEqual(await (await s.call("GET", "/api/progress")).json(), {});
  await s.cleanup();
});

test("titles match despite version tags and punctuation", () => {
  assert.ok(sameTitle("I Shall Pursue Eternity", "i shall pursue eternity (v236)"));
  assert.ok(sameTitle("Lord of the Mysteries!", "Lord of the Mysteries [Complete]"));
  assert.ok(!sameTitle("Shadow Slave", "Shadow Slave 2"));
  assert.ok(!sameTitle("", ""));
});

test("storage reports the disk Tachivel lives on", async () => {
  const s = await setup();
  const d = await (await s.call("GET", "/api/storage")).json();
  assert.ok(d.total > 0 && d.used >= 0 && d.free >= 0 && d.used <= d.total);
  await s.cleanup();
});

test("a Tachimanga backup converts to a Mihon-format backup with the library, chapters and categories", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { mkdtemp, readFile } = await import("node:fs/promises");
  const { gunzipSync } = await import("fflate");
  const dir = await mkdtemp(join(tmpdir(), "tmb-test-"));
  const db = new DatabaseSync(join(dir, "tachimanga.db"));
  db.exec(`CREATE TABLE manga (id INTEGER, url TEXT, title TEXT, artist TEXT, author TEXT, description TEXT, genre TEXT, status INTEGER, thumbnail_url TEXT, in_library INTEGER, in_library_at INTEGER, source INTEGER);
    CREATE TABLE chapter (id INTEGER, url TEXT, name TEXT, date_upload INTEGER, chapter_number REAL, scanlator TEXT, read INTEGER, bookmark INTEGER, last_page_read INTEGER, last_read_at INTEGER, fetched_at INTEGER, source_order INTEGER, manga INTEGER);
    CREATE TABLE category (id INTEGER, name TEXT, "order" INTEGER, is_default INTEGER, is_delete INTEGER);
    CREATE TABLE categorymanga (id INTEGER, category INTEGER, manga INTEGER);
    CREATE TABLE history (id INTEGER, manga_id INTEGER, last_chapter_id INTEGER, last_read_at INTEGER, read_duration INTEGER, is_delete INTEGER);
    CREATE TABLE source (id INTEGER, name TEXT);
    INSERT INTO manga VALUES (1, '/s/one', 'Series One', NULL, 'Author', 'Desc', 'Action, Fantasy', 1, 'http://x/c.jpg', 1, 1700000000, 6247824327199706550), (2, '/s/two', 'Not In Library', NULL, NULL, NULL, '', 0, NULL, 0, 0, 1);
    INSERT INTO chapter VALUES (10, '/c/1', 'Chapter 1', 1700000000000, 1, NULL, 1, 0, 12, 1700000100, 1700000000, 0, 1), (11, '/c/2', 'Chapter 2', 1700000000000, 2, NULL, 0, 1, 0, 0, 1700000000, 1, 1);
    INSERT INTO category VALUES (5, 'Reading', 1, 0, 0), (6, 'Default', 0, 1, 0);
    INSERT INTO categorymanga VALUES (1, 5, 1);
    INSERT INTO history VALUES (1, 1, 10, 1700000200, 300, 0);
    INSERT INTO source VALUES (6247824327199706550, 'Asura Scans');`);
  db.close();
  const contents = zipSync({ "tachimanga.db": new Uint8Array(await readFile(join(dir, "tachimanga.db"))) });
  const tmb = zipSync({ "meta.json": strToU8("{}"), "contents.zip": contents });
  const s = await setup();
  const res = await s.call("POST", "/api/tachimanga/convert", tmb);
  assert.equal(res.status, 200);
  assert.deepEqual(JSON.parse(res.headers.get("x-stats")), { series: 1, chapters: 2, read: 1, categories: 1, sources: 1 });
  const raw = new TextDecoder("latin1").decode(gunzipSync(new Uint8Array(await res.arrayBuffer())));
  for (const want of ["Series One", "/c/1", "Chapter 2", "Reading", "Asura Scans", "Fantasy"]) assert.ok(raw.includes(want), want);
  assert.ok(!raw.includes("Not In Library"), "only library series are exported");
  assert.equal((await s.call("POST", "/api/tachimanga/convert", strToU8("nope"))).status, 422);
  await s.cleanup();
  await rm(dir, { recursive: true, force: true });
});

test("with a proxy secret set, the identity header alone is not enough", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tachivel-"));
  const store = fileStore(dir);
  const call = (headers) => handle(new Request("https://x/api/me", { headers }), { store, proxySecret: "caddy-only" });
  assert.equal((await call({ "remote-user": "intruder" })).status, 401, "a co-located process can't just claim to be you");
  assert.equal((await call({ "remote-user": "intruder", "x-tachivel-proxy": "guess" })).status, 401);
  assert.equal((await call({ "remote-user": "rakshit", "x-tachivel-proxy": "caddy-only" })).status, 200);
  await rm(dir, { recursive: true, force: true });
});

test("the Netlify mirror fetches a new build once, files it as a newer copy, and signs in again when the session expires", async () => {
  const { startNetlifyMirror } = await import("../src/mirror.mjs");
  const dir = await mkdtemp(join(tmpdir(), "mirror-"));
  const book = epub("I Shall Pursue Eternity", "Rakshit Kumar", "build 1");
  let upload = "u1", logins = 0, sessionValid = true;
  const fake = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === "/api/login") { logins++; sessionValid = true; return new Response("{}", { headers: { "set-cookie": "tv_session=ok; Path=/" } }); }
    if (!sessionValid || init.headers?.cookie !== "tv_session=ok") return new Response("{}", { status: 401 });
    if (path === "/api/book") return Response.json({ upload, parts: 2, name: "ISPE.epub" });
    const i = Number(path.split("/").pop()), half = Math.ceil(book.length / 2);
    return new Response(i === 0 ? book.slice(0, half) : book.slice(half));
  };
  const got = [];
  const m = startNetlifyMirror({ site: "https://netlify.test", passphrase: "p", dataDir: dir, fetchImpl: fake, log: () => {}, intervalMs: 1e9,
    upload: async (bytes, name) => { got.push({ bytes, name }); return { book: { id: "b1", title: "I Shall Pursue Eternity" }, replaced: got.length > 1 }; } });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(got.length, 1);
  assert.deepEqual(got[0].bytes, book, "parts are stitched back into the exact file");
  assert.equal(await m.check(), "same", "the same Netlify upload isn't fetched twice");
  upload = "u2"; sessionValid = false;
  assert.equal(await m.check(), "updated");
  assert.equal(logins, 2, "an expired session means exactly one fresh sign-in");
  m.stop();
  await rm(dir, { recursive: true, force: true });
});
