// Netlify → Oracle mirror for the novel. The office laptop can only reach tachivel.netlify.app, so the weekly
// build lands there; this server fetches it from Netlify (server to server) and files it on its own shelf.
//   NETLIFY_SITE        e.g. https://tachivel.netlify.app
//   NETLIFY_PASSPHRASE  the v1 site's passphrase (TACHIVEL_PASSPHRASE on Netlify)
// Only progress is per site: reading places are not synced between the two (by design).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export function startNetlifyMirror({ site, passphrase, dataDir, upload, intervalMs = 15 * 60 * 1000, fetchImpl = fetch, log = console.log }) {
  const stateFile = join(dataDir, "netlify-mirror.json");
  let cookie = null, running = false, timer = null;

  async function login() {
    const res = await fetchImpl(`${site}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ passphrase }) });
    if (!res.ok) throw new Error(`Netlify sign-in failed (${res.status})`);
    cookie = (res.headers.get("set-cookie") || "").split(";")[0];
  }
  // Signed requests; one fresh sign-in if the session expired (the v1 site rate-limits sign-ins, so never loop).
  async function get(path) {
    if (!cookie) await login();
    let res = await fetchImpl(`${site}${path}`, { headers: { cookie } });
    if (res.status === 401) { await login(); res = await fetchImpl(`${site}${path}`, { headers: { cookie } }); }
    if (!res.ok) throw new Error(`${path} → ${res.status}`);
    return res;
  }

  async function check() {
    if (running) return null;
    running = true;
    try {
      const manifest = await (await get("/api/book")).json();
      if (!manifest?.upload) return "empty";
      const state = JSON.parse(await readFile(stateFile, "utf8").catch(() => "{}"));
      if (state.upload === manifest.upload) return "same";
      const parts = [];
      for (let i = 0; i < manifest.parts; i++) parts.push(new Uint8Array(await (await get(`/api/book/parts/${manifest.upload}/${i}`)).arrayBuffer()));
      const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0; for (const p of parts) { bytes.set(p, o); o += p.length; }
      const r = await upload(bytes, manifest.name || "book.epub");
      await mkdir(dataDir, { recursive: true });
      await writeFile(stateFile, JSON.stringify({ upload: manifest.upload, at: Date.now(), book: r?.book?.id }));
      log(`Netlify mirror: ${r?.unchanged ? "already had" : r?.replaced ? "updated" : "added"} ${r?.book?.title || manifest.name} (${(bytes.length / 1048576).toFixed(1)} MB)`);
      return r?.unchanged ? "same" : "updated";
    } catch (e) { log(`Netlify mirror: ${e.message}`); return "error"; }
    finally { running = false; }
  }

  check();
  timer = setInterval(check, intervalMs);
  timer.unref?.();
  return { check, stop: () => clearInterval(timer) };
}
