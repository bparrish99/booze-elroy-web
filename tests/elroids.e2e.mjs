// Elroids (the space background's easter egg): opened by clicking the saucer, the game standing still meanwhile and
// back on the same frame after; its own leaderboard: a top-10 score asks for a name and goes up, shown on its game over.
// Needs Playwright (see smoke.js). Runs its own dev server with a scratch Blobs folder.
import { chromium } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startDev } from "../tools/dev-server.mjs";

const blobsDir = mkdtempSync(join(tmpdir(), "elroids-e2e-"));
const dev = await startDev({ port: 0, blobsDir, password: "pw", quiet: true });
const base = dev.url.replace(/\/?$/, "/");
let failed = 0;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failed += 1; };
const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const p = await b.newPage({ viewport: { width: 672, height: 864 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(base); await p.waitForTimeout(1500);
  // a real game on the space background, then the saucer clicked
  await p.evaluate(() => { const g = window.__core.g; g.config.background = "space"; g.currentBackground = "space"; g.config.crtEffect = false; });
  await p.keyboard.press("Enter"); await p.waitForTimeout(400); await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.__core.g.mode === "normal", null, { timeout: 20000 });
  await p.evaluate(() => { window.__core.g.currentBackground = "space"; });
  await p.waitForFunction(() => { const s = window.__elroids.saucer(); return s && s.x > 40 && s.x < 184; }, null, { timeout: 60000 });
  const S = await p.evaluate(() => window.__elroids.saucer());
  const rc = await p.evaluate(() => { const r = document.getElementById("screen").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const snap = () => p.evaluate(() => { const g = window.__core.g; return JSON.stringify([g.score, g.chars.pac.x, g.chars.pac.y, g.chars.blinky.x, g.chars.blinky.y, window.__core.gameFc()]); });
  const before = await snap();
  await p.mouse.click(rc.x + S.x / 224 * rc.w, rc.y + S.y / 288 * rc.h);
  await p.waitForTimeout(150);
  check(await p.evaluate(() => window.__elroids.active()), "clicking the saucer opens Elroids");
  await p.keyboard.down("ArrowLeft"); await p.keyboard.press("Space"); await p.waitForTimeout(2500); await p.keyboard.up("ArrowLeft");
  check((await snap()) === before, "the Pac-Man game stands completely still meanwhile");
  // the leaderboard: a game over with a score that places asks for a name
  await p.waitForFunction(() => window.__elroids.test.state().board, null, { timeout: 5000 }).catch(() => {});
  check(Array.isArray(await p.evaluate(() => window.__elroids.test.state().board)), "its board loads (empty to start)");
  await p.evaluate(() => window.__elroids.test.endGame(4321));
  await p.waitForFunction(() => window.__core.g.scene.name === "nameEntry", null, { timeout: 15000 }).catch(() => {});
  check(await p.evaluate(() => window.__core.g.scene.name === "nameEntry" && window.__core.g.scene.mode === "mini" && window.__core.g.scene.board === "elroids" && window.__core.g.scene.place === 1), "a top-10 score opens the game's own name entry (rank 1)");
  await p.waitForTimeout(300);
  await p.screenshot({ path: "build/elroids-name.png" });
  await p.keyboard.type("rock starf"); await p.keyboard.press("Backspace"); // ("f" types, not fullscreen; backspace deletes)
  check(await p.evaluate(() => window.__core.g.scene.entry) === "ROCK STAR", "typing fills the name");
  await p.evaluate(() => { const m = window.__core.g.scene.menu; m.selectedItem = m.findIndex((i) => i.text === "end") + 1; });
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.__elroids.test.state().myRank === 1, null, { timeout: 8000 }).catch(() => {});
  const st = await p.evaluate(() => window.__elroids.test.state());
  check(st.myRank === 1 && st.board[0].name === "ROCK STAR" && st.board[0].score === 4321, "it goes up, rank 1, shown on the game over");
  const api = await p.evaluate(async () => (await (await fetch("/api/scores?board=elroids")).json()).entries);
  check(api.length === 1 && api[0].name === "ROCK STAR", "on the server's elroids board");
  const boards = await p.evaluate(async () => (await (await fetch("/api/scores/boards")).json()).boards.map((x) => x.board));
  check(!boards.includes("elroids"), "and not on the Leaderboards page's list");
  await p.waitForTimeout(1200);
  await p.screenshot({ path: "build/elroids-board.png" });
  // Esc: back to the very frame it left, on the game's own pause
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  const after = await p.evaluate(() => [window.__elroids.active(), window.__core.g.scene.name, window.__core.g.paused]);
  check(!after[0] && after[1] === "game" && after[2], "Esc goes back to the game, paused");
  check((await snap()) === before, "on the same frame it left");
  check(await p.evaluate(() => window.__core.g.scene.name) === "game", "the game scene back, not restarted");
  await p.keyboard.press("p"); await p.waitForTimeout(400);
  check(await p.evaluate(() => !window.__core.g.paused), "and P carries on");
  // BOOZE INVADERS (the second hidden game): its shortcut, and its own board through the same name entry
  await p.goto(base + "?invaders"); await p.waitForTimeout(1500);
  check(await p.evaluate(() => window.__invaders.active()), "?invaders opens Booze Invaders");
  await p.waitForFunction(() => Array.isArray(window.__invaders.test.state().board), null, { timeout: 5000 }).catch(() => {});
  await p.waitForFunction(() => window.__invaders.test.state().phase === "play", null, { timeout: 8000 }).catch(() => {});
  await p.evaluate(() => window.__invaders.test.endGame(2500));
  await p.waitForFunction(() => window.__core.g.scene.name === "nameEntry", null, { timeout: 15000 }).catch(() => {});
  check(await p.evaluate(() => { const s = window.__core.g.scene; return s.name === "nameEntry" && s.mode === "mini" && s.title === "invaders" && s.board === "invaders"; }), "its top-10 score opens the same name entry, for its own board");
  check(await p.evaluate(() => window.__core.g.scene.entry) === "ROCK STAR", "with the last name used filled in");
  for (let i = 0; i < 9; i++) await p.keyboard.press("Backspace");
  await p.keyboard.type("invader"); await p.evaluate(() => { const m = window.__core.g.scene.menu; m.selectedItem = m.findIndex((i) => i.text === "end") + 1; });
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.__invaders.test.state().myRank === 1, null, { timeout: 8000 }).catch(() => {});
  const inv = await p.evaluate(async () => (await (await fetch("/api/scores?board=invaders")).json()).entries);
  check(inv.length === 1 && inv[0].name === "INVADER" && inv[0].score === 2500, "it goes up on the invaders board");
  const els = await p.evaluate(async () => (await (await fetch("/api/scores?board=elroids")).json()).entries);
  check(els.length === 1 && els[0].name === "ROCK STAR", "and Elroids' board is untouched");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  check(await p.evaluate(() => !window.__invaders.active() && window.__core.g.scene.name === "attract"), "Esc goes back to the title");
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs[0] : ""));
} finally {
  await b.close(); await dev.stop(); rmSync(blobsDir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
