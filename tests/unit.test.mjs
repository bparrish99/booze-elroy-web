// Unit tests: board keys vs the core's options, and the leaderboard API against a local Blobs server.
//   node --test tests/   (or npm test)
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { handle } from "../netlify/lib/scores.mjs";
import { handleArenas, HOUR, GRACE } from "../netlify/lib/arenas.mjs";
import { startBlobs } from "./blobs.mjs";

const require = createRequire(import.meta.url);
const SK = require("../src/scorekey.js");
const BoozeCore = require("../src/core.js");
const DATA = require("../assets/data.json");

// Audio/Video options, plus the starting level (same game whichever level you start on)
const NOT_COUNTED = ["startingLevel", "background", "mazeColor", "crtEffect", "volume"];

test("board key covers exactly the gameplay options, with the core's values in the core's order", () => {
  const core = BoozeCore.create(DATA, { noExit: true });
  core.init();
  const menuKeys = core.optMenu.filter((it) => it.key).map((it) => it.key);
  assert.deepEqual(SK.FIELDS.map((f) => f[0]), menuKeys.filter((k) => !NOT_COUNTED.includes(k)));
  for (const [key, vals] of SK.FIELDS) {
    const item = core.optMenu.find((it) => it.key === key);
    const seen = item.options.map((o) => { o.action(); return core.g.config[key]; });
    assert.deepEqual(seen, vals, key);
  }
});

test("keyFor: defaults, cosmetic options and starting level ignored, Lua-style falsy flags, unknown values rejected", () => {
  const core = BoozeCore.create(DATA, {});
  const def = { ...core.g.defaultConfig };
  const k = SK.keyFor(def);
  assert.equal(k, "pac.0.f.f.f.3.1.f.0.4.t.f.f");
  assert.ok(SK.isKey(k));
  assert.equal(SK.keyFor({ ...def, background: "galaxy", mazeColor: 7, crtEffect: false, volume: 0 }), k);
  assert.equal(SK.keyFor({ ...def, startingLevel: 5 }), k);
  assert.equal(SK.keyFor({ ...def, afterDark: null, radar: undefined }), k);
  assert.notEqual(SK.keyFor({ ...def, ghostCount: 0 }), k);
  assert.equal(SK.keyFor({ ...def, ghostCount: 99 }), null);
  assert.ok(!SK.isKey("pac.1.0"));
  assert.ok(!SK.isKey("pac.0.f.f.f.3.1.f.0.4.t.f.x"));
});

test("configFor: inverse of keyFor, rejects bad keys", () => {
  const core = BoozeCore.create(DATA, {});
  const cfg = { ...core.g.defaultConfig, mazepack: "random", afterDark: 3, radar: false, pinkyBug: false, ghostCount: 0 };
  const back = SK.configFor(SK.keyFor(cfg));
  assert.deepEqual(Object.keys(back), SK.FIELDS.map((f) => f[0]));
  for (const k of Object.keys(back)) assert.equal(back[k], cfg[k], k);
  assert.equal(SK.configFor("nope"), null);
  assert.equal(SK.configFor(null), null);
});

test("share codes: short, reversible for every option value, reject junk", () => {
  const core = BoozeCore.create(DATA, {});
  const def = { ...core.g.defaultConfig };
  assert.equal(SK.COMBOS, 55296000);
  const seen = new Set();
  for (const [k, vals] of SK.FIELDS) for (const v of vals) {
    const cfg = { ...def, [k]: v }, code = SK.shareCode(cfg);
    assert.match(code, k === "ability" && v === 4 ? /^[0-9a-z]{7}$/ : /^[0-9a-z]{6}$/); // Rewind needs the 7-character format
    assert.equal(SK.keyFor(SK.configFromCode(code)), SK.keyFor(cfg), k + "=" + v);
    seen.add(code);
  }
  assert.ok(seen.size > 40); // different settings, different codes
  for (let i = 0; i < 2000; i++) { // random combinations round-trip
    const cfg = {}; for (const [k, vals] of SK.FIELDS) cfg[k] = vals[Math.floor(Math.random() * vals.length)];
    assert.equal(SK.keyFor(SK.configFromCode(SK.shareCode(cfg))), SK.keyFor(cfg));
  }
  const code = SK.shareCode(def);
  assert.equal(SK.configFromCode(code.toUpperCase()) !== null, true);
  const typo = code.slice(0, 2) + (code[2] === "a" ? "b" : "a") + code.slice(3);
  assert.equal(SK.configFromCode(typo), null);
  for (const bad of [null, "", "zzzzzz", "abc", "pac.0.f.f.f.3.1.f.0.4.t.f.f", "!!!!!!", "zzzzzzz", "12345678"]) assert.equal(SK.configFromCode(bad), null, String(bad));
});

