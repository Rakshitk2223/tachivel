// Tachivel's own API (/api): novels, your place in each, and settings that follow you between devices.
import { useEffect, useState, useCallback, useRef } from "react";

export class SignedOut extends Error {}

async function call(method, path, body, raw = false) {
  const res = await fetch(path, {
    method, credentials: "same-origin", cache: "no-store",
    headers: body && !raw ? { "content-type": "application/json" } : {},
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  // The sign-in sits in front of the whole site; a 401 here means it expired, so go back through it.
  if (res.status === 401) { location.reload(); throw new SignedOut(); }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `The server said no (${res.status}).`);
  return data;
}

export const api = {
  me: () => call("GET", "/api/me"),
  books: () => call("GET", "/api/books"),
  progress: () => call("GET", "/api/progress"),
  settings: () => call("GET", "/api/settings"),
  storage: () => call("GET", "/api/storage"),
  putSettings: (s) => call("PUT", "/api/settings", s),
  deleteBook: (id) => call("DELETE", `/api/books/${id}`),
  // replace: a book id, "new" for a separate copy, or "auto" to match by title
  upload: (file, replace = "new") => call("POST", `/api/books?replace=${encodeURIComponent(replace)}&name=${encodeURIComponent(file.name)}`, file, true),
};

// One shared event stream per tab: the server says what changed, screens refetch what they show.
const subscribers = new Set();
let source = null;
function ensureStream() {
  if (source || typeof EventSource === "undefined") return;
  source = new EventSource("/api/events");
  source.addEventListener("change", (e) => { const c = JSON.parse(e.data); subscribers.forEach((fn) => fn(c)); });
}
export function useChanges(fn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    ensureStream();
    const sub = (c) => ref.current(c);
    subscribers.add(sub);
    return () => subscribers.delete(sub);
  }, []);
}

// Data cache: every screen shows what it had last time immediately, then refreshes quietly in the background
// (stale-while-revalidate). It lives in memory and in localStorage, so switching tabs or reopening the app is instant.
const CACHE_KEY = "tachivel:cache:";
const memory = new Map();
function cached(key) {
  if (!key) return undefined;
  if (memory.has(key)) return memory.get(key);
  try { const v = localStorage.getItem(CACHE_KEY + key); if (v != null) { const d = JSON.parse(v); memory.set(key, d); return d; } } catch {}
  return undefined;
}
function remember(key, data) {
  if (!key) return;
  memory.set(key, data);
  try { const v = JSON.stringify(data); if (v.length < 1_500_000) localStorage.setItem(CACHE_KEY + key, v); } catch { /* full: memory still works */ }
}
export function forget(prefix = "") {
  for (const k of [...memory.keys()]) if (k.startsWith(prefix)) memory.delete(k);
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(CACHE_KEY + prefix)) localStorage.removeItem(k); } catch {}
}

// Small data hook: load, reload, and keep the last good value while reloading. Pass a cache key to make it instant.
export function useLoad(loader, deps = [], key = null) {
  const [state, set] = useState(() => { const d = cached(key); return { data: d, error: null, loading: d === undefined }; });
  const run = useCallback(async () => {
    set((s) => ({ ...s, loading: true }));
    try { const data = await loader(); remember(key, data); set({ data, error: null, loading: false }); }
    catch (error) { if (!(error instanceof SignedOut)) set((s) => ({ ...s, error, loading: false })); }
  }, [...deps, key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run]);
  // Pull-to-refresh (Shell) asks every screen on show to fetch again.
  useEffect(() => { addEventListener("tachivel:pull", run); return () => removeEventListener("tachivel:pull", run); }, [run]);
  return { ...state, reload: run, setData: (data) => set((s) => { const next = typeof data === "function" ? data(s.data) : data; remember(key, next); return { ...s, data: next }; }) };
}
