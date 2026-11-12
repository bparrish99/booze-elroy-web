// Arenas API (web-edition addition): temporary leaderboards for one set of gameplay settings.
// An arena is open for 24 hours, then stays listed (with its winner) for another 24 hours, then drops off.
//
//   GET  /api/arenas                         -> { now, arenas: [{ id, name, board, createdAt, endsAt, leader }] }
//   GET  /api/arenas/board?id=<id>           -> { now, arena, entries }
//   POST /api/arenas         { name, board } -> { now, arena }            (409: an open arena has that name)
//   POST /api/arenas/score   { id, name, score } -> { now, arena, entries, rank, best? }   (410: arena closed)
//        one entry per name: a better score replaces that name's old one; a worse one gets rank null, best = their score
//        403 "name taken": the name is an account's and the request isn't logged in as it (opts.nameCheck)
//   POST /api/arenas/delete  { id, password } -> { deleted: id }          (LEADERBOARD_ADMIN_PASSWORD)
//
// Storage: blob "index" lists the arenas (with each one's current leader, for the list page);
// blob "e/<id>" holds an arena's top 10. Times are server milliseconds; clients use `now` to correct their clock.
// Trust-the-client like the main leaderboard. A short grace period after closing lets games that were
// running when the clock ran out still post.
import { randomBytes, timingSafeEqual } from "node:crypto";
import scorekey from "../../src/scorekey.js";
import { json, sha, sleep, readBody, tidy, updateJSON, addScore } from "./scores.mjs";

const { isKey, cleanName, MAX_SCORE } = scorekey;
export const HOUR = 3600 * 1000;
export const OPEN_FOR = 24 * HOUR, LISTED_FOR = 24 * HOUR, GRACE = 15 * 60 * 1000;
const INDEX = "index";
const entriesKey = (id) => "e/" + id;
const isId = (s) => typeof s === "string" && /^[a-z0-9]{10}$/.test(s);
const newId = () => { let s = ""; for (const b of randomBytes(10)) s += "0123456789abcdefghijklmnopqrstuvwxyz"[b % 36]; return s; };

const listOf = (data) => (data && Array.isArray(data.arenas) ? data.arenas : []);
const live = (arenas, now) => arenas.filter((a) => a.endsAt + LISTED_FOR > now);
const show = (a) => ({ id: a.id, name: a.name, board: a.board, createdAt: a.createdAt, endsAt: a.endsAt, leader: a.leader || null });

export async function handleArenas(req, store, opts = {}) {
  const env = opts.env || process.env;
  const failDelay = opts.failDelay === undefined ? 1000 : opts.failDelay;
  const nowFn = opts.now || Date.now;
  const u = new URL(req.url);
  const path = u.pathname.replace(/\/+$/, "");
  const now = nowFn();
  const find = async (id) => listOf(await store.get(INDEX, { type: "json" })).find((a) => a.id === id) || null;

  if (req.method === "GET" && path.endsWith("/arenas")) {
    const arenas = live(listOf(await store.get(INDEX, { type: "json" })), now).map(show);
    return json(200, { now, arenas });
  }
  if (req.method === "GET" && path.endsWith("/board")) {
    const id = u.searchParams.get("id");
    if (!isId(id)) return json(400, { error: "bad id" });
    const a = await find(id);
    if (!a || a.endsAt + LISTED_FOR <= now) return json(404, { error: "no such arena" });
    return json(200, { now, arena: show(a), entries: tidy(await store.get(entriesKey(id), { type: "json" })) });
  }
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  const body = await readBody(req);
  if (!body) return json(400, { error: "bad request" });

  if (path.endsWith("/arenas")) { // create
    const name = cleanName(body.name);
    if (!name) return json(400, { error: "bad name" });
    if (!isKey(body.board)) return json(400, { error: "bad board" });
    const arena = { id: newId(), name, board: body.board, createdAt: now, endsAt: now + OPEN_FOR, leader: null };
    let dropped = [];
    const r = await updateJSON(store, INDEX, (data) => {
      const all = listOf(data), keep = live(all, now);
      if (keep.some((a) => a.endsAt > now && a.name === name)) return { result: "taken" };
      dropped = all.filter((a) => !keep.includes(a));
      return { value: { arenas: keep.concat([arena]) }, result: "ok" };
    });
    if (r === null) return json(409, { error: "busy, try again" });
    if (r === "taken") return json(409, { error: "name taken" });
    for (const a of dropped) await store.delete(entriesKey(a.id)).catch(() => {}); // tidy up arenas that fell off
    return json(200, { now, arena: show(arena) });
  }

  if (path.endsWith("/score")) {
    const { id, score } = body;
    const name = cleanName(body.name);
    if (!isId(id)) return json(400, { error: "bad id" });
    if (!name) return json(400, { error: "bad name" });
    if (!Number.isInteger(score) || score < 1 || score > MAX_SCORE) return json(400, { error: "bad score" });
    const a = await find(id);
    if (!a) return json(404, { error: "no such arena" });
    if (now > a.endsAt + GRACE) return json(410, { error: "arena closed", arena: show(a) });
    if (opts.nameCheck && !(await opts.nameCheck(req, name))) return json(403, { error: "name taken" });
    const r = await addScore(store, entriesKey(id), name, score, true); // one entry per name
    if (!r) return json(409, { error: "busy, try again" });
    let arena = a;
    if (r.rank === 1) { // new leader: note it in the index for the list page
      const top = r.entries[0];
      await updateJSON(store, INDEX, (data) => {
        const all = listOf(data), i = all.findIndex((x) => x.id === id);
        if (i < 0) return { result: null };
        const cur = all[i].leader;
        if (cur && cur.score >= top.score) { arena = all[i]; return { result: null }; }
        arena = { ...all[i], leader: { name: top.name, score: top.score } };
        const next = all.slice(); next[i] = arena;
        return { value: { arenas: next }, result: null };
      });
    }
    return json(200, { now, arena: show(arena), entries: r.entries, rank: r.rank, ...(r.best ? { best: r.best } : {}) });
  }

  if (path.endsWith("/delete")) {
    const secret = env.LEADERBOARD_ADMIN_PASSWORD;
    if (!secret) return json(503, { error: "delete is not configured" });
    if (typeof body.password !== "string" || !timingSafeEqual(sha(body.password), sha(secret))) {
      await sleep(failDelay);
      return json(403, { error: "wrong password" });
    }
    if (!isId(body.id)) return json(400, { error: "bad id" });
    const r = await updateJSON(store, INDEX, (data) => {
      const all = listOf(data);
      return all.some((a) => a.id === body.id) ? { value: { arenas: all.filter((a) => a.id !== body.id) }, result: "ok" } : { result: "missing" };
    });
    if (r === "missing") return json(404, { error: "no such arena" });
    await store.delete(entriesKey(body.id)).catch(() => {});
    return json(200, { deleted: body.id });
  }
  return json(404, { error: "not found" });
}
