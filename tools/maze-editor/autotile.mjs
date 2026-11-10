// Maze editor core (no DOM): the cell model, wall auto-tiling, mirroring, checks, import from and export to data.json.
// Used by the editor page (tools/maze-editor/editor.mjs) and by tests/maze-editor.test.mjs.
//
// A document is what the editor saves (mazes/<name>.json):
//   { name, color, cells: [31 strings of 28 chars], glyphs: { "x,y": "B" }, visible: { "x,y": true|false },
//     punky: y, gunky: y, gronky: y|null, scatter: SCATTER.standard or the like, fruitTriggers, sirenTriggers }
// cells use the game's own non-wall characters, plus "#" for wall:
//   "#" wall   "." dot   " " empty path   "`" energizer   "_" tunnel (slows ghosts, no dot)
//   ";" restricted (ghosts can't turn up, no dot)   ":" restricted with a dot
// Wall glyphs are worked out from the walls around them (see glyphFor); `glyphs` holds the author's per-tile choices
// where several glyphs fit. `visible` overrides After Dark visibility (upper case = stays visible).

export const W = 28, H = 31;
export const IDX = "123456789ABCDEFGHIJKLMNOPQRSTUVWXY";
const UPPER_MAP = { "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9" };
const LOWER_MAP = Object.fromEntries(Object.entries(UPPER_MAP).map(([k, v]) => [v, k]));
export const upper = (c) => UPPER_MAP[c] || c.toUpperCase();
export const lower = (c) => LOWER_MAP[c] || (c === "1" ? "1" : c.toLowerCase());
export const isWallChar = (c) => c !== undefined && IDX.includes(upper(c));
// left-right mirror image of each glyph (from the symmetric mazes)
export const MIRROR = { 1: "5", 2: "2", 3: "4", 4: "3", 5: "1", 6: "9", 7: "8", 8: "7", 9: "6", A: "C", B: "B", C: "A", D: "F", E: "E", F: "D",
  G: "H", H: "G", I: "M", J: "J", K: "L", L: "K", M: "I", N: "R", O: "Q", P: "P", Q: "O", R: "N", S: "T", T: "S", U: "W", V: "X", W: "U", X: "V", Y: "Y" };
// where the ghosts head in scatter mode: the arcade's corners off the maze, or (booze2, booze3: vertical tunnels in the
// corners) spots inside it
export const SCATTER = {
  standard: { blinky: { x: 25, y: -4 }, pinky: { x: 2, y: -4 }, inky: { x: 27, y: 30 }, clyde: { x: 0, y: 30 } },
  inside: { blinky: { x: 20, y: 3 }, pinky: { x: 4, y: 3 }, inky: { x: 23, y: 22 }, clyde: { x: 4, y: 22 } },
};
export const PATH_KINDS = [".", " ", "`", "_", ";", ":"];

// The standard ghost pen (as in pac, mspac, booze and ultra), its surrounding no-dot ring, and Pac-Man's start:
// fixed in every maze the editor makes.
export const PEN = { x: 10, y: 12, rows: ["NJOPPQJR", "9      6", "9      6", "9      6", "S222222T"] };
export const RING = { x0: 9, x1: 18, y0: 11, y1: 17 };
export const PAC_START = { x: 14, y: 23 };
export const inPen = (x, y) => x >= PEN.x && x < PEN.x + 8 && y >= PEN.y && y < PEN.y + 5;
export const isLocked = (x, y) => (x >= RING.x0 && x <= RING.x1 && y >= RING.y0 && y <= RING.y1) || (y === PAC_START.y && (x === 13 || x === 14));
export const lockedKind = (x, y) => inPen(x, y) ? (PEN.rows[y - PEN.y][x - PEN.x] === " " ? " " : "#") : " ";

const key = (x, y) => x + "," + y;
export const mirrorX = (x) => W - 1 - x;

