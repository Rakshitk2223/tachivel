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

// Small data hook: load, reload, and keep the last good value while reloading.
export function useLoad(loader, deps = []) {
  const [state, set] = useState({ data: undefined, error: null, loading: true });
  const run = useCallback(async () => {
    set((s) => ({ ...s, loading: true }));
    try { set({ data: await loader(), error: null, loading: false }); }
    catch (error) { if (!(error instanceof SignedOut)) set((s) => ({ ...s, error, loading: false })); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run, setData: (data) => set((s) => ({ ...s, data: typeof data === "function" ? data(s.data) : data })) };
}
