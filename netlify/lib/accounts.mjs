// Accounts API (web-edition addition): a username and a password, nothing else (no email, no recovery).
//
//   POST /api/account/signup  { name, password } -> { name, token }   (409: name taken)
//   POST /api/account/login   { name, password } -> { name, token }   (403: wrong name or password)
//   GET  /api/account/me      (Authorization: Bearer <token>) -> { name }   (401: not logged in)
//   POST /api/account/logout  (Authorization: Bearer <token>) -> { ok: true }
//   GET  /api/account/achievements        (Bearer) -> { achievements: { <id>: <ms earned> } }
//   POST /api/account/achievements { id } (Bearer) -> { achievements, earned: true | false (already had it) }
//   POST /api/account/placed { board, rank?, score?, settings? } (Bearer) -> { count }   a top-10 score on that board:
//        remembered (once per board, never forgotten even if the score is pushed off later); count = boards placed on
//        so far. With rank and score it's logged too (settings: the client's one-line summary of the board)
//   POST /api/account/placed { arena, rank, score } (Bearer) -> { ok }   a top-10 score in an arena: only logged
//   POST /api/account/played { day: "YYYY-MM-DD", settings?, arena? } (Bearer) -> { streak }   a real game started on
//        that day (the player's own calendar day, within a day of the server's); streak = days in a row ending on that
//        day. Every one is logged (settings: the client's one-line summary; arena: its name when it's an arena game)
//   GET  /api/account/favorites           (Bearer) -> { favorites: [{ name, board }] }   saved gameplay settings
//   POST /api/account/favorites { name, board } (Bearer) -> { favorites }   adds one (the same name: replaced), at most
//        FAV_MAX (409 "full"); POST /api/account/unfavorite { name } (Bearer) -> { favorites }
//   GET  /api/account/picks  -> { picks: [{ name, board }] }   "Pinback's Picks": the author's account's favorites, for
//        everyone (no login; the title's sign)
//   GET  /api/account/activity  (x-admin-key: LEADERBOARD_ADMIN_PASSWORD) -> { accounts: [names], events: [{ at, type,
//        name, detail }] newest first, the last 1000 }   the author's secret page (public/activity.html)
//
// Names follow the leaderboard's rules (scorekey cleanName: up to 16 of A-Z 0-9 ! - / space, upper-cased), so
// "pinback" and "PINBACK" are the same account. Passwords: 4 to 128 characters, anything goes; stored as scrypt hashes.
// Storage: blob "u/<hex of name>" = { name, salt, hash, createdAt }; blob "s/<sha256 of token>" = { name, createdAt }
// (only the token's hash is stored); blob "a/<hex of name>" = { <achievement id>: <ms earned> };
// blob "b/<hex of name>" = [board keys placed on]; blob "d/<hex of name>" = [days played, "YYYY-MM-DD", the last 60].
// Activity log: one empty blob per event, everything in its key, "e/<ISO time>/<type>/<hex of name>/<detail>/<rand>"
// (type: signup | login | achievement (detail: its id) | game (every game started; detail: JSON [settings, streak on
// the first game of a day else 0, arena name or ""]) | played (before 2026-11-12: the first game of a day; detail: the streak) |
// score (detail: JSON [rank, score, settings]) | arenascore (detail: JSON [rank, score, arena name])), so
// listing the keys is the whole log, no reads.
// Sessions don't expire; logging out deletes one. Achievements are trust-the-client, like scores (src/achievements.js
// lists the ids).
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import scorekey from "../../src/scorekey.js";
import achievements from "../../src/achievements.js";
import { json, sleep, readBody, updateJSON, sha } from "./scores.mjs";