// ---------------------------------------------------------------------------------------------- classification
// "W" wall, "p" path Pac-Man can reach (wrapping through open edges), "v" void (outside the maze, the pen inside)
export function classify(cells, start = PAC_START) {
  const h = cells.length, w = cells[0].length;
  const wall = (x, y) => cells[y][x] === "#";
  const reach = Array.from({ length: h }, () => Array(w).fill(false));
  const st = [[start.x, start.y], [start.x - 1, start.y]];
  while (st.length) {
    let [x, y] = st.pop(); x = (x + w) % w; y = (y + h) % h;
    if (reach[y][x] || wall(x, y) || cells[y][x] === undefined) continue;
    reach[y][x] = true; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return (x, y) => (x < 0 || y < 0 || x >= w || y >= h || cells[y][x] === undefined) ? "v" : wall(x, y) ? "W" : reach[y][x] ? "p" : "v";
}

// Each tile is four quarter-tiles. A wall quarter is filled unless one of the three tiles it faces (side, side,
// diagonal) is a path: walls end half-way into a tile next to a corridor, and run to the tile edge next to the void.
function halfFill(cls) {
  return (hx, hy) => {
    const x = Math.floor(hx / 2), y = Math.floor(hy / 2);
    if (cls(x, y) !== "W") return 0;
    const sx = hx % 2 ? 1 : -1, sy = hy % 2 ? 1 : -1;
    return cls(x + sx, y) === "p" || cls(x, y + sy) === "p" || cls(x + sx, y + sy) === "p" ? 0 : 1;
  };
}
// the 4x4 quarter-tiles centred on a tile (its own 2x2 in the middle), and the coarser own+edges key
function ringKey(hf, x, y) { let k = ""; for (let hy = 2 * y - 1; hy <= 2 * y + 2; hy++) for (let hx = 2 * x - 1; hx <= 2 * x + 2; hx++) k += hf(hx, hy); return k; }
const ownOf = (rk) => rk[5] + rk[6] + rk[9] + rk[10];
const edgeOf = (rk) => ownOf(rk) + "|" + rk[1] + rk[2] + rk[7] + rk[11] + rk[14] + rk[13] + rk[8] + rk[4];

// ---------------------------------------------------------------------------------------------- learning
// The glyph table is learned from the existing mazes in data.json: for every wall tile, which glyph the author used
// for its neighbourhood (mirrored too). Ghost pens are left out (the editor's pen is fixed).
export function learn(data) {
  const ring = new Map(), edge = new Map(), own = new Map();
  const add = (m, k, g) => { if (!m.has(k)) m.set(k, new Map()); const t = m.get(k); t.set(g, (t.get(g) || 0) + 1); };
  for (const name of data.mazeNames) {
    const m = data.mazes[name], map = m.map, h = map.length, w = Math.max(...map.map((r) => r.length));
    const cells = map.map((r) => Array.from({ length: w }, (_, x) => isWallChar(r[x]) ? "#" : (r[x] === undefined ? " " : r[x])).join(""));
    const cls = classify(cells, m.pacStart), hf = halfFill(cls);
    const hc = m.houseCenter;
    // the same tiles mirrored
    const mcells = cells.map((r) => [...r].reverse().join(""));
    const mcls = classify(mcells, { x: w - m.pacStart.x, y: m.pacStart.y }), mhf = halfFill(mcls);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (cls(x, y) !== "W") continue;
      if (x >= hc.x - 4 && x < hc.x + 4 && y >= hc.y - 2 && y <= hc.y + 2) continue; // the pen
      const g = upper(map[y][x]);
      for (const [k, gl] of [[ringKey(hf, x, y), g], [ringKey(mhf, w - 1 - x, y), MIRROR[g]]]) {
        add(ring, k, gl); add(edge, edgeOf(k), gl); add(own, ownOf(k), gl);
      }
    }
  }
  const rank = (t) => [...t].sort((a, b) => b[1] - a[1] || IDX.indexOf(a[0]) - IDX.indexOf(b[0])).map((e) => e[0]);
  const fin = (m) => new Map([...m].map(([k, t]) => [k, rank(t)]));
  return { ring: fin(ring), edge: fin(edge), own: fin(own) };
}

