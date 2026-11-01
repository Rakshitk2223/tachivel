// Settings that follow you between devices (theme, voice, speed, text size), plus this device's own choices.
// The listen-along reader (/novel) reads and writes the same localStorage key, so both stay in step.
import { createContext, createElement, useContext, useEffect, useState, useCallback } from "react";
import { api, useChanges } from "./api.js";

export const THEMES = [
  { id: "ember", name: "Ember" }, { id: "dark", name: "True Dark" }, { id: "light", name: "Light" },
  { id: "snow", name: "Snow" }, { id: "midnight", name: "Midnight" }, { id: "moss", name: "Moss" }, { id: "plum", name: "Plum" },
];
const KEY = "tachivel:settings";
const DEVICE_KEY = "tachivel:device"; // never synced: layout and per-device comic reader preferences
const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {}; } catch { return {}; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const SettingsCtx = createContext(null);

export function SettingsProvider({ children }) {
  const [synced, setSynced] = useState(() => ({ theme: "ember", dayTheme: "light", nightTheme: "ember", followSystem: false, ...read(KEY) }));
  const [device, setDevice] = useState(() => ({ comicBg: "black", ...read(DEVICE_KEY) }));
  const [dark, setDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setDark(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const pull = useCallback(async () => {
    const remote = await api.settings().catch(() => null);
    if (remote && remote.at > (read(KEY).at || 0)) {
      const next = { ...read(KEY), ...Object.fromEntries(Object.entries(remote).filter(([, v]) => v != null)) };
      write(KEY, next);
      setSynced((s) => ({ ...s, ...next }));
    }
  }, []);
  useEffect(() => { pull(); }, [pull]);
  useChanges((c) => { if (c.type === "settings") pull(); });

  const theme = synced.followSystem ? (dark ? synced.nightTheme : synced.dayTheme) || synced.theme : synced.theme;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg || "#17110f");
  }, [theme]);

  const update = useCallback((patch) => {
    setSynced((s) => {
      const next = { ...s, ...patch, at: Date.now() };
      write(KEY, next);
      api.putSettings({ at: next.at, theme: next.theme, nightTheme: next.nightTheme, followSystem: next.followSystem, voice: next.voice, rate: next.rate, size: next.size }).catch(() => {});
      return next;
    });
  }, []);
  const updateDevice = useCallback((patch) => setDevice((d) => { const next = { ...d, ...patch }; write(DEVICE_KEY, next); return next; }), []);

  return createElement(SettingsCtx.Provider, { value: { ...synced, theme, device, update, updateDevice } }, children);
}
export const useSettings = () => useContext(SettingsCtx);
