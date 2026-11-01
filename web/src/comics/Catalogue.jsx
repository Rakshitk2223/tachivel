// A source's catalogue (Figma L2 / I3, phone M2 / M3): Popular, Latest, search, and the source's own filters.
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { gql, Q, M } from "../lib/gql.js";
import { Button, Chip, ComicCard, Empty, ErrorNote, IconButton, Row, Segmented, Sheet, Spinner } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { useGql, STATUS } from "./data.js";

// The source describes its filters; we keep a state per filter position and send only the ones you changed.
function initial(filters) {
  return filters.map((f) => {
    switch (f.__typename) {
      case "CheckBoxFilter": return f.cbDefault;
      case "TriStateFilter": return f.tsDefault;
      case "TextFilter": return f.txDefault;
      case "SelectFilter": return f.selDefault;
      case "SortFilter": return f.sortDefault || { index: 0, ascending: false };
      case "GroupFilter": return f.filters.map((g) => (g.__typename === "TriStateFilter" ? g.tsDefault : g.cbDefault));
      default: return null;
    }
  });
}
function changes(filters, state) {
  const out = [];
  filters.forEach((f, position) => {
    const v = state[position], d = initial([f])[0];
    if (JSON.stringify(v) === JSON.stringify(d)) return;
    if (f.__typename === "CheckBoxFilter") out.push({ position, checkBoxState: v });
    if (f.__typename === "TriStateFilter") out.push({ position, triState: v });
    if (f.__typename === "TextFilter") out.push({ position, textState: v });
    if (f.__typename === "SelectFilter") out.push({ position, selectState: v });
    if (f.__typename === "SortFilter") out.push({ position, sortState: v });
    if (f.__typename === "GroupFilter") v.forEach((gv, i) => { if (gv !== d[i]) out.push({ position, groupChange: { position: i, ...(f.filters[i].__typename === "TriStateFilter" ? { triState: gv } : { checkBoxState: gv }) } }); });
  });
  return out;
}

export default function Catalogue() {
  const { id } = useParams();
  const nav = useNavigate();
  const src = useGql(Q.source, { id }, [id]);
  const [type, setType] = useState("POPULAR");
  const [params] = useSearchParams();
  // A tapped genre arrives as ?q=, and opens straight into that search.
  const [query, setQuery] = useState(params.get("q") || "");
  const [submitted, setSubmitted] = useState(params.get("q") || "");
  const [fstate, setFstate] = useState(null);
  const [applied, setApplied] = useState([]);
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sheet, setSheet] = useState(false);
  const s = src.data?.source;
  const filters = s?.filters || [];
  useEffect(() => { if (s) setFstate(initial(s.filters)); }, [s]);

  const load = useCallback(async (p) => {
    setLoading(true); setError(null);
    try {
      const t = submitted || applied.length ? "SEARCH" : type;
      const r = (await gql(M.fetchSource, { source: id, type: t, page: p, query: submitted || null, filters: applied.length ? applied : null })).fetchSourceManga;
      setItems((prev) => (p === 1 ? r.mangas : [...prev, ...r.mangas.filter((m) => !prev.some((x) => x.id === m.id))]));
      setMore(r.hasNextPage); setPage(p);
    } catch (e) { setError(e); } finally { setLoading(false); }
  }, [id, type, submitted, applied]);
  useEffect(() => { load(1); }, [load]);

  const filtersBody = () => !fstate ? null : (
    <div style={{ display: "grid", gap: 16 }}>
      {filters.map((f, i) => <FilterControl key={i} f={f} v={fstate[i]} set={(v) => setFstate((st) => st.map((x, j) => (j === i ? v : x)))} />)}
      {!filters.length && <p className="sub">This source has no filters.</p>}
    </div>
  );
  const apply = () => { setApplied(changes(filters, fstate)); setSheet(false); };
  const reset = () => { setFstate(initial(filters)); setApplied([]); };

  return (
    <div className="page">
      <div className="page-head">
        <IconButton icon="back" label="Back" onClick={() => nav(-1)} />
        <h1 className="grow">{s?.displayName || "Source"}</h1>
        <Button className="only-phone" icon="filter" onClick={() => setSheet(true)}>Filters{applied.length ? ` · ${applied.length}` : ""}</Button>
        {s?.homeUrl && <Button icon="external" className="hide-phone" onClick={() => window.open(s.homeUrl, "_blank", "noopener")}>Open site</Button>}
      </div>
      <div className="chips">
        <Chip label="Popular" active={type === "POPULAR" && !submitted && !applied.length} onClick={() => { setType("POPULAR"); setSubmitted(""); setQuery(""); setApplied([]); }} />
        {s?.supportsLatest && <Chip label="Latest" active={type === "LATEST" && !submitted && !applied.length} onClick={() => { setType("LATEST"); setSubmitted(""); setQuery(""); setApplied([]); }} />}
        {applied.length > 0 && <Chip label="Filtered" count={applied.length} active onClick={() => setSheet(true)} />}
        <span style={{ flex: 1 }} />
        <form className="search" style={{ width: 300 }} onSubmit={(e) => { e.preventDefault(); setSubmitted(query.trim()); }}>
          <Icon name="search" size={16} className="muted" /><input placeholder={`Search ${s?.displayName || ""}`} value={query} onChange={(e) => setQuery(e.target.value)} enterKeyHint="search" />
        </form>
      </div>
      <div className="split split-side">
        <div style={{ display: "grid", gap: 20 }}>
          <ErrorNote error={error} onRetry={() => load(page)} />
          <div className="grid">
            {items.map((m) => <ComicCard key={m.id} manga={m} badge={{ label: m.inLibrary ? "In library" : "", meta: STATUS[m.status] }} onClick={() => nav(`/comics/series/${m.id}`)} />)}
          </div>
          {loading ? <Spinner /> : more ? <Button onClick={() => load(page + 1)}>Load more</Button> : !items.length && !error ? <Empty icon="search" title="Nothing here">Try another search or fewer filters.</Empty> : null}
        </div>
        <aside className="group hide-phone" style={{ padding: 20, gap: 16, position: "sticky", top: 0, maxHeight: "calc(100vh - 160px)", overflow: "auto" }}>
          <div className="sheet-head"><h2>Filters</h2><button type="button" className="accent" onClick={reset}>Reset</button></div>
          {filtersBody()}
          {filters.length > 0 && <Button kind="accent" onClick={apply}>Apply filters</Button>}
        </aside>
      </div>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Filters" actions={<><Button kind="ghost" onClick={reset}>Reset</Button><Button kind="accent" onClick={apply}>Apply</Button></>}>{filtersBody()}</Sheet>
    </div>
  );
}