// the candidate glyphs for a neighbourhood, best first ([] = no glyph can draw it)
export function candidates(table, rk) {
  const out = [];
  const push = (list) => { if (list) for (const g of list) if (!out.includes(g)) out.push(g); };
  push(table.ring.get(rk));
  push(table.edge.get(edgeOf(rk)));
  if (!out.length) { // nearest learned neighbourhood with the same own quarters
    const own = ownOf(rk); let best = null, bd = 99;
    for (const [k, list] of table.ring) {
      if (ownOf(k) !== own) continue;
      let dd = 0; for (let i = 0; i < 16; i++) if (k[i] !== rk[i]) dd++;
      if (dd < bd) { bd = dd; best = list; }
    }
    push(best);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- documents
// The dot grid ("connect the dots"): with walls 2 thick, paths can run every third row and column. These are the ones
// that fit the fixed parts: the ring's sides (columns 9, 18; rows 11, 17), the tunnel row 14 and Pac-Man's row 23.
// Nodes are where grid lines cross; segments are the 2-tile gaps between nodes (and the runs out to the edges, for
// tunnels). A new maze is 2x2 wall blocks with every grid path open and dotted: filling a segment joins two blocks.
export const GRID = { cols: [3, 6, 9, 12, 15, 18, 21, 24], rows: [2, 5, 8, 11, 14, 17, 20, 23, 26, 29] };
const GCOL = new Set(GRID.cols), GROW = new Set(GRID.rows);
export const onGrid = (x, y) => GCOL.has(x) || GROW.has(y);
export const isNode = (x, y) => GCOL.has(x) && GROW.has(y);
const inner = (x, y) => x >= GRID.cols[0] && x <= GRID.cols.at(-1) && y >= GRID.rows[0] && y <= GRID.rows.at(-1);
// the segment a grid tile belongs to (null for a node or a tile off the grid)
export function segmentOf(x, y) {
  if (isNode(x, y) || !onGrid(x, y)) return null;
  const out = [];
  if (GCOL.has(x)) { let a = y; while (a - 1 >= 0 && !GROW.has(a - 1)) a--; for (let yy = a; yy < H && !GROW.has(yy); yy++) out.push([x, yy]); }
  else { let a = x; while (a - 1 >= 0 && !GCOL.has(a - 1)) a--; for (let xx = a; xx < W && !GCOL.has(xx); xx++) out.push([xx, y]); }
  return out;
}
// does a document keep to the grid? (everything off it is wall)
export function fitsGrid(doc) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!onGrid(x, y) && !isLocked(x, y) && doc.cells[y][x] !== "#") return false;
  return true;
}
// nodes follow their segments: wall when every way out is wall, open (dotted) as soon as one is
export function settleNodes(doc) {
  let changed = false;
  for (const y of GRID.rows) for (const x of GRID.cols) {
    if (isLocked(x, y)) continue;
    const ns = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < W && b < H).map(([a, b]) => doc.cells[b][a]);
    const open = ns.filter((c) => c !== "#"), c = doc.cells[y][x];
    if (!open.length && c !== "#") changed = setCell(doc, x, y, "#") || changed;
    if (open.length && c === "#") changed = setCell(doc, x, y, open.some((k) => k === "." || k === "`" || k === ":") ? "." : " ") || changed;
  }
  return changed;
}
// paint on the grid: walls fill (or open) a whole segment; path kinds change one open tile; nodes look after themselves
const OPEN_WITH = { "`": ".", ":": ".", ";": " " }; // opening a segment with an energizer / no-up tile: the rest of it
export function paintGrid(doc, x, y, kind) {
  if (!onGrid(x, y) || isLocked(x, y)) return false;
  const seg = segmentOf(x, y);
  let changed = false;
  if (kind === "#") { if (seg) for (const [a, b] of seg) changed = setCell(doc, a, b, "#") || changed; }
  else if (doc.cells[y][x] !== "#") changed = setCell(doc, x, y, kind);
  else if (seg) for (const [a, b] of seg) changed = setCell(doc, a, b, a === x && b === y ? kind : OPEN_WITH[kind] || kind) || changed;
  if (changed) settleNodes(doc);
  return changed;
}

