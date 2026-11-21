// Side by side (dev tool, never deployed): the real Pac-Man ROM in the harness and the author's core, fed the same
// joystick frame by frame from the moment READY goes, compared frame by frame (positions and directions of Pac-Man and the
// four ghosts, dots eaten). Prints the first frames where they differ.
//   node tools/arcade/compare.mjs [script] [frames]
// script: a joystick plan, "left:60,up:40,..." (direction held for that many frames; the last one holds), default a
// lap of the lower maze
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProgram, PacmanMachine } from "./pacman-machine.mjs";
import { loadCore } from "../golden.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DATA = JSON.parse(readFileSync(join(ROOT, "assets/data.json"), "utf8"));

export const ACTORS = ["blinky", "pinky", "inky", "clyde", "pac"];
const POS = { blinky: 0x4d00, pinky: 0x4d02, inky: 0x4d04, clyde: 0x4d06, pac: 0x4d08 };
const DIR = { blinky: 0x4d2c, pinky: 0x4d2d, inky: 0x4d2e, clyde: 0x4d2f, pac: 0x4d30 };

export function plan(script) {
  const steps = script.split(",").map((s) => { const [d, n] = s.split(":"); return [d, +n || 1]; });
  return (k) => { let t = k; for (const [d, n] of steps) { if (t < n) return d === "-" ? null : d; t -= n; } const last = steps[steps.length - 1][0]; return last === "-" ? null : last; };
}

/** the arcade's play, frame by frame from READY going: [{ pac: {x, y, dir}, ..., dots }] in arcade coordinates */
export function arcadeTrace(joy, frames, game = "pacman") {
  const m = new PacmanMachine(loadProgram(game));
  const coinAt = game === "pacplus" ? 800 : 300;
  const snap = () => { const o = { dots: m.peek(0x4e0e) }; for (const a of ACTORS) o[a] = { y: m.peek(POS[a]), x: m.peek(POS[a] + 1), dir: m.peek(DIR[a]) }; return o; };
  let f = 0;
  for (; f < coinAt + 140; f++) { // coin, start
    if (f === coinAt) m.setInputs({ coin: true }); else if (f === coinAt + 6) m.setInputs({}); else if (f === coinAt + 100) m.setInputs({ start: true }); else if (f === coinAt + 106) m.setInputs({});
    m.runFrame();
  }
  // wait for the start positions, then for anything to move (READY gone): that frame is play frame 0
  let prev = snap(), out = [], k = 0, placed = false;
  for (; f < coinAt + 2000 && out.length < frames; f++) {
    m.setInputs({ joy: out.length || placed ? joy(k) : null });
    m.runFrame();
    const s = snap();
    if (!placed) { if (s.pac.y === 196 && s.pac.x === 128) placed = true; prev = s; continue; }
    const moved = s.blinky.x !== prev.blinky.x || s.blinky.y !== prev.blinky.y; // (play frame 0: Blinky's first step)
    if (out.length || moved) { out.push(s); k++; }
    prev = s;
  }
  return out;
}

/** the author's core, the same way: play frame 0 = the first frame anything moves after READY */
export function coreTrace(joy, frames, cfg = {}) {
  const create = loadCore(process.env.CORE || join(ROOT, "src/core.js"));
  let held = null, s = 1;
  const rng = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const core = create(DATA, { rng, isDown: (k) => k === held, exact: () => !!process.env.EXACT }); // (EXACT=1: the side project's switch)
  core.init(); Object.assign(core.g.config, cfg);
  core.g.autoplay = false; core.g.attract = false; core.setScene("game");
  const g = core.g;
  // the core's coordinates -> the arcade's (the screen is rotated on the board: x runs right to left)
  const P0 = { x: 128, y: 196 };
  let base = null;
  const snap = () => {
    const o = { dots: 244 - g.dots.length - g.powers.length };
    for (const a of ACTORS) { const c = g.chars[a]; o[a] = c ? { x: base.x - c.x, y: c.y + base.y, dir: c.dir } : null; }
    return o;
  };
  for (let i = 0; i < 2000 && g.mode !== "normal"; i++) core.update();
  base = { x: P0.x + g.chars.pac.x, y: P0.y - g.chars.pac.y };
  let prev = snap(), out = [], k = 0;
  for (let i = 0; i < frames + 400 && out.length < frames; i++) {
    held = joy(k);
    core.update();
    const sn = snap();
    const moved = Math.floor(sn.blinky.x) !== Math.floor(prev.blinky.x) || Math.floor(sn.blinky.y) !== Math.floor(prev.blinky.y);
    if (out.length || moved) { out.push(sn); k++; }
    prev = sn;
  }
  return out;
}

const r1 = (v) => Math.round(v * 100) / 100;
if (process.argv[1] && process.argv[1].endsWith("compare.mjs")) {
  const script = process.argv[2] || "left:150,up:60,left:200";
  const frames = +(process.argv[3] || 300);
  const joy = plan(script);
  const A = arcadeTrace(joy, frames), B = coreTrace(joy, frames);
  console.log(`play frames: arcade ${A.length}, core ${B.length}`);
  let shown = 0;
  for (let k = 0; k < Math.min(A.length, B.length) && shown < 25; k++) {
    const diffs = [];
    for (const a of ACTORS) {
      const p = A[k][a], q = B[k][a];
      if (!q) continue;
      if (Math.floor(q.x) !== p.x || Math.floor(q.y) !== p.y || q.dir !== p.dir) diffs.push(`${a} arcade ${p.x},${p.y} d${p.dir} | core ${r1(q.x)},${r1(q.y)} d${q.dir}`);
    }
    if (A[k].dots !== B[k].dots) diffs.push(`dots arcade ${A[k].dots} core ${B[k].dots}`);
    if (diffs.length) { console.log(`frame ${k}: ` + diffs.join("; ")); shown++; }
  }
}
