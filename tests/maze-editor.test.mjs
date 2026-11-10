// The maze editor (tools/maze-editor): auto-tiling against the existing mazes, its checks, and how the core picks up
// editor mazes (booze5, ...) and the editor's test play.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as M from "../tools/maze-editor/autotile.mjs";

const require = createRequire(import.meta.url);
const BoozeCore = require("../src/core.js");
const DATA = require("../assets/data.json");
const table = M.learn(DATA);
const EDITABLE = DATA.mazeNames.filter((n) => M.editable(DATA.mazes[n]));

test("every 28x31 maze with the standard pen opens in the editor and exports back character for character", () => {
  assert.deepEqual(EDITABLE.filter((n) => !/^booze([5-9]|\d\d)/.test(n)),
    ["pac", "mspac1", "mspac2", "mspac3", "mspac4", "booze1", "booze2", "booze3", "booze4", "ultra1", "ultra2", "ultra3", "ultra4", "ultra5"]);
  for (const n of EDITABLE) {
    const m = DATA.mazes[n], doc = M.fromMazeData(n, m, table), gen = M.generate(doc, table);
    assert.deepEqual(gen.map, m.map, n);
    assert.deepEqual(M.check(doc, gen).problems.filter((p) => p.level === "error"), [], n + " has no errors");
    const out = M.toMazeData(doc, gen);
    for (const k of ["defaultColor", "fruitTriggers", "sirenTriggers", "punkyStart", "gunkyStart", "gronkyStart", "pacStart", "houseCenter", "fruitLoc", "w", "h", "ready", "playerone", "scatterTiles", "scatterPositions"]) assert.deepEqual(out[k], m[k], n + " " + k);
  }
});

test("the auto-tiler alone draws pac, booze1 and ultra1 exactly as their author did", () => {
  for (const n of ["pac", "mspac1", "booze1", "ultra1"]) {
    const doc = M.fromMazeData(n, DATA.mazes[n], table);
    assert.deepEqual(doc.glyphs, {}, n + " needs no hand-picked glyphs");
    assert.deepEqual(doc.visible, {}, n + " needs no After Dark overrides");
  }
});

test("a new maze is connect-the-dots: 2x2 wall blocks on a dotted grid, with no problems", () => {
  const doc = M.blankDoc("booze5"), gen = M.generate(doc, table);
  assert.ok(M.fitsGrid(doc));
  assert.equal(doc.cells[2].slice(3, 25), ".".repeat(22), "a dotted grid row");
  assert.equal(doc.cells[3].slice(4, 6) + doc.cells[4].slice(4, 6), "####", "a 2x2 wall block");
  assert.deepEqual(M.check(doc, gen).problems, []);
  assert.equal(gen.map[1].slice(2, 26), "1" + "2".repeat(22) + "5", "the outer wall is the one-tile double line");
  assert.equal(gen.map[5][0] + gen.map[5][1], "  ", "outside it, void");
  for (let y = 0; y < M.H; y++) for (let x = 0; x < M.W; x++) {
    const a = gen.info[y][x], b = gen.info[y][M.mirrorX(x)];
    if (a && a.glyph && !a.fixed) assert.equal(M.MIRROR[a.glyph], b.glyph, `mirror at ${x},${y}`);
  }
});

test("connecting the dots: a wall fills the gap between two blocks (mirrored); crossings follow their gaps", () => {
  const doc = M.blankDoc("booze5");
  assert.equal(M.paintGrid(doc, 4, 2, "#"), true, "the gap above the first block");
  assert.equal(doc.cells[2].slice(4, 6), "##"); assert.equal(doc.cells[2].slice(22, 24), "##", "mirrored");
  assert.equal(M.paintGrid(doc, 4, 3, "."), false, "off the grid (inside a block): no paths");
  assert.equal(M.paintGrid(doc, 12, 14, "#"), false, "the pen ring is fixed");
  assert.equal(doc.cells[2][3], ".", "the corner crossing at 3,2 still has a way out (down)");
  M.paintGrid(doc, 3, 3, "#");
  assert.equal(doc.cells[2][3], "#", "with every way out walled it becomes wall");
  M.paintGrid(doc, 3, 4, ".");
  assert.equal(doc.cells[2][3] + doc.cells[3][3] + doc.cells[4][3], "...", "opening a gap reopens its crossing");
  M.paintGrid(doc, 3, 3, "`");
  assert.equal(doc.cells[3][3], "`", "path tools change one open tile");
  assert.ok(M.fitsGrid(doc));
  assert.deepEqual(M.check(doc, M.generate(doc, table)).problems.filter((p) => p.level === "error"), []);
});

