// Plus Mode: the fruit frightens the ghosts like an energizer, so it wins a tie with a ghost the same way (web
// edition, the author's call, 2026-11-13): Pac-Man reaching the fruit and a ghost on the same step eats both. Without
// Plus Mode the fruit frightens nothing, so that ghost still catches him.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "../tools/golden.mjs";

const DATA = JSON.parse(readFileSync(new URL("../assets/data.json", import.meta.url), "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);

// Pac-Man one pixel left of the fruit, heading right; Blinky parked on the fruit's spot
function tie(plusMode) {
  let s = 5; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, isDown: () => false, proMode: true });
  core.init(); Object.assign(core.g.config, { proMode: true, plusMode, ghostCount: 1 });
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  for (let f = 0; f < 600 && core.g.mode !== "normal"; f++) core.update();
  assert.equal(core.g.mode, "normal");
  const g = core.g, pac = g.chars.pac, b = g.chars.blinky, fl = core.getCurrentMaze().fruitLoc;
  g.fruitTimer = 500;
  Object.assign(pac, { x: fl.x - 1, y: fl.y, dir: 0, facing: 0, iDir: false, accum16: 15, skipCounter: 0 });
  Object.assign(b, { x: fl.x, y: fl.y, speed: 0, accum16: 0, frightened: false, dead: false, housing: false, leaving: false, entering: false });
  core.update();
  return { g, b, score: g.score };
}

test("Plus Mode: fruit and a ghost on the same step: the fruit wins, the ghost is eaten", () => {
  const { g, b } = tie(true);
  assert.notEqual(g.mode, "caught");
  assert.equal(g.fruitTimer, false, "the fruit was eaten");
  assert.ok(g.mode === "ateGhost" || T(b.dead), "and the ghost too (mode " + g.mode + ")");
});

test("without Plus Mode the fruit frightens nothing: the ghost still catches him", () => {
  const { g } = tie(false);
  assert.equal(g.mode, "caught");
});

function T(v) { return v !== false && v !== null && v !== undefined; }
