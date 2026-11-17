// The Pause ability (ability 5; the author's rework, 2026-11-15): a press freezes every ghost for a fixed 2 seconds
// (not held: easier on phones); Pac-Man moves freely. One charge per life and per board, refilled at READY and by an
// energizer, like Suck and Blow. Eating four ghosts during one freeze earns "the power of now".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "../tools/golden.mjs";

const DATA = JSON.parse(readFileSync(new URL("../assets/data.json", import.meta.url), "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);

function start(ghostCount = 1, feats = []) {
  let s = 11; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, isDown: () => false, proMode: true, feat: (id) => feats.push(id) });
  core.init(); Object.assign(core.g.config, { proMode: true, ability: core.PAUSE, ghostCount });
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  for (let f = 0; f < 600 && core.g.mode !== "normal"; f++) core.update();
  for (let f = 0; f < 10; f++) core.update(); // get going
  return { core, g: core.g };
}
const at = (c) => c.x + "," + c.y;

test("Pause: one press freezes the ghosts for 2 seconds while Pac-Man moves", () => {
  const { core, g } = start();
  const b = g.chars.blinky, b0 = at(b); core.update();
  assert.notEqual(at(b), b0, "Blinky moving before the press");
  core.keypressed("space"); // a press, not held
  const here = at(b), p0 = at(g.chars.pac);
  for (let f = 0; f < 115; f++) { core.update(); assert.equal(at(b), here, "frozen at frame " + f); }
  assert.notEqual(at(g.chars.pac), p0, "Pac-Man still moves");
  for (let f = 0; f < 15; f++) core.update();
  assert.notEqual(at(b), here, "moving again after 2 seconds");
});

test("Pause: spent until an energizer (or READY)", () => {
  const { core, g } = start();
  core.keypressed("space");
  for (let f = 0; f < 130; f++) core.update();
  const b = g.chars.blinky, there = at(b);
  core.keypressed("space"); core.update();
  assert.notEqual(at(b), there, "spent: a second press does nothing");
  const e = g.powers.shift(); e.action(e.x, e.y);
  assert.equal(g.pauseSpent, false, "an energizer brings it back");
});

test("Pause: four ghosts eaten during one freeze earns the power of now", () => {
  const feats = [];
  const { core, g } = start(4, feats);
  const pac = g.chars.pac;
  g.frightened = 600;
  for (const n of ["blinky", "pinky", "inky", "clyde"]) Object.assign(g.chars[n], { x: pac.x, y: pac.y, housing: false, leaving: false, entering: false, dead: false, frightened: 600, hidden: false });
  core.keypressed("space");
  for (let f = 0; f < 600 && !feats.includes("now"); f++) core.update();
  assert.ok(feats.includes("now"), "earned");
});

test("Pause: eaten ghosts' eyes stay frozen while another ghost is eaten (the author, 2026-11-17)", () => {
  const { core, g } = start(4);
  const pac = g.chars.pac, b = g.chars.blinky, p = g.chars.pinky;
  g.frightened = 600;
  for (const c of [b, p]) Object.assign(c, { x: pac.x, y: pac.y, housing: false, leaving: false, entering: false, dead: false, frightened: 600, hidden: false });
  core.keypressed("space");
  let f = 0;
  for (; f < 300 && !b.dead && !p.dead; f++) core.update();
  const first = b.dead ? b : p, second = first === b ? p : b;
  assert.ok(first.dead, "one eaten");
  const here = at(first);
  let sawSecondEaten = false;
  for (; f < 600 && g.freezeLeft > 0; f++) {
    core.update();
    if (second.dead && g.mode === "ateGhost") sawSecondEaten = true;
    if (g.freezeLeft > 0) assert.equal(at(first), here, "the first one's eyes still frozen at frame " + f + " (" + g.mode + ")");
  }
  assert.ok(sawSecondEaten, "the second was eaten during the freeze");
});
