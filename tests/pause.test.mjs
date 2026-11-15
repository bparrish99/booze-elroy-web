// The Pause ability (ability 5; the author's rework, 2026-11-15): holding the ability button freezes every ghost, up to
// 2 seconds (letting go ends it, the rest is lost); Pac-Man moves freely. One charge per life and per board, refilled
// at READY and by an energizer, like Suck and Blow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "../tools/golden.mjs";

const DATA = JSON.parse(readFileSync(new URL("../assets/data.json", import.meta.url), "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);

function start() {
  let s = 11; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const input = { held: false };
  const core = create(DATA, { rng, isDown: () => false, abilityHeld: () => input.held, proMode: true });
  core.init(); Object.assign(core.g.config, { proMode: true, ability: core.PAUSE, ghostCount: 1 });
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  for (let f = 0; f < 600 && core.g.mode !== "normal"; f++) core.update();
  for (let f = 0; f < 10; f++) core.update(); // get going
  return { core, g: core.g, input };
}
const at = (c) => c.x + "," + c.y;
const press = (core, input) => { input.held = true; core.keypressed("space"); };

test("Pause: held, the ghosts stand still (up to 2 seconds) while Pac-Man moves", () => {
  const { core, g, input } = start();
  const b = g.chars.blinky, b0 = at(b); core.update();
  assert.notEqual(at(b), b0, "Blinky moving before the press");
  press(core, input);
  const here = at(b), p0 = at(g.chars.pac);
  for (let f = 0; f < 110; f++) { core.update(); assert.equal(at(b), here, "frozen at frame " + f); }
  assert.notEqual(at(g.chars.pac), p0, "Pac-Man still moves");
  for (let f = 0; f < 20; f++) core.update();
  assert.notEqual(at(b), here, "moving again after 2 seconds, though still held");
  assert.equal(g.pauseSpent, true);
});

test("Pause: letting go early ends it; spent until an energizer (or READY)", () => {
  const { core, g, input } = start();
  const b = g.chars.blinky;
  press(core, input);
  const here = at(b);
  for (let f = 0; f < 20; f++) core.update();
  assert.equal(at(b), here);
  input.held = false;
  core.update(); core.update();
  assert.notEqual(at(b), here, "let go: moving again");
  press(core, input);
  const there = at(b); core.update();
  assert.notEqual(at(b), there, "spent: a second press does nothing");
  input.held = false;
  const e = g.powers.shift(); e.action(e.x, e.y);
  assert.equal(g.pauseSpent, false, "an energizer brings it back");
});
