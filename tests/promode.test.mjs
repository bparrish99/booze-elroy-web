// Pro Mode (Options > Style; always on in test mode): no opening jingle, a short READY, no death animation, no
// board-complete flashing, no intermissions. Off, the game
// runs as before (the golden replay covers that in full); the attract demo is never affected.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "../tools/golden.mjs";

const DATA = JSON.parse(readFileSync(new URL("../assets/data.json", import.meta.url), "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);

// plays a game: a death a few seconds in, then (on a fresh life) board 2 done; returns [mode, frames] runs
function run(proMode, attract = false) {
  let s = 7; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, isDown: () => false, proMode: true });
  core.init(); core.g.config.proMode = proMode;
  core.g.autoplay = false; core.g.attract = attract; core.setScene("game");
  const g = core.g, runs = [];
  let normals = 0;
  for (let f = 0; f < 6000 && runs.length < 40; f++) {
    core.update();
    if (!runs.length || runs[runs.length - 1][0] !== g.mode) {
      runs.push([g.mode, 0]);
      if (g.mode === "normal") normals++;
    }
    runs[runs.length - 1][1]++;
    const n = runs[runs.length - 1][1];
    if (g.mode === "normal" && n === 60 && normals === 1) core.mode.setMode("caught");
    if (g.mode === "normal" && n === 60 && normals === 2) { g.levelNumber = 2; core.mode.setMode("levelComplete"); }
    if (g.mode === "pause" && normals === 2 && n === 1) break;
  }
  return runs;
}
const modes = (runs) => runs.map((r) => r[0]);
const len = (runs, m) => runs.filter((r) => r[0] === m).map((r) => r[1]);

test("Pro Mode off: jingle, the full READY, death animation, intermission", () => {
  const r = run(false), m = modes(r);
  assert.ok(m.includes("playerUp"), m.join(" "));
  assert.ok(m.includes("dying"));
  assert.ok(m.includes("intermission1"));
  assert.ok(m.includes("levelAnimation"));
  assert.ok(len(r, "ready").every((n) => n >= 119), String(len(r, "ready")));
});

test("Pro Mode on: none of that, and READY is short", () => {
  const r = run(true), m = modes(r);
  assert.ok(!m.includes("playerUp"), m.join(" "));
  assert.ok(!m.includes("dying"));
  assert.ok(m.some((x) => x === "caught"), "still caught (the moment it happens)");
  assert.ok(!m.some((x) => x.startsWith("intermission")));
  assert.ok(!m.includes("levelAnimation"), "no board-complete flashing");
  assert.ok(len(r, "levelComplete").every((n) => n <= 46), String(len(r, "levelComplete")));
  assert.ok(m.includes("pause"));
  const rd = len(r, "ready");
  assert.ok(rd.length >= 2 && rd.every((n) => n <= 46), String(rd));
  // and the death still costs a life
  assert.equal(r.filter((x) => x[0] === "ready").length >= 2, true);
});

test("test mode (xyzzy) is Pro Mode", () => {
  let s = 7; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, isDown: () => false, proMode: true, testMode: () => true });
  core.init(); core.g.config.proMode = false; core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  const seen = new Set();
  for (let f = 0; f < 200; f++) { core.update(); seen.add(core.g.mode); }
  assert.ok(!seen.has("playerUp") && seen.has("normal"), [...seen].join(" "));
});

test("Pro Mode never touches the attract demo", () => {
  const m = modes(run(true, true));
  assert.ok(m.includes("dying"), m.join(" "));
});
