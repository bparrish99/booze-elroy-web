// Booze Elroy maze editor (private dev tool): `npm run dev`, then http://localhost:8888/editor/
import * as M from "./autotile.mjs";

const $ = (id) => document.getElementById(id);
const S8 = 30, S16 = 12, MAXC = 27; // sprite sheet columns; colours per wall glyph
const TOOLS = [
  { id: "#", name: "Wall" }, { id: ".", name: "Dots" }, { id: " ", name: "No dots" }, { id: "`", name: "Energizer" },
  { id: "_", name: "Tunnel" }, { id: ":", name: "No-up + dot" }, { id: ";", name: "No-up" }, { id: "glyph", name: "Glyph" }, { id: "dark", name: "After Dark" },
];
const GAME_NAME = /^booze([5-9]|[1-9]\d+)$/;
const AUTOSAVE = "booze-maze-editor-autosave";

let data, table, spr8, spr16, doc, gen, chk;
let tool = ".", scale = 3, hover = null, stroke = null, rect = null, flash = null, savedJSON = "", gameNames = [], drafts = [];
const undoStack = [], redoStack = [];

const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

// ------------------------------------------------------------------------------------------- drawing helpers
function blit(ctx, sheet, cols, size, i, x, y) { ctx.drawImage(sheet, (i % cols) * size, Math.floor(i / cols) * size, size, size, x, y, size, size); }
const glyphIndex = (g, color) => M.IDX.indexOf(M.upper(g)) * MAXC + 2 + ((color || 1) - 1);
function drawGlyph(ctx, g, x, y, color = doc.color) { blit(ctx, spr8, S8, 8, glyphIndex(g, color), x, y); }
function tileCanvas(glyphs, cols, color) { // small canvas of glyph tiles, e.g. a 2x2 block
  const c = document.createElement("canvas"); c.width = cols * 8; c.height = Math.ceil(glyphs.length / cols) * 8;
  const ctx = c.getContext("2d"); glyphs.forEach((g, i) => { if (g) drawGlyph(ctx, g, (i % cols) * 8, Math.floor(i / cols) * 8, color); });
  return c;
}

// ------------------------------------------------------------------------------------------- model
function regen() {
  gen = M.generate(doc, table);
  // drop choices that no longer fit after an edit
  let pruned = false;
  for (const k of Object.keys(doc.glyphs)) {
    const [x, y] = k.split(",").map(Number), i = gen.info[y][x];
    if (!i || i.fixed || !i.cands.includes(doc.glyphs[k])) { delete doc.glyphs[k]; pruned = true; }
  }
  for (const k of Object.keys(doc.visible)) { const [x, y] = k.split(",").map(Number); if (!gen.info[y][x]) { delete doc.visible[k]; pruned = true; } }
  if (pruned) gen = M.generate(doc, table);
  chk = M.check(doc, gen);
}
function changed() {
  regen(); render(); refreshPanel();
  try { localStorage.setItem(AUTOSAVE, JSON.stringify(doc)); } catch { /* ignore */ }
}
const snapshot = () => JSON.stringify(doc);
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 300) undoStack.shift(); redoStack.length = 0; }
function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); doc = JSON.parse(undoStack.pop()); changed(); }
function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); doc = JSON.parse(redoStack.pop()); changed(); }
function setDoc(d, saved) { doc = d; undoStack.length = 0; redoStack.length = 0; savedJSON = saved ? JSON.stringify(d) : ""; changed(); }

function nextFreeName() {
  for (let n = 5; ; n++) { const nm = "booze" + n; if (!gameNames.includes(nm) && !drafts.includes(nm)) return nm; }
}

// ------------------------------------------------------------------------------------------- rendering
const cv = $("maze"), ctx = cv.getContext("2d");
const off = document.createElement("canvas"); off.width = M.W * 8; off.height = M.H * 8;
const octx = off.getContext("2d");

