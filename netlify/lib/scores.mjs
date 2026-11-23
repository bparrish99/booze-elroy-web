// Leaderboard API (web-edition addition). Storage-agnostic so tests can pass an in-memory store;
// netlify/functions/scores.mjs wires it to Netlify Blobs.
//
//   GET  /api/scores?board=<key>                      -> { board, entries: [{ name, score, at }] }
//   POST /api/scores        { board, name, score }    -> { board, entries, rank }   (rank null: didn't make the top 10)
//        403 "name taken": the name is an account's and the request isn't logged in as it (opts.nameCheck)
//   GET  /api/scores/boards                           -> { boards: [{ board, count, top: { name, score } }] }  (every board with scores)
//   POST /api/scores/reset  { password, board? | scope: "main" }  -> { reset: "all" | "main" | <key> }    (needs LEADERBOARD_ADMIN_PASSWORD)
//
// Trust-the-client: scores aren't verified, only checked for shape. Each board is one JSON blob; writes are
// conditional on the blob's ETag so two simultaneous submissions to the same board can't drop each other.
import { createHash, timingSafeEqual, randomBytes } from "node:crypto";
import scorekey from "../../src/scorekey.js";

const { isKey, isBoardKey, isNeat, NEAT, isOg, OG, cleanName, placeOf, MAX_SCORE, BOARD_SIZE } = scorekey;
const MAX_BODY = 2048;
export const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json", "cache-control": "no-store" },
});
export const sha = (s) => createHash("sha256").update(String(s)).digest();
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// max: score posts carry a replay (2026-11-18), so they take up to REPLAY_MAX more; everything else keeps the 2 KB cap
// (a long game's replay went over it, and the whole post, score and all, came back 400: the author lost a score to it)
export async function readBody(req, max = MAX_BODY) {
  const text = await req.text();
  if (text.length > max) return null;
  try { const b = JSON.parse(text); return b && typeof b === "object" ? b : null; } catch { return null; }
}
export const tidy = (entries) => (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.score === "number" && typeof e.name === "string");
// what a board shows: name, score, date. An entry posted while logged in also keeps the account that posted it ("by":
// achievements earned before they existed, even under another name; 2026-11-15), never sent out
// (rid: the entry's replay, if it has one: the client fetches it from GET /api/scores/replay?id=<rid>)
export const shown = (entries) => entries.map(({ name, score, at, rid }) => ({ name, score, at, ...(rid ? { rid } : {}) }));

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
export function addScore(store, key, name, score, unique, by, rid) {
  return updateJSON(store, key, (data) => {
    const entries = tidy(data);
    const mine = unique ? entries.find((e) => e.name === name) : null;
    if (mine && mine.score >= score) return { result: { entries, rank: null, best: mine.score } };
    const others = mine ? entries.filter((e) => e !== mine) : entries;
    const i = placeOf(others, score);
    if (i < 0) return { result: { entries, rank: null } };
    const next = others.slice();
    next.splice(i, 0, { name, score, at: new Date().toISOString(), ...(by ? { by } : {}), ...(rid ? { rid } : {}) });
    next.length = Math.min(next.length, BOARD_SIZE);
    // dropped: the replays of the entries that left the board (pushed off the end, or replaced by the same name's better)
    const dropped = entries.filter((e) => e.rid && !next.includes(e)).map((e) => e.rid);
    return { value: next, result: { entries: next, rank: i + 1, dropped } };
  });
}

