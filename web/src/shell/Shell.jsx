// Layout: a left rail on laptop and iPad, a bottom tab bar on iPhone (Library · Updates · History · Browse · More).
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { Icon } from "../ui/icons.jsx";

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

function TabBar() {
  const comics = useLocation().pathname.startsWith("/comics");
  if (!comics) return null; // Novels on a phone: the header has the switch and settings
  const tabs = [...COMICS.slice(0, 4), ["/comics/more", "more", "More"]];
  return (
    <nav className="tabbar" aria-label="Comics">
      {tabs.map(([to, icon, label, end]) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "on" : "")}><Icon name={icon} size={22} /><span>{label}</span></NavLink>
      ))}
    </nav>
  );
}

export default function Shell() {
  return (
    <div className="shell">
      <Rail />
      <main className="main"><Outlet /></main>
      <TabBar />
    </div>
  );
}
