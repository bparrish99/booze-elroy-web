// Quick smoke test: loads the built page, starts a game, checks it plays without errors.
// Needs Playwright:  npm i -D playwright && npx playwright install chromium   then:  node tests/smoke.js
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
  await p.screenshot({ path: path.resolve(__dirname, "../build/smoke.png") });
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs[0] : ""));
  await b.close();
})();