function fitCanvas() {
  const aw = window.innerWidth - 340 - 32, ah = window.innerHeight - 40;
  scale = Math.max(1, Math.min(Math.floor(aw / off.width), Math.floor(ah / off.height)));
  if (scale < 2) scale = Math.max(1, Math.min(aw / off.width, ah / off.height));
  cv.width = Math.round(off.width * scale); cv.height = Math.round(off.height * scale);
  render();
}

function render() {
  if (!gen) return;
  const markers = $("markers").checked, dark = $("dark").checked;
  octx.fillStyle = "#000"; octx.fillRect(0, 0, off.width, off.height);
  for (let y = 0; y < M.H; y++) for (let x = 0; x < M.W; x++) {
    const i = gen.info[y][x], c = doc.cells[y][x];
    if (i) {
      if (!i.glyph) continue;
      if (dark && !i.outer) { octx.globalAlpha = 0.12; drawGlyph(octx, i.glyph, x * 8, y * 8); octx.globalAlpha = 1; } else drawGlyph(octx, i.glyph, x * 8, y * 8);
      continue;
    }
    if (markers && gen.cls(x, y) === "v" && !M.inPen(x, y)) { octx.fillStyle = (x + y) % 2 ? "#101018" : "#0c0c13"; octx.fillRect(x * 8, y * 8, 8, 8); }
    if (c === "." || c === ":") blit(octx, spr8, S8, 8, 0, x * 8, y * 8);
    if (c === "`") blit(octx, spr8, S8, 8, 1, x * 8, y * 8);
  }
  // Pac-Man and (as markers) the extra ghosts' starts
  blit(octx, spr16, S16, 16, 1, 112 - 8, 23 * 8 + 4 - 8);
  if (markers) {
    octx.globalAlpha = 0.75;
    blit(octx, spr16, S16, 16, 41, 112 - 8, doc.punky * 8 + 4 - 8);
    blit(octx, spr16, S16, 16, 49, 112 - 8, doc.gunky * 8 + 4 - 8);
    const gr = gronkyRow();
    if (gr !== null) {
      const centre = !M.tunnelRows(gen).includes(gr);
      blit(octx, spr16, S16, 16, 57, centre ? 112 - 8 : -8, gr * 8 + 4 - 8);
    }
    octx.globalAlpha = 1;
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, cv.width, cv.height);
  const T = 8 * scale, px = (x) => x * T;
  if (markers) {
    for (let y = 0; y < M.H; y++) for (let x = 0; x < M.W; x++) {
      const c = doc.cells[y][x], i = gen.info[y][x];
      if (c === "_" && !i) { // tunnel: blue hatching
        ctx.save(); ctx.beginPath(); ctx.rect(px(x), px(y), T, T); ctx.clip();
        ctx.strokeStyle = "rgba(90,140,255,.6)"; ctx.lineWidth = 1; ctx.beginPath();
        for (let k = -T; k < T; k += Math.max(4, T / 3)) { ctx.moveTo(px(x) + k, px(y) + T); ctx.lineTo(px(x) + k + T, px(y)); }
        ctx.stroke(); ctx.restore();
      }
      if ((c === ";" || c === ":") && !i) { // ghosts can't turn up here: a red bar on the tile's top edge with a little up arrow
        ctx.fillStyle = "#ff4d6d"; ctx.fillRect(px(x) + 1, px(y), T - 2, Math.max(2, scale));
        ctx.beginPath(); ctx.moveTo(px(x) + T / 2, px(y) + T * 0.28); ctx.lineTo(px(x) + T * 0.3, px(y) + T * 0.5); ctx.lineTo(px(x) + T * 0.7, px(y) + T * 0.5); ctx.fill();
      }
      if (i && !i.fixed && !i.auto) { ctx.fillStyle = "#ffb8ff"; ctx.fillRect(px(x) + T - scale * 2, px(y), scale * 2, scale * 2); }
    }
    // the fixed area, and the mirror line
    ctx.setLineDash([scale * 2, scale * 2]); ctx.lineWidth = 1; ctx.strokeStyle = "rgba(255,212,0,.35)";
    ctx.strokeRect(px(M.RING.x0) + .5, px(M.RING.y0) + .5, px(M.RING.x1 - M.RING.x0 + 1) - 1, px(M.RING.y1 - M.RING.y0 + 1) - 1);
    ctx.strokeRect(px(13) + .5, px(M.PAC_START.y) + .5, px(2) - 1, T - 1);
    ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.beginPath(); ctx.moveTo(px(14) + .5, 0); ctx.lineTo(px(14) + .5, cv.height); ctx.stroke();
    ctx.setLineDash([]);
  }
  // problems: errors outlined red; the one picked in the list flashes
  for (const p of chk.problems) if (p.level === "error") for (const [x, y] of p.tiles) { ctx.strokeStyle = "rgba(255,90,90,.85)"; ctx.lineWidth = Math.max(1, scale / 2); ctx.strokeRect(px(x) + 1, px(y) + 1, T - 2, T - 2); }
  if (flash && performance.now() < flash.until) {
    const on = Math.floor((flash.until - performance.now()) / 180) % 2 === 0;
    if (on) for (const [x, y] of flash.tiles) { ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.fillRect(px(x), px(y), T, T); }
    requestAnimationFrame(render);
  }
  // brush preview
  const cells = rect ? rectCells(rect.a, rect.b) : hover && !stroke ? [hover] : [];
  ctx.lineWidth = Math.max(1, scale / 2);
  for (const [x, y] of cells) for (const xx of new Set([x, M.mirrorX(x)])) {
    ctx.strokeStyle = xx === x ? "rgba(255,212,0,.95)" : "rgba(255,212,0,.4)";
    ctx.strokeRect(px(xx) + 1, px(y) + 1, T - 2, T - 2);
  }
}

