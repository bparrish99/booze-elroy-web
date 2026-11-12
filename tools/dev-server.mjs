// Local preview: serves public/ and the leaderboard API (same code as the Netlify Function) on one port,
// with scores kept in a local Netlify Blobs store under .dev-blobs/. No Netlify account needed.
//   npm run dev                    -> http://localhost:8888   (reset password: "dev")
//   PORT=9000 LEADERBOARD_ADMIN_PASSWORD=secret npm run dev
//   http://localhost:8888/editor/  -> the maze editor (tools/maze-editor)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BlobsServer } from "@netlify/blobs/server";
import { getStore } from "@netlify/blobs";
import { handle } from "../netlify/lib/scores.mjs";
import { handleArenas } from "../netlify/lib/arenas.mjs";
import { handleAccounts } from "../netlify/lib/accounts.mjs";
import { handleEditor } from "./maze-editor/server.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };

export async function startDev(opts = {}) {
  const { port = 8888, blobsDir = join(ROOT, ".dev-blobs"), password = "dev", quiet = false } = opts; // opts.now: fake clock for tests; opts.editorRoot: the maze editor's files (tests)
  mkdirSync(blobsDir, { recursive: true });
  const token = "dev-token";
  const blobs = new BlobsServer({ directory: blobsDir, token });
  const { port: bport } = await blobs.start();
  const url = `http://localhost:${bport}`;
  const mkStore = (name) => getStore({ name, siteID: "dev-site", token, edgeURL: url, uncachedEdgeURL: url, consistency: "strong" });
  const store = mkStore("leaderboard"), arenaStore = mkStore("arenas"), accountStore = mkStore("accounts");
  const env = { LEADERBOARD_ADMIN_PASSWORD: password };

  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      if (u.pathname.startsWith("/api/scores") || u.pathname.startsWith("/api/arenas") || u.pathname.startsWith("/api/account/")) {
        const chunks = []; for await (const c of req) chunks.push(c);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const request = new Request(u, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : body });
        const r = u.pathname.startsWith("/api/arenas") ? await handleArenas(request, arenaStore, { env, now: opts.now })
          : u.pathname.startsWith("/api/account/") ? await handleAccounts(request, accountStore, { failDelay: opts.failDelay, now: opts.now })
          : await handle(request, store, { env });
        res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
        if (!quiet) console.log(req.method, u.pathname + u.search, r.status);
        return;
      }
      if (await handleEditor(req, res, u, { root: opts.editorRoot })) return; // the maze editor: /editor/ (dev only)
      const rel = normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, "") || "index.html";
      if (rel.startsWith("..")) { res.writeHead(403); res.end(); return; }
      const data = await readFile(join(ROOT, "public", rel));
      res.writeHead(200, { "content-type": TYPES[extname(rel)] || "application/octet-stream" }); res.end(data);
    } catch (e) {
      res.writeHead(e && e.code === "ENOENT" ? 404 : 500); res.end();
      if (!quiet && !(e && e.code === "ENOENT")) console.error(e);
    }
  });
  await new Promise((r) => server.listen(port, r));
  const addr = `http://localhost:${server.address().port}`;
  return { url: addr, async stop() { await new Promise((r) => server.close(r)); await blobs.stop(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 8888;
  const password = process.env.LEADERBOARD_ADMIN_PASSWORD || "dev";
  const { url } = await startDev({ port, password });
  console.log(`Booze Elroy dev server: ${url}   (leaderboard reset password: "${password}")   Ctrl+C to stop`);
}
