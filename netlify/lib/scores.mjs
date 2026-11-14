// Leaderboard API (web-edition addition). Storage-agnostic so tests can pass an in-memory store;
// netlify/functions/scores.mjs wires it to Netlify Blobs.
//
//   GET  /api/scores?board=<key>                      -> { board, entries: [{ name, score, at }] }
//   POST /api/scores        { board, name, score }    -> { board, entries, rank }   (rank null: didn't make the top 10)
//        403 "name taken": the name is an account's and the request isn't logged in as it (opts.nameCheck)
//   GET  /api/scores/boards                           -> { boards: [{ board, count, top: { name, score } }] }  (every board with scores)
//   POST /api/scores/reset  { password, board? }      -> { reset: "all" | <key> }    (needs LEADERBOARD_ADMIN_PASSWORD)
//
// Trust-the-client: scores aren't verified, only checked for shape. Each board is one JSON blob; writes are
// conditional on the blob's ETag so two simultaneous submissions to the same board can't drop each other.
import { createHash, timingSafeEqual } from "node:crypto";
import scorekey from "../../src/scorekey.js";

const { isKey, cleanName, placeOf, MAX_SCORE, BOARD_SIZE } = scorekey;
const MAX_BODY = 2048;
export const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});
export const sha = (s) => createHash("sha256").update(String(s)).digest();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function readBody(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try { const b = JSON.parse(text); return b && typeof b === "object" ? b : null; } catch { return null; }
}
export const tidy = (entries) => (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.score === "number" && typeof e.name === "string");

/** read-modify-write of one JSON blob, conditional on what was read (retried if someone else wrote first).
 *  change(current | null) returns { value, result } to write, or { result } alone to leave the blob as it is. */
export async function updateJSON(store, key, change) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await store.getWithMetadata(key, { type: "json" });
    const { value, result } = change(cur ? cur.data : null);
    if (value === undefined) return result;
    // the local dev Blobs server returns no ETag on reads, so there it's last-write-wins
    const cond = !cur ? { onlyIfNew: true } : cur.etag ? { onlyIfMatch: cur.etag } : {};
    const res = await store.setJSON(key, value, cond);
    if (res.modified) return result;
    await sleep(20 + Math.random() * 80);
  }
  return null; // busy
}
/** put a score into a top-10 blob -> { entries, rank } (rank null: didn't place), or null if the store stayed busy.
 *  unique: one entry per name (arena boards): a better score replaces that name's old one; a worse one doesn't place
 *  ({ rank: null, best: <their score on the board> }). */
export function addScore(store, key, name, score, unique) {
  return updateJSON(store, key, (data) => {
    const entries = tidy(data);
    const mine = unique ? entries.find((e) => e.name === name) : null;
    if (mine && mine.score >= score) return { result: { entries, rank: null, best: mine.score } };
    const others = mine ? entries.filter((e) => e !== mine) : entries;
    const i = placeOf(others, score);
    if (i < 0) return { result: { entries, rank: null } };
    const next = others.slice();
    next.splice(i, 0, { name, score, at: new Date().toISOString() });
    next.length = Math.min(next.length, BOARD_SIZE);
    return { value: next, result: { entries: next, rank: i + 1 } };
  });
}

export async function handle(req, store, opts = {}) {
  const env = opts.env || process.env;
  const failDelay = opts.failDelay === undefined ? 1000 : opts.failDelay;
  const path = new URL(req.url).pathname.replace(/\/+$/, "");

  if (path.endsWith("/reset")) {
    if (req.method !== "POST") return json(405, { error: "method not allowed" });
    const secret = env.LEADERBOARD_ADMIN_PASSWORD;
    if (!secret) return json(503, { error: "reset is not configured" });
    const body = await readBody(req);
    if (!body || typeof body.password !== "string" || !timingSafeEqual(sha(body.password), sha(secret))) {
      await sleep(failDelay); // slows down guessing
      return json(403, { error: "wrong password" });
    }
    if (body.board !== undefined) {
      if (!isKey(body.board)) return json(400, { error: "bad board" });
      await store.delete(body.board);
      return json(200, { reset: body.board });
    }
    await store.deleteAll();
    return json(200, { reset: "all" });
  }

  if (path.endsWith("/boards")) {
    if (req.method !== "GET") return json(405, { error: "method not allowed" });
    const { blobs } = await store.list();
    const keys = blobs.map((b) => b.key).filter(isKey);
    const boards = [];
    for (let i = 0; i < keys.length; i += 25) { // a few reads at a time
      const part = await Promise.all(keys.slice(i, i + 25).map(async (board) => {
        const entries = tidy(await store.get(board, { type: "json" }));
        return entries.length ? { board, count: entries.length, top: { name: entries[0].name, score: entries[0].score } } : null;
      }));
      boards.push(...part.filter(Boolean));
    }
    return json(200, { boards });
  }

  if (req.method === "GET") {
    const board = new URL(req.url).searchParams.get("board");
    if (!isKey(board)) return json(400, { error: "bad board" });
    return json(200, { board, entries: tidy(await store.get(board, { type: "json" })) });
  }

  if (req.method === "POST") {
    const body = await readBody(req);
    if (!body) return json(400, { error: "bad request" });
    const { board, score } = body;
    const name = cleanName(body.name);
    if (!isKey(board)) return json(400, { error: "bad board" });
    if (!name) return json(400, { error: "bad name" });
    if (!Number.isInteger(score) || score < 1 || score > MAX_SCORE) return json(400, { error: "bad score" });
    if (opts.nameCheck && !(await opts.nameCheck(req, name))) return json(403, { error: "name taken" });
    const r = await addScore(store, board, name, score);
    if (r && r.rank && opts.logAnon) { // a logged-out score that placed: on the activity page (settings: the client's summary)
      const settings = typeof body.settings === "string" ? body.settings.replace(/[^\x20-\x7e]/g, "").slice(0, 160) : "";
      await opts.logAnon(req, "anonscore", name, JSON.stringify([r.rank, score, settings || board]));
    }
    return r ? json(200, { board, ...r }) : json(409, { error: "busy, try again" });
  }

  return json(405, { error: "method not allowed" });
}
