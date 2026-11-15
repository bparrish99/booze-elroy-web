// The Random ability (ability 8; the author, 2026-11-15): a new one of the seven at every new board, never the same
// twice running, kept through lives lost on that board.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "../tools/golden.mjs";

const DATA = JSON.parse(readFileSync(new URL("../assets/data.json", import.meta.url), "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);

test("Random: a pick each board, never the same twice running, kept through a death", () => {
  let s = 41; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, isDown: () => false, proMode: true });
  core.init(); Object.assign(core.g.config, { proMode: true, ability: core.RANDOM, ghostCount: 0, startingLives: 5 });
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  const g = core.g, toNormal = () => { for (let f = 0; f < 900 && g.mode !== "normal"; f++) core.update(); core.update(); };
  core.update();
  const first = core.curAbility(); // picked as the game starts (the header used to show a stand-in until READY)
  toNormal();
  assert.equal(core.curAbility(), first, "the same one through READY into play");
  const picks = [core.curAbility()];
  assert.ok(picks[0] >= 1 && picks[0] <= 7, "a real ability: " + picks[0]);
  core.mode.setMode("caught"); toNormal();
  assert.equal(core.curAbility(), picks[0], "kept through a death");
  for (let b = 0; b < 12; b++) {
    g.dots.length = 0; g.powers.length = 0; // the board's done
    core.update(); toNormal();
    const a = core.curAbility();
    assert.ok(a >= 1 && a <= 7);
    assert.notEqual(a, picks[picks.length - 1], "never the same twice running");
    picks.push(a);
  }
  assert.ok(new Set(picks).size >= 4, "it really varies: " + picks.join(","));
});