export function blankDoc(name = "booze5") {
  const cells = [];
  for (let y = 0; y < H; y++) {
    let r = "";
    for (let x = 0; x < W; x++) r += onGrid(x, y) && inner(x, y) ? "." : y === 14 && (x < 3 || x > 24) ? "_" : "#";
    cells.push(r);
  }
  for (const [x, y] of [[3, 5], [24, 5], [3, 23], [24, 23]]) cells[y] = cells[y].slice(0, x) + "`" + cells[y].slice(x + 1);
  const doc = { name, grid: true, color: 17, cells, glyphs: {}, visible: {}, punky: 8, gunky: 29, gronky: null, scatter: SCATTER.standard, fruitTriggers: [170, 70], sirenTriggers: [20, 40, 100, 150] };
  return applyLocks(doc);
}

export function applyLocks(doc) {
  doc.cells = doc.cells.map((r, y) => [...r].map((c, x) => isLocked(x, y) ? lockedKind(x, y) : c).join(""));
  return doc;
}

export const getCell = (doc, x, y) => doc.cells[y][x];
// set a cell and its mirror image (locked cells don't change); returns true if anything changed
export function setCell(doc, x, y, kind) {
  let changed = false;
  for (const xx of new Set([x, mirrorX(x)])) {
    if (isLocked(xx, y) || doc.cells[y][xx] === kind) continue;
    const r = doc.cells[y]; doc.cells[y] = r.slice(0, xx) + kind + r.slice(xx + 1); changed = true;
    delete doc.glyphs[key(xx, y)];
  }
  return changed;
}

// Work out every tile's map character. Returns { map: [31 strings], info: per-tile { cands, glyph, outer } , cls }
// grid mazes: wall deep in the border (no path next to it, even diagonally, and connected to the map edge) is the
// outside void, as in the arcade mazes, so the outer wall is one tile (the double line) whatever the margin
export function outerVoid(cells) {
  const open = (x, y) => x >= 0 && y >= 0 && x < W && y < H && cells[y][x] !== "#";
  const deep = (x, y) => cells[y][x] === "#" && ![-1, 0, 1].some((dy) => [-1, 0, 1].some((dx) => open(x + dx, y + dy)));
  const out = cells.map((r) => [...r]), seen = new Set(), st = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (x === 0 || y === 0 || x === W - 1 || y === H - 1) st.push([x, y]);
  while (st.length) {
    const [x, y] = st.pop();
    if (x < 0 || y < 0 || x >= W || y >= H || seen.has(key(x, y)) || !deep(x, y)) continue;
    seen.add(key(x, y)); out[y][x] = " ";
    st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return out.map((r) => r.join(""));
}

export function generate(doc, table) {
  const cells = doc.grid ? outerVoid(doc.cells) : doc.cells;
  const cls = classify(cells), hf = halfFill(cls);
  // wall regions (4-connected) that touch the map edge or the outside void stay visible in After Dark ("outer")
  const outside = Array.from({ length: H }, () => Array(W).fill(false)); // void connected to the map edge
  const st = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if ((x === 0 || y === 0 || x === W - 1 || y === H - 1) && cls(x, y) === "v") st.push([x, y]);
  while (st.length) { const [x, y] = st.pop(); if (x < 0 || y < 0 || x >= W || y >= H || outside[y][x] || cls(x, y) !== "v") continue; outside[y][x] = true; st.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]); }
  const region = Array.from({ length: H }, () => Array(W).fill(-1)); const outerOf = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (cls(x, y) !== "W" || region[y][x] >= 0 || inPen(x, y)) continue;
    const id = outerOf.length; let o = false; const s = [[x, y]]; region[y][x] = id;
    while (s.length) {
      const [a, b] = s.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = a + dx, v = b + dy;
        if (u < 0 || v < 0 || u >= W || v >= H) { o = true; continue; }
        if (cls(u, v) === "W" && !inPen(u, v)) { if (region[v][u] < 0) { region[v][u] = id; s.push([u, v]); } } else if (outside[v][u]) o = true;
      }
    }
    outerOf.push(o);
  }
  const map = [], info = [];
  for (let y = 0; y < H; y++) {
    let row = ""; const irow = [];
    for (let x = 0; x < W; x++) {
      const c = cells[y][x];
      if (inPen(x, y)) { const p = PEN.rows[y - PEN.y][x - PEN.x]; row += p; irow.push(p === " " ? null : { glyph: p, cands: [p], outer: true, fixed: true }); continue; }
      if (cls(x, y) !== "W") { row += c === "#" ? " " : c; irow.push(null); continue; }
      const cands = candidates(table, ringKey(hf, x, y));
      const chosen = doc.glyphs[key(x, y)];
      const glyph = chosen && IDX.includes(chosen) ? chosen : cands[0];
      const v = doc.visible[key(x, y)];
      const outer = v === undefined ? outerOf[region[y][x]] : v;
      row += glyph ? (outer ? glyph : lower(glyph)) : "Y";
      irow.push({ glyph: glyph || null, cands, outer, region: region[y][x], auto: !chosen });
    }
    map.push(row); info.push(irow);
  }
  return { map, info, cls, region };
}