test("share codes: links shared before Rewind existed still mean the same settings", () => {
  // codes made by the original 6-character format (before the Rewind ability was appended), with what they stand for
  const def = { mazepack: "pac", difficulty: 0, plusMode: false, afterDark: false, radar: false, startingLives: 3, freeGuy: 1, ability: false, movement: 0, ghostCount: 4, pinkyBug: true, scatterOption: false, freeGhost: false };
  const FIXTURES = [[{}, "1y8ir9"], [{ ability: 1 }, "0v4wzu"], [{ ability: 3, ghostCount: 7 }, "viger3"], [{ mazepack: "random", afterDark: 5, radar: 120 }, "vgalfv"],
    [{ movement: 3, freeGuy: 5, scatterOption: 3 }, "go1b5n"], [{ plusMode: true, difficulty: 2, startingLives: 1, pinkyBug: false, freeGhost: true }, "9xvlif"]];
  for (const [over, code] of FIXTURES) {
    const cfg = { ...def, ...over };
    assert.equal(SK.shareCode(cfg), code, JSON.stringify(over));
    assert.deepEqual(SK.configFromCode(code), cfg, code);
  }
  // Rewind: 7 characters, round-trips; board keys of the old values are unchanged ("pac...f..." keeps its form)
  const rw = { ...def, ability: 4 }, code = SK.shareCode(rw);
  assert.match(code, /^[0-9a-z]{7}$/);
  assert.deepEqual(SK.configFromCode(code), rw);
  assert.equal(SK.keyFor(def), "pac.0.f.f.f.3.1.f.0.4.t.f.f");
  assert.equal(SK.keyFor(rw), "pac.0.f.f.f.3.1.4.0.4.t.f.f");
});

test("cleanName", () => {
  assert.equal(SK.cleanName("x-1/y!"), "X-1/Y!");
  assert.equal(SK.cleanName("  pin   back!  "), "PIN BACK!");
  assert.equal(SK.cleanName("A".repeat(16)), "A".repeat(16));
  assert.equal(SK.cleanName("A".repeat(17)), null);
  assert.equal(SK.cleanName("   "), null);
  assert.equal(SK.cleanName("bad.name"), null);
  assert.equal(SK.cleanName("$%"), null);
  assert.equal(SK.cleanName("who?"), null); // no "?" glyph in the font
});

// ---------------------------------------------------------------- API
let blobs;
before(async () => { blobs = await startBlobs(); });
after(async () => { await blobs.stop(); });

const BOARD = "pac.0.f.f.f.3.1.f.0.4.t.f.f";
const env = { LEADERBOARD_ADMIN_PASSWORD: "correct horse" };
const call = async (method, path, body) => {
  const req = new Request("http://x" + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handle(req, blobs.store, { env, failDelay: 0 });
  return { status: res.status, data: await res.json() };
};
const submit = (name, score, board = BOARD) => call("POST", "/api/scores", { board, name, score });

test("API: empty board, ranking, ties, top 10", async () => {
  assert.deepEqual((await call("GET", "/api/scores?board=" + BOARD)).data, { board: BOARD, entries: [] });
  let r = await submit("first", 5000);
  assert.equal(r.data.rank, 1);
  r = await submit("second", 7000);
  assert.equal(r.data.rank, 1);
  r = await submit("tie", 5000); // equal scores: the earlier one keeps the higher place
  assert.equal(r.data.rank, 3);
  assert.deepEqual(r.data.entries.map((e) => e.name), ["SECOND", "FIRST", "TIE"]);
  for (let i = 0; i < 7; i++) await submit("fill " + i, 100 + i);
  r = await submit("too low", 50);
  assert.equal(r.data.rank, null);
  assert.equal(r.data.entries.length, 10);
  r = await submit("bumps", 101);
  assert.equal(r.data.rank, 10);
  assert.equal(r.data.entries.length, 10);
  assert.equal(r.data.entries.at(-1).name, "BUMPS");
  const g = await call("GET", "/api/scores?board=" + BOARD);
  assert.deepEqual(g.data.entries, r.data.entries);
});

// in-memory store with atomic conditional writes (like the real service), and a yield on every call so requests interleave
function memStore() {
  const m = new Map(); let n = 0;
  const tick = () => new Promise((r) => setTimeout(r, Math.random() * 5));
  return {
    async getWithMetadata(k) { await tick(); const v = m.get(k); return v ? { data: JSON.parse(v.body), etag: v.etag, metadata: {} } : null; },
    async setJSON(k, data, o = {}) {
      await tick();
      const v = m.get(k);
      if ((o.onlyIfNew && v) || (o.onlyIfMatch && (!v || v.etag !== o.onlyIfMatch))) return { modified: false };
      const etag = String(++n); m.set(k, { body: JSON.stringify(data), etag }); return { etag, modified: true };
    },
    async get(k) { await tick(); const v = m.get(k); return v ? JSON.parse(v.body) : null; },
  };
}

test("API: simultaneous submissions to one board are all kept", async () => {
  const B = "booze.0.f.f.f.3.1.f.0.4.t.f.f", store = memStore();
  const post = (name, score) => handle(new Request("http://x/api/scores", { method: "POST", body: JSON.stringify({ board: B, name, score }) }), store, { env })
    .then(async (r) => ({ status: r.status, data: await r.json() }));
  const rs = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => post("racer " + i, i * 1000)));
  assert.ok(rs.every((r) => r.status === 200 && r.data.rank), JSON.stringify(rs.map((r) => r.status)));
  assert.deepEqual((await store.get(B)).map((e) => e.score), [6000, 5000, 4000, 3000, 2000, 1000]);
});

