// The Vacuum ability (ability 6; web edition, 2026-11-14): once per life / board, it sucks up everything within 6
// tiles, straight through walls: energizers first (a ghost they turn blue is eaten, not deadly), dots, the fruit, and
// ghosts: dragged in for real while play stops (mode "vacuum"), then blue ones eaten one at a time (the usual pause and
// 200/400/... chain), and a ghost that isn't blue catches him when it arrives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadCore } from "../tools/golden.mjs";

const DATA = JSON.parse(readFileSync(new URL("../assets/data.json", import.meta.url), "utf8"));
const create = loadCore(new URL("../src/core.js", import.meta.url).pathname);

function start(ghostCount = 4) {
  let s = 9; const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, isDown: () => false, proMode: true });
  core.init(); Object.assign(core.g.config, { proMode: true, ability: core.VACUUM, ghostCount });
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  for (let f = 0; f < 600 && core.g.mode !== "normal"; f++) core.update();
  assert.equal(core.g.mode, "normal");
  core.update(); core.update(); // into normal play (running)
  const g = core.g, cm = core.getCurrentMaze();
  const [pX, , pY] = cm.getLoc(g.chars.pac);
  // ghosts parked far away unless a test moves them
  for (const n of ["blinky", "pinky", "inky", "clyde"]) if (g.chars[n]) Object.assign(g.chars[n], { x: 8 * 2 + 4, y: 8 * 2 + 4, housing: false, leaving: false, entering: false, dead: false, frightened: false, hidden: false, speed: 0, accum16: 0 });
  return { core, g, pX, pY };
}
const at = (ch, x, y) => Object.assign(ch, { x: x * 8 + 4, y: y * 8 + 4 });
// let the vacuum drag its ghosts in
const settle = (core) => { for (let f = 0; f < 100 && core.g.mode === "vacuum"; f++) core.update(); };
const dist2 = (a, x, y) => (a.x - x) ** 2 + (a.y - y) ** 2;

test("Vacuum: dots and energizers within 6 tiles go (straight line), farther ones stay; one charge until READY", () => {
  const { core, g, pX, pY } = start();
  const near = g.dots.filter((d) => dist2(d, pX, pY) <= 36).length, far = g.dots.filter((d) => dist2(d, pX, pY) > 36).length;
  assert.ok(near > 5);
  const before = g.score;
  core.keypressed("space");
  assert.equal(g.dots.filter((d) => dist2(d, pX, pY) <= 36).length, 0, "the near dots are gone");
  assert.equal(g.dots.length, far, "the far ones stay");
  assert.ok(g.score >= before + near * 10, "and they scored");
  assert.equal(g.vacuumSpent, true);
  const left = g.dots.length;
  core.update(); core.keypressed("space"); // spent: nothing
  assert.ok(g.dots.length >= left - 2);
});

test("Vacuum: a ghost that isn't blue, in reach, catches him", () => {
  const { core, g, pX, pY } = start();
  at(g.chars.blinky, pX + 3, pY);
  const x0 = g.chars.blinky.x;
  core.keypressed("space");
  assert.equal(g.mode, "vacuum", "play stops while it drags the ghost in");
  for (let f = 0; f < 20; f++) core.update();
  assert.ok(Math.abs(g.chars.blinky.x - g.chars.pac.x) < Math.abs(x0 - g.chars.pac.x), "the ghost is on its way in");
  settle(core);
  assert.equal(g.mode, "caught", "and catches him when it arrives");
});

test("Vacuum: blue ghosts in reach are eaten one at a time, 200 then 400", () => {
  const { core, g, pX, pY } = start();
  g.powers.length = 0; // no energizer in reach to complicate it
  at(g.chars.blinky, pX + 3, pY); at(g.chars.pinky, pX - 3, pY);
  for (const n of ["blinky", "pinky"]) g.chars[n].frightened = 400;
  g.frightened = 400;
  const before = g.score;
  core.keypressed("space");
  settle(core);
  assert.equal(g.mode, "ateGhost");
  assert.ok(T(g.chars.blinky.dead) !== T(g.chars.pinky.dead), "one eaten at first");
  for (let f = 0; f < 200 && !(T(g.chars.blinky.dead) && T(g.chars.pinky.dead)); f++) core.update();
  assert.ok(T(g.chars.blinky.dead) && T(g.chars.pinky.dead), "then the other, after the pause");
  assert.ok(g.score - before >= 600, "200 + 400 (plus the dots)");
});

