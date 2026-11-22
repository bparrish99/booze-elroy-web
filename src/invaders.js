/* Booze Elroy - BOOZE INVADERS (web edition, 2026-11-22: the author's second hidden game, and its name (first "Elroy Invaders"); how it's reached is
   theirs to decide: `?invaders` for now). An original fixed shooter in the game's own pixel art, not a copy of any arcade
   game: Pac-Man at the bottom firing up at a formation of the four ghosts (Blinky, Pinky, Inky, Clyde, a row each), who
   march side to side, looking the way they go, stepping down and turning at the edges, faster as their numbers thin, and
   drop boos on him; four ghost houses (double blue walls, pink door) shield him and crumble under fire from both sides.
   Booze Elroy himself (his own sprite, martini in hand) crosses the top now and then, lobbing martinis: worth a fruit's
   score. A ghost shot down may drop an energizer: caught, the ghosts turn blue (no boos, slower, double points). The march
   steps to the game's own chomp. Pictures and sound only, Math.random; the Pac-Man game stands still meanwhile (main.js). */
(function (root) {
  "use strict";
  const W = 224, H = 288;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const ROWS = ["blinky", "pinky", "inky", "clyde"], COLS = 8, CELL_X = 20, CELL_Y = 18;
  const POINTS = { blinky: 200, pinky: 150, inky: 100, clyde: 50 };
  const GHOST_FALLBACK = { blinky: "#ff0000", pinky: "#ffb8ff", inky: "#00ffff", clyde: "#ffb852" };
  const PAC_Y = 252, GROUND_Y = 266, SHIELD_Y = 214, TOP_Y = 44, EDGE = 4;
  const ELROY_VALUES = [300, 500, 700, 1000, 2000];
  const GHOST_PICS = [200, 400, 800, 1600];
  const RAGE_COL = "#ff7a10", RAGE_RGB = [255, 122, 16]; // (the enraged Blinky's orange, Elroids' own) // (the arcade's ghost-score pictures; other values use its fruit-score ones) // (the arcade's fruit scores: their own pictures)
  const EXTRA_FIRST = 15000, EXTRA_EVERY = 30000;
  const BEST_KEY = "booze-elroy-invaders-best";
  // a ghost house, 28 x 16: the pen's double blue wall, hollow inside, the pink door on top (1 = wall, 2 = door)
  const HOUSE_W = 28, HOUSE_H = 16;
  const HOUSE = (() => {
    const g = [];
    for (let y = 0; y < HOUSE_H; y++) for (let x = 0; x < HOUSE_W; x++) {
      const outer = x < 2 || x >= HOUSE_W - 2 || y < 2 || y >= HOUSE_H - 2;
      const inner = (x === 4 || x === HOUSE_W - 5 || y === 4 || y === HOUSE_H - 5) && x >= 4 && x <= HOUSE_W - 5 && y >= 4 && y <= HOUSE_H - 5;
      const door = y >= 0 && y < 2 && x >= 10 && x < 18;
      g.push(door ? (y === 1 ? 2 : 0) : outer || inner ? 1 : 0);
    }
    return g;
  })();
  const WALL_RGB = [33, 33, 255], DOOR_RGB = [255, 184, 255];
  // a little pixel martini, falling (Booze Elroy's), in colour (the author: the first, all pale blue, read as white
  // triangles): w glass, l the drink (pale gold), o olive, r pimento, t toothpick, s stem and foot
  const MARTINI = [".......t.", "wwwwwwtww", ".wllorlw.", "..wlllw..", "...wlw...", "....w....", "....s....", "....s....", "..sssss.."];
  const MARTINI_COL = { w: "#e8f8ff", l: "#f6ee9c", o: "#30d030", r: "#ff3030", t: "#d8a060", s: "#a8c8e0" };
  let martiniArt = null;
  function martiniCanvas() { // (made once, drawn turned)
    if (martiniArt) return martiniArt;
    martiniArt = document.createElement("canvas"); martiniArt.width = 9; martiniArt.height = 9;
    const c = martiniArt.getContext("2d");
    MARTINI.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (MARTINI_COL[row[x]]) { c.fillStyle = MARTINI_COL[row[x]]; c.fillRect(x, y, 1, 1); } });
    return martiniArt;
  }
  // where a falling martini is drawn and hits: swaying side to side as it rocks (the author: a little wave on the way down)
  const swayX = (d) => d.x + Math.sin(d.age * 0.12 + d.ph) * 2.5;

  function create(opts) {
    const audio = opts.audio, ghostColor = (n) => { try { return opts.ghostColor(n) || GHOST_FALLBACK[n]; } catch { return GHOST_FALLBACK[n]; } };
    let on = false, phase = "ready", t = 0, paused = false;
    let fizz = [], pac, shot, boos, drinks, ghosts, fx, fy, dir, stepWait, stepCount, dropping, houses, elroy, elroyAt, energizers, blue, bits, popups;
    let score, lives, wave, nextExtra, booWait, dyingT, chomp = false;
    let best = 0; try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch { /* ignore */ }
    const held = {};
    let finger = null; // touch: Pac-Man walks toward the finger; each new touch fires

    // ------------------------------------------------------------------ sound
    const ctx = audio.ctx;
    const vol = () => (opts.volume ? opts.volume() : 0.8);
    const out = () => (audio.master ? audio.master() : null);
    const loops = {};
    function sample(name, v = 1) {
      const b = audio.buffer && audio.buffer(name);
      if (!ctx || !b || !out()) return;
      const s = ctx.createBufferSource(), gn = ctx.createGain(); s.buffer = b; gn.gain.value = v * vol();
      s.connect(gn); gn.connect(out()); s.start();
    }
    function loop(name, want, v = 0.4) {
      const L = loops[name];
      if (want && !L) {
        const b = audio.buffer && audio.buffer(name);
        if (!ctx || !b || !out()) return;
        const s = ctx.createBufferSource(), gn = ctx.createGain(); s.buffer = b; s.loop = true; gn.gain.value = v * vol();
        s.connect(gn); gn.connect(out()); s.start(); loops[name] = s;
      } else if (!want && L) { try { L.stop(); } catch { /* ignore */ } delete loops[name]; }
    }
    function tone(type, f0, f1, len, v) { // a quick sweep
      if (!ctx || !out()) return;
      const n = ctx.currentTime, o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = type; o.frequency.setValueAtTime(f0, n); o.frequency.exponentialRampToValueAtTime(f1, n + len);
      gn.gain.setValueAtTime(0.0001, n); gn.gain.exponentialRampToValueAtTime(v * vol(), n + 0.006); gn.gain.exponentialRampToValueAtTime(0.0005, n + len);
      o.connect(gn); gn.connect(out()); o.start(n); o.stop(n + len + 0.02);
    }
    let noise = null;
    function pop(big) { // a ghost shot down: a soft noisy pop
      if (!ctx || !out()) return;
      if (!noise) { noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      const n = ctx.currentTime, len = big ? 0.5 : 0.22, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
      s.buffer = noise; f.type = "lowpass"; f.frequency.setValueAtTime(big ? 1600 : 2600, n); f.frequency.exponentialRampToValueAtTime(110, n + len); f.Q.value = 3;
      gn.gain.setValueAtTime(0.0001, n); gn.gain.exponentialRampToValueAtTime((big ? 0.22 : 0.14) * vol(), n + 0.005); gn.gain.exponentialRampToValueAtTime(0.0005, n + len);
      s.connect(f); f.connect(gn); gn.connect(out()); s.start(n, Math.random() * 0.5, len + 0.05);
    }
    const silence = () => { for (const k of Object.keys(loops)) loop(k, false); };

    // ------------------------------------------------------------------ the game
    function newHouses() {
      return [0, 1, 2, 3].map((i) => ({ x: Math.round(24 + i * ((W - 48 - HOUSE_W) / 3)), y: SHIELD_Y, cells: HOUSE.slice(), canvas: null, dirty: true }));
    }
    function startWave() {
      ghosts = [];
      for (let r = 0; r < ROWS.length; r++) for (let c = 0; c < COLS; c++) ghosts.push({ name: ROWS[r], r, c, alive: true });
      fx = Math.round((W - ((COLS - 1) * CELL_X + 16)) / 2); fy = TOP_Y + Math.min(wave - 1, 6) * 6; dir = 1; stepWait = 30; stepCount = 0; dropping = false;
      shot = null; boos = []; drinks = []; energizers = []; blue = 0; elroy = null; elroyAt = rnd(900, 1500); booWait = 90;
    }
    function newGame() {
      score = 0; lives = 3; wave = 1; nextExtra = EXTRA_FIRST; bits = []; popups = [];
      pac = { x: W / 2, moving: false, frame: 0 }; houses = newHouses();
      fizz = []; startWave(); phase = "ready"; t = 0; myRank = null; loadBoard();
    }
    function addScore(p) {
      score += p;
      if (score >= nextExtra) { nextExtra += EXTRA_EVERY; lives += 1; sample("extrapac", 0.8); }
      if (score > best) { best = score; try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* ignore */ } }
    }
    const alive = () => ghosts.filter((gh) => gh.alive);
    // the very last ghost, if it's a Blinky: enraged, like Booze Elroy in Elroids (the author): red-hot and scowling, the
    // fastest siren, boos much faster, more of them and quicker (not while he's blue)
    const enraged = () => { if (blue || phase !== "play") return false; let last = null, n = 0; for (const gh of ghosts) if (gh.alive) { last = gh; if (++n > 1) return false; } return !!(last && last.name === "blinky"); };
    const ghostX = (gh) => fx + gh.c * CELL_X, ghostY = (gh) => fy + gh.r * CELL_Y; // (top-left of its 16 x 16)
    function burst(x, y, n, col, spd = 1.4) { for (let i = 0; i < n; i++) { const a = rnd(0, Math.PI * 2), v = rnd(0.2, spd); bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(15, 35), col }); } }
    // the houses: a hit takes a bite (radius r) out round the cell it struck
    function houseAt(px, py) {
      for (const h of houses) {
        const cx = Math.floor(px) - h.x, cy = Math.floor(py) - h.y;
        if (cx >= 0 && cx < HOUSE_W && cy >= 0 && cy < HOUSE_H && h.cells[cy * HOUSE_W + cx]) return { h, cx, cy };
      }
      return null;
    }
    function bite(hit, r) {
      const { h, cx, cy } = hit;
      for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r + Math.random() * 2) continue;
        const X = cx + x, Y = cy + y;
        if (X >= 0 && X < HOUSE_W && Y >= 0 && Y < HOUSE_H) h.cells[Y * HOUSE_W + X] = 0;
      }
      h.dirty = true;
    }
    function killPac() {
      phase = "dying"; dyingT = 0; shot = null; loop("siren1", false); loop("siren5", false); loop("scared", false);
      sample("died", 0.7); lives -= 1;
    }
    function shootGhost(gh) {
      gh.alive = false;
      const p = POINTS[gh.name] * (blue ? 2 : 1); addScore(p); pop(false);
      const x = ghostX(gh) + 8, y = ghostY(gh) + 8;
      burst(x, y, 10, blue ? "#2121ff" : ghostColor(gh.name));
      if (blue) popups.push({ p, x, y, life: 45 }); // (blue: its points shown where it was)
      // now and then an energizer drops from him
      const left = alive().length;
      if (left > 2 && !blue && energizers.length === 0 && Math.random() < 0.07) energizers.push({ x, y, life: 0 });
      if (!left) { phase = "clear"; t = 0; loop("siren1", false); loop("siren5", false); loop("scared", false); }
    }
    function fire() {
      if (phase !== "play" || shot) return;
      shot = { x: pac.x, y: PAC_Y - 7 };
      tone("square", 1500, 300, 0.16, 0.05);
    }

    function step() {
      if (paused) return;
      t += 1;
      for (let i = bits.length - 1; i >= 0; i--) { const b = bits[i]; b.x += b.vx; b.y += b.vy; b.vx *= 0.96; b.vy *= 0.96; if ((b.life -= 1) <= 0) bits.splice(i, 1); }
      for (let i = popups.length - 1; i >= 0; i--) if ((popups[i].life -= 1) <= 0) popups.splice(i, 1);
      if (phase === "ready") { if (t >= 110) { phase = "play"; t = 0; } return; }
      if (phase === "clear") { if (t >= 120) { wave += 1; startWave(); phase = "play"; t = 0; } return; }
      if (phase === "over") return;
      if (phase === "dying") {
        dyingT += 1;
        if (dyingT >= 110) {
          if (lives <= 0) { gameOver(); return; }
          phase = "play"; boos = []; drinks = []; pac.x = W / 2;
        }
        return;
      }
      // Pac-Man: left and right (or toward the finger)
      let move = (held.left || held.a ? -1 : 0) + (held.right || held.d ? 1 : 0);
      if (finger) { const d = finger.x - pac.x; move = Math.abs(d) < 1.5 ? 0 : Math.sign(d); }
      pac.moving = !!move;
      pac.x = Math.max(10, Math.min(W - 10, pac.x + move * 1.3));
      if (pac.moving) pac.frame += 1;
      // his dot, going up: through the houses (from below), the boos, the ghosts, Booze Elroy
      if (shot) {
        for (let k = 0; k < 4 && shot; k++) {
          shot.y -= 1;
          if (shot.y < 18) { shot = null; break; }
          const hh = houseAt(shot.x, shot.y); if (hh) { bite(hh, 2); shot = null; break; }
          const bi = boos.findIndex((b) => Math.abs(b.x - shot.x) < 3 && Math.abs(b.y - shot.y) < 4);
          if (bi >= 0) { burst(shot.x, shot.y, 5, "#ffffff", 0.8); boos.splice(bi, 1); shot = null; break; }
          const gh = ghosts.find((g2) => g2.alive && shot.x >= ghostX(g2) + 1 && shot.x < ghostX(g2) + 15 && shot.y >= ghostY(g2) + 1 && shot.y < ghostY(g2) + 15);
          if (gh) { shootGhost(gh); shot = null; break; }
          if (elroy && !elroy.hit && Math.abs(shot.x - elroy.x) < 8 && Math.abs(shot.y - elroy.y) < 8) { hitElroy(); shot = null; break; }
        }
        if (phase !== "play") return;
      }
      // the march: a step every so often, faster as they thin (and slower while they're blue); at an edge, down and back
      const live = alive();
      if ((stepWait -= 1) <= 0) {
        // faster and faster as they thin, the last ones frantic and the very last hard to hit (the author: like the last
        // one in the arcade): 32 left, a step every ~16 frames; 8, every 4; 2, every frame; the last, every frame and 3 px
        const n = live.length, pace = Math.max(0.6, 1 - 0.06 * (wave - 1));
        stepWait = Math.max(1, Math.round((1 + (n - 1) * 0.5) * pace)) * (blue ? 2 : 1);
        const stride = n === 1 && !blue ? 3 : 2;
        stepCount += 1;
        const minX = Math.min(...live.map(ghostX)), maxX = Math.max(...live.map(ghostX)) + 16;
        if (!dropping && (minX + dir * stride < EDGE || maxX + dir * stride > W - EDGE)) { fy += 8; dir = -dir; dropping = true; }
        else { fx += dir * stride; dropping = false; }
        // they march to the chomp, on every fourth step (every step was a din by the end: the author)
        if (stepCount % 4 === 0) { chomp = !chomp; sample(chomp ? "wakka1" : "wakka2", 0.45); }
        // where they walk through a house, it crumbles
        for (const gh of live) {
          const gx = ghostX(gh), gy = ghostY(gh);
          for (const h of houses) if (gx + 16 > h.x && gx < h.x + HOUSE_W && gy + 16 > h.y && gy < h.y + HOUSE_H) {
            for (let y = Math.max(0, gy + 1 - h.y); y < Math.min(HOUSE_H, gy + 15 - h.y); y++) for (let x = Math.max(0, gx + 1 - h.x); x < Math.min(HOUSE_W, gx + 15 - h.x); x++) h.cells[y * HOUSE_W + x] = 0;
            h.dirty = true;
          }
        }
        // they've reached him: it's over
        if (live.some((gh) => ghostY(gh) + 15 >= PAC_Y - 6)) { lives = 0; killPac(); return; }
      }
      // their boos: from the bottom ghost of a column, often the one over him (none while they're blue)
      const rage = enraged();
      if (!blue && (booWait -= 1) <= 0 && live.length) {
        booWait = rage ? rnd(8, 18) : Math.max(14, rnd(30, 70) - wave * 3);
        if (boos.length < (rage ? 5 : Math.min(5, 3 + Math.floor(wave / 3)))) {
          const cols = [...new Set(live.map((gh) => gh.c))];
          const over = cols.reduce((a, c) => (Math.abs(fx + c * CELL_X + 8 - pac.x) < Math.abs(fx + a * CELL_X + 8 - pac.x) ? c : a), cols[0]);
          const c = Math.random() < 0.45 ? over : pick(cols);
          const shooter = live.filter((gh) => gh.c === c).reduce((a, b) => (b.r > a.r ? b : a));
          boos.push({ x: ghostX(shooter) + 8, y: ghostY(shooter) + 16, v: (1.3 + 0.1 * Math.min(wave, 7)) * (rage ? 1.35 : 1), col: rage && t % 12 < 6 ? RAGE_COL : ghostColor(shooter.name), wig: rnd(0, 6) });
        }
      }
      for (let i = boos.length - 1; i >= 0; i--) {
        const b = boos[i]; b.y += b.v;
        if (b.y > GROUND_Y) { burst(b.x, GROUND_Y - 1, 3, b.col, 0.5); boos.splice(i, 1); continue; }
        const hh = houseAt(b.x, b.y + 3); if (hh) { bite(hh, 2); boos.splice(i, 1); continue; }
        if (Math.abs(b.x - pac.x) < 6 && b.y + 3 > PAC_Y - 6 && b.y < PAC_Y + 7) { boos.splice(i, 1); killPac(); return; }
      }
      // Booze Elroy, across the top now and then, lobbing martinis
      if (!elroy && live.length >= 6 && (elroyAt -= 1) <= 0) {
        const ltr = Math.random() < 0.5;
        elroy = { x: ltr ? -10 : W + 10, y: 30, vx: ltr ? 0.75 : -0.75, lob: rnd(60, 110), hit: false };
      }
      if (elroy && !elroy.hit) {
        elroy.x += elroy.vx;
        if ((elroy.lob -= 1) <= 0 && elroy.x > 12 && elroy.x < W - 12) { elroy.lob = rnd(70, 130); drinks.push({ x: elroy.x + 6, y: elroy.y + 6, vx: (pac.x - elroy.x) / 220, vy: 1.2, age: 0, ph: rnd(0, 6) }); tone("sine", 2637, 3000, 0.2, 0.05); }
        if (elroy.x < -14 || elroy.x > W + 14) { elroy = null; elroyAt = rnd(1300, 2000); }
      }
      if (elroy && elroy.hit && (elroy.hitT -= 1) <= 0) { elroy = null; elroyAt = rnd(1300, 2000); }
      // his drunk bubbles trailing behind him (the author: the game's own, wobbling up, swelling, popping)
      if (elroy && !elroy.hit && t % 4 === 0) {
        const big = Math.random() < 0.15, back = -Math.sign(elroy.vx);
        fizz.push({ x: elroy.x + back * 6, y: elroy.y + Math.sin(t * 0.18) * 1.5 - 5 + rnd(-1, 1), // (from up by the top of his head, bobbing with him: the author)
           vx: back * rnd(0.05, 0.25), vy: -rnd(0.25, 0.55), r: big ? 2.4 + Math.random() * 0.6 : 1 + Math.random(), age: 0, life: 18 + Math.random() * 16, phase: rnd(0, 6.3), wob: 0.5 + Math.random() * 0.9 });
      }
      for (let i = fizz.length - 1; i >= 0; i--) {
        const b = fizz[i]; b.age += 1;
        if (b.age > b.life + 4) { fizz.splice(i, 1); continue; }
        if (b.age > b.life) continue; // popping
        b.x += b.vx + Math.sin(b.age * 0.35 + b.phase) * 0.35 * b.wob; b.y += b.vy; b.vy *= 0.97; b.r = Math.min(3, b.r + 0.02);
      }
      for (let i = drinks.length - 1; i >= 0; i--) {
        const d = drinks[i]; d.x += d.vx; d.y += d.vy; d.age += 1;
        const dx = swayX(d);
        if (d.y > GROUND_Y) { drinks.splice(i, 1); continue; }
        const hh = houseAt(dx, d.y + 4); if (hh) { bite(hh, 3); drinks.splice(i, 1); continue; }
        if (Math.abs(dx - pac.x) < 6 && d.y + 4 > PAC_Y - 6 && d.y < PAC_Y + 7) { drinks.splice(i, 1); killPac(); return; }
      }
      // an energizer falling: caught, they turn blue
      for (let i = energizers.length - 1; i >= 0; i--) {
        const e = energizers[i]; e.y += 0.9; e.life += 1;
        if (e.y > GROUND_Y) { energizers.splice(i, 1); continue; }
        if (Math.abs(e.x - pac.x) < 8 && e.y > PAC_Y - 8 && e.y < PAC_Y + 8) { energizers.splice(i, 1); blue = 360; addScore(50); sample("fruit", 0.7); }
      }
      if (blue > 0) blue -= 1;
      loop("scared", blue > 0, 0.3);
      loop("siren1", !!(elroy && !elroy.hit) && !blue && !rage, 0.25);
      loop("siren5", rage, 0.32); // (the enraged last Blinky: the game's fastest siren, as in Elroids)
    }
    function hitElroy() {
      const p = pick(ELROY_VALUES);
      addScore(p); sample("ateGhost", 0.8); pop(true);
      burst(elroy.x, elroy.y, 18, "#ff2020", 2); burst(elroy.x, elroy.y, 10, "#ffb852", 1.5); burst(elroy.x, elroy.y, 6, "#c8f0ff", 1.8);
      elroy.hit = true; elroy.hitT = 70; elroy.p = p;
    }

    // ------------------------------------------------------------------ the leaderboard (opts.board, main.js)
    let board = null, myRank = null, asking = false;
    const topScore = () => Math.max(best, board && board[0] ? board[0].score : 0);
    function loadBoard() { if (opts.board && opts.board.online) opts.board.load().then((e) => { if (e && !asking) board = e; }); }
    function gameOver() {
      phase = "over"; t = 0; myRank = null; silence();
      if (!(opts.board && opts.board.online && board && score > 0)) return;
      let place = board.findIndex((e) => e.score < score); if (place < 0) place = board.length;
      if (place >= 10) return;
      asking = true;
      opts.board.submit(score, place + 1, topScore()).then((r) => { asking = false; t = 0; if (r) { board = r.entries; myRank = r.rank; } else loadBoard(); });
    }

    // ------------------------------------------------------------------ drawing: the game's own sprites
    function houseCanvas(h) {
      if (!h.canvas) { h.canvas = document.createElement("canvas"); h.canvas.width = HOUSE_W; h.canvas.height = HOUSE_H; }
      if (h.dirty) {
        const c = h.canvas.getContext("2d"), im = c.createImageData(HOUSE_W, HOUSE_H);
        for (let i = 0; i < h.cells.length; i++) { const v = h.cells[i]; if (!v) continue; const rgb = v === 2 ? DOOR_RGB : WALL_RGB; im.data.set([...rgb, 255], i * 4); }
        c.putImageData(im, 0, 0); h.dirty = false;
      }
      return h.canvas;
    }
    function draw(x, print0, formatScore, ghostScore, gfx) {
      const print = (s, px, py, c) => { s = String(s); for (let i = 0; i < s.length; i++) if (s[i] !== " ") print0(s[i], px + i, py, c); };
      const A = gfx && gfx.animations, sprite = gfx ? gfx.sprite : () => {};
      x.save(); x.imageSmoothingEnabled = false;
      // the ground
      x.fillStyle = "#2121ff"; x.fillRect(0, GROUND_Y, W, 1);
      // the houses
      for (const h of houses) x.drawImage(houseCanvas(h), h.x, h.y);
      // the ghosts: looking the way they march (down as they drop), two frames in step with the march; blue when energized
      const face = dropping ? 1 : dir > 0 ? 0 : 2, rageNow = enraged();
      for (const gh of ghosts) {
        if (!gh.alive || !A) continue;
        let fr;
        if (blue) { const flash = blue < 120 && Math.floor(blue / 12) % 2; fr = (flash ? A.scaredWhite : A.scaredBlue).frames[stepCount % 2]; }
        else fr = A[gh.name][face].frames[stepCount % 2];
        if (rageNow && gfx.recolored) { // red-hot (flickering to orange, as in Elroids) and scowling: dark lids slanting down over his eyes
          // to the middle (white brows, as in Elroids' vector look, vanished into the eye whites here)
          if (Math.floor(t / 6) % 2) gfx.recolored("spr16", fr, ghostX(gh), ghostY(gh), [255, 0, 0], RAGE_RGB); else sprite("spr16", fr, ghostX(gh), ghostY(gh));
          const gx = ghostX(gh) + (face === 0 ? 1 : face === 2 ? -1 : 0), gy = ghostY(gh); x.fillStyle = "#200000";
          for (const [bx, by] of [[3, 3], [4, 3], [5, 4], [6, 4], [12, 3], [11, 3], [10, 4], [9, 4]]) x.fillRect(gx + bx, gy + by, 1, 1);
        } else sprite("spr16", fr, ghostX(gh), ghostY(gh));
      }
      // his bubbles (behind him), fading in, dissolving, popping in a ring of specks
      for (const b of fizz) {
        if (b.age > b.life) {
          const k = (b.age - b.life) / 4, rr = b.r + 1 + k * 2; x.globalAlpha = (1 - k) * 0.7; x.fillStyle = "#b0b0ff";
          for (let j = 0; j < 6; j++) { const a = j * Math.PI / 3 + b.phase; x.fillRect(Math.round(b.x + Math.cos(a) * rr), Math.round(b.y + Math.sin(a) * rr), 1, 1); }
        } else if (gfx && gfx.bubble) {
          const spr = gfx.bubble(b.r); x.globalAlpha = Math.min(1, b.age / 2) * Math.min(1, 2 * (1 - b.age / b.life)) * 0.9;
          x.drawImage(spr, Math.round(b.x - spr.width / 2), Math.round(b.y - spr.height / 2));
        }
        x.globalAlpha = 1;
      }
      // Booze Elroy (his own sprite), or the score where he was
      if (elroy && A) {
        // (rocking side to side as he goes, a little bob with it: a happy drunk, sloshing his martini; the author wanted some life)
        if (!elroy.hit) {
          const fr = A.booze.frames[Math.floor(t / 10) % 2], rock = Math.sin(t * 0.09) * 0.32, bob = Math.sin(t * 0.18) * 1.5;
          if (gfx.spriteTurned) gfx.spriteTurned("spr16", fr, elroy.x, elroy.y + bob, rock); else sprite("spr16", fr, Math.round(elroy.x) - 8, elroy.y - 8);
        }
        else if (gfx.fruitScore) gfx.fruitScore(elroy.p, Math.round(Math.max(24, Math.min(W - 24, elroy.x))), elroy.y);
      }
      // Pac-Man, facing up, chomping as he goes; or dying (the game's own death)
      if (A) {
        if (phase === "dying") { const f = Math.min(10, Math.floor(dyingT / 7)); if (dyingT < 90) sprite("spr16", 74 + f, Math.round(pac.x) - 8, PAC_Y - 8); }
        else { const fr = A.pac[3].frames; sprite("spr16", pac.moving ? fr[Math.floor(pac.frame / 3) % fr.length] : fr[1], Math.round(pac.x) - 8, PAC_Y - 8); }
      }
      // his dot, their boos (a little wavy bolt in the ghost's colour), Elroy's martinis, energizers
      x.globalAlpha = 1;
      if (shot) { x.fillStyle = "#ffb8ae"; x.fillRect(Math.round(shot.x) - 1, Math.round(shot.y), 2, 4); }
      for (const b of boos) {
        x.fillStyle = b.col;
        for (let k = 0; k < 7; k++) x.fillRect(Math.round(b.x + (Math.floor((b.y + k + b.wig) / 2) % 2 ? 0 : -2)), Math.round(b.y) + k, 2, 1); // (a wavy bolt, 2 px wide)
      }
      for (const d of drinks) { // (rocking as it sways, smoothed so the turned pixels hold together)
        x.save(); x.imageSmoothingEnabled = true; x.translate(swayX(d), d.y + 4.5); x.rotate(Math.sin(d.age * 0.12 + d.ph + 1.2) * 0.35);
        x.drawImage(martiniCanvas(), -4.5, -4.5); x.restore();
      }
      for (const e of energizers) if (Math.floor(e.life / 8) % 2 === 0) sprite("spr8", 2, Math.round(e.x) - 4, Math.round(e.y) - 4);
      for (const b of bits) { x.globalAlpha = Math.min(1, b.life / 15); x.fillStyle = b.col; x.fillRect(Math.round(b.x), Math.round(b.y), 1, 1); }
      x.globalAlpha = 1;
      // a blue ghost's points: the arcade's ghost-score picture, or its fruit-score one for the values it has no ghost score
      // for (100, 300: the author)
      for (const pp of popups) {
        if (GHOST_PICS.includes(pp.p)) { if (ghostScore) ghostScore(pp.p, Math.max(8, Math.min(W - 8, pp.x)), pp.y); }
        else if (gfx && gfx.fruitScore) gfx.fruitScore(pp.p, Math.max(24, Math.min(W - 24, pp.x)), pp.y);
      }
      // lives: little Pac-Men, bottom left
      if (A) for (let i = 0; i < Math.min(lives - (phase === "dying" || phase === "over" ? 0 : 1), 7); i++) sprite("spr16", A.pac[2].frames[1], 4 + i * 16, H - 18);
      x.restore();
      // the header, as in the game
      if (phase !== "play" || t % 32 < 16) print("1up", 3, 0);
      print("high score", 9, 0);
      print(formatScore(score), 0, 1, 0);
      print(formatScore(topScore()), 10, 1);
      print("invaders", 20, 0, 6);
      print("wave " + wave, 28 - ("wave " + wave).length, 1, 3);
      const mid = (s, y, c) => print(s, 14 - s.length / 2, y, c);
      if (phase === "ready") { // BOOZE INVADERS, shimmering letter by letter through the font's colours
        const SHIMMER = [1, 2, 6, 0, 3, 4], title = "booze invaders"; // (its name: the author, 2026-11-22; it was "Elroy Invaders" for an afternoon)
        for (let i = 0; i < title.length; i++) if (title[i] !== " ") print0(title[i], 7 + i, 18, SHIMMER[(Math.floor(t / 5) + i) % SHIMMER.length]);
        if (t > 30) mid("ready!", 20, 6);
      }
      if (phase === "clear" && t > 20) mid("wave " + (wave + 1), 18, 3);
      if (phase === "over") {
        if (board && !asking) { // the top 10, centred, the new entry in yellow (the same as Elroids')
          const top = 11;
          x.globalAlpha = 0.65; x.fillStyle = "#000"; x.fillRect(0, (top - 1) * 8, W, 16 * 8); x.globalAlpha = 1;
          mid("game over", top, 1);
          mid("high scores", top + 2, 3);
          if (!board.length) mid("no scores yet", top + 5, 0);
          board.slice(0, 10).forEach((e, i) => {
            const mine = myRank === i + 1, c = mine ? 6 : 0, y = top + 4 + i;
            print(String(i + 1).padStart(2), 0, y, mine ? 6 : 3); print(formatScore(e.score), 3, y, c); print(e.name, 12, y, c);
          });
        } else mid("game over", 18, 1);
      }
      if (paused) mid("paused", 18, 6);
    }

    // ------------------------------------------------------------------ input
    const FIRE = new Set(["space", "return", "z", "lalt", "up", "w"]);
    function key(k, down) {
      if (!on) return;
      if (k === "escape") { if (down) exit(); return; }
      if (down && (k === "p" || k === "tab")) { paused = !paused; return; }
      if (FIRE.has(k)) {
        if (!down) return;
        if (phase === "over" && t > 60 && !asking) { newGame(); return; }
        fire(); return; // (one dot per press)
      }
      held[k] = down;
    }
    function touch(kind, id, px) {
      if (!on) return;
      if (kind === "down") {
        if (phase === "over" && t > 60 && !asking) { newGame(); return; }
        if (!finger) finger = { id, x: px };
        fire();
      } else if (finger && finger.id === id) { if (kind === "move") finger.x = px; else finger = null; }
    }
    let onExit = null;
    function start(exitFn) { onExit = exitFn; on = true; paused = false; finger = null; for (const k in held) held[k] = false; newGame(); }
    function exit() { if (!on) return; on = false; silence(); finger = null; const f = onExit; onExit = null; if (f) f(); }
    const test = { state: () => ({ phase, score, lives, wave, board, myRank, asking, left: ghosts ? alive().length : 0, blue, elroy, houses: houses && houses.map((h) => h.cells.filter(Boolean).length) }),
      endGame: (s) => { score = s; lives = 1; killPac(); }, clearWave: () => { for (const gh of ghosts) gh.alive = false; phase = "clear"; t = 0; },
      elroyNow: () => { elroyAt = 1; }, leave: (k) => { let n = 0; for (const gh of ghosts) if (gh.alive && ++n > k) gh.alive = false; }, fx: () => fx, shootRow: (r) => { const gh = ghosts.find((g2) => g2.alive && g2.r === r); if (gh) shootGhost(gh); }, energize: () => { blue = 360; }, enraged: () => enraged() };
    return { active: () => on, start, exit, step, key, touch, draw, test };
  }
  root.BoozeInvaders = { create };
})(typeof self !== "undefined" ? self : this);
