// Quick smoke test: loads the built page, starts a game, checks it plays without errors.
// Needs Playwright:  npm install && npx playwright install chromium   then:  npm test
const { chromium } = require("playwright"); const path = require("path");
(async () => {
  const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
  const p = await b.newPage({ viewport: { width: 672, height: 864 } });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("file://" + path.resolve(__dirname, "../public/index.html")); await p.waitForTimeout(1500);
  const scene = () => p.evaluate(() => window.__core.g.scene.name);
  const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) process.exitCode = 1; };
  check((await scene()) === "attract", "title screen loads");
  await p.keyboard.press("Enter"); await p.waitForTimeout(500);
  await p.keyboard.press("Enter"); await p.waitForTimeout(500);
  await p.waitForTimeout(6000); await p.keyboard.down("ArrowLeft"); await p.waitForTimeout(3000);
  check((await scene()) === "game", "game starts");
  check(await p.evaluate(() => window.__core.g.score >= 0), "score tracked");
  // the Rewind ability: the ability button plays the last moments back, then play goes on (once per life)
  await p.evaluate(() => { window.__core.g.config.ability = 4; });
  await p.keyboard.up("ArrowLeft"); await p.keyboard.down("ArrowUp"); await p.waitForTimeout(1500);
  if (await p.evaluate(() => window.__core.g.mode === "normal")) {
    await p.keyboard.press("Space"); await p.waitForTimeout(100);
    check(await p.evaluate(() => window.__core.g.rewinding && window.__core.g.rewindSpent), "Rewind plays back");
    await p.waitForFunction(() => !window.__core.g.rewinding, null, { timeout: 8000 }).catch(() => {});
    check(await p.evaluate(() => !window.__core.g.rewinding && window.__core.g.rewindSpent && window.__core.g.scene.name === "game"), "and play goes on, the charge spent");
  } else console.log("SKIP rewind check (not in normal play at that moment)");
  await p.screenshot({ path: path.resolve(__dirname, "../build/smoke.png") });
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close();
})();