test("checks: thin walls, unreachable dots, one-sided vertical tunnels, missing ghost starts", () => {
  const doc = M.applyLocks({ ...M.blankDoc("booze5"), grid: false, cells: Array(M.H).fill("#".repeat(M.W)) }); // solid wall
  const has = (d, re) => M.check(d, M.generate(d, table)).problems.some((p) => re.test(p.text));
  const carve = (x0, y0, x1, y1, k = ".") => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) M.setCell(doc, x, y, k); };
  assert.ok(has(doc, /Gronky/), "no side tunnel for Gronky");
  carve(0, 14, 1, 14, "_"); carve(2, 14, 8, 14);
  assert.ok(has(doc, /Gronky/), "a side tunnel Pac-Man can't get to doesn't count");
  carve(2, 14, 2, 23); carve(2, 23, 12, 23);
  assert.ok(!has(doc, /Gronky/), "a side tunnel fixes it");
  carve(2, 2, 5, 5);
  assert.ok(has(doc, /can't reach/), "a room Pac-Man can't get to");
  carve(2, 5, 2, 14);
  assert.ok(!has(doc, /can't reach/), "a corridor to it");
  M.setCell(doc, 3, 3, "#");
  assert.ok(has(doc, /2 tiles thick/), "a lone wall tile can't be drawn");
  M.setCell(doc, 4, 3, "#"); M.setCell(doc, 3, 4, "#"); M.setCell(doc, 4, 4, "#");
  assert.ok(!has(doc, /2 tiles thick/), "a 2x2 block can");
  carve(5, 0, 5, 1);
  assert.ok(has(doc, /top\/bottom edge/), "a hole in the top with no hole in the bottom");
  carve(5, 29, 5, 30);
  assert.ok(!has(doc, /top\/bottom edge/), "a vertical tunnel");
});

test("the core: editor mazes join the booze and normal packs, the menu counts them, random shows as all", () => {
  const plain = BoozeCore.create(DATA, {});
  assert.deepEqual(plain.g.mazes.booze.list, ["booze1", "booze2", "booze3", "booze4"]);
  assert.deepEqual(plain.optMenu[0].options.map((o) => o.text), ["pac-1", "booze-4", "mspac-4", "junior-7", "ultra-5", "arrange-3", "mega-1", "normal-17", "large-8", "all"]);
  const doc = M.fromMazeData("booze6", DATA.mazes.booze2, table), maze = M.toMazeData(doc, M.generate(doc, table));
  const data = { ...DATA, mazes: { ...DATA.mazes, booze6: maze, booze5: maze }, mazeNames: DATA.mazeNames.concat(["booze6", "booze5"]) };
  const core = BoozeCore.create(data, {});
  assert.deepEqual(core.g.mazes.booze.list, ["booze1", "booze2", "booze3", "booze4", "booze5", "booze6"]);
  assert.deepEqual(core.g.mazes.normal.list.slice(5, 11), ["booze1", "booze2", "booze3", "booze4", "booze5", "booze6"]);
  assert.equal(core.g.mazes.normal.list.length, 19);
  const texts = core.optMenu[0].options.map((o) => o.text);
  assert.equal(texts[1], "booze-6"); assert.equal(texts[7], "normal-19"); assert.equal(texts[9], "all");
  assert.deepEqual(BoozeCore.create(DATA, {}).g.mazes.booze.list, ["booze1", "booze2", "booze3", "booze4"], "packs aren't shared between cores");
});

test("the core: test play (env.testMaze) plays that maze whatever the pack", () => {
  const doc = M.blankDoc("x");
  const data = { ...DATA, mazes: { ...DATA.mazes, editortest: M.toMazeData(doc, M.generate(doc, table)) }, mazeNames: DATA.mazeNames.concat(["editortest"]) };
  const core = BoozeCore.create(data, { testMaze: "editortest" });
  core.init();
  for (const pack of ["pac", "booze", "large", "random"]) { core.g.config.mazepack = pack; core.levels.startLevel(); assert.equal(core.g.currentMaze, "editortest", pack); }
});
