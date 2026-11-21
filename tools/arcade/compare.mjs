// Side by side (dev tool, never deployed): the real Pac-Man ROM in the harness and the author's core, fed the same
// joystick, compared frame by frame (positions of Pac-Man and the four ghosts). Each life is lined up on its own (play
// frame 0 = Blinky's first step after READY), since the death animations in between needn't take the same time; the
// joystick plan is per life too.
//   node tools/arcade/compare.mjs "<life 1 plan> | <life 2 plan> | ..." [frames per life] [actors]
//   EXACT=1 ... (the core with NEAT's switch on), CORE=path (another core.js), LEVEL=n (both games start at level n: the
//   core by its starting level, the ROM by its RAM as the game is set up), HARD=1 (both on Hard: the arcade's DIP switch)
// a plan: "left:60,up:40,..." (a direction held that many frames; the last holds; "-" = nothing)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProgram, PacmanMachine } from "./pacman-machine.mjs";
import { loadCore, botKeyForStats } from "../golden.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA = JSON.parse(readFileSync(join(ROOT, "assets/data.json"), "utf8"));

export const ACTORS = ["blinky", "pinky", "inky", "clyde", "pac"];
const POS = { blinky: 0x4d00, pinky: 0x4d02, inky: 0x4d04, clyde: 0x4d06, pac: 0x4d08 };
const DIR = { blinky: 0x4d2c, pinky: 0x4d2d, inky: 0x4d2e, clyde: 0x4d2f, pac: 0x4d30 };

/** "a | b | c": a plan per life -> joy(life, frame) */
export function plans(script) {
  const lives = script.split("|").map((p) => p.trim().split(",").filter(Boolean).map((s) => { const [d, n] = s.split(":"); return [d, +n || 1]; }));
  return (life, k) => {
    const steps = lives[Math.min(life, lives.length - 1)];
    let t = k;
    for (const [d, n] of steps) { if (t < n) return d === "-" ? null : d; t -= n; }
    const last = steps[steps.length - 1][0]; return last === "-" ? null : last;
  };
}

