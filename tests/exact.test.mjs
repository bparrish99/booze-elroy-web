// EXACT (the side project, 2026-11-20): an arcade-exact mode behind env.exact(), its numbers read from the ROMs (the
// harness in tools/arcade checks the play itself against the user's own ROMs; that can't run here). Off, the author's
// game is untouched (tests/golden.test.mjs proves it frame for frame); these check the level data the switch brings in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "../tools/golden.mjs";

const DATA = JSON.parse(readFileSync(new URL("../assets/data.json", import.meta.url), "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);
function level(n, difficulty, exact, old) {
  const core = create(DATA, { rng: Math.random, isDown: () => false, exact: () => exact, oldLevelOneSwitch: () => !!old });
  core.init(); core.g.config.difficulty = difficulty;
  return core.levels.getLevel(n);
}

test("level 1's last scatter / chase switch is the ROM's 5040 (fixed in the game too, 2026-11-22; an older replay keeps 4200)", () => {
  assert.equal(level(1, 0, true).switch[6], 5040);
  assert.equal(level(1, 0, false).switch[6], 5040);
  assert.equal(level(1, 0, false, true).switch[6], 4200);
  assert.equal(level(1, 0, false).switch[6], 5040); // (and back)
  assert.deepEqual(level(3, 0, true).switch, [420, 1620, 2040, 3240, 3540, 65534, 65535]);
  assert.deepEqual(level(7, 0, true).switch, [300, 1500, 1800, 3000, 3300, 65534, 65535]);
});
test("exact: the Plus difficulty plays Pac-Man Plus's own levels (and fruit scare times)", () => {
  const l1 = level(1, 2, true);
  assert.equal(l1.pacSpeed, 1); assert.equal(l1.frightenedSpeed, 0.6); assert.equal(l1.elroy1, 30); assert.equal(l1.clydeCounter, 50);
  assert.equal(l1.frightened, 240); assert.equal(l1.fruitFrightenedDuration, 360); assert.equal(l1.starvation, 240);
  const l18 = level(18, 2, true);
  assert.equal(l18.pacSpeed, 0.9); assert.equal(l18.frightened, 120); assert.equal(l18.elroy1, 120);
  assert.equal(level(25, 2, true).fruitFrightenedDuration, 0);
  // off: the author's own Plus table, as it was
  const own = level(1, 2, false);
  assert.equal(own.elroy1, DATA.levels.plus["1"].elroy1); assert.equal(own.frightened, DATA.levels.plus["1"].frightened);
});
test("exact: the switch never changes the shared tables (a copy)", () => {
  level(1, 2, true); level(1, 0, true);
  assert.equal(DATA.levels.normal["1"].switch[6], 5040);
  assert.equal(level(1, 2, false).elroy1, DATA.levels.plus["1"].elroy1);
});
