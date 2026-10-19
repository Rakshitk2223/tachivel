import test from "node:test";
import assert from "node:assert/strict";
import { handle, PART_MAX } from "../netlify/lib/core.mjs";

// In-memory stand-in for a Netlify Blobs store.
function memoryStore() {
  const m = new Map();
  return {
    m,
    async get(k, opts) {
      if (!m.has(k)) return null;
      const v = m.get(k);
      return opts?.type === "json" ? JSON.parse(v) : v;
    },
    async getMetadata(k) { return m.has(k) ? {} : null; },
    async set(k, v) { m.set(k, v); },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async delete(k) { m.delete(k); },
  };
}
const PASS = "cultivate the long road";
function setup() {
  const stores = { library: memoryStore(), secrets: memoryStore(), limits: memoryStore() };
  let jar = "";
  const call = async (method, path, body, { raw = false, ip = "1.2.3.4", now, cookie } = {}) => {
    const headers = {};
    const c = cookie ?? jar;
    if (c) headers.cookie = c;
    const init = { method, headers };
    if (body !== undefined) init.body = raw ? body : JSON.stringify(body);
    const res = await handle(new Request(`https://x${path}`, init), { stores, passphrase: PASS, ip, now });
    const set = res.headers.get("set-cookie");
    if (set) jar = set.split(";")[0];
    return res;
  };
  return { stores, call, login: () => call("POST", "/api/login", { passphrase: PASS }), get jar() { return jar; } };
}

test("everything except login is locked without a session", async () => {
  const { call } = setup();
  for (const [m, p] of [["GET", "/api/me"], ["GET", "/api/book"], ["GET", "/api/bookmark"], ["GET", "/api/book/parts/u1/0"], ["PUT", "/api/bookmark"]]) {
    assert.equal((await call(m, p)).status, 401, `${m} ${p}`);
  }
});

test("right passphrase gives a secure session cookie; wrong one doesn't", async () => {
  const t = setup();
  assert.equal((await t.call("POST", "/api/login", { passphrase: "nope" })).status, 401);
  assert.equal(t.jar, "");
  const res = await t.login();
  assert.equal(res.status, 200);
  const sc = res.headers.get("set-cookie");
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict"]) assert.ok(sc.includes(flag), flag);
  assert.equal((await t.call("GET", "/api/me")).status, 200);
});

test("forged, tampered or expired cookies are rejected", async () => {
  const t = setup();
  await t.login();
  const [exp, sig] = t.jar.split("=")[1].split(".");
  assert.equal((await t.call("GET", "/api/me", undefined, { cookie: `tv_session=${Number(exp) + 1}.${sig}` })).status, 401);
  assert.equal((await t.call("GET", "/api/me", undefined, { cookie: "tv_session=9999999999999.AAAA" })).status, 401);
  assert.equal((await t.call("GET", "/api/me", undefined, { now: Number(exp) + 1 })).status, 401);
});

test("five wrong tries lock that IP for 15 minutes, even with the right passphrase", async () => {
  const t = setup();
  for (let i = 0; i < 5; i++) await t.call("POST", "/api/login", { passphrase: "wrong" });
  assert.equal((await t.login()).status, 429);
  assert.equal((await t.call("POST", "/api/login", { passphrase: PASS }, { ip: "5.6.7.8" })).status, 200);
  assert.equal((await t.call("POST", "/api/login", { passphrase: PASS }, { now: Date.now() + 16 * 60 * 1000 })).status, 200);
});

test("logout clears the cookie", async () => {
  const t = setup();
  await t.login();
  await t.call("POST", "/api/logout");
  assert.equal((await t.call("GET", "/api/me")).status, 401);
});

test("bookmark: newest wins, junk is dropped", async () => {
  const t = setup();
  await t.login();
  const mark = (at, s) => ({ at, book: "I Shall Pursue Eternity", chKey: "Chapter 94", sText: "Honest.", ch: 100, s, evil: "<x>" });
  await t.call("PUT", "/api/bookmark", mark(2000, 80));
  assert.equal((await (await t.call("PUT", "/api/bookmark", mark(1000, 10))).json()).s, 80);
  const got = await (await t.call("GET", "/api/bookmark")).json();
  assert.equal(got.s, 80);
  assert.equal(got.evil, undefined);
});

test("book: parts upload, manifest needs every part, old upload is cleaned up, parts download intact", async () => {
  const t = setup();
  await t.login();
  const a = new Uint8Array([1, 2, 3]), b = new Uint8Array([4, 5]);
  await t.call("PUT", "/api/book/parts/up1/0", a, { raw: true });
  assert.equal((await t.call("PUT", "/api/book", { upload: "up1", parts: 2, size: 5, title: "Book" })).status, 409);
  await t.call("PUT", "/api/book/parts/up1/1", b, { raw: true });
  assert.equal((await t.call("PUT", "/api/book", { upload: "up1", parts: 2, size: 5, title: "Book" })).status, 200);
  const back = new Uint8Array(await (await t.call("GET", "/api/book/parts/up1/1")).arrayBuffer());
  assert.deepEqual([...back], [4, 5]);
  // A newer build replaces it and the old parts are deleted.
  await t.call("PUT", "/api/book/parts/up2/0", a, { raw: true });
  await t.call("PUT", "/api/book", { upload: "up2", parts: 1, size: 3, title: "Book" });
  assert.equal((await (await t.call("GET", "/api/book")).json()).upload, "up2");
  assert.ok(![...t.stores.library.m.keys()].some((k) => k.startsWith("part/up1/")));
});

test("book: rejects oversized parts and path tricks", async () => {
  const t = setup();
  await t.login();
  assert.equal((await t.call("PUT", "/api/book/parts/up1/0", new Uint8Array(PART_MAX + 1), { raw: true })).status, 413);
  assert.equal((await t.call("PUT", "/api/book/parts/../secrets/0", new Uint8Array(1), { raw: true })).status, 404);
  assert.equal((await t.call("PUT", "/api/book", { upload: "../x", parts: 1 })).status, 400);
});
