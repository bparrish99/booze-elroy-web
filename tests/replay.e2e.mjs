// End-to-end: leaderboard replays (EXPERIMENTAL, 2026-11-18). A real game played in the browser, its score posted with its
// replay, then the replay watched: it must end exactly as the game did (score, board, dots left, where Pac-Man was caught).
// Started from the title (inside a game step) and from a leaderboard's Play 1P (from a key press), the second with Rewind.
//   node tests/replay.e2e.mjs
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startDev } from "../tools/dev-server.mjs";

const blobsDir = mkdtempSync(join(tmpdir(), "booze-replay-e2e-"));
const dev = await startDev({ port: 0, blobsDir, password: "pw", quiet: true });
let failed = false;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) { failed = true; process.exitCode = 1; } };

const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const errs = [];
  async function roundTrip(label, cfg, start, pressAt, viewerPro = true) {
    const ctx = await b.newContext({ viewport: { width: 672, height: 864 } });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.addInitScript((c) => { localStorage.setItem("booze-elroy-options", JSON.stringify(c)); }, { crtEffect: false, proMode: true, startingLives: 1, ...cfg });
    const lives = cfg.startingLives || 1;
    await p.goto(dev.url + "/"); await p.waitForTimeout(1200);
    await start(p);
    await p.waitForFunction(() => window.__core.g.mode === "normal", null, { timeout: 15000 });
    // play: steer round and round, an ability press now and then, until caught (one life)
    const keys = ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"];
    let held = null;
    for (let t = 0; t < 90 * lives && await p.evaluate(() => window.__core.g.scene.name === "game"); t++) {
      const k = keys[(t * 7) % 4]; if (held) await p.keyboard.up(held); await p.keyboard.down(k); held = k;
      if (pressAt(t)) await p.keyboard.press("Space");
      await p.waitForTimeout(220 + (t % 3) * 90);
    }
    if (held) await p.keyboard.up(held);
    await p.waitForFunction(() => window.__core.g.scene.name === "nameEntry", null, { timeout: 20000 });
    const played = await p.evaluate(() => window.__lastGameEnd);
    await p.evaluate((n) => { const s = window.__core.g.scene; s.entry = n; s.submit(); }, label);
    await p.waitForFunction(() => window.__core.g.scene.name === "leaderboard", null, { timeout: 15000 });
    await p.waitForTimeout(600);
    const i = await p.evaluate((n) => window.__core.g.scene.board().entries.findIndex((e) => e.name === n && e.rid), label);
    check(i >= 0, label + ": its score went up with a replay");
    await p.evaluate((pro) => { window.__core.g.config.proMode = pro; }, viewerPro); // (the viewer's own Pro Mode: a replay doesn't carry it)
    await p.keyboard.press(String(i + 1 === 10 ? 0 : i + 1)); // (its rank's number watches it)
    check(await p.waitForFunction(() => window.__replay.playing(), null, { timeout: 10000 }).then(() => true, () => false), label + ": the replay plays");
    check(await p.evaluate(() => !!window.__replay.info()), label + ": with its REPLAY label (and the EXPERIMENTAL sticker)");
    await p.keyboard.press("Space"); await p.keyboard.press("Space"); // 4x
    if (!viewerPro) check(await p.waitForFunction(() => window.__core.g.mode === "playerUp", null, { timeout: 5000 }).then(() => true, () => false), label + ": watched without Pro Mode, it shows the opening jingle the player skipped");
    await p.waitForFunction(() => !window.__replay.playing(), null, { timeout: 240000 });
    const watched = await p.evaluate(() => window.__lastGameEnd);
    check(JSON.stringify(watched) === JSON.stringify(played), label + ": the replay ends exactly as the game did " + JSON.stringify(played) + (JSON.stringify(watched) === JSON.stringify(played) ? "" : " vs " + JSON.stringify(watched)));
    check(await p.evaluate(() => window.__core.g.scene.name === "leaderboard"), label + ": and comes back to the leaderboard");
    await ctx.close();
  }
  await roundTrip("FROM THE TITLE", { ghostCount: 3, difficulty: 1, ability: 3 }, async (p) => { await p.keyboard.press("Enter"); }, (t) => t % 5 === 2);
  await roundTrip("REWOUND", { ghostCount: 3, difficulty: 1, ability: 4 }, async (p) => {
    await p.evaluate(() => window.__core.setScene("leaderboard")); await p.waitForTimeout(400); await p.keyboard.press("Enter");
  }, (t) => t === 12);
  // played with Pro Mode, three lives (deaths, READYs), watched without: the waits in between differ, the game mustn't
  await roundTrip("PRO TO NON PRO", { ghostCount: 4, ability: 1, startingLives: 3 }, async (p) => { await p.keyboard.press("Enter"); }, (t) => t % 7 === 3, false);
  // the author's secret: the olive in the title's martini (once the logo has settled) plays every replay, round and round
  {
    const ctx = await b.newContext({ viewport: { width: 672, height: 864 } });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.addInitScript(() => { localStorage.setItem("booze-elroy-options", JSON.stringify({ crtEffect: false, proMode: true })); });
    await p.goto(dev.url + "/");
    check(await p.waitForFunction(() => window.__R.creditsLinks().some((l) => l.quiet), null, { timeout: 20000 }).then(() => true, () => false), "the olive: a quiet link once the logo has settled");
    await p.evaluate(() => window.__R.creditsLinks().find((l) => l.quiet).action());
    check(await p.waitForFunction(() => window.__replay.playing(), null, { timeout: 15000 }).then(() => true, () => false), "clicking it plays a replay");
    await p.keyboard.press("Space"); await p.keyboard.press("Space");
    await p.evaluate(() => { window.__lastGameEnd = null; });
    await p.waitForFunction(() => window.__lastGameEnd, null, { timeout: 240000 });
    check(await p.waitForFunction(() => window.__replay.playing() && window.__core.g.scene.name === "game", null, { timeout: 15000 }).then(() => true, () => false), "and when it ends, the next one plays");
    await p.keyboard.press("Escape"); await p.waitForTimeout(400);
    check(await p.evaluate(() => !window.__replay.playing() && window.__core.g.scene.name === "attract"), "Esc ends the loop, back on the title");
    await ctx.close();
  }
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
} finally {
  await b.close(); await dev.stop(); rmSync(blobsDir, { recursive: true, force: true });
}
if (failed) console.log("replay e2e: FAILED");