test("API: rejects bad input", async () => {
  assert.equal((await call("GET", "/api/scores?board=nope")).status, 400);
  assert.equal((await submit("ok", 100, "nope")).status, 400);
  assert.equal((await submit("bad.name", 100)).status, 400);
  assert.equal((await submit("x".repeat(17), 100)).status, 400);
  assert.equal((await submit("ok", 0)).status, 400);
  assert.equal((await submit("ok", 12.5)).status, 400);
  assert.equal((await submit("ok", 10000000)).status, 400);
  assert.equal((await call("POST", "/api/scores", "not an object")).status, 400);
  assert.equal((await call("DELETE", "/api/scores")).status, 405);
});

test("API: reset needs the password; one board or all", async () => {
  const OTHER = "mspac.0.f.f.f.3.1.f.0.4.t.f.f";
  await submit("keep", 900, OTHER);
  assert.equal((await call("POST", "/api/scores/reset", { password: "wrong" })).status, 403);
  assert.equal((await call("POST", "/api/scores/reset", {})).status, 403);
  assert.equal((await call("GET", "/api/scores/reset")).status, 405);
  assert.equal((await call("GET", "/api/scores?board=" + BOARD)).data.entries.length, 10);

  let r = await call("POST", "/api/scores/reset", { password: "correct horse", board: BOARD });
  assert.deepEqual(r.data, { reset: BOARD });
  assert.equal((await call("GET", "/api/scores?board=" + BOARD)).data.entries.length, 0);
  assert.equal((await call("GET", "/api/scores?board=" + OTHER)).data.entries.length, 1);

  r = await call("POST", "/api/scores/reset", { password: "correct horse" });
  assert.deepEqual(r.data, { reset: "all" });
  assert.equal((await call("GET", "/api/scores?board=" + OTHER)).data.entries.length, 0);
});

test("API: boards lists every board with scores (count and leader); regular boards keep duplicate names", async () => {
  const OTHER_B = "mspac.0.f.f.f.3.1.f.0.4.t.f.f";
  await call("POST", "/api/scores/reset", { password: "correct horse" });
  assert.deepEqual((await call("GET", "/api/scores/boards")).data, { boards: [] });
  await submit("pinback", 500); await submit("pinback", 700); await submit("beefart", 600, OTHER_B);
  const r = await call("GET", "/api/scores/boards");
  const byKey = Object.fromEntries(r.data.boards.map((b) => [b.board, b]));
  assert.equal(r.data.boards.length, 2);
  assert.deepEqual(byKey[BOARD], { board: BOARD, count: 2, top: { name: "PINBACK", score: 700 } });
  assert.deepEqual(byKey[OTHER_B], { board: OTHER_B, count: 1, top: { name: "BEEFART", score: 600 } });
  assert.equal((await call("POST", "/api/scores/boards", {})).status, 405);
  await call("POST", "/api/scores/reset", { password: "correct horse" });
});

test("API: reset is disabled when no password is configured", async () => {
  const req = new Request("http://x/api/scores/reset", { method: "POST", body: JSON.stringify({ password: "" }) });
  const res = await handle(req, blobs.store, { env: {}, failDelay: 0 });
  assert.equal(res.status, 503);
});

