// Layout: a left rail on laptop and iPad, a bottom tab bar on iPhone (Library · Updates · History · Browse · More).
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../ui/icons.jsx";
import UpdateBar from "../comics/UpdateBar.jsx";

const COMICS = [
  ["/comics", "library", "Library", true], ["/comics/updates", "bell", "Updates"], ["/comics/history", "history", "History"],
  ["/comics/browse", "browse", "Browse"], ["/comics/downloads", "down", "Downloads"],
];

export function ModeSwitch({ compact }) {
  const comics = useLocation().pathname.startsWith("/comics");
  const nav = useNavigate();
  if (compact) {
    return (
      <div className="seg mode" role="radiogroup" aria-label="Novels or comics">
        <button type="button" role="radio" aria-checked={!comics} className={!comics ? "on" : ""} onClick={() => nav("/")}>Novels</button>
        <button type="button" role="radio" aria-checked={comics} className={comics ? "on" : ""} onClick={() => nav("/comics")}>Comics</button>
      </div>
    );
  }
  return (
    <div className="mode-rail" role="radiogroup" aria-label="Novels or comics">
      <button type="button" role="radio" aria-checked={!comics} className={!comics ? "on" : ""} title="Novels" onClick={() => nav("/")}><Icon name="book" /></button>
      <button type="button" role="radio" aria-checked={comics} className={comics ? "on" : ""} title="Comics" onClick={() => nav("/comics")}><Icon name="comic" /></button>
    </div>
  );
}

function Rail() {
  const comics = useLocation().pathname.startsWith("/comics");
  const items = comics ? COMICS : [["/", "library", "Library", true]];
  return (
    <nav className="rail" aria-label="Main">
      <ModeSwitch />
      <span className="rail-gap" />
      {items.map(([to, icon, label, end]) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => `ibtn${isActive ? " on" : ""}`} title={label} aria-label={label}><Icon name={icon} /></NavLink>
      ))}
      <span className="rail-fill" />
      <NavLink to="/settings" className={({ isActive }) => `ibtn${isActive ? " on" : ""}`} title="Settings" aria-label="Settings"><Icon name="settings" /></NavLink>
    </nav>
  );
}

// The last shelf you were on, so Settings knows which tab bar to show (like Mihon: the bar never disappears).
const MODE_KEY = "tachivel:lastMode";
function useMode() {
  const path = useLocation().pathname;
  const here = path.startsWith("/comics") ? "comics" : path === "/" ? "novels" : null;
  if (here) { try { localStorage.setItem(MODE_KEY, here); } catch {} }
  let last = "novels";
  try { last = localStorage.getItem(MODE_KEY) || "novels"; } catch {}
  return { mode: here || last, path };
}

function TabBar() {
  const { mode, path } = useMode();
  const settings = path.startsWith("/settings");
  const tabs = mode === "comics"
    ? [...COMICS.slice(0, 4), ["/comics/more", "more", "More"]]
    : [["/", "book", "Novels", true], ["/comics", "comic", "Comics"], ["/settings", "settings", "Settings"]];
  // Settings counts as "More" in Comics, and as "Settings" in Novels.
  const on = (to, isActive) => isActive || (settings && (to === "/comics/more" || to === "/settings"));
  return (
    <nav className="tabbar" aria-label={mode === "comics" ? "Comics" : "Novels"}>
      {tabs.map(([to, icon, label, end]) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => (on(to, isActive) ? "on" : "")}><Icon name={icon} size={22} /><span>{label}</span></NavLink>
      ))}
    </nav>
  );
}

// Pull down from the top of any screen to reload it (an installed iPhone web app has no reload gesture of its own).
function usePullToRefresh() {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef(null);
  const main = useRef(null);
  const handlers = {
    onTouchStart: (e) => { start.current = main.current?.scrollTop <= 0 && !busy ? e.touches[0].clientY : null; },
    onTouchMove: (e) => { if (start.current == null) return; const dy = e.touches[0].clientY - start.current; setPull(dy > 0 ? Math.min(90, dy * 0.5) : 0); },
    onTouchEnd: () => {
      if (pull > 60) { setBusy(true); dispatchEvent(new Event("tachivel:pull")); setTimeout(() => setBusy(false), 900); }
      start.current = null; setPull(0);
    },
  };
  return { main, handlers, pull, busy };
}

export default function Shell() {
  const { main, handlers, pull, busy } = usePullToRefresh();
  // The comics side has its own font; Settings follows whichever side you came from (like the tab bar).
  const { mode } = useMode();
  useEffect(() => { document.documentElement.dataset.mode = mode; }, [mode]);
  const comics = useLocation().pathname.startsWith("/comics");
  return (
    <div className="shell">
      <div className="statusbar" aria-hidden />
      <Rail />
      <main className="main" ref={main} {...handlers}>
        {(pull > 0 || busy) && <div className={`ptr${pull > 60 || busy ? " ready" : ""}${busy ? " busy" : ""}`} style={{ height: busy ? 48 : pull }} aria-hidden><Icon name="refresh" size={20} /></div>}
        <Outlet />
      </main>
      {comics && <UpdateBar />}
      <TabBar />
    </div>
  );
}