function gronkyRow() { if (doc.gronky !== null && doc.gronky !== undefined) return doc.gronky; const t = M.tunnelRows(gen); return t.length ? t[0] : null; }

// ------------------------------------------------------------------------------------------- painting
function cellAt(e) {
  const r = cv.getBoundingClientRect();
  const x = Math.floor((e.clientX - r.left) / (r.width / M.W)), y = Math.floor((e.clientY - r.top) / (r.height / M.H));
  return x >= 0 && y >= 0 && x < M.W && y < M.H ? [x, y] : null;
}
function rectCells(a, b) {
  const out = [];
  for (let y = Math.min(a[1], b[1]); y <= Math.max(a[1], b[1]); y++) for (let x = Math.min(a[0], b[0]); x <= Math.max(a[0], b[0]); x++) out.push([x, y]);
  return out;
}
function lineCells(a, b) { // Bresenham, so fast drags don't leave gaps
  const out = []; let [x0, y0] = a; const [x1, y1] = b;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1; let err = dx + dy;
  for (;;) { out.push([x0, y0]); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
  return out;
}
const paintKind = (button) => button !== 2 ? tool : tool === "#" ? "." : "#"; // right button: wall (or dots, with the Wall tool)
function paint(cells, kind) { let ch = false; for (const [x, y] of cells) if (M.setCell(doc, x, y, kind)) ch = true; return ch; }

cv.addEventListener("contextmenu", (e) => e.preventDefault());
cv.addEventListener("mousedown", (e) => {
  const c = cellAt(e); if (!c) return;
  hidePicker();
  if (tool === "glyph") { if (e.button === 2) resetGlyph(c); else openPicker(c, e); return; }
  if (tool === "dark") { if (e.button === 0) toggleDark(c); return; }
  const kind = paintKind(e.button);
  pushUndo();
  if (e.shiftKey) { rect = { a: c, b: c, kind }; render(); return; }
  stroke = { last: c, kind, changed: paint([c], kind) };
  if (stroke.changed) changed();
});
window.addEventListener("mousemove", (e) => {
  const c = cellAt(e);
  if (rect) { if (c) { rect.b = c; render(); } return; }
  if (stroke && c) { if (paint(lineCells(stroke.last, c), stroke.kind)) { stroke.changed = true; changed(); } stroke.last = c; }
  if ((c || "") + "" !== (hover || "") + "") { hover = c; render(); status(); }
});
window.addEventListener("mouseup", () => {
  if (rect) { const ch = paint(rectCells(rect.a, rect.b), rect.kind); rect = null; if (ch) changed(); else { undoStack.pop(); render(); } }
  if (stroke) { if (!stroke.changed) undoStack.pop(); stroke = null; }
});
cv.addEventListener("mouseleave", () => { hover = null; render(); status(); });

function status() {
  const el = $("status");
  if (!hover) { el.textContent = ""; return; }
  const [x, y] = hover, c = doc.cells[y][x], i = gen.info[y][x];
  const names = { "#": "wall", ".": "dot", " ": "no dot", "`": "energizer", "_": "tunnel", ";": "no-up", ":": "no-up + dot" };
  let s = `x ${x}  y ${y}   ${M.isLocked(x, y) ? "fixed · " : ""}${i ? "wall " + (i.glyph || "?") + (i.fixed ? "" : i.auto ? " (auto)" : " (chosen)") + (i.outer ? "" : " · hidden in After Dark") : names[c] || c}`;
  if (!i && gen.cls(x, y) === "v" && !M.inPen(x, y)) s += " · outside (unreachable)";
  el.textContent = s;
}

// ------------------------------------------------------------------------------------------- glyph picker / After Dark
const picker = $("picker");
function hidePicker() { picker.style.display = "none"; }
function setGlyph([x, y], g) {
  pushUndo();
  const k = (xx) => xx + "," + y, mx = M.mirrorX(x);
  if (g === null) { delete doc.glyphs[k(x)]; delete doc.glyphs[k(mx)]; } else { doc.glyphs[k(x)] = g; doc.glyphs[k(mx)] = M.MIRROR[g]; }
  changed();
}
function resetGlyph(c) { const i = gen.info[c[1]][c[0]]; if (i && !i.fixed && !i.auto) setGlyph(c, null); }
function openPicker([x, y], e) {
  const i = gen.info[y][x];
  if (!i || i.fixed) return;
  picker.innerHTML = "";
  const head = document.createElement("div"); head.className = "t"; head.textContent = `Fits here (${i.auto ? "automatic" : "your choice"}):`; picker.append(head);
  const mk = (list, cls) => {
    const box = document.createElement("div"); box.className = "g";
    for (const g of list) {
      const c = tileCanvas([g], 1); c.title = g; if (cls) c.classList.add(cls); if (g === i.glyph) c.classList.add("on");
      c.onclick = () => { hidePicker(); setGlyph([x, y], g === i.cands[0] ? null : g); };
      box.append(c);
    }
    picker.append(box);
  };
  mk(i.cands, "fit");
  const auto = document.createElement("button"); auto.textContent = "Automatic"; auto.style.marginTop = "6px";
  auto.onclick = () => { hidePicker(); setGlyph([x, y], null); }; picker.append(auto);
  picker.style.display = "block";
  picker.style.left = Math.min(e.clientX + 12, window.innerWidth - picker.offsetWidth - 8) + "px";
  picker.style.top = Math.min(e.clientY + 12, window.innerHeight - picker.offsetHeight - 8) + "px";
}
document.addEventListener("mousedown", (e) => { if (!picker.contains(e.target) && e.target !== cv) hidePicker(); });

function toggleDark([x, y]) {
  const i = gen.info[y][x];
  if (!i || i.fixed) return;
  pushUndo();
  const val = !i.outer, regions = new Set([i.region]);
  const mi = gen.info[y][M.mirrorX(x)]; if (mi && !mi.fixed) regions.add(mi.region);
  for (let yy = 0; yy < M.H; yy++) for (let xx = 0; xx < M.W; xx++) { const t = gen.info[yy][xx]; if (t && !t.fixed && regions.has(t.region)) doc.visible[xx + "," + yy] = val; }
  changed();
}

// ------------------------------------------------------------------------------------------- panel
function buildTools() {
  const box = $("tools");
  const icon = (t) => {
    const c = document.createElement("canvas"); c.width = 16; c.height = 16; const g = c.getContext("2d");
    if (t === "#") [["A", 0, 0], ["C", 8, 0], ["D", 0, 8], ["F", 8, 8]].forEach(([q, x, y]) => drawGlyph(g, q, x, y));
    if (t === "." || t === ":") blit(g, spr8, S8, 8, 0, 4, 4);
    if (t === "`") blit(g, spr8, S8, 8, 1, 4, 4);
    if (t === "_") { g.strokeStyle = "#5a8cff"; for (let k = -16; k < 16; k += 5) { g.beginPath(); g.moveTo(k, 16); g.lineTo(k + 16, 0); g.stroke(); } }
    if (t === ";" || t === ":") { g.fillStyle = "#ff4d6d"; g.fillRect(1, 1, 14, 2); }
    if (t === "glyph") drawGlyph(g, "1", 4, 4);
    if (t === "dark") { [["A", 0, 0], ["C", 8, 0]].forEach(([q, x, y]) => drawGlyph(g, q, x, y)); g.globalAlpha = .25; [["D", 0, 8], ["F", 8, 8]].forEach(([q, x, y]) => drawGlyph(g, q, x, y)); }
    return c;
  };
  box.innerHTML = "";
  TOOLS.forEach((t, n) => {
    const b = document.createElement("button"); b.className = "tool" + (t.id === tool ? " on" : ""); b.dataset.tool = t.id;
    b.append(icon(t.id), document.createTextNode(t.name)); const k = document.createElement("kbd"); k.textContent = n + 1; b.append(k);
    b.onclick = () => setTool(t.id); box.append(b);
  });
}
function setTool(t) { tool = t; hidePicker(); for (const b of $("tools").children) b.classList.toggle("on", b.dataset.tool === t); render(); }

function buildColors() {
  const box = $("colors"); box.innerHTML = "";
  for (let c = 1; c <= MAXC; c++) {
    const cnv = tileCanvas(["A", "C", "D", "F"], 2, c); cnv.title = "colour " + c; cnv.dataset.c = c;
    cnv.onclick = () => { pushUndo(); doc.color = c; changed(); }; box.append(cnv);
  }
}

function fillRowSelect(sel, rows, value, labelOf) {
  sel.innerHTML = "";
  const list = rows.includes(value) || value === null ? rows : rows.concat([value]).sort((a, b) => a - b);
  for (const r of list) { const o = document.createElement("option"); o.value = r; o.textContent = labelOf(r); sel.append(o); }
  sel.value = value === null ? (list[0] ?? "") : value;
}

function refreshPanel() {
  if ($("name") !== document.activeElement) $("name").value = doc.name;
  $("dirty").textContent = JSON.stringify(doc) === savedJSON ? "" : "● unsaved";
  for (const c of $("colors").children) c.classList.toggle("on", Number(c.dataset.c) === doc.color);
  const mid = []; for (let y = 0; y < M.H; y++) if (gen.cls(13, y) === "p" && gen.cls(14, y) === "p") mid.push(y);
  const tun = M.tunnelRows(gen);
  const midLabel = (r) => "row " + r + (mid.includes(r) ? "" : " (blocked!)");
  fillRowSelect($("punky"), mid, doc.punky, midLabel);
  fillRowSelect($("gunky"), mid, doc.gunky, midLabel);
  const gr = [...new Set(tun.concat(mid))].sort((a, b) => a - b);
  fillRowSelect($("gronky"), gr, gronkyRow(), (r) => "row " + r + (tun.includes(r) ? " (side tunnel)" : mid.includes(r) ? " (middle)" : " (blocked!)"));
  const sc = $("scatter"), scName = Object.keys(M.SCATTER).find((k) => JSON.stringify(M.SCATTER[k]) === JSON.stringify(sortScatter(doc.scatter)));
  [...sc.options].filter((o) => o.value === "custom").forEach((o) => o.remove());
  if (!scName) { const o = document.createElement("option"); o.value = "custom"; o.textContent = "custom (kept)"; sc.append(o); }
  sc.value = scName || "custom";
  if ($("fruit") !== document.activeElement) $("fruit").value = doc.fruitTriggers.join(", ");
  if ($("siren") !== document.activeElement) $("siren").value = doc.sirenTriggers.join(", ");
  const ul = $("problems"); ul.innerHTML = "";
  if (!chk.problems.length) { const li = document.createElement("li"); li.className = "ok"; li.textContent = "✓ No problems"; ul.append(li); }
  for (const p of chk.problems.slice().sort((a, b) => (a.level === "error" ? 0 : 1) - (b.level === "error" ? 0 : 1))) {
    const li = document.createElement("li"); li.className = p.level;
    li.textContent = p.text + (p.tiles.length > 1 ? ` (${p.tiles.length})` : "");
    li.onclick = () => { flash = { tiles: p.tiles, until: performance.now() + 1500 }; render(); };
    ul.append(li);
  }
  $("stats").innerHTML = `<b>${chk.dots}</b> dots · <b>${chk.powers}</b> energizers · tunnels: <b>${tun.length ? "rows " + tun.join(", ") : "none"}</b>`;
  $("add").disabled = chk.problems.some((p) => p.level === "error");
  $("undo").disabled = !undoStack.length; $("redo").disabled = !redoStack.length;
}

$("name").addEventListener("input", (e) => { const v = e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16); doc.name = v; refreshPanel(); });
$("name").addEventListener("change", () => changed());
for (const id of ["punky", "gunky", "gronky"]) $(id).addEventListener("change", (e) => { pushUndo(); doc[id] = Number(e.target.value); changed(); });
const sortScatter = (sc) => sc ? { blinky: sc.blinky, pinky: sc.pinky, inky: sc.inky, clyde: sc.clyde } : M.SCATTER.standard;
$("scatter").addEventListener("change", (e) => { if (!M.SCATTER[e.target.value]) return; pushUndo(); doc.scatter = JSON.parse(JSON.stringify(M.SCATTER[e.target.value])); changed(); });
const numList = (s) => s.split(/[\s,]+/).filter(Boolean).map(Number).filter((n) => Number.isInteger(n) && n > 0);
$("fruit").addEventListener("change", (e) => { const v = numList(e.target.value); if (v.length) { pushUndo(); doc.fruitTriggers = v; } changed(); });
$("siren").addEventListener("change", (e) => { const v = numList(e.target.value); if (v.length) { pushUndo(); doc.sirenTriggers = v; } changed(); });
$("markers").addEventListener("change", render);
$("dark").addEventListener("change", render);
$("undo").onclick = undo; $("redo").onclick = redo;

