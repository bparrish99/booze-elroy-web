// End-to-end: the maze editor page (tools/maze-editor) against the dev server, with a scratch copy of assets/data.json
// (the repo's own files are never touched).   node tests/maze-editor.e2e.mjs   (SHOTS=dir to save screenshots)
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startDev } from "../tools/dev-server.mjs";

const root = mkdtempSync(join(tmpdir(), "booze-maze-editor-e2e-"));
mkdirSync(join(root, "assets"));
copyFileSync(new URL("../assets/data.json", import.meta.url), join(root, "assets", "data.json"));
const dev = await startDev({ port: 0, blobsDir: join(root, "blobs"), quiet: true, editorRoot: root });
let failed = false;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) { failed = true; process.exitCode = 1; } };

const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  p.on("dialog", (d) => d.accept());
  const shot = async (n) => { if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, n + ".png") }); };
  const ed = (expr) => p.evaluate(`(() => { const E = window.__editor; return ${expr}; })()`);

  await p.goto(dev.url + "/editor/");
  await p.waitForFunction(() => window.__editor && window.__editor.gen);
  check(await ed("E.doc.name") === "booze5", "a new maze is called booze5 (the first free name)");
  check(await ed("E.gen.map.join('')") === JSON.parse(readFileSync(join(root, "assets/data.json"), "utf8")).mazes.pac.map.join("") && await ed("E.chk.problems.length") === 0, "a new maze is a copy of pac, with no problems");
  check(await p.getAttribute("#tools .tool.on", "data-tool") === "#", "Wall is the default tool");

  await p.click("#open"); await p.waitForSelector("#games button");
  check((await p.locator("#games button").allTextContents()).join(",") === "pac,mspac1,mspac2,mspac3,mspac4,booze1,booze2,booze3,booze4,ultra1,ultra2,ultra3,ultra4,ultra5", "Open offers the standard-pen mazes");
  await p.click("#games button:text-is('booze1')");
  check(await ed("E.doc.name") === "booze5" && await ed("E.gen.map.join('')") === JSON.parse(readFileSync(join(root, "assets/data.json"), "utf8")).mazes.booze1.map.join(""), "starting from booze1: a copy named booze5, drawn exactly like booze1");
  check(await ed("E.chk.problems.length") === 0, "no problems");
  await shot("me1-booze1");

  // paint a 2x2 wall block over dots in the bottom-left corridor; it mirrors
  const box = await p.locator("#maze").boundingBox(), T = box.width / 28;
  const at = (x, y) => [box.x + (x + 0.5) * T, box.y + (y + 0.5) * T];
  // with Dots, the right button paints wall back
  await p.keyboard.press("2");
  await p.mouse.move(...at(2, 29)); await p.mouse.down({ button: "right" }); await p.mouse.up({ button: "right" });
  check(await ed("E.doc.cells[29][2] + E.doc.cells[29][25]") === "##", "with Dots, right-click paints wall (mirrored)");
  await p.keyboard.press("Control+z");
  await p.keyboard.press("1");
  await p.mouse.move(...at(2, 29)); await p.mouse.down(); await p.mouse.move(...at(3, 29), { steps: 3 }); await p.mouse.up();
  check(await ed("E.doc.cells[29].slice(2,4) + E.doc.cells[29].slice(24,26)") === "####", "a wall stroke paints both halves");
  check(await ed("E.gen.map[29].slice(2,4)") !== "..", "and draws it as wall");
  await p.keyboard.press("Control+z");
  check(await ed("E.doc.cells[29].slice(2,4)") === "..", "undo");
  await p.keyboard.press("Control+Shift+z");
  check(await ed("E.doc.cells[29].slice(2,4)") === "##", "redo");
  await p.keyboard.press("Control+z");
  // shift-drag: a rectangle
  await p.keyboard.down("Shift"); await p.mouse.move(...at(2, 28)); await p.mouse.down(); await p.mouse.move(...at(3, 29), { steps: 3 }); await p.mouse.up(); await p.keyboard.up("Shift");
  check(await ed("[E.doc.cells[28].slice(2,4), E.doc.cells[29].slice(2,4), E.doc.cells[29].slice(24,26)].join('')") === "######", "shift-drag fills a rectangle (mirrored)");
  // right button paints dots back
  await p.mouse.move(...at(2, 28)); await p.mouse.down({ button: "right" }); await p.mouse.up({ button: "right" });
  check(await ed("E.doc.cells[28][2] + E.doc.cells[28][25]") === "..", "right-click paints dots");
  await p.keyboard.press("Control+z"); await p.keyboard.press("Control+z");
  // the fixed area doesn't change
  await p.mouse.move(...at(12, 11)); await p.mouse.down(); await p.mouse.up();
  check(await ed("E.doc.cells[11][12]") === " ", "the pen ring is fixed");

  // glyph tool: pick a different glyph where more than one fits
  const spot = await ed("(() => { for (let y = 0; y < 31; y++) for (let x = 0; x < 14; x++) { const i = E.gen.info[y][x]; if (i && !i.fixed && i.cands.length > 1) return [x, y, i.cands[1]]; } })()");
  await p.keyboard.press("8");
  await p.mouse.move(...at(spot[0], spot[1])); await p.mouse.down(); await p.mouse.up();
  await p.waitForSelector("#picker canvas");
  await p.locator("#picker canvas").nth(1).click();
  check(await ed(`E.doc.glyphs["${spot[0]},${spot[1]}"]`) === spot[2] && await ed(`E.doc.glyphs["${27 - spot[0]},${spot[1]}"]`) === E_MIRROR(spot[2]), "the glyph picker sets a glyph (and its mirror image)");
  await p.mouse.move(...at(spot[0], spot[1])); await p.mouse.down({ button: "right" }); await p.mouse.up({ button: "right" });
  check(await ed(`E.doc.glyphs["${spot[0]},${spot[1]}"]`) === undefined, "right-click puts it back to automatic");

  // After Dark tool: a free-standing block made visible
  const blk = await ed("(() => { for (let y = 0; y < 31; y++) for (let x = 0; x < 14; x++) { const i = E.gen.info[y][x]; if (i && !i.fixed && !i.outer) return [x, y]; } })()");
  await p.keyboard.press("9");
  await p.mouse.move(...at(blk[0], blk[1])); await p.mouse.down(); await p.mouse.up();
  check(await ed(`E.gen.info[${blk[1]}][${blk[0]}].outer && E.gen.map[${blk[1]}][${blk[0]}] === E.M.upper(E.gen.map[${blk[1]}][${blk[0]}])`), "After Dark tool: a block made to stay visible gets upper-case glyphs");
  await p.keyboard.press("Control+z");

  // colour and ghost rows
  await p.locator("#colors canvas").nth(4).click();
  check(await ed("E.doc.color") === 5, "colour picked");
  const rowOpt = await p.locator("#punky option").nth(0).getAttribute("value");
  await p.selectOption("#punky", rowOpt);
  check(await ed("E.doc.punky") === Number(rowOpt), "Punky's row (from the middle-corridor rows)");

  // scatter targets: pick one on the maze, type one in, presets
  await p.click("#sc-inky-pick"); await p.mouse.move(...at(20, 20)); await p.mouse.down(); await p.mouse.up();
  check(await ed("JSON.stringify(E.doc.scatter.inky)") === '{"x":20,"y":20}' && await ed("E.doc.cells[20][20]") === JSON.parse(readFileSync(join(root, "assets/data.json"), "utf8")).mazes.booze1.map[20][20].replace(/[^ .`_;:]/, "#"), "pick sets Inky's scatter target (and doesn't paint)");
  check(await p.inputValue("#scatter") === "custom", "the preset shows custom");
  await p.fill("#sc-clyde-y", "-3"); await p.press("#sc-clyde-y", "Tab");
  check(await ed("E.doc.scatter.clyde.y") === -3, "a target typed in (off the maze)");
  await p.keyboard.press("Control+z");
  check(await ed("E.doc.scatter.clyde.y") === 30, "undo");
  await p.selectOption("#scatter", "inside");
  check(await ed("JSON.stringify(E.doc.scatter)") === JSON.stringify({ blinky: { x: 20, y: 3 }, pinky: { x: 4, y: 3 }, inky: { x: 23, y: 22 }, clyde: { x: 4, y: 22 } }), "a preset sets all four");
  await p.click("#sc-blinky-pick"); await p.mouse.move(...at(24, 5)); await p.mouse.down(); await p.mouse.up();
  await shot("me-scatter");

  // save, test play, add to the game, remove
  await p.keyboard.press("Control+s"); await p.waitForTimeout(300);
  check(existsSync(join(root, "mazes", "booze5.json")) && JSON.parse(readFileSync(join(root, "mazes", "booze5.json"), "utf8")).color === 5, "Ctrl+S saves mazes/booze5.json");
  const [tab] = await Promise.all([ctx.waitForEvent("page"), p.click("#play")]);
  const terrs = []; tab.on("pageerror", (e) => terrs.push(e.message));
  await tab.waitForFunction(() => window.__core && window.__core.g, null, { timeout: 20000 });
  await tab.waitForTimeout(800);
  check(await tab.evaluate(() => window.__core.g.mazes.booze.list.join() === "editortest" && window.__core.g.currentMaze === "editortest"), "test play: the game plays the edited maze");
  check(await tab.evaluate(() => window.BOOZE_ASSETS.data.mazes.editortest.defaultColor) === 5, "test play: with its colour");
  await tab.close();
  check(terrs.length === 0, "no errors in the game" + (terrs.length ? ": " + terrs.join("; ") : ""));

  await p.click("#add"); await p.waitForFunction(() => /in the game/.test(document.getElementById("msg").textContent), null, { timeout: 10000 });
  const data = JSON.parse(readFileSync(join(root, "assets/data.json"), "utf8"));
  check(data.mazeNames.at(-1) === "booze5" && data.mazes.booze5.map.length === 31 && data.mazes.booze5.punkyStart.y === Number(rowOpt), "Add to game writes booze5 into data.json");
  check(JSON.stringify(data.mazes.booze5.scatterPositions.blinky) === '{"x":24,"y":5}' && JSON.stringify(data.mazes.booze5.scatterTiles[0]) === '{"x":24,"y":5}', "with its scatter targets");
  check(/Booze pack has 5 mazes/.test(await p.textContent("#msg")), "and says the Booze pack has 5 mazes");
  await p.click("#new");
  check(await ed("E.doc.name") === "booze6", "the next new maze is booze6");
  const r = await fetch(dev.url + "/editor/api/remove", { method: "POST", body: JSON.stringify({ name: "booze5" }) }).then((x) => x.json());
  check(r.ok && !JSON.parse(readFileSync(join(root, "assets/data.json"), "utf8")).mazeNames.includes("booze5"), "remove takes it out again");
  const bad = await fetch(dev.url + "/editor/api/add", { method: "POST", body: JSON.stringify({ doc: { name: "booze2" }, maze: data.mazes.booze2 }) });
  check(bad.status === 400, "the original booze1-4 can't be overwritten");
  await shot("me2-end");
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join("; ") : ""));
} finally {
  await b.close(); await dev.stop();
  rmSync(root, { recursive: true, force: true });
  if (failed) console.log("maze editor e2e FAILED");
}

function E_MIRROR(g) { return { 1: "5", 2: "2", 3: "4", 4: "3", 5: "1", 6: "9", 7: "8", 8: "7", 9: "6", A: "C", B: "B", C: "A", D: "F", E: "E", F: "D", G: "H", H: "G", I: "M", J: "J", K: "L", L: "K", M: "I", N: "R", O: "Q", P: "P", Q: "O", R: "N", S: "T", T: "S", U: "W", V: "X", W: "U", X: "V", Y: "Y" }[g]; }
