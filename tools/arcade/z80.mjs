// A Z80 CPU for the arcade harness (dev tool, never deployed): enough of the real chip, flags included (the undocumented
// X/Y bits too), to run the original Pac-Man / Pac-Man Plus program from the player's own ROM files and read its memory
// frame by frame. Bus: read(addr), write(addr, v), input(port), output(port, v). Timing: T-states per instruction from
// the standard tables (the game runs its logic in the vblank interrupt, so a frame's budget is what matters).

const SZ = new Uint8Array(256), SZP = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let p = 0; for (let b = i; b; b >>= 1) p ^= b & 1;
  SZ[i] = (i & 0x80) | (i === 0 ? 0x40 : 0) | (i & 0x28);
  SZP[i] = SZ[i] | (p ? 0 : 0x04);
}
const C = 0x01, N = 0x02, PV = 0x04, X3 = 0x08, H = 0x10, Y5 = 0x20, Z = 0x40, S = 0x80;

// base T-states for unprefixed opcodes (conditional ones get extra when taken)
const CYC = [
  4, 10, 7, 6, 4, 4, 7, 4, 4, 11, 7, 6, 4, 4, 7, 4, 8, 10, 7, 6, 4, 4, 7, 4, 12, 11, 7, 6, 4, 4, 7, 4,
  7, 10, 16, 6, 4, 4, 7, 4, 7, 11, 16, 6, 4, 4, 7, 4, 7, 10, 13, 6, 11, 11, 10, 4, 7, 11, 13, 6, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4, 7, 7, 7, 7, 7, 7, 4, 7, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4, 4, 4, 4, 4, 4, 4, 7, 4,
  5, 10, 10, 10, 10, 11, 7, 11, 5, 10, 10, 0, 10, 17, 7, 11, 5, 10, 10, 11, 10, 11, 7, 11, 5, 4, 10, 11, 10, 0, 7, 11,
  5, 10, 10, 19, 10, 11, 7, 11, 5, 4, 10, 4, 10, 0, 7, 11, 5, 10, 10, 4, 10, 11, 7, 11, 5, 6, 10, 4, 10, 0, 7, 11,
];

