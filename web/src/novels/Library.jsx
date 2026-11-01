// Novels: the shelf (Figma A3 / V6). Opening a book goes to the listen-along reader at /novel/?book=<id>.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, useChanges, useLoad } from "../lib/api.js";
import { epubMeta, sameTitle } from "../lib/epub-shared.js";
import { Button, Cover, Empty, ErrorNote, IconButton, Menu, Progress, Sheet, Spinner, useLongPress, timeAgo } from "../ui/kit.jsx";
import { Icon } from "../ui/icons.jsx";
import { ModeSwitch } from "../shell/Shell.jsx";

// The reader keeps each parsed book (cover, chapters) in this device's IndexedDB; borrow covers and chapter counts from it.
function readCached(ids) {
  return new Promise((resolve) => {
    const req = indexedDB.open("tachivel", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("books");
    req.onerror = () => resolve({});
    req.onsuccess = () => {
      const db = req.result, out = {};
      if (!db.objectStoreNames.contains("books")) return resolve({});
      const tx = db.transaction("books", "readonly"), store = tx.objectStore("books");
      ids.forEach((id) => { const g = store.get(`book:${id}`); g.onsuccess = () => { const b = g.result; if (b) out[id] = { cover: b.cover ? URL.createObjectURL(b.cover) : null, chapters: b.chapters?.map((c) => c.t) || [] }; }; });
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => resolve(out);
    };
  });
}
const open = (id) => { location.href = `/novel/?book=${id}`; };

function useToast() {
  const [msg, setMsg] = useState(null);
  const t = useRef();
  const show = (m, ms = 4000) => { setMsg(m); clearTimeout(t.current); if (ms) t.current = setTimeout(() => setMsg(null), ms); };
  return [msg && <div className="toast" role="status">{msg}</div>, show];
}

export default function NovelsLibrary() {
  const books = useLoad(api.books);
  const progress = useLoad(api.progress);
  const [cached, setCached] = useState({});
  const [menu, setMenu] = useState(null);
  const [pending, setPending] = useState(null); // { file, title, match }
  const [over, setOver] = useState(false);
  const fileRef = useRef(null);
  const replaceFor = useRef(null);
  const [toast, say] = useToast();

  useChanges((c) => { if (c.type === "books") books.reload(); if (c.type === "progress") progress.reload(); });
  useEffect(() => { if (books.data?.length) readCached(books.data.map((b) => b.id)).then(setCached); }, [books.data]);

  const list = books.data || [];
  const prog = progress.data || {};
  const recent = useMemo(() => [...list].filter((b) => prog[b.id]).sort((a, b) => prog[b.id].at - prog[a.id].at)[0] || list[0], [list, prog]);

  async function choose(file) {
    if (!file) return;
    if (!/\.epub$/i.test(file.name) && file.type !== "application/epub+zip") { say("That isn't an EPUB."); return; }
    const forced = replaceFor.current; replaceFor.current = null;
    if (forced) return upload(file, forced.id);
    const meta = epubMeta(new Uint8Array(await file.arrayBuffer()));
    const match = list.find((b) => sameTitle(b.title, meta?.title));
    if (match) setPending({ file, title: meta?.title || file.name, match, choice: "replace" });
    else upload(file, "new");
  }
  async function upload(file, replace) {
    setPending(null);
    say(`Uploading ${file.name}…`, 0);
    try {
      const r = await api.upload(file, replace);
      say(r.unchanged ? "That copy is already in your library." : r.replaced ? `Replaced ${r.book.title}. Your place is kept.` : `Added ${r.book.title}.`);
      books.reload();
    } catch (e) { say(`Couldn't upload: ${e.message}`, 6000); }
  }
  async function remove(b) {
    if (!confirm(`Remove ${b.title} from your library? Your place in it goes too.`)) return;
    await api.deleteBook(b.id).catch((e) => say(e.message));
    books.reload();
  }

  const where = (b) => {
    const p = prog[b.id], c = cached[b.id];
    if (!p) return "Not started";
    const n = c?.chapters.length;
    return n ? `${p.chKey || `Section ${p.ch + 1}`} · ${p.ch + 1} of ${n}` : p.chKey || `Last read ${timeAgo(p.at)}`;
  };
  const pct = (b) => { const p = prog[b.id], n = cached[b.id]?.chapters.length; return p && n ? (p.ch + 1) / n : 0; };

  return (
    <div className="page" onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={(e) => !e.relatedTarget && setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); choose(e.dataTransfer.files[0]); }}>
      <div className="page-head only-phone"><ModeSwitch compact /><span style={{ flex: 1 }} /><Link className="ibtn" to="/settings" aria-label="Settings"><Icon name="settings" /></Link></div>
      <div className="page-head">
        <div className="grow"><h1>Library</h1><p className="sub">{list.length ? `${list.length} book${list.length === 1 ? "" : "s"}. Your place in each follows you to every device.` : "Your novels, read aloud, on every device."}</p></div>
        <Button kind="accent" icon="plus" onClick={() => fileRef.current.click()}>Add a book</Button>
        <input ref={fileRef} type="file" accept=".epub,application/epub+zip" hidden onChange={(e) => { choose(e.target.files[0]); e.target.value = ""; }} />
      </div>
      <ErrorNote error={books.error} onRetry={books.reload} />
      {books.loading && !books.data ? <Spinner /> : !list.length ? (
        <Empty icon="book" title="Drop an EPUB here" action={<Button kind="accent" icon="upload" onClick={() => fileRef.current.click()}>Choose a file</Button>}>
          It's uploaded to your server, so every device can read it and your place follows you.
        </Empty>
      ) : (
        <>
          {recent && (
            <section className="hero">
              {cached[recent.id]?.cover && <img className="hero-glow" src={cached[recent.id].cover} alt="" />}
              <div className="cover">{cached[recent.id]?.cover ? <img src={cached[recent.id].cover} alt="" /> : <span className="cover-gen"><span>{recent.title}</span><i /></span>}</div>
              <div className="hero-info">
                <span className="kicker">{prog[recent.id] ? "Continue listening" : "Start listening"}</span>
                <div><div className="hero-title">{recent.title}</div><p className="sub">{where(recent)}</p></div>
                {prog[recent.id]?.sText && <p className="quote">“{prog[recent.id].sText}”</p>}
                {pct(recent) > 0 && <div className="hero-prog"><Progress value={pct(recent)} /><span className="sub">{Math.round(pct(recent) * 100)}% read</span></div>}
                <div className="hero-actions"><Button kind="accent" icon="play" onClick={() => open(recent.id)}>{prog[recent.id] ? "Resume" : "Start"}</Button></div>
              </div>
            </section>
          )}
          <h3>On your shelf</h3>
          <div className="shelf">
            {list.map((b) => <Book key={b.id} b={b} cover={cached[b.id]?.cover} meta={where(b)} pct={pct(b)} onMenu={(at) => setMenu({ at, b })} />)}
            <button type="button" className={`drop${over ? " over" : ""}`} onClick={() => fileRef.current.click()}><Icon name="plus" size={22} /><span>Drop an EPUB here</span></button>
          </div>
        </>
      )}
      <Menu at={menu?.at} onClose={() => setMenu(null)} items={menu ? [
        { icon: "play", label: "Open", onClick: () => open(menu.b.id) },
        { icon: "upload", label: "Replace with a newer copy…", onClick: () => { replaceFor.current = menu.b; fileRef.current.click(); } },
        { icon: "down", label: "Download the EPUB", onClick: () => { location.href = `/api/books/${menu.b.id}/file`; } },
        { icon: "trash", label: "Remove from library", tone: "bad", onClick: () => remove(menu.b) },
      ] : []} />
      <Sheet open={!!pending} onClose={() => setPending(null)} title="Add a book" actions={pending && <>
        <Button kind="ghost" onClick={() => setPending(null)}>Cancel</Button>
        <Button kind="accent" onClick={() => upload(pending.file, pending.choice === "replace" ? pending.match.id : "new")}>{pending.choice === "replace" ? "Replace book" : "Add book"}</Button>
      </>}>
        {pending && <>
          <div className="filecard"><Icon name="upload" className="accent" /><div><div className="row-title">{pending.file.name}</div><div className="row-sub">{(pending.file.size / 1048576).toFixed(1)} MB</div></div></div>
          <p>This looks like a newer copy of <b>{pending.match.title}</b>.</p>
          {[["replace", "Replace it, keep my place", "Your bookmark, pictures and World cards carry over. The old copy is deleted."], ["new", "Add as a separate book", "Both stay on your shelf with their own places."]].map(([v, t, s]) => (
            <button key={v} type="button" className={`choice${pending.choice === v ? " on" : ""}`} onClick={() => setPending({ ...pending, choice: v })}>
              <span className="dot" /><span className="row-text"><span className="row-title">{t}</span><span className="row-sub">{s}</span></span>
            </button>
          ))}
        </>}
      </Sheet>
      {toast}
    </div>
  );
}

function Book({ b, cover, meta, pct, onMenu }) {
  const lp = useLongPress(onMenu);
  return (
    <div className="card book" {...lp}>
      <button type="button" className="cover-btn" onClick={() => open(b.id)} aria-label={`Open ${b.title}`}>
        <div className="cover">{cover ? <img src={cover} alt="" /> : <span className="cover-gen"><span>{b.title}</span><i /></span>}</div>
      </button>
      <span className="card-title">{b.title}</span>
      <span className="card-meta">{meta}</span>
      {pct > 0 && <Progress value={pct} />}
      <IconButton icon="more" label={`More for ${b.title}`} className="card-more" size={18} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onMenu({ x: r.left, y: r.bottom }); }} />
    </div>
  );
}
