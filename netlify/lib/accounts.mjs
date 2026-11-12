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
//   POST /api/account/played { day: "YYYY-MM-DD" } (Bearer) -> { streak }   a real game started on that day (the
//        player's own calendar day, within a day of the server's); streak = days in a row ending on that day
//   GET  /api/account/activity  (x-admin-key: LEADERBOARD_ADMIN_PASSWORD) -> { accounts: [names], events: [{ at, type,
//        name, detail }] newest first, the last 1000 }   the author's secret page (public/activity.html)
//
// Names follow the leaderboard's rules (scorekey cleanName: up to 16 of A-Z 0-9 ! - / space, upper-cased), so
// "pinback" and "PINBACK" are the same account. Passwords: 4 to 128 characters, anything goes; stored as scrypt hashes.
// Storage: blob "u/<hex of name>" = { name, salt, hash, createdAt }; blob "s/<sha256 of token>" = { name, createdAt }
// (only the token's hash is stored); blob "a/<hex of name>" = { <achievement id>: <ms earned> };
// blob "b/<hex of name>" = [board keys placed on]; blob "d/<hex of name>" = [days played, "YYYY-MM-DD", the last 60].
// Activity log: one empty blob per event, everything in its key, "e/<ISO time>/<type>/<hex of name>/<detail>/<rand>"
// (type: signup | login | achievement (detail: its id) | played (the first game of a day; detail: the streak) |
// score (detail: JSON [rank, score, settings]) | arenascore (detail: JSON [rank, score, arena name])), so
// listing the keys is the whole log, no reads.
// Sessions don't expire; logging out deletes one. Achievements are trust-the-client, like scores (src/achievements.js
// lists the ids).
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import scorekey from "../../src/scorekey.js";
import achievements from "../../src/achievements.js";
import { json, sleep, readBody, updateJSON, sha } from "./scores.mjs";

const { cleanName, isKey, MAX_SCORE } = scorekey;
const scryptP = promisify(scrypt);
export const PW_MIN = 4, PW_MAX = 128;
const hex = (name) => Buffer.from(name).toString("hex");
const userKey = (name) => "u/" + hex(name), achKey = (name) => "a/" + hex(name), placedKey = (name) => "b/" + hex(name), daysKey = (name) => "d/" + hex(name);
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
    if (r.first) await logEvent(store, "played", s.name, r.streak, now);
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
  if (action === "achievements") {
    if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "method not allowed" });
    const s = await session();
    if (!s) return json(401, { error: "not logged in" });
    if (req.method === "GET") return json(200, { achievements: (await store.get(achKey(s.name), { type: "json" })) || {} });
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