export class Z80 {
  constructor(bus) {
    this.bus = bus;
    this.reset();
  }
  reset() {
    this.a = 0xff; this.f = 0xff; this.b = this.c = this.d = this.e = this.h = this.l = 0;
    this.a_ = this.f_ = this.b_ = this.c_ = this.d_ = this.e_ = this.h_ = this.l_ = 0;
    this.ix = this.iy = 0xffff; this.sp = 0xffff; this.pc = 0; this.i = 0; this.r = 0;
    this.iff1 = this.iff2 = false; this.im = 0; this.halted = false; this.cycles = 0; this.eiDelay = false;
  }
  // ------------------------------------------------------------------ memory helpers
  rb(a) { return this.bus.read(a & 0xffff); }
  wb(a, v) { this.bus.write(a & 0xffff, v & 0xff); }
  rw(a) { return this.rb(a) | (this.rb(a + 1) << 8); }
  ww(a, v) { this.wb(a, v); this.wb(a + 1, v >> 8); }
  fetch() { const v = this.rb(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
  fetchw() { const v = this.rw(this.pc); this.pc = (this.pc + 2) & 0xffff; return v; }
  push(v) { this.sp = (this.sp - 2) & 0xffff; this.ww(this.sp, v); }
  pop() { const v = this.rw(this.sp); this.sp = (this.sp + 2) & 0xffff; return v; }
  get bc() { return (this.b << 8) | this.c; } set bc(v) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
  get de() { return (this.d << 8) | this.e; } set de(v) { this.d = (v >> 8) & 0xff; this.e = v & 0xff; }
  get hl() { return (this.h << 8) | this.l; } set hl(v) { this.h = (v >> 8) & 0xff; this.l = v & 0xff; }
  get af() { return (this.a << 8) | this.f; } set af(v) { this.a = (v >> 8) & 0xff; this.f = v & 0xff; }
  incR() { this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f); }

  // ------------------------------------------------------------------ interrupts
  /** a maskable interrupt with `data` on the bus (IM 2: the low byte of the vector); returns true if taken */
  interrupt(data) {
    if (!this.iff1 || this.eiDelay) return false;
    if (this.halted) { this.halted = false; this.pc = (this.pc + 1) & 0xffff; }
    this.iff1 = this.iff2 = false; this.incR();
    if (this.im === 2) { this.push(this.pc); this.pc = this.rw((this.i << 8) | (data & 0xfe)); this.cycles += 19; }
    else if (this.im === 1) { this.push(this.pc); this.pc = 0x38; this.cycles += 13; }
    else { this.push(this.pc); this.pc = data & 0x38; this.cycles += 13; } // IM 0: an RST on the bus
    return true;
  }

  // ------------------------------------------------------------------ ALU
  add8(v, cy) {
    const a = this.a, r = a + v + cy;
    this.f = SZ[r & 0xff] | ((a ^ v ^ r) & H) | ((~(a ^ v) & (a ^ r) & 0x80) ? PV : 0) | (r > 0xff ? C : 0);
    this.a = r & 0xff;
  }
  sub8(v, cy, store = true) {
    const a = this.a, r = a - v - cy;
    const f = (SZ[r & 0xff] & ~(X3 | Y5)) | N | ((a ^ v ^ r) & H) | (((a ^ v) & (a ^ r) & 0x80) ? PV : 0) | (r < 0 ? C : 0);
    if (store) { this.a = r & 0xff; this.f = f | (r & (X3 | Y5)); } else this.f = f | (v & (X3 | Y5)); // CP: X/Y from the operand
  }
  and8(v) { this.a &= v; this.f = SZP[this.a] | H; }
  xor8(v) { this.a = (this.a ^ v) & 0xff; this.f = SZP[this.a]; }
  or8(v) { this.a = (this.a | v) & 0xff; this.f = SZP[this.a]; }
  alu(op, v) {
    switch (op) {
      case 0: this.add8(v, 0); break; case 1: this.add8(v, this.f & C); break;
      case 2: this.sub8(v, 0); break; case 3: this.sub8(v, this.f & C); break;
      case 4: this.and8(v); break; case 5: this.xor8(v); break; case 6: this.or8(v); break;
      case 7: this.sub8(v, 0, false); break;
    }
  }
  inc8(v) { const r = (v + 1) & 0xff; this.f = (this.f & C) | SZ[r] | ((v & 0xf) === 0xf ? H : 0) | (v === 0x7f ? PV : 0); return r; }
  dec8(v) { const r = (v - 1) & 0xff; this.f = (this.f & C) | SZ[r] | N | ((v & 0xf) === 0 ? H : 0) | (v === 0x80 ? PV : 0); return r; }
  add16(a, b) {
    const r = a + b;
    this.f = (this.f & (S | Z | PV)) | (((a ^ b ^ r) >> 8) & H) | ((r >> 8) & (X3 | Y5)) | (r > 0xffff ? C : 0);
    return r & 0xffff;
  }
  adc16(b) {
    const a = this.hl, cy = this.f & C, r = a + b + cy;
    this.f = ((r >> 8) & (S | X3 | Y5)) | ((r & 0xffff) === 0 ? Z : 0) | (((a ^ b ^ r) >> 8) & H) | ((~(a ^ b) & (a ^ r) & 0x8000) ? PV : 0) | (r > 0xffff ? C : 0);
    this.hl = r & 0xffff;
  }
  sbc16(b) {
    const a = this.hl, cy = this.f & C, r = a - b - cy;
    this.f = ((r >> 8) & (S | X3 | Y5)) | ((r & 0xffff) === 0 ? Z : 0) | (((a ^ b ^ r) >> 8) & H) | (((a ^ b) & (a ^ r) & 0x8000) ? PV : 0) | N | (r < 0 ? C : 0);
    this.hl = r & 0xffff;
  }
  rot(op, v) { // CB rotates / shifts
    let r, c;
    switch (op) {
      case 0: c = v >> 7; r = ((v << 1) | c) & 0xff; break;              // RLC
      case 1: c = v & 1; r = ((v >> 1) | (c << 7)) & 0xff; break;         // RRC
      case 2: c = v >> 7; r = ((v << 1) | (this.f & C)) & 0xff; break;    // RL
      case 3: c = v & 1; r = ((v >> 1) | ((this.f & C) << 7)) & 0xff; break; // RR
      case 4: c = v >> 7; r = (v << 1) & 0xff; break;                     // SLA
      case 5: c = v & 1; r = ((v >> 1) | (v & 0x80)) & 0xff; break;       // SRA
      case 6: c = v >> 7; r = ((v << 1) | 1) & 0xff; break;               // SLL (undocumented)
      default: c = v & 1; r = v >> 1; break;                              // SRL
    }
    this.f = SZP[r] | c; return r;
  }
  bit(n, v, xy) { const r = v & (1 << n); this.f = (this.f & C) | H | (r ? (r & S) : (Z | PV)) | (xy & (X3 | Y5)); }
  cond(cc) {
    switch (cc) {
      case 0: return !(this.f & Z); case 1: return !!(this.f & Z); case 2: return !(this.f & C); case 3: return !!(this.f & C);
      case 4: return !(this.f & PV); case 5: return !!(this.f & PV); case 6: return !(this.f & S); default: return !!(this.f & S);
    }
  }
  // register by index (0 B, 1 C, 2 D, 3 E, 4 H, 5 L, 6 (HL), 7 A); with an index prefix, H/L are IXh/IXl and (HL) is (IX+d)
  getr(i, xy, addr) {
    switch (i) {
      case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
      case 4: return xy === 1 ? this.ix >> 8 : xy === 2 ? this.iy >> 8 : this.h;
      case 5: return xy === 1 ? this.ix & 0xff : xy === 2 ? this.iy & 0xff : this.l;
      case 6: return this.rb(addr); default: return this.a;
    }
  }
  setr(i, v, xy, addr) {
    v &= 0xff;
    switch (i) {
      case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
      case 4: if (xy === 1) this.ix = (this.ix & 0xff) | (v << 8); else if (xy === 2) this.iy = (this.iy & 0xff) | (v << 8); else this.h = v; break;
      case 5: if (xy === 1) this.ix = (this.ix & 0xff00) | v; else if (xy === 2) this.iy = (this.iy & 0xff00) | v; else this.l = v; break;
      case 6: this.wb(addr, v); break; default: this.a = v;
    }
  }
  getHL(xy) { return xy === 1 ? this.ix : xy === 2 ? this.iy : this.hl; }
  setHL(xy, v) { if (xy === 1) this.ix = v & 0xffff; else if (xy === 2) this.iy = v & 0xffff; else this.hl = v & 0xffff; }
  rp(p, xy) { return p === 0 ? this.bc : p === 1 ? this.de : p === 2 ? this.getHL(xy) : this.sp; }
  setrp(p, v, xy) { if (p === 0) this.bc = v; else if (p === 1) this.de = v; else if (p === 2) this.setHL(xy, v); else this.sp = v & 0xffff; }

  // ------------------------------------------------------------------ execution
  /** run one instruction; returns its T-states */
  step() {
    const start = this.cycles;
    if (this.eiDelay) this.eiDelay = false;
    if (this.halted) { this.cycles += 4; this.incR(); return 4; }
    this.exec(this.fetch(), 0);
    return this.cycles - start;
  }
  exec(op, xy) {
    this.incR();
    if (op === 0xdd || op === 0xfd) { this.cycles += 4; return this.exec(this.fetch(), op === 0xdd ? 1 : 2); }
    if (op === 0xcb) return this.execCB(xy);
    if (op === 0xed) return this.execED();
    this.cycles += CYC[op];
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    // (IX+d) operand address for ops that touch (HL)
    const idx = () => { const d = this.fetch(); this.cycles += 8; return (this.getHL(xy) + ((d << 24) >> 24)) & 0xffff; };
    if (x === 1) { // LD r, r' / HALT
      if (op === 0x76) { this.halted = true; this.pc = (this.pc - 1) & 0xffff; return; }
      if (xy && (y === 6 || z === 6)) { const a = idx(); if (y === 6) this.setr(6, this.getr(z, 0), 0, a); else this.setr(y, this.getr(6, 0, a), 0); return; }
      this.setr(y, this.getr(z, xy, this.hl), xy, this.hl); return;
    }
    if (x === 2) { const a = z === 6 && xy ? idx() : this.hl; this.alu(y, this.getr(z, xy, a)); return; }
    if (x === 0) {
      switch (z) {
        case 0:
          if (y === 0) return; // NOP
          if (y === 1) { const t = this.af; this.af = (this.a_ << 8) | this.f_; this.a_ = t >> 8; this.f_ = t & 0xff; return; }
          if (y === 2) { const d = this.fetch(); this.b = (this.b - 1) & 0xff; if (this.b) { this.pc = (this.pc + ((d << 24) >> 24)) & 0xffff; this.cycles += 5; } return; }
          { const d = this.fetch(); if (y === 3 || this.cond(y - 4)) { this.pc = (this.pc + ((d << 24) >> 24)) & 0xffff; if (y !== 3) this.cycles += 5; } return; }
        case 1: if (q === 0) this.setrp(p, this.fetchw(), xy); else this.setHL(xy, this.add16(this.getHL(xy), this.rp(p, xy))); return;
        case 2:
          switch (y) {
            case 0: this.wb(this.bc, this.a); return; case 1: this.a = this.rb(this.bc); return;
            case 2: this.wb(this.de, this.a); return; case 3: this.a = this.rb(this.de); return;
            case 4: this.ww(this.fetchw(), this.getHL(xy)); return; case 5: this.setHL(xy, this.rw(this.fetchw())); return;
            case 6: this.wb(this.fetchw(), this.a); return; default: this.a = this.rb(this.fetchw()); return;
          }
        case 3: this.setrp(p, (this.rp(p, xy) + (q ? -1 : 1)) & 0xffff, xy); return;
        case 4: case 5: {
          const a = y === 6 ? (xy ? (this.cycles -= 0, idx()) : this.hl) : 0;
          const v = this.getr(y, xy, a); this.setr(y, z === 4 ? this.inc8(v) : this.dec8(v), xy, a); return;
        }
        case 6: { const a = y === 6 ? (xy ? idx() - 0 : this.hl) : 0; if (y === 6 && xy) this.cycles -= 3; this.setr(y, this.fetch(), xy, a); return; }
        default:
          switch (y) {
            case 0: { const c = this.a >> 7; this.a = ((this.a << 1) | c) & 0xff; this.f = (this.f & (S | Z | PV)) | (this.a & (X3 | Y5)) | c; return; }
            case 1: { const c = this.a & 1; this.a = (this.a >> 1) | (c << 7); this.f = (this.f & (S | Z | PV)) | (this.a & (X3 | Y5)) | c; return; }
            case 2: { const c = this.a >> 7; this.a = ((this.a << 1) | (this.f & C)) & 0xff; this.f = (this.f & (S | Z | PV)) | (this.a & (X3 | Y5)) | c; return; }
            case 3: { const c = this.a & 1; this.a = (this.a >> 1) | ((this.f & C) << 7); this.f = (this.f & (S | Z | PV)) | (this.a & (X3 | Y5)) | c; return; }
            case 4: { // DAA
              let a = this.a, corr = 0, cy = this.f & C;
              if ((this.f & H) || (a & 0xf) > 9) corr = 6;
              if (cy || a > 0x99) { corr |= 0x60; cy = C; }
              const nf = this.f & N; const r = nf ? (a - corr) & 0xff : (a + corr) & 0xff;
              const h = nf ? ((this.f & H) && (a & 0xf) < 6 ? H : 0) : ((a & 0xf) > 9 ? H : 0);
              this.a = r; this.f = SZP[r] | nf | h | cy; return;
            }
            case 5: this.a ^= 0xff; this.f = (this.f & (S | Z | PV | C)) | H | N | (this.a & (X3 | Y5)); return; // CPL
            case 6: this.f = (this.f & (S | Z | PV)) | C | (this.a & (X3 | Y5)); return; // SCF
            default: this.f = ((this.f & (S | Z | PV | C)) | ((this.f & C) ? H : 0) | (this.a & (X3 | Y5))) ^ C; return; // CCF
          }
      }
    }
    // x === 3
    switch (z) {
      case 0: if (this.cond(y)) { this.pc = this.pop(); this.cycles += 6; } return;
      case 1:
        if (q === 0) { const v = this.pop(); if (p === 3) this.af = v; else this.setrp(p, v, xy); return; }
        if (p === 0) { this.pc = this.pop(); return; }
        if (p === 1) { let t; t = this.bc; this.bc = (this.b_ << 8) | this.c_; this.b_ = t >> 8; this.c_ = t & 0xff;
          t = this.de; this.de = (this.d_ << 8) | this.e_; this.d_ = t >> 8; this.e_ = t & 0xff;
          t = this.hl; this.hl = (this.h_ << 8) | this.l_; this.h_ = t >> 8; this.l_ = t & 0xff; return; }
        if (p === 2) { this.pc = this.getHL(xy); return; }
        this.sp = this.getHL(xy); return;
      case 2: { const a = this.fetchw(); if (this.cond(y)) this.pc = a; return; }
      case 3:
        switch (y) {
          case 0: this.pc = this.fetchw(); return;
          case 2: this.bus.output(this.fetch(), this.a); return;
          case 3: this.a = this.bus.input(this.fetch()) & 0xff; return;
          case 4: { const v = this.rw(this.sp); this.ww(this.sp, this.getHL(xy)); this.setHL(xy, v); return; }
          case 5: { const t = this.de; this.de = this.hl; this.hl = t; return; }
          case 6: this.iff1 = this.iff2 = false; return;
          case 7: this.iff1 = this.iff2 = true; this.eiDelay = true; return;
          default: return;
        }
      case 4: { const a = this.fetchw(); if (this.cond(y)) { this.push(this.pc); this.pc = a; this.cycles += 7; } return; }
      case 5:
        if (q === 0) { this.push(p === 3 ? this.af : this.rp(p, xy)); return; }
        { const a = this.fetchw(); this.push(this.pc); this.pc = a; return; }
      case 6: this.alu(y, this.fetch()); return;
      default: this.push(this.pc); this.pc = y * 8; return;
    }
  }
  execCB(xy) {
    let addr, op;
    if (xy) { const d = this.fetch(); addr = (this.getHL(xy) + ((d << 24) >> 24)) & 0xffff; op = this.fetch(); this.cycles += 15; }
    else { op = this.fetch(); this.incR(); addr = this.hl; this.cycles += (op & 7) === 6 ? ((op >> 6) === 1 ? 12 : 15) : 8; }
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7;
    const v = xy ? this.rb(addr) : this.getr(z, 0, addr);
    if (x === 1) { this.bit(y, v, xy || z === 6 ? addr >> 8 : v); return; }
    const r = x === 0 ? this.rot(y, v) : x === 2 ? v & ~(1 << y) : v | (1 << y);
    if (xy) { this.wb(addr, r); if (z !== 6) this.setr(z, r, 0); } else this.setr(z, r, 0, addr);
  }
  execED() {
    const op = this.fetch(); this.incR();
    const x = op >> 6, y = (op >> 3) & 7, z = op & 7, p = y >> 1, q = y & 1;
    if (x === 1) {
      switch (z) {
        case 0: { this.cycles += 12; const v = this.bus.input(this.c) & 0xff; if (y !== 6) this.setr(y, v, 0); this.f = (this.f & C) | SZP[v]; return; }
        case 1: this.cycles += 12; this.bus.output(this.c, y === 6 ? 0 : this.getr(y, 0)); return;
        case 2: this.cycles += 15; if (q === 0) this.sbc16(this.rp(p, 0)); else this.adc16(this.rp(p, 0)); return;
        case 3: { this.cycles += 20; const a = this.fetchw(); if (q === 0) this.ww(a, this.rp(p, 0)); else this.setrp(p, this.rw(a), 0); return; }
        case 4: { this.cycles += 8; const v = this.a; this.a = 0; this.sub8(v, 0); return; } // NEG
        case 5: this.cycles += 14; this.pc = this.pop(); this.iff1 = this.iff2; return; // RETN / RETI
        case 6: this.cycles += 8; this.im = [0, 0, 1, 2, 0, 0, 1, 2][y]; return;
        default:
          this.cycles += 9;
          switch (y) {
            case 0: this.i = this.a; return; case 1: this.r = this.a; return;
            case 2: this.a = this.i; this.f = (this.f & C) | SZ[this.a] | (this.iff2 ? PV : 0); return;
            case 3: this.a = this.r; this.f = (this.f & C) | SZ[this.a] | (this.iff2 ? PV : 0); return;
            case 4: { this.cycles += 9; const m = this.rb(this.hl); this.wb(this.hl, ((this.a << 4) | (m >> 4)) & 0xff); this.a = (this.a & 0xf0) | (m & 0xf); this.f = (this.f & C) | SZP[this.a]; return; } // RRD
            case 5: { this.cycles += 9; const m = this.rb(this.hl); this.wb(this.hl, ((m << 4) | (this.a & 0xf)) & 0xff); this.a = (this.a & 0xf0) | (m >> 4); this.f = (this.f & C) | SZP[this.a]; return; } // RLD
            default: return;
          }
      }
    }
    if (x === 2 && z <= 3 && y >= 4) { // block instructions
      const inc = (y & 1) === 0 ? 1 : -1, rep = y >= 6;
      this.cycles += 16;
      if (z === 0) { // LDI / LDD / LDIR / LDDR
        const v = this.rb(this.hl); this.wb(this.de, v);
        this.hl = (this.hl + inc) & 0xffff; this.de = (this.de + inc) & 0xffff; this.bc = (this.bc - 1) & 0xffff;
        const n = (v + this.a) & 0xff;
        this.f = (this.f & (S | Z | C)) | (this.bc ? PV : 0) | (n & X3) | ((n << 4) & Y5);
        if (rep && this.bc) { this.pc = (this.pc - 2) & 0xffff; this.cycles += 5; }
      } else if (z === 1) { // CPI / CPD / CPIR / CPDR
        const v = this.rb(this.hl), r = (this.a - v) & 0xff, h = (this.a ^ v ^ r) & H;
        this.hl = (this.hl + inc) & 0xffff; this.bc = (this.bc - 1) & 0xffff;
        const n = (r - (h ? 1 : 0)) & 0xff;
        this.f = (this.f & C) | (SZ[r] & (S | Z)) | h | N | (this.bc ? PV : 0) | (n & X3) | ((n << 4) & Y5);
        if (rep && this.bc && r !== 0) { this.pc = (this.pc - 2) & 0xffff; this.cycles += 5; }
      } else if (z === 2) { // INI / IND / INIR / INDR
        const v = this.bus.input(this.c) & 0xff; this.wb(this.hl, v);
        this.hl = (this.hl + inc) & 0xffff; this.b = (this.b - 1) & 0xff;
        this.f = SZ[this.b] | N;
        if (rep && this.b) { this.pc = (this.pc - 2) & 0xffff; this.cycles += 5; }
      } else { // OUTI / OUTD / OTIR / OTDR
        const v = this.rb(this.hl); this.b = (this.b - 1) & 0xff; this.bus.output(this.c, v);
        this.hl = (this.hl + inc) & 0xffff;
        this.f = SZ[this.b] | N;
        if (rep && this.b) { this.pc = (this.pc - 2) & 0xffff; this.cycles += 5; }
      }
      return;
    }
    this.cycles += 8; // undefined ED: a NOP
  }
}
