// Accounts API (web-edition addition): a username and a password, nothing else (no email, no recovery).
//
//   POST /api/account/signup  { name, password } -> { name, token }   (409: name taken)
//   POST /api/account/login   { name, password } -> { name, token }   (403: wrong name or password)
//   GET  /api/account/me      (Authorization: Bearer <token>) -> { name }   (401: not logged in)
//   POST /api/account/logout  (Authorization: Bearer <token>) -> { ok: true }
//   GET  /api/account/achievements        (Bearer) -> { achievements: { <id>: <ms earned> } }
//   POST /api/account/achievements { id } (Bearer) -> { achievements, earned: true | false (already had it) }
//   POST /api/account/placed { board }    (Bearer) -> { count }   a top-10 score on that board: remembered (once per
//        board, never forgotten even if the score is pushed off later); count = boards placed on so far
//   POST /api/account/played { day: "YYYY-MM-DD" } (Bearer) -> { streak }   a real game started on that day (the
//        player's own calendar day, within a day of the server's); streak = days in a row ending on that day
//
// Names follow the leaderboard's rules (scorekey cleanName: up to 16 of A-Z 0-9 ! - / space, upper-cased), so
// "pinback" and "PINBACK" are the same account. Passwords: 4 to 128 characters, anything goes; stored as scrypt hashes.
// Storage: blob "u/<hex of name>" = { name, salt, hash, createdAt }; blob "s/<sha256 of token>" = { name, createdAt }
// (only the token's hash is stored); blob "a/<hex of name>" = { <achievement id>: <ms earned> };
// blob "b/<hex of name>" = [board keys placed on]; blob "d/<hex of name>" = [days played, "YYYY-MM-DD", the last 60].
// Sessions don't expire; logging out deletes one. Achievements are trust-the-client, like scores (src/achievements.js
// lists the ids).
import { randomBytes, scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import scorekey from "../../src/scorekey.js";
import achievements from "../../src/achievements.js";
import { json, sleep, readBody, updateJSON } from "./scores.mjs";

const { cleanName, isKey } = scorekey;
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
      return { value: next, result: { streak: streakOf(next, body.day) } };
    });
    return r ? json(200, r) : json(409, { error: "busy, try again" });
  }
  if (action === "placed") {
    if (req.method !== "POST") return json(405, { error: "method not allowed" });
    const s = await session();
    if (!s) return json(401, { error: "not logged in" });
    const body = await readBody(req);
    if (!body || !isKey(body.board)) return json(400, { error: "bad board" });
    const r = await updateJSON(store, placedKey(s.name), (cur) => {
      const have = Array.isArray(cur) ? cur : [];
      return have.includes(body.board) ? { result: { count: have.length } } : { value: [...have, body.board], result: { count: have.length + 1 } };
    });
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
      return json(200, { name, token: await newSession(store, name) });
    }
    const user = name ? await store.get(userKey(name), { type: "json" }) : null;
    const pw = typeof body.password === "string" ? body.password.slice(0, PW_MAX) : "";
    const hash = await hashPw(pw, user ? user.salt : DUMMY_SALT); // hashed either way, so a missing name takes as long
    if (!user || !timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.hash, "hex"))) {
      await sleep(failDelay); // slows down guessing
      return json(403, { error: "wrong name or password" });
    }
    return json(200, { name: user.name, token: await newSession(store, user.name) });
  }

  return json(404, { error: "not found" });
}
