// End-to-end: accounts (the corner where 2UP would be, the account dialog) in the built page against the dev server.
//   node tests/account.e2e.mjs        (SHOTS=dir to save screenshots)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startDev } from "../tools/dev-server.mjs";

const blobsDir = mkdtempSync(join(tmpdir(), "booze-account-e2e-"));
let clock = Date.now(); // the server's clock (arenas close after 24 hours)
const dev = await startDev({ port: 0, blobsDir, quiet: true, failDelay: 0, now: () => clock });
let failed = false;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) { failed = true; process.exitCode = 1; } };

const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  const ctx = await b.newContext({ viewport: { width: 672, height: 864 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const shot = async (n) => { if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, n + ".png") }); };
  await p.goto(dev.url + "/"); await p.waitForTimeout(1500);
  // plain look, so a game pixel maps straight onto the canvas
  await p.evaluate(() => { window.__core.g.config.crtEffect = false; window.dispatchEvent(new Event("resize")); });
  await p.waitForTimeout(300);
  const clickGame = async (x, y) => {
    const r = await p.evaluate(() => { const c = document.getElementById("screen").getBoundingClientRect(); return { x: c.left, y: c.top, w: c.width, h: c.height }; });
    await p.mouse.click(r.x + x / 224 * r.w, r.y + y / 288 * r.h);
  };
  const corner = () => clickGame(200, 4);
  const box = () => p.evaluate(() => { const B = window.__R && window.__R.accountBox(); return B ? B.name : undefined; });

  await shot("acc1-title");
  await corner();
  check(await p.evaluate(() => document.getElementById("account").open), "clicking LOGIN in the corner opens the dialog");
  check(await p.locator("#account h2").textContent() === "LOG IN", "it starts on Log in");
  await p.click("#account .switch a");
  check(await p.locator("#account h2").textContent() === "CREATE ACCOUNT", "Create an account switches it");
  // typing in the dialog is just typing: F (fullscreen), C (look), letters of cheat codes do nothing else
  const look0 = await p.evaluate(() => window.__core.g.config.crtEffect);
  await p.click("#account input[name=name]");
  await p.keyboard.type("fcfc xyzzy reset");
  check(await p.inputValue("#account input[name=name]") === "fcfc xyzzy reset" && await p.evaluate(() => !document.fullscreenElement && document.getElementById("account").open && document.getElementById("reset").open === false)
    && await p.evaluate(() => window.__core.g.config.crtEffect) === look0, "typing F / C / cheat codes in the form doesn't trigger hotkeys");
  await p.fill("#account input[name=name]", "pinback");
  await p.fill("#account input[name=password]", "secret1");
  await p.fill("#account input[name=password2]", "secret2");
  await p.click("#account button.go");
  check((await p.locator("#account .msg").textContent()).includes("match"), "mismatched passwords are caught");
  await p.fill("#account input[name=password2]", "secret1");
  await shot("acc2-signup");
  await p.click("#account button.go");
  await p.waitForFunction(() => !document.getElementById("account").open);
  check(await p.evaluate(() => JSON.parse(localStorage.getItem("booze-elroy-account")).name) === "PINBACK", "signed up and logged in as PINBACK");
  await p.waitForTimeout(200);
  check(await box() === "PINBACK", "the corner shows the name");
  await shot("acc3-logged-in");

  // still logged in after a reload (the saved token checks out)
  await p.reload(); await p.waitForTimeout(1500);
  check(await box() === "PINBACK", "still logged in after a reload");

  // the same name can't be taken twice, in any case
  const taken = await p.evaluate(() => fetch("/api/account/signup", { method: "POST", body: JSON.stringify({ name: "PinBack", password: "xxxx" }) }).then((r) => r.status));
  check(taken === 409, "the name is taken (case doesn't matter)");

  // play a game to the end: "played a game"
  await p.evaluate(() => { window.__core.g.config.crtEffect = false; window.dispatchEvent(new Event("resize")); });
  await p.waitForTimeout(300);
  // in Haunted, Sonar: Terror, Jetpack (set on the title, so that board loads as it would after Options)
  await p.evaluate(() => { const c = window.__core.g.config; c.afterDark = 4; c.radar = 120; c.movement = 3; });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const m = window.__core.g.scene.menu || window.__core.attractMenu; m.selectedItem = m.findIndex((i) => i.text === "Play 1P") + 1; });
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.__core.g.scene.name === "game" && window.__core.g.mode === "normal", null, { timeout: 15000 });
  await p.evaluate(() => { const c = window.__core; c.g.score = 9990; c.mode.setMode("gameover"); });
  await p.waitForFunction(() => window.__core.g.scene.name === "leaderboard", null, { timeout: 15000 });
  check(await p.evaluate(() => window.__core.g.toast && window.__core.g.toast.text) === "achievements unlocked\nspent a quarter\ntrailblazer", "game over: achievements unlocked, named (9,990 in Haunted / Terror / Jetpack: not yet)");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  // the same modes plus Plus Mode, with Rewind: be kind (its popup waits for play to stop), then 10,000 points
  await p.evaluate(() => { const c = window.__core.g.config; c.plusMode = true; c.ability = 4; c.startingLives = 1; });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const c = window.__core; c.g.toast = null; const m = c.attractMenu; m.selectedItem = m.findIndex((i) => i.text === "Play 1P") + 1; });
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.__core.g.scene.name === "game" && window.__core.g.mode === "normal", null, { timeout: 15000 });
  await p.waitForTimeout(1000); // some history to rewind
  await p.keyboard.press("Space");
  await p.waitForTimeout(200);
  check(await p.evaluate(() => window.__core.g.rewinding && !window.__core.g.toast), "Rewind in a game: no popup on the maze while it plays");
  await p.waitForFunction(() => !window.__core.g.rewinding, null, { timeout: 5000 }); // a rewind restores everything, game over included
  await p.evaluate(() => { const c = window.__core; c.g.score = 10000; c.mode.setMode("gameover"); });
  await p.waitForTimeout(200);
  check(await p.evaluate(() => window.__core.g.toast && window.__core.g.toast.text) === "achievement unlocked\nbe kind", "play stopped (game over): now the be kind popup");
  await p.waitForFunction(() => window.__core.g.scene.name === "leaderboard", null, { timeout: 15000 });
  check(await p.evaluate(() => window.__core.g.toast && window.__core.g.toast.text) === "achievements unlocked\nhouse of horrors\nhouse of terrors\nrocketman\ncoke and a smile\nyolo\nclyde",
    "10,000 in Haunted / Terror / Jetpack / Plus Mode / 1 life: house of horrors, house of terror, rocketman, coke and a smile, yolo (and clyde)");
  await shot("acc8-many");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);
  await p.evaluate(() => { const c = window.__core.g; for (const k of ["afterDark", "radar", "movement", "plusMode", "ability", "startingLives"]) c.config[k] = c.defaultConfig[k]; c.toast = null; });
  // the credits: pay respects; clicking "what is seeing this?" there: time to wake up (secret)
  await p.evaluate(() => window.__core.setScene("credits"));
  await p.waitForTimeout(200);
  const popup = p.context().waitForEvent("page").catch(() => null);
  await clickGame(112, 274);
  const pg = await popup; if (pg) await pg.close();
  check(await p.evaluate(() => window.__core.g.toast && window.__core.g.toast.text) === "achievements unlocked\npay respects\ntime to wake up", "credits: pay respects; the marquee link: time to wake up");
  await p.evaluate(() => { window.__core.setScene("attract"); window.__core.g.toast = null; });
  // starting a game with zero ghosts: walk in the park (at the start)
  await p.evaluate(() => { const c = window.__core; c.g.config.ghostCount = 0; const m = c.attractMenu; m.selectedItem = m.findIndex((i) => i.text === "Play 1P") + 1; });
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.__core.g.scene.name === "game", null, { timeout: 15000 });
  await p.waitForTimeout(300);
  check(await p.evaluate(() => window.__core.g.toast && window.__core.g.toast.text) === "achievement unlocked\nwalk in the park", "a zero-ghost game: walk in the park, as it starts");
  // past board 2 with every life: without a scratch; then a life lost: no "2" past board 5
  await p.waitForFunction(() => window.__core.g.mode === "normal", null, { timeout: 15000 });
  await p.evaluate(() => { const g = window.__core.g; g.toast = null; g.levelNumber = 3; });
  await p.waitForTimeout(200);
  check(await p.evaluate(() => !window.__core.g.toast), "past board 2 without losing a life: without a scratch, its popup held while play goes on");
  await p.evaluate(() => { const g = window.__core.g; g.toast = null; g.lives -= 1; });
  await p.waitForTimeout(100);
  await p.evaluate(() => { window.__core.g.levelNumber = 6; });
  await p.waitForTimeout(200);
  check(await p.evaluate(() => !window.__core.g.toast), "a life lost: no without a scratch 2 past board 5");
  await p.evaluate(() => window.__core.mode.setMode("intermission3"));
  await p.waitForTimeout(300);
  check(await p.evaluate(() => window.__core.g.toast && window.__core.g.toast.text) === "achievements unlocked\ndedication\nwithout a scratch", "intermission 3 in a game: dedication; play stopped, so the held without a scratch shows too");
  await p.keyboard.press("Escape");
  await p.waitForFunction(() => window.__core.g.scene.name === "attract", null, { timeout: 15000 });
  await p.evaluate(() => { const c = window.__core.g; c.config.ghostCount = c.defaultConfig.ghostCount; c.toast = null; });
  await p.waitForTimeout(500);
  check(await p.evaluate(() => fetch("/api/account/achievements", { headers: { authorization: "Bearer " + JSON.parse(localStorage.getItem("booze-elroy-account")).token } }).then((r) => r.json()).then((d) => !!d.achievements.quarter)), "the server has it");

  // a top-10 score goes on the board under the account's name, no name entry; top of the default-settings board:
  // "billy mitchell"; a maze style of their own: "stylish" (style isn't in the board key, so it's still that board)
  await p.evaluate(() => { window.__core.g.config.mazeColor = 3; });
  await p.evaluate(() => { const m = window.__core.attractMenu; m.selectedItem = m.findIndex((i) => i.text === "Play 1P") + 1; });
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.__core.g.scene.name === "game" && window.__core.g.mode === "normal", null, { timeout: 15000 });
  await p.evaluate(() => { const c = window.__core; c.g.score = 31230; c.mode.setMode("gameover"); }); // past clyde and inky
  await p.waitForFunction(() => window.__core.g.scene.name === "leaderboard", null, { timeout: 15000 });
  const top = await p.evaluate(() => window.__core.g.scene.board().entries[0]);
  check(top && top.name === "PINBACK" && top.score === 31230, "logged in: the score went straight on the board as PINBACK");
  check(await p.evaluate(() => window.__core.g.toast && window.__core.g.toast.text) === "achievements unlocked\nstylish\ninky\nbilly mitchell", "stylish, inky (31,230), billy mitchell in one popup; no second spent a quarter, clyde or trailblazer");
  await shot("acc6-billy");
  await p.evaluate(() => { window.__core.g.config.mazeColor = 99; });
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  // creating an arena (Options > Create Arena, then a name): "party planner"
  await p.evaluate(() => { window.__core.g.toast = null; window.__core.setScene("options"); });
  await p.evaluate(() => { const m = window.__core.optMenu; m.selectedItem = m.findIndex((i) => i.text === "Create Arena") + 1; });
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.__core.g.scene.name === "nameEntry");
  await p.keyboard.type("TEST ARENA");
  await p.evaluate(() => window.__core.g.scene.submit());
  await p.waitForFunction(() => window.__core.g.scene.name === "arena", null, { timeout: 15000 });
  check(await p.evaluate(() => window.__core.g.toast && window.__core.g.toast.text) === "achievement unlocked\nparty planner", "creating an arena: party planner");

  // finishing an arena game: "up for a challenge" (and not "spent a quarter" again)
  await p.waitForFunction(() => window.__core.g.scene.menu.some((i) => i.text === "Play 1P"), null, { timeout: 15000 });
  await p.evaluate(() => { const m = window.__core.g.scene.menu; m.selectedItem = m.findIndex((i) => i.text === "Play 1P") + 1; });
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.__core.g.scene.name === "game" && window.__core.g.mode === "normal", null, { timeout: 15000 });
  await p.evaluate(() => { const c = window.__core; c.g.score = 0; c.mode.setMode("gameover"); });
  await p.waitForFunction(() => window.__core.g.scene.name === "arena", null, { timeout: 15000 });
  check(await p.evaluate(() => window.__core.g.toast && window.__core.g.toast.text) === "achievement unlocked\nwelcome to the party", "an arena game: welcome to the party");
  await shot("acc5-arena-unlock");
  await p.keyboard.press("Escape"); await p.waitForTimeout(300);

  // winning an arena: on top when it closes (and the 15-minute grace is over): chicken dinner, noticed at start-up
  const testArena = await p.evaluate(() => fetch("/api/arenas").then((r) => r.json()).then((d) => d.arenas.find((a) => a.name === "TEST ARENA").id));
  await p.evaluate((id) => fetch("/api/arenas/score", { method: "POST", body: JSON.stringify({ id, name: "PINBACK", score: 500 }) }), testArena);
  clock += 24.5 * 3600 * 1000;
  await p.goto(dev.url + "/"); await p.waitForTimeout(1500);
  check(await p.evaluate(() => window.__core.g.toast && window.__core.g.toast.text) === "achievement unlocked\nchicken dinner", "won an arena: chicken dinner (at start-up)");
  await p.evaluate(() => { window.__core.g.toast = null; });
  await p.evaluate(() => { window.__core.g.config.crtEffect = false; window.dispatchEvent(new Event("resize")); });
  await p.waitForTimeout(300);

  // clicking the name opens the profile page, which lists it; Log Out from there
  await corner();
  check(await p.evaluate(() => window.__core.g.scene.name) === "profile", "clicking the name opens the profile");
  await p.reload(); await p.waitForTimeout(1500); // a fresh page loads the achievements from the server
  await p.evaluate(() => { window.__core.g.config.crtEffect = false; window.dispatchEvent(new Event("resize")); });
  await p.waitForTimeout(300);
  await corner();
  await p.waitForTimeout(500);
  check(await p.evaluate(() => window.__core.g.scene.achievements().filter((a) => a.earned > 0).length) === 21, "the profile shows the twenty-one earned so far (booze pug: three boards)");
  { // hovering an achievement's name: its description in a popup; off it, gone
    const r = await p.evaluate(() => { const c = document.getElementById("screen").getBoundingClientRect(); return { x: c.left, y: c.top, w: c.width, h: c.height }; });
    await p.mouse.move(r.x + (3 * 8 + 20) / 224 * r.w, r.y + (8 * 8 + 4) / 288 * r.h);
    check(await p.evaluate(() => document.getElementById("tip").classList.contains("on") && document.getElementById("tip").textContent) === "Finish a game.", "hovering an achievement shows its description");
    await shot("acc7-tip");
    // the last pixel row of the first name's date line is still the first achievement; the next row is the second
    const tipAt = async (gy) => { await p.mouse.move(r.x + (3 * 8 + 20) / 224 * r.w, r.y + gy / 288 * r.h); return p.evaluate(() => document.getElementById("tip").textContent); };
    const first = await p.evaluate(() => window.__core.g.scene.pageItems()[0]), second = await p.evaluate(() => window.__core.g.scene.pageItems()[1]);
    check(await tipAt(second.y * 8 - 0.5) === first.desc && await tipAt(second.y * 8 + 0.5) === second.desc, "hover boxes switch exactly at the next row");
    await p.mouse.move(r.x + r.w / 2, r.y + 40 / 288 * r.h);
    check(await p.evaluate(() => !document.getElementById("tip").classList.contains("on")), "moving off hides it");
  }
  await shot("acc4-profile");
  { // pages: every achievement on one of them, each in rows 8-29 (earned ones take a second row for the date)
    const pages = await p.evaluate(async () => {
      const sc = window.__core.g.scene, out = [];
      const n = sc.pageLabel() ? Number(sc.pageLabel().match(/\/(\d+)/)[1]) : 1;
      for (let i = 0; i < n; i++) { sc.page = i; out.push(sc.pageItems()); }
      sc.page = 0; return out.map((pg) => pg.map((a) => ({ name: a.name, y: a.y, earned: !!a.earned })));
    });
    const all = pages.flat();
    check(all.length === 40 && all.every((a) => a.y >= 8 && a.y + (a.earned ? 1 : 0) <= 29), "every achievement fits on a page (" + pages.length + " page(s))");
    if (pages.length > 1) {
      await p.keyboard.press("ArrowRight");
      check(await p.evaluate(() => window.__core.g.scene.page) === 1, "right: the next page");
      await shot("acc4b-profile-page2");
      await clickGame(14 * 8 - 40, 6 * 8 + 4); // "prev"
      check(await p.evaluate(() => window.__core.g.scene.page) === 0, "clicking prev goes back");
    }
  }
  await p.evaluate(() => { const m = window.__core.g.scene.menu; m.selectedItem = m.findIndex((i) => i.text === "Log Out") + 1; });
  await p.keyboard.press("Enter");
  await p.waitForTimeout(200);
  check(await box() === null && await p.evaluate(() => localStorage.getItem("booze-elroy-account")) === null && await p.evaluate(() => window.__core.g.scene.name) === "attract", "Log Out: logged out, back on the title");
  await corner();
  await p.fill("#account input[name=name]", "pinback");
  await p.fill("#account input[name=password]", "nope");
  await p.click("#account button.go");
  await p.waitForFunction(() => /Wrong/.test(document.querySelector("#account .msg").textContent));
  check(true, "a wrong password is refused");
  await p.fill("#account input[name=password]", "secret1");
  await p.keyboard.press("Enter");
  await p.waitForFunction(() => !document.getElementById("account").open);
  await p.waitForTimeout(200);
  check(await box() === "PINBACK", "logged back in (Enter submits)");
  // typing in the dialog never reaches the game (no cheat codes, no menu moves)
  check(await p.evaluate(() => window.__core.g.scene.name) === "attract", "still on the title screen");

  // a token the server doesn't know logs out at start-up
  await p.evaluate(() => localStorage.setItem("booze-elroy-account", JSON.stringify({ name: "GHOST", token: "x".repeat(32) })));
  await p.reload(); await p.waitForTimeout(1500);
  check(await box() === null, "an unknown saved login is dropped");
  // the author's activity page: the password after #, else it asks
  await p.goto(dev.url + "/activity.html#nope"); await p.waitForTimeout(500);
  check(await p.evaluate(() => !document.getElementById("ask").hidden && /Wrong/.test(document.getElementById("askMsg").textContent)), "activity page: a wrong password just asks again");
  await p.goto(dev.url + "/activity.html#dev"); await p.reload(); await p.waitForTimeout(800);
  const log = await p.evaluate(() => document.getElementById("log").textContent);
  check(/PINBACK\s*created an account/.test(log) && /earned SPENT A QUARTER/.test(log) && /logged in/.test(log) && /played today/.test(log), "activity page: signups, logins, achievements (by name) and games");
  await shot("acc9-activity");
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join("; ") : ""));
} finally {
  await b.close(); await dev.stop(); rmSync(blobsDir, { recursive: true, force: true });
}
if (failed) console.log("account e2e: FAILED");
