// Local dev server: static files + the real /api handler with in-memory storage.
// npm run dev  →  http://localhost:47614  (passphrase: dev)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { handle } from "./netlify/lib/core.mjs";

const PORT = 47614;
const root = new URL(".", import.meta.url).pathname;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
function memoryStore() {
  const m = new Map(), etags = new Map();
  let ver = 0;
  return {
    async get(k, o) { if (!m.has(k)) return null; const v = m.get(k); return o?.type === "json" ? JSON.parse(v) : v; },
    async getMetadata(k) { return m.has(k) ? {} : null; },
    async getWithMetadata(k, o) { if (!m.has(k)) return null; const v = m.get(k); return { data: o?.type === "json" ? JSON.parse(v) : v, etag: etags.get(k) }; },
    async set(k, v) { m.set(k, v); etags.set(k, String(++ver)); return { modified: true }; },
    async setJSON(k, v, o = {}) {
      if (o.onlyIfNew && m.has(k)) return { modified: false };
      if (o.onlyIfMatch && etags.get(k) !== o.onlyIfMatch) return { modified: false };
      m.set(k, JSON.stringify(v)); etags.set(k, String(++ver)); return { modified: true };
    },
    async delete(k) { m.delete(k); },
  };
}
const stores = { library: memoryStore(), secrets: memoryStore(), limits: memoryStore() };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body }),
      { stores, passphrase: process.env.TACHIVEL_PASSPHRASE || "dev", ip: req.socket.remoteAddress });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const file = normalize(join(root, url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith(root) || /node_modules|\.git/.test(file)) { res.writeHead(404); return res.end(); }
  try { res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }); res.end(await readFile(file)); }
  catch { res.writeHead(404); res.end("Not found"); }
}).listen(PORT, "127.0.0.1", () => console.log(`Tachivel dev: http://localhost:${PORT}  (passphrase: dev)`));
