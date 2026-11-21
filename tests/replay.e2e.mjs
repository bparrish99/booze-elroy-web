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
  async function roundTrip(label, cfg, start, pressAt, viewerPro = true, noReplay = false, viewerStyle = null, neat = false) {
    const ctx = await b.newContext({ viewport: { width: 672, height: 864 } });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.addInitScript(([c, n]) => { localStorage.setItem("booze-elroy-options", JSON.stringify(c)); if (n) localStorage.setItem("booze-elroy-neat", "1"); }, [{ crtEffect: false, proMode: true, startingLives: 1, ...cfg }, neat]);
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
    check(await p.evaluate(() => window.__core.g.scene.menu.some((i) => i.text === "save replay yes")), label + ": name entry offers \"save replay yes\"");
    if (noReplay) { // the player says no: Enter on the toggle
      await p.evaluate(() => { const m = window.__core.g.scene.menu; m.selectedItem = m.findIndex((i) => i.text === "save replay yes") + 1; });
      await p.keyboard.press("Enter");
      check(await p.evaluate(() => window.__core.g.scene.menu.some((i) => i.text === "save replay no")), label + ": toggled to no");
    }
    await p.evaluate((n) => { const s = window.__core.g.scene; s.entry = n; s.submit(); }, label);
    await p.waitForFunction(() => window.__core.g.scene.name === "leaderboard", null, { timeout: 15000 });
    await p.waitForTimeout(600);
    if (noReplay) {
      check(await p.evaluate((n) => { const e = window.__core.g.scene.board().entries.find((x) => x.name === n); return !!e && !e.rid; }, label), label + ": its score went up without one");
      await ctx.close(); return;
    }
    const i = await p.evaluate((n) => window.__core.g.scene.board().entries.findIndex((e) => e.name === n && e.rid), label);
    check(i >= 0, label + ": its score went up with a replay");
    await p.evaluate((pro) => { window.__core.g.config.proMode = pro; }, viewerPro); // (the viewer's own Pro Mode: a replay doesn't carry it)
    if (viewerStyle) await p.evaluate((st) => Object.assign(window.__core.g.config, st), viewerStyle); // (and the viewer's own looks)
    await p.evaluate(() => { window.__core.g.score = 4242; }); // (the viewer's 1UP)
    await p.keyboard.press(String(i + 1 === 10 ? 0 : i + 1)); // (its rank's number watches it)
    check(await p.waitForFunction(() => window.__replay.playing(), null, { timeout: 10000 }).then(() => true, () => false), label + ": the replay plays");
    check(await p.evaluate(() => !!window.__replay.info()), label + ": with its REPLAY label (and the EXPERIMENTAL sticker)");
    await p.keyboard.press("Space"); await p.keyboard.press("Space"); // 4x
    if (!viewerPro) check(await p.waitForFunction(() => window.__core.g.mode === "playerUp", null, { timeout: 5000 }).then(() => true, () => false), label + ": watched without Pro Mode, it shows the opening jingle the player skipped");
    await p.waitForFunction(() => !window.__replay.playing(), null, { timeout: 240000 });
    const watched = await p.evaluate(() => window.__lastGameEnd);
    check(JSON.stringify(watched) === JSON.stringify(played), label + ": the replay ends exactly as the game did " + JSON.stringify(played) + (JSON.stringify(watched) === JSON.stringify(played) ? "" : " vs " + JSON.stringify(watched)));
    check(await p.evaluate(() => window.__core.g.scene.name === "leaderboard"), label + ": and comes back to the leaderboard");
    check(await p.evaluate(() => window.__core.g.score === 4242), label + ": with the viewer's own 1UP back");
    const rid = await p.evaluate((n) => window.__core.g.scene.board().entries.find((e) => e.name === n).rid, label);
    const key = await p.evaluate(() => window.__core.g.scene.key);
    await ctx.close();
    return { rid, key, played };
  }
  const first = await roundTrip("FROM THE TITLE", { ghostCount: 3, difficulty: 1, ability: 3 }, async (p) => { await p.keyboard.press("Enter"); }, (t) => t % 5 === 2);
  // sharing (the author, 2026-11-18): the share icon on a score with a replay copies a ?replay= link; opening that link
  // plays it (with its player's name), then lands on its game's leaderboard
  {
    const ctx = await b.newContext({ viewport: { width: 672, height: 864 }, permissions: ["clipboard-read", "clipboard-write"] });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.addInitScript(() => { localStorage.setItem("booze-elroy-options", JSON.stringify({ crtEffect: false, proMode: true })); });
    await p.goto(dev.url + "/"); await p.waitForTimeout(1000);
    await p.evaluate((k) => window.__core.setScene("leaderboard", { key: k }), first.key); await p.waitForTimeout(800);
    await p.evaluate(() => window.__core.g.scene.links.find((l) => l.share).action());
    await p.waitForTimeout(300);
    const link = await p.evaluate(() => navigator.clipboard.readText());
    check(link === new URL(dev.url).origin + "/?replay=" + first.rid, "the share icon copies the replay's link: " + link);
    await p.goto(link);
    check(await p.waitForFunction(() => window.__replay && window.__replay.playing(), null, { timeout: 15000 }).then(() => true, () => false), "opening the link plays the replay");
    check(await p.evaluate(() => window.__replay.info().name) === "FROM THE TITLE", "with its player's name");
    await p.keyboard.press("Space"); await p.keyboard.press("Space");
    await p.waitForFunction(() => !window.__replay.playing(), null, { timeout: 120000 });
    check(await p.evaluate((k) => window.__core.g.scene.name === "leaderboard" && window.__core.g.scene.key === k, first.key), "then its game's leaderboard, ready to try and beat it");
    check(JSON.stringify(await p.evaluate(() => window.__lastGameEnd)) === JSON.stringify(first.played), "(and it played out the same)");
    await ctx.close();
  }
  // the author's delete (2026-11-19): logged in as PINBACK, an X by a replay's share icon takes the replay off its score
  {
    const ctx = await b.newContext({ viewport: { width: 672, height: 864 } });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.addInitScript(() => { localStorage.setItem("booze-elroy-options", JSON.stringify({ crtEffect: false, proMode: true })); window.confirm = () => true; });
    await p.goto(dev.url + "/"); await p.waitForTimeout(1000);
    await p.evaluate((k) => window.__core.setScene("leaderboard", { key: k }), first.key); await p.waitForTimeout(800);
    check(await p.evaluate(() => !window.__core.g.scene.canDelete), "logged out: no delete X");
    await p.evaluate(() => window.__acc.signup("pinback", "pass").then((r) => r.ok || window.__acc.login("pinback", "pass")));
    await p.waitForTimeout(300);
    check(await p.evaluate(() => window.__core.g.scene.canDelete), "logged in as PINBACK: the X shows");
    const n = await p.evaluate(() => window.__core.g.scene.board().entries.filter((e) => e.rid).length);
    await p.evaluate(() => window.__core.g.scene.links.find((l) => l.del).action());
    check(await p.waitForFunction((n0) => window.__core.g.scene.board().entries.filter((e) => e.rid).length === n0 - 1, n, { timeout: 5000 }).then(() => true, () => false), "using it takes the replay off");
    check(await p.evaluate((sc) => window.__core.g.scene.board().entries.some((e) => e.score === sc), first.played.score), "and the score stays");
    await ctx.close();
  }
  await roundTrip("REWOUND", { ghostCount: 3, difficulty: 1, ability: 4 }, async (p) => {
    await p.evaluate(() => window.__core.setScene("leaderboard")); await p.waitForTimeout(400); await p.keyboard.press("Enter");
  }, (t) => t === 12);
  // played with Pro Mode, three lives (deaths, READYs), watched without: the waits in between differ, the game mustn't
  await roundTrip("PRO TO NON PRO", { ghostCount: 4, ability: 1, startingLives: 3 }, async (p) => { await p.keyboard.press("Enter"); }, (t) => t % 7 === 3, false);
  // played with Random background and maze style, watched with plain ones (a phone's replay of a PC's game went its own
  // way: the Random picks drew from the game's RNG; 2026-11-18)
  await roundTrip("RANDOM LOOKS", { ghostCount: 4, ability: 2, background: "random", mazeColor: 0 }, async (p) => { await p.keyboard.press("Enter"); }, (t) => t % 6 === 1, true, false, { background: "none", mazeColor: 99 });
  // NEAT (the author's arcade-exact game, 2026-11-22): its replay says so and plays NEAT, with its player's Pro Mode, for a
  // viewer who has NEAT off (opening the shared link), without switching NEAT on for them; it stays out of the olive's loop
  {
    const neat = await roundTrip("NEAT GAME", { ghostCount: 4, startingLives: 3 }, async (p) => { await p.keyboard.press("Enter"); }, () => false, true, false, null, true);
    check(neat.key.startsWith("neat:"), "a NEAT game's score goes on its NEAT board: " + neat.key);
    const ctx = await b.newContext({ viewport: { width: 672, height: 864 } });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(e.message));
    await p.addInitScript(() => { localStorage.setItem("booze-elroy-options", JSON.stringify({ crtEffect: false, proMode: false })); });
    await p.goto(dev.url + "/?replay=" + neat.rid);
    check(await p.waitForFunction(() => window.__replay && window.__replay.playing(), null, { timeout: 15000 }).then(() => true, () => false), "a NEAT replay's shared link plays it for a viewer without NEAT");
    const st = await p.evaluate(() => ({ neat: window.__replay.neat(), on: window.__core.g.neatOn, pro: window.__core.g.config.proMode }));
    check(st.neat && st.on && st.pro === true, "as NEAT, with its player's Pro Mode " + JSON.stringify(st));
    await p.keyboard.press("Space"); await p.keyboard.press("Space");
    await p.waitForFunction(() => !window.__replay.playing(), null, { timeout: 240000 });
    check(JSON.stringify(await p.evaluate(() => window.__lastGameEnd)) === JSON.stringify(neat.played), "it ends exactly as the NEAT game did " + JSON.stringify(neat.played));
    check(await p.evaluate(() => localStorage.getItem("booze-elroy-neat") !== "1" && window.__core.g.config.proMode === false), "and the viewer is back as they were: NEAT off, their own Pro Mode");
    const loop = await (await fetch(dev.url + "/api/scores/replays")).json();
    check(!loop.replays.some((r) => r.rid === neat.rid), "NEAT replays stay out of the olive's loop");
    await ctx.close();
  }
  await roundTrip("NO THANKS", { ghostCount: 2, difficulty: 2 }, async (p) => { await p.keyboard.press("Enter"); }, () => false, true, true);
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
