// End-to-end: the built page + dev server (real API code, local Blobs store), driven by Playwright.
//   node tests/leaderboard.e2e.mjs        (SHOTS=dir to save screenshots)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startDev } from "../tools/dev-server.mjs";

const blobsDir = mkdtempSync(join(tmpdir(), "booze-e2e-"));
const dev = await startDev({ port: 0, blobsDir, password: "pw", quiet: true });
const DEFAULT = "pac.0.f.f.f.3.1.f.0.4.t.f.f";
const api = (path, body) => fetch(dev.url + "/api/scores" + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
let failed = false;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) { failed = true; process.exitCode = 1; } };

const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await api("", { board: DEFAULT, name: "pinback", score: 5000 });
  const p = await b.newPage({ viewport: { width: 672, height: 864 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const shot = async (n) => { if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, n + ".png") }); };
  const ev = (f, a) => p.evaluate(f, a);
  const g = (expr) => p.evaluate(`(() => { const g = window.__core.g; return ${expr}; })()`);
  const until = async (expr, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await g(expr)) return true; await p.waitForTimeout(100); } return false; };

  await p.goto(dev.url + "/"); await p.waitForTimeout(1500);
  check(await until("g.highScore === 5000 && g.highScoreName === 'PINBACK'"), "title header shows the online leader for the default settings");
  await shot("1-title");
  check(await ev(() => window.__core.attractMenu.map((i) => i.text).join(",")) === "Play 1P,Options,Leaderboard,Share Config", "main menu: Leaderboard and Share Config, no Autoplay or Credits");
  check(await ev(() => window.__core.optMenu.filter((i) => i.text).map((i) => i.text).join(",")) === "Restore Defaults,Share Config,Credits,Back", "Options: Restore Defaults, Share Config, Credits, Back");
  await ev(() => { const c = window.__core; c.setScene("options"); c.optMenu.selectedItem = c.optMenu.findIndex((i) => i.text === "Credits") + 1; });
  await p.keyboard.press("Enter");
  check(await g("g.scene.name === 'credits'"), "Options > Credits opens the credits");
  await p.keyboard.press("Escape");
  check(await g("g.scene.name === 'options' && window.__core.optMenu[window.__core.optMenu.selectedItem - 1].text === 'Credits'"), "Esc from those credits goes back to Options");
  await ev(() => window.__core.setScene("attract"));
  await p.waitForTimeout(300);
  await p.mouse.click(336, 845); // "web edition", bottom row (3x scale)
  check(await g("g.scene.name === 'credits'"), "clicking WEB EDITION on the title opens the credits");
  await p.keyboard.press("Escape");
  check(await g("g.scene.name === 'attract'"), "and Esc goes back to the title");

  for (let i = 0; i < 2; i++) await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter");
  check(await until("g.scene.name === 'leaderboard' && g.scene.board().entries.length === 1"), "leaderboard page lists the board");
  check(await ev(() => window.__core.g.scene.menu.map((i) => i.text).join(",")) === "Share Config,Back", "leaderboard page has Share Config and Back");
  await p.keyboard.press("Enter"); await p.waitForTimeout(200);
  check(await g("g.scene.name === 'leaderboard' && !!g.toast"), "Share Config on the leaderboard copies (or tries to)");
  await p.keyboard.press("ArrowDown");
  check(await ev(() => { const m = window.__core.g.scene.menu; return m[m.selectedItem - 1].text; }) === "Back", "down moves to Back");
  await p.waitForTimeout(300); await shot("2-leaderboard");
  await p.keyboard.press("Escape");
  check(await until("g.scene.name === 'attract'"), "Esc returns to the title");

  // a different gameplay setting is a different board; a cosmetic one isn't
  await ev(() => { window.__core.g.config.crtEffect = false; window.__core.g.config.background = "galaxy"; });
  await p.waitForTimeout(600);
  check(await g("g.highScore === 5000"), "cosmetic options keep the same board");
  await ev(() => { window.__core.g.config.ghostCount = 2; });
  check(await until("g.highScore === false && !g.highScoreName"), "changing ghost count switches to an (empty) board");
  await ev(() => { window.__core.g.config.ghostCount = 4; window.__core.g.config.crtEffect = true; window.__core.g.config.background = "none"; });
  check(await until("g.highScore === 5000"), "and back");

  // play, force a game over with a top score -> name entry
  await p.keyboard.press("Home"); await ev(() => { window.__core.attractMenu.selectedItem = 1; });
  await p.keyboard.press("Enter");
  check(await until("g.scene.name === 'game' && g.mode === 'normal'", 12000), "game starts");
  await ev(() => { const c = window.__core; c.g.score = 7000; c.mode.setMode("gameover"); });
  check(await until("g.scene.name === 'nameEntry'", 8000), "top-10 score at game over opens name entry");
  await p.keyboard.type("tester-1?f");          // "?" isn't allowed (no glyph); "f" must type, not toggle fullscreen
  await p.keyboard.press("Backspace");
  check(await g("g.scene.name === 'nameEntry' && g.scene.entry") === "TESTER-1", "typing (letters, digits, shifted symbols, backspace) fills the name");
  await shot("3-name-entry");
  // arrow navigation: right from "/" wraps to "4"; down from the short last row lands on a special; then to END
  const sel = () => ev(() => { const m = window.__core.g.scene.menu; return m[m.selectedItem - 1].text; });
  for (let i = 0; i < 3; i++) await p.keyboard.press("ArrowDown");
  await p.keyboard.press("ArrowLeft");
  check(await sel() === "/", "left from 4 wraps to / (short row)");
  await p.keyboard.press("ArrowUp"); check(await sel() === "2", "up from / (column 8) lands on 2");
  await p.keyboard.press("ArrowDown"); await p.keyboard.press("ArrowDown"); check(await sel() === "end", "down from / lands on END");
  await p.keyboard.press("ArrowDown"); check(await sel() === "I", "down from END (column 8) wraps to I");
  await p.keyboard.press("ArrowUp");
  // navigate the grid to END and confirm
  check(await sel() === "end", "on END");
  await p.keyboard.press("Enter");
  check(await until("g.scene.name === 'leaderboard' && g.scene.highlight === 1", 8000), "submitting shows the board with the new entry highlighted");
  await p.waitForTimeout(300); await shot("4-after-submit");
  const board = await api("?board=" + DEFAULT);
  check(JSON.stringify(board.entries.map((e) => [e.name, e.score])) === JSON.stringify([["TESTER-1", 7000], ["PINBACK", 5000]]), "server stored it: " + JSON.stringify(board.entries.map((e) => e.name)));
  await p.keyboard.press("Escape");
  check(await until("g.scene.name === 'attract' && g.highScore === 7000 && g.highScoreName === 'TESTER-1'"), "title header shows the new leader");

  // Reset High Scores: hidden ?resetscores link -> password dialog
  check(await ev(() => !window.__core.optMenu.some((i) => /reset/i.test(i.text || ""))), "Options has no reset item");
  await p.goto(dev.url + "/?resetscores"); await p.waitForTimeout(1000);
  check(await p.isVisible("#reset"), "?resetscores asks for the password");
  check(await ev(() => location.search === ""), "and drops ?resetscores from the address");
  await p.fill("#reset input[name=password]", "wrong");
  await p.click("#reset button[value=reset]");
  await p.waitForFunction(() => document.querySelector("#reset .msg").textContent === "Wrong password.", null, { timeout: 5000 }).then(() => check(true, "wrong password is refused"), () => check(false, "wrong password is refused"));
  check((await api("?board=" + DEFAULT)).entries.length === 2, "nothing was deleted");
  await shot("5-reset-dialog");
  await p.check("#reset input[value=all]");
  await p.fill("#reset input[name=password]", "pw");
  await p.press("#reset input[name=password]", "Enter");
  await p.waitForFunction(() => !document.querySelector("#reset").open, null, { timeout: 5000 }).then(() => check(true, "right password resets and closes"), () => check(false, "right password resets and closes"));
  check((await api("?board=" + DEFAULT)).entries.length === 0, "all boards cleared on the server");
  check(await until("g.highScore === false"), "header cleared");

  // Share Config: copies a link with the gameplay settings; opening it preselects them (and nothing else)
  {
    const ctx = await b.newContext({ viewport: { width: 672, height: 864 }, permissions: ["clipboard-read", "clipboard-write"] });
    const q = await ctx.newPage(); q.on("pageerror", (e) => errs.push(e.message));
    await q.goto(dev.url + "/"); await q.waitForTimeout(1000);
    await q.evaluate(() => { const c = window.__core.g.config; c.mazepack = "mspac"; c.ghostCount = 2; c.radar = 60; c.startingLevel = 7; c.volume = 3; });
    await q.evaluate(() => { const m = window.__core.attractMenu; m.selectedItem = m.findIndex((i) => i.text === "Share Config") + 1; });
    await q.keyboard.press("Enter");
    await q.waitForTimeout(200);
    check(await q.evaluate(() => window.__core.g.toast && window.__core.g.toast.text) === "link copied to clipboard", "main-menu Share Config shows the popup");
    if (process.env.SHOTS) await q.screenshot({ path: join(process.env.SHOTS, "6-share.png") });
    const link = await q.evaluate(() => navigator.clipboard.readText());
    const code = new URL(link).searchParams.get("cfg");
    check(link.startsWith(new URL(dev.url).origin + "/?cfg=") && /^[0-9a-z]{6}$/.test(code), "link carries a short share code: " + link);
    check(await q.evaluate((c) => window.BoozeScoreKey.keyFor(window.BoozeScoreKey.configFromCode(c)), code) === "mspac.0.f.f.60.3.1.f.0.2.t.f.f", "the code holds only the gameplay settings");
    await q.evaluate(() => { const c = window.__core; c.setScene("options"); c.optMenu.selectedItem = c.optMenu.findIndex((i) => i.text === "Share Config") + 1; window.__core.g.toast = null; });
    await q.keyboard.press("Enter"); await q.waitForTimeout(200);
    check(await q.evaluate(() => !!window.__core.g.toast), "Options has Share Config too");
    await ctx.close();

    const ctx2 = await b.newContext({ viewport: { width: 672, height: 864 } });
    const r = await ctx2.newPage(); r.on("pageerror", (e) => errs.push(e.message));
    await r.goto(link); await r.waitForTimeout(1000);
    const cfg = await r.evaluate(() => window.__core.g.config);
    check(cfg.mazepack === "mspac" && cfg.ghostCount === 2 && cfg.radar === 60, "opening the link selects the shared settings");
    check(cfg.startingLevel === 1 && cfg.volume !== 3, "starting level and volume are not shared");
    check(await r.evaluate(() => location.search === "" && JSON.parse(localStorage.getItem("booze-elroy-options")).ghostCount === 2), "settings saved, ?cfg removed from the address");
    await r.goto(dev.url + "/?cfg=garbage"); await r.waitForTimeout(800);
    check(await r.evaluate(() => window.__core.g.config.ghostCount === 2), "a bad ?cfg is ignored");
    await ctx2.close();
  }
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
} finally {
  await b.close(); await dev.stop(); rmSync(blobsDir, { recursive: true, force: true });
}
if (failed) console.log("e2e FAILED");
