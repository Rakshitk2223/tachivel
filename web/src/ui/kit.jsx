// The Figma component kit, in code: buttons, chips, segmented controls, toggles, list rows, sheets, covers.
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "./icons.jsx";
import { media } from "../lib/gql.js";

// If onClick starts something slow (returns a promise), the button shows a spinner and ignores
// further taps until it finishes, so a slow server never looks like a missed tap.
export function Button({ kind = "outline", icon, children, small, className = "", onClick, disabled, ...rest }) {
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const click = (e) => {
    if (busy) return;
    const r = onClick?.(e);
    if (r && typeof r.then === "function") { setBusy(true); r.catch(() => {}).finally(() => live.current && setBusy(false)); }
  };
  return (
    <button type="button" className={`btn btn-${kind}${small ? " btn-sm" : ""}${busy ? " busy" : ""} ${className}`} onClick={click} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <span className="dot-spin" aria-hidden /> : icon && <Icon name={icon} size={small ? 16 : 18} />}
      {children && <span>{children}</span>}
    </button>
  );
}
export function IconButton({ icon, label, active, className = "", size = 20, ...rest }) {
  return (
    <button type="button" className={`ibtn${active ? " on" : ""} ${className}`} aria-label={label} title={label} {...rest}>
      <Icon name={icon} size={size} />
    </button>
  );
}
export function Chip({ label, count, active, ...rest }) {
  return (
    <button type="button" className={`chip${active ? " on" : ""}`} aria-pressed={!!active} {...rest}>
      {label}{count != null && count !== "" && <span className="chip-n">{count}</span>}
    </button>
  );
}
export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const v = typeof o === "string" ? o : o.value;
        const l = typeof o === "string" ? o : o.label;
        return <button type="button" key={v} role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>{l}</button>;
      })}
    </div>
  );
}
export function Toggle({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={`toggle${on ? " on" : ""}`} onClick={() => onChange(!on)}><i /></button>;
}
// One row: optional monogram or icon, title + sub, then a value, button, toggle or chevron.
export function Row({ title, sub, mono, icon, iconTone, value, valueTone, button, buttonKind, onButton, toggle, onToggle, chevron, onClick, selected, tone, children }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`row${selected ? " selected" : ""}${onClick ? " tap" : ""}`} onClick={onClick}>
      {mono && <span className="mono">{mono}</span>}
      {icon && <Icon name={icon} className={`row-icon ${iconTone || ""}`} />}
      <span className="row-text">
        <span className={`row-title ${tone || ""}`}>{title}</span>
        {sub && <span className="row-sub">{sub}</span>}
        {children}
      </span>
      {value != null && <span className={`row-value ${valueTone || ""}`}>{value}</span>}
      {button && <Button small kind={buttonKind || "outline"} onClick={(e) => { e.stopPropagation(); return onButton?.(); }}>{button}</Button>}
      {toggle != null && <Toggle on={toggle} onChange={onToggle} label={title} />}
      {chevron && <Icon name="chevr" size={18} className="muted" />}
    </Tag>
  );
}
// The sticky top bar of detail screens (series, catalogue, migrate, search, settings sections):
// back, a one-line title, then actions. Sits just below the iPhone's status bar.
export function AppBar({ title, sub, back = true, onBack, actions }) {
  const nav = useNavigate();
  return (
    <header className="appbar">
      {back && <IconButton icon="back" label="Back" onClick={() => (onBack ? onBack() : history.length > 1 ? nav(-1) : nav("/comics"))} />}
      <div className="appbar-title"><span>{title}</span>{sub && <small>{sub}</small>}</div>
      {actions && <div className="appbar-actions">{actions}</div>}
    </header>
  );
}
export function Caps({ children, right }) {
  return <div className="caps"><span>{children}</span>{right}</div>;
}
export function Group({ title, children }) {
  return <section className="group">{title && <Caps>{title}</Caps>}{children}</section>;
}
export function Progress({ value, className = "" }) {
  return <div className={`bar ${className}`}><i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} /></div>;
}
export function Spinner({ label = "Loading" }) {
  return <div className="spinner" role="status" aria-label={label}><i /></div>;
}
export function Empty({ icon = "info", title, children, action }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} className="muted" />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}
// Server errors can be a whole Java stack trace: one short line, in plain words.
export function friendlyError(error) {
  const raw = (error?.message || String(error)).split("\n")[0].replace(/^Exception while fetching data \([^)]*\)\s*:\s*/, "").replace(/^(java\.[\w.]+|eu\.kanade[\w.]+):\s*/, "");
  if (/PKIX|certificate|SSL/i.test(raw)) return "The source couldn't be reached securely from the server.";
  if (/403|cloudflare|captcha/i.test(raw)) return "The source is blocking requests right now (a bot check). Try again in a bit.";
  if (/HTTP error 5\d\d|HttpException.*5\d\d/i.test(raw)) return "The source's website is having trouble right now. Try again later or read it from another source.";
  if (/HTTP error 404/i.test(raw)) return "The source doesn't have this chapter any more. Refresh the series or migrate it to another source.";
  if (/timeout|timed out/i.test(raw)) return "The source took too long to answer. Try again.";
  if (/Refresh Chapter List/i.test(raw)) return "This series' chapter list is out of date. Refresh it from the source.";
  if (/declared as a non null type|wrongly returned a null/i.test(raw)) return "That isn't on your comics server any more. It may have been removed or replaced by a refresh.";
  return raw.slice(0, 160);
}
export function ErrorNote({ error, onRetry }) {
  if (!error) return null;
  const msg = friendlyError(error);
  return <div className="note warn" role="alert"><Icon name="alert" size={18} /><span>{msg}</span>{onRetry && <Button small onClick={onRetry}>Try again</Button>}</div>;
}

