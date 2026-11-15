// The one-charge abilities (Rewind, Suck, Blow) refill at every READY (a new life, a new board) and, since 2026-11-14
// (the author), when Pac-Man eats an energizer; energizers the Suck swallows recharge it too, so they chain. Phase /
// Boost / Stun / Pause keep their own reload timers, and an energizer doesn't touch them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "../tools/golden.mjs";

const DATA = JSON.parse(readFileSync(new URL("../assets/data.json", import.meta.url), "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);

function start(ability) {
  let s = 21; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, isDown: () => false, proMode: true });
  core.init(); Object.assign(core.g.config, { proMode: true, ability, ghostCount: 0 });
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  for (let f = 0; f < 600 && core.g.mode !== "normal"; f++) core.update();
  core.update(); core.update();
  return { core, g: core.g };
}
const eatEnergizer = (g) => { const e = g.powers.shift(); e.action(e.x, e.y); };

test("Rewind, Pause, Suck and Blow: a spent charge comes back with an energizer", () => {
  for (const [ab, flag] of [[4, "rewindSpent"], [5, "pauseSpent"], [6, "vacuumSpent"], [7, "pushSpent"]]) {
    const { g } = start(ab);
    g[flag] = true;
    eatEnergizer(g);
    assert.equal(g[flag], false, flag);
  }
});

test("Suck: an energizer it swallows recharges it (they chain)", () => {
  const { core, g } = start(6);
  const e = g.powers[0];
  Object.assign(g.chars.pac, { x: e.x * 8 + 4 + 16, y: e.y * 8 + 4 });
  core.keypressed("space");
  assert.ok(!g.powers.includes(e), "it swallowed the energizer");
  assert.equal(g.vacuumSpent, false, "and is ready again");
});

test("Phase / Boost / Stun: an energizer leaves their reload alone (their own timers)", () => {
  for (const ab of [1, 2, 3]) {
    const { g } = start(ab);
    g.chars.pac.phased = -20;
    eatEnergizer(g);
    assert.equal(g.chars.pac.phased, -20, "ability " + ab);
  }
});
