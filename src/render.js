/* Booze Elroy - rendering (browser only).
 * Draws the 224x288 "arcade screen" with the same calls the Lua used (sprite quads, print, scissor, alpha),
 * then presents it through one WebGL pass that reproduces the moonshine chain
 * (colorgradesimple -> scanlines -> crt barrel distortion).
 */
(function (root) {
  "use strict";
  const GW = 224, GH = 288, TILE = 8;
  // text8 sheet index follows the Lua source's BYTE positions: the copyright sign is 2 bytes in UTF-8
  const TEXT_CHARS = 'ABCDEFGHIJKLMNO PQRSTUVWXYZ!' + "Â©" + '##0123456789/-"?\\$%^&*()_';
  const GHOST_SCORES = { 200: 106, 400: 107, 800: 108, 1600: 109, 3200: 110, 6400: 111, 12800: 112, 25600: 113 };
  const FRUIT_SCORES = { 100: 114, 300: 117, 500: 120, 700: 123, 1000: 126, 2000: 129, 3000: 132, 5000: 135 };

  function createRenderer(core, assets) {
    const g = core.g;
    const T = core.T;
    const screen = document.createElement("canvas");
    screen.width = GW; screen.height = GH;
    const ctx = screen.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    // web edition: the vector look draws the font as plain pixels, not outlines (the traced letters looked odd). Every
    // text glyph (not the logo's pieces) is also drawn into this mask, which the presenter's vector pass reads; only
    // kept up while that look is on
    const textMask = document.createElement("canvas");
    textMask.width = GW; textMask.height = GH;
    const mctx = textMask.getContext("2d");
    mctx.imageSmoothingEnabled = false;
    let masking = false;
    const LOGO_PIECES = "$%^&*()_";

    const sheets = {};
    function addSheet(name, img, fw, fh) {
      const cols = Math.floor(img.width / fw), rows = Math.floor(img.height / fh);
      sheets[name] = { img, fw, fh, cols, count: cols * rows };
    }
    addSheet("spr16", assets.sprites.spr16, 16, 16);
    addSheet("spr8", assets.sprites.spr8, 8, 8);
    addSheet("text8", assets.sprites.text8, 8, 8);

    // ---- love.graphics.setColor emulation (persists until changed, like LOVE)
    let col = [1, 1, 1, 1];
    const setColor = (r, gg, b, a) => { col = [r, gg, b, a === undefined ? 1 : a]; hollow = false; };
    // web edition: an ability not ready ("out of gas") draws Pac-Man hollow: a darker yellow at his edge fading smoothly to a very dark yellow in the middle
    // (each pixel's shade from its distance to the nearest empty pixel), instead of the original flat dark tint. Baked once per sprite frame.
    let hollow = false;
    // (the vector look only draws outlines, so there he has no inside to hollow out: a dimmer yellow instead)
    const setHollow = () => { if (g.config.crtEffect === "vector") { col = [0.42, 0.42, 0.42, 1]; hollow = false; } else { col = [1, 1, 1, 1]; hollow = true; } };
    const HOLLOW_EDGE = [150, 146, 0], HOLLOW_MID = [62, 58, 0], HOLLOW_FADE = 3; // pixels from the edge to the darkest shade
    const hollowCache = new WeakMap(); // sheet -> Map(frame -> canvas)
    function hollowFrame(s, sx, sy) {
      if (!hollowCache.has(s)) hollowCache.set(s, new Map());
      const frames = hollowCache.get(s), k = sx + "," + sy;
      let c = frames.get(k);
      if (c) return c;
      const w = s.fw, h = s.fh;
      c = document.createElement("canvas"); c.width = w; c.height = h;
      const cc = c.getContext("2d");
      cc.drawImage(s.img, sx, sy, w, h, 0, 0, w, h);
      const im = cc.getImageData(0, 0, w, h), px = im.data;
      const empty = [];
      for (let y = -1; y <= h; y++) for (let x = -1; x <= w; x++) if (x < 0 || y < 0 || x >= w || y >= h || px[(y * w + x) * 4 + 3] === 0) empty.push([x, y]);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        if (px[o + 3] === 0) continue;
        let d = Infinity;
        for (const [ex, ey] of empty) { const dd = (ex - x) * (ex - x) + (ey - y) * (ey - y); if (dd < d) d = dd; }
        let t = Math.min(1, (Math.sqrt(d) - 1) / HOLLOW_FADE);
        t = t * t * (3 - 2 * t); // smoothstep
        for (let ch = 0; ch < 3; ch++) px[o + ch] = Math.round(HOLLOW_EDGE[ch] + (HOLLOW_MID[ch] - HOLLOW_EDGE[ch]) * t);
      }
      cc.putImageData(im, 0, 0);
      frames.set(k, c);
      return c;
    }
    const tmp = document.createElement("canvas"); tmp.width = 16; tmp.height = 16;
    const tctx = tmp.getContext("2d");
    tctx.imageSmoothingEnabled = false;
    const camX = () => -Math.floor(g.startX || 0);
    const camY = () => -Math.floor(g.startY || 0);

    function blit(s, i, x, y, angle, ox, oy) {
      const sx = (i % s.cols) * s.fw, sy = Math.floor(i / s.cols) * s.fh;
      let src = s.img, ssx = sx, ssy = sy;
      const tinted = col[0] !== 1 || col[1] !== 1 || col[2] !== 1;
      if (hollow) {
        src = hollowFrame(s, sx, sy); ssx = 0; ssy = 0;
      } else if (tinted) {
        tctx.clearRect(0, 0, 16, 16);
        tctx.globalCompositeOperation = "source-over";
        tctx.drawImage(s.img, sx, sy, s.fw, s.fh, 0, 0, s.fw, s.fh);
        tctx.globalCompositeOperation = "multiply";
        tctx.fillStyle = `rgb(${Math.round(col[0] * 255)},${Math.round(col[1] * 255)},${Math.round(col[2] * 255)})`;
        tctx.fillRect(0, 0, s.fw, s.fh);
        tctx.globalCompositeOperation = "destination-in";
        tctx.drawImage(s.img, sx, sy, s.fw, s.fh, 0, 0, s.fw, s.fh);
        tctx.globalCompositeOperation = "source-over";
        src = tmp; ssx = 0; ssy = 0;
      }
      ctx.globalAlpha = col[3];
      if (angle) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
        ctx.drawImage(src, ssx, ssy, s.fw, s.fh, -ox, -oy, s.fw, s.fh);
        ctx.restore();
      } else ctx.drawImage(src, ssx, ssy, s.fw, s.fh, x - (ox || 0), y - (oy || 0), s.fw, s.fh);
      ctx.globalAlpha = 1;
    }

    function drawSprite(sheet, idx, x, y, maze) {
      const s = sheets[sheet]; if (!s) return;
      const i = idx - 1;
      if (!(i >= 0 && i < s.count)) return;
      blit(s, i, (maze ? camX() : 0) + x, (maze ? camY() : 0) + y);
    }
    const drawSpriteAtTile = (sheet, idx, x, y, maze) => drawSprite(sheet, idx, x * TILE, y * TILE, maze);

    function print(str, x, y, o, maze) {
      o = o || 0;
      const up = str.toUpperCase();
      for (let i = 0; i < up.length; i++) {
        const idx = TEXT_CHARS.indexOf(up[i]) + 1;
        if (idx > 0) drawSprite("text8", o * 64 + idx, x * TILE, y * TILE, maze);
        if (idx > 0 && masking && up[i] !== " " && !LOGO_PIECES.includes(up[i])) {
          const s = sheets.text8, j = o * 64 + idx - 1;
          mctx.globalAlpha = col[3];
          mctx.drawImage(s.img, (j % s.cols) * 8, Math.floor(j / s.cols) * 8, 8, 8, (maze ? camX() : 0) + x * TILE, (maze ? camY() : 0) + y * TILE, 8, 8);
          mctx.globalAlpha = 1;
        }
        x += 1;
      }
    }

    function drawChar(o, x, y, phased, maze) {
      const a = o.animator();
      if (!a || !a.frames) return;
      o.frame = o.frame || 1;
      let frameIndex = a.frames[o.frame - 1];
      if (frameIndex === undefined) { o.frame = 1; frameIndex = a.frames[0]; }
      const s = sheets[a.spr];
      if (frameIndex === undefined || !s || frameIndex > s.count) return;
      const inGame = g.scene.name === "game";
      if (inGame && o === g.chars.pac && g.config.movement === 3 && g.chars.pac.speed > core.constants.MAX_THRUST) setColor(1, 0.3, 0.3);
      if (o.target && T(o.stunned)) setColor(Math.random(), Math.random(), Math.random());
      else if (o.target && !T(o.frightened) && !T(o.dead) && inGame && T(g.config.radar) && T(g.radarTimer)) {
        let alpha = 0;
        if (g.radarTimer > g.config.radar) alpha = g.radarTimer - g.config.radar;
        setColor(1, 1, 1, alpha / 60);
      }
      if (T(phased)) {
        const ab = g.config.ability;
        if (ab === 1) {
          if (phased >= 0) setColor(Math.random(), Math.random(), Math.random()); else setHollow();
        } else if (ab === 2) {
          if (phased < 0) setHollow(); // web edition: plain yellow while boosting (the Lua tinted him green)
        } else if (ab === core.PAUSE) {
          if (phased < 0) setHollow(); // web edition: the Pause ability reloading
        } else if (ab === 3) {
          if (phased > 40) {
            const pac = g.chars.pac;
            const direction = [0, 90, 180, 270][pac.phaseDir] || 0;
            const alpha = (phased - 40) / 10;
            const r = core.constants.STUN_DISTANCE * 8 * (20 - (phased - 40)) / 20;
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
            ctx.fillStyle = "rgb(255,0,128)";
            ctx.beginPath(); ctx.moveTo(-g.startX + pac.x, -g.startY + pac.y + 24);
            ctx.arc(-g.startX + pac.x, -g.startY + pac.y + 24, Math.max(0, r), (direction - 8) * Math.PI / 180, (direction + 8) * Math.PI / 180);
            ctx.closePath(); ctx.fill(); ctx.restore();
            setColor(1, 1, 1);
          }
          setHollow();
        }
      }
      // web edition: the Rewind ability's charge shows the abilities' way: solid when ready, hollow once used
      if (inGame && o === g.chars.pac && g.config.ability === core.REWIND && g.rewindSpent && !g.rewinding) setHollow(); // full while it plays back; spent once it's done
      let angle = 0;
      if (T(o.stunned)) angle = (o.stunned * 6 * (o.spinDirection > 0.5 ? 1 : -1)) * Math.PI / 180;
      blit(s, frameIndex - 1, (maze ? camX() : 0) + x, (maze ? camY() : 0) + y + (maze ? 24 : 0), angle, 8, 8);
      if (inGame) setColor(1, 1, 1);
    }

    function drawScenery(o, x, y, fade) {
      const a = o.animator();
      o.frame = o.frame || 1;
      if (fade) setColor(1, 1, 1, g.fadeTimer / g.fadeLength());
      drawSpriteAtTile(a.spr, a.frames[o.frame - 1], x, y + 3, true);
      if (fade) setColor(1, 1, 1);
    }

    // ---- maze
    const decorations = {
      pac() { print("BO", 3, 6, 3, true); print("OZE", 8, 6, 3, true); print("ELR", 17, 6, 3, true); print("OY", 23, 6, 3, true); oyAt(23, 6); },
      large1() { print("BO", 8, 6, 3, true); print("OZE", 13, 6, 3, true); print("ELR", 22, 6, 3, true); print("OY", 28, 6, 3, true); oyAt(28, 6); },
      booze3() { drawSprite("spr16", 91, 88, 55, true); drawSprite("spr16", 15, 103, 56, true); drawSprite("spr16", 2, 120, 57, true); },
    };

    // web edition easter egg: the wall block round "OY" (as drawn this frame, in screen px) plays oy.mp3 when tapped (main.js)
    let oyBlock = null;
    function oyAt(tx, ty) { // clipped to the maze area (the large mazes scroll)
      const B = { x0: Math.max(0, camX() + (tx - 1) * TILE), x1: Math.min(GW, camX() + (tx + 3) * TILE),
        y0: Math.max(24, camY() + (ty - 1) * TILE), y1: Math.min(272, camY() + (ty + 2) * TILE) };
      oyBlock = B.x0 < B.x1 && B.y0 < B.y1 ? B : null;
    }

    function drawMaze(cm, color) {
      const ad = g.config.afterDark;
      const showMaze = !T(ad) || ad === 2 || ad >= 4;
      color = (color || 1) - 1;
      const INDEXES = core.INDEXES, MAXC = core.MAX_COLORS, map = cm.map;
      const fadeOn = T(ad) && ad >= 4 && g.mode !== "gameover";
      for (let y = 0; y < map.length; y++) {
        const row = map[y];
        for (let x = 0; x < row.length; x++) {
          let c = row[x];
          const fadeable = ad === 5 || INDEXES.indexOf(c) === -1;
          if (showMaze || g.mode === "gameover") c = cm.upperCase(c);
          const spriteNum = INDEXES.indexOf(c) + 1;
          if (spriteNum > 0 && (g.mode !== "levelAnimation" || c !== "P")) {
            if (fadeOn && fadeable) setColor(1, 1, 1, g.fadeTimer / g.fadeLength());
            drawSprite("spr8", (spriteNum - 1) * MAXC + 3 + color, x * TILE, (y + 3) * TILE, true);
            if (fadeOn && fadeable) setColor(1, 1, 1);
          }
        }
      }
      const dec = decorations[cm.name];
      if (dec && showMaze) {
        if (T(ad) && ad >= 4) setColor(1, 1, 1, g.fadeTimer / g.fadeLength());
        dec();
        if (T(ad) && ad >= 4) setColor(1, 1, 1);
      }
    }

    function clearScreen() {
      const v = g.config.crtEffect ? 13 : 0;
      ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(0, 0, GW, GH);
    }
    function drawBackground() {
      if (!g.currentBackground) g.currentBackground = g.config.background;
      const bg = assets.backgrounds[g.currentBackground];
      if (bg) ctx.drawImage(bg, 0, 0, GW, GH);   // already dimmed to 40% at build time
    }

    // Elroy's drunk bubbles (web edition). The core still emits its particles exactly as the Lua does (same RNG use);
    // here some of them become pixel-art cartoon bubbles with their own (render-only) life: they wobble upward, woozy,
    // swell a little and pop.
    const BUBBLE_SPRITES = [];
    for (let R = 1; R <= 5; R++) {
      const S = 2 * R + 3, c = document.createElement("canvas"); c.width = S; c.height = S;
      const x = c.getContext("2d"), m = S / 2, hx = m - R * 0.45, hy = m - R * 0.45, hr = Math.max(0.7, R * 0.28);
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const d = Math.hypot(i + 0.5 - m, j + 0.5 - m);
        if (Math.hypot(i + 0.5 - hx, j + 0.5 - hy) < hr && d < R) x.fillStyle = "#dcdcff"; // shine
        else if (Math.abs(d - R) < 0.62) x.fillStyle = j + 0.5 > m + R * 0.3 ? "#6a6aee" : "#a8a8ff"; // blue rim, darker underneath
        else if (d < R - 0.62) x.fillStyle = "rgba(128,128,255,0.35)"; // see-through blue middle (the original's colour)
        else continue;
        x.fillRect(i, j, 1, 1);
      }
      BUBBLE_SPRITES[R] = c;
    }
    const seenBubbles = new WeakSet(), bubbles = [];
    let bubbleCount = 0, bubbleT = 0, bubbleSource = null;
    function updateBubbles() {
      const now = performance.now(), dt = bubbleT ? Math.min(3, (now - bubbleT) / 16.67) : 1; bubbleT = now;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        b.age += dt;
        if (b.age > b.life + 4) { bubbles.splice(i, 1); continue; }
        if (b.age > b.life) continue; // popping
        b.x += (b.vx + Math.sin(b.age * 0.35 + b.phase) * 0.35 * b.wob) * dt;
        b.y += b.vy * dt; b.vy *= Math.pow(0.97, dt);
        b.r = Math.min(3, b.r + 0.02 * dt);
      }
    }
    function drawBubble(b) {
      const cx = -g.startX + b.x, cy = -g.startY + b.y + 24;
      if (b.age > b.life) { // pop: a little ring of specks flying out
        const t = (b.age - b.life) / 4, rr = b.r + 1 + t * 2;
        ctx.globalAlpha = (1 - t) * 0.7; ctx.fillStyle = "#b0b0ff";
        for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + b.phase; ctx.fillRect(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), 1, 1); }
        ctx.globalAlpha = 1;
        return;
      }
      const R = Math.max(1, Math.min(3, Math.round(b.r))), spr = BUBBLE_SPRITES[R];
      // fade in fast, dissolve over the second half of its life
      ctx.globalAlpha = Math.min(1, b.age / 2) * Math.min(1, 2 * (1 - b.age / b.life)) * 0.9;
      ctx.drawImage(spr, Math.round(cx - spr.width / 2), Math.round(cy - spr.height / 2));
      ctx.globalAlpha = 1;
    }
    function drawParticles() {
      // the core clears its particles with a fresh list (a new game, a death, the board done): the bubbles from the old one
      // go too, or the title's / demo's bubbles would float on into a new game
      if (g.particles !== bubbleSource) { bubbleSource = g.particles; bubbles.length = 0; }
      updateBubbles();
      for (const p of g.particles) {
        if (p.bubble) {
          if (!seenBubbles.has(p)) {
            seenBubbles.add(p);
            if (bubbleCount++ % 2 === 0) { // mostly tiny, the odd bigger one
              const big = Math.random() < 0.15;
              bubbles.push({ x: p.x, y: p.y - 2, vx: p.vx * 0.6, vy: -(0.6 + Math.random() * 0.5) + p.vy * 0.3,
                r: big ? 2.4 + Math.random() * 0.6 : 1 + Math.random() * 1, age: 0, life: 16 + Math.random() * 14,
                phase: Math.random() * Math.PI * 2, wob: 0.5 + Math.random() * 0.9 });
            }
          }
          continue;
        }
        const alpha = p.alpha !== undefined ? p.alpha : 1;
        const c = p.colors;
        ctx.fillStyle = `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${alpha})`;
        ctx.beginPath(); ctx.arc(-g.startX + p.x, -g.startY + p.y + 24, p.size, 0, Math.PI * 2); ctx.fill();
      }
      for (const b of bubbles) drawBubble(b);
      setColor(1, 1, 1);
    }

    function drawMenu(menu, x, y, spacing) {
      menu.forEach((item, i0) => {
        const i = i0 + 1;
        const color = menu.selectedItem === i ? 1 : 0;
        if (item.text) print(item.text, item.x !== undefined ? item.x : x, item.y !== undefined ? item.y : (y + i * spacing), color);
        else if (item.options) {
          const o = item.options[(item.selectedOption || 1) - 1];
          if (o) print(o.text, item.x !== undefined ? item.x : x, item.y !== undefined ? item.y : y + (i - 1) * spacing, color);
        }
      });
    }
    function drawHeader() {
      print("1up", 3, 0); print("high score", 9, 0);
      print(core.formatScore(g.score || 0), 0, 1, 0);
      drawHighScore();
      drawAccount();
    }
    // web edition: the account corner, where 2UP would be (menu screens and the attract demo, not in a game): "login",
    // or the player's name (light blue; a long one scrolls through the 8 columns). accountBox = its click area this frame
    let accountName = () => null, accountOnline = false, accountHot = false, accountBox = null, acctKey = null, acctT0 = 0;
    const ACCT_COL = 20, ACCT_W = 8;
    function drawAccount() {
      if (!accountOnline) return;
      const name = accountName();
      accountBox = { x0: ACCT_COL * TILE, x1: GW, y0: 0, y1: 2 * TILE, name };
      if (!name) { // "login" sparkles like "pinback" on the credits (a colour wave), to invite a click
        const w = "login", step = Math.floor(performance.now() / 110);
        for (let i = 0; i < w.length; i++) print(w[i], 22 + i, 0, accountHot ? 1 : PULSE[(step + w.length - i) % PULSE.length]);
        return;
      }
      if (name.length <= ACCT_W) { print(name, 28 - name.length, 0, 3); return; }
      const now = performance.now();
      if (acctKey !== name) { acctKey = name; acctT0 = now; }
      const gap = 3, span = (name.length + gap) * TILE;
      const t = (now - acctT0) % (TICK_HOLD + (span / TICK_SPEED) * 1000);
      const d = Math.round(Math.max(0, t - TICK_HOLD) * TICK_SPEED / 1000);
      clip(ACCT_COL * TILE, 0, ACCT_W * TILE, TILE);
      const x = ACCT_COL - d / TILE;
      print(name, x, 0, 3); print(name, x + name.length + gap, 0, 3);
      ctx.restore();
    }
    // HIGH SCORE value; the online leader's name scrolls through it while the value shown is the leader's score
    // (so not once a game, or an autoplay run, has gone past it)
    function drawHighScore() {
      if (!g.highScore) return;
      if (g.highScoreName && g.highScore === g.highScoreNameScore) drawLeaderTicker(core.formatScore(g.highScore), g.highScoreName);
      else print(core.formatScore(g.highScore), 10, 1);
    }
    // web edition: the HIGH SCORE field shows the score for a while, then scrolls left through the online leader's
    // name until the score slides back into place (own timer, never touches game state)
    const TICK_HOLD = 1500, TICK_SPEED = 40; // ms on the score, pixels per second
    let tickKey = null, tickT0 = 0;
    function drawLeaderTicker(score, name) {
      const now = performance.now();
      if (tickKey !== score + "|" + name) { tickKey = score + "|" + name; tickT0 = now; } // new leader: start on the score
      const gap = 3, span = (score.length + gap + name.length + gap) * TILE;
      const t = (now - tickT0) % (TICK_HOLD + (span / TICK_SPEED) * 1000);
      const d = Math.round(Math.max(0, t - TICK_HOLD) * TICK_SPEED / 1000);
      clip(9 * TILE, TILE, 10 * TILE, TILE); // under the "high score" label
      const x = 10 - d / TILE;
      print(score, x, 1);
      print(name, x + score.length + gap, 1, 4);
      print(score, x + score.length + gap + name.length + gap, 1);
      ctx.restore();
    }
    function begin(withBg) {
      ctx.globalAlpha = 1; setColor(1, 1, 1);
      clearScreen(); if (withBg) drawBackground();
    }
    const clip = (x, y, w, h) => { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); };

    // ---- scenes
    function drawAttract() {
      begin(true);
      const msg1 = "jolt country games", msg2 = "presents";
      drawHeader();
      if (g.state.showHelperText) {
        print(msg1, 14 - msg1.length / 2, 5);
        print(msg2, 14 - msg2.length / 2, 7);
        drawMenu(core.attractMenu, 6, 23, 1);
        print("web edition", 14 - "web edition".length / 2, 35, 2);
      }
      if (g.mode === "restart" && core.mode.isStarted("restart") && g.ghosts) {
        clip(0, 0, 224, 190);
        for (const name of ["blinky", "pinky", "inky", "clyde", "punky", "gunky", "gronky"]) { const c = g.ghosts[name]; if (c) drawChar(c, c.x, c.y); }
        if (g.modeTimer > 135) ctx.drawImage(assets.banner, g.ghosts.blinky.x - 100, g.ghosts.blinky.y + 7);
        else ctx.drawImage(assets.banner, 12, 97);
        ctx.restore();
        if (g.modeTimer < 560 && g.attractPac) {
          drawParticles();
          print("pac-man", 3, 19, 6);
          print(" - ", 10, 19);
          print("with a twist!", 12.5, 19, 3);
          drawChar(g.attractPac, g.attractPac.x, g.attractPac.y);
          for (let i = Math.ceil(g.attractPac.x); i <= 224; i++) {
            if (i % 8 === 0) {
              if (i === 176) { if (g.modeTimer % 20 < 10) drawSprite("spr8", 2, i, 176); }
              else drawSprite("spr8", 1, i, 176);
            }
          }
        }
      }
    }

    function drawGame() {
      const cm = core.getCurrentMaze();
      ctx.globalAlpha = 1; setColor(1, 1, 1);
      clearScreen();
      const inter = g.mode === "intermission1" || g.mode === "placeholderIntermission" || g.mode === "intermission2" || g.mode === "intermission3";
      if (!inter) drawBackground();

      if (g.mode === "playerUp") {
        print("player one", cm.w / 2 - 5, cm.playerone, 3, true);
        print("ready!", cm.w / 2 - 3, cm.ready, 6, true);
      } else if (g.state.showReady) {
        print("ready!", cm.w / 2 - 3, cm.ready, 6, true);
      }

      if (!g.state.hideScore) {
        if (core.gameFc() % 32 < 16) print("1up", 3, 0);
        print("high score", 9, 0);
        print(core.formatScore(g.score || 0), 0, 1, 0);
        // web edition: the leader's name scrolls in the attract demo and autoplay, never in a real game
        if (g.attract || g.autoplay) drawHighScore();
        else if (g.highScore) print(core.formatScore(g.highScore), 10, 1);
        if (g.attract) drawAccount();
      }
      if (g.mode === "gameover") {
        print("game", cm.w / 2 - 5, cm.ready, 1, true);
        print("over", cm.w / 2 + 1, cm.ready, 1, true);
      }

      if (!g.state.hideMaze) {
        clip(0, 24, 224, 248);
        if (g.mode === "levelAnimation" && g.modeTimer % 20 > 10) drawMaze(cm, core.maze.maxColors);
        else if (g.mode !== "pause") { if (!g.mazeFrightened) drawMaze(cm, g.currentMazeColor); }

        const ad = g.config.afterDark;
        if (((!T(ad) || ad === 1 || ad >= 4) && !g.mazeFrightened) || g.mode === "gameover") {
          if (g.mode === "playerUp") setColor(1, 1, 1, (135 - g.modeTimer) / 135);
          const f = T(ad) && ad >= 4 && g.mode !== "playerUp" && g.mode !== "gameover";
          for (const sc of g.dots) drawScenery(sc, sc.x, sc.y, f);
          if (g.mode === "playerUp") setColor(1, 1, 1);
        }
        if (g.mode === "playerUp") setColor(1, 1, 1, (135 - g.modeTimer) / 135);
        {
          const f = ad === 5 && g.mode !== "playerUp" && g.mode !== "gameover";
          for (const sc of g.powers) drawScenery(sc, sc.x, sc.y, f);
        }
        if (g.mode === "playerUp") setColor(1, 1, 1);
        drawParticles();
        ctx.restore();
        if (!g.state.hideLives) {
          for (let i = 1; i <= Math.min(5, g.lives); i++) drawSpriteAtTile("spr16", 85, i * 2, 34);
        }
      }

      const ld = g.level.levelDisplay;
      for (let i = 1; i <= ld.length; i++) {
        let f = ld[i - 1];
        if (g.config.plusMode) f = core.levels.plusModeFruitMap(f);
        drawSpriteAtTile(f.sheet, f.quad, 26 - i * 2, 34);
      }
      if (T(g.fruitTimer)) {
        const fl = cm.fruitLoc;
        let f = g.level.fruit;
        if (g.config.plusMode) f = core.levels.plusModeFruitMap(f);
        drawSprite(f.sheet, f.quad, fl.x - 8, fl.y + 24 - 8, true);
      }
      if (T(g.fruitScoreTimer)) {
        const fl = cm.fruitLoc;
        const quad = FRUIT_SCORES[g.level.fruit.score];
        for (let i = 0; i <= 2; i++) drawSprite("spr16", quad + i, fl.x - 8 + 16 * (i - 1), fl.y + 24 - 8, true);
      }

      clip(0, 24, 224, 248);
      const routes = debug && g.state.showGhosts && !g.state.hideMaze ? ghostRoutes() : null;
      if (routes) drawRoutes(routes);
      if (g.state.showPac) drawChar(g.chars.pac, g.chars.pac.x, g.chars.pac.y, g.chars.pac.phased, true);
      if (g.state.showGhosts) {
        for (const name of core.charKeys()) { const c = g.chars[name]; if (c.target && !c.hidden) drawChar(c, c.x, c.y, false, true); }
      }
      ctx.restore();
      if (routes) drawTargets(routes);

      const pac = g.chars.pac;
      if (g.mode === "ateGhost") {
        const q = GHOST_SCORES[g.ghostScore];
        if (q) drawSprite("spr16", q, pac.x - 8, pac.y + 24 - 8, true);
      }
      if (g.mode === "destroyed") drawSprite("spr16", 138, pac.x - 8, pac.y + 24 - 8, true);
      if (g.mode === "dying") {
        const px = pac.x - 8, py = pac.y + 24 - 8;
        if (g.modeTimer > 180) drawSprite("spr16", 74, px, py, true);
        else if (g.modeTimer > 100) {
          if (g.modeTimer <= 180 && !g.diedSoundPlayed) { g.sounds.died.play(); g.diedSoundPlayed = true; }
          drawSprite("spr16", 74 + Math.floor((180 - g.modeTimer) / 8), px, py, true);
        } else if (g.modeTimer > 70) drawSprite("spr16", 84, px, py, true);
      }

      if (g.mode === "intermission1") drawIntermission1();
      else if (g.mode === "intermission2") drawIntermission2();
      else if (g.mode === "intermission3") drawIntermission3();
      if (g.rewinding) drawRewindTape();
    }

    // web edition: the Rewind ability plays back like a VCR rewinding: the picture tears sideways in bands, a noise bar
    // rolls through, streaks of static, and a blinking rewind sign in the corner. Drawn over the game picture, so it shows
    // in every look (plain, CRT, TV); render-only randomness (Math.random), nothing the game itself depends on
    function drawRewindTape() {
      const cv = ctx.canvas;
      ctx.save();
      ctx.globalAlpha = 1;
      for (let i = 0; i < 4; i++) { // torn bands, yanked sideways
        const y = 24 + Math.floor(Math.random() * 236), h = 2 + Math.floor(Math.random() * 12), dx = Math.round((Math.random() - 0.5) * 20);
        ctx.drawImage(cv, 0, y, GW, h, dx, y, GW, h);
      }
      const t = performance.now();
      const by = 24 + Math.floor((t / 3) % 260) - 12; // a noise bar rolling up the picture
      ctx.fillStyle = "rgba(255,255,255,0.07)"; ctx.fillRect(0, GH - by, GW, 12);
      for (let i = 0; i < 16; i++) { // streaks of static
        ctx.fillStyle = "rgba(255,255,255," + (0.15 + Math.random() * 0.4).toFixed(2) + ")";
        ctx.fillRect(Math.floor(Math.random() * GW), 24 + Math.floor(Math.random() * 248), 3 + Math.floor(Math.random() * 28), 1);
      }
      if (Math.floor(t / 250) % 2 === 0) { // the rewind sign, two pixel triangles pointing left, top right of the maze
        ctx.fillStyle = "#fff";
        const ox = GW - 26, oy = 30;
        for (let r = 0; r < 9; r++) {
          const w = 2 * (5 - Math.abs(4 - r)) - 1; // 1, 3, 5, 7, 9, 7, 5, 3, 1 ... as widths of a left-pointing triangle
          ctx.fillRect(ox + 9 - w, oy + r, w, 1);
          ctx.fillRect(ox + 19 - w, oy + r, w, 1);
        }
      }
      ctx.restore();
    }

    function dialogue(text, x, y) { print(text, x, y, 3); print("\\", x + 9, y + 2, 3); }
    function drawIntermission1() {
      const I = g.intermission1, t = g.modeTimer;
      if (!(t <= 660 && core.mode.isStarted("intermission1") && I && I.blinky && I.pac)) return;
      drawChar(I.blinky, I.blinky.x, I.blinky.y);
      if (core.intermissions.intermission1.pacVisible(t)) drawChar(I.pac, I.pac.x, I.pac.y);
      else {
        drawSprite("spr16", 6, 181, 132);
        if (t < 430 && t > 360) dialogue("want some rye?", 12, 13);
        else if (t < 340 && t > 240) dialogue("course ya do!", 12, 13);
        if (t < 240 && t > 180) drawSprite("spr16", 91, 130 + Math.floor((t - 180) / 1.5), 132);
      }
      if (t <= 180) drawParticles();
    }
    function drawIntermission2() {
      const I = g.intermission2, t = g.modeTimer;
      if (!I) return;
      if (t <= 660 && core.mode.isStarted("intermission2")) {
        for (const n of ["blinky", "pac", "pinky", "inky", "clyde", "punky", "gunky", "gronky"]) {
          const c = I[n];
          if (c !== I.pac || t > 440 || t < 120) drawChar(c, c.x, c.y);
        }
      }
      if (t < 440 && t > 120) drawSprite("spr16", 6, 158, 132);
      if (t < 365 && t > 300) {
        print("what is this?", (I.blinky.x - 80) / 8, (I.blinky.y - 30) / 8, 3);
        print("\\", (I.blinky.x - 20) / 8, (I.blinky.y - 15) / 8, 3);
      }
      if (t < 560 && t > 440) {
        print("we got him now!", I.blinky.x / 8, (I.blinky.y - 30) / 8, 3);
        print("/", (I.blinky.x + 10) / 8, (I.blinky.y - 15) / 8, 3);
      }
      if (t < 260 && t > 180) {
        print("an intervention", (I.gronky.x - 130) / 8, (I.gronky.y - 30) / 8, 3);
        print("\\", (I.gronky.x - 20) / 8, (I.gronky.y - 15) / 8, 3);
      }
      if (t > 0 && t < 120) {
        print("nooooo!!!!", (I.blinky.x - 80) / 8, (I.blinky.y - 30) / 8, 3);
        print("\\", (I.blinky.x - 20) / 8, (I.blinky.y - 15) / 8, 3);
      }
      if (t < 60 && t > 0) {
        print("just let him go", (I.pinky.x - 130) / 8, (I.pinky.y + 30) / 8, 3);
        print("/", (I.pinky.x - 20) / 8, (I.pinky.y + 15) / 8, 3);
      }
    }
    let film = false; // Mina's film is on screen this frame
    function drawIntermission3(t = g.modeTimer, started = core.mode.isStarted("intermission3")) {
      const v = assets.video;
      if (t <= 780 && t > 300 && started && v && v.readyState >= 2) {
        // web edition: the film is 480x270 with a portrait picture (x 146-333) between baked-in black bars; the original
        // drew the whole frame about 1:1 from the top, leaving bars at the sides and a gap at the bottom. Crop to the
        // picture and fill the screen with it; the trim (~30 rows at this aspect) comes mostly off the bottom (blanket),
        // her hair starts ~20 rows down
        const sx = 147, sw = 186, sh = Math.round(sw * GH / GW), sy = Math.min(6, 270 - sh);
        // smoothly (it's a photo, not pixel art); `film` tells the plain look's presenter to scale smoothly too
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(v, sx * v.videoWidth / 480, sy * v.videoHeight / 270, sw * v.videoWidth / 480, sh * v.videoHeight / 270, 0, 0, GW, GH);
        ctx.imageSmoothingEnabled = false; film = true;
      }
      if (t < 300 && t > 120) { setColor(1, 1, 1, Math.abs((t - 300) / 120)); print("for mina", 10, 17, 3); }
      if (t <= 120 && t > 0) { setColor(1, 1, 1, t / 120); print("for mina", 10, 17, 3); }
      setColor(1, 1, 1);
    }

    function drawOptions() {
      begin(true); drawHeader();
      print("GAME OPTIONS", 3, 3, 3);
      [["Maze Pack", 4], ["Starting Level", 5], ["Difficulty", 6], ["Plus Mode", 7], ["Blindfold", 8], ["Sonar", 9]].forEach((r) => print(r[0], 3, r[1]));
      print("PLAYER OPTIONS", 3, 11, 3);
      [["Starting Lives", 12], ["extra life", 13], ["Ability", 14], ["Speed", 15]].forEach((r) => print(r[0], 3, r[1]));
      print("GHOST OPTIONS", 3, 17, 3);
      [["Ghosts", 18], ["Pinky Bug", 19], ["Scatter", 20], ["Unrestricted", 21]].forEach((r) => print(r[0], 3, r[1]));
      print(core.optMenu.some((it) => it.key === "volume") ? "AUDIO/VIDEO" : core.optMenu.some((it) => it.key === "proMode") ? "STYLE" : "VIDEO", 3, 23, 3); // web edition: no volume row; "STYLE" with Pro Mode
      // labels follow the menu's own rows (web edition: some rows can go, e.g. CRT Effect is the C key)
      const AV_LABELS = { background: "Background", mazeColor: "Maze Style", crtEffect: "CRT Effect", volume: "sfx volume", proMode: "Pro Mode" };
      for (const it of core.optMenu) if (AV_LABELS[it.key]) print(AV_LABELS[it.key], 3, it.y);
      drawMenu(core.optMenu, 18, 5, 1);
      const mc = g.config.mazeColor;
      if (mc > 0 && mc < 99) drawSpriteAtTile("spr8", mc + 2, 21, 25);
    }

    // "pinback" pulses through colours, a wave running left to right (own timer, never touches game RNG)
    const PULSE = [4, 6, 0, 3, 2, 3, 0, 6];
    function pulseName() {
      const name = "pinback", step = Math.floor(performance.now() / 110);
      for (let i = 0; i < name.length; i++) print(name[i], 14 - name.length / 2 + i, 11, PULSE[(step + name.length - i) % PULSE.length]);
    }
    // ghostly message drifting along the bottom: one pass, then a couple of seconds of nothing; links to the substack
    const PHRASE = "what is seeing this?";
    const SCROLL_SPEED = 18, SCROLL_GAP = 2; // px/s, seconds between passes
    const SCROLL_TRAVEL = (224 + 8 + PHRASE.length * 8) / SCROLL_SPEED;
    function scrollMessage() {
      const now = performance.now(), t = now / 16.67, ph = (now / 1000) % (SCROLL_TRAVEL + SCROLL_GAP);
      if (ph > SCROLL_TRAVEL) return;
      const x0 = 224 - ph * SCROLL_SPEED;
      for (let k = 0; k < PHRASE.length; k++) {
        const px = Math.round(x0 + k * 8);
        if (px < -8 || px > 224 || PHRASE[k] === " ") continue;
        const edge = Math.max(0, Math.min(1, (px + 8) / 48, (224 - px) / 48));
        const a = (0.2 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.05 + k * 0.55))) * edge;
        const y = 34 * 8 + Math.round(Math.sin(t * 0.04 + k * 0.7) * 1.5);
        setColor(1, 1, 1, a);
        // the font only has "?" in colour 3
        print(PHRASE[k], px / 8, y / 8, PHRASE[k] === "?" ? 3 : [3, 2, 0][(k + Math.floor(t / 40)) % 3]);
      }
      setColor(1, 1, 1);
    }
    const LINKS = [
      { x0: 80, y0: 84, x1: 144, y1: 100, url: "mailto:bparrish99@gmail.com" },
      { x0: 0, y0: 264, x1: 224, y1: 284, url: "https://pinback.substack.com", secret: "wake" }, // a secret achievement (main.js)
    ];
    // web edition: "web edition" on the title opens the credits
    const TITLE_LINKS = [{ x0: 64, y0: 276, x1: 160, y1: 288, scene: "credits" }];
    const creditsLinks = () => (g.scene.name === "credits" ? LINKS : g.scene.name === "attract" && g.state && g.state.showHelperText ? TITLE_LINKS : g.scene.links || []);

    function drawCredits() {
      begin(true); drawHeader();
      const c = (m, y, o) => print(m, 14 - m.length / 2, y, o);
      c("booze elroy", 7, 3);
      c("designed and developed by", 10); pulseName();
      c("testing and support by", 13); c("ice cream jonsey", 14, 4); c("the beefer", 15, 4);
      c("dj larry", 16, 4); c("the jolt country team", 17, 4);
      c("all other materials", 19);
      print("owned by", 6.5, 20, 4); print("$%^&*()_", 14.5, 20, 2);
      c("based on", 23);
      print("pac-man", 2.5, 24, 6); print("by", 10.5, 24); print("toru iwatani", 13, 24, 2);
      drawSpriteAtTile("spr16", 2, 10.5, 25.5);
      for (const x of [12, 13, 14, 15]) drawSpriteAtTile("spr8", 1, x, 26);
      drawSpriteAtTile("spr16", 67, 16, 25.5);
      drawMenu(core.creditsMenu, 12, 27, 2);
      scrollMessage();
      drawChar(core.creditsBooze, core.creditsBooze.x, core.creditsBooze.y);
    }

    // ---- web edition: online leaderboard and arcade name entry (scenes live in leaderboard.js)
    const center = (m, y, o) => print(m, 14 - m.length / 2, y, o);
    // the leaderboard page; an arena page is the same with its own title / time left (sc.title, sc.subtitle)
    function drawLeaderboard() {
      const sc = g.scene;
      begin(true); drawHeader();
      if (sc.title) { center(sc.title(), 3, 3); center(sc.subtitle(), 4, 2); }
      else center("leaderboard", 4, 3);
      const lay = sc.layout || { summaryTop: 6, summaryLines: 5, listTop: 12, messageRow: 31 }; // the arena page packs tighter
      sc.summary(26).slice(0, lay.summaryLines).forEach((l, i) => center(l, lay.summaryTop + i, 0));
      const b = sc.board();
      if (!b.entries.length) center(sc.emptyText ? sc.emptyText(b) : b.status === "loading" ? "loading" : b.status === "error" ? "leaderboard offline" : "no scores yet", 20, 0);
      b.entries.slice(0, 10).forEach((e, i) => {
        const y = lay.listTop + i * 2, hi = sc.highlight === i + 1;
        const o = hi ? (sc.fc % 30 < 15 ? 1 : 3) : 0;
        const rk = String(i + 1);
        print(rk, 3 - rk.length, y, o);
        print(core.formatScore(e.score), 4, y, o);
        print(e.name, 12, y, hi ? o : 4);
      });
      if (sc.message) center(sc.message, lay.messageRow, 2);
      drawMenu(sc.menu, 12, 33, 1);
    }
    // arena list: names are the menu; time left / winners / headings are sc.decor
    function drawArenas() {
      const sc = g.scene;
      begin(true); drawHeader();
      center("arenas", 3, 3);
      const st = sc.status();
      if (!sc.menu.some((it) => it.id)) {
        if (st === "loading") center("loading", 15, 0);
        else if (st === "error") center("no running arenas", 15, 0);
      }
      for (const d of sc.decor) print(d.text, d.x, d.y, d.o);
      drawMenu(sc.menu, 0, 0, 1);
    }
    // web edition: the player's profile (src/account.js): name (shimmering), achievements (a row each, plus one for the date once earned; "prev 1/2 next" when they don't fit), (earned: yellow with the date; not yet:
    // dimmed). Hovering / tapping a name shows its description (an HTML popup, main.js). Rows 8-29 (account.js layout)
    const localDate = (ms) => { const d = new Date(ms), p2 = (n) => String(n).padStart(2, "0"); return d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()); };
    function drawProfile() {
      const sc = g.scene;
      begin(true); drawHeader();
      { // the player's name, shimmering like "login" / "pinback" on the credits
        const n = sc.player(), step = Math.floor(performance.now() / 110), x0 = 14 - n.length / 2;
        for (let i = 0; i < n.length; i++) print(n[i], x0 + i, 3, PULSE[(step + n.length - i) % PULSE.length]);
      }
      const list = sc.achievements(), got = list.filter((a) => a.earned).length;
      center("achievements " + got + "/" + list.length, 5, 3);
      if (sc.pageLabel()) center(sc.pageLabel(), 6, 2);
      if (!got && sc.status() === "loading") center("loading", 8, 0);
      else sc.pageItems().forEach((a) => {
        const y = a.y;
        if (!a.earned) ctx.globalAlpha = 0.45;
        print(a.name, 3, y, a.earned ? 6 : 0);
        if (a.earned) print(localDate(a.earned), 4, y + 1, 0);
        ctx.globalAlpha = 1;
      });
      drawMenu(sc.menu, 12, 33, 1);
    }
    function drawNameEntry() {
      const sc = g.scene;
      begin(true); drawHeader();
      if (sc.mode === "createArena") {
        center("create arena", 3, 3);
        sc.summary(26).slice(0, 4).forEach((l, i) => center(l, 5 + i, 0));
        center("arena name", 10, 2);
      } else {
        center("new high score!", 4, sc.fc % 40 < 20 ? 3 : 1);
        center((sc.arenaId && sc.arenaPlace ? "arena rank " : "rank ") + sc.place + "   " + String(sc.score), 6, 0);
        if (sc.arenaId) center(sc.arenaName, 8, 2);
        center("enter your name", 10, 0);
      }
      for (let i = 0; i < 16; i++) {
        const ch = sc.entry[i], x = 6 + i;
        if (ch !== undefined && ch !== " ") print(ch, x, 13, 1);
        else if (ch === undefined) {
          if (i === sc.entry.length) { if (sc.fc % 30 < 20) drawSpriteAtTile("spr8", 2, x, 13); }
          else drawSpriteAtTile("spr8", 1, x, 13);
        }
      }
      sc.menu.forEach((it, i0) => print(it.text, it.x, it.y, sc.menu.selectedItem === i0 + 1 ? 1 : 0));
      if (sc.sending) center("saving", 30, 2);
      else if (sc.mode === "createArena") { if (sc.message) center(sc.message, 30, 1); center("esc to cancel", 32, 2); }
      else { if (sc.message) center(sc.message, 28, 1); center("time " + Math.ceil(sc.timer / 60), 30, 0); center("esc to skip", 32, 2); }
    }

    // clickable rows of the current menu, in game pixels (mirrors drawMenu's placement)
    function menuLayout() {
      const scene = g.scene.name;
      let spec = null;
      if (scene === "attract") { if (g.state && g.state.showHelperText) spec = [core.attractMenu, 6, 23, 1]; }
      else if (scene === "options") spec = [core.optMenu, 18, 5, 1];
      else if (scene === "credits") spec = [core.creditsMenu, 12, 27, 2];
      else if ((scene === "leaderboard" || scene === "nameEntry" || scene === "arenas" || scene === "arena" || scene === "profile") && !g.scene.sending) spec = [g.scene.menu, 0, 0, 1];
      if (!spec) return [];
      const [menu, mx, my, sp] = spec, rows = [];
      menu.forEach((item, i0) => {
        const i = i0 + 1;
        const o = item.options ? item.options[(item.selectedOption || 1) - 1] : null;
        const text = item.text || (o && o.text) || "";
        const x = item.x !== undefined ? item.x : mx;
        const y = item.y !== undefined ? item.y : (item.text ? my + i * sp : my + (i - 1) * sp);
        const wide = scene === "options" && item.options;
        rows.push({ menu, index: i, hasOptions: !!item.options, x0: wide ? 24 : x * 8 - 4, x1: wide ? 220 : (x + text.length) * 8 + 4, y0: y * 8, y1: y * 8 + 8 });
      });
      return rows;
    }

    // web edition, test mode (xyzzy): each ghost's target (a crosshair; off the maze: a ring at the edge) and the path it
    // will take there by its own rules (core.projectGhost), in the ghost's colour (read off its sprite). Drawn on the
    // game picture, so it goes through the look like everything else
    let debug = false;
    const ghostColors = {};
    function ghostColor(name) {
      if (ghostColors[name]) return ghostColors[name];
      let best = "#ffffff";
      try {
        const a = core.animations[name][0], s = sheets[a.spr], i = a.frames[0] - 1;
        const c = document.createElement("canvas"); c.width = s.fw; c.height = s.fh;
        const cc = c.getContext("2d"); cc.drawImage(s.img, (i % s.cols) * s.fw, Math.floor(i / s.cols) * s.fh, s.fw, s.fh, 0, 0, s.fw, s.fh);
        const d = cc.getImageData(0, 0, s.fw, s.fh).data, n = {};
        for (let k = 0; k < d.length; k += 4) {
          if (d[k + 3] < 128 || (d[k] > 200 && d[k + 1] > 200 && d[k + 2] > 200) || (d[k] + d[k + 1] + d[k + 2] < 60)) continue; // eyes, black
          const key = `rgb(${d[k]},${d[k + 1]},${d[k + 2]})`; n[key] = (n[key] || 0) + 1;
        }
        let most = 0; for (const k in n) if (n[k] > most) { most = n[k]; best = k; }
      } catch { /* ignore */ }
      return (ghostColors[name] = best);
    }
    function ghostRoutes() {
      const out = [];
      core.charKeys().forEach((name, n) => {
        const c = g.chars[name]; if (!c.target || c.hidden) return;
        const r = core.projectGhost(c); if (!r) return;
        out.push({ ...r, color: ghostColor(name), off: [0, -1, 1, -2, 2, -3, 3][n] || 0, dead: !!c.dead });
      });
      return out;
    }
    const tileX = (x) => camX() + x * TILE + CENTER_PX, tileY = (y) => camY() + 24 + y * TILE + CENTER_PX;
    const CENTER_PX = core.constants.CENTER;
    function drawRoutes(routes) {
      ctx.save(); ctx.lineWidth = 1; ctx.lineJoin = "round"; ctx.globalAlpha = 0.8;
      for (const r of routes) {
        ctx.strokeStyle = r.dead ? "#ffffff" : r.color; ctx.setLineDash(r.dead ? [2, 2] : []);
        ctx.beginPath();
        r.path.forEach(([x, y], i) => {
          const px = tileX(x) + r.off + 0.5, py = tileY(y) + r.off + 0.5;
          const prev = r.path[i - 1];
          if (!prev || Math.abs(prev[0] - x) > 1 || Math.abs(prev[1] - y) > 1) ctx.moveTo(px, py); else ctx.lineTo(px, py); // tunnels wrap
        });
        ctx.stroke();
      }
      ctx.restore();
    }
    function drawTargets(routes) {
      const cm = core.getCurrentMaze();
      ctx.save(); ctx.lineWidth = 1; ctx.globalAlpha = 0.95;
      for (const r of routes) {
        const [tx, ty] = r.target;
        const inside = tx >= 0 && ty >= 0 && tx < cm.w && ty < cm.h;
        const cx = Math.min(GW - 5, Math.max(4, tileX(tx))) + 0.5, cy = Math.min(GH - 5, Math.max(4, tileY(ty))) + 0.5;
        ctx.strokeStyle = r.dead ? "#ffffff" : r.color;
        ctx.beginPath(); ctx.arc(cx, cy, 3.5, 0, Math.PI * 2); ctx.stroke();
        if (inside) { ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke(); }
      }
      ctx.restore();
    }

    function draw() {
      ctx.globalAlpha = 1; oyBlock = null; accountBox = null; film = false;
      if (masking || g.config.crtEffect === "vector") mctx.clearRect(0, 0, GW, GH);
      masking = g.config.crtEffect === "vector";
      const scene = g.scene.name;
      if (scene === "game") drawGame();
      else if (scene === "attract") drawAttract();
      else if (scene === "options") drawOptions();
      else if (scene === "credits") drawCredits();
      else if (scene === "leaderboard" || scene === "arena") drawLeaderboard();
      else if (scene === "arenas") drawArenas();
      else if (scene === "mina") { begin(false); drawIntermission3(g.scene.t, true); } // the "mina" cheat
      else if (scene === "nameEntry") drawNameEntry();
      else if (scene === "profile") drawProfile();
      else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, GW, GH); print(scene, 2, 2, 0); }
      drawToast();
    }
    // web edition: short popup message (g.toast = {text, until}), e.g. "link copied to clipboard"; "\n" starts a
    // second line (each line centred)
    function drawToast() {
      const tt = g.toast;
      if (!tt) return;
      if (performance.now() > tt.until) { g.toast = null; return; }
      const lines = tt.text.split("\n"), n = lines.length;
      const w = (Math.max(...lines.map((l) => l.length)) + 2) * 8, h = n * 8 + 8, x = Math.floor((GW - w) / 2), y = 15 * 8 - 4;
      ctx.globalAlpha = 0.9; ctx.fillStyle = "#000"; ctx.fillRect(x, y, w, h);
      if (masking) mctx.clearRect(x, y, w, h); // the text it covers is gone
      ctx.globalAlpha = 1; ctx.fillStyle = "#ffb8ff"; // pink frame, like the maze-wall highlights
      ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1); ctx.fillRect(x, y, 1, h); ctx.fillRect(x + w - 1, y, 1, h);
      setColor(1, 1, 1);
      lines.forEach((l, i) => print(l, 14 - l.length / 2, 15 + i, 0));
    }

    return { screen, textMask, draw, filmOn: () => film, setDebug: (on) => { debug = !!on; }, ghostColor, print, drawSprite, drawChar, ctx, GW, GH, menuLayout, creditsLinks, oyBlock: () => oyBlock,
      // account corner: fn() -> the logged-in name or null (fn.online false: no corner); hot = under the mouse
      setAccount(fn, online) { accountName = fn; accountOnline = !!online; }, accountBox: () => accountBox, setAccountHot(h) { accountHot = !!h; } };
  }

  // =============================================================== presenter: normal CRT + "MAX" CRT (non-canon)
  function createPresenter(canvas, source, getConfig, smoothNow = () => false, textMask = null) { // smoothNow: Mina's film is showing; textMask: where text is (vector look)
    let gl = null;
    try { gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true }); } catch { /* fall through */ }
    if (!gl) {
      const c2 = canvas.getContext("2d");
      return { webgl: false, ultra: true, resize(w, h) { canvas.width = w; canvas.height = h; }, present() { c2.imageSmoothingEnabled = true; c2.drawImage(source, 0, 0, canvas.width, canvas.height); } };
    }
    const VS = `attribute vec2 p; varying vec2 vuv; void main(){ vuv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const mk = (fs) => { const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(pr, 0, "p"); gl.linkProgram(pr); const u = {}; pr.u = (n) => (u[n] !== undefined ? u[n] : (u[n] = gl.getUniformLocation(pr, n))); return pr; };
    const HDR = "precision highp float; varying vec2 vuv; uniform sampler2D tex;";
    const pA = mk(HDR + `
      uniform vec2 distortion; uniform float feather, widthPx, thickness, opacity, screenH;
      void main(){
        vec2 q = vuv * 2.0 - 1.0;
        q += (q.yx * q.yx) * q * (distortion - 1.0);
        float mask = (1.0 - smoothstep(1.0 - feather, 1.0, abs(q.x))) * (1.0 - smoothstep(1.0 - feather, 1.0, abs(q.y)));
        vec2 uv = (q + 1.0) * 0.5;
        vec3 c = texture2D(tex, uv).rgb;
        float v = 0.5 * (sin((1.0 - uv.y) * screenH * 3.14159 / widthPx) + 1.0);
        c -= (vec3(0.0) - c) * (pow(v, thickness) - 1.0) * opacity;
        gl_FragColor = vec4(c * mask, 1.0);
      }`);
    const pT = mk(HDR + `uniform float minLuma;
      void main(){ vec3 c = texture2D(tex, vuv).rgb; float l = dot(vec3(0.299, 0.587, 0.114), c);
        gl_FragColor = vec4(c * step(minLuma, l), 1.0); }`);
    const pB = mk(HDR + `uniform vec2 dir; uniform float sigma;
      void main(){ vec3 acc = vec3(0.0); float wsum = 0.0;
        for (int i = -12; i <= 12; i++) { float f = float(i); float w = exp(-f * f / (2.0 * sigma * sigma)); acc += texture2D(tex, vuv + dir * f).rgb * w; wsum += w; }
        gl_FragColor = vec4(acc / wsum, 1.0); }`);
    const pF = mk(HDR + `uniform sampler2D glow; uniform vec3 factors; uniform float glowK;
      void main(){ vec3 c = texture2D(tex, vuv).rgb + texture2D(glow, vuv).rgb * glowK; gl_FragColor = vec4(clamp(c * factors, 0.0, 1.0), 1.0); }`);
    // plain look: "sharp bilinear". Nearest-neighbour at a non-whole scale makes some game pixels a screen pixel wider than
    // others (uneven dots); this keeps every game pixel a solid block of the same size and only blends the one screen pixel
    // its edge falls inside (sampled with LINEAR, the uv pushed to the texel centre everywhere else)
    // (soft = 1: Mina's film is on screen, a photo: plain bilinear like any video player, no pixel blocks)
    const pP = mk(HDR + `uniform vec2 srcSize, outSize; uniform float soft;
      void main(){
        if (soft > 0.5) { gl_FragColor = vec4(texture2D(tex, vuv).rgb, 1.0); return; }
        vec2 texel = vuv * srcSize, scale = outSize / srcSize;
        vec2 cd = fract(texel) - 0.5, region = max(0.5 - 0.5 / scale, 0.0);
        vec2 f = (cd - clamp(cd, -region, region)) * scale + 0.5;
        gl_FragColor = vec4(texture2D(tex, (floor(texel) + f) / srcSize).rgb, 1.0); }`);
    // the window's static bezel background: Z with the final pass's colour factors, flipped so readPixels comes out top row first
    const ULTRA_FACTORS = [1.08, 1.08, 1.25];
    const pG = mk(HDR + `uniform vec3 factors; void main(){ gl_FragColor = vec4(clamp(texture2D(tex, vec2(vuv.x, 1.0 - vuv.y)).rgb * factors, 0.0, 1.0), 1.0); }`);
    // phosphor persistence: new = max(source, previous * decay)
    const pH = mk(HDR + `uniform sampler2D prev; uniform float decay;
      void main(){ vec3 s = texture2D(tex, vuv).rgb; vec3 p = texture2D(prev, vuv).rgb * decay; gl_FragColor = vec4(max(s, p), 1.0); }`);
    // web edition: the C key's fourth look, "vector" (2026-11-13): as if the game were a 1980s vector (X-Y) monitor
    // game. Only the edges of what's drawn are traced, by a beam: outlines of every shape (where a lit pixel meets dark or
    // a different colour), so Pac-Man, the ghosts and the energizers become line drawings, as smooth glowing strokes on
    // pure black, every line at full beam brightness with a white-hot core where they're bright, and a faint phosphor
    // afterglow (new = max(beam, previous * decay)). The dim backgrounds don't make it (below the beam's threshold).
    // Drawn at 3x the game's size into VH; pU then puts it behind the same glass, without scanlines or a grille.
    // film = 1: Mina's film, shown as it is (no outlines, no trails)
    // text (the renderer's textMask) isn't traced: its pixels are drawn as CRT-style dots, with scanlines
    const pV = mk(HDR + `uniform sampler2D prev, mask; uniform vec2 srcSize; uniform float decay, film;
      vec3 px(vec2 t){ return texture2D(tex, (t + 0.5) / srcSize).rgb; }
      float isText(vec2 t){ return texture2D(mask, (t + 0.5) / srcSize).a; }
      float mx(vec3 c){ return max(c.r, max(c.g, c.b)); }
      vec3 edge(vec2 t){
        vec3 c = px(t); float m = mx(c);
        float lit = smoothstep(0.3, 0.45, m);
        if (lit <= 0.0 || isText(t) > 0.5) return vec3(0.0);
        float e = 0.0;
        vec3 n0 = px(t + vec2(1.0, 0.0)), n1 = px(t - vec2(1.0, 0.0)), n2 = px(t + vec2(0.0, 1.0)), n3 = px(t - vec2(0.0, 1.0));
        e = max(e, step(mx(n0), 0.3)); e = max(e, step(mx(n1), 0.3)); e = max(e, step(mx(n2), 0.3)); e = max(e, step(mx(n3), 0.3));
        e = max(e, step(0.35, distance(c, n0))); e = max(e, step(0.35, distance(c, n1)));
        e = max(e, step(0.35, distance(c, n2))); e = max(e, step(0.35, distance(c, n3)));
        return c / max(m, 0.7) * lit * e;
      }
      void main(){
        if (film > 0.5) { gl_FragColor = vec4(texture2D(tex, vuv).rgb, 1.0); return; }
        vec2 p = vuv * srcSize - 0.5, b = floor(p + 0.5);
        vec3 acc = vec3(0.0);
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
          vec2 t = b + vec2(float(dx), float(dy)), d = p - t;
          acc += edge(t) * exp(-dot(d, d) / 0.2); // a thin beam (wider looked soft)
        }
        float k = max(acc.r, max(acc.g, acc.b));
        // saturating stroke, keeps its hue; dimmed and a small white core, for a crisp line (brighter looked washed out)
        vec3 beam = acc / max(k, 1e-4) * (1.0 - exp(-k * 1.8)) * 0.85;
        beam += vec3(0.3) * smoothstep(0.9, 1.3, k) * (1.0 - exp(-k));
        // text: the CRT's way, each pixel a soft dot of light that runs into its neighbours sideways and leaves a dark
        // scanline between rows (flat blocks looked too clean)
        vec3 txt = vec3(0.0);
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
          vec2 t = b + vec2(float(dx), float(dy)), d = p - t;
          float m = isText(t);
          if (m > 0.0) { vec3 c = px(t); txt += c / max(max(c.r, max(c.g, c.b)), 0.7) * m * exp(-d.x * d.x / 0.45 - d.y * d.y / 0.11); }
        }
        beam = max(beam, min(txt, vec3(1.0)) * 0.9);
        gl_FragColor = vec4(max(beam, texture2D(prev, vuv).rgb * decay), 1.0);
      }`);
    // the MAX CRT: heavy barrel, rounded glass, RGB convergence error, horizontal bleed, beam-width scanlines,
    // aperture-grille triads, vignette, mains flicker, rolling hum bar, tracking glitches, static grain, glass glare, plastic bezel
    // the glint's hidden clock: the hour hand's angle (radians clockwise from 12) in the player's local time
    const hourAngle = () => { const d = new Date(); return ((d.getHours() % 12) + d.getMinutes() / 60) / 12 * 2 * Math.PI; };
    const CRT_ZOOM = 1.075; // glass size vs canvas (main.js toGame uses the same, via presenter.zoom)
    // the vector look's glass: nearly flat (barrel bend, also in main.js toGame via presenter.vecBend) and angular
    const VEC_BEND_XY = [0.012, 0.016], VEC_BEND = VEC_BEND_XY.join(", "), VEC_CHAMFER = "0.09";
    const pU = mk(HDR + `
      uniform sampler2D bezTex; uniform vec4 zmap; uniform vec2 res; uniform vec4 frame; uniform float time, dpr, hourAngle, tv, vec; // frame: the screen's rect in the canvas (uv); tv: 1 = living-room TV; vec: 1 = vector
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float sdBox(vec2 p, vec2 b, float r){ vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
      // the vector look's angular screen: straight edges, the corners cut off at 45 degrees (a vector cabinet's bezel)
      float sdChamfer(vec2 p){ vec2 a = abs(p); return max(max(a.x, a.y) - 1.0, (a.x + a.y - (2.0 - ${VEC_CHAMFER})) * 0.7071); }
      // web edition: the C key's third look, a ratty old living-room TV on an RF cable. Brightness stays fairly sharp,
      // colour smears sideways and drifts (composite video), a ghost trails to the right, faint diagonal interference, wonky geometry now and then,
      // a torn tracking band drifting down (no vertical-hold jumps or rolls: tried, too cheesy)
      vec3 rfTV(vec2 uv){
        float px = 2.0 / 448.0;                                           // one game pixel in the source texture
        // (calm on purpose: random block tears, colour cut-outs and per-line jitter were tried and were too spastic)
        float line = floor(uv.y * 288.0);
        uv.x += sin(uv.y * 37.0 + time * 2.3) * 0.0012;                     // a gentle wave
        // tracking: a torn band drifting down at an uneven pace, swelling and thinning as it goes
        float band = fract(time * 0.06 + 0.04 * sin(time * 0.7) + 0.03 * sin(time * 0.23 + 1.0)) * 1.3 - 0.15;
        float bw = 0.014 + 0.008 * sin(time * 1.3) * sin(time * 0.41);
        float inBand = 1.0 - smoothstep(0.0, bw, abs(uv.y - band));
        uv.x += inBand * (0.008 + 0.01 * hash(vec2(line, floor(time * 30.0))));
        // the set losing its grip now and then (dice rolls per time slot). Pulls and flags are quick and jerky (the
        // pull jolts in steps), with scratchy interference in the rows they bend:
        float jt = floor(time * 16.0);                                   // jolt steps
        //   a pull: a strip of rows bends sideways (most in its middle): yanked, jerking about, snapped back
        float slot = floor(time / 2.3), st = time - slot * 2.3;
        float k = (st - hash(vec2(slot, 6.1))) / (0.18 + 0.3 * hash(vec2(slot, 2.7)));
        float pull = step(0.5, hash(vec2(slot, 4.2))) * step(0.0, k) * step(k, 1.0) * smoothstep(0.0, 0.1, k) * (1.0 - smoothstep(0.85, 1.0, k));
        pull *= 0.35 + 0.65 * hash(vec2(jt, slot + 0.5));
        float dy = (uv.y - (0.05 + 0.9 * hash(vec2(slot, 8.3)))) / (0.015 + 0.04 * hash(vec2(slot, 1.9)));
        float pullW = pull * exp(-dy * dy * 2.5);
        uv.x += pullW * (hash(vec2(slot, 5.3)) < 0.5 ? -1.0 : 1.0) * (0.012 + 0.022 * hash(vec2(slot, 3.3)));
        //   flagging: the top rows bend sideways like a flag on a pole, flapping
        float fs = floor(time / 4.1), fk = (time - fs * 4.1 - 2.0 * hash(vec2(fs, 11.3))) / (0.35 + 0.6 * hash(vec2(fs, 12.9)));
        float flag = step(0.45, hash(vec2(fs, 13.7))) * step(0.0, fk) * step(fk, 1.0) * smoothstep(0.0, 0.1, fk) * (1.0 - smoothstep(0.85, 1.0, fk));
        flag *= 0.5 + 0.5 * hash(vec2(jt, fs + 0.25));
        float top = smoothstep(0.88, 1.0, uv.y);                         // uv.y = 1 is the top of the picture
        float flagW = flag * top * top;
        uv.x += flagW * (0.03 + 0.018 * sin(time * 15.0 + uv.y * 40.0)) * (hash(vec2(fs, 14.1)) < 0.5 ? -1.0 : 1.0);
        float scratch = clamp(pullW * 1.5 + flagW * 1.5, 0.0, 1.0);    // where the picture is being yanked about
        //   a lean: the whole picture tilts a touch and drifts back
        float ls = floor(time / 3.7), lt = time - ls * 3.7;
        float lean = step(0.6, hash(vec2(ls, 21.1))) * smoothstep(0.0, 0.3, lt) * (1.0 - smoothstep(1.0, 1.6, lt));
        uv.x += lean * (hash(vec2(ls, 22.2)) - 0.5) * 0.024 * (uv.y - 0.5);
        //   and the width breathes, very slightly (a tired power supply)
        uv.x = 0.5 + (uv.x - 0.5) * (1.0 + 0.004 * sin(time * 0.8) * sin(time * 0.31));
        vec3 soft = vec3(0.0), chroma = vec3(0.0); float ws = 0.0, wc = 0.0;
        for (int i = -2; i <= 2; i++) { float f = float(i), w = exp(-f * f / 2.5); soft += texture2D(tex, uv + vec2(f * px * 0.5, 0.0)).rgb * w; ws += w; }
        for (int i = -2; i <= 6; i++) { float f = float(i), w = exp(-(f - 1.5) * (f - 1.5) / 7.0); chroma += texture2D(tex, uv - vec2(f * px * 0.6, 0.0)).rgb * w; wc += w; }
        soft /= ws; chroma /= wc;
        float Y = dot(soft, vec3(0.299, 0.587, 0.114));
        vec2 iq = vec2(dot(chroma, vec3(0.596, -0.274, -0.322)), dot(chroma, vec3(0.211, -0.523, 0.312)));
        float hue = 0.22 * sin(time * 0.37);                              // the colour drifts, slowly
        iq = mat2(cos(hue), -sin(hue), sin(hue), cos(hue)) * iq * 1.7;
        vec3 c = vec3(Y + 0.956 * iq.x + 0.621 * iq.y, Y - 0.272 * iq.x - 0.647 * iq.y, Y - 1.106 * iq.x + 1.703 * iq.y);
        c += texture2D(tex, uv - vec2(px * 3.0, 0.0)).rgb * 0.2 + texture2D(tex, uv - vec2(px * 7.0, 0.0)).rgb * 0.07; // RF ghosts
        vec2 sp = floor(gl_FragCoord.xy / max(dpr, 1.0));
        c += 0.025 * sin(sp.x * 0.35 + sp.y * 0.9 - time * 6.0);          // faint diagonal interference, crawling
        // scratchy interference in the yanked rows: streaky noise along the lines and the odd bright scratch line
        float ft = floor(time * 30.0);
        c += scratch * ((hash(vec2(floor(sp.x / 3.0), line + ft * 7.0)) - 0.5) * 0.35 + step(0.9, hash(vec2(line, ft))) * 0.22);
        c *= 0.68;   // a touch dimmer than the arcade CRT, so colours don't blow out (no snow: tried, removed)
        return max(c, 0.0);
      }
      vec3 samp(vec2 uv, vec2 off){
        float dx = 1.0 / 448.0;
        vec3 a = texture2D(tex, uv + off + vec2(-dx, 0.0)).rgb;
        vec3 b = texture2D(tex, uv + off).rgb;
        vec3 c = texture2D(tex, uv + off + vec2(dx, 0.0)).rgb;
        return a * 0.1 + b * 0.8 + c * 0.1;
      }
      void main(){
        vec2 fuv = (vuv - frame.xy) / frame.zw;          // screen-relative uv (the bezel may fill the whole window)
        vec2 q = fuv * 2.0 - 1.0;
        q *= ${CRT_ZOOM.toFixed(3)}; // > 1: the glass is smaller than the canvas, leaving a bezel round it
        q += (q.yx * q.yx) * q * (vec > 0.5 ? vec2(${VEC_BEND}) : vec2(0.04, 0.055)); // vector: nearly flat glass
        float d = vec > 0.5 ? sdChamfer(q) : sdBox(q, vec2(1.0), 0.06);
        float inside = 1.0 - smoothstep(-0.004, 0.012, d);
        vec2 uv = (q + 1.0) * 0.5;
        vec3 c = vec3(0.0);
        if (inside > 0.0) { // the tube's effects only where the glass shows
          float ty = 1.0 - uv.y;
          float tick = floor(time * 7.0);
          // RGB convergence error grows toward the edges
          float rim = smoothstep(-0.25, 0.0, d);          // 0 in the middle, 1 at the glass edge
          vec2 ca = q * (0.003 + 0.002 * rim);
          if (tv > 0.5) c = rfTV(uv);
          else if (vec > 0.5) { c.r = texture2D(tex, uv + ca * 0.6).r; c.g = texture2D(tex, uv).g; c.b = texture2D(tex, uv - ca * 0.6).b; }
          else { c.r = samp(uv, ca).r; c.g = samp(uv, vec2(0.0)).g; c.b = samp(uv, -ca).b; }
          if (vec < 0.5) { // a vector monitor has no scanlines and no grille: the beam draws the lines themselves
          // scanlines: bright beams widen and fill the gap, dim ones leave dark lines
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          float v = fract(uv.y * 288.0);
          float w = mix(0.22, 0.62, clamp(lum * 1.2, 0.0, 1.0));
          float prof = exp(-pow((v - 0.5) / w, 2.0) * 1.7);
          c *= tv > 0.5 ? 0.5 + 0.62 * prof : 0.12 + 1.05 * prof;   // the TV's lines are gentler
          // aperture grille triads (in css px)
          float px = floor(gl_FragCoord.x / max(dpr, 1.0));
          float t3 = mod(px, 3.0);
          vec3 m = vec3(step(abs(t3 - 0.0), 0.5), step(abs(t3 - 1.0), 0.5), step(abs(t3 - 2.0), 0.5));
          c *= tv > 0.5 ? 0.86 + 0.2 * m : 0.62 + 0.62 * m;
          }
          // vignette + brightness
          float vg = 1.0 - 0.55 * pow(length(q * vec2(0.82, 0.74)), 2.6);
          c *= clamp(vg, 0.0, 1.0) * (vec > 0.5 ? 1.15 : 1.4);
          c = pow(max(c, 0.0), vec3(0.88, 0.88, 0.8));   // lift shadows, blues most
          // mains flicker, rolling hum bar
          c *= 1.0 - (vec > 0.5 ? 0.07 : 0.05) * hash(vec2(floor(time * 60.0), 1.0)); // a vector's refresh flickers a bit more
          if (vec < 0.5) c *= 1.0 + 0.1 * pow(0.5 + 0.5 * sin(6.2832 * (ty * 1.0 - time * 0.09)), 10.0);
          // static grain + sparse bright speckles
          float n = hash(gl_FragCoord.xy + fract(time) * 91.7);
          c += (n - 0.5) * (vec > 0.5 ? 0.02 : 0.075);
          // glass: glare at the top-right (web edition: moved off the 1UP score), faint dust streak, darkening near the rim
          float gl1 = exp(-pow(length((fuv - vec2(0.8, 0.84)) * vec2(1.0, 1.25)) / 0.30, 2.0));
          float gl2 = exp(-pow(((1.0 - fuv.x) * 0.9 + fuv.y * 0.55 - 0.78) / 0.05, 2.0)) * 0.5;
          c += vec3(0.85, 0.9, 1.0) * (0.06 * gl1 + 0.018 * gl2);
          c *= 0.62 + 0.38 * smoothstep(-0.16, 0.0, -d);
          // glassy: a thick curved faceplate in front of the tube
          //   broad sheen from a room light, brightest up top and fading down the bulge
          float sheen = smoothstep(-0.1, 1.0, q.y * 0.85 + q.x * 0.35 + 0.15 * (1.0 - dot(q, q)));
          c += vec3(0.78, 0.84, 1.0) * 0.045 * sheen * sheen;
          //   a soft window-shaped reflection with a crisp lower edge, upper right
          const vec2 WIN = vec2(0.73, 0.8);
          vec2 wq = (fuv - WIN) * vec2(1.0, 1.6);
          float win = (1.0 - smoothstep(0.17, 0.2, length(wq))) * smoothstep(-0.12, 0.1, wq.y);
          c += vec3(0.8, 0.86, 1.0) * 0.035 * win;
          //   small, soft specular point. Secretly a clock: the window reflection is the face and the glint the hour
          //   hand's tip (player's local time): top of the window at 12, right at 3, bottom at 6, left at 9
          vec2 glint = WIN + vec2(sin(hourAngle) * 0.11, cos(hourAngle) * 0.068);
          float spec = exp(-pow(length((fuv - glint) * vec2(1.0, 1.35)) / 0.045, 2.0));
          c += vec3(0.9, 0.94, 1.0) * 0.09 * spec;
        }
        // plastic bezel outside the glass: static, baked once per resize (pZ below)
        vec3 bez = texture2D(bezTex, vuv * zmap.xy + zmap.zw).rgb;   // Z may cover the whole window, not just this canvas
        // glossy bezel: a soft, fading mirror image of the screen's edge, folded back across the rim
        if (d > 0.0) {
          vec2 e = max(abs(q) - vec2(0.94), 0.0);
          vec2 nrm = sign(q) * (length(e) > 0.0 ? normalize(e) : vec2(0.0));
          vec2 ruv = (q - nrm * (2.0 * d + 0.01) + 1.0) * 0.5;
          float side = abs(nrm.x);                              // 1 on the left/right rims, 0 top/bottom
          vec2 tg = vec2(-nrm.y, nrm.x) * (0.004 + 0.06 * d) * (2.2 - 1.2 * side); // blur along the rim; more top/bottom
          vec2 nb = nrm * (0.003 + 0.04 * d);
          vec3 r = texture2D(tex, ruv).rgb * 0.28
                 + (texture2D(tex, ruv + tg).rgb + texture2D(tex, ruv - tg).rgb) * 0.2
                 + (texture2D(tex, ruv + tg * 2.0).rgb + texture2D(tex, ruv - tg * 2.0).rgb) * 0.1
                 + texture2D(tex, ruv - nb).rgb * 0.12;
          // a dark gap at the rim, then a fade; top/bottom much fainter (text rows sit right against the glass there)
          float fall = exp(-d / 0.035) * smoothstep(0.008, 0.02, d);
          bez += r * vec3(0.95, 0.92, 0.88) * 0.42 * fall * (0.3 + 0.7 * side);
        }
        gl_FragColor = vec4(mix(bez, c, inside), 1.0);
      }`);

    // the bezel's static look (base colour, grain, rim highlight), drawn once per resize into Z; pU reads it back
    const pZ = mk(HDR + `
      uniform vec4 frame; uniform float dpr, tv, vec;
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float sdBox(vec2 p, vec2 b, float r){ vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
      // the vector look's angular screen: straight edges, the corners cut off at 45 degrees (a vector cabinet's bezel)
      float sdChamfer(vec2 p){ vec2 a = abs(p); return max(max(a.x, a.y) - 1.0, (a.x + a.y - (2.0 - ${VEC_CHAMFER})) * 0.7071); }
      void main(){
        vec2 fuv = (vuv - frame.xy) / frame.zw;
        vec2 q = fuv * 2.0 - 1.0;
        q *= ${CRT_ZOOM.toFixed(3)};
        q += (q.yx * q.yx) * q * (vec > 0.5 ? vec2(${VEC_BEND}) : vec2(0.04, 0.055)); // vector: nearly flat glass
        float d = vec > 0.5 ? sdChamfer(q) : sdBox(q, vec2(1.0), 0.06);
        // the CRT's dark plastic; the ratty TV's (C key) is the same, just dark brown
        vec3 col = tv > 0.5 ? vec3(0.2, 0.12, 0.065) : vec > 0.5 ? vec3(0.045, 0.045, 0.05) : vec3(0.11, 0.1, 0.086); // TV: 1982 wood-panelling brown; vector: a black cabinet
        float grain = vec > 0.5 ? 1.0 : 0.8 + 0.2 * hash(floor(gl_FragCoord.xy / 2.0)); // vector: smooth, solid plastic
        vec3 bez = col * (0.55 + 0.6 * clamp(fuv.y, -0.15, 1.15)) * grain;
        bez += vec3(0.05) * smoothstep(0.0, 0.05, d) * (1.0 - smoothstep(0.05, 0.1, d));
        gl_FragColor = vec4(bez, 1.0);
      }`);

    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const newTex = (filter) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); return t; };
    const srcTex = newTex(gl.LINEAR), maskTex = newTex(gl.NEAREST);
    const mkTarget = (w, h) => { const t = newTex(gl.LINEAR); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return { t, f, w, h }; };
    let zmap = [1, 1, 0, 0], A = null, Z = null, B1 = null, B2 = null, PH = null, ph = 0, VH = null, cw = 0, ch = 0, cssH = 864, dpr = 1, fr = [0, 0, 1, 1];
    let BW = 448, BH = 576, vh = 0, lastPresent = 0; // bloom buffers: 448x576 over the screen, more when the canvas is wider than it
    const pass = (prog, target, setup, ...texs) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.f : null);
      gl.viewport(0, 0, target ? target.w : cw, target ? target.h : ch);
      gl.useProgram(prog);
      texs.forEach((t, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); });
      gl.uniform1i(prog.u("tex"), 0);
      if (texs.length > 1) { gl.uniform1i(prog.u("glow"), 1); gl.uniform1i(prog.u("prev"), 1); gl.uniform1i(prog.u("bezTex"), 1); }
      if (setup) setup(prog);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const api = {
      webgl: true, ultra: true, zoom: CRT_ZOOM, vecBend: VEC_BEND_XY,
      // frame: where the game screen sits in the canvas, as uv fractions {x, y (from the bottom), w, h}; default the whole canvas.
      // win (CRT on): the window in device px {w, h} and this canvas's top-left in it {x, y}. The bezel is baked once over the
      // whole window, and the part outside this canvas comes back as ImageData for a static background (never redrawn per frame)
      resize(w, h, cssHeight, frame, win) {
        canvas.width = w; canvas.height = h; cw = w; ch = h; cssH = cssHeight || h; dpr = h / cssH;
        fr = frame ? [frame.x, frame.y, frame.w, frame.h] : [0, 0, 1, 1];
        BW = Math.min(2048, Math.round(448 / fr[2])); BH = Math.min(2048, Math.round(576 / fr[3]));
        const max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        if (win && (win.w > max || win.h > max)) win = null;
        const W = win ? win.w : w, H = win ? win.h : h, ox = win ? win.x : 0, oy = win ? win.h - win.y - h : 0; // oy: from the bottom
        [A, Z, B1, B2, ...(PH || []), ...(VH || [])].forEach((T) => { if (T) { gl.deleteTexture(T.t); gl.deleteFramebuffer(T.f); } });
        A = mkTarget(w, h); Z = mkTarget(W, H); B1 = mkTarget(BW, BH); B2 = mkTarget(BW, BH); PH = [mkTarget(448, 576), mkTarget(448, 576)];
        VH = [mkTarget(GW * 3, GH * 3), mkTarget(GW * 3, GH * 3)];
        zmap = [w / W, h / H, ox / W, oy / H];
        pass(pZ, Z, (p) => { gl.uniform4f(p.u("frame"), (fr[0] * w + ox) / W, (fr[1] * h + oy) / H, fr[2] * w / W, fr[3] * h / H); gl.uniform1f(p.u("dpr"), dpr);
          gl.uniform1f(p.u("tv"), getConfig().crtEffect === "tv" ? 1 : 0); gl.uniform1f(p.u("vec"), getConfig().crtEffect === "vector" ? 1 : 0); });
        let bg = null;
        if (win) {
          const G = mkTarget(W, H);
          pass(pG, G, (p) => gl.uniform3f(p.u("factors"), ...ULTRA_FACTORS), Z.t);
          const px = new Uint8ClampedArray(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
          bg = new ImageData(px, W, H);
          gl.deleteTexture(G.t); gl.deleteFramebuffer(G.f);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return bg;
      },
      present() {
        if (!A) return;
        const crtOn = !!getConfig().crtEffect, vec = getConfig().crtEffect === "vector";
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
        const f = (!crtOn || !api.ultra || vec) ? gl.LINEAR : gl.NEAREST; // plain: LINEAR for pP's sharp bilinear; vector: for the film
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        if (!crtOn) { pass(pP, null, (p) => { gl.uniform2f(p.u("srcSize"), source.width, source.height); gl.uniform2f(p.u("outSize"), cw, ch); gl.uniform1f(p.u("soft"), smoothNow() ? 1 : 0); }, srcTex); return; }
        const time = performance.now() / 1000;
        const dt = Math.min(0.1, Math.max(0, time - (lastPresent || time))); lastPresent = time;
        if (api.ultra) {
          let pic;
          if (vec) { // the beam's afterglow fades by time, not by frame (same trails at 60 or 144 Hz)
            const nxt = 1 - vh, film = smoothNow();
            if (textMask) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textMask); }
            pass(pV, VH[nxt], (p) => { gl.uniform1i(p.u("mask"), 2); gl.uniform2f(p.u("srcSize"), source.width, source.height); gl.uniform1f(p.u("decay"), film ? 0 : Math.pow(0.55, dt * 60)); gl.uniform1f(p.u("film"), film ? 1 : 0); }, srcTex, VH[vh].t, maskTex);
            vh = nxt; pic = VH[vh].t;
          } else {
            const nxt = 1 - ph;
            pass(pH, PH[nxt], (p) => gl.uniform1f(p.u("decay"), 0.58), srcTex, PH[ph].t);
            ph = nxt; pic = PH[ph].t;
          }
          pass(pU, A, (p) => { gl.uniform2f(p.u("res"), cw, ch); gl.uniform4f(p.u("frame"), fr[0], fr[1], fr[2], fr[3]); gl.uniform4f(p.u("zmap"), ...zmap); gl.uniform1f(p.u("tv"), getConfig().crtEffect === "tv" ? 1 : 0); gl.uniform1f(p.u("vec"), vec ? 1 : 0); gl.uniform1f(p.u("time"), time); gl.uniform1f(p.u("dpr"), dpr); gl.uniform1f(p.u("hourAngle"), hourAngle()); }, pic, Z.t);
          pass(pT, B1, (p) => gl.uniform1f(p.u("minLuma"), vec ? 0.3 : 0.72), A.t);
          pass(pB, B2, (p) => { gl.uniform2f(p.u("dir"), 1 / BW, 0); gl.uniform1f(p.u("sigma"), 3.5); }, B1.t);
          pass(pB, B1, (p) => { gl.uniform2f(p.u("dir"), 0, 1 / BH); gl.uniform1f(p.u("sigma"), 3.5); }, B2.t);
          pass(pF, null, (p) => { gl.uniform3f(p.u("factors"), ...ULTRA_FACTORS); gl.uniform1f(p.u("glowK"), vec ? 0.4 : 0.55); }, A.t, B1.t);
        } else {
          pass(pA, A, (p) => { gl.uniform2f(p.u("distortion"), 1.03, 1.04); gl.uniform1f(p.u("feather"), 0.02);
            gl.uniform1f(p.u("widthPx"), 2); gl.uniform1f(p.u("thickness"), 0.5); gl.uniform1f(p.u("opacity"), 0.4); gl.uniform1f(p.u("screenH"), cssH); }, srcTex);
          pass(pT, B1, (p) => gl.uniform1f(p.u("minLuma"), 0.85), A.t);
          pass(pB, B2, (p) => { gl.uniform2f(p.u("dir"), 1 / BW, 0); gl.uniform1f(p.u("sigma"), 3); }, B1.t);
          pass(pB, B1, (p) => { gl.uniform2f(p.u("dir"), 0, 1 / BH); gl.uniform1f(p.u("sigma"), 3); }, B2.t);
          pass(pF, null, (p) => { gl.uniform3f(p.u("factors"), 1.25, 1.25, 1.5); gl.uniform1f(p.u("glowK"), 1.0); }, A.t, B1.t);
        }
      },
    };
    return api;
  }

  root.BoozeRender = { createRenderer, createPresenter, GW, GH };
})(typeof self !== "undefined" ? self : this);
