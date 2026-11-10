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
  check(await ev(() => window.__core.attractMenu.map((i) => i.text).join(",")) === "Play 1P,Arena,Options,Leaderboards", "main menu: Play 1P, Arena, Options, Leaderboards");
  // C cycles CRT (default) -> plain -> ratty old TV (not on the Options page), saved at once
  check(await g("g.config.crtEffect === true"), "CRT is on by default");
  await p.keyboard.press("c");
  check(await ev(() => window.__core.g.config.crtEffect === false && JSON.parse(localStorage.getItem("booze-elroy-options")).crtEffect === false), "C turns it off, and that's saved");
  await p.keyboard.press("c");
  check(await ev(() => window.__core.g.config.crtEffect === "tv" && JSON.parse(localStorage.getItem("booze-elroy-options")).crtEffect === "tv"), "C again: the ratty old TV");
  await p.keyboard.press("c");
  check(await ev(() => window.__core.g.config.crtEffect === true && JSON.parse(localStorage.getItem("booze-elroy-options")).crtEffect === true), "and once more: back to the CRT");
  check(await ev(() => !window.__core.optMenu.some((i) => i.key === "crtEffect" || i.key === "volume")), "no CRT or volume rows on the Options page");
  await p.click("#look");
  check(await ev(() => window.__core.g.config.crtEffect === false && document.getElementById("look").title.startsWith("Style: clean")), "the TV button changes the look too (for phones)");
  await p.click("#look"); await p.click("#look");
  check(await ev(() => window.__core.g.config.crtEffect === true && JSON.parse(localStorage.getItem("booze-elroy-options")).crtEffect === true), "round the three looks and back to CRT, saved");
  check(await g("g.config.volume === 8"), "the game plays at a fixed volume (8)");
  // the mute button (next to fullscreen): mutes the page, remembered; M does it too, but only during gameplay
  check(await ev(() => !document.getElementById("mute").classList.contains("muted")), "not muted to begin with");
  await p.click("#mute");
  check(await ev(() => document.getElementById("mute").classList.contains("muted") && localStorage.getItem("booze-elroy-muted") === "1"), "the mute button mutes, and that's remembered");
  await p.keyboard.press("m");
  check(await ev(() => document.getElementById("mute").classList.contains("muted")), "M on a menu does nothing (it's a letter in cheat codes)");
  await p.click("#mute");
  check(await ev(() => !document.getElementById("mute").classList.contains("muted") && localStorage.getItem("booze-elroy-muted") === "0"), "clicking again unmutes");
  // the volume slider drops down below the speaker on hover; remembered; moving it unmutes
  await p.mouse.move(600, 400);
  check(await ev(() => getComputedStyle(document.getElementById("volPanel")).display === "none"), "the volume slider is hidden at first");
  await p.hover("#mute");
  check(await ev(() => getComputedStyle(document.getElementById("volPanel")).display !== "none"), "hovering the speaker shows the volume slider");
  await p.click("#mute");
  const setVol = (v) => ev((v) => { const s = document.getElementById("volume"); s.value = String(v); s.dispatchEvent(new Event("input")); }, v);
  await setVol(30);
  check(await ev(() => localStorage.getItem("booze-elroy-volume") === "30" && localStorage.getItem("booze-elroy-muted") === "0" && !document.getElementById("mute").classList.contains("muted")), "the slider sets the volume (remembered) and unmutes");
  await setVol(0);
  check(await ev(() => document.getElementById("mute").classList.contains("muted")), "volume 0 shows as muted");
  await p.click("#mute");
  check(await ev(() => localStorage.getItem("booze-elroy-volume") === "50" && !document.getElementById("mute").classList.contains("muted")), "unmuting from volume 0 comes back at 50");
  await setVol(100);
  await p.mouse.move(600, 400);
  // cheat "xyzzy": a small frame-rate readout, off by default
  check(await ev(() => !document.getElementById("fps").classList.contains("on")), "fps readout is off by default");
  await p.keyboard.type("xyzzy"); await p.waitForTimeout(1300);
  check(await ev(() => { const e = document.getElementById("fps"); return e.classList.contains("on") && / fps$/.test(e.textContent) && window.__core.g.scene.name === "attract"; }), "typing xyzzy shows it (" + await ev(() => document.getElementById("fps").textContent) + "), still on the title");
  // test mode also skips the opening jingle: straight from the blank pregame to READY
  await ev(() => { const c = window.__core; c.g.autoplay = false; c.g.attract = false; c.setScene("game"); });
  check(await until("g.mode === 'ready'", 3000) && await g("!g.sounds.opening.isPlaying()"), "test mode: a game skips the opening jingle");
  await p.keyboard.press("Escape"); await until("g.scene.name === 'attract'");
  await p.keyboard.type("xyzzy"); await p.waitForTimeout(400);
  check(await ev(() => !document.getElementById("fps").classList.contains("on") && localStorage.getItem("booze-elroy-fps") === "0"), "typing it again hides it");
  check(await ev(() => window.__core.optMenu.filter((i) => i.text).map((i) => i.text).join(",")) === "Restore Defaults,Share Config,Create Arena,Credits,Back", "Options: Restore Defaults, Share Config, Create Arena, Credits, Back");
  await ev(() => { const c = window.__core; c.setScene("options"); c.g.config.ghostCount = 2; c.optMenu.selectedItem = c.optMenu.findIndex((i) => i.text === "Create Arena") + 1; });
  await p.keyboard.press("Enter");
  check(await g("g.scene.name === 'nameEntry' && g.scene.mode === 'createArena' && g.scene.summary(26).join() === 'ghosts 2'"), "Options > Create Arena names an arena with the current settings");
  await p.keyboard.press("Escape");
  check(await g("g.scene.name === 'options'"), "Esc there goes back to Options");
  await ev(() => { window.__core.g.config.ghostCount = 4; });
  await ev(() => { const c = window.__core; c.setScene("options"); c.optMenu.selectedItem = c.optMenu.findIndex((i) => i.text === "Credits") + 1; });
  await p.keyboard.press("Enter");
  check(await g("g.scene.name === 'credits'"), "Options > Credits opens the credits");
  await p.keyboard.press("Escape");
  check(await g("g.scene.name === 'options' && window.__core.optMenu[window.__core.optMenu.selectedItem - 1].text === 'Credits'"), "Esc from those credits goes back to Options");
  await ev(() => window.__core.setScene("attract"));
  await p.waitForTimeout(300);
  await p.mouse.click(336, 822); // "web edition", bottom row (3x scale, inside the bezel)
  check(await g("g.scene.name === 'credits'"), "clicking WEB EDITION on the title opens the credits");
  await p.keyboard.press("Escape");
  check(await g("g.scene.name === 'attract'"), "and Esc goes back to the title");

  for (let i = 0; i < 3; i++) await p.keyboard.press("ArrowDown");
  await p.keyboard.press("Enter");
  check(await until("g.scene.name === 'leaderboard' && g.scene.board().entries.length === 1"), "leaderboard page lists the board");
  check(await ev(() => window.__core.g.scene.menu.map((i) => i.text).join(",")) === "Play 1P,Share Config,Back", "leaderboard page has Play 1P, Share Config and Back");
  await p.keyboard.press("ArrowDown"); await p.keyboard.press("Enter"); await p.waitForTimeout(200);
  check(await g("g.scene.name === 'leaderboard' && !!g.toast"), "Share Config on the leaderboard copies (or tries to)");
  await p.keyboard.press("ArrowDown");
  check(await ev(() => { const m = window.__core.g.scene.menu; return m[m.selectedItem - 1].text; }) === "Back", "down moves to Back");
  await ev(() => { window.__w = []; for (const n of ["wakka1", "wakka2"]) { const snd = window.__core.g.sounds[n], play = snd.play.bind(snd); snd.play = () => { window.__w.push(n); play(); }; } });
  await p.keyboard.press("ArrowUp"); await p.keyboard.press("ArrowDown");
  check(await ev(() => window.__w.length === 2 && window.__w[0] !== window.__w[1]), "menu moves alternate the two wakkas: " + await ev(() => window.__w.join()));
  await p.waitForTimeout(300); await shot("2-leaderboard");
  // other boards with scores: left / right flip through them (current settings first), Share Config shares the one on show
  await api("", { board: "mspac.0.f.f.f.3.1.f.0.4.t.f.f", name: "beefart", score: 900 });
  await ev(() => window.__core.setScene("leaderboard"));
  check(await until("g.scene.subtitle() === 'prev    1/2     next'"), "Leaderboards: board 1 of 2 (current settings first)");
  await p.keyboard.press("ArrowRight");
  check(await until("g.scene.key === 'mspac.0.f.f.f.3.1.f.0.4.t.f.f' && g.scene.board().entries[0]?.name === 'BEEFART' && g.highScoreName === 'BEEFART'"), "right flips to the other board (header follows)");
  check(await g("g.scene.summary(26).join(' ')") === "maze mspac-4", "its settings are summarised");
  await shot("2b-leaderboard-other");
  await p.keyboard.press("ArrowRight");
  check(await g("g.scene.key === 'pac.0.f.f.f.3.1.f.0.4.t.f.f'"), "and wraps round");
  await p.mouse.click(4 * 24 + 30, 4 * 24 + 12); // "prev" (3x scale)
  check(await g("g.scene.key === 'mspac.0.f.f.f.3.1.f.0.4.t.f.f'"), "clicking prev flips too");
  check(await g("g.config.mazepack === 'pac'"), "flipping doesn't change the player's settings");
  await p.keyboard.press("Escape");
  check(await until("g.scene.name === 'attract'"), "Esc returns to the title");

  // PLAY 1P on the Leaderboards page: a game with the board's settings (own starting level), for that game only
  const MSPAC = "mspac.0.f.f.f.3.1.f.0.4.t.f.f";
  await ev(() => { const c = window.__core; c.g.config.startingLevel = 3; c.setScene("leaderboard"); });
  await p.keyboard.press("ArrowRight");
  check(await until(`g.scene.key === '${MSPAC}'`), "on the mspac board");
  check(await ev(() => { const m = window.__core.g.scene.menu; return m[m.selectedItem - 1].text; }) === "Play 1P", "PLAY 1P is selected first");
  await p.keyboard.press("Enter");
  check(await until("g.scene.name === 'game' && g.mode === 'normal' && g.config.mazepack === 'mspac' && g.config.startingLevel === 3", 12000), "PLAY 1P: a game with that board's settings, own starting level");
  await p.keyboard.press("c"); // CRT toggled while the settings are borrowed: kept and saved as the player's own
  await p.keyboard.press("Escape");
  check(await until(`g.scene.name === 'leaderboard' && g.scene.key === '${MSPAC}' && g.config.mazepack === 'mspac'`), "Esc mid-game: back on that board");
  check(await ev(() => { const s = JSON.parse(localStorage.getItem("booze-elroy-options") || "null"); return !s || s.mazepack !== "mspac"; }), "the borrowed settings are never saved");
  await p.keyboard.press("Enter");
  check(await until("g.scene.name === 'game' && g.mode === 'normal'", 12000), "PLAY 1P again");
  await ev(() => { const c = window.__core; c.g.score = 0; c.mode.setMode("gameover"); });
  check(await until(`g.scene.name === 'leaderboard' && g.scene.key === '${MSPAC}'`, 12000), "a game over that doesn't place comes back to the board");
  await ev(() => { window.__core.g.scene.menu.selectedItem = 1; }); await p.keyboard.press("Enter");
  check(await until("g.scene.name === 'game' && g.mode === 'normal'", 12000), "and once more");
  await ev(() => { const c = window.__core; c.g.score = 1000; c.mode.setMode("gameover"); });
  check(await until("g.scene.name === 'nameEntry' && g.scene.place === 1", 12000), "a placing score asks for a name");
  await ev(() => { window.__core.g.scene.entry = "BORROWER"; window.__core.g.scene.submit(); });
  check(await until(`g.scene.name === 'leaderboard' && g.scene.key === '${MSPAC}' && g.scene.highlight === 1`), "and lands on that board, highlighted");
  check((await api("?board=" + MSPAC)).entries[0].name === "BORROWER", "server: the score went on the mspac board");
  await p.keyboard.press("Escape");
  check(await until("g.scene.name === 'attract' && g.config.mazepack === 'pac' && g.config.startingLevel === 3"), "leaving the leaderboard gives the player's own settings back");
  check(await ev(() => { const s = JSON.parse(localStorage.getItem("booze-elroy-options")); return window.__core.g.config.crtEffect === false && s.crtEffect === false && s.mazepack === "pac"; }), "except the CRT toggled with C meanwhile, which stays (and was saved with the own settings)");
  await ev(() => { window.__core.g.config.crtEffect = true; });
  await ev(() => { window.__core.g.config.startingLevel = 1; localStorage.removeItem("booze-elroy-name"); }); // name entry below starts blank

  // Restore Defaults: gameplay options reset, Audio/Video ones stay
  await ev(() => { const c = window.__core; c.setScene("options"); Object.assign(c.g.config, { ghostCount: 2, crtEffect: false, volume: 9, background: "stars", mazeColor: 5 }); c.optMenu.find((i) => i.text === "Restore Defaults").action(); });
  check(await g("g.config.ghostCount === 4 && g.config.crtEffect === false && g.config.volume === 9 && g.config.background === 'stars' && g.config.mazeColor === 5"), "Restore Defaults keeps the Audio/Video settings");
  await ev(() => { const c = window.__core; Object.assign(c.g.config, { crtEffect: true, volume: 4, background: "none", mazeColor: 99 }); c.setScene("attract"); });

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

  // Reset High Scores: cheat "reset" on a menu screen -> password dialog
  check(await ev(() => !window.__core.optMenu.some((i) => /reset/i.test(i.text || ""))), "Options has no reset item");
  await ev(() => window.__core.setScene("options"));
  await p.keyboard.type("reset");
  check(await p.isVisible("#reset") && await ev(() => document.querySelector("#reset h2").textContent === "RESET HIGH SCORES"), "typing reset asks for the password");
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
    await q.evaluate(() => { const c = window.__core; c.setScene("options"); c.optMenu.selectedItem = c.optMenu.findIndex((i) => i.text === "Share Config") + 1; });
    await q.keyboard.press("Enter");
    await q.waitForTimeout(200);
    check(await q.evaluate(() => window.__core.g.toast && window.__core.g.toast.text) === "link copied to clipboard", "Share Config (Options) shows the popup");
    if (process.env.SHOTS) await q.screenshot({ path: join(process.env.SHOTS, "6-share.png") });
    const link = await q.evaluate(() => navigator.clipboard.readText());
    const code = new URL(link).searchParams.get("cfg");
    check(link.startsWith(new URL(dev.url).origin + "/?cfg=") && /^[0-9a-z]{6}$/.test(code), "link carries a short share code: " + link);
    check(await q.evaluate((c) => window.BoozeScoreKey.keyFor(window.BoozeScoreKey.configFromCode(c)), code) === "mspac.0.f.f.60.3.1.f.0.2.t.f.f", "the code holds only the gameplay settings");
    await q.evaluate(() => { const c = window.__core; c.setScene("options"); c.optMenu.selectedItem = c.optMenu.findIndex((i) => i.text === "Share Config") + 1; window.__core.g.toast = null; });
    await q.keyboard.press("Enter"); await q.waitForTimeout(200);
    check(await q.evaluate(() => !!window.__core.g.toast), "and again");
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
    // Rewind (a value added later) shares as a 7-character code, and the server takes its boards
    const rwCode = await r.evaluate(() => window.BoozeScoreKey.shareCode({ ...window.__core.g.config, ability: 4 }));
    check(/^[0-9a-z]{7}$/.test(rwCode), "a Rewind config shares as a 7-character code: " + rwCode);
    await r.goto(dev.url + "/?cfg=" + rwCode); await r.waitForTimeout(1000);
    check(await r.evaluate(() => window.__core.g.config.ability === 4 && window.__core.g.config.ghostCount === 2), "opening it selects Rewind");
    const rwKey = await r.evaluate(() => window.BoozeScoreKey.keyFor(window.__core.g.config));
    const posted = await api("", { board: rwKey, name: "rewinder", score: 1234 });
    check(posted && posted.rank === 1 && rwKey.split(".")[7] === "4", "the server takes a Rewind board: " + rwKey);
    await ctx2.close();
  }
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
} finally {
  await b.close(); await dev.stop(); rmSync(blobsDir, { recursive: true, force: true });
}
if (failed) console.log("e2e FAILED");
