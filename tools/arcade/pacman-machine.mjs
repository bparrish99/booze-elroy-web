// The Pac-Man arcade board around the Z80 (dev tool, never deployed; the ROMs are the player's own, read from their
// MAME folder at run time and never copied into the repo). Memory map, inputs, DIP switches, the vblank interrupt.
// Enough to run the game's logic exactly; no picture or sound (the harness reads RAM).
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { Z80 } from "./z80.mjs";

// a .zip's files by name (stored or deflated; just what MAME sets use)
export function unzip(path) {
  const b = readFileSync(path), out = {};
  let eocd = b.length - 22; while (eocd >= 0 && b.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  let p = b.readUInt32LE(eocd + 16);
  const n = b.readUInt16LE(eocd + 10);
  for (let i = 0; i < n; i++) {
    const method = b.readUInt16LE(p + 10), csize = b.readUInt32LE(p + 20), nlen = b.readUInt16LE(p + 28), xlen = b.readUInt16LE(p + 30), clen = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const name = b.toString("latin1", p + 46, p + 46 + nlen);
    const lnlen = b.readUInt16LE(off + 26), lxlen = b.readUInt16LE(off + 28), data = b.subarray(off + 30 + lnlen + lxlen, off + 30 + lnlen + lxlen + csize);
    out[name.toLowerCase()] = method === 0 ? Buffer.from(data) : inflateRawSync(data);
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

// Pac-Man Plus's program is lightly encrypted (MAME's pacplus decode: a bit swap and XOR picked by address bits)
const PP_TBL = [[7, 6, 5, 4, 3, 2, 1, 0, 0x00], [7, 6, 5, 4, 3, 2, 1, 0, 0x28], [6, 1, 3, 2, 5, 7, 0, 4, 0x96], [6, 1, 5, 2, 3, 7, 0, 4, 0xbe], [0, 3, 7, 6, 4, 2, 1, 5, 0xd5], [0, 3, 4, 6, 7, 2, 1, 5, 0xdd]];
const PP_PICK = [0, 2, 4, 2, 4, 0, 4, 2, 2, 0, 2, 2, 4, 0, 4, 2, 2, 2, 4, 0, 4, 2, 4, 0, 0, 4, 0, 4, 4, 2, 4, 2];
function pacplusDecrypt(addr, e) {
  let m = PP_PICK[(addr & 1) | ((addr & 4) >> 1) | ((addr & 0x20) >> 3) | ((addr & 0x80) >> 4) | ((addr & 0x200) >> 5)];
  if (addr & 0x800) m ^= 1;
  const t = PP_TBL[m]; let r = 0;
  for (let i = 0; i < 8; i++) if ((e >> t[i]) & 1) r |= 1 << (7 - i);
  return r ^ t[8];
}

/** the 16K program: "pacman" or "pacplus" (decrypted), from the player's MAME roms folder */
export function loadProgram(game, romDir = process.env.MAME_ROMS || "/mnt/c/mame/roms") {
  const z = unzip(`${romDir}/${game}.zip`);
  const names = game === "pacplus" ? ["pacplus.6e", "pacplus.6f", "pacplus.6h", "pacplus.6j"] : ["pacman.6e", "pacman.6f", "pacman.6h", "pacman.6j"];
  const rom = Buffer.concat(names.map((n) => { if (!z[n]) throw new Error(`${game}.zip has no ${n}`); return z[n]; }));
  if (game === "pacplus") for (let a = 0; a < rom.length; a++) rom[a] = pacplusDecrypt(a, rom[a]);
  return new Uint8Array(rom);
}

export const CYCLES_PER_FRAME = Math.round(3072000 / 60.606060); // the board: 3.072 MHz, vblank at 60.61 Hz

export class PacmanMachine {
  /** dips: { lives: 1|2|3|5, bonus: 10000|15000|20000|0, hard: false } (defaults: the classic 3 lives, 10,000) */
  constructor(program, dips = {}) {
    this.rom = program;
    this.ram = new Uint8Array(0x1000);   // 0x4000-0x4fff: video, colour, work RAM, sprite attributes
    this.io = new Uint8Array(0x100);     // 0x5000-0x50ff writes (interrupt enable, sound, sprite coords, ...)
    this.vector = 0;
    this.in0 = 0xff; this.in1 = 0xff;    // active low
    const lives = { 1: 0, 2: 1, 3: 2, 5: 3 }[dips.lives || 3], bonus = { 10000: 0, 15000: 1, 20000: 2, 0: 3 }[dips.bonus === undefined ? 10000 : dips.bonus];
    this.dip = 0x01 | (lives << 2) | (bonus << 4) | (dips.hard ? 0 : 0x40) | 0x80; // 1 coin 1 credit, normal ghost names
    this.cpu = new Z80(this);
    this.frame = 0;
  }
  read(a) {
    a &= 0x7fff; // A15 isn't decoded
    if (a < 0x4000) return this.rom[a];
    if (a < 0x5000) return (a & 0xfff) < 0x800 || a >= 0x4c00 ? this.ram[a - 0x4000] : 0xbf;
    switch (a & 0x50c0) { case 0x5000: return this.in0; case 0x5040: return this.in1; case 0x5080: return this.dip; default: return 0xff; }
  }
  write(a, v) {
    a &= 0x7fff;
    // (test only: while startLevel(n) is armed, every write of the level byte (0x4E13, cleared twice as a game is set up)
    // becomes level n's, so the ROM plays a game from a later level, as the core's starting level does (the arcade has no
    // such option); the caller disarms it at the first READY, startLevel(1), before any board is cleared)
    // and the pointer into the per-level difficulty list (0x4E0A, a list of set numbers at 0x0068, moved on a step a board
    // until its last entry, 0x14; both lists, normal and hard, sit in page 0) moves on as many steps
    if (a === 0x4e13 && this.levelAt !== undefined) v = this.levelAt;
    if (a === 0x4e0a && this.levelAt !== undefined) { let p = v; for (let i = 0; i < this.levelAt && this.rom[p] !== 0x14; i++) p++; v = p & 0xff; }
    if (a >= 0x4000 && a < 0x5000) { if ((a & 0xfff) < 0x800 || a >= 0x4c00) this.ram[a - 0x4000] = v; return; }
    if (a >= 0x5000 && a < 0x5100) { this.io[a - 0x5000] = v; if (a === 0x5000 && !(v & 1)) this.irq = false; }
  }
  input() { return 0xff; }
  output(port, v) { if ((port & 0xff) === 0) this.vector = v; }
  /** the next game starts at level n (1 = the first board): see write() */
  startLevel(n) { this.levelAt = n > 1 ? n - 1 : undefined; }
  /** peek at the game's memory (0x4000-0x4fff) */
  peek(a) { return this.ram[a - 0x4000]; }
  /** the controls for the frames that follow: joy is "up" | "down" | "left" | "right" | null; coin / start pressed */
  setInputs({ joy = null, coin = false, start = false } = {}) {
    let i0 = 0xff;
    if (joy === "up") i0 &= ~0x01; else if (joy === "left") i0 &= ~0x02; else if (joy === "right") i0 &= ~0x04; else if (joy === "down") i0 &= ~0x08;
    if (coin) i0 &= ~0x20;
    this.in0 = i0;
    this.in1 = start ? 0xff & ~0x20 : 0xff;
  }
  /** one video frame: the CPU runs a frame's worth, then vblank interrupts it (if enabled) */
  runFrame() {
    const cpu = this.cpu, end = cpu.cycles + CYCLES_PER_FRAME;
    if (this.io[0] & 1) this.irq = true; // vblank: the line stays asserted until the CPU takes it (or it's masked off)
    while (cpu.cycles < end) {
      if (this.irq && cpu.interrupt(this.vector)) this.irq = false;
      cpu.step();
    }
    this.frame++;
  }
}
