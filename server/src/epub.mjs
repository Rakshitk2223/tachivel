// Read just enough of an EPUB to name it: container.xml points at the OPF, which holds title and author.
import { unzipSync, strFromU8 } from "fflate";

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
const tag = (xml, name) => { const m = new RegExp(`<(?:[\\w-]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, "i").exec(xml); return m ? decode(m[1].replace(/<[^>]+>/g, "")) : null; };

export function epubMeta(bytes) {
  let files;
  try { files = unzipSync(bytes, { filter: (f) => f.name === "META-INF/container.xml" || f.name.endsWith(".opf") }); } catch { return null; }
  const container = files["META-INF/container.xml"];
  if (!container) return null;
  const opfPath = /full-path="([^"]+)"/.exec(strFromU8(container))?.[1];
  const opf = opfPath && files[opfPath];
  if (!opf) return null;
  const xml = strFromU8(opf);
  return { title: tag(xml, "title"), author: tag(xml, "creator") };
}

// "I Shall Pursue Eternity (v236)" and "i shall pursue eternity" are the same book.
export const sameTitle = (a, b) => {
  const n = (s) => (s || "").toLowerCase().replace(/\(.*?\)|\[.*?\]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return !!n(a) && n(a) === n(b);
};