const { cleanName, isKey, configFor, MAX_SCORE } = scorekey;
const scryptP = promisify(scrypt);
export const PW_MIN = 4, PW_MAX = 128;
const hex = (name) => Buffer.from(name).toString("hex");
const userKey = (name) => "u/" + hex(name), achKey = (name) => "a/" + hex(name), placedKey = (name) => "b/" + hex(name), daysKey = (name) => "d/" + hex(name);
const favKey = (name) => "f/" + hex(name), retroKey = (name) => "r/" + hex(name);
// achievements earned before they existed (the author, 2026-11-15): the score ones and the points-in-a-mode ones can be
// read off the leaderboards (a board's key is its settings: ghost count, the mode; an entry is a name and a score). An
// account is checked once per RETRO_VERSION: bump it when such achievements are added, and everyone is checked again.
// (Names were only protected from 2026-11-12: an older score under an account's name might be someone else's)
export const RETRO_VERSION = 1;
async function retroAward(store, scoresStore, name) {
  if ((await store.get(retroKey(name))) === String(RETRO_VERSION)) return [];
  // this account's scores: entries under its name, or posted from it ("by", since 2026-11-15) under any name, or (older
  // ones under another name: the author's friend RJ plays as other names) on a board it placed on with a score it
  // logged (its "score" activity events, since 2026-11-11)
  const placed = new Set(await store.get(placedKey(name), { type: "json" }) || []);
  const logged = new Set();
  const { blobs: events } = await store.list();
  for (const ev of events) {
    const p = ev.key.split("/");
    if (p[0] !== "e" || p[2] !== "score" || p[3] !== hex(name)) continue;
    try { const d = JSON.parse(decodeURIComponent(p[4])); if (Array.isArray(d) && Number.isInteger(d[1])) logged.add(d[1]); } catch { /* ignore */ }
  }
  const { blobs } = await scoresStore.list();
  const best = new Map(); // board -> this account's best score there
  for (const b of blobs) {
    if (!isKey(b.key)) continue;
    const entries = await scoresStore.get(b.key, { type: "json" });
    for (const e of Array.isArray(entries) ? entries : []) {
      if (!e || !Number.isInteger(e.score)) continue;
      const mine = e.name === name || e.by === name || (placed.has(b.key) && logged.has(e.score));
      if (mine) best.set(b.key, Math.max(best.get(b.key) || 0, e.score));
    }
  }
  const due = achievements.LIST.filter((a) => (a.score || a.mode) && [...best].some(([key, score]) => {
    const c = configFor(key);
    if (!c || (a.minGhosts && !(c.ghostCount >= a.minGhosts))) return false;
    return a.score ? score >= a.score : score >= a.points && c[a.mode.key] === a.mode.value;
  })).map((a) => a.id);
  let fresh = [];
  if (due.length) {
    const r = await updateJSON(store, achKey(name), (cur) => {
      const have = cur && typeof cur === "object" ? cur : {}, now = Date.now();
      const add = due.filter((id) => !have[id]);
      if (!add.length) return { result: [] };
      const next = { ...have }; for (const id of add) next[id] = now;
      return { value: next, result: add };
    });
    if (!r) return []; // busy: try again next time (the marker isn't set)
    fresh = r;
    for (const id of fresh) await logEvent(store, "achievement", name, id);
  }
  await store.set(retroKey(name), String(RETRO_VERSION));
  return fresh;
}
// chicken dinner, from the server (2026-11-16: the friend RJ won two arenas under another name and the client's check,
// leader's name === the login, missed them): an arena closed (past the grace for late scores) with this account on top.
// The leader's account ("by") is kept since 2026-11-16; for arenas from before that, the winning score is matched against
// this account's logged arena scores (its "arenascore" activity events: rank, score, arena name). Checked at every
// achievements load (one read of the arena index; the activity log only for such older arenas)
const ARENA_GRACE = 15 * 60 * 1000;
async function arenaWins(store, arenasStore, name, now) {
  const have = (await store.get(achKey(name), { type: "json" })) || {};
  if (have.dinner) return [];
  const index = await arenasStore.get("index", { type: "json" });
  const closed = (index && Array.isArray(index.arenas) ? index.arenas : []).filter((a) => a && a.leader && now > a.endsAt + ARENA_GRACE);
  let won = closed.some((a) => a.leader.by === name || a.leader.name === name);
  const older = closed.filter((a) => !("by" in a.leader));
  if (!won && older.length) {
    const { blobs: events } = await store.list();
    for (const ev of events) {
      const p = ev.key.split("/");
      if (p[0] !== "e" || p[2] !== "arenascore" || p[3] !== hex(name)) continue;
      try {
        const d = JSON.parse(decodeURIComponent(p[4]));
        if (Array.isArray(d) && older.some((a) => a.leader.score === d[1] && a.name === d[2])) { won = true; break; }
      } catch { /* ignore */ }
    }
  }
  if (!won) return [];
  const r = await updateJSON(store, achKey(name), (cur) => {
    const h = cur && typeof cur === "object" ? cur : {};
    if (h.dinner) return { result: [] };
    return { value: { ...h, dinner: Date.now() }, result: ["dinner"] };
  });
  if (r && r.length) await logEvent(store, "achievement", name, "dinner");
  return r || [];
}
export const PICKS_OWNER = "PINBACK"; // whose favorites are "Pinback's Picks" (the author's account)
export const FAV_MAX = 15; // a favorites page holds this many (the author: as many as fit on one page)
const DAY = 86400000;
/** "YYYY-MM-DD" -> ms at its UTC midnight; NaN if it isn't a real date */
const dayMs = (d) => {
  const t = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(d + "T00:00:00Z") : NaN;
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === d ? t : NaN;
};
/** days in a row ending on `day`, from a list of days */
function streakOf(days, day) {
  const have = new Set(days);
  let n = 0;
  for (let t = dayMs(day); have.has(new Date(t).toISOString().slice(0, 10)); t -= DAY) n++;
  return n;
}
const sessionKey = (token) => "s/" + createHash("sha256").update(token).digest("hex");
const hashPw = async (pw, salt) => (await scryptP(pw, salt, 32)).toString("hex");
const goodPw = (pw) => typeof pw === "string" && pw.length >= PW_MIN && pw.length <= PW_MAX;
const DUMMY_SALT = "00000000000000000000000000000000";

