// Shared comics data helpers: GraphQL loading, the download queue, and this device's preferences.
import { useCallback, useEffect, useRef, useState } from "react";
import { gql, Q } from "../lib/gql.js";
import { useLoad } from "../lib/api.js";

// Cached by query + variables, so revisiting a screen paints instantly while it refreshes.
export const useGql = (query, vars = {}, deps = []) => useLoad(() => gql(query, vars), deps, `gql:${query.length}:${hash(query)}:${JSON.stringify(vars)}`);
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h.toString(36); }

// The download queue, polled while anything is in it (and every 15 s otherwise, to notice new work).
export function useDownloads() {
  const [status, setStatus] = useState({ state: "STOPPED", queue: [] });
  const timer = useRef();
  const poll = useCallback(async () => {
    clearTimeout(timer.current);
    try { const d = await gql(Q.downloads); setStatus(d.downloadStatus); timer.current = setTimeout(poll, d.downloadStatus.queue.length ? 2000 : 15000); }
    catch { timer.current = setTimeout(poll, 10000); }
  }, []);
  useEffect(() => { poll(); return () => clearTimeout(timer.current); }, [poll]);
  const byChapter = Object.fromEntries(status.queue.map((q) => [q.chapter.id, q]));
  return { ...status, byChapter, refresh: poll };
}

// What a chapter's download looks like right now: the Figma states (not downloaded / queued / % / Cloudflare retry / on the server).
export function chapterStatus(ch, q) {
  if (q?.state === "DOWNLOADING") return { label: `Downloading ${Math.round(q.progress * 100)}%`, short: `${Math.round(q.progress * 100)}%`, icon: "pause", tone: "accent" };
  if (q?.state === "ERROR" || (q && q.tries > 0)) return { label: "Blocked by the source · retrying", short: "Retrying", icon: "alert", tone: "warn" };
  if (q?.state === "QUEUED") return { label: "Queued", short: "Queued", icon: "clock", tone: "" };
  if (ch.isDownloaded) return { label: "On the server", short: "Saved", icon: "ok", tone: "ok" };
  return { label: "Not downloaded", short: "", icon: "down", tone: "" };
}

const KEY = "tachivel:comics";
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
export function useComicPrefs() {
  const [prefs, set] = useState(() => migrate({ layout: "comfortable", cols: { phone: 3, wide: 0 }, sort: "latest", desc: true, filter: {}, tabs: { show: true, counts: true }, continueBtn: true, badges: { unread: true, downloaded: true, source: true }, langs: ["en", "all", "localsourcelang"], pinned: [], incognito: false, saveAhead: 3, adult: false, ...read() }));
  function migrate(p) { return p.layout === "covers" ? { ...p, layout: "comfortable" } : p; } // the old default's name
  const update = useCallback((patch) => set((p) => { const n = { ...p, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {} return n; }), []);
  return [prefs, update];
}
export const readerPrefsKey = (mangaId) => `tachivel:reader:${mangaId}`;
export const READER_DEFAULTS = { mode: "webtoon", spread: "auto", fit: "screen", zones: "edges", invert: "none", dim: 0, bg: "black", gap: "none", crop: false, pageNumber: true, keepAwake: true };
export function readReaderPrefs(mangaId) {
  try { return { ...READER_DEFAULTS, ...JSON.parse(localStorage.getItem("tachivel:reader:default") || "{}"), ...JSON.parse(localStorage.getItem(readerPrefsKey(mangaId)) || "{}") }; }
  catch { return { ...READER_DEFAULTS }; }
}

export const STATUS = { ONGOING: "Ongoing", COMPLETED: "Completed", ON_HIATUS: "Hiatus", CANCELLED: "Cancelled", PUBLISHING_FINISHED: "Finished", LICENSED: "Licensed", UNKNOWN: "" };
export const num = (n) => (n == null || n < 0 ? "" : +Number(n).toFixed(2));

// Tracker sign-in. Suwayomi's tracker apps all return to suwayomi.org/tracker-oauth, which forwards to `state.redirectUrl`
// with the token appended; without a state the token is stranded there. Same window, so an installed iPhone app keeps its session.
// A one-time nonce rides along in `state`; the return page only signs in when it comes back matching (no login CSRF).
// localStorage, not sessionStorage: an installed iPhone app may finish the sign-in in a separate browser context.
export const TRACKER_NONCE = "tachivel:trackerNonce";
export function connectTracker(t) {
  const nonce = crypto.randomUUID();
  const state = JSON.stringify({ redirectUrl: `${location.origin}/tracker-oauth/${t.id}`, clientName: "Tachivel", nonce });
  try { localStorage.setItem(TRACKER_NONCE, JSON.stringify({ nonce, id: t.id, at: Date.now() })); sessionStorage.setItem("tachivel:trackerReturn", location.pathname + location.search); } catch {}
  location.href = `${t.authUrl}&state=${encodeURIComponent(state)}`;
}

// Adult options inside a source's own settings and filters stay hidden too, unless adult sources are on (Settings → Browse).
export const ADULT_OPTION = /erotica|pornographic|hentai|nsfw|adult|18\+/i;