// replays (2026-11-18): kept in their own store, one per top-10 entry that has one ("rid"), gone when the entry goes
export const REPLAY_MAX = 400000; // characters (a long game packs to a few tens of KB)
export const newRid = () => randomBytes(9).toString("base64url");
export const okReplay = (r) => typeof r === "string" && r.length <= REPLAY_MAX && /^(gz|js):/.test(r);
export async function dropReplays(replays, rids) {
  if (!replays || !rids || !rids.length) return;
  await Promise.all(rids.map((rid) => replays.delete("r/" + rid).catch(() => {})));
}
// whose account may take a replay off a score (the author's: the same as Pinback's Picks' owner)
export const REPLAY_OWNER = "PINBACK";
export async function unreplay(req, store, key, rid, opts) {
  const who = opts.accountOf ? await opts.accountOf(req) : null;
  if (who !== REPLAY_OWNER) { await sleep(opts.failDelay === undefined ? 1000 : opts.failDelay); return json(403, { error: "not yours to delete" }); }
  if (typeof rid !== "string" || !/^[A-Za-z0-9_-]{6,20}$/.test(rid)) return json(400, { error: "bad id" });
  const r = await updateJSON(store, key, (data) => {
    const entries = tidy(data);
    if (!entries.some((e) => e.rid === rid)) return { result: { entries, found: false } };
    const next = entries.map((e) => { if (e.rid !== rid) return e; const rest = { ...e }; delete rest.rid; return rest; });
    return { value: next, result: { entries: next, found: true } };
  });
  if (!r) return json(409, { error: "busy, try again" });
  if (r.found) await dropReplays(opts.replays, [rid]);
  return r.found ? json(200, { entries: shown(r.entries) }) : json(404, { error: "no such replay" });
}
export async function getReplay(req, replays) {
  if (req.method !== "GET") return json(405, { error: "method not allowed" });
  const id = new URL(req.url).searchParams.get("id");
  if (!replays || typeof id !== "string" || !/^[A-Za-z0-9_-]{6,20}$/.test(id)) return json(400, { error: "bad id" });
  const r = await replays.getWithMetadata("r/" + id);
  return r && r.data ? json(200, { replay: r.data, name: (r.metadata && r.metadata.name) || "" }) : json(404, { error: "no such replay" });
}

// THE SWAP (2026-11-23: NEAT became the default game, the author's original hidden behind "ogelroy"; a fresh start): once, on
// the first request after the deploy, the original's boards (plain keys) move to "og:<key>" and NEAT's ("neat:<key>") take the
// plain keys, so arenas, favorites, achievements and the Leaderboards page carry on with the default game unchanged. Nothing
// is deleted. A marker blob (written only if new: a lock against two instances) makes sure it never runs twice; a reset of
// every board writes it again. Entries keep their replays (the replay store is apart)
export const SWAP_MARK = "_swap-og";
let swapped = false;
export async function swapForNeat(store) {
  if (swapped) return;
  if (await store.get(SWAP_MARK, { type: "json" })) { swapped = true; return; }
  const lock = await store.setJSON(SWAP_MARK, { state: "running", at: new Date().toISOString() }, { onlyIfNew: true });
  if (lock && lock.modified === false) { swapped = true; return; } // (another instance is doing it)
  const keys = (await store.list()).blobs.map((b) => b.key);
  for (const k of keys.filter(isKey)) { const v = await store.get(k, { type: "json" }); if (v) await store.setJSON(OG + k, v); await store.delete(k); }
  for (const k of keys.filter((k2) => isNeat(k2) && isKey(k2.slice(NEAT.length)))) { const v = await store.get(k, { type: "json" }); if (v) await store.setJSON(k.slice(NEAT.length), v); await store.delete(k); }
  await store.setJSON(SWAP_MARK, { state: "done", at: new Date().toISOString() });
  swapped = true;
}
export const resetSwapMemo = () => { swapped = false; }; // (tests: a fresh store)

