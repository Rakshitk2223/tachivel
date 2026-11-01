// Tachivel server: the web app's files plus /api, in one small Node process.
//   DATA_DIR      where books, progress and settings live (default ./data)
//   PUBLIC_DIR    the built web app (default ../web/dist)
//   UPLOAD_TOKEN  bearer token for POST /api/upload (scripted EPUB pushes)
//   PROXY_SECRET  shared secret Caddy adds to every request; without it, identity headers are ignored
//   NETLIFY_SITE, NETLIFY_PASSPHRASE  optional: mirror the novel from the v1 Netlify site (see mirror.mjs)
//   DEV_USER      local development only: pretend this user is signed in
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileStore } from "./store.mjs";
import { handle, trustedUser } from "./core.mjs";
import { startNetlifyMirror } from "./mirror.mjs";

const PORT = Number(process.env.PORT || 8080);
const store = fileStore(resolve(process.env.DATA_DIR || "./data"));
const publicDir = resolve(process.env.PUBLIC_DIR || new URL("../../web/dist", import.meta.url).pathname);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const SECURITY = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  // Suwayomi is proxied at /suwayomi on the same origin, so 'self' covers its images and GraphQL socket.
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};

// Live sync: every open tab keeps one event stream; a change on one device reaches the others in about a second.
const listeners = new Set();
const notify = (change) => { const line = `event: change\ndata: ${JSON.stringify(change)}\n\n`; for (const res of listeners) res.write(line); };

const PROXY_SECRET = process.env.PROXY_SECRET;
if (!PROXY_SECRET && !process.env.DEV_USER) console.warn("PROXY_SECRET is not set: identity headers are trusted from anyone who can reach this port.");
function signedIn(req) {
  if (process.env.DEV_USER) { req.headers["remote-user"] = process.env.DEV_USER; if (PROXY_SECRET) req.headers["x-tachivel-proxy"] = PROXY_SECRET; }
  return trustedUser(new Request("http://x", { headers: req.headers }), PROXY_SECRET);
}

async function serveStatic(req, res, pathname) {
  let file = normalize(join(publicDir, decodeURIComponent(pathname)));
  if (!file.startsWith(publicDir)) { res.writeHead(404); return res.end(); }
  try { if ((await stat(file)).isDirectory()) file = join(file, "index.html"); }
  catch { file = join(publicDir, "index.html"); } // single-page app: unknown paths get the app shell
  try {
    const body = await readFile(file);
    // Vite puts a content hash in every file under /assets, so those never change.
    const cache = pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": cache, ...SECURITY });
    res.end(body);
  } catch { res.writeHead(404, SECURITY); res.end("Not found"); }
}

// Same path as a scripted token upload: a same-title book is replaced in place, so your place is kept.
async function uploadLocal(bytes, name) {
  const r = await handle(new Request(`http://local/api/upload?name=${encodeURIComponent(name)}`, { method: "POST", headers: { authorization: `Bearer ${process.env.UPLOAD_TOKEN}` }, body: bytes }),
    { store, uploadToken: process.env.UPLOAD_TOKEN, proxySecret: PROXY_SECRET, notify });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `upload ${r.status}`);
  return body;
}
if (process.env.NETLIFY_SITE && process.env.NETLIFY_PASSPHRASE && process.env.UPLOAD_TOKEN) {
  startNetlifyMirror({ site: process.env.NETLIFY_SITE.replace(/\/+$/, ""), passphrase: process.env.NETLIFY_PASSPHRASE, dataDir: store.root, upload: uploadLocal });
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/healthz") { res.writeHead(200); return res.end("ok"); }

  if (url.pathname === "/api/events") {
    if (!signedIn(req)) { res.writeHead(401); return res.end(); }
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
    res.write(": hello\n\n");
    listeners.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), 25000); // keeps proxies from closing a quiet stream
    req.on("close", () => { clearInterval(ping); listeners.delete(res); });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    signedIn(req);
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : Readable.toWeb(req);
    const r = await handle(new Request(url, { method: req.method, headers: req.headers, body, duplex: "half" }), { store, uploadToken: process.env.UPLOAD_TOKEN, proxySecret: PROXY_SECRET, notify })
      .catch((e) => { console.error(e); return new Response(JSON.stringify({ error: "Something went wrong on the server." }), { status: 500 }); });
    res.writeHead(r.status, { ...Object.fromEntries(r.headers), ...SECURITY });
    if (!r.body) return res.end();
    return Readable.fromWeb(r.body).pipe(res);
  }

  return serveStatic(req, res, url.pathname);
}).listen(PORT, () => console.log(`Tachivel server on :${PORT} (data: ${store.root})`));
