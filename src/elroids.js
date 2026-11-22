/* Booze Elroy - ELROIDS (web edition, 2026-11-22: the author's easter egg; the name is theirs). Click the flying saucer
   that crosses the "space" background and the game steps aside for a little vector rock shooter of its own: an original
   one, not a copy of any arcade game (its own rules, look and sounds): Pac-Man as the ship, firing dots at tumbling
   rocks that break in two, and Booze Elroy himself (Blinky, martini in hand; the author) drifting in to hunt him, lobbing
   little martinis at him, faster as the rocks run out (Cruise Elroy), and now and then an energizer that turns him blue. Esc goes back to Pac-Man where he was.
   Pictures and sound only, its own randomness (Math.random): the Pac-Man game stands still meanwhile (main.js skips
   its steps), so nothing here can touch it. Drawn on the renderer's own 224x288 screen, so every look takes it. */
(function (root) {
  "use strict";
  const W = 224, H = 288, TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const wrap = (v, m) => ((v % m) + m) % m;
  const near = (d, m) => wrap(d + m / 2, m) - m / 2; // the shortest way round a wrapping screen
  const dist2 = (a, b) => { const dx = near(b.x - a.x, W), dy = near(b.y - a.y, H); return dx * dx + dy * dy; };
  // rocks: big ones break into two middling ones, those into two small ones
  const ROCK = { 3: { r: 15, pts: 20, v: 0.42 }, 2: { r: 9, pts: 50, v: 0.68 }, 1: { r: 5, pts: 100, v: 0.95 } };
  const GHOST_FALLBACK = { blinky: "#ff0000", pinky: "#ffb8ff", inky: "#00ffff", clyde: "#ffb852" };
  const SHIP_R = 5, GHOST_R = 6, SHOT_SPEED = 3.4, SHOT_LIFE = 52, MAX_SHOTS = 5, EXTRA_EVERY = 10000;
  const YELLOW = "#ffff00", ROCK_COL = "#7d93ff", DOT_COL = "#ffb8ae", BLUE = "#2121ff";
  const BEST_KEY = "booze-elroy-elroids-best";
  // ENRAGED (the author: no hanging about with one rock left, shooting Elroy for ever): 45 s into a wave (time alone, the
  // author), he flies into a rage for the rest of it: faster, steering harder, martinis three times as often (every third
  // throw a spread of three), back a couple of seconds after he's shot, red-hot and scowling
  const RAGE_AFTER = 45 * 60, RAGE_SPEED = 1.55, RAGE_THROWS = 3, RAGE_BACK = 150, RAGE_COL = "#ff7a10";

  function create(opts) {
    const audio = opts.audio, ghostColor = (n) => { try { return opts.ghostColor(n) || GHOST_FALLBACK[n]; } catch { return GHOST_FALLBACK[n]; } };
    let on = false, phase = "ready", t = 0, paused = false;
    let ship, shots, rocks, ghost, drinks, popups = [], flash = 0, energizer, bits, score, lives, wave, nextExtra, ghostAt, energizerAt, ghostChain, warpWait = 0, waveT = 0, rage = false;
    let best = 0; try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch { /* ignore */ }
    const held = {};
    // the leaderboard (opts.board, main.js: one board, "elroids"): its top 10, loaded as a game starts and shown on its game
    // over; a score that places asks for a name (a dialog) and goes up
    let board = null, myRank = null, asking = false;
    const topScore = () => Math.max(best, board && board[0] ? board[0].score : 0);
    function loadBoard() { if (opts.board && opts.board.online) opts.board.load().then((e) => { if (e && !asking) board = e; }); }
    const places = (s) => { if (!board || s < 1) return false; let i = board.findIndex((e) => e.score < s); if (i < 0) i = board.length; return i < 10; };
    function gameOver() {
      phase = "over"; t = 0; myRank = null; loop("siren1", false); loop("siren5", false); loop("scared", false);
      if (!(opts.board && opts.board.online && places(score))) return;
      asking = true;
      let place = board.findIndex((e) => e.score < score); if (place < 0) place = board.length;
      opts.board.submit(score, place + 1, topScore()).then((r) => { asking = false; t = 0; if (r) { board = r.entries; myRank = r.rank; } else loadBoard(); });
    }
    let finger = null; // touch: { id, x, y, t } — the ship turns toward it, thrusts when it's far, fires while it's down

    // ------------------------------------------------------------------ sound: synthesized, plus a few of the game's own samples
    const ctx = audio.ctx;
    const vol = () => (opts.volume ? opts.volume() : 0.8);
    let noise = null, thrustSrc = null, thrustGain = null;
    const loops = {};
    function out() { return audio.master ? audio.master() : null; }
    function noiseBuf() {
      if (!noise) { noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      return noise;
    }
    function zap() { // a dot fired: "peww" (the author: longer, not "pip pip"), a long falling sweep, softened a little
      if (!ctx || !out()) return;
      const n = ctx.currentTime, len = 0.32, o = ctx.createOscillator(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
      o.type = "square"; o.frequency.setValueAtTime(1700, n); o.frequency.exponentialRampToValueAtTime(140, n + len);
      f.type = "lowpass"; f.frequency.setValueAtTime(5000, n); f.frequency.exponentialRampToValueAtTime(900, n + len);
      gn.gain.setValueAtTime(0.0001, n); gn.gain.exponentialRampToValueAtTime(0.07 * vol(), n + 0.008); gn.gain.exponentialRampToValueAtTime(0.001, n + len);
      o.connect(f); f.connect(gn); gn.connect(out()); o.start(n); o.stop(n + len + 0.02);
    }
    // a rock breaking: an old analog-cabinet boom (the author: "like an arcade machine might have sounded in 1979"): coarse
    // noise (each random step held a few samples, like a noise generator clocked slow), played slowing down so its grit
    // drops in pitch, through a low resonant filter falling with it, a little overdriven, with a long tail. Big rocks
    // boom deep and long, small ones crack short and higher
    let grit = null;
    function gritBuf() {
      if (!grit) {
        const sr = ctx.sampleRate; grit = ctx.createBuffer(1, sr * 2, sr); const d = grit.getChannelData(0), hold = Math.max(1, Math.round(sr / 7000));
        let v = 0; for (let i = 0; i < d.length; i++) { if (i % hold === 0) v = Math.random() < 0.5 ? -1 : 1; d[i] = v; }
      }
      return grit;
    }
    let drive = null;
    function crunch(size) {
      if (!ctx || !out()) return;
      const n = ctx.currentTime, len = 0.35 + 0.32 * size, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
      if (!drive) { drive = new Float32Array(256); for (let i = 0; i < 256; i++) { const q = i / 127.5 - 1; drive[i] = Math.tanh(q * 2.5); } }
      const sh = ctx.createWaveShaper(); sh.curve = drive;
      s.buffer = gritBuf();
      const top = size >= 3 ? 0.55 : size >= 2 ? 0.8 : 1.1; // (how fast the noise runs at first: lower = deeper)
      s.playbackRate.setValueAtTime(top, n); s.playbackRate.exponentialRampToValueAtTime(top * 0.22, n + len);
      f.type = "lowpass"; f.Q.value = 4;
      f.frequency.setValueAtTime(size >= 3 ? 700 : size >= 2 ? 1100 : 1800, n); f.frequency.exponentialRampToValueAtTime(70, n + len);
      gn.gain.setValueAtTime(0.0001, n); gn.gain.exponentialRampToValueAtTime((0.13 + 0.045 * size) * vol(), n + 0.006); // (half what it was: too loud, the author)
      gn.gain.exponentialRampToValueAtTime(0.05 * vol(), n + len * 0.25); gn.gain.exponentialRampToValueAtTime(0.0005, n + len);
      s.connect(f); f.connect(sh); sh.connect(gn); gn.connect(out()); s.start(n, Math.random() * 1.0, len + 0.05);
    }
    function clink() { // a martini thrown: two glassy pings
      if (!ctx || !out()) return;
      const n = ctx.currentTime;
      for (const [f, d] of [[2637, 0], [3520, 0.05]]) {
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.type = "sine"; o.frequency.value = f;
        gn.gain.setValueAtTime(0, n + d); gn.gain.linearRampToValueAtTime(0.06 * vol(), n + d + 0.004); gn.gain.exponentialRampToValueAtTime(0.001, n + d + 0.25);
        o.connect(gn); gn.connect(out()); o.start(n + d); o.stop(n + d + 0.3);
      }
    }
    function blink() { // a warp: a rising sweep
      if (!ctx || !out()) return;
      const n = ctx.currentTime, o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = "triangle"; o.frequency.setValueAtTime(180, n); o.frequency.exponentialRampToValueAtTime(1800, n + 0.25);
      gn.gain.setValueAtTime(0.12 * vol(), n); gn.gain.exponentialRampToValueAtTime(0.001, n + 0.28);
      o.connect(gn); gn.connect(out()); o.start(n); o.stop(n + 0.3);
    }
    function sample(name, v = 1) { // the game's own sounds (eating a ghost, the death, the extra life ...)
      const b = audio.buffer && audio.buffer(name);
      if (!ctx || !b || !out()) return;
      const s = ctx.createBufferSource(), gn = ctx.createGain(); s.buffer = b; gn.gain.value = v * vol();
      s.connect(gn); gn.connect(out()); s.start();
    }
    function loop(name, want, v = 0.5) { // a looping sample on or off (the siren while a ghost hunts, "scared" while it's blue)
      const L = loops[name];
      if (want && !L) {
        const b = audio.buffer && audio.buffer(name);
        if (!ctx || !b || !out()) return;
        const s = ctx.createBufferSource(), gn = ctx.createGain(); s.buffer = b; s.loop = true; gn.gain.value = v * vol();
        s.connect(gn); gn.connect(out()); s.start(); loops[name] = s;
      } else if (!want && L) { try { L.stop(); } catch { /* ignore */ } delete loops[name]; }
    }
    function thrustSound(want) {
      if (!ctx || !out()) return;
      if (!thrustSrc) {
        thrustSrc = ctx.createBufferSource(); thrustSrc.buffer = noiseBuf(); thrustSrc.loop = true;
        const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 520;
        thrustGain = ctx.createGain(); thrustGain.gain.value = 0;
        thrustSrc.connect(f); f.connect(thrustGain); thrustGain.connect(out()); thrustSrc.start();
      }
      thrustGain.gain.setTargetAtTime(want ? 0.2 * vol() : 0, ctx.currentTime, 0.03);
    }
    function silence() {
      for (const k of Object.keys(loops)) loop(k, false);
      if (thrustSrc) { try { thrustSrc.stop(); } catch { /* ignore */ } thrustSrc = null; thrustGain = null; }
    }

    // ------------------------------------------------------------------ the game
    function newShip() { return { x: W / 2, y: H / 2 + 8, vx: 0, vy: 0, a: -Math.PI / 2, alive: true, safe: 120, gone: 0, mouth: 0.5, thrust: false }; }
    function rock(size, x, y, speed) {
      const n = Math.floor(rnd(7, 11)), shape = Array.from({ length: n }, () => (Math.random() < 0.3 ? rnd(0.55, 0.75) : rnd(0.85, 1.15))), a = rnd(0, TAU), v = ROCK[size].v * speed * rnd(0.7, 1.25);
      return { size, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, rot: rnd(0, TAU), spin: rnd(-0.03, 0.03), shape };
    }
    const speedUp = () => Math.min(1.8, 1 + 0.08 * (wave - 1));
    function startWave() {
      rocks = []; shots = []; drinks = []; ghost = null; energizer = null; ghostChain = 0; waveT = 0; rage = false;
      const n = Math.min(4 + wave, 11);
      for (let i = 0; i < n; i++) {
        let x, y; do { x = rnd(0, W); y = rnd(0, H); } while (dist2({ x, y }, ship) < 75 * 75);
        rocks.push(rock(3, x, y, speedUp()));
      }
      ghostAt = Math.max(240, 600 - wave * 40); energizerAt = ghostAt + 420;
    }
    function newGame() {
      loadBoard(); myRank = null;
      score = 0; lives = 3; wave = 1; nextExtra = EXTRA_EVERY; bits = []; popups = []; flash = 0;
      ship = newShip(); startWave();
      phase = "ready"; t = 0;
    }
    function addScore(p) {
      score += p;
      if (score >= nextExtra) { nextExtra += EXTRA_EVERY; lives += 1; sample("extrapac", 0.8); }
      if (score > best) { best = score; try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* ignore */ } }
    }
    function burst(x, y, n, col, spd = 1.4) {
      for (let i = 0; i < n; i++) { const a = rnd(0, TAU), v = rnd(0.2, spd); bits.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(20, 45), col }); }
    }
    function breakRock(i) {
      const r = rocks[i]; rocks.splice(i, 1);
      addScore(ROCK[r.size].pts); crunch(r.size); burst(r.x, r.y, 4 + r.size * 3, ROCK_COL);
      if (r.size > 1) for (let k = 0; k < 2; k++) rocks.push(rock(r.size - 1, r.x, r.y, speedUp()));
    }
    function killShip() {
      ship.alive = false; ship.gone = 0; thrustSound(false);
      if (ghost && !ghost.eyes) { ghost.leaving = true; ghost.blue = 0; } // (Elroy leaves before Pac-Man comes back: the author)
      sample("died", 0.7);
      // he comes apart: his outline in pieces, drifting off
      for (let i = 0; i < 10; i++) { const a = rnd(0, TAU), v = rnd(0.3, 1.2); bits.push({ x: ship.x, y: ship.y, vx: Math.cos(a) * v + ship.vx * 0.5, vy: Math.sin(a) * v + ship.vy * 0.5, life: rnd(50, 90), col: YELLOW, seg: rnd(2, 4), ang: rnd(0, TAU), spin: rnd(-0.15, 0.15) }); }
      lives -= 1;
    }
    function eatGhost() {
      const p = 200 * 2 ** Math.min(ghostChain, 3); ghostChain += 1;
      addScore(p); sample("ateGhost", 0.8); crunch(3);
      // he blows apart (the author): a flash, sparks, his outline in pieces, and his martini tumbling away
      const gc = ghost.blue ? BLUE : ghostColor(ghost.name);
      burst(ghost.x, ghost.y, 18, gc, 2.2); burst(ghost.x, ghost.y, 12, "#ffb852", 1.6); burst(ghost.x, ghost.y, 8, "#ffffff", 2.6);
      for (let i = 0; i < 9; i++) { const a = rnd(0, TAU), v = rnd(0.5, 1.6); bits.push({ x: ghost.x, y: ghost.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(40, 70), col: gc, seg: rnd(2, 3.5), ang: rnd(0, TAU), spin: rnd(-0.2, 0.2) }); }
      if (!ghost.blue) { const a = rnd(-Math.PI / 2 - 0.8, -Math.PI / 2 + 0.8); bits.push({ x: ghost.x + 10, y: ghost.y, vx: Math.cos(a) * 1.3, vy: Math.sin(a) * 1.3, life: 80, col: "#c8f0ff", glass: true, ang: 0, spin: rnd(-0.25, 0.25) }); }
      flash = 6;
      ghost.eyes = true; ghost.blue = 0; popups.push({ p, x: ghost.x, y: ghost.y, life: 60 }); // (its own: it stays its second after his eyes are gone)
      // the eyes head off the nearest edge
      const ex = ghost.x < W / 2 ? -1 : 1; ghost.vx = ex * 2.2; ghost.vy = 0;
    }
    function fire() {
      if (!ship.alive || ship.gone || shots.length >= MAX_SHOTS) return;
      const cx = Math.cos(ship.a), cy = Math.sin(ship.a);
      shots.push({ x: ship.x + cx * SHIP_R, y: ship.y + cy * SHIP_R, vx: cx * SHOT_SPEED + ship.vx, vy: cy * SHOT_SPEED + ship.vy, life: SHOT_LIFE });
      ship.mouth = 0.9; zap();
    }
    function warp() {
      if (!ship.alive || ship.gone || warpWait > 0) return;
      ship.gone = 24; warpWait = 60; ship.vx = ship.vy = 0; blink();
      ship.x = rnd(16, W - 16); ship.y = rnd(24, H - 16);
    }
    const clearAround = (x, y, r) => rocks.every((k) => dist2(k, { x, y }) > (r + ROCK[k.size].r) ** 2) && !(ghost && !ghost.eyes && dist2(ghost, { x, y }) < 60 * 60);

    function step() {
      if (paused) return;
      t += 1;
      if (phase === "ready") { if (t >= 110) { phase = "play"; t = 0; } return; }
      // controls: keys, or a finger to steer by
      let left = held.left || held.a, right = held.right || held.d, thrust = held.up || held.w;
      if (finger && ship.alive && !ship.gone) {
        const dx = near(finger.x - ship.x, W), dy = near(finger.y - ship.y, H), want = Math.atan2(dy, dx), d = near(want - ship.a, TAU);
        left = d < -0.08; right = d > 0.08; thrust = Math.hypot(dx, dy) > 46 && Math.abs(d) < 0.9;
        if ((finger.t += 1) % 14 === 1) fire();
      } // (keys and pad: a dot per press, no holding it down: the author)
      if (warpWait > 0) warpWait -= 1;
      // the ship
      if (ship.alive) {
        if (ship.gone) { ship.gone -= 1; if (!ship.gone) burst(ship.x, ship.y, 8, YELLOW, 0.8); }
        else {
          if (left) ship.a -= 0.075; if (right) ship.a += 0.075;
          ship.thrust = !!thrust;
          if (thrust) { ship.vx += Math.cos(ship.a) * 0.07; ship.vy += Math.sin(ship.a) * 0.07; }
          ship.vx *= 0.988; ship.vy *= 0.988;
          const sp = Math.hypot(ship.vx, ship.vy); if (sp > 3.3) { ship.vx *= 3.3 / sp; ship.vy *= 3.3 / sp; }
          ship.x = wrap(ship.x + ship.vx, W); ship.y = wrap(ship.y + ship.vy, H);
          if (ship.safe > 0) ship.safe -= 1;
          ship.mouth += ((thrust ? 0.15 + 0.35 * Math.abs(Math.sin(t * 0.35)) : 0.5) - ship.mouth) * 0.25; // chomping as he goes
        }
        thrustSound(ship.thrust && !ship.gone);
      } else if (phase === "play" && (ship.gone += 1) > 100) { // waiting to come back: once the middle is clear
        if (lives <= 0) gameOver();
        else if (!ghost && (clearAround(W / 2, H / 2 + 8, 34) || ship.gone > 400)) { ship = newShip(); drinks = []; }
      }
      // dots
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i]; s.x = wrap(s.x + s.vx, W); s.y = wrap(s.y + s.vy, H);
        if ((s.life -= 1) <= 0) { shots.splice(i, 1); continue; }
        let hit = false;
        for (let k = rocks.length - 1; k >= 0; k--) if (dist2(s, rocks[k]) < ROCK[rocks[k].size].r ** 2) { breakRock(k); hit = true; break; }
        if (!hit && ghost && !ghost.eyes && dist2(s, ghost) < GHOST_R * GHOST_R) { eatGhost(); hit = true; }
        if (hit) shots.splice(i, 1);
      }
      // martinis in flight: they catch him if they reach him; a dot knocks one out of the air
      for (let i = drinks.length - 1; i >= 0; i--) {
        const d = drinks[i]; d.x = wrap(d.x + d.vx, W); d.y = wrap(d.y + d.vy, H); d.rot += d.spin;
        if ((d.life -= 1) <= 0) { drinks.splice(i, 1); continue; }
        const hitBy = shots.findIndex((s) => dist2(s, d) < 16);
        if (hitBy >= 0) { shots.splice(hitBy, 1); drinks.splice(i, 1); addScore(50); burst(d.x, d.y, 6, "#c8f0ff", 0.9); clink(); continue; }
        if (ship.alive && !ship.gone && ship.safe <= 0 && dist2(d, ship) < (SHIP_R + 2) ** 2) { drinks.splice(i, 1); killShip(); }
      }
      // rocks
      for (const r of rocks) { r.x = wrap(r.x + r.vx, W); r.y = wrap(r.y + r.vy, H); r.rot += r.spin; }
      const live = ship.alive && !ship.gone && ship.safe <= 0;
      if (live) for (let k = rocks.length - 1; k >= 0; k--) if (dist2(ship, rocks[k]) < (ROCK[rocks[k].size].r + SHIP_R - 1) ** 2) { breakRock(k); killShip(); break; }
      // enraged: once the wave has gone on 45 s, by time alone (the author; 2 rocks left did it too, for a while), and he comes at once if he's away
      if (phase === "play") waveT += 1;
      if (phase === "play" && !rage && waveT >= RAGE_AFTER) {
        rage = true; ghostAt = Math.min(ghostAt, 60); // (no announcement, no sound: it's plain to see, the author)
        if (ghost && !ghost.eyes && !ghost.leaving) ghost.rage = true;
      }
      // the ghost: arrives from an edge, straight into the play (the author: he used to dawdle round the edges), and hunts
      // him; faster as the rocks run out (Cruise Elroy, the author's namesake)
      if (phase === "play" && !ghost && ship.alive && (ghostAt -= 1) <= 0) {
        const fromLeft = Math.random() < 0.5, y = rnd(30, H - 30), aim = { x: rnd(W * 0.3, W * 0.7), y: rnd(H * 0.25, H * 0.75) };
        const sx = fromLeft ? -8 : W + 8, d = Math.hypot(aim.x - sx, aim.y - y), v = 0.9 * (rage ? 1.25 : 1); // (a steady glide in: 1.8 came in too hard, the author)
        ghost = { name: "blinky", sip: rage ? rnd(30, 50) : rnd(90, 150), x: sx, y, vx: (aim.x - sx) / d * v, vy: (aim.y - y) / d * v, blue: 0, eyes: false, wob: rnd(0, TAU), entering: true, rage, throws: 0 };
      }
      if (ghost) {
        if (ghost.eyes) {
          ghost.x += ghost.vx; ghost.y += ghost.vy;
          if (ghost.x < -12 || ghost.x > W + 12) { ghost = null; ghostAt = rage ? RAGE_BACK : 480; }
        } else if (ghost.leaving) { // he got Pac-Man (or Pac-Man died with him about): off he goes before Pac-Man comes back
          ghost.vx += ((ghost.x < W / 2 ? -1.6 : 1.6) - ghost.vx) * 0.06; ghost.vy *= 0.95;
          ghost.x += ghost.vx; ghost.y = wrap(ghost.y + ghost.vy, H);
          if (ghost.x < -16 || ghost.x > W + 16) { ghost = null; ghostAt = 360; }
        } else {
          const elroy = rocks.length <= 1 ? 1.7 : rocks.length <= 3 ? 1.35 : 1;
          const top = ghost.blue ? 0.5 : (0.5 + 0.045 * wave) * elroy * (ghost.rage ? RAGE_SPEED : 1);
          const grip = ghost.entering ? 0 : ghost.rage && !ghost.blue ? 0.065 : 0.03; // (how hard he steers: coming in, he glides straight on)
          if (ghost.entering && ghost.x > 20 && ghost.x < W - 20) ghost.entering = false; // onto the screen: now he hunts
          const target = ship.alive && !ship.gone ? ship : { x: W / 2, y: H / 2 };
          let dx = ghost.inside ? near(target.x - ghost.x, W) : target.x - ghost.x, dy = near(target.y - ghost.y, H); // (off the screen still: straight in, not "round the back")
          if (ghost.blue) { dx = -dx; dy = -dy; } // blue: running away
          const d = Math.hypot(dx, dy) || 1;
          ghost.wob += 0.05;
          ghost.vx += (dx / d * top - ghost.vx) * grip + Math.cos(ghost.wob) * 0.01;
          ghost.vy += (dy / d * top - ghost.vy) * grip + Math.sin(ghost.wob * 1.3) * 0.01;
          ghost.x += ghost.vx; ghost.y = wrap(ghost.y + ghost.vy, H);
          if (ghost.x >= 0 && ghost.x < W) ghost.inside = true; // (it comes in from off the screen; once on it, it wraps like the rest)
          if (ghost.inside) ghost.x = wrap(ghost.x, W);
          if (ghost.blue > 0) ghost.blue -= 1;
          // a martini thrown his way now and then (not while blue), more often in Elroy; aimed, a little off
          else if (ship.alive && !ship.gone && phase === "play" && (ghost.sip -= elroy * (ghost.rage ? RAGE_THROWS : 1)) <= 0) {
            ghost.sip = Math.max(55, rnd(110, 170) - wave * 6);
            const a = Math.atan2(near(ship.y - ghost.y, H), near(ship.x - ghost.x, W)) + rnd(-0.18, 0.18), v = (1.25 + 0.06 * Math.min(wave, 10)) * (ghost.rage ? 1.3 : 1);
            const spread = ghost.rage && (ghost.throws = (ghost.throws || 0) + 1) % 3 === 0 ? [-0.28, 0, 0.28] : [0]; // (enraged: every third, a spread of three)
            for (const o of spread) drinks.push({ x: ghost.x + 8, y: ghost.y, vx: Math.cos(a + o) * v, vy: Math.sin(a + o) * v, life: 170, rot: 0, spin: rnd(-0.12, 0.12) });
            clink();
          }
          if (live && dist2(ghost, ship) < (GHOST_R + SHIP_R - 1) ** 2) { if (ghost.blue) eatGhost(); else killShip(); }
        }
      }
      loop("scared", !!(ghost && ghost.blue && phase === "play"), 0.35);
      const hunting = !!(ghost && !ghost.eyes && !ghost.leaving && !ghost.blue && phase === "play");
      loop("siren1", hunting && !ghost.rage, 0.3);
      loop("siren5", hunting && !!ghost.rage, 0.32); // (enraged: the game's fastest siren)
      // an energizer, now and then: eat it and the ghost turns blue
      if (phase === "play" && !energizer && (energizerAt -= 1) <= 0) {
        let x, y; do { x = rnd(16, W - 16); y = rnd(28, H - 16); } while (dist2({ x, y }, ship) < 60 * 60);
        energizer = { x, y, life: 600 };
      }
      if (energizer) {
        if ((energizer.life -= 1) <= 0) { energizer = null; energizerAt = 900; }
        else if (ship.alive && !ship.gone && dist2(energizer, ship) < (SHIP_R + 4) ** 2) {
          energizer = null; energizerAt = 1200; addScore(50); sample("fruit", 0.7);
          if (ghost && !ghost.eyes && !ghost.leaving) { ghost.blue = 360; ghost.vx = -ghost.vx; ghost.vy = -ghost.vy; }
        }
      }
      // the flash fading, the scores shown
      for (let i = popups.length - 1; i >= 0; i--) if ((popups[i].life -= 1) <= 0) popups.splice(i, 1);
      if (flash > 0) flash -= 1;
      // bits flying apart
      for (let i = bits.length - 1; i >= 0; i--) { const b = bits[i]; b.x += b.vx; b.y += b.vy; b.vx *= 0.98; b.vy *= 0.98; if (b.ang !== undefined) b.ang += b.spin; if ((b.life -= 1) <= 0) bits.splice(i, 1); }
      // wave cleared: the next, a little faster
      if (phase === "play" && !rocks.length) { phase = "clear"; t = 0; loop("siren1", false); loop("siren5", false); loop("scared", false); }
      if (phase === "clear" && t > 120 && (!ghost || ghost.eyes)) { wave += 1; startWave(); phase = "play"; t = 0; }
      if (phase === "clear" && ghost && !ghost.eyes && t > 120) { ghost.eyes = true; ghost.vx = ghost.x < W / 2 ? -2.2 : 2.2; ghost.vy = 0; }
    }

    // ------------------------------------------------------------------ drawing: glowing vector lines on black
    function beam(x, col, w, draw) {
      x.strokeStyle = col; x.lineJoin = "miter"; x.miterLimit = 3; x.lineCap = "round";
      x.globalAlpha = 0.28; x.lineWidth = w + 2; x.beginPath(); draw(); x.stroke();
      x.globalAlpha = 1; x.lineWidth = w; x.beginPath(); draw(); x.stroke();
    }
    // everything near an edge is drawn again on the far side, so it slides across
    function wrapped(o, r, fn) {
      for (const dx of [0, -W, W]) for (const dy of [0, -H, H]) {
        const px = o.x + dx, py = o.y + dy;
        if (px + r < 0 || px - r > W || py + r < 0 || py - r > H) continue;
        fn(px, py);
      }
    }
    function drawPac(x, px, py, a, mouth, col) {
      beam(x, col, 1, () => { x.moveTo(px, py); x.arc(px, py, SHIP_R, a + mouth * 0.9, a + TAU - mouth * 0.9); x.closePath(); });
    }
    // a martini glass, vector: the cone, the stem, the foot, and the olive on its pick
    function martini(x, px, py, s, rot) {
      x.save(); x.translate(px, py); x.rotate(rot || 0); x.scale(s, s);
      beam(x, "#c8f0ff", 1 / s, () => { x.moveTo(-3, -3); x.lineTo(3, -3); x.lineTo(0, 0.5); x.closePath(); x.moveTo(0, 0.5); x.lineTo(0, 3); x.moveTo(-1.7, 3); x.lineTo(1.7, 3); });
      beam(x, "#40ff40", 1 / s, () => { x.moveTo(-0.6, -1.6); x.arc(-1.2, -1.6, 0.6, 0, TAU); x.moveTo(-0.6, -1.6); x.lineTo(1.6, -4.2); });
      x.restore();
    }
    function drawGhost(x, gh) {
      const col = gh.blue ? (gh.blue < 120 && Math.floor(gh.blue / 12) % 2 ? "#ffffff" : BLUE) : gh.rage && !gh.eyes && Math.floor(t / 6) % 2 ? RAGE_COL : ghostColor(gh.name); // (enraged: red-hot, flickering)
      const at = gh.inside && !gh.eyes && !gh.leaving ? (fn) => wrapped(gh, 10, fn) : (fn) => fn(gh.x, gh.y); // (coming in, leaving, eyes: not round the edges)
      at((px, py) => {
        if (!gh.eyes) beam(x, col, 1, () => {
          x.moveTo(px - 6, py + 6); x.lineTo(px - 6, py); x.arc(px, py, 6, Math.PI, 0); x.lineTo(px + 6, py + 6);
          const k = Math.floor(t / 8) % 2 ? 1 : 0; // the skirt, flapping
          for (let i = 0; i < 4; i++) { const sx = px + 6 - (i + 1) * 3; x.lineTo(sx + 1.5, (i + k) % 2 ? py + 3 : py + 6); x.lineTo(sx, py + 6); }
        });
        // his martini, held out in his right hand (sloshing as he drifts)
        if (!gh.eyes && !gh.blue) { beam(x, col, 1, () => { x.moveTo(px + 6, py + 2); x.lineTo(px + 8.5, py + 1); }); martini(x, px + 10, py - 1, 1, Math.sin(t * 0.08) * 0.25); }
        if (gh.blue && !gh.eyes) { // scared: the arcade's little square eyes and wobbly mouth (peach; white while he flashes)
          const face = col === "#ffffff" ? "#ff2020" : "#ffb8ae";
          beam(x, face, 1, () => { x.moveTo(px - 4, py + 3); x.lineTo(px - 2, py + 2); x.lineTo(px, py + 3); x.lineTo(px + 2, py + 2); x.lineTo(px + 4, py + 3); });
          x.globalAlpha = 1; x.fillStyle = face; x.fillRect(Math.round(px - 3), Math.round(py - 2), 2, 2); x.fillRect(Math.round(px + 1), Math.round(py - 2), 2, 2);
          return;
        }
        // the eyes, looking his way (enraged: scowling, brows slanting down to the middle)
        if (gh.rage && !gh.eyes) beam(x, "#ffffff", 1, () => { x.moveTo(px - 4.5, py - 4.6); x.lineTo(px - 1, py - 3); x.moveTo(px + 4.5, py - 4.6); x.lineTo(px + 1, py - 3); });
        const tx = ship ? near(ship.x - gh.x, W) : 0, ty = ship ? near(ship.y - gh.y, H) : 0, d = Math.hypot(tx, ty) || 1;
        for (const ex of [-2.5, 2.5]) {
          beam(x, "#ffffff", 1, () => { x.moveTo(px + ex + 1.6, py - 1); x.arc(px + ex, py - 1, 1.6, 0, TAU); });
          x.fillStyle = BLUE; x.globalAlpha = 1; x.fillRect(Math.round(px + ex + tx / d * 0.9 - 0.5), Math.round(py - 1 + ty / d * 0.9 - 0.5), 1, 1);
        }
      });
    }
    function draw(x, print0, formatScore, ghostScore) {
      // (spaces skipped: the font's space isn't blank in every colour, it left marks under the scores: the author)
      const print = (s, px, py, c) => { s = String(s); for (let i = 0; i < s.length; i++) if (s[i] !== " ") print0(s[i], px + i, py, c); };
      // (the space background is already painted behind, by the renderer)
      x.save();
      for (const r of rocks) wrapped(r, ROCK[r.size].r + 2, (px, py) => beam(x, ROCK_COL, 1, () => {
        const R = ROCK[r.size].r, n = r.shape.length;
        for (let i = 0; i <= n; i++) { const a = r.rot + i / n * TAU, k = r.shape[i % n] * R; if (i) x.lineTo(px + Math.cos(a) * k, py + Math.sin(a) * k); else x.moveTo(px + Math.cos(a) * k, py + Math.sin(a) * k); }
      }));
      x.globalAlpha = 1; x.fillStyle = DOT_COL;
      for (const s of shots) x.fillRect(Math.round(s.x) - 1, Math.round(s.y) - 1, 2, 2);
      if (energizer && Math.floor(energizer.life / 10) % 2 === 0) { x.beginPath(); x.arc(energizer.x, energizer.y, 3.5, 0, TAU); x.fill(); }
      for (const d of drinks) wrapped(d, 6, (px, py) => martini(x, px, py, 0.85, d.rot));
      if (ghost) drawGhost(x, ghost);
      if (ship.alive && !ship.gone && !(ship.safe > 0 && Math.floor(ship.safe / 6) % 2)) {
        wrapped(ship, 10, (px, py) => {
          drawPac(x, px, py, ship.a, ship.mouth, YELLOW);
          if (ship.thrust && t % 4 < 3) beam(x, "#ff9a20", 1, () => { // the flame, out of his back
            const bx = px - Math.cos(ship.a) * (SHIP_R + 1), by = py - Math.sin(ship.a) * (SHIP_R + 1), L = rnd(3, 6), s = 2.2;
            x.moveTo(bx + Math.cos(ship.a + Math.PI / 2) * s, by + Math.sin(ship.a + Math.PI / 2) * s);
            x.lineTo(bx - Math.cos(ship.a) * L, by - Math.sin(ship.a) * L);
            x.lineTo(bx - Math.cos(ship.a + Math.PI / 2) * s, by - Math.sin(ship.a + Math.PI / 2) * s);
          });
        });
      }
      if (flash > 0) { x.globalAlpha = flash / 20; x.fillStyle = "#ffffff"; x.fillRect(0, 0, W, H); }
      for (const b of bits) {
        x.globalAlpha = Math.min(1, b.life / 25);
        if (b.glass) { martini(x, b.x, b.y, 1, b.ang); continue; }
        if (b.seg) { x.strokeStyle = b.col; x.lineWidth = 1; x.beginPath(); x.moveTo(b.x - Math.cos(b.ang) * b.seg, b.y - Math.sin(b.ang) * b.seg); x.lineTo(b.x + Math.cos(b.ang) * b.seg, b.y + Math.sin(b.ang) * b.seg); x.stroke(); }
        else { x.fillStyle = b.col; x.fillRect(Math.round(b.x), Math.round(b.y), 1, 1); }
      }
      x.globalAlpha = 1;
      // what he was worth, where he was: the arcade's own 200 / 400 / 800 / 1600 (printed at a fraction of a pixel, the digits
      // picked up a sliver of the font's next row, like an underline: the author)
      for (const pp of popups) { if (ghostScore) ghostScore(pp.p, Math.max(8, Math.min(W - 8, pp.x)), Math.max(24, Math.min(H - 8, pp.y))); else print(String(pp.p), Math.round(pp.x / 8) - 1, Math.round(pp.y / 8), 3); }
      // lives: little Pac-Men, bottom left
      for (let i = 0; i < Math.min(lives - (ship.alive || phase === "over" ? 1 : 0), 8); i++) drawPac(x, 10 + i * 13, H - 8, Math.PI, 0.5, YELLOW);
      x.restore();
      // the header, as in the game: 1UP and the score, the best, and the name where the ability goes
      if (phase !== "play" || t % 32 < 16) print("1up", 3, 0);
      print("high score", 9, 0);
      print(formatScore(score), 0, 1, 0);
      print(formatScore(topScore()), 10, 1);
      print("elroids", 21, 0, 6);
      print("wave " + wave, 28 - ("wave " + wave).length, 1, 3);
      const mid = (s, y, c) => print(s, 14 - s.length / 2, y, c);
      if (phase === "ready") { // ELROIDS shimmering, letter by letter, through the font's colours (the author)
        const SHIMMER = [1, 2, 6, 0, 3, 4];
        for (let i = 0; i < 7; i++) print("elroids"[i], 10.5 + i, 15, SHIMMER[(Math.floor(t / 5) + i) % SHIMMER.length]);
        if (t > 30) mid("ready!", 20, 6);
      }
      if (phase === "clear" && t > 20 && t < 120) mid("wave " + (wave + 1), 17, 3);
      if (phase === "over") {
        if (board && !asking) { // the top 10, the player's own (just put up) in yellow, in the middle of the screen (rows 11-24 of 36)
          const top = 11; // (no "fire to play again" / "esc to go back": the author, they'll figure it out)
          x.globalAlpha = 0.65; x.fillStyle = "#000"; x.fillRect(0, (top - 1) * 8, W, 16 * 8); x.globalAlpha = 1;
          mid("game over", top, 1);
          mid("high scores", top + 2, 3);
          if (!board.length) mid("no scores yet", top + 5, 0);
          board.slice(0, 10).forEach((e, i) => {
            const mine = myRank === i + 1, c = mine ? 6 : 0, y = top + 4 + i;
            print(String(i + 1).padStart(2), 0, y, mine ? 6 : 3); print(formatScore(e.score), 3, y, c); print(e.name, 12, y, c);
          });
        } else mid("game over", 17, 1);
        if (asking) mid("new high score!", 19, 6);
      }
      if (paused) mid("paused", 17, 6);
    }

    // ------------------------------------------------------------------ input
    const FIRE = new Set(["space", "return", "z", "lalt"]);
    function key(k, down) {
      if (!on) return;
      if (k === "escape") { if (down) exit(); return; }
      if (down && (k === "p" || k === "tab")) { paused = !paused; if (paused) thrustSound(false); return; }
      if (FIRE.has(k)) {
        if (!down) return;
        if (phase === "over" && t > 60 && !asking) { newGame(); return; }
        if (phase === "play" || phase === "clear") fire();
        return;
      }
      if ((k === "down" || k === "s") && down && (phase === "play" || phase === "clear")) warp();
      held[k] = down;
    }
    function touch(kind, id, x, y) {
      if (!on) return;
      if (kind === "down") {
        if (phase === "over" && t > 60 && !asking) { newGame(); return; }
        if (finger && finger.id !== id) { warp(); return; } // a second finger: warp
        finger = { id, x, y, t: 0 };
      } else if (finger && finger.id === id) {
        if (kind === "move") { finger.x = x; finger.y = y; } else finger = null;
      }
    }

    let onExit = null;
    function start(exitFn) {
      onExit = exitFn; on = true; paused = false; finger = null;
      for (const k in held) held[k] = false;
      newGame();
    }
    function exit() {
      if (!on) return;
      on = false; silence(); finger = null;
      const f = onExit; onExit = null; if (f) f();
    }
    // (tests: a look inside, and Elroy shot on demand)
    const test = { state: () => ({ phase, score, lives, wave, rage, waveT, ghost, board, myRank, asking, rocks: rocks && rocks.length, drinks: drinks && drinks.length }), shootElroy: () => { if (ghost && !ghost.eyes) eatGhost(); }, endGame: (s) => { score = s; lives = 0; if (ship.alive) killShip(); }, enrage: () => { waveT = RAGE_AFTER; }, immortal: () => { ship.safe = 1e9; } };
    return { active: () => on, start, exit, step, key, touch, draw, test, onBoard: () => on && phase === "over" && !asking, refreshBoard: () => { board = []; myRank = null; loadBoard(); } };
  }
  root.BoozeElroids = { create };
})(typeof self !== "undefined" ? self : this);
