// Leaderboard API (web-edition addition). Storage-agnostic so tests can pass an in-memory store;
// netlify/functions/scores.mjs wires it to Netlify Blobs.
//
//   GET  /api/scores?board=<key>                      -> { board, entries: [{ name, score, at }] }
//   POST /api/scores        { board, name, score }    -> { board, entries, rank }   (rank null: didn't make the top 10)
//   POST /api/scores/reset  { password, board? }      -> { reset: "all" | <key> }    (needs LEADERBOARD_ADMIN_PASSWORD)
//
// Trust-the-client: scores aren't verified, only checked for shape. Each board is one JSON blob; writes are
// conditional on the blob's ETag so two simultaneous submissions to the same board can't drop each other.
import { createHash, timingSafeEqual } from "node:crypto";
import scorekey from "../../src/scorekey.js";

const { isKey, cleanName, placeOf, MAX_SCORE, BOARD_SIZE } = scorekey;
const MAX_BODY = 2048;
const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});
const sha = (s) => createHash("sha256").update(String(s)).digest();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function readBody(req) {
  const text = await req.text();
  if (text.length > MAX_BODY) return null;
  try { const b = JSON.parse(text); return b && typeof b === "object" ? b : null; } catch { return null; }
}
const tidy = (entries) => (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.score === "number" && typeof e.name === "string");

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
    for (let attempt = 0; attempt < 6; attempt++) {
      const cur = await store.getWithMetadata(board, { type: "json" });
      const entries = tidy(cur && cur.data);
      const i = placeOf(entries, score);
      if (i < 0) return json(200, { board, entries, rank: null });
      const next = entries.slice();
      next.splice(i, 0, { name, score, at: new Date().toISOString() });
      next.length = Math.min(next.length, BOARD_SIZE);
      // conditional on what we read; the local dev Blobs server returns no ETag on reads, so there it's last-write-wins
      const cond = !cur ? { onlyIfNew: true } : cur.etag ? { onlyIfMatch: cur.etag } : {};
      const res = await store.setJSON(board, next, cond);
      if (res.modified) return json(200, { board, entries: next, rank: i + 1 });
      await sleep(20 + Math.random() * 80); // someone else wrote first: re-read and retry
    }
    return json(409, { error: "busy, try again" });
  }

  return json(405, { error: "method not allowed" });
}
