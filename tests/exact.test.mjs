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

// NEAT with Boost (the author, 2026-11-22): a boosted Pac-Man (off his speed pattern) used to check walls by this game's
// tiles while turning by the arcade's, so a corner cut while boosting stuck him there till the Boost ran out; and his dot
// pause counted down once a frame instead of every tick, so each dot cost him two frames
function boostGame(exact) {
  const keys = { held: "left" };
  const core = create(DATA, { rng: Math.random, isDown: (k) => k === keys.held, noAutoplay: true, exact: () => exact });
  core.init(); Object.assign(core.g.config, { ability: 2, ghostCount: 0 });
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  for (let f = 0; core.g.mode !== "normal" && f < 2000; f++) core.update();
  return { core, keys };
}
test("NEAT: a corner cut while boosting goes round the corner", () => {
  for (const k of [4, 5, 6, 7]) {
    const { core, keys } = boostGame(true);
    const g = core.g, p = g.chars.pac, open = (x, y) => !core.getCurrentMaze().isWall(x, y);
    for (let f = 0; f < 600; f++) {
      core.update();
      const tx = Math.floor(p.x / 8), ty = Math.floor(p.y / 8);
      if (tx > 2 && open(tx - 1, ty - 1) && p.x - ((tx - 1) * 8 + 4) === k) break;
    }
    core.keypressed("space"); keys.held = "up";
    const y0 = p.y;
    for (let f = 0; f < 20; f++) core.update();
    assert.ok(y0 - p.y >= 16, "boosted " + k + " px before the corner: went up " + (y0 - p.y) + " px in 20 frames");
  }
});
test("NEAT: Boost is as fast as in the regular game (the dot pause counted every tick)", () => {
  const run = (exact) => {
    const { core } = boostGame(exact), p = core.g.chars.pac;
    for (let i = 0; i < 3; i++) core.update();
    const x0 = p.x; core.keypressed("space");
    for (let i = 0; i < 30; i++) core.update();
    return x0 - p.x;
  };
  assert.equal(run(true), run(false));
});

// NEAT's blue ghosts (the author, 2026-11-22): the arcade's first way to try is the low two bits of a byte of
// its own program, so Plus (other code) has its own odds: right 1817, down 2398, left 2557, up 1420 of 8192 (Pac-Man's ROM:
// 2064 / 2338 / 2452 / 1338, which the game's 0.252 / 0.537 / 0.836 round; NEAT uses the exact counts); a replay from before keeps the game's
function blueTurn(r, plus, exact, old) {
  const core = create(DATA, { rng: () => r, isDown: () => false, noAutoplay: true, exact: () => exact, oldNeatFright: () => !!old });
  core.init(); Object.assign(core.g.config, plus ? { plusMode: true, difficulty: 2 } : {});
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  for (let f = 0; core.g.mode !== "normal" && f < 2000; f++) core.update();
  const cm = core.getCurrentMaze(), b = core.g.chars.blinky, open = (x, y) => !cm.isWall(x, y);
  for (let y = 1; y < 30; y++) for (let x = 1; x < 27; x++) {
    if (open(x, y) && open(x + 1, y) && open(x, y + 1) && open(x - 1, y)) { // came in going right: right and down both open
      b.x = x * 8 + 4; b.y = y * 8 + 4; b.dir = 0; b.iDir = 0; b.frightened = true; b.exactNext = null;
      b.target.call(b); return b.iDir;
    }
  }
}
test("NEAT: blue ghosts turn at the ROMs' exact odds (Pac-Man Plus's its own)", () => {
  const r = 0.235; // under Pac-Man's 0.252 (right), over Plus's 0.2218 (down)
  assert.equal(blueTurn(r, false, true), 0);
  assert.equal(blueTurn(r, true, false), 0); // (NEAT off: the regular game, untouched)
  assert.equal(blueTurn(r, true, true), 1);
  assert.equal(blueTurn(r, true, true, true), 0); // (an older replay)
  const s = 0.25197; // between Pac-Man's exact 2064 / 8192 (0.251953) and the game's rounded 0.252
  assert.equal(blueTurn(s, false, false), 0); // (the regular game: right)
  assert.equal(blueTurn(s, false, true), 1); // (NEAT: down)
  assert.equal(blueTurn(s, false, true, true), 0); // (an older replay)
});