// ---------------------------------------------------------------------------------------------- checks
// Problems that would break the maze (errors) or look/play oddly (warnings). Each: { level, text, tiles: [[x,y]...] }
export function check(doc, gen) {
  const out = [];
  const { info, cls } = gen;
  const add = (level, text, tiles) => out.push({ level, text, tiles });
  const addTiles = (level, text, tiles) => { if (tiles.length) add(level, text, tiles); };
  const t = { noGlyph: [], unreachable: [], vtun: [], dead: [] };
  let dots = 0, powers = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = doc.cells[y][x], i = info[y][x];
    if (i && !i.glyph) t.noGlyph.push([x, y]);
    if (c === "." || c === ":") dots++;
    if (c === "`") powers++;
    if ((c === "." || c === ":" || c === "`") && cls(x, y) !== "p") t.unreachable.push([x, y]);
    if (cls(x, y) === "p") {
      if (y === 0 || y === H - 1) { const o = H - 1 - y; if (cls(x, o) !== "p") t.vtun.push([x, y]); }
      let exits = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const u = (x + dx + W) % W, v = (y + dy + H) % H; if (cls(u, v) === "p" || ((x + dx < 0 || x + dx >= W) && cls(u, y) === "p") || ((y + dy < 0 || y + dy >= H) && cls(x, v) === "p")) exits++; }
      if (exits < 2) t.dead.push([x, y]);
    }
  }
  addTiles("error", "No wall glyph fits here: walls need to be at least 2 tiles thick (only the outer border can be 1 thick)", t.noGlyph);
  addTiles("error", "Dots or energizers Pac-Man can't reach: the level could never be finished", t.unreachable);
  addTiles("error", "Tunnel through the top/bottom edge with no opening on the other side", t.vtun);
  addTiles("warning", "Dead end", t.dead);
  const corridor = (y) => cls(13, y) === "p" && cls(14, y) === "p";
  if (!corridor(doc.punky)) add("error", "Punky's start (row " + doc.punky + ") must be a corridor through the two middle columns", [[13, doc.punky], [14, doc.punky]]);
  if (!corridor(doc.gunky)) add("error", "Gunky's start (row " + doc.gunky + ") must be a corridor through the two middle columns", [[13, doc.gunky], [14, doc.gunky]]);
  if (doc.gronky === null || doc.gronky === undefined) { if (!tunnelRows(gen).length) add("error", "Gronky starts in a side tunnel: the maze needs one (or set his start row to a middle corridor)", []); }
  else if (!tunnelRows(gen).includes(doc.gronky) && !corridor(doc.gronky)) add("error", "Gronky's start row " + doc.gronky + " is neither a side tunnel nor a middle corridor", [[0, doc.gronky]]);
  if (dots < Math.max(...doc.fruitTriggers) + 1) add("warning", `Only ${dots} dots: the first fruit appears when ${doc.fruitTriggers[0]} are left`, []);
  if (powers !== 4) add("warning", `${powers} energizers (the arcade mazes have 4)`, []);
  return { problems: out, dots, powers };
}

