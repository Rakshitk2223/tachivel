import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../netlify/functions/sync.mjs";

// In-memory stand-in for a Netlify Blobs store.
function memoryStore() {
  const m = new Map();
  return {
    m,
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
  };
}
const CODE = "ABCD-EFGH-JKLM-NP23";
const req = (method, body, code = CODE) =>
  new Request("https://x/api/sync", { method, headers: { "x-sync-code": code }, body: body === undefined ? undefined : JSON.stringify(body) });
const mark = (at, extra = {}) => ({ at, book: "I Shall Pursue Eternity", chKey: "Chapter 94", sText: "Honest.”", ch: 100, s: 57, rate: 1.1, voice: "Zoe", theme: "ember", size: 20, ...extra });

test("rejects bad codes", async () => {
  const store = memoryStore();
  for (const code of ["", "abcd", "ABCD-EFGH-JKLM-NPO1", "ABCD-EFGH-JKLM"]) {
    assert.equal((await handle(req("GET", undefined, code), store)).status, 400);
  }
});

test("empty code returns null, then stores and returns a bookmark", async () => {
  const store = memoryStore();
  assert.equal(await (await handle(req("GET"), store)).json(), null);
  assert.equal((await handle(req("PUT", mark(1000)), store)).status, 200);
  assert.equal((await (await handle(req("GET"), store)).json()).s, 57);
});

test("codes are case-insensitive and stored under a hash, not the code", async () => {
  const store = memoryStore();
  await handle(req("PUT", mark(1000), CODE.toLowerCase()), store);
  assert.equal((await (await handle(req("GET"), store)).json()).ch, 100);
  assert.ok(![...store.m.keys()].some((k) => k.includes("ABCD")));
});

test("an older bookmark never overwrites a newer one", async () => {
  const store = memoryStore();
  await handle(req("PUT", mark(2000, { s: 80 })), store);
  const res = await (await handle(req("PUT", mark(1000, { s: 10 })), store)).json();
  assert.equal(res.s, 80);
  assert.equal((await (await handle(req("GET"), store)).json()).s, 80);
});

test("drops unknown fields and bad values; rejects oversized or broken bodies", async () => {
  const store = memoryStore();
  const res = await (await handle(req("PUT", mark(1000, { evil: "<script>", theme: "neon", rate: 99 })), store)).json();
  assert.equal(res.evil, undefined);
  assert.equal(res.theme, null);
  assert.equal(res.rate, null);
  assert.equal((await handle(req("PUT", mark(3000, { sText: "x".repeat(5000) })), store)).status, 413);
  const broken = new Request("https://x/api/sync", { method: "PUT", headers: { "x-sync-code": CODE }, body: "{not json" });
  assert.equal((await handle(broken, store)).status, 400);
  assert.equal((await handle(req("PUT", { at: 5 }), store)).status, 400);
  assert.equal((await handle(req("DELETE"), store)).status, 405);
});
