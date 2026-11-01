// Search across every source at once (Figma L3, phone M4). Sources answer at their own pace; slow or blocked ones say so.
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { gql, Q, M } from "../lib/gql.js";
import { Chip, ComicCard, IconButton, Spinner } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { useComicPrefs, STATUS } from "./data.js";
import { shown } from "./Browse.jsx";

// Run tasks a few at a time, so a big source list doesn't hit the server all at once.
async function pool(items, n, fn) { const q = [...items]; await Promise.all(Array.from({ length: n }, async () => { while (q.length) await fn(q.shift()); })); }

export default function GlobalSearch() {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const term = params.get("q") || "";
  const [input, setInput] = useState(term);
  const [prefs] = useComicPrefs();
  const [results, setResults] = useState({}); // sourceId → { name, state, items, error }
  const [onlyHits, setOnlyHits] = useState(true);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const run = useRef(0);

  useEffect(() => {
    if (!term) return;
    const mine = ++run.current;
    setResults({});
    (async () => {
      const sources = (await gql(Q.sources)).sources.nodes.filter((s) => s.id !== "0" && shown(prefs, s) && (!pinnedOnly || prefs.pinned.includes(s.id)));
      const order = [...sources].sort((a, b) => prefs.pinned.includes(b.id) - prefs.pinned.includes(a.id));
      setResults(Object.fromEntries(order.map((s) => [s.id, { name: s.displayName, state: "loading", items: [] }])));
      await pool(order, 5, async (s) => {
        try {
          const r = (await gql(M.fetchSource, { source: s.id, type: "SEARCH", page: 1, query: term })).fetchSourceManga;
          if (run.current === mine) setResults((x) => ({ ...x, [s.id]: { name: s.displayName, state: "done", items: r.mangas } }));
        } catch (e) { if (run.current === mine) setResults((x) => ({ ...x, [s.id]: { name: s.displayName, state: "error", items: [], error: /403|cloudflare|captcha/i.test(e.message) ? "Blocked by a bot check · try again later" : e.message.slice(0, 80) } })); }
      });
    })();
  }, [term, pinnedOnly]); // eslint-disable-line

  const entries = Object.entries(results).filter(([, r]) => !onlyHits || r.state !== "done" || r.items.length);
  return (
    <div className="page">
      <div className="page-head">
        <IconButton icon="back" label="Back" onClick={() => nav(-1)} />
        <form className="search grow" style={{ maxWidth: 560 }} onSubmit={(e) => { e.preventDefault(); setParams({ q: input.trim() }); }}>
          <Icon name="search" size={16} className="muted" /><input autoFocus placeholder="Search every source" value={input} onChange={(e) => setInput(e.target.value)} enterKeyHint="search" />
        </form>
        <div className="chips"><Chip label="Pinned only" active={pinnedOnly} onClick={() => setPinnedOnly(!pinnedOnly)} /><Chip label="Has results" active={onlyHits} onClick={() => setOnlyHits(!onlyHits)} /></div>
      </div>
      {!term && <p className="sub">Type a title to search all your sources at once.</p>}
      {entries.map(([id, r]) => (
        <section key={id} style={{ display: "grid", gap: 12 }}>
          <div className="actions">
            <h2>{r.name}</h2>
            <span className={`sub ${r.state === "error" ? "warn" : ""}`}>{r.state === "loading" ? "Searching…" : r.state === "error" ? r.error : `${r.items.length} result${r.items.length === 1 ? "" : "s"}`}</span>
            <span style={{ flex: 1 }} />
            {r.items.length > 0 && <button type="button" className="accent" style={{ fontSize: 13 }} onClick={() => nav(`/comics/source/${id}`)}>Open source</button>}
          </div>
          {r.state === "loading" ? <Spinner /> : r.items.length > 0 && (
            <div className="hscroll">{r.items.slice(0, 12).map((m) => <ComicCard key={m.id} manga={m} badge={{ label: m.inLibrary ? "In library" : "", meta: STATUS[m.status] }} onClick={() => nav(`/comics/series/${m.id}`)} />)}</div>
          )}
        </section>
      ))}
    </div>
  );
}