const TRI = ["IGNORE", "INCLUDE", "EXCLUDE"];
function FilterControl({ f, v, set }) {
  const label = <label className="caps" style={{ padding: 0 }}>{f.name}</label>;
  switch (f.__typename) {
    case "HeaderFilter": return <p className="row-title">{f.name}</p>;
    case "SeparatorFilter": return <hr style={{ border: 0, borderTop: "1px solid var(--border)", width: "100%" }} />;
    case "CheckBoxFilter": return <Row title={f.name} toggle={v} onToggle={set} />;
    case "TriStateFilter": return <Chip label={`${v === "EXCLUDE" ? "− " : v === "INCLUDE" ? "+ " : ""}${f.name}`} active={v !== "IGNORE"} onClick={() => set(TRI[(TRI.indexOf(v) + 1) % 3])} />;
    case "TextFilter": return <div style={{ display: "grid", gap: 6 }}>{label}<input className="field" value={v || ""} onChange={(e) => set(e.target.value)} /></div>;
    case "SelectFilter": return <div style={{ display: "grid", gap: 6 }}>{label}
      {f.values.length <= 5 ? <Segmented options={f.values.map((x, i) => ({ value: i, label: x }))} value={v} onChange={set} label={f.name} />
        : <div className="chips wrap">{f.values.map((x, i) => <Chip key={x} label={x} active={v === i} onClick={() => set(i)} />)}</div>}</div>;
    case "SortFilter": return <div style={{ display: "grid", gap: 6 }}>{label}<div className="chips wrap">{f.values.map((x, i) => <Chip key={x} label={`${x}${v?.index === i ? (v.ascending ? " ↑" : " ↓") : ""}`} active={v?.index === i} onClick={() => set({ index: i, ascending: v?.index === i ? !v.ascending : false })} />)}</div></div>;
    case "GroupFilter": return <div style={{ display: "grid", gap: 6 }}>{label}<div className="chips wrap">{f.filters.map((g, i) => {
      const gv = v[i];
      const tri = g.__typename === "TriStateFilter";
      return <Chip key={g.name} label={`${tri && gv === "EXCLUDE" ? "− " : ""}${g.name}`} active={tri ? gv !== "IGNORE" : gv}
        onClick={() => set(v.map((x, j) => (j !== i ? x : tri ? TRI[(TRI.indexOf(x) + 1) % 3] : !x)))} />;
    })}</div></div>;
    default: return null;
  }
}
