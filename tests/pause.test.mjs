// The Pause ability (ability 5; web edition, 2026-11-13): holding the ability button stops Pac-Man in his tracks, up
// to 2 seconds; letting go (or the 2 seconds running out) starts a 2-second reload, during which it can't be used.
// Everything else keeps moving.
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
  core.init(); core.g.config.proMode = true; core.g.config.ability = core.PAUSE; core.g.config.ghostCount = 0;
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  for (let f = 0; f < 600 && core.g.mode !== "normal"; f++) core.update();
  assert.equal(core.g.mode, "normal");
  for (let f = 0; f < 10; f++) core.update(); // get going
  return { core, g: core.g, input };
}
const pos = (g) => g.chars.pac.x + "," + g.chars.pac.y;
const press = (core, input) => { input.held = true; core.keypressed("space"); };

test("Pause: held, Pac-Man stands still for at most 2 seconds, then reloads for 2", () => {
  const { core, g, input } = start();
  const p0 = pos(g);
  core.update();
  assert.notEqual(pos(g), p0, "moving before the press");
  press(core, input);
  const here = pos(g);
  for (let f = 0; f < 119; f++) { core.update(); assert.equal(pos(g), here, "still at frame " + f); }
  core.update(); core.update();
  assert.notEqual(pos(g), here, "moves again after 2 seconds, though still held");
  assert.ok(g.chars.pac.phased < 0, "reloading");
  input.held = false;
  // during the reload a press does nothing
  press(core, input);
  const p1 = pos(g); core.update();
  assert.notEqual(pos(g), p1);
  input.held = false;
  for (let f = 0; f < 130 && g.chars.pac.phased !== false; f++) core.update();
  assert.equal(g.chars.pac.phased, false, "ready again");
});

test("Pause: letting go early ends it and starts the reload", () => {
  const { core, g, input } = start();
  press(core, input);
  const here = pos(g);
  for (let f = 0; f < 30; f++) core.update();
  assert.equal(pos(g), here);
  input.held = false;
  core.update(); core.update();
  assert.notEqual(pos(g), here);
  assert.ok(g.chars.pac.phased < 0 && g.chars.pac.phased > -5, String(g.chars.pac.phased));
});
