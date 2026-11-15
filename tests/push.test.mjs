// The Push ability (ability 7; web edition, 2026-11-14), the Vacuum's opposite: once per life / board, ghosts within 4
// tiles (blue ones too) are flung straight away from Pac-Man, over walls, onto an open corridor tile at most 8 tiles
// from him, facing away; play stops while they fly. No daze.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "../tools/golden.mjs";

const DATA = JSON.parse(readFileSync(new URL("../assets/data.json", import.meta.url), "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);

function start() {
  let s = 13; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, isDown: () => false, proMode: true });
  core.init(); Object.assign(core.g.config, { proMode: true, ability: core.PUSH, ghostCount: 4 });
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  for (let f = 0; f < 600 && core.g.mode !== "normal"; f++) core.update();
  core.update(); core.update();
  const g = core.g, cm = core.getCurrentMaze();
  for (const n of ["blinky", "pinky", "inky", "clyde"]) Object.assign(g.chars[n], { x: 8 * 1 + 4, y: 8 * 1 + 4, housing: false, leaving: false, entering: false, dead: false, frightened: false, hidden: false, speed: 0, accum16: 0 });
  const [pX, , pY] = cm.getLoc(g.chars.pac);
  return { core, g, cm, pX, pY };
}
const settle = (core) => { for (let f = 0; f < 100 && core.g.mode === "push"; f++) core.update(); };
const tileOf = (cm, ch) => { const [x, , y] = cm.getLoc(ch); return [x, y]; };

test("Push: a ghost within 4 tiles is flung away, onto open corridor, at most 8 tiles off; play stops meanwhile", () => {
  const { core, g, cm, pX, pY } = start();
  Object.assign(g.chars.blinky, { x: (pX + 3) * 8 + 4, y: pY * 8 + 4 });
  core.keypressed("space");
  assert.equal(g.mode, "push");
  settle(core);
  assert.equal(g.mode, "normal");
  const [x, y] = tileOf(cm, g.chars.blinky), d = Math.hypot(x - pX, y - pY);
  assert.ok(d > 3 && d <= 8, "further, but at most 8 tiles (" + d.toFixed(2) + ")");
  assert.ok(!cm.isWall(x, y) && !cm.isTunnel(x, y), "on open corridor");
  assert.ok(x > pX, "away from him (it was to his right)");
  assert.equal(g.pushSpent, true);
});

test("Push: blue ghosts are pushed too; one beyond 4 tiles isn't", () => {
  const { core, g, cm, pX, pY } = start();
  Object.assign(g.chars.pinky, { x: (pX - 2) * 8 + 4, y: pY * 8 + 4, frightened: 300 });
  const far = { x: (pX + 6) * 8 + 4, y: pY * 8 + 4 };
  Object.assign(g.chars.clyde, far);
  core.keypressed("space");
  settle(core);
  const [x] = tileOf(cm, g.chars.pinky);
  assert.ok(x < pX - 2, "the blue one went further left");
  assert.ok(g.chars.pinky.frightened, "still blue");
  assert.equal(g.chars.clyde.x, far.x, "the far one didn't move");
});

test("Push: one charge, back at READY", () => {
  const { core, g } = start();
  core.keypressed("space"); settle(core);
  assert.equal(g.pushSpent, true);
  core.keypressed("space");
  assert.equal(g.mode, "normal", "spent: nothing");
  core.mode.setMode("caught");
  for (let f = 0; f < 600 && g.mode !== "normal"; f++) core.update();
  assert.equal(g.pushSpent, false);
});

test("Push: a ghost thrown back against its old plan keeps the new heading (its stale turn doesn't flip it back)", () => {
  // the author's repro: Pinky just turned down (his plan for the next tile: down too), blown up into the corridor
  // above. Reversals are taken at once without a wall check, so the stale "down" used to flip him straight back down,
  // and where there was a wall below him he stood stuck until an energizer
  const { core, g, cm } = start();
  const pk = g.chars.pinky;
  Object.assign(pk, { x: 9 * 8 + 4, y: 11 * 8 + 4, dir: 1, facing: 1, iDir: 1, speed: 0.75 }); // (moving: start() parks them)
  Object.assign(g.chars.pac, { x: 9 * 8 + 4, y: 14 * 8 + 4, speed: 0 });
  core.keypressed("space");
  settle(core);
  const [, y0] = tileOf(cm, pk);
  assert.ok(y0 < 11, "thrown up");
  assert.equal(pk.dir, 3, "heading up");
  for (let f = 0; f < 30; f++) core.update();
  assert.ok(tileOf(cm, pk)[1] <= y0, "and still going up, not back down");
});
