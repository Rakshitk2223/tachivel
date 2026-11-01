import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// One tokens.css for everything: the React app imports it, and the listen-along reader (/novel) links it.
const tokens = fileURLToPath(new URL("../styles/tokens.css", import.meta.url));
const shareTokens = {
  name: "tachivel-share-tokens",
  configureServer(server) {
    server.middlewares.use("/novel/styles/tokens.css", (_req, res) => { res.setHeader("content-type", "text/css"); res.end(readFileSync(tokens)); });
  },
  generateBundle() {
    this.emitFile({ type: "asset", fileName: "novel/styles/tokens.css", source: readFileSync(tokens) });
  },
};

// Dev: `npm run dev` here, the API on :47620 (DEV_USER=dev node ../server/src/index.mjs) and Suwayomi on :4567.
const proxy = {
  "/api": { target: "http://localhost:47620" },
  "/suwayomi": { target: "http://localhost:4567", rewrite: (p) => p.replace(/^\/suwayomi/, ""), ws: true },
};
export default defineConfig({
  plugins: [react(), shareTokens],
  server: { port: 47610, fs: { allow: [".."] }, proxy },
  // `npm run build && npm run preview`: the real bundle (and service worker) against local services.
  preview: { port: 47611, proxy },
  build: { target: "safari16", sourcemap: false },
});