/** the arcade: [life][frame] = { pac: {x, y, dir}, ..., dots } from Blinky's first step, in arcade coordinates */
export function arcadeTrace(joy, frames, { game = "pacman", lives = 3, maxFrames = 40000, dips = {}, level = 1, onMachine = null } = {}) {
  const m = new PacmanMachine(loadProgram(game), dips);
  if (onMachine) onMachine(m); // (a look inside, for digging: the machine before it runs)
  const coinAt = game === "pacplus" ? 800 : 300;
  const pat = (base) => { const b = [0, 1, 2, 3].map((i) => m.peek(base + i)); return (((b[1] << 24) | (b[0] << 16) | (b[3] << 8) | b[2]) >>> 0).toString(16).padStart(8, "0"); };
  const snap = () => { const o = { tdbg: `rnd ${m.peek(0x4c8b)} en ${m.peek(0x4da6)} pause ${m.peek(0x4d9d)} eaten ${m.peek(0x4e0e)} 4dbd ${m.peek(0x4dbd)}`, cdbg: `tun ${m.peek(0x4d9c)} blue ${m.peek(0x4daa)} cpat ${pat(0x4d7e)}/${pat(0x4d82)}/${pat(0x4d86)} en ${m.peek(0x4da6)}`, ppat: pat(0x4d62) + "/" + pat(0x4d66) + "/" + pat(0x4d6a), fp: m.peek(0x4dd2) !== 0, fruit: [0x4dd2, 0x4dd3, 0x4dd4].map((x) => m.peek(x)).join(","), rs: m.peek(0x4dc9) | (m.peek(0x4dca) << 8), tiles: Array.from({ length: 10 }, (_, i) => m.peek(0x4d31 + i)).join(","), dots: m.peek(0x4e0e), bpat: pat(0x4d56) + "/" + pat(0x4d5a), epat: pat(0x4d4e) + "/" + pat(0x4d52) + " tun " + pat(0x4d5e), crel: [0x4da0, 0x4da1, 0x4da2, 0x4da3, 0x4db6, 0x4db7].map((x) => m.peek(x)).join(","), gc: m.peek(0x4e0f) + "," + m.peek(0x4e10) + "," + m.peek(0x4e11) + " g" + m.peek(0x4e12) + " gcount " + m.peek(0x4d9f), eat: m.peek(0x4da4), div: m.peek(0x4c86) & 0x0f, tn: m.peek(0x4c86) >> 4, rnd: m.peek(0x4c8b), fc: m.peek(0x4c84), ptun: pat(0x4d6a), ptile: m.peek(0x4d35) + "," + m.peek(0x4d34), house: m.peek(0x4d94), pc: [0x4e0f, 0x4e10, 0x4e11, 0x4e12].map((a) => m.peek(a)).join(","), level: m.peek(0x4e13), mt: m.peek(0x4dc2) | (m.peek(0x4dc3) << 8), fr: m.peek(0x4dcb) | (m.peek(0x4dcc) << 8), starv: m.peek(0x4d97), score: [0x4e82, 0x4e81, 0x4e80].map((a) => m.peek(a).toString(16).padStart(2, "0")).join("") * 1 }; for (const a of ACTORS) o[a] = { y: m.peek(POS[a]), x: m.peek(POS[a] + 1), dir: m.peek(DIR[a]) }; return o; };
  let f = 0;
  for (; f < coinAt + 140; f++) {
    if (f === coinAt) m.setInputs({ coin: true }); else if (f === coinAt + 6) m.setInputs({}); else if (f === coinAt + 100) { m.startLevel(level); m.setInputs({ start: true }); } else if (f === coinAt + 106) m.setInputs({});
    m.runFrame();
  }
  const out = [];
  let cur = null, prev = snap(), life = -1, ready = false, pacFirst = null; const recent = [];
  const atStart = (s) => s.pac.x === 128 && s.pac.y === 196 && s.blinky.x === 128 && s.blinky.y === 100;
  for (; f < maxFrames; f++) {
    // the stick: this life's plan once it's going; before that (READY) the next life's first move, held early as a player would
    m.setInputs({ joy: cur ? joy(life, cur.length) : joy(life + 1, 0) });
    m.runFrame();
    const s = snap();
    recent.push(s); if (recent.length > 6) recent.shift();
    if (!cur) {
      if (atStart(s)) { ready = true; pacFirst = null; m.startLevel(1); } // (the starting level set: later boards count on from it)
      // (the counters on the frame Pac-Man first steps: the anchor the core's are set from, in the harness)
      if (ready && !pacFirst && (s.pac.x !== 128 || s.pac.y !== 196)) pacFirst = { div: s.div, fc: s.fc, tn: s.tn, rnd: s.rnd };
      if (ready && atStart(prev) && s.blinky.x !== prev.blinky.x) { ready = false; life++; if (life >= lives) break; cur = [s]; cur.sync = pacFirst; cur.pre = recent.slice(0, -1); out.push(cur); }
    } else {
      // (from level 2 Pac-Man's pattern can have him step after Blinky: the anchor is his first step all the same)
      if (!cur.sync && (s.pac.x !== 128 || s.pac.y !== 196)) cur.sync = { div: s.div, fc: s.fc, tn: s.tn, rnd: s.rnd };
      cur.push(s);
      if (cur.length >= frames || (s.pac.x === 0 && s.pac.y === 0)) cur = null; // (enough, or died: the sprites hidden)
    }
    prev = s;
  }
  return out;
}

