/* Booze Elroy - LAST CALL (web edition, 2026-11-22: the author's third hidden game; behind the martini in the title's
   BOOZE ELROY banner). An original bartending game in the game's own sprites, not a copy of any arcade game: Booze
   Elroy (his own sprite, martini in hand) tends four counters, drawn as the maze's double blue walls, sliding martinis
   down them to the ghosts floating in from the doors. Each ghost needs its fill (Clyde 1, Inky 1, Pinky 2, Blinky 3,
   Blinky, the boozer, also the quickest): a martini knocks it back to sip, bubbling, then on it comes again, until,
   satisfied, it floats out paying up (the coin drop), now and then leaving a fruit on the bar as a tip, sliding to Elroy:
   be at that counter to catch it. A ghost reaching him, or a martini sliding off the end with no one to catch it,
   costs a life. Each round has a guest list; with the last few, LAST CALL! (the fast siren). Pictures and sound only,
   Math.random; the Pac-Man game stands still meanwhile (main.js). */
(function (root) {
  "use strict";
  const W = 224, H = 288;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const LANES = [88, 144, 200, 256]; // (the counters' tops)
  const BAR_L = 18, BAR_R = 190, ELROY_X = 204;
  // (made much harder the same day: "a small baby could handle it", the author. Ghosts came at a crawl, one at a time)
  const NEED = { clyde: 1, inky: 2, pinky: 2, blinky: 3 }; // (Blinky 4 from round 3)
  const RAGE_RGB = [255, 122, 16], BODY = { blinky: [255, 0, 0], pinky: [255, 184, 255], inky: [0, 255, 255], clyde: [255, 184, 82] };
  const PAID = { clyde: 100, inky: 200, pinky: 300, blinky: 500 }; // (and 50 a martini)
  const TIPS = ["cherry", "strawberry", "peach", "apple", "melon", "galaxian", "bell", "key"]; // (a round's fruit, as in the game)
  const GHOST_PICS = [200, 400, 800, 1600];
  const EXTRA_FIRST = 10000, EXTRA_EVERY = 20000;
  const BEST_KEY = "booze-elroy-lastcall-best";
  // the martini (Booze Invaders' own): w glass, l the drink, o olive, r pimento, t toothpick, s stem and foot
  const MARTINI = [".......t.", "wwwwwwtww", ".wllorlw.", "..wlllw..", "...wlw...", "....w....", "....s....", "....s....", "..sssss.."];
  const MARTINI_COL = { w: "#e8f8ff", l: "#f6ee9c", o: "#30d030", r: "#ff3030", t: "#d8a060", s: "#a8c8e0" };
  let martiniArt = null;
  function martiniCanvas() {
    if (martiniArt) return martiniArt;
    martiniArt = document.createElement("canvas"); martiniArt.width = 9; martiniArt.height = 9;
    const c = martiniArt.getContext("2d");
    MARTINI.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (MARTINI_COL[row[x]]) { c.fillStyle = MARTINI_COL[row[x]]; c.fillRect(x, y, 1, 1); } });
    return martiniArt;
  }

  function create(opts) {
    const audio = opts.audio;
    let on = false, phase = "ready", t = 0, paused = false;
    let pacGuest = null, clock = 0, lane, serveTilt, fireWait, ghosts, drinks, tips, popups, fizz, score, lives, round, nextExtra, quota, spawned, served, spawnWait, oopsT, oopsWhy, laneChomp = false;
    let best = 0; try { best = parseInt(localStorage.getItem(BEST_KEY), 10) || 0; } catch { /* ignore */ }
    let whyLog = null; // (tests: why lives were lost)

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
    const silence = () => { for (const k of Object.keys(loops)) loop(k, false); };
    let noise = null;
    function slide() { // a martini sent down the bar: a quick soft swish
      if (!ctx || !out()) return;
      if (!noise) { noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
      const n = ctx.currentTime, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), gn = ctx.createGain();
      s.buffer = noise; f.type = "bandpass"; f.frequency.setValueAtTime(3200, n); f.frequency.exponentialRampToValueAtTime(900, n + 0.22); f.Q.value = 1.2;
      gn.gain.setValueAtTime(0.0001, n); gn.gain.exponentialRampToValueAtTime(0.09 * vol(), n + 0.02); gn.gain.exponentialRampToValueAtTime(0.0005, n + 0.24);
      s.connect(f); f.connect(gn); gn.connect(out()); s.start(n, Math.random() * 0.5, 0.3);
    }
    function clink() { // caught: two glassy pings
      if (!ctx || !out()) return;
      const n = ctx.currentTime;
      for (const [f, d] of [[2637, 0], [3520, 0.05]]) {
        const o = ctx.createOscillator(), gn = ctx.createGain(); o.type = "sine"; o.frequency.value = f;
        gn.gain.setValueAtTime(0, n + d); gn.gain.linearRampToValueAtTime(0.06 * vol(), n + d + 0.004); gn.gain.exponentialRampToValueAtTime(0.001, n + d + 0.25);
        o.connect(gn); gn.connect(out()); o.start(n + d); o.stop(n + d + 0.3);
      }
    }

    // ------------------------------------------------------------------ the game
    function startRound() {
      ghosts = []; drinks = []; tips = []; fizz = []; pacGuest = null;
      quota = 8 + 4 * round; spawned = 0; served = 0; spawnWait = 50;
    }
    function newGame() {
      score = 0; lives = 3; round = 1; nextExtra = EXTRA_FIRST; popups = []; lane = 0; serveTilt = 0; fireWait = 0;
      startRound(); phase = "ready"; t = 0; myRank = null; loadBoard();
    }
    function addScore(p) {
      score += p;
      if (score >= nextExtra) { nextExtra += EXTRA_EVERY; lives += 1; sample("extrapac", 0.8); }
      if (score > best) { best = score; try { localStorage.setItem(BEST_KEY, String(best)); } catch { /* ignore */ } }
    }
    function pickGhost() { // later rounds bring more of the thirsty ones
      const r = round - 1, w = { clyde: Math.max(15, 50 - r * 8), inky: 35, pinky: 15 + Math.min(20, r * 5), blinky: Math.min(40, r * 10) };
      let k = Math.random() * (w.clyde + w.inky + w.pinky + w.blinky);
      for (const n of ["clyde", "inky", "pinky", "blinky"]) { if ((k -= w[n]) < 0) return n; }
      return "clyde";
    }
    // ~19 px/s in round 1, 2 px/s quicker each round up to 48; Blinky a quarter quicker; an impatient ghost nearly twice
    const speedOf = (gh) => Math.min(0.8, 0.32 + 0.035 * (round - 1)) * (gh.name === "blinky" ? 1.25 : 1) * (gh.rage ? 1.8 : 1);
    // patience: how long a ghost waits for a drink before it goes red-hot and rushes the bar (6 s, down to 3 s by round 7)
    const patience = () => Math.max(180, 360 - (round - 1) * 30);
    function oops(why) {
      phase = "oops"; oopsT = 0; oopsWhy = why; lives -= 1; loop("siren5", false); loop("scared", false); pacGuest = null; if (whyLog) whyLog.push(why);
      sample(why === "glass" ? "crash" : "died", 0.7);
    }
    function serve() {
      if (phase !== "play" || fireWait > 0 || drinks.filter((d) => d.lane === lane).length >= 4) return;
      drinks.push({ lane, x: BAR_R - 6, at: clock }); fireWait = 10; serveTilt = 1; slide();
    }
    function moveLane(d) {
      if (phase !== "play" && phase !== "ready") return;
      const nl = Math.max(0, Math.min(LANES.length - 1, lane + d));
      if (nl !== lane) { lane = nl; laneChomp = !laneChomp; sample(laneChomp ? "wakka1" : "wakka2", 0.3); }
    }

    function step() {
      if (paused) return;
      t += 1; clock += 1;
      for (let i = popups.length - 1; i >= 0; i--) { const p = popups[i]; p.y -= 0.2; if ((p.life -= 1) <= 0) popups.splice(i, 1); }
      stepFizz();
      if (serveTilt > 0) serveTilt = Math.max(0, serveTilt - 0.06);
      if (phase === "ready") { if (t >= 110) { phase = "play"; t = 0; } return; }
      if (phase === "clear") { if (t >= 150) { round += 1; startRound(); phase = "play"; t = 0; } return; }
      if (phase === "over") return;
      if (phase === "oops") {
        oopsT += 1;
        if (oopsT >= 110) {
          if (lives <= 0) { gameOver(); return; }
          spawned -= ghosts.filter((gh) => gh.mode !== "leave").length; // (the ones still thirsty come back later)
          ghosts = []; drinks = []; tips = []; spawnWait = 60; phase = "play"; t = 0;
        }
        return;
      }
      if (fireWait > 0) fireWait -= 1;
      // the guests: in at the doors, one at a time, on the emptiest counter
      if (spawned < quota && (spawnWait -= 1) <= 0) {
        const free = LANES.map((_, i) => i).filter((i) => !ghosts.some((gh) => gh.lane === i && gh.x < BAR_L + 20) && ghosts.filter((gh) => gh.lane === i && gh.mode !== "leave").length < 4);
        if (free.length) {
          const fewest = Math.min(...free.map((i) => ghosts.filter((gh) => gh.lane === i).length));
          const pickable = free.filter((i) => ghosts.filter((gh) => gh.lane === i).length === fewest);
          const l = pickable[Math.floor(Math.random() * pickable.length)], name = pickGhost();
          // PAC-MAN (the author: "a guest that acts different"): now and then he chomps in instead, not on the guest list.
          // Serve him and he's energized: the ghosts on his counter turn blue and he eats them (the arcade's chain)
          if (!pacGuest && spawned >= 2 && Math.random() < 0.09) {
            pacGuest = { lane: l, x: BAR_L - 14, mode: "walk", m: 0, chain: 0, f: 0 };
            spawnWait = Math.max(22, rnd(60, 100) - round * 7);
          } else {
          ghosts.push({ lane: l, x: BAR_L - 14, name, need: NEED[name] + (name === "blinky" && round >= 3 ? 1 : 0), mode: "walk", m: 0, ph: rnd(0, 6), wait: patience(), rage: false });
          spawned += 1; spawnWait = Math.max(22, rnd(60, 100) - round * 7);
          }
        } else spawnWait = 10;
      }
      // the martinis, sliding down the bar to the first ghost in their way
      for (let i = drinks.length - 1; i >= 0; i--) {
        const d = drinks[i]; d.x -= 2.6;
        // (a leaving ghost takes a martini that was already sliding when it got its fill, out by the door too; later ones
        // pass it by, so an empty counter can't be farmed)
        const roadie = (g2, dd) => g2.mode === "leave" && dd.at <= g2.leftAt;
        const gh = ghosts.filter((g2) => g2.lane === d.lane && !g2.blue && g2.mode !== "eyes" && d.x <= g2.x + 14 && (roadie(g2, d) || (g2.mode !== "leave" && d.x >= g2.x - 2))).sort((a, b) => b.x - a.x)[0];
        // Pac-Man takes it when he's the first in its way (blue ghosts let it by): served, he's energized; after that he
        // just gobbles what comes, so nothing breaks on his counter
        const pg = pacGuest;
        if (pg && pg.lane === d.lane && pg.mode !== "dying" && d.x <= pg.x + 14 && (!gh || pg.x > gh.x)) {
          drinks.splice(i, 1); laneChomp = !laneChomp; sample(laneChomp ? "wakka1" : "wakka2", 0.5); addScore(50);
          if (pg.mode === "walk") energize(pg);
          continue;
        }
        // one for the road: a ghost already on its way out happily takes a stray one (a martini already sliding when a ghost
        // got its fill used to sail past and break: a trap)
        if (gh && gh.mode === "leave") { drinks.splice(i, 1); clink(); addScore(50); if (gh.x > -16) { puff(gh); puff(gh); } continue; }
        if (gh) {
          drinks.splice(i, 1); clink(); addScore(50); gh.need -= 1;
          gh.rage = false; gh.wait = patience(); // (a drink calms an impatient ghost)
          if (gh.need > 0) { gh.mode = "push"; gh.m = 12; }
          else {
            gh.mode = "leave"; gh.leftAt = clock; served += 1; const p = PAID[gh.name]; addScore(p); sample("coindrop", 0.55);
            popups.push({ p, x: gh.x + 8, y: LANES[gh.lane] - 22, life: 60 });
            if (Math.random() < 0.3) tips.push({ lane: gh.lane, x: gh.x + 8, fruit: TIPS[Math.min(round - 1, TIPS.length - 1)] });
          }
          continue;
        }
        // off the end with no one to take it: a broken glass (not while a ghost on its way out is ahead of it: that one takes it)
        if (d.x < BAR_L - 4 && !ghosts.some((g2) => g2.lane === d.lane && roadie(g2, d)) && !(pacGuest && pacGuest.lane === d.lane && pacGuest.mode !== "dying")) { drinks.splice(i, 1); oops("glass"); return; }
      }
      // the ghosts
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const gh = ghosts[i];
        if (gh.mode === "eyes") { gh.x -= 2.5; if (gh.x < -18) ghosts.splice(i, 1); continue; } // (eaten: home as eyes)
        if (gh.blue) { // scared of the energized Pac-Man: back toward the door, where it cowers (no escape: he never caught any, the author)
          gh.x = Math.max(BAR_L - 12, gh.x - 0.45); continue;
        }
        if (gh.mode === "walk") { gh.x += speedOf(gh); if (!gh.rage && gh.x > BAR_L && (gh.wait -= 1) <= 0) gh.rage = true; }
        else if (gh.mode === "push") { gh.x -= 1.3; if ((gh.m -= 1) <= 0) { gh.mode = "sip"; gh.m = 20; } }
        else if (gh.mode === "sip") { if (t % 5 === 0) puff(gh); if ((gh.m -= 1) <= 0) gh.mode = "walk"; }
        else if (gh.mode === "leave") { // out the door, lingering just out of sight while drinks are still sliding after it
          if (gh.x > -18) gh.x -= 1.1;
          if (t % 6 === 0 && gh.x > -16) puff(gh);
          if (gh.x <= -18 && !drinks.some((d) => d.lane === gh.lane && d.at <= gh.leftAt)) { ghosts.splice(i, 1); continue; }
        }
        if (gh.mode !== "leave" && gh.x + 16 >= BAR_R + 2) { oops("caught"); return; } // reached Elroy
      }
      stepPac();
      if (phase !== "play") return;
      // tips sliding his way: caught if he's at that counter
      for (let i = tips.length - 1; i >= 0; i--) {
        const tp = tips[i]; tp.x += 0.9;
        if (tp.x >= BAR_R - 2) {
          tips.splice(i, 1);
          if (tp.lane === lane) { const f = opts.fruits && opts.fruits()[tp.fruit]; const p = f ? f.score : 100; addScore(p); sample("fruit", 0.7); popups.push({ p, x: ELROY_X - 24, y: LANES[tp.lane] - 26, life: 70, fruit: true }); }
        }
      }
      const left = quota - served;
      loop("siren5", left <= 3 && left > 0, 0.28); // LAST CALL!
      loop("scared", !!(pacGuest && pacGuest.mode === "power"), 0.3);
      // (and not before every tip has slid down to him, caught or missed: the author)
      if (served >= quota && !ghosts.length && !pacGuest && !tips.length) { phase = "clear"; t = 0; loop("siren5", false); loop("scared", false); }
    }
    // served: an energizer, as far as he's concerned. He turns round and goes for the ghosts BEHIND him (the author: the ones
    // in front would have caught the martini first, so his prey is always between him and the door); they flee for it, blue
    function energize(pg) {
      pg.mode = "power"; pg.m = 360; pg.chain = 0; pg.dir = 2; sample("fruit", 0.6);
      for (const gh of ghosts) if (gh.lane === pg.lane && gh.x < pg.x && gh.mode !== "leave" && gh.mode !== "eyes") { gh.blue = 1; gh.rage = false; }
    }
    function stepPac() {
      const pg = pacGuest; if (!pg) return;
      pg.f += 1;
      const mine = ghosts.filter((gh) => gh.lane === pg.lane);
      if (pg.mode === "walk") {
        pg.x += 0.5 + 0.02 * (round - 1);
        // bumping into a ghost before he's served: the arcade's rule, he's caught (a missed chance, not a life)
        if (mine.some((gh) => !gh.blue && gh.mode !== "leave" && gh.mode !== "eyes" && Math.abs(gh.x - pg.x) < 10)) { pg.mode = "dying"; pg.m = 0; sample("died", 0.45); return; }
        if (pg.x + 16 >= BAR_R - 4) pg.mode = "leave"; // never served: he shrugs and goes
      } else if (pg.mode === "power") {
        // charging back to the door, any ghost coming in meanwhile on his counter turning blue too, eating what he catches
        for (const gh of mine) if (!gh.blue && gh.x < pg.x && gh.mode !== "leave" && gh.mode !== "eyes") { gh.blue = 1; gh.rage = false; }
        pg.x -= 2.6; pg.dir = 2; // (a real burst: 1.4 never caught them, the author)
        for (const gh of mine) if (gh.blue && Math.abs(gh.x - pg.x) < 10) { // eaten: the arcade's 200 / 400 / 800 / 1600
          const p = 200 * 2 ** Math.min(pg.chain, 3); pg.chain += 1; addScore(p); sample("ateGhost", 0.7);
          popups.push({ p, x: gh.x + 8, y: LANES[gh.lane] - 22, life: 60 });
          gh.blue = 0; gh.mode = "eyes"; served += 1;
        }
        if ((pg.m -= 1) <= 0 || pg.x <= BAR_L - 14) { for (const gh of mine) gh.blue = 0; pg.mode = "leave"; } // (out of energizer, or at the door: off he goes)
      } else if (pg.mode === "leave") { pg.x -= 1.2; if (pg.x < -18) pacGuest = null; }
      else if (pg.mode === "dying") { if ((pg.m += 1) >= 80) pacGuest = null; }
    }
    // a sipping ghost's drunk bubbles, from up by its head (the game's own)
    function puff(gh) { fizz.push({ x: gh.x + 8 + rnd(-3, 3), y: LANES[gh.lane] - 17, vx: rnd(-0.15, 0.15), vy: -rnd(0.25, 0.5), r: Math.random() < 0.15 ? 2.4 : 1 + Math.random(), age: 0, life: 16 + Math.random() * 14, ph: rnd(0, 6.3), wob: 0.5 + Math.random() * 0.9 }); }
    function stepFizz() {
      for (let i = fizz.length - 1; i >= 0; i--) {
        const b = fizz[i]; b.age += 1;
        if (b.age > b.life + 4) { fizz.splice(i, 1); continue; }
        if (b.age > b.life) continue;
        b.x += b.vx + Math.sin(b.age * 0.35 + b.ph) * 0.35 * b.wob; b.y += b.vy; b.vy *= 0.97; b.r = Math.min(3, b.r + 0.02);
      }
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

    // ------------------------------------------------------------------ drawing
    function draw(x, print0, formatScore, ghostScore, gfx) {
      const print = (s, px, py, c) => { s = String(s); for (let i = 0; i < s.length; i++) if (s[i] !== " ") print0(s[i], px + i, py, c); };
      const A = gfx && gfx.animations, sprite = gfx ? gfx.sprite : () => {};
      x.save(); x.imageSmoothingEnabled = false;
      // the counters: the maze's double blue walls, a pink door at the far end of each
      for (const ly of LANES) {
        x.fillStyle = "#000"; x.globalAlpha = 0.55; x.fillRect(BAR_L, ly, BAR_R - BAR_L, 5); x.globalAlpha = 1;
        x.fillStyle = "#2121ff";
        x.fillRect(BAR_L + 1, ly, BAR_R - BAR_L - 2, 1); x.fillRect(BAR_L + 1, ly + 4, BAR_R - BAR_L - 2, 1);
        x.fillRect(BAR_L, ly + 1, 1, 3); x.fillRect(BAR_R - 1, ly + 1, 1, 3);
        x.fillRect(BAR_L + 3, ly + 2, BAR_R - BAR_L - 6, 1);
        x.fillStyle = "#ffb8ff"; x.fillRect(BAR_L - 9, ly - 20, 2, 20); // the door
      }
      // tips (a fruit sliding his way)
      if (A && gfx.fruits) for (const tp of tips) { const f = gfx.fruits[tp.fruit]; if (f) sprite("spr16", f.quad, Math.round(tp.x) - 8, LANES[tp.lane] - 16); }
      // the ghosts: facing him as they come, away as they leave; a little float; their drinks still to go above their heads
      if (A) for (const gh of ghosts) {
        const ly = LANES[gh.lane];
        if (gh.mode === "eyes") { sprite("spr16", A.dead[2].frames[0], Math.round(gh.x), ly - 17); continue; }
        if (gh.blue) { // scared: the arcade's blue, flashing white as his energizer runs out
          const pm = pacGuest && pacGuest.mode === "power" ? pacGuest.m : 0, flash = pm < 120 && Math.floor(pm / 12) % 2;
          const cornered = gh.x <= BAR_L - 11, shiver = cornered ? (Math.floor(t / 2) % 2 ? 1 : -1) : 0; // (cowering at the door: shivering)
          sprite("spr16", (flash ? A.scaredWhite : A.scaredBlue).frames[Math.floor(t / 10) % 2], Math.round(gh.x) + shiver, ly - 17 + Math.round(Math.sin(t * 0.2 + gh.ph)));
          continue;
        }
        const face = gh.mode === "leave" ? 2 : 0, fr = A[gh.name][face].frames[Math.floor((t + gh.ph * 10) / 10) % 2];
        const bob = Math.round(Math.sin(t * 0.08 + gh.ph) * (gh.mode === "sip" || gh.mode === "leave" ? 2 : 1));
        if (gh.rage && gfx.recolored) { // impatient: red-hot (flickering to orange) and scowling, as in the other hidden games
          if (Math.floor(t / 6) % 2) gfx.recolored("spr16", fr, Math.round(gh.x), ly - 17 + bob, BODY[gh.name], gh.name === "clyde" ? [255, 32, 0] : RAGE_RGB); // (Clyde, orange already, flickers to red) else sprite("spr16", fr, Math.round(gh.x), ly - 17 + bob);
          x.fillStyle = "#200000";
          for (const [bx, by] of [[3, 3], [4, 3], [5, 4], [6, 4], [12, 3], [11, 3], [10, 4], [9, 4]]) x.fillRect(Math.round(gh.x) + 1 + bx, ly - 17 + bob + by, 1, 1);
        } else sprite("spr16", fr, Math.round(gh.x), ly - 17 + bob);
        if (gh.mode !== "leave") for (let k = 0; k < gh.need; k++) { // a tiny glass for each martini it still wants
          const px = Math.round(gh.x) + 8 - gh.need * 2 + k * 4, py = ly - 23 + bob;
          x.fillStyle = "#e8f8ff"; x.fillRect(px, py, 3, 1); x.fillRect(px + 1, py + 1, 1, 2);
        }
      }
      // Pac-Man: chomping his way in (faster once energized), out again, or caught (his own death)
      if (A && pacGuest) {
        const pg = pacGuest, ly = LANES[pg.lane];
        if (pg.mode === "dying") { if (pg.m < 70) sprite("spr16", 74 + Math.min(10, Math.floor(pg.m / 7)), Math.round(pg.x), ly - 16); }
        else { const fr = A.pac[pg.mode === "leave" || (pg.mode === "power" && pg.dir === 2) ? 2 : 0].frames; sprite("spr16", fr[Math.floor(pg.f / (pg.mode === "power" ? 2 : 4)) % fr.length], Math.round(pg.x), ly - 16); }
      }
      // the martinis on the bar
      for (const d of drinks) x.drawImage(martiniCanvas(), Math.round(d.x) - 4, LANES[d.lane] - 9);
      // their bubbles
      for (const b of fizz) {
        if (b.age > b.life) {
          const k = (b.age - b.life) / 4, rr = b.r + 1 + k * 2; x.globalAlpha = (1 - k) * 0.7; x.fillStyle = "#b0b0ff";
          for (let j = 0; j < 6; j++) { const a = j * Math.PI / 3 + b.ph; x.fillRect(Math.round(b.x + Math.cos(a) * rr), Math.round(b.y + Math.sin(a) * rr), 1, 1); }
        } else if (gfx && gfx.bubble) {
          const spr = gfx.bubble(b.r); x.globalAlpha = Math.min(1, b.age / 2) * Math.min(1, 2 * (1 - b.age / b.life)) * 0.9;
          x.drawImage(spr, Math.round(b.x - spr.width / 2), Math.round(b.y - spr.height / 2));
        }
        x.globalAlpha = 1;
      }
      // Booze Elroy behind the bar, at his counter: tipping as he sends one off, a gentle sway otherwise; flashing when it's gone wrong
      if (A && !(phase === "oops" && Math.floor(oopsT / 8) % 2)) {
        const fr = A.booze.frames[Math.floor(t / 10) % 2], ly = LANES[lane], tilt = -0.45 * serveTilt + Math.sin(t * 0.06) * 0.06;
        if (gfx.spriteTurned) gfx.spriteTurned("spr16", fr, ELROY_X, ly - 8 + Math.sin(t * 0.12), tilt); else sprite("spr16", fr, ELROY_X - 8, ly - 16);
      }
      // the points: the arcade's ghost-score picture, or its fruit-score one
      for (const pp of popups) {
        if (!pp.fruit && GHOST_PICS.includes(pp.p) && ghostScore) ghostScore(pp.p, Math.max(8, Math.min(W - 8, pp.x)), pp.y);
        else if (gfx && gfx.fruitScore) gfx.fruitScore(pp.p, Math.max(24, Math.min(W - 24, pp.x)), pp.y);
      }
      // lives: little martinis, bottom left
      for (let i = 0; i < Math.min(lives - (phase === "oops" || phase === "over" ? 0 : 1), 10); i++) x.drawImage(martiniCanvas(), 4 + i * 12, H - 12);
      x.restore();
      // the header, as in the game
      if (phase !== "play" || t % 32 < 16) print("1up", 3, 0);
      print("high score", 9, 0);
      print(formatScore(score), 0, 1, 0);
      print(formatScore(topScore()), 10, 1);
      print("round " + round, 28 - ("round " + round).length, 0, 3); // (its name is 9 letters: on the second row, clear of HIGH SCORE)
      print("last call", 19, 1, 6);
      const mid = (s, y, c) => print(s, 14 - s.length / 2, y, c);
      const SHIMMER = [1, 2, 6, 0, 3, 4];
      if (phase === "ready") {
        const title = "last call";
        for (let i = 0; i < title.length; i++) if (title[i] !== " ") print0(title[i], 9.5 + i, 5, SHIMMER[(Math.floor(t / 5) + i) % SHIMMER.length]);
        if (t > 30) mid("ready!", 7, 6);
      }
      if (phase === "play" && quota - served <= 3 && quota - served > 0 && Math.floor(t / 15) % 2 === 0) mid("last call!", 5, 6); // (blinking twice a second)
      if (phase === "oops") mid(oopsWhy === "glass" ? "broken glass!" : "caught!", 5, 1);
      if (phase === "clear" && t > 20) { mid("round " + round + " done", 5, 3); if (t > 60) mid("next round", 7, 6); }
      if (phase === "over") {
        if (board && !asking) { // the top 10, centred, the new entry in yellow (as in the other hidden games)
          const top = 11;
          x.globalAlpha = 0.75; x.fillStyle = "#000"; x.fillRect(0, (top - 1) * 8, W, 16 * 8); x.globalAlpha = 1;
          mid("game over", top, 1);
          mid("high scores", top + 2, 3);
          if (!board.length) mid("no scores yet", top + 5, 0);
          board.slice(0, 10).forEach((e, i) => {
            const mine = myRank === i + 1, c = mine ? 6 : 0, y = top + 4 + i;
            print(String(i + 1).padStart(2), 0, y, mine ? 6 : 3); print(formatScore(e.score), 3, y, c); print(e.name, 12, y, c);
          });
        } else mid("game over", 5, 1);
      }
      if (paused) mid("paused", 5, 6);
    }

    // ------------------------------------------------------------------ input
    const FIRE = new Set(["space", "return", "z", "lalt", "left", "a"]);
    function key(k, down) {
      if (!on || !down) return;
      if (k === "escape") { exit(); return; }
      if (k === "p" || k === "tab") { paused = !paused; return; }
      if (paused) return;
      if (FIRE.has(k)) { if (phase === "over" && t > 60 && !asking) { newGame(); return; } serve(); return; }
      if (k === "up" || k === "w") moveLane(-1);
      if (k === "down" || k === "s") moveLane(1);
    }
    function touch(kind, id, px, py) { // a tap on a counter: Elroy steps over to it and sends one down
      if (!on || kind !== "down") return;
      if (phase === "over" && t > 60 && !asking) { newGame(); return; }
      let best2 = 0; LANES.forEach((ly, i) => { if (Math.abs(py - (ly - 8)) < Math.abs(py - (LANES[best2] - 8))) best2 = i; });
      moveLane(best2 - lane); serve();
    }
    let onExit = null;
    function start(exitFn) { onExit = exitFn; on = true; paused = false; newGame(); }
    function exit() { if (!on) return; on = false; silence(); const f = onExit; onExit = null; if (f) f(); }
    const test = { why: () => (whyLog = whyLog || []), state: () => ({ phase, score, lives, round, lane, quota, served, spawned, board, myRank, asking, ghosts: ghosts && ghosts.map((gh) => ({ name: gh.name, lane: gh.lane, x: Math.round(gh.x), need: gh.need, mode: gh.mode })), drinks: drinks && drinks.length, tips: tips && tips.length }),
      endGame: (s) => { score = s; lives = 1; oops("caught"); }, spawnNow: () => { spawnWait = 1; }, impatient: () => { for (const gh of ghosts) gh.rage = true; }, pacNow: () => { if (!pacGuest) pacGuest = { lane, x: BAR_L - 14, mode: "walk", m: 0, chain: 0, f: 0 }; }, pac: () => pacGuest && { ...pacGuest }, stage: (l, px, gxs) => { lane = l; pacGuest = { lane: l, x: px, mode: "walk", m: 0, chain: 0, f: 0 }; for (const gx of gxs) { ghosts.push({ lane: l, x: gx, name: "inky", need: 2, mode: "walk", m: 0, ph: 0, wait: 9999, rage: false }); spawned += 1; } spawnWait = 9999; }, finishRound: () => { served = quota; spawned = quota; ghosts = []; } };
    return { active: () => on, start, exit, step, key, touch, draw, test, background: "bar", onBoard: () => on && phase === "over" && !asking, refreshBoard: () => { board = []; myRank = null; loadBoard(); } }; // (its own living background: living.js bar)
  }
  root.BoozeLastCall = { create };
})(typeof self !== "undefined" ? self : this);
