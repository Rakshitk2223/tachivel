// All of Tachivel's cloud endpoints (/api/*): sign-in, bookmark sync, and the uploaded book.
import { getStore } from "@netlify/blobs";
import { handle } from "../lib/core.mjs";

export const config = { path: "/api/*" };

// Strong consistency: a phone reading right after the Mac writes must see the new place, not a minute-old one.
const store = (name) => getStore({ name, consistency: "strong" });

export default (req, context) =>
  handle(req, {
    stores: { library: store("library"), secrets: store("secrets"), limits: store("limits") },
    passphrase: Netlify.env.get("TACHIVEL_PASSPHRASE"),
    ip: context.ip,
  });