/** the author's core the same way: [life][frame] from Blinky's first step after READY */
// (bot: the golden test's pathfinding bot plays instead of a plan, its stick recorded per life in bot.rec, to replay into
// the arcade: the same inputs, so the same game if the two match)
// (divAt: the arcade's divider and frame counter just after each life's first Pac-Man step, so the core's timed tasks and house
// bob line up with the ROM's: set just after the core's update in which he first steps, found as it runs (an update count from
// an earlier run went wrong: syncing a life changes its eat pauses, so the later lives start at other counts); test only)
export function coreTrace(joy, frames, { cfg = {}, lives = 3, maxFrames = 40000, bot = null, divAt = null } = {}) {
  const create = loadCore(process.env.CORE || join(ROOT, "src/core.js"));
  let held = null, s = 1;
  const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  // (EXACT=1: NEAT's switch; and the arcade's own generator for frightened ghosts' first pick, from the player's ROM: local only)
  const rom = process.env.EXACT ? loadProgram(process.env.GAME || "pacman") : null;
  let seed = 0;
  const frightPick = () => { seed = (seed * 5 + 1) & 0x1fff; return rom[seed]; };
  const core = create(DATA, { rng, isDown: (k) => k === held, exact: () => !!process.env.EXACT, frightPick: rom ? frightPick : undefined, frightReset: () => { seed = 0; } });
  core.init(); Object.assign(core.g.config, cfg);
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  const g = core.g;
  // the core's coordinates -> the arcade's (the screen is rotated on the board: x runs right to left)
  const base = { x: 128 + 112, y: 196 - 188 };
  const snap = () => {
    const P = g.exactPat && g.exactPat.blinky, h = (v) => v.toString(16).padStart(8, "0");
    const pk = g.chars.pinky, cmz = core.getCurrentMaze ? core.getCurrentMaze() : null;
    const bl = g.chars.blinky, cm = core.getCurrentMaze ? core.getCurrentMaze() : null;
    const o = { tdbg: `off ${g.exactTunnelOff} clr ${g.exactTunnelClearAt} back ${g.exactTunnelBackAt} clock ${g.exactClock} maze ${g.mazeFrightened} ff ${g.fruitFrightened} rnd ${g.exactRnd}`, cdbg: g.chars.clyde && g.exactPat && g.exactPat.clyde ? `spd ${g.chars.clyde.speed} fr ${g.chars.clyde.frightened} cpat ${["ghost", "ghostFright", "tunnel"].map((k) => g.exactPat.clyde[k].toString(16).padStart(8, "0")).join("/")}` : "", ppat: g.exactPat && g.exactPat.pinky ? ["ghost", "ghostFright", "tunnel"].map((k) => g.exactPat.pinky[k].toString(16).padStart(8, "0")).join("/") + " spd " + (g.chars.pinky && g.chars.pinky.speed) : "", fp: !!g.fruitTimer, fruit: `t ${g.fruitTimer} st ${g.fruitScoreTimer}`, rs: seed, bdbg: bl && cm ? `fr ${bl.frightened} dead ${bl.dead} occ ${cm.occ(bl)} pocc ${cm.occ(g.chars.pac)}` : "", dots: 244 - g.dots.length - g.powers.length, mode: g.mode, bpat: P ? h(P.ghost) + "/" + h(P.ghostFright) : "", epat: P ? h(P.elroy2) + "/" + h(P.elroy1) + " tun " + h(P.tunnel) : "", crel: g.chars.clyde ? `h ${g.chars.clyde.housing} l ${g.chars.clyde.leaving} gc ${g.globalCounter} starv ${g.starvation}` : "", elroy: g.chars.blinky ? `susp ${g.suspendElroy} spd ${g.chars.blinky.speed}` : "",
      level: g.levelNumber - 1, mt: g.level.timer, ft: g.exactFrightTicks, tn: g.exactTenths, rnd: g.exactRnd, div: g.exactDiv, fc: g.exactF, fr: g.frightened, starv: g.starvation, score: g.score, house: g.exactHouse, pc: ["pinky", "inky", "clyde"].map((n) => g.chars[n] ? g.chars[n].dotCounter : "-").join(",") + " gc " + g.globalCounter, pdbg: pk && cmz ? `spd ${pk.speed} occ ${cmz.occ(pk)[0]},${cmz.occ(pk)[2]} tun ${cmz.isTunnel(cmz.occ(pk)[0], cmz.occ(pk)[2])} fr ${pk.frightened} dead ${pk.dead}` : "" };
    for (const a of ACTORS) { const c = g.chars[a]; o[a] = c ? { x: base.x - c.x, y: c.y + base.y, dir: c.dir, idir: c.iDir, dead: c.dead, fr: c.frightened } : null; }
    return o;
  };
  const out = [];
  out.starts = [];
  // (NOSYNC=1: only the first life's, so a whole game must keep in step through deaths, board ends and intermissions)
  const sync = (L) => { if (process.env.NOSYNC && L > 0) return; if (divAt && divAt[L]) { g.exactDiv = divAt[L].div; g.exactF = divAt[L].fc; g.exactTenths = divAt[L].tn; g.exactRnd = divAt[L].rnd; } };
  let cur = null, life = -1, armed = false, prevBx = null, pacAt = null;
  for (let i = 0; i < maxFrames && g.scene.name === "game"; i++) {
    // (synced just before the update in which Pac-Man first steps, to the arcade's values on its frame of that)
    if (bot) {
      held = (process.env.FRUITBOT && fruitKey(core)) || botKeyForStats(core) || held;
      const L = cur ? life : life + 1, k = cur ? cur.length : 0;
      (bot.rec[L] = bot.rec[L] || [])[k] = held; // (before READY goes: frame 0's entry, held through it as the arcade's)
    } else held = cur ? joy(life, cur.length) : joy(life + 1, 0);
    core.update();
    const live = g.mode === "normal" || g.mode === "ateGhost" || g.mode === "vacuum" || g.mode === "push";
    if (!cur) {
      if (g.mode === "ready") { armed = true; pacAt = null; }
      const pc = g.chars.pac;
      if (armed && pacAt === null && pc && (Math.floor(base.x - pc.x) !== 128 || Math.floor(pc.y + base.y) !== 196)) { pacAt = i; sync(life + 1); }
      const bx = g.chars.blinky ? g.chars.blinky.x : null;
      if (armed && live && prevBx !== null && Math.floor(bx) !== Math.floor(prevBx)) { armed = false; life++; if (life >= lives) break; cur = []; out.push(cur); out.starts.push({ pac: pacAt, first: i }); }
      prevBx = bx;
    }
    if (cur) {
      const pc = g.chars.pac, st = out.starts[life];
      if (st.pac === null && pc && (Math.floor(base.x - pc.x) !== 128 || Math.floor(pc.y + base.y) !== 196)) { st.pac = i; sync(life); } // (his first step after Blinky's)
      cur.push(snap());
      if (cur.length >= frames || g.mode === "caught" || g.mode === "dying" || g.mode === "levelComplete") { cur = null; prevBx = null; } // (a board cleared ends it too, as the arcade's sprites go)
    }
  }
  return out;
}

