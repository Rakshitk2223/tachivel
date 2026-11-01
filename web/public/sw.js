// Tachivel service worker: comic pages and covers you've opened (or saved ahead) stay on this device,
// so they open instantly and work offline. The app shell falls back to the last copy when offline.
const PAGES = "tachivel-pages-v1", SHELL = "tachivel-shell-v1", MAX_PAGES = 4000;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (![PAGES, SHELL].includes(k)) await caches.delete(k);
  await self.clients.claim();
})()));

const isImage = (p) => /^\/suwayomi\/api\/v1\/manga\/\d+\/(chapter\/\d+\/page\/\d+|thumbnail)/.test(p);

async function cacheFirst(req, name) {
  const cache = await caches.open(name);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) { cache.put(req, res.clone()); if (name === PAGES) trim(cache); }
  return res;
}
let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try { const keys = await cache.keys(); for (const k of keys.slice(0, Math.max(0, keys.length - MAX_PAGES))) await cache.delete(k); } finally { trimming = false; }
}

self.addEventListener("fetch", (e) => {
  const { request } = e;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;
  if (isImage(url.pathname)) { e.respondWith(cacheFirst(request, PAGES)); return; }
  if (url.pathname.startsWith("/assets/")) { e.respondWith(cacheFirst(request, SHELL)); return; }
  if (request.mode === "navigate") {
    e.respondWith(fetch(request).then((res) => {
      if (res.ok && !url.pathname.startsWith("/novel")) caches.open(SHELL).then((c) => c.put("/", res.clone()));
      return res;
    }).catch(async () => (await caches.match(url.pathname.startsWith("/novel") ? request : "/")) || Response.error()));
  }
});
