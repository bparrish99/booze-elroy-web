// The player's controls only work in play (the author, 2026-11-14): the ability button does nothing while the game is
// paused, and in autoplay / the attract demo the player's keys neither steer Pac-Man nor fire his ability.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "../tools/golden.mjs";

const DATA = JSON.parse(readFileSync(new URL("../assets/data.json", import.meta.url), "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);

function start({ ability, autoplay = false, held = {} }) {
  let s = 31; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, isDown: (k) => !!held[k], proMode: true });
  core.init(); Object.assign(core.g.config, { proMode: true, ability, ghostCount: 0 });
  core.g.autoplay = autoplay; core.g.attract = false; core.setScene("game");
  for (let f = 0; f < 600 && core.g.mode !== "normal"; f++) core.update();
  core.update(); core.update();
  return { core, g: core.g };
}

test("paused: the ability button does nothing", () => {
  for (const [ab, check] of [[1, (g) => g.chars.pac.phased === false], [6, (g) => !g.vacuumSpent], [7, (g) => !g.pushSpent]]) {
    const { core, g } = start({ ability: ab });
    core.keypressed("p");
    assert.equal(g.paused, true);
    core.keypressed("space");
    assert.ok(check(g), "ability " + ab + " stayed unused");
    assert.equal(g.mode, "normal");
  }
});

test("autoplay: the player's keys don't steer Pac-Man or fire his ability", () => {
  const held = {};
  const a = start({ ability: 7, autoplay: true, held });
  const b = start({ ability: 7, autoplay: true, held: { left: true, up: true } });
  a.core.keypressed("space"); b.core.keypressed("space");
  assert.equal(b.g.pushSpent, false, "the ability key is ignored");
  for (let f = 0; f < 300; f++) { a.core.update(); b.core.update(); }
  assert.deepEqual([b.g.chars.pac.x, b.g.chars.pac.y], [a.g.chars.pac.x, a.g.chars.pac.y], "held keys change nothing: he goes where the autoplayer takes him");
});
