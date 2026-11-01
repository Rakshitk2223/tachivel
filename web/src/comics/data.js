// Shared comics data helpers: GraphQL loading, the download queue, and this device's preferences.
import { useCallback, useEffect, useRef, useState } from "react";
import { gql, Q } from "../lib/gql.js";
import { useLoad } from "../lib/api.js";

export const useGql = (query, vars = {}, deps = []) => useLoad(() => gql(query, vars), deps);

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
  const [prefs, set] = useState(() => ({ layout: "covers", sort: "latest", filter: {}, badges: { unread: true, downloaded: true }, langs: ["en", "all", "localsourcelang"], pinned: [], incognito: false, saveAhead: 3, adult: false, ...read() }));
  const update = useCallback((patch) => set((p) => { const n = { ...p, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {} return n; }), []);
  return [prefs, update];
}
export const readerPrefsKey = (mangaId) => `tachivel:reader:${mangaId}`;
export const READER_DEFAULTS = { mode: "webtoon", spread: "auto", fit: "screen", zones: "edges", bg: "black", gap: "none", crop: false, pageNumber: true, keepAwake: true };
export function readReaderPrefs(mangaId) {
  try { return { ...READER_DEFAULTS, ...JSON.parse(localStorage.getItem("tachivel:reader:default") || "{}"), ...JSON.parse(localStorage.getItem(readerPrefsKey(mangaId)) || "{}") }; }
  catch { return { ...READER_DEFAULTS }; }
}

export const STATUS = { ONGOING: "Ongoing", COMPLETED: "Completed", ON_HIATUS: "Hiatus", CANCELLED: "Cancelled", PUBLISHING_FINISHED: "Finished", LICENSED: "Licensed", UNKNOWN: "" };
export const num = (n) => (n == null || n < 0 ? "" : +Number(n).toFixed(2));