// (FRUITBOT=1: while the fruit is up the bot heads for it, a shortest path over open tiles, so fruit gets eaten too)
function fruitKey(core) {
  const g = core.g, pac = g.chars && g.chars.pac;
  if (!pac || !g.fruitTimer) return null;
  const cm = core.getCurrentMaze(), D = core.constants.DELTAS, fl = cm.fruitLoc, goal = [Math.floor(fl.x / 8), Math.floor(fl.y / 8)];
  const [px, , py] = cm.getLoc(pac), key = (x, y) => x + "," + y, from = new Map([[key(px, py), null]]), q = [[px, py]];
  while (q.length) {
    const [x, y] = q.shift();
    if (x === goal[0] && y === goal[1]) {
      let k = key(x, y), step = null;
      while (from.get(k)) { step = from.get(k); if (step.prev === key(px, py)) return ["right", "down", "left", "up"][step.d]; k = step.prev; }
      return null;
    }
    for (let d = 0; d < 4; d++) { const nx = x + D[d].x, ny = y + D[d].y; if (nx < 0 || ny < 0 || nx >= cm.w || ny >= cm.h || cm.isWall(nx, ny) || from.has(key(nx, ny))) continue; from.set(key(nx, ny), { prev: key(x, y), d }); q.push([nx, ny]); }
  }
  return null;
}