test("Vacuum: an energizer in reach turns a ghost in reach blue first, so it's eaten", () => {
  const { core, g } = start();
  const e = g.powers[0];
  Object.assign(g.chars.pac, { x: e.x * 8 + 4 + 16, y: e.y * 8 + 4 }); // two tiles from an energizer
  const [x, y] = [e.x + 2, e.y];
  at(g.chars.blinky, x + 3, y);
  core.keypressed("space");
  assert.ok(T(g.chars.blinky.frightened), "blue as it's dragged in");
  settle(core);
  assert.notEqual(g.mode, "caught");
  assert.ok(T(g.chars.blinky.dead), "eaten");
  assert.ok(!g.powers.includes(e), "and the energizer is gone");
});

test("Vacuum: play stops while it sucks, ghosts or not, then goes on", () => {
  const { core, g } = start();
  core.keypressed("space");
  assert.equal(g.mode, "vacuum");
  settle(core);
  assert.equal(g.mode, "normal");
});

test("Vacuum: the fruit in reach is eaten", () => {
  const { core, g } = start();
  const fl = core.getCurrentMaze().fruitLoc;
  Object.assign(g.chars.pac, { x: fl.x + 16, y: fl.y });
  g.fruitTimer = 500;
  core.keypressed("space");
  assert.equal(g.fruitTimer, false);
});

test("Vacuum: the charge comes back at READY (a new life)", () => {
  const { core, g } = start();
  core.keypressed("space");
  assert.equal(g.vacuumSpent, true);
  core.mode.setMode("caught");
  for (let f = 0; f < 600 && g.mode !== "normal"; f++) core.update();
  assert.equal(g.vacuumSpent, false);
});

function T(v) { return v !== false && v !== null && v !== undefined; }

// caught on the step that clears the board (a Suck taking the last dots and a ghost that isn't blue; the author,
// 2026-11-20): the death, then straight to the board done and the next board, no READY / frame of play on an empty board
// first; on the last life, game over
function clearedDeath(pro, lives) {
  const { core, g, pX, pY } = start();
  g.config.proMode = pro;
  g.dots = g.dots.filter((d) => dist2(d, pX, pY) <= 36); g.powers = []; // only dots the Suck reaches are left
  at(g.chars.blinky, pX + 3, pY);
  g.lives = lives;
  const level = g.levelNumber;
  core.keypressed("space"); settle(core);
  const modes = [];
  for (let f = 0; f < 3000 && g.scene.name === "game" && g.levelNumber === level; f++) { core.update(); if (modes[modes.length - 1] !== g.mode) modes.push(g.mode); }
  return { g, modes, level };
}
for (const pro of [false, true]) {
  test("Suck: caught as it clears the board: the death, then the board done (Pro Mode " + (pro ? "on" : "off") + ")", () => {
    const { g, modes, level } = clearedDeath(pro, 2);
    const i = modes.indexOf("caught"), j = modes.indexOf("levelComplete");
    assert.ok(i >= 0 && j > i, modes.join(" "));
    assert.ok(!modes.slice(i, j).includes("normal"), "no play before the board done: " + modes.join(" "));
    if (!pro) assert.ok(modes.slice(i, j).includes("dying"), "the death animation: " + modes.join(" "));
    assert.equal(g.levelNumber, level + 1, "onto the next board");
    assert.equal(g.lives, 1, "a life lost");
  });
}
test("Suck: caught as it clears the board on the last life: game over", () => {
  const { modes } = clearedDeath(false, 0);
  assert.ok(modes.includes("gameover") && !modes.includes("levelComplete"), modes.join(" "));
});
