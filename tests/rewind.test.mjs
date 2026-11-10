// The Rewind ability: a rewind must bring back the whole game state of the frame it lands on, not just the parts the
// snapshot remembers to save. Bot games with Rewind fire it at random moments; after each one every gameplay field on g
// is compared with an independent deep copy taken at that frame.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { loadCore, botKeyForStats } from "../tools/golden.mjs";

const require = createRequire(import.meta.url);
const RW = require("../src/rewind.js");
const DATA = JSON.parse(readFileSync(new URL("../assets/data.json", import.meta.url), "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);

// everything on g that is gameplay (settings, sound objects, scene/mode bookkeeping and constant tables left out)
const NOT_STATE = new Set([...RW.SKIP, "config", "defaultConfig", "sounds", "music", "fever", "mazes", "backgroundOptions",
  "scene", "booze", "levelMusic", "scenery", "fadeLength", "charOrder", "volumeBeforeMute"]);
const deep = (v) => (Array.isArray(v) ? v.map(deep) : v && typeof v === "object"
  ? Object.fromEntries(Object.keys(v).sort().filter((k) => typeof v[k] !== "function").map((k) => [k, deep(v[k])])) : v);
const full = (g) => Object.fromEntries(Object.keys(g).sort().filter((k) => !NOT_STATE.has(k) && typeof g[k] !== "function").map((k) => [k, deep(g[k])]));
function firstDiff(a, b, path = "g") {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === "object" && typeof b === "object") {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = firstDiff(a[k], b[k], path + "." + k); if (d) return d; }
  }
  return path + ": " + JSON.stringify(a) + " vs " + JSON.stringify(b);
}

function play(overrides, seed, frames) {
  let s = seed; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  let t = seed * 7 + 1; const r2 = () => { t = (t * 48271) % 2147483647; return t / 2147483647; };
  let held = null, rw = null;
  const core = create(DATA, { rng, isDown: (k) => k === held, rewind: () => rw.trigger() });
  core.init(); Object.assign(core.g.config, { ability: 4 }, overrides);
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  rw = RW.create(core);
  const g = core.g, ring = [];
  let checked = 0, lastMode = null;
  for (let f = 0; f < frames; f++) {
    held = botKeyForStats(core) || held;
    if (g.scene.name !== "game") { g.autoplay = false; g.attract = false; core.setScene("game"); }
    // press the ability now and then (the charge refilled by hand, so it can be checked over and over)
    if (!rw.active() && g.mode === "normal" && r2() < 0.02) {
      g.rewindSpent = false;
      const h = rw.historyLength(), want = ring[ring.length - h];
      assert.equal(ring.length, h, "test bookkeeping: history lengths agree");
      core.keypressed("space");
      if (rw.active()) {
        let n = 0;
        while (rw.update()) n++;
        assert.ok(n >= 1 && n <= Math.ceil(RW.HISTORY / RW.SPEED) + 1, "playback length " + n);
        const d = firstDiff(full(g), want);
        assert.equal(d, null, "rewind didn't restore " + d);
        assert.equal(g.rewindSpent, true);
        checked++;
        ring.length = 0; rw.record(); ring.push(full(g)); // the frame it landed on starts the history again
        core.update(); rw.record(); // and play goes on from there
        assert.ok(g.mode !== "normal" || g.state.running === true, "play stopped after a rewind");
        if (g.mode === "normal") { ring.push(full(g)); if (ring.length > RW.HISTORY + 1) ring.shift(); } else if (g.mode !== "ateGhost") ring.length = 0;
        continue;
      }
    }
    core.update();
    rw.record();
    if (g.mode !== lastMode) lastMode = g.mode;
    if (g.scene.name === "game" && g.mode === "normal") { ring.push(full(g)); if (ring.length > RW.HISTORY + 1) ring.shift(); }
    else if (g.mode !== "ateGhost") ring.length = 0;
  }
  return checked;
}

for (const [name, cfg, seed] of [["default", {}, 11], ["seven ghosts", { ghostCount: 7 }, 23], ["plus, mspac", { plusMode: true, mazepack: "mspac" }, 37],
  ["large", { mazepack: "large" }, 41], ["jetpack, blindfold", { movement: 3, afterDark: 4, radar: 60 }, 53], ["random scatter", { scatterOption: 1 }, 67]]) {
  test("rewind restores the whole game state: " + name, () => {
    const n = play(cfg, seed, 9000);
    assert.ok(n >= 10, "only " + n + " rewinds happened");
  });
}

test("rewind: once per life, refilled by a new life or board; nothing to rewind right after READY", () => {
  let held = null, rw = null;
  const core = create(DATA, { rng: () => 0.5, isDown: (k) => k === held, rewind: () => rw.trigger() });
  core.init(); core.g.config.ability = 4; core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  rw = RW.create(core);
  const g = core.g, step = () => { core.update(); rw.record(); };
  while (g.mode !== "normal") step();
  core.keypressed("space");
  assert.equal(rw.active(), false, "no history yet: nothing happens");
  assert.equal(g.rewindSpent, false, "and the charge isn't used");
  held = "left"; for (let i = 0; i < 120; i++) step();
  const score = g.score;
  core.keypressed("space");
  assert.equal(rw.active(), true);
  while (rw.update()); // plays back
  assert.equal(g.rewindSpent, true);
  assert.ok(g.score <= score, "the score rewinds too");
  for (let i = 0; i < 60; i++) step();
  core.keypressed("space");
  assert.equal(rw.active(), false, "spent: no second rewind this life");
  g.mode = "ready"; core.mode.setMode("ready"); step(); // a new life (or board) starts with READY
  assert.equal(g.rewindSpent, false, "READY refills it");
});

test("rewind: the autoplayer uses it when a ghost gets too close (once per life)", () => {
  let s = 99, rw = null, rewinds = 0;
  const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, rewind: () => { const was = rw.active(); rw.trigger(); if (!was && rw.active()) rewinds++; } });
  core.init(); core.g.config.ability = 4; core.g.autoplay = true; core.g.attract = false; core.setScene("game");
  rw = RW.create(core);
  for (let f = 0; f < 20000 && rewinds < 2; f++) {
    if (core.g.scene.name !== "game") core.setScene("game");
    if (!rw.update()) core.update();
    rw.record();
  }
  assert.ok(rewinds >= 2, "the autoplayer rewound " + rewinds + " times");
});

test("rewind: other abilities never call it", () => {
  const core = create(DATA, { rng: () => 0.3, rewind: () => { throw new Error("rewind called"); } });
  core.init(); core.g.config.ability = 1; core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  for (let i = 0; i < 400; i++) { core.update(); if (core.g.mode === "normal") core.keypressed("space"); }
});
