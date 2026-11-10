// Golden replay: runs the game core headlessly with a seeded RNG and scripted input, fingerprinting the game state every
// frame. Guards refactors of src/core.js: gameplay must stay identical frame for frame (tests/golden.test.mjs compares
// against tests/golden.json, recorded from a known-good core).
//   node tools/golden.mjs --record          re-record tests/golden.json (only when gameplay is *meant* to change)
//   node tools/golden.mjs [core.js path]    print the fingerprints for a core file
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA = JSON.parse(readFileSync(join(ROOT, "assets/data.json"), "utf8"));
export const GOLDEN = join(ROOT, "tests/golden.json");

// the configurations replayed: the default game, every ability, and options that take different code paths
export const SCENARIOS = {
  default: {},
  phase: { ability: 1 },
  boost: { ability: 2 },
  stun: { ability: 3 },
  faster: { movement: 1 },
  jetpack: { movement: 3 },
  sevenGhosts: { ghostCount: 7 },
  noGhosts: { ghostCount: 0 },
  large: { mazepack: "large" },
  plus: { plusMode: true, mazepack: "mspac" },
  blindfold: { afterDark: 4, radar: 60 },
  scatter: { scatterOption: 1, pinkyBug: false, freeGhost: true },
  hard: { difficulty: 2, startingLevel: 5, startingLives: 1 },
};
export const FRAMES = 10800; // three minutes of play per scenario
const CHECKPOINT = 600;

function mulberry32(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// own data properties of an object (functions skipped), sorted, numbers rounded so float noise in unrelated code can't hide
const plain = (o) => {
  if (o === null || typeof o !== "object") return typeof o === "number" ? Math.round(o * 1e6) / 1e6 : o;
  if (Array.isArray(o)) return o.map(plain);
  const out = {};
  for (const k of Object.keys(o).sort()) { const v = o[k]; if (typeof v !== "function") out[k] = plain(v); }
  return out;
};
function fingerprint(core) {
  const g = core.g;
  const chars = {};
  if (g.chars && g.charOrder) for (const n of g.charOrder) chars[n] = plain(g.chars[n]);
  return JSON.stringify({
    scene: g.scene && g.scene.name, mode: g.mode, mt: g.modeTimer, score: g.score, lives: g.lives, lvl: g.levelNumber,
    maze: g.currentMaze, dots: g.dots && g.dots.map((d) => d.x * 1000 + d.y), powers: g.powers && plain(g.powers),
    fr: g.frightened, mf: g.mazeFrightened, ff: g.fruitFrightened, gc: g.globalCounter, se: g.suspendElroy, st: g.starvation,
    ft: g.fruitTimer, fst: g.fruitScoreTimer, gs: g.ghostScore, rt: g.radarTimer, fd: g.fadeTimer, w: g.wakka,
    cam: plain([g.startX, g.startY, g.xDelta, g.yDelta]), level: g.level && plain({ timer: g.level.timer, chase: g.level.chase }),
    parts: plain(g.particles), state: plain(g.state), chars, fc: core.gameFc(),
  });
}

// a bot player: walks the shortest path (BFS over tiles) to the nearest dot, avoiding the tiles round dangerous ghosts and
// hunting frightened ones, so the replays clear boards, eat ghosts and use the whole game, not just wander and die
const KEYS = ["right", "down", "left", "up"]; // direction index -> input key (DELTAS order)
export function botKeyForStats(core) { return botKey(core); }
function botKey(core) {
  const g = core.g, pac = g.chars && g.chars.pac;
  if (!pac || !g.dots || !g.charOrder) return null;
  const cm = core.getCurrentMaze(), D = core.constants.DELTAS, W = cm.w, H = cm.h;
  const [px, , py] = cm.getLoc(pac);
  const danger = new Set(), prey = new Set();
  for (const n of g.charOrder) {
    const c = g.chars[n]; if (!c.target || c.dead) continue;
    const [gx, , gy] = cm.getLoc(c);
    if (c.frightened) prey.add(gx + "," + gy);
    else for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) danger.add((gx + dx) + "," + (gy + dy));
  }
  const goals = new Set(prey);
  if (!goals.size) { for (const d of g.dots) goals.add(d.x + "," + d.y); for (const d of g.powers) goals.add(d.x + "," + d.y); }
  const seen = new Map([[px + "," + py, -1]]), q = [[px, py]];
  while (q.length) {
    const [x, y] = q.shift(), first = seen.get(x + "," + y);
    if (goals.has(x + "," + y) && first >= 0) return KEYS[first];
    for (let d = 0; d < 4; d++) {
      const nx = ((x + D[d].x) % W + W) % W, ny = y + D[d].y, k = nx + "," + ny;
      if (ny < 0 || ny >= H || seen.has(k) || cm.isWall(nx, ny) || danger.has(k)) continue;
      seen.set(k, first < 0 ? d : first); q.push([nx, ny]);
    }
  }
  return null;
}

/** replay one scenario with a core module; returns { final, checkpoints[] } (sha1 hex) */
export function replay(createCore, overrides, frames = FRAMES) {
  const rng = mulberry32(12345), inputRng = mulberry32(777);
  let held = null, wild = 0;
  const core = createCore(DATA, { rng, isDown: (k) => k === held, noAutoplay: true });
  core.init();
  Object.assign(core.g.config, overrides);
  core.g.autoplay = false; core.g.attract = false;
  core.setScene("game");
  const DIRS = ["left", "right", "up", "down"];
  const h = createHash("sha1"), checkpoints = [];
  for (let f = 1; f <= frames; f++) {
    // the bot, with a human touch: now and then a burst of random steering, the odd moment with nothing held
    if (wild > 0) wild -= 1;
    else if (inputRng() < 0.01) { wild = 10 + Math.floor(inputRng() * 30); held = inputRng() < 0.2 ? null : DIRS[Math.floor(inputRng() * 4)]; }
    else held = botKey(core) || held;
    if (inputRng() < 0.01) core.keypressed("space");
    // game over sends the core back to the title: start another game (same seeded stream)
    if (core.g.scene.name !== "game") { core.g.autoplay = false; core.g.attract = false; core.setScene("game"); }
    core.update();
    h.update(fingerprint(core));
    if (f % CHECKPOINT === 0) checkpoints.push(createHash("sha1").update(h.copy().digest("hex")).digest("hex").slice(0, 16));
  }
  return { final: h.digest("hex"), checkpoints };
}

export function loadCore(path) {
  const require = createRequire(import.meta.url);
  const p = resolve(path);
  delete require.cache[p];
  return require(p).create;
}

export function runAll(corePath) {
  const create = loadCore(corePath);
  const out = {};
  for (const [name, cfg] of Object.entries(SCENARIOS)) out[name] = replay(create, cfg);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rec = process.argv.includes("--record");
  const path = process.argv.slice(2).find((a) => !a.startsWith("--")) || join(ROOT, "src/core.js");
  const res = runAll(path);
  if (rec) { writeFileSync(GOLDEN, JSON.stringify(res, null, 1) + "\n"); console.log("recorded", GOLDEN); }
  else for (const [n, r] of Object.entries(res)) console.log(n.padEnd(12), r.final.slice(0, 16));
}
