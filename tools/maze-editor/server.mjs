// The maze editor's half of the dev server (tools/dev-server.mjs): serves the editor at /editor/ and its small API.
// Private tool: none of this is deployed (Netlify serves public/ only).
//   GET  /editor/api/list            drafts (mazes/*.json) and the game's mazes
//   GET  /editor/api/draft?name=     a saved draft
//   POST /editor/api/draft           save a draft  { doc }
//   POST /editor/api/add             put a maze in the game, or update one already in it  { doc, maze }: assets/data.json + mazes/<name>.json, then npm run build
//   POST /editor/api/remove          take an editor maze (booze5+) out of the game  { name }
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const HERE = join(ROOT, "tools", "maze-editor");
const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
const STATIC = { "": "index.html", "index.html": "index.html", "editor.mjs": "editor.mjs", "autotile.mjs": "autotile.mjs" };
const SPRITES = { "spr8.png": join(ROOT, "assets/sprites/spr8.png"), "spr16.png": join(ROOT, "assets/sprites/spr16.png") };
const NAME = /^[a-z][a-z0-9]{0,15}$/;
const GAME_NAME = /^booze([5-9]|[1-9]\d+)$/; // editor mazes in the game: booze5 and up (booze1-4 are the originals)

const json = (res, status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
async function body(req) { const chunks = []; for await (const c of req) chunks.push(c); return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
const build = () => new Promise((resolve) => execFile("python3", [join(ROOT, "tools/build.py")], { cwd: ROOT }, (err, stdout, stderr) => resolve({ ok: !err, out: (stdout + stderr).trim() })));

// opts.root: where mazes/ and assets/data.json live (tests use a scratch folder; the page is only rebuilt for the repo)
export async function handleEditor(req, res, u, opts = {}) {
  const root = opts.root || ROOT, DRAFTS = join(root, "mazes"), DATA = join(root, "assets", "data.json");
  const rebuild = root === ROOT ? build : async () => ({ ok: true, out: "(not rebuilt: scratch root)" });
  if (!u.pathname.startsWith("/editor")) return false;
  if (u.pathname === "/editor") { res.writeHead(302, { location: "/editor/" }); res.end(); return true; }
  const rel = u.pathname.slice("/editor/".length);
  try {
    if (rel in STATIC || rel in SPRITES || rel === "data.json") {
      const file = rel in STATIC ? join(HERE, STATIC[rel]) : rel === "data.json" ? DATA : SPRITES[rel];
      res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(await readFile(file));
      return true;
    }
    if (rel === "api/list" && req.method === "GET") {
      await mkdir(DRAFTS, { recursive: true });
      const drafts = (await readdir(DRAFTS)).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();
      const data = JSON.parse(await readFile(DATA, "utf8"));
      return json(res, 200, { drafts, game: data.mazeNames }), true;
    }
    if (rel === "api/draft" && req.method === "GET") {
      const name = u.searchParams.get("name") || "";
      if (!NAME.test(name)) return json(res, 400, { error: "bad name" }), true;
      return json(res, 200, JSON.parse(await readFile(join(DRAFTS, name + ".json"), "utf8"))), true;
    }
    if (rel === "api/draft" && req.method === "POST") {
      const { doc } = await body(req);
      if (!doc || !NAME.test(doc.name || "")) return json(res, 400, { error: "names are a-z and 0-9, up to 16 characters, starting with a letter" }), true;
      await mkdir(DRAFTS, { recursive: true });
      await writeFile(join(DRAFTS, doc.name + ".json"), JSON.stringify(doc, null, 1) + "\n");
      return json(res, 200, { ok: true }), true;
    }
    if (rel === "api/add" && req.method === "POST") {
      const { doc, maze } = await body(req);
      const data = JSON.parse(await readFile(DATA, "utf8"));
      const isNew = !data.mazeNames.includes(doc && doc.name);
      // new mazes join as booze5, booze6, ...; any maze already in the game can be updated
      if (!doc || !maze || (isNew && !GAME_NAME.test(doc.name || ""))) return json(res, 400, { error: "a new maze joins the game as booze5, booze6, ..." }), true;
      if (!Array.isArray(maze.map) || maze.map.length !== 31 || maze.map.some((r) => typeof r !== "string" || r.length !== 28)) return json(res, 400, { error: "bad map" }), true;
      await mkdir(DRAFTS, { recursive: true });
      await writeFile(join(DRAFTS, doc.name + ".json"), JSON.stringify(doc, null, 1) + "\n");
      data.mazes[doc.name] = { ...(data.mazes[doc.name] || {}), ...maze }; // (an update keeps any field the editor doesn't write)
      if (isNew) data.mazeNames.push(doc.name);
      await writeFile(DATA, JSON.stringify(data));
      const b = await rebuild();
      return json(res, 200, { ok: b.ok, isNew, build: b.out }), true;
    }
    if (rel === "api/remove" && req.method === "POST") {
      const { name } = await body(req);
      if (!GAME_NAME.test(name || "")) return json(res, 400, { error: "only editor mazes (booze5 and up) can be removed" }), true;
      const data = JSON.parse(await readFile(DATA, "utf8"));
      if (!data.mazeNames.includes(name)) return json(res, 404, { error: name + " isn't in the game" }), true;
      delete data.mazes[name];
      data.mazeNames = data.mazeNames.filter((n) => n !== name);
      await writeFile(DATA, JSON.stringify(data));
      const b = await rebuild();
      return json(res, 200, { ok: b.ok, build: b.out }), true;
    }
    res.writeHead(404); res.end();
  } catch (e) {
    if (e && e.code === "ENOENT") { res.writeHead(404); res.end(); } else json(res, 500, { error: String(e && e.message || e) });
  }
  return true;
}