/** first differences, life by life */
export function compare(A, B, who = ACTORS, show = 12) {
  const lines = [];
  for (let L = 0; L < Math.min(A.length, B.length); L++) {
    const a = A[L], b = B[L];
    let shown = 0;
    for (let k = 0; k < Math.min(a.length, b.length) && shown < show; k++) {
      const d = [];
      for (const n of who) { const p = a[k][n], q = b[k][n]; if (!q || (p.x === 0 && p.y === 0)) continue; if ((Math.floor(q.x) & 255) !== p.x || (Math.floor(q.y) & 255) !== p.y) d.push(`${n} ${p.x},${p.y} vs ${Math.floor(q.x)},${Math.floor(q.y)}`); }
      if (a[k].score !== undefined && b[k].score !== undefined && a[k].score !== b[k].score) d.push(`score ${a[k].score} vs ${b[k].score}`);
      if (a[k].fp !== undefined && b[k].fp !== undefined && a[k].fp !== b[k].fp) d.push(`fruit ${a[k].fp ? "up" : "gone"} vs ${b[k].fp ? "up" : "gone"}`);
      if (d.length) { lines.push(`life ${L + 1} frame ${k}: ${d.join("; ")}`); shown++; }
    }
    lines.push(`life ${L + 1}: compared ${Math.min(a.length, b.length)} frames (arcade ${a.length}, core ${b.length})${shown ? "" : ", identical"}`);
  }
  if (A.length !== B.length) lines.push(`lives: arcade ${A.length}, core ${B.length}`);
  return lines;
}

/** a recorded bot game as a joy(life, frame) */
export const fromRecording = (rec) => (life, k) => { const r = rec[life] || []; for (let i = Math.min(k, r.length - 1); i >= 0; i--) if (r[i] !== undefined) return r[i]; return null; };

const LEVEL = +(process.env.LEVEL || 1);
if (process.argv[1] && process.argv[1].endsWith("compare.mjs") && process.argv[2] === "bot") {
  // node tools/arcade/compare.mjs bot [frames per life] [lives]: the bot plays the core, the arcade replays its stick
  // (lives 5: both games start with 5, the arcade by its DIP switch, so the bot gets further)
  const frames = +(process.argv[3] || 3000), lives = +(process.argv[4] || 3), bot = { rec: [] };
  // (HARD=1: the arcade's Difficulty DIP switch on Hard, the core on its Hard difficulty)
  // (GAME=pacplus: the Pac-Man Plus ROM against the core with Plus Mode on and the Plus difficulty)
  const PLUS = process.env.GAME === "pacplus";
  const cfg = { ...(lives > 3 ? { startingLives: 5 } : {}), startingLevel: LEVEL, ...(process.env.HARD ? { difficulty: 1 } : {}), ...(PLUS ? { plusMode: true, difficulty: 2 } : {}) }, dips = { ...(lives > 3 ? { lives: 5 } : {}), ...(process.env.HARD ? { hard: true } : {}) };
  coreTrace(null, frames, { lives, bot, cfg }); // (the bot plays, its stick recorded)
  const joy = fromRecording(bot.rec), A = arcadeTrace(joy, frames, { lives, dips, level: LEVEL, maxFrames: 150000, game: PLUS ? "pacplus" : "pacman" }); // (room for five whole lives)
  const B = coreTrace(joy, frames, { lives, cfg, divAt: A.map((l) => l.sync) }); // (the same stick again, the ROM's counters)
  console.log(compare(A, B).join("\n"));
} else if (process.argv[1] && process.argv[1].endsWith("compare.mjs")) {
  const joy = plans(process.argv[2] || "left:40,up:200");
  const frames = +(process.argv[3] || 600), who = process.argv[4] ? process.argv[4].split(",") : ACTORS;
  const cfg = { startingLevel: LEVEL };
  const A = arcadeTrace(joy, frames, { level: LEVEL }), B = coreTrace(joy, frames, { cfg, divAt: A.map((l) => l.sync) });
  console.log(compare(A, B, who).join("\n"));
}