// rows where Pac-Man can run off the left/right edge
export const tunnelRows = (gen) => { const r = []; for (let y = 0; y < H; y++) if (gen.cls(0, y) === "p" && gen.cls(W - 1, y) === "p") r.push(y); return r; };

// ---------------------------------------------------------------------------------------------- export / import
// the data.json entry for a document (metadata as booze1 has it, with the document's own choices)
export function toMazeData(doc, gen) {
  const tr = tunnelRows(gen);
  const gronkyRow = doc.gronky ?? tr[0];
  const centreGronky = doc.gronky !== null && doc.gronky !== undefined && !tr.includes(doc.gronky);
  const sc = doc.scatter || SCATTER.standard;
  return {
    defaultColor: doc.color, fruitLoc: { x: 112, y: 140 }, fruitTriggers: doc.fruitTriggers.slice(),
    gronkyStart: centreGronky ? { x: 14, y: gronkyRow } : { x: -2, y: gronkyRow },
    gunkyStart: { x: 14, y: doc.gunky }, h: H, houseCenter: { x: 14, y: 14 }, map: gen.map.slice(), maxColors: 27,
    pacStart: { x: 14, y: 23 }, playerone: 14, punkyStart: { x: 14, y: doc.punky }, ready: 20,
    scatterPositions: { blinky: { ...sc.blinky }, clyde: { ...sc.clyde }, inky: { ...sc.inky }, pinky: { ...sc.pinky } },
    scatterTiles: [sc.blinky, sc.pinky, sc.inky, sc.clyde].map((p) => ({ ...p })),
    sirenTriggers: doc.sirenTriggers.slice(), w: W,
  };
}

// can this data.json maze be opened in the editor? (28x31 with the standard pen)
export function editable(m) {
  if (m.w !== W || m.h !== H || m.houseCenter.x !== 14 || m.houseCenter.y !== 14 || m.pacStart.x !== 14 || m.pacStart.y !== 23) return false;
  return PEN.rows.every((r, i) => [...r].every((c, j) => upper(m.map[PEN.y + i][PEN.x + j] || " ") === c));
}

// open an existing maze as a document; the author's glyph and After Dark choices are kept wherever they differ from
// what the editor would pick, so it exports back character for character
export function fromMazeData(name, m, table) {
  const cells = m.map.map((r) => Array.from({ length: W }, (_, x) => isWallChar(r[x]) ? "#" : (r[x] === undefined ? " " : r[x])).join(""));
  const doc = { name, color: m.defaultColor, cells, glyphs: {}, visible: {}, punky: m.punkyStart.y, gunky: m.gunkyStart.y,
    gronky: m.gronkyStart.y, scatter: JSON.parse(JSON.stringify(m.scatterPositions)), fruitTriggers: m.fruitTriggers.slice(), sirenTriggers: m.sirenTriggers.slice() };
  const gen = generate(doc, table);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = gen.info[y][x], c = m.map[y][x];
    if (!i || i.fixed) continue;
    if (upper(c) !== i.glyph) doc.glyphs[key(x, y)] = upper(c);
    const isUp = upper(c) === c && c !== "1" ? true : c === "1" ? i.outer : false;
    if (isUp !== i.outer) doc.visible[key(x, y)] = isUp;
  }
  return doc;
}