// ---------------------------------------------------------------- arenas API (fake clock)
let clock = Date.UTC(2026, 10, 8, 12);
const acall = async (method, path, body) => {
  const req = new Request("http://x" + path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handleArenas(req, blobs.arenaStore, { env, failDelay: 0, now: () => clock });
  return { status: res.status, data: await res.json() };
};

test("arenas: create, list, unique open names, scores and leader, closing, grace, falling off", async () => {
  assert.deepEqual((await acall("GET", "/api/arenas")).data.arenas, []);
  let r = await acall("POST", "/api/arenas", { name: "  sunday  fun ", board: BOARD });
  assert.equal(r.status, 200);
  const a = r.data.arena;
  assert.equal(a.name, "SUNDAY FUN");
  assert.equal(a.endsAt - a.createdAt, 24 * HOUR);
  assert.equal((await acall("POST", "/api/arenas", { name: "sunday fun", board: BOARD })).status, 409, "open names are unique");
  assert.equal((await acall("POST", "/api/arenas", { name: "bad.name", board: BOARD })).status, 400);
  assert.equal((await acall("POST", "/api/arenas", { name: "ok", board: "nope" })).status, 400);
  const b = (await acall("POST", "/api/arenas", { name: "ghostly", board: "mspac.0.f.f.f.3.1.f.0.2.t.f.f" })).data.arena;
  assert.deepEqual((await acall("GET", "/api/arenas")).data.arenas.map((x) => x.name), ["SUNDAY FUN", "GHOSTLY"]);

  r = await acall("POST", "/api/arenas/score", { id: a.id, name: "pinback", score: 3000 });
  assert.equal(r.data.rank, 1);
  r = await acall("POST", "/api/arenas/score", { id: a.id, name: "beefart", score: 9000 });
  assert.equal(r.data.rank, 1);
  r = await acall("POST", "/api/arenas/score", { id: a.id, name: "dj larry", score: 5000 });
  assert.equal(r.data.rank, 2);
  assert.deepEqual(r.data.arena.leader, { name: "BEEFART", score: 9000 });
  r = await acall("GET", "/api/arenas/board?id=" + a.id);
  assert.deepEqual(r.data.entries.map((e) => e.name), ["BEEFART", "DJ LARRY", "PINBACK"]);
  assert.equal(r.data.arena.board, BOARD);
  assert.equal((await acall("POST", "/api/arenas/score", { id: "zzzzzzzzzz", name: "x", score: 1 })).status, 404);
  assert.equal((await acall("POST", "/api/arenas/score", { id: a.id, name: "x", score: 0 })).status, 400);
  // one entry per name on an arena board: a better score replaces the old one, a worse one doesn't place
  r = await acall("POST", "/api/arenas/score", { id: a.id, name: "Pinback", score: 2000 });
  assert.equal(r.data.rank, null); assert.equal(r.data.best, 3000);
  assert.deepEqual(r.data.entries.map((e) => e.name), ["BEEFART", "DJ LARRY", "PINBACK"]);
  r = await acall("POST", "/api/arenas/score", { id: a.id, name: "pinback", score: 3000 });
  assert.equal(r.data.rank, null, "a tie with your own best doesn't add a second entry");
  r = await acall("POST", "/api/arenas/score", { id: a.id, name: "pinback", score: 6000 });
  assert.equal(r.data.rank, 2);
  assert.deepEqual(r.data.entries.map((e) => e.name + " " + e.score), ["BEEFART 9000", "PINBACK 6000", "DJ LARRY 5000"]);
  r = await acall("POST", "/api/arenas/score", { id: a.id, name: "pinback", score: 9500 });
  assert.equal(r.data.rank, 1);
  assert.deepEqual(r.data.arena.leader, { name: "PINBACK", score: 9500 });
  assert.deepEqual(r.data.entries.map((e) => e.name), ["PINBACK", "BEEFART", "DJ LARRY"]);

  clock += 24 * HOUR + GRACE / 2; // closed, but a game that was running may still post
  assert.equal((await acall("POST", "/api/arenas/score", { id: a.id, name: "late", score: 100 })).status, 200);
  clock += GRACE;
  assert.equal((await acall("POST", "/api/arenas/score", { id: a.id, name: "too late", score: 100 })).status, 410);
  r = await acall("GET", "/api/arenas");
  assert.equal(r.data.arenas.length, 2, "finished arenas stay listed");
  assert.ok(r.data.arenas.every((x) => x.endsAt < r.data.now));
  assert.equal((await acall("POST", "/api/arenas", { name: "sunday fun", board: BOARD })).status, 200, "a finished arena's name is free again");

  clock += 24 * HOUR; // the first two fall off; creating one tidies their scores away
  r = await acall("GET", "/api/arenas");
  assert.deepEqual(r.data.arenas.map((x) => x.name), ["SUNDAY FUN"]);
  assert.equal((await acall("GET", "/api/arenas/board?id=" + a.id)).status, 404);
  await acall("POST", "/api/arenas", { name: "tidy", board: BOARD });
  assert.equal(await blobs.arenaStore.get("e/" + a.id), null);

  // delete needs the admin password
  assert.equal((await acall("POST", "/api/arenas/delete", { id: b.id, password: "nope" })).status, 403);
  const c = r.data.arenas[0];
  assert.equal((await acall("POST", "/api/arenas/delete", { id: c.id, password: "correct horse" })).status, 200);
  assert.ok(!(await acall("GET", "/api/arenas")).data.arenas.some((x) => x.id === c.id));
});