// A bottom sheet on phones, a centred dialog on wider screens.
export function Sheet({ open, onClose, title, children, wide, actions }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`sheet${wide ? " wide" : ""}`} onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose?.(); }}>
      {open && <div className="sheet-body">
        <div className="grab" aria-hidden />
        {title && <div className="sheet-head"><h2>{title}</h2><IconButton icon="close" label="Close" onClick={onClose} /></div>}
        {children}
        {actions && <div className="sheet-actions">{actions}</div>}
      </div>}
    </dialog>
  );
}
// Right-click / long-press menu, positioned at the pointer.
export function Menu({ at, onClose, items }) {
  useEffect(() => {
    if (!at) return;
    const off = (e) => { if (!e.target.closest(".menu")) onClose(); };
    const esc = (e) => e.key === "Escape" && onClose();
    setTimeout(() => addEventListener("pointerdown", off), 0);
    addEventListener("keydown", esc);
    return () => { removeEventListener("pointerdown", off); removeEventListener("keydown", esc); };
  }, [at, onClose]);
  if (!at) return null;
  const x = Math.min(at.x, innerWidth - 300), y = Math.min(at.y, innerHeight - items.length * 46 - 24);
  return (
    <div className="menu" style={{ left: Math.max(8, x), top: Math.max(8, y) }} role="menu">
      {items.filter(Boolean).map((it) => (
        <button key={it.label} type="button" role="menuitem" className={it.tone || ""} onClick={() => { onClose(); it.onClick(); }}>
          <Icon name={it.icon} size={18} /><span>{it.label}</span>
        </button>
      ))}
    </div>
  );
}
// Long-press on touch, right-click on desktop.
export function useLongPress(fn, ms = 450) {
  const t = useRef(null);
  return {
    onContextMenu: (e) => { e.preventDefault(); fn({ x: e.clientX, y: e.clientY }); },
    onTouchStart: (e) => { const p = e.touches[0]; t.current = setTimeout(() => fn({ x: p.clientX, y: p.clientY }), ms); },
    onTouchEnd: () => clearTimeout(t.current),
    onTouchMove: () => clearTimeout(t.current),
  };
}

// Covers: the real thumbnail from Suwayomi, or a generated title card while it loads or if it's missing.
export function Cover({ src, title, className = "" }) {
  const [ok, setOk] = useState(true);
  const url = media(src);
  return (
    <div className={`cover ${className}`}>
      <span className="cover-gen" aria-hidden><span>{title}</span><i /></span>
      {url && ok && <img src={url} alt="" loading="lazy" decoding="async" onError={() => setOk(false)} />}
    </div>
  );
}
// layout: "comfortable" (title below), "compact" (title over the cover), "cover" (cover only)
export function ComicCard({ manga, badge, onClick, selected, dim, menu, layout = "comfortable", onPlay }) {
  const lp = useLongPress((at) => menu?.(at));
  return (
    <div className={`card card-${layout}${selected ? " selected" : ""}${dim ? " dim" : ""}`} {...(menu ? lp : {})}>
      <div className="card-media">
        <button type="button" className="card-hit" onClick={onClick} aria-label={manga.title} title={manga.title}>
          <Cover src={manga.thumbnailUrl} title={manga.title} />
          {layout === "compact" && <span className="card-over"><span className="card-title">{manga.title}</span></span>}
        </button>
        {badge?.unread > 0 && <span className="badge unread">{badge.unread}</span>}
        {badge?.label && <span className="badge unread">{badge.label}</span>}
        {badge?.downloaded > 0 && <span className="badge dl"><Icon name="down" size={12} />{badge.downloaded}</span>}
        {onPlay && <button type="button" className="card-play" aria-label={`Continue ${manga.title}`} onClick={onPlay}><Icon name="play" size={14} /></button>}
      </div>
      {layout === "comfortable" && <button type="button" className="card-text" onClick={onClick} tabIndex={-1}>
        <span className="card-title">{manga.title}</span>
        {badge?.meta && <span className="card-meta">{badge.meta}</span>}
      </button>}
    </div>
  );
}
export function Thumb({ src, title }) {
  return <Cover src={src} title={title} className="thumb" />;
}

export const timeAgo = (ms) => {
  const t = Number(ms);
  if (!t) return "";
  const s = (Date.now() - (t < 1e12 ? t * 1000 : t)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(t < 1e12 ? t * 1000 : t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};
export const dayLabel = (ms) => {
  const t = Number(ms) < 1e12 ? Number(ms) * 1000 : Number(ms);
  const d = new Date(t), now = new Date();
  const days = Math.round((new Date(now.toDateString()) - new Date(d.toDateString())) / 86400000);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { day: "numeric", month: "long" });
};
export const chapterLabel = (c) => {
  const n = c.chapterNumber >= 0 ? `Chapter ${+c.chapterNumber.toFixed(2)}` : "";
  return c.name && !/^ch(apter)?\.?\s*\d/i.test(c.name) ? (n ? `${n} · ${c.name}` : c.name) : c.name || n;
};