const ACTIVITY_MAX = 1000;
/** add an event to the activity log (never fails the request it belongs to) */
async function logEvent(store, type, name, detail, now) {
  const key = "e/" + new Date(now || Date.now()).toISOString() + "/" + type + "/" + hex(name) + "/" + (detail === undefined || detail === "" ? "-" : encodeURIComponent(String(detail))) /* never empty: the store folds "//" */ + "/" + randomBytes(3).toString("hex");
  try { await store.set(key, ""); } catch { /* ignore */ }
}
async function newSession(store, name) {
  const token = randomBytes(24).toString("base64url");
  await store.setJSON(sessionKey(token), { name, createdAt: Date.now() });
  return token;
}
function tokenOf(req) {
  const m = /^Bearer ([A-Za-z0-9_-]{16,64})$/.exec(req.headers.get("authorization") || "");
  return m ? m[1] : null;
}

/** may this request put a score under `name`? An account's name only with that account's login (Bearer token);
 *  any other name, anyone. Used by the leaderboard and arena score endpoints (opts.nameCheck). If the accounts store
 *  can't be read, the score goes through (a hiccup there shouldn't lose a game). */
export function nameChecker(store) {
  return async (req, name) => {
    try {
      if (!(await store.get(userKey(name)))) return true;
      const token = tokenOf(req);
      const s = token ? await store.get(sessionKey(token), { type: "json" }) : null;
      return !!(s && s.name === name);
    } catch { return true; }
  };
}

/** logs a score that landed on a board or an arena when the request isn't logged in (logged-in players' scores are
 *  logged by /api/account/placed already), so the activity page shows who the strangers on the boards are (the author,
 *  2026-11-14). type "anonscore" (detail: JSON [rank, score, settings]) or "anonarenascore" ([rank, score, arena name]).
 *  Never fails the score it belongs to. Used by the leaderboard and arena score endpoints (opts.logAnon) */
export function anonLogger(store) {
  return async (req, type, name, detail) => {
    try {
      const token = tokenOf(req);
      if (token && (await store.get(sessionKey(token), { type: "json" }))) return;
      await logEvent(store, type, name, detail);
    } catch { /* ignore */ }
  };
}

/** the account a request is logged in as, or null: score posts keep it with the entry (never shown) */
export function accountOf(store) {
  return async (req) => {
    try { const token = tokenOf(req); const s = token ? await store.get(sessionKey(token), { type: "json" }) : null; return s && s.name ? s.name : null; } catch { return null; }
  };
}