function msg(text, cls) { const m = $("msg"); m.textContent = text; m.className = cls || ""; }

// ------------------------------------------------------------------------------------------- files
async function api(path, body) {
  const r = await fetch("/editor/api/" + path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
}
async function refreshLists() { try { const l = await api("list"); drafts = l.drafts; gameNames = l.game; } catch { /* offline: keep what we have */ } }

async function save() {
  if (!doc.name) { msg("Give the maze a name first.", "err"); return; }
  try { await api("draft", { doc }); savedJSON = JSON.stringify(doc); await refreshLists(); refreshPanel(); msg("Saved mazes/" + doc.name + ".json", "good"); }
  catch (e) { msg("Save failed: " + e.message, "err"); }
}
function testPlay() {
  if (chk.problems.some((p) => p.level === "error") && !confirm("This maze has problems (outlined red). Play it anyway?")) return;
  try { localStorage.setItem("booze-elroy-editor-test", JSON.stringify(M.toMazeData(doc, gen))); } catch { msg("Couldn't hand the maze to the game (localStorage).", "err"); return; }
  window.open("/?testmaze", "booze-elroy-test");
  msg("Test play: any maze pack plays this maze. Leaderboards are off in test play.");
}
async function addToGame() {
  if (!GAME_NAME.test(doc.name)) { msg(`To join the game a maze is named booze5, booze6, ... ("${nextFreeName()}" is free).`, "err"); return; }
  if (gameNames.includes(doc.name) && !confirm(doc.name + " is already in the game. Replace it with this version?")) return;
  msg("Adding " + doc.name + " and rebuilding…");
  try {
    const r = await api("add", { doc, maze: M.toMazeData(doc, gen) });
    savedJSON = JSON.stringify(doc); await refreshLists(); refreshPanel();
    const n = gameNames.filter((g) => /^booze\d+$/.test(g)).length;
    msg((r.isNew ? `${doc.name} is in the game: the Booze pack has ${n} mazes now (Normal and All play it too).` : `${doc.name} updated in the game.`) +
      (r.ok ? "\nRebuilt public/index.html. Reload the game tab to see it. Commit assets/data.json, mazes/" + doc.name + ".json and public/index.html."
        : "\nThe rebuild failed, run npm run build:\n" + r.build), r.ok ? "good" : "err");
  } catch (e) { msg("Add failed: " + e.message, "err"); }
}

async function openDialog() {
  await refreshLists();
  const dl = $("openDlg"), dbox = $("drafts"), gbox = $("games");
  dbox.innerHTML = ""; gbox.innerHTML = "";
  const btn = (label, fn) => { const b = document.createElement("button"); b.textContent = label; b.onclick = () => { dl.close(); fn(); }; return b; };
  if (!drafts.length) dbox.textContent = "(none yet)";
  for (const d of drafts) dbox.append(btn(d, async () => { if (!confirmDiscard()) return; try { setDoc(M.applyLocks(await api("draft?name=" + d)), true); msg("Opened draft " + d); } catch (e) { msg("Couldn't open " + d + ": " + e.message, "err"); } }));
  for (const g of gameNames) {
    const m = data.mazes[g];
    if (!m || !M.editable(m)) continue;
    gbox.append(btn(g, () => {
      if (!confirmDiscard()) return;
      const d = M.fromMazeData(g, m, table);
      if (!GAME_NAME.test(g)) d.name = nextFreeName();
      setDoc(d, false); msg(`Started from ${g}` + (d.name !== g ? `, as ${d.name}` : "") + ".");
    }));
  }
  dl.showModal();
}
function confirmDiscard() { return JSON.stringify(doc) === savedJSON || confirm("Discard the unsaved changes to " + (doc.name || "this maze") + "?"); }

$("new").onclick = () => { if (!confirmDiscard()) return; setDoc(M.blankDoc(nextFreeName()), false); msg("New maze: solid wall. Carve paths with Dots (right-click puts wall back), open tunnels, then test play."); };
$("open").onclick = openDialog;
$("save").onclick = save;
$("play").onclick = testPlay;
$("add").onclick = addToGame;

window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); save(); return; }
  if (mod && e.key === "Enter") { e.preventDefault(); testPlay(); return; }
  if (e.key === "Escape") hidePicker();
  if (!mod && e.key >= "1" && e.key <= "9") setTool(TOOLS[Number(e.key) - 1].id);
});
window.addEventListener("resize", fitCanvas);

// ------------------------------------------------------------------------------------------- start
(async function start() {
  [data, spr8, spr16] = await Promise.all([fetch("data.json").then((r) => r.json()), loadImg("spr8.png"), loadImg("spr16.png")]);
  table = M.learn(data);
  gameNames = data.mazeNames.slice();
  await refreshLists();
  let d = null;
  try { d = JSON.parse(localStorage.getItem(AUTOSAVE) || "null"); } catch { /* ignore */ }
  doc = d && Array.isArray(d.cells) && d.cells.length === M.H ? M.applyLocks(d) : M.blankDoc(nextFreeName());
  buildTools(); buildColors();
  regen(); fitCanvas(); refreshPanel();
  window.__editor = { get doc() { return doc; }, get gen() { return gen; }, get chk() { return chk; }, M, setTool, table: () => table };
})();