export async function handle(req, store, opts = {}) {
  const env = opts.env || process.env;
  if (!opts.noSwap) await swapForNeat(store);
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
    const ridsOf = async (key) => tidy(await store.get(key, { type: "json" })).map((e) => e.rid).filter(Boolean);
    if (body.board !== undefined) {
      if (!isBoardKey(body.board)) return json(400, { error: "bad board" });
      await dropReplays(opts.replays, await ridsOf(body.board));
      await store.delete(body.board);
      return json(200, { reset: body.board });
    }
    // { scope: "main" }: every board of the default game (the plain keys) and their replays; the OG archive and the hidden
    // games' boards stay (the author, 2026-11-23: a fresh start for the main boards without losing the original's scores)
    if (body.scope === "main") {
      const keys = (await store.list()).blobs.map((b) => b.key).filter(isKey);
      for (const k of keys) { await dropReplays(opts.replays, await ridsOf(k)); await store.delete(k); }
      return json(200, { reset: "main", boards: keys.length });
    }
    if (opts.replays) { const { blobs } = await store.list(); for (const b of blobs) if (isBoardKey(b.key)) await dropReplays(opts.replays, await ridsOf(b.key)); }
    await store.deleteAll();
    await store.setJSON(SWAP_MARK, { state: "done", at: new Date().toISOString() }); // (an empty store: nothing ever to swap again)
    return json(200, { reset: "all" });
  }

  if (path.endsWith("/replay")) return getReplay(req, opts.replays);
  // the author's delete (2026-11-19): POST /api/scores/unreplay { board, rid } takes a replay off its score (the score stays),
  // only from the owner's account (REPLAY_OWNER, by its login)
  if (path.endsWith("/unreplay")) {
    const body = await readBody(req);
    if (req.method !== "POST" || !body) return json(400, { error: "bad request" });
    if (!isBoardKey(body.board)) return json(400, { error: "bad board" });
    return unreplay(req, store, body.board, body.rid, opts);
  }
  // every replay on every board in one go: [{ rid, name }] (only the olive's endless loop asks: one request, not one a
  // board; 2026-11-18)
  if (path.endsWith("/replays")) {
    if (req.method !== "GET") return json(405, { error: "method not allowed" });
    const { blobs } = await store.list(), keys = blobs.map((b) => b.key).filter(isKey), replays = [];
    for (let i = 0; i < keys.length; i += 25) {
      const part = await Promise.all(keys.slice(i, i + 25).map(async (k) => tidy(await store.get(k, { type: "json" })).filter((e) => e.rid).map((e) => ({ rid: e.rid, name: e.name }))));
      for (const p of part) replays.push(...p);
    }
    return json(200, { replays });
  }

  if (path.endsWith("/boards")) {
    if (req.method !== "GET") return json(405, { error: "method not allowed" });
    // (?og=1: the original game's boards instead, "ogelroy"; the regular list never shows them)
    const og = new URL(req.url).searchParams.get("og") === "1";
    const { blobs } = await store.list();
    const keys = blobs.map((b) => b.key).filter((k) => (og ? isOg(k) && isBoardKey(k) : isKey(k)));
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
    if (!isBoardKey(board)) return json(400, { error: "bad board" });
    return json(200, { board, entries: shown(tidy(await store.get(board, { type: "json" }))) });
  }

  if (req.method === "POST") {
    const body = await readBody(req, MAX_BODY + REPLAY_MAX);
    if (!body) return json(400, { error: "bad request" });
    const { board, score } = body;
    const name = cleanName(body.name);
    if (!isBoardKey(board)) return json(400, { error: "bad board" });
    if (!name) return json(400, { error: "bad name" });
    if (!Number.isInteger(score) || score < 1 || score > MAX_SCORE) return json(400, { error: "bad score" });
    if (opts.nameCheck && !(await opts.nameCheck(req, name))) return json(403, { error: "name taken" });
    const by = opts.accountOf ? await opts.accountOf(req) : null; // the logged-in account, if any (kept, never shown)
    const rid = opts.replays && okReplay(body.replay) ? newRid() : null; // its replay, kept only if it places
    const r = await addScore(store, board, name, score, false, by, rid);
    if (r && r.rank && rid) await opts.replays.set("r/" + rid, body.replay, { metadata: { name } }); // (its player's name: a shared link shows it)
    if (r) { await dropReplays(opts.replays, r.dropped); delete r.dropped; }
    if (r && r.rank && opts.logAnon) { // a logged-out score that placed: on the activity page (settings: the client's summary)
      const settings = typeof body.settings === "string" ? body.settings.replace(/[^\x20-\x7e]/g, "").slice(0, 160) : "";
      await opts.logAnon(req, "anonscore", name, JSON.stringify([r.rank, score, settings || board]));
    }
    return r ? json(200, { board, ...r, entries: shown(r.entries) }) : json(409, { error: "busy, try again" });
  }

  return json(405, { error: "method not allowed" });
}