export async function handleAccounts(req, store, opts = {}) {
  const failDelay = opts.failDelay === undefined ? 1000 : opts.failDelay;
  const path = new URL(req.url).pathname.replace(/\/+$/, "");
  const action = path.slice(path.lastIndexOf("/") + 1);

  const session = async () => { const token = tokenOf(req); const s = token ? await store.get(sessionKey(token), { type: "json" }) : null; return s && s.name ? s : null; };
  if (action === "activity") {
    if (req.method !== "GET") return json(405, { error: "method not allowed" });
    const secret = (opts.env || process.env).LEADERBOARD_ADMIN_PASSWORD;
    if (!secret) return json(503, { error: "not configured" });
    const given = req.headers.get("x-admin-key") || "";
    if (!timingSafeEqual(sha(given), sha(secret))) { await sleep(failDelay); return json(403, { error: "wrong password" }); }
    const { blobs } = await store.list();
    const unhex = (h) => { try { return Buffer.from(h, "hex").toString(); } catch { return "?"; } };
    const accounts = blobs.filter((b) => b.key.startsWith("u/")).map((b) => unhex(b.key.slice(2))).sort();
    const events = blobs.filter((b) => b.key.startsWith("e/")).map((b) => b.key.split("/")).filter((p) => p.length >= 5)
      .map((p) => ({ at: p[1], type: p[2], name: unhex(p[3]), detail: p[4] === "-" ? "" : decodeURIComponent(p[4]) }))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, ACTIVITY_MAX);
    return json(200, { accounts, events });
  }
  if (action === "me") {
    if (req.method !== "GET") return json(405, { error: "method not allowed" });
    const s = await session();
    return s ? json(200, { name: s.name }) : json(401, { error: "not logged in" });
  }
  if (action === "played") {
    if (req.method !== "POST") return json(405, { error: "method not allowed" });
    const s = await session();
    if (!s) return json(401, { error: "not logged in" });
    const body = await readBody(req);
    const t = body ? dayMs(body.day) : NaN, now = opts.now ? opts.now() : Date.now();
    if (!(Math.abs(t - now) <= 2 * DAY)) return json(400, { error: "bad day" }); // NaN fails too
    const r = await updateJSON(store, daysKey(s.name), (cur) => {
      const have = Array.isArray(cur) ? cur : [];
      if (have.includes(body.day)) return { result: { streak: streakOf(have, body.day) } };
      const next = [...have, body.day].sort().slice(-60);
      return { value: next, result: { streak: streakOf(next, body.day), first: true } };
    });
    if (!r) return json(409, { error: "busy, try again" });
    const text = (v) => (typeof v === "string" ? v.slice(0, 160) : "");
    await logEvent(store, "game", s.name, JSON.stringify([text(body.settings), r.first ? r.streak : 0, text(body.arena)]), now);
    return json(200, { streak: r.streak });
  }
  if (action === "placed") {
    if (req.method !== "POST") return json(405, { error: "method not allowed" });
    const s = await session();
    if (!s) return json(401, { error: "not logged in" });
    const body = await readBody(req);
    if (!body) return json(400, { error: "bad request" });
    const scored = Number.isInteger(body.rank) && body.rank >= 1 && body.rank <= 10 && Number.isInteger(body.score) && body.score >= 1 && body.score <= MAX_SCORE;
    const text = (v, n) => (typeof v === "string" ? v.replace(/[^\x20-\x7e]/g, "").slice(0, n) : "");
    if (body.arena !== undefined) { // an arena placement: only logged
      if (!scored || !text(body.arena, 24)) return json(400, { error: "bad arena score" });
      await logEvent(store, "arenascore", s.name, JSON.stringify([body.rank, body.score, text(body.arena, 24)]));
      return json(200, { ok: true });
    }
    if (!isKey(body.board)) return json(400, { error: "bad board" });
    const r = await updateJSON(store, placedKey(s.name), (cur) => {
      const have = Array.isArray(cur) ? cur : [];
      return have.includes(body.board) ? { result: { count: have.length } } : { value: [...have, body.board], result: { count: have.length + 1 } };
    });
    if (r && scored) await logEvent(store, "score", s.name, JSON.stringify([body.rank, body.score, text(body.settings, 160) || body.board]));
    return r ? json(200, r) : json(409, { error: "busy, try again" });
  }
  if (action === "picks") { // public: the author's favorites, as "Pinback's Picks" (the author, 2026-11-15)
    if (req.method !== "GET") return json(405, { error: "method not allowed" });
    const cur = await store.get(favKey(PICKS_OWNER), { type: "json" });
    return json(200, { picks: Array.isArray(cur) ? cur.filter((f) => f && cleanName(f.name) === f.name && isKey(f.board)) : [] });
  }
  // favorites (the author, 2026-11-15): named gameplay settings (a board key: the leaderboard's settings, not starting
  // level or looks), at most FAV_MAX, oldest first; adding a name that's there already replaces it
  if (action === "favorites" || action === "unfavorite") {
    const s = await session();
    if (!s) return json(401, { error: "not logged in" });
    const tidyFavs = (cur) => (Array.isArray(cur) ? cur.filter((f) => f && cleanName(f.name) === f.name && isKey(f.board)) : []);
    if (action === "favorites" && req.method === "GET") return json(200, { favorites: tidyFavs(await store.get(favKey(s.name), { type: "json" })) });
    if (req.method !== "POST") return json(405, { error: "method not allowed" });
    const body = await readBody(req), name = body && cleanName(body.name);
    if (!name) return json(400, { error: "bad name" });
    if (action === "favorites" && !isKey(body.board)) return json(400, { error: "bad board" });
    const r = await updateJSON(store, favKey(s.name), (cur) => {
      const have = tidyFavs(cur), rest = have.filter((f) => f.name !== name);
      if (action === "unfavorite") return { value: rest, result: { favorites: rest } };
      if (rest.length === have.length && have.length >= FAV_MAX) return { result: { full: true, favorites: have } };
      const next = rest.length === have.length ? [...have, { name, board: body.board }] : have.map((f) => (f.name === name ? { name, board: body.board } : f));
      return { value: next, result: { favorites: next } };
    });
    if (!r) return json(409, { error: "busy, try again" });
    return r.full ? json(409, { error: "full", favorites: r.favorites }) : json(200, { favorites: r.favorites });
  }
  if (action === "achievements") {
    if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "method not allowed" });
    const s = await session();
    if (!s) return json(401, { error: "not logged in" });
    if (req.method === "GET") {
      let retro = [];
      if (opts.scoresStore) { try { retro = await retroAward(store, opts.scoresStore, s.name); } catch { retro = []; } } // never fails the load
      if (opts.arenasStore) { try { retro = [...retro, ...await arenaWins(store, opts.arenasStore, s.name, opts.now ? opts.now() : Date.now())]; } catch { /* never fails the load */ } }
      return json(200, { achievements: (await store.get(achKey(s.name), { type: "json" })) || {}, ...(retro.length ? { retro } : {}) });
    }
    const body = await readBody(req);
    if (!body || !achievements.isId(body.id)) return json(400, { error: "bad achievement" });
    const r = await updateJSON(store, achKey(s.name), (cur) => {
      const have = cur && typeof cur === "object" ? cur : {};
      if (have[body.id]) return { result: { achievements: have, earned: false } };
      const next = { ...have, [body.id]: Date.now() };
      return { value: next, result: { achievements: next, earned: true } };
    });
    if (r && r.earned) await logEvent(store, "achievement", s.name, body.id);
    return r ? json(200, r) : json(409, { error: "busy, try again" });
  }
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  if (action === "logout") {
    const token = tokenOf(req);
    if (token) await store.delete(sessionKey(token));
    return json(200, { ok: true });
  }

  if (action === "signup" || action === "login") {
    const body = await readBody(req);
    if (!body) return json(400, { error: "bad request" });
    const name = cleanName(body.name);
    if (action === "signup") {
      if (!name) return json(400, { error: "bad name" });
      if (!goodPw(body.password)) return json(400, { error: "bad password" });
      const salt = randomBytes(16).toString("hex");
      const res = await store.setJSON(userKey(name), { name, salt, hash: await hashPw(body.password, salt), createdAt: Date.now() }, { onlyIfNew: true });
      if (!res.modified) return json(409, { error: "name taken" });
      await logEvent(store, "signup", name);
      return json(200, { name, token: await newSession(store, name) });
    }
    const user = name ? await store.get(userKey(name), { type: "json" }) : null;
    const pw = typeof body.password === "string" ? body.password.slice(0, PW_MAX) : "";
    const hash = await hashPw(pw, user ? user.salt : DUMMY_SALT); // hashed either way, so a missing name takes as long
    if (!user || !timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.hash, "hex"))) {
      await sleep(failDelay); // slows down guessing
      return json(403, { error: "wrong name or password" });
    }
    await logEvent(store, "login", user.name);
    return json(200, { name: user.name, token: await newSession(store, user.name) });
  }

  return json(404, { error: "not found" });
}
