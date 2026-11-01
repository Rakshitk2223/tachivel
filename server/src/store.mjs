// Everything Tachivel keeps lives in one folder (/data in Docker, on the 30 GB Tachivel disk).
//   books/<id>/meta.json + book.epub     progress/<bookId>.json     settings.json
import { mkdir, readFile, readdir, rename, rm, writeFile, stat, statfs } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const ID = /^[a-z0-9-]{1,40}$/;

export function fileStore(root) {
  const p = (...parts) => join(root, ...parts);

  // Write to a temp file and rename, so a crash mid-write never leaves half a JSON file behind.
  async function atomic(path, data) {
    await mkdir(join(path, ".."), { recursive: true });
    const tmp = `${path}.${randomUUID()}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, path);
  }
  async function readJSON(path) {
    try { return JSON.parse(await readFile(path, "utf8")); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  }

  return {
    root,
    validId: (id) => ID.test(id),
    async listBooks() {
      let ids = [];
      try { ids = await readdir(p("books")); } catch (e) { if (e.code !== "ENOENT") throw e; }
      const metas = await Promise.all(ids.filter((id) => ID.test(id)).map((id) => readJSON(p("books", id, "meta.json"))));
      return metas.filter(Boolean).sort((a, b) => b.uploadedAt - a.uploadedAt);
    },
    getBook: (id) => readJSON(p("books", id, "meta.json")),
    async putBook(meta, bytes) {
      await atomic(p("books", meta.id, "book.epub"), bytes);
      await atomic(p("books", meta.id, "meta.json"), JSON.stringify(meta));
    },
    async deleteBook(id) {
      await rm(p("books", id), { recursive: true, force: true });
      await rm(p("progress", `${id}.json`), { force: true });
    },
    async bookFile(id) {
      const path = p("books", id, "book.epub");
      try { const s = await stat(path); return { size: s.size, stream: () => createReadStream(path) }; } catch { return null; }
    },
    getProgress: (id) => readJSON(p("progress", `${id}.json`)),
    async allProgress() {
      let files = [];
      try { files = await readdir(p("progress")); } catch (e) { if (e.code !== "ENOENT") throw e; }
      const out = {};
      for (const f of files) if (f.endsWith(".json")) { const v = await readJSON(p("progress", f)); if (v) out[f.slice(0, -5)] = v; }
      return out;
    },
    putProgress: (id, v) => atomic(p("progress", `${id}.json`), JSON.stringify(v)),
    // The disk Tachivel lives on (the 30 GB image on the server), for the storage meter.
    async disk() {
      await mkdir(root, { recursive: true });
      const s = await statfs(root);
      return { total: s.blocks * s.bsize, free: s.bavail * s.bsize, used: (s.blocks - s.bfree) * s.bsize };
    },
    getSettings: () => readJSON(p("settings.json")),
    putSettings: (v) => atomic(p("settings.json"), JSON.stringify(v)),
  };
}
