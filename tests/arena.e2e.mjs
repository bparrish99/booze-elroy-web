// End-to-end: arenas (24-hour leaderboards) in the built page against the dev server, with a fake server clock.
//   node tests/arena.e2e.mjs        (SHOTS=dir to save screenshots)
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { startDev } from "../tools/dev-server.mjs";

const HOUR = 3600 * 1000;
let clock = Date.now();
const blobsDir = mkdtempSync(join(tmpdir(), "booze-arena-e2e-"));
const dev = await startDev({ port: 0, blobsDir, password: "pw", quiet: true, now: () => clock });
const DEFAULT = "pac.0.f.f.f.3.1.f.0.4.t.f.f";
const SIX = "pac.0.f.f.f.3.1.f.0.6.t.f.f"; // default settings with 6 ghosts
const api = (path, body) => fetch(dev.url + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}).then((r) => r.json());
let failed = false;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) { failed = true; process.exitCode = 1; } };

const b = await chromium.launch({ args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await api("/api/scores", { board: DEFAULT, name: "pinback", score: 5000 });
  const ctx = await b.newContext({ viewport: { width: 672, height: 864 }, permissions: ["clipboard-read", "clipboard-write"] });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  const shot = async (n) => { if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, n + ".png") }); };
  const ev = (f, a) => p.evaluate(f, a);
  const g = (expr) => p.evaluate(`(() => { const g = window.__core.g; return ${expr}; })()`);
  const until = async (expr, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await g(expr)) return true; await p.waitForTimeout(100); } return false; };
  const choose = async (text) => { await ev((t) => { const m = window.__core.g.scene.menu; m.selectedItem = m.findIndex((i) => i.text === t) + 1; }, text); await p.keyboard.press("Enter"); };
  const gameOver = async (score) => {
    check(await until("g.scene.name === 'game' && g.mode === 'normal'", 12000), "game starts");
    await ev((s) => { const c = window.__core; c.g.score = s; c.mode.setMode("gameover"); }, score);
  };

  await p.goto(dev.url + "/"); await p.waitForTimeout(1500);
  check(await ev(() => window.__core.attractMenu.map((i) => i.text).join(",")) === "Play 1P,Arena,Options,Leaderboard", "main menu: Play 1P, Arena, Options, Leaderboard");
  await shot("a1-title");

  // the player's own settings: 6 ghosts, level 5, volume 2
  await ev(() => { const c = window.__core.g.config; c.ghostCount = 6; c.startingLevel = 5; c.volume = 2; });
  await ev(() => { window.__core.attractMenu.selectedItem = 2; });
  await p.keyboard.press("Enter");
  check(await until("g.scene.name === 'arenas' && g.scene.status() === 'ok'"), "Arena opens the arena list");
  check(await g("g.scene.decor.some((d) => d.text === 'no running arenas')"), "empty list says so");
  check(await g("g.scene.menu.map((i) => i.text).join(',') === 'Create Arena,Back'"), "list has Create Arena and Back");
  await shot("a2-empty-list");

  // create one with the current settings
  await choose("Create Arena");
  check(await g("g.scene.name === 'nameEntry' && g.scene.mode === 'createArena' && g.scene.entry === ''"), "Create Arena asks for a name (blank, no timer)");
  await p.keyboard.type("sunday cup");
  await shot("a3-create");
  await ev(() => window.__core.g.scene.submit());
  check(await until("g.scene.name === 'arena' && g.scene.title() === 'SUNDAY CUP'"), "creating opens the new arena");
  check(await g("g.scene.subtitle() === 'ends in 24h'"), "it runs for 24 hours: " + await g("g.scene.subtitle()"));
  check(await g("g.scene.summary(26).join() === 'ghosts 6'"), "it shows its settings");
  const list = await api("/api/arenas");
  check(list.arenas.length === 1 && list.arenas[0].board === SIX, "server has it, with the creator's settings");
  const id = list.arenas[0].id;
  check(await g("g.scene.menu.map((i) => i.text).join() === 'Play,Share Arena,Back'"), "arena page: Play, Share Arena, Back");
  await shot("a4-arena");

  // Share Arena: the link opens this arena's page for someone else
  await choose("Share Arena"); await p.waitForTimeout(200);
  check(await g("g.toast && g.toast.text === 'link copied to clipboard'"), "Share Arena copies a link");
  const arenaLink = await ev(() => navigator.clipboard.readText());
  check(arenaLink === new URL(dev.url).origin + "/?arena=" + id, "the link names the arena: " + arenaLink);
  {
    const other = await b.newContext({ viewport: { width: 672, height: 864 } });
    const q = await other.newPage(); q.on("pageerror", (e) => errs.push(e.message));
    await q.goto(arenaLink);
    const ok = await q.waitForFunction(() => { const g = window.__core && window.__core.g; return g && g.scene.name === "arena" && g.scene.title() === "SUNDAY CUP"; }, null, { timeout: 8000 }).then(() => true, () => false);
    check(ok, "opening the link lands on that arena's page");
    check(await q.evaluate(() => location.search === ""), "and tidies the address");
    await q.evaluate(() => { const m = window.__core.g.scene.menu; m.selectedItem = m.findIndex((i) => i.text === "Play") + 1; });
    await q.keyboard.press("Enter");
    check(await q.waitForFunction(() => { const g = window.__core.g; return g.scene.name === "game" && g.config.ghostCount === 6 && g.config.startingLevel === 1; }, null, { timeout: 8000 }).then(() => true, () => false), "and Play uses the arena's settings");
    await q.goto(dev.url + "/?arena=zzzzzzzzzz");
    check(await q.waitForFunction(() => window.__core && window.__core.g.scene.name === "arenas", null, { timeout: 8000 }).then(() => true, () => false), "an unknown arena link shows the arena list");
    await other.close();
  }

  // same name again is refused
  await p.keyboard.press("Escape");
  check(await until("g.scene.name === 'arenas'"), "Esc on an arena goes back to the list");
  await choose("Create Arena");
  await p.keyboard.type("sunday cup");
  await ev(() => window.__core.g.scene.submit());
  check(await until("g.scene.message === 'that name is taken' && !g.scene.sending"), "an open arena's name can't be reused");
  await p.keyboard.press("Escape");
  check(await until("g.scene.name === 'arenas' && g.scene.menu.some((i) => i.text === 'SUNDAY CUP')"), "the list shows the arena");
  check(await g("g.scene.decor.some((d) => d.text === '24h')"), "with its time left");
  await shot("a5-list");

  // play it with different personal settings: the arena's apply (starting level 1), then the player's come back
  await ev(() => { const c = window.__core.g.config; c.ghostCount = 3; c.startingLevel = 5; });
  await choose("SUNDAY CUP");
  check(await until("g.scene.name === 'arena'"), "picking it opens it");
  await choose("Play");
  await gameOver(6000);
  check(await g("g.config.ghostCount === 6 && g.config.startingLevel === 1 && g.config.volume === 2"), "the game used the arena's settings, level 1, own volume");
  check(await until("g.scene.name === 'nameEntry' && g.scene.arenaId"), "a placing score asks for a name");
  check(await g("g.scene.arenaName === 'SUNDAY CUP' && g.scene.place === 1"), "for the arena");
  await shot("a6-name-entry");
  await ev(() => { window.__core.g.scene.entry = "TESTER"; window.__core.g.scene.submit(); });
  check(await until("g.scene.name === 'arena' && g.scene.highlight === 1"), "back on the arena, new entry highlighted");
  check(await g("g.scene.message === 'leaderboard rank 1'"), "and it made the regular board too: " + await g("g.scene.message"));
  check(await until("g.highScore === 6000 && g.highScoreName === 'TESTER'"), "header shows the arena leader");
  check((await api("/api/arenas/board?id=" + id)).entries.map((e) => e.name).join() === "TESTER", "server: arena board");
  check((await api("/api/scores?board=" + SIX)).entries.map((e) => e.name).join() === "TESTER", "server: regular board for those settings");
  await shot("a7-arena-after");

  // a lower score that only places in the arena
  await choose("Play");
  await gameOver(100);
  check(await until("g.scene.name === 'nameEntry'"), "second score places too");
  await ev(() => { window.__core.g.scene.entry = "LOW"; window.__core.g.scene.submit(); });
  check(await until("g.scene.name === 'arena' && g.scene.highlight === 2"), "rank 2 in the arena");

  await choose("Back");
  check(await until("g.scene.name === 'arenas'"), "Back goes to the list");
  check(await g("g.config.ghostCount === 3 && g.config.startingLevel === 5"), "and the player's own settings are back");
  check(await until("g.highScore === false && !g.highScoreName"), "header is back to the regular board for those settings (empty), not the arena's");
  await ev(() => { const c = window.__core.g.config; c.ghostCount = 4; c.startingLevel = 1; });
  check(await until("g.highScore === 5000 && g.highScoreName === 'PINBACK'"), "and follows the player's settings (default board: PINBACK)");
  await ev(() => { const c = window.__core.g.config; c.ghostCount = 3; c.startingLevel = 5; });
  check(await ev(() => { const s = JSON.parse(localStorage.getItem("booze-elroy-options") || "null"); return !s || s.ghostCount !== 6; }), "arena settings were never saved as the player's");

  // quitting a game with Esc also gives the settings back
  await choose("SUNDAY CUP"); await until("g.scene.name === 'arena'");
  await choose("Play");
  check(await until("g.scene.name === 'game' && g.mode === 'normal'", 12000), "game starts");
  await p.keyboard.press("Escape");
  check(await until("g.scene.name === 'attract' && g.config.ghostCount === 3 && g.config.startingLevel === 5"), "Esc mid-game: title, own settings back");

  // 25 hours later: finished, with its winner; 49 hours: gone
  clock += 25 * HOUR;
  await ev(() => window.__core.setScene("arenas"));
  check(await until("g.scene.name === 'arenas' && g.scene.decor.some((d) => d.text === 'won by TESTER')"), "finished arena shows its winner");
  check(await g("g.scene.decor.some((d) => d.text === 'finished') && g.scene.decor.some((d) => d.text === 'no running arenas')"), "under a Finished heading");
  await shot("a8-finished");
  await choose("SUNDAY CUP");
  check(await until("g.scene.name === 'arena' && g.scene.subtitle() === 'finished' && g.scene.menu.map((i) => i.text).join() === 'Share Arena,Back'"), "a finished arena can be viewed and shared, not played");
  await p.keyboard.press("Escape");
  clock += 24 * HOUR;
  await p.keyboard.press("Escape"); await until("g.scene.name === 'attract'");
  await ev(() => window.__core.setScene("arenas"));
  check(await until("g.scene.name === 'arenas' && g.scene.status() === 'ok' && !g.scene.menu.some((i) => i.id)"), "a day after finishing it drops off");

  // many arenas: the list scrolls
  for (let i = 0; i < 14; i++) await api("/api/arenas", { name: "arena " + i, board: DEFAULT });
  await p.keyboard.press("Escape"); await until("g.scene.name === 'attract'");
  await ev(() => window.__core.setScene("arenas"));
  check(await until("g.scene.name === 'arenas' && g.scene.menu.filter((i) => i.id).length === 14"), "fourteen arenas listed");
  check(await g("g.scene.menu.filter((i) => i.id && i.y > 0).length < 14 && g.scene.decor.some((d) => d.text === 'more')"), "not all fit: 'more' shows");
  for (let i = 0; i < 20 && (await g("g.scene.menu[g.scene.menu.selectedItem - 1].text")) !== "ARENA 13"; i++) { await p.keyboard.press("ArrowDown"); await p.waitForTimeout(60); }
  check(await g("(() => { const m = g.scene.menu, it = m[m.selectedItem - 1]; return it.text === 'ARENA 13' && it.y >= 6 && it.y <= 29; })()"), "moving down scrolls the selection into view");
  await shot("a9-scrolled");

  // admin cheat: typing "delete" on an arena's page asks for the password and removes it
  await ev(() => window.__core.setScene("arenas"));
  await until("g.scene.name === 'arenas' && g.scene.menu.some((i) => i.text === 'ARENA 5')");
  await choose("ARENA 5"); await until("g.scene.name === 'arena'");
  await p.keyboard.type("delete");
  check(await p.isVisible("#reset") && await ev(() => document.querySelector("#reset h2").textContent === "DELETE ARENA" && document.querySelector("#reset .what").textContent === "ARENA 5"), "delete opens the password dialog for that arena");
  await p.fill("#reset input[name=password]", "wrong");
  await p.press("#reset input[name=password]", "Enter");
  await p.waitForFunction(() => document.querySelector("#reset .msg").textContent === "Wrong password.", null, { timeout: 5000 }).then(() => check(true, "wrong password refused"), () => check(false, "wrong password refused"));
  await p.fill("#reset input[name=password]", "pw");
  await p.press("#reset input[name=password]", "Enter");
  check(await until("g.scene.name === 'arenas' && !g.scene.menu.some((i) => i.text === 'ARENA 5')"), "right password deletes it and returns to the list");
  check(!(await api("/api/arenas")).arenas.some((a) => a.name === "ARENA 5"), "gone on the server too");
  await p.waitForFunction(() => !document.querySelector("#reset").open, null, { timeout: 3000 }).catch(() => {});

  // cheat: typing "mina" on a menu screen plays the intermission 3 film; any key returns
  await ev(() => window.__core.setScene("options"));
  await p.keyboard.type("mina");
  check(await until("g.scene.name === 'mina'"), "typing mina on a menu screen starts the film");
  await p.waitForTimeout(300);
  await p.keyboard.press("Escape");
  check(await until("g.scene.name === 'options'"), "and Esc returns to where it was typed");

  check((await api("/api/scores?board=" + DEFAULT)).entries.map((e) => e.name + e.score).join() === "PINBACK5000", "the regular board for the default settings is untouched");
  check(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
} finally {
  await b.close(); await dev.stop(); rmSync(blobsDir, { recursive: true, force: true });
}
if (failed) console.log("arena e2e FAILED");
