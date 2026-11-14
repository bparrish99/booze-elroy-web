// Scatter: MSPAC (scatterOption 2). Ms. Pac-Man's ghosts, as the author watched them on a real machine (2026-11-14):
// the first switch ends the opening scatter (to chase, reversing), the second only reverses them (still chasing), and
// after that the timer never reverses them again. Normal scatter still reverses at every switch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "../tools/golden.mjs";

const DATA = JSON.parse(readFileSync(new URL("../assets/data.json", import.meta.url), "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);

// for each of the level's first switches: [did Blinky reverse on it, chasing after it]
function switches(scatterOption) {
  let s = 3; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, isDown: () => false, proMode: true });
  core.init(); Object.assign(core.g.config, { proMode: true, scatterOption, ghostCount: 1 });
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  for (let f = 0; f < 600 && core.g.mode !== "normal"; f++) core.update();
  assert.equal(core.g.mode, "normal");
  const g = core.g, b = g.chars.blinky, out = [];
  for (let si = 0; si < 5; si++) {
    g.level.timer = g.level.switch[si] - 1; // the frame before the switch
    const before = b.dir;
    core.update();
    out.push([b.dir === (before + 2) % 4, g.level.chase]);
  }
  return out;
}

test("MSPAC: reverses on the first two switches only, chasing from the first on", () => {
  assert.deepEqual(switches(2), [[true, true], [true, true], [false, true], [false, true], [false, true]]);
});

test("Normal scatter: reverses on every switch, alternating scatter and chase", () => {
  assert.deepEqual(switches(false), [[true, true], [true, false], [true, true], [true, false], [true, true]]);
});
