// Side by side (dev tool, never deployed): the real Pac-Man ROM in the harness and the author's core, fed the same
// joystick, compared frame by frame (positions of Pac-Man and the four ghosts). Each life is lined up on its own (play
// frame 0 = Blinky's first step after READY), since the death animations in between needn't take the same time; the
// joystick plan is per life too.
//   node tools/arcade/compare.mjs "<life 1 plan> | <life 2 plan> | ..." [frames per life] [actors]
//   EXACT=1 ... (the core with NEAT's switch on), CORE=path (another core.js)
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
export function arcadeTrace(joy, frames, { game = "pacman", lives = 3, maxFrames = 40000 } = {}) {
  const m = new PacmanMachine(loadProgram(game));
  const coinAt = game === "pacplus" ? 800 : 300;
  const pat = (base) => { const b = [0, 1, 2, 3].map((i) => m.peek(base + i)); return (((b[1] << 24) | (b[0] << 16) | (b[3] << 8) | b[2]) >>> 0).toString(16).padStart(8, "0"); };
  const snap = () => { const o = { dots: m.peek(0x4e0e), bpat: pat(0x4d56) + "/" + pat(0x4d5a), eat: m.peek(0x4da4), div: m.peek(0x4c86) & 0x0f, fc: m.peek(0x4c84), ptun: pat(0x4d6a), ptile: m.peek(0x4d35) + "," + m.peek(0x4d34), house: m.peek(0x4d94), pc: [0x4e0f, 0x4e10, 0x4e11, 0x4e12].map((a) => m.peek(a)).join(",") }; for (const a of ACTORS) o[a] = { y: m.peek(POS[a]), x: m.peek(POS[a] + 1), dir: m.peek(DIR[a]) }; return o; };
  let f = 0;
  for (; f < coinAt + 140; f++) {
    if (f === coinAt) m.setInputs({ coin: true }); else if (f === coinAt + 6) m.setInputs({}); else if (f === coinAt + 100) m.setInputs({ start: true }); else if (f === coinAt + 106) m.setInputs({});
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
      if (atStart(s)) { ready = true; pacFirst = null; }
      // (the counters on the frame Pac-Man first steps: the anchor the core's are set from, in the harness)
      if (ready && !pacFirst && (s.pac.x !== 128 || s.pac.y !== 196)) pacFirst = { div: s.div, fc: s.fc };
      if (ready && atStart(prev) && s.blinky.x !== prev.blinky.x) { ready = false; life++; if (life >= lives) break; cur = [s]; cur.sync = pacFirst; cur.pre = recent.slice(0, -1); out.push(cur); }
    } else {
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
// (divAt: the arcade's divider and frame counter at each life's frame 0, so the core's timed tasks and house bob line up with
// the ROM's, set just before that frame: at the update count `starts` (from an earlier run of the same game) recorded; test only)
export function coreTrace(joy, frames, { cfg = {}, lives = 3, maxFrames = 40000, bot = null, divAt = null, starts = null } = {}) {
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
    const o = { dots: 244 - g.dots.length - g.powers.length, mode: g.mode, bpat: P ? h(P.ghost) + "/" + h(P.ghostFright) : "",
      house: g.exactHouse, pc: ["pinky", "inky", "clyde"].map((n) => g.chars[n] ? g.chars[n].dotCounter : "-").join(",") + " gc " + g.globalCounter, pdbg: pk && cmz ? `spd ${pk.speed} occ ${cmz.occ(pk)[0]},${cmz.occ(pk)[2]} tun ${cmz.isTunnel(cmz.occ(pk)[0], cmz.occ(pk)[2])} fr ${pk.frightened} dead ${pk.dead}` : "" };
    for (const a of ACTORS) { const c = g.chars[a]; o[a] = c ? { x: base.x - c.x, y: c.y + base.y, dir: c.dir } : null; }
    return o;
  };
  const out = [];
  out.starts = [];
  let cur = null, life = -1, armed = false, prevBx = null, pacAt = null;
  for (let i = 0; i < maxFrames && g.scene.name === "game"; i++) {
    // (synced just before the update in which Pac-Man first steps, to the arcade's values on its frame of that)
    const L = starts ? starts.findIndex((st) => st.pac === i) : -1;
    if (L >= 0 && divAt && divAt[L]) { g.exactDiv = (divAt[L].div + 5) % 6; g.exactF = (divAt[L].fc + 255) & 255; }
    if (bot) {
      held = botKeyForStats(core) || held;
      const L = cur ? life : life + 1, k = cur ? cur.length : 0;
      (bot.rec[L] = bot.rec[L] || [])[k] = held; // (before READY goes: frame 0's entry, held through it as the arcade's)
    } else held = cur ? joy(life, cur.length) : joy(life + 1, 0);
    core.update();
    const live = g.mode === "normal" || g.mode === "ateGhost" || g.mode === "vacuum" || g.mode === "push";
    if (!cur) {
      if (g.mode === "ready") { armed = true; pacAt = null; }
      const pc = g.chars.pac;
      if (armed && pacAt === null && pc && (Math.floor(base.x - pc.x) !== 128 || Math.floor(pc.y + base.y) !== 196)) pacAt = i;
      const bx = g.chars.blinky ? g.chars.blinky.x : null;
      if (armed && live && prevBx !== null && Math.floor(bx) !== Math.floor(prevBx)) { armed = false; life++; if (life >= lives) break; cur = []; out.push(cur); out.starts.push({ pac: pacAt, first: i }); }
      prevBx = bx;
    }
    if (cur) {
      cur.push(snap());
      if (cur.length >= frames || g.mode === "caught" || g.mode === "dying") { cur = null; prevBx = null; }
    }
  }
  return out;
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
      if (d.length) { lines.push(`life ${L + 1} frame ${k}: ${d.join("; ")}`); shown++; }
    }
    lines.push(`life ${L + 1}: compared ${Math.min(a.length, b.length)} frames (arcade ${a.length}, core ${b.length})${shown ? "" : ", identical"}`);
  }
  if (A.length !== B.length) lines.push(`lives: arcade ${A.length}, core ${B.length}`);
  return lines;
}

/** a recorded bot game as a joy(life, frame) */
export const fromRecording = (rec) => (life, k) => { const r = rec[life] || []; for (let i = Math.min(k, r.length - 1); i >= 0; i--) if (r[i] !== undefined) return r[i]; return null; };

if (process.argv[1] && process.argv[1].endsWith("compare.mjs") && process.argv[2] === "bot") {
  // node tools/arcade/compare.mjs bot [frames per life] [lives]: the bot plays the core, the arcade replays its stick
  const frames = +(process.argv[3] || 3000), lives = +(process.argv[4] || 3), bot = { rec: [] };
  const B0 = coreTrace(null, frames, { lives, bot });
  const joy = fromRecording(bot.rec), A = arcadeTrace(joy, frames, { lives });
  const B = coreTrace(joy, frames, { lives, starts: B0.starts, divAt: A.map((l) => l.sync) }); // (the same stick again, the ROM's counters)
  console.log(compare(A, B).join("\n"));
} else if (process.argv[1] && process.argv[1].endsWith("compare.mjs")) {
  const joy = plans(process.argv[2] || "left:40,up:200");
  const frames = +(process.argv[3] || 600), who = process.argv[4] ? process.argv[4].split(",") : ACTORS;
  const A = arcadeTrace(joy, frames), B0 = coreTrace(joy, frames), B = coreTrace(joy, frames, { starts: B0.starts, divAt: A.map((l) => l.sync) });
  console.log(compare(A, B, who).join("\n"));
}
