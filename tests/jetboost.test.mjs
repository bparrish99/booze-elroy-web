// Boost in Jetpack (the author, 2026-11-15): Jetpack has no top speed for Boost to raise, so there Boost is Jetpack's own
// thrust, stronger (core.js BOOST_THRUST), for its second, whichever way he faces: same physics, just more forceful.
// Boost in the other movement modes is unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "../tools/golden.mjs";

const DATA = JSON.parse(readFileSync(new URL("../assets/data.json", import.meta.url), "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);

function start(movement) {
  let s = 11; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, isDown: () => false, proMode: true });
  core.init(); Object.assign(core.g.config, { proMode: true, ability: 2, movement, ghostCount: 0 });
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  for (let f = 0; f < 600 && core.g.mode !== "normal"; f++) core.update();
  for (let f = 0; f < 10; f++) core.update(); // get going
  return { core, g: core.g };
}

test("Jetpack Boost: no jump; Jetpack thrust, stronger, for its second, stick held or not", () => {
  const { core, g } = start(3);
  const pac = g.chars.pac; pac.iDir = pac.dir; pac.speed = 0.2;
  core.keypressed("space");
  assert.equal(pac.speed, 0.2, "nothing at once");
  for (let f = 0; f < 20; f++) core.update();
  const gain = pac.speed - 0.2;
  assert.ok(gain > 20 * 0.008 * 2, "gained " + gain); // more than plain thrust would
  for (let f = 0; f < 120; f++) core.update(); // Boost over: no input, so Jetpack's drag slows him
  const v = pac.speed; core.update();
  assert.ok(pac.speed <= v, "coasting after the second");
});

test("Jetpack Boost: facing back it brakes, then turns him round", () => {
  const { core, g } = start(3);
  const pac = g.chars.pac; pac.speed = 0.3; const d = pac.dir; pac.iDir = (d + 2) % 4; pac.facing = pac.iDir;
  core.keypressed("space");
  for (let f = 0; f < 40 && pac.dir === d; f++) core.update();
  assert.equal(pac.dir, (d + 2) % 4, "turned round");
});

test("Jetpack Boost at the start of a life thrusts the way he faces (left)", () => {
  let s = 11; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, isDown: () => false, proMode: true });
  core.init(); Object.assign(core.g.config, { proMode: true, ability: 2, movement: 3, ghostCount: 0 });
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  for (let f = 0; f < 600 && core.g.mode !== "normal"; f++) core.update();
  core.update();
  const pac = core.g.chars.pac, x0 = pac.x;
  assert.equal(pac.speed, 0, "standing still, no steering yet");
  core.keypressed("space");
  for (let f = 0; f < 30; f++) core.update();
  assert.ok(pac.x < x0, `moved left: ${x0} -> ${pac.x}`);
});

test("Boost outside Jetpack is unchanged (1.6 for its second)", () => {
  const { core, g } = start(0);
  core.keypressed("space");
  assert.equal(g.chars.pac.speed, 1.6);
});
