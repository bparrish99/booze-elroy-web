// Local preview: serves public/ and the leaderboard API (same code as the Netlify Function) on one port,
// with scores kept in a local Netlify Blobs store under .dev-blobs/. No Netlify account needed.
//   npm run dev                    -> http://localhost:8888   (reset password: "dev")
//   PORT=9000 LEADERBOARD_ADMIN_PASSWORD=secret npm run dev
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { mkdirSync } from "node:fs";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BlobsServer } from "@netlify/blobs/server";
import { getStore } from "@netlify/blobs";
import { handle } from "../netlify/lib/scores.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };

export async function startDev({ port = 8888, blobsDir = join(ROOT, ".dev-blobs"), password = "dev", quiet = false } = {}) {
  mkdirSync(blobsDir, { recursive: true });
  const token = "dev-token";
  const blobs = new BlobsServer({ directory: blobsDir, token });
  const { port: bport } = await blobs.start();
  const url = `http://localhost:${bport}`;
  const store = getStore({ name: "leaderboard", siteID: "dev-site", token, edgeURL: url, uncachedEdgeURL: url, consistency: "strong" });
  const env = { LEADERBOARD_ADMIN_PASSWORD: password };

  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url, "http://localhost");
      if (u.pathname.startsWith("/api/scores")) {
        const chunks = []; for await (const c of req) chunks.push(c);
        const body = chunks.length ? Buffer.concat(chunks) : undefined;
        const r = await handle(new Request(u, { method: req.method, headers: req.headers, body: req.method === "GET" ? undefined : body }), store, { env });
        res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
        if (!quiet) console.log(req.method, u.pathname + u.search, r.status);
        return;
      }
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
