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
    let masking = false, maskShift = 0; // maskShift: px the picture is moved by (ctx.translate) where text is drawn
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
    const setHollow = () => { if (g.config.crtEffect === "vector") { col = [0.6, 0.6, 0.6, 1]; hollow = false; } else { col = [1, 1, 1, 1]; hollow = true; } };
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
      if (hollow) { src = hollowFrame(s, sx, sy); ssx = 0; ssy = 0; }
      if (tinted) { // a tint multiplies whatever is drawn, hollow included (Jetpack's red over a spent Pac-Man)
        tctx.clearRect(0, 0, 16, 16);
        tctx.globalCompositeOperation = "source-over";
        tctx.drawImage(src, ssx, ssy, s.fw, s.fh, 0, 0, s.fw, s.fh);
        tctx.globalCompositeOperation = "multiply";
        tctx.fillStyle = `rgb(${Math.round(col[0] * 255)},${Math.round(col[1] * 255)},${Math.round(col[2] * 255)})`;
        tctx.fillRect(0, 0, s.fw, s.fh);
        tctx.globalCompositeOperation = "destination-in";
        tctx.drawImage(src, ssx, ssy, s.fw, s.fh, 0, 0, s.fw, s.fh);
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
        if (decoTint && maze) { const t = hueTint((decoTint.base + x * 28) % 360, decoTint.l); setColor(t[0], t[1], t[2], decoTint.a); o = 0; } // (letter by letter, white tinted)
        if (up[i] === "'") { // the font has no apostrophe ('"' isn't in every colour): the top of "!", in any colour
          const px = (maze ? camX() : 0) + x * TILE, py = (maze ? camY() : 0) + y * TILE;
          clip(px, py, TILE, 3); print("!", x, y, o, maze); unclip();
          x += 1; continue;
        }
        const idx = TEXT_CHARS.indexOf(up[i]) + 1;
        if (idx > 0) drawSprite("text8", o * 64 + idx, x * TILE, y * TILE, maze);
        if (idx > 0 && masking && up[i] !== " " && !LOGO_PIECES.includes(up[i])) {
          const s = sheets.text8, j = o * 64 + idx - 1;
          mctx.globalAlpha = col[3];
          mctx.drawImage(s.img, (j % s.cols) * 8, Math.floor(j / s.cols) * 8, 8, 8, (maze ? camX() : 0) + x * TILE, (maze ? camY() : 0) + y * TILE + maskShift, 8, 8);
          mctx.globalAlpha = 1;
        }
        x += 1;
      }
    }

    // ---- DARKSTAR (the author's secret rave, 2026-11-17; src/rave.js has the music and the beat clock). Pictures only:
    // the game underneath is untouched. Kept under 3 flashes a second (photosensitivity), and never over Mina's film
    let rave = null;
    // darkstar: the fruit dances too, on the offbeat (the author, 2026-11-17); one hop for every place it's drawn (Lantern's
    // faded copy in the dark stood still at first)
    // the beat the pictures follow: the music's, held still while the game is paused (the dancing, lights, lasers, bokeh
    // and all stop with it; the author, 2026-11-19), back in time with the music when play goes on
    let heldBeat = null;
    const beat = () => (g.paused && heldBeat !== null ? heldBeat : (heldBeat = rave.beat()));
    const fruitHop = () => (raveOn() ? -Math.round(2.5 * Math.exp(-((beat() + 0.5) % 1) * 4)) : 0);
    const BOKEH = Array.from({ length: 40 }, (_, i) => ({ // (fixed, so the same circles every time: hashed from i; 22 at first, "add more")
      x: (i * 89) % GW, y: (i * 137) % GH, r: 4 + ((i * 53) % 36), h: (i * 47) % 360, a: 0.1 + ((i * 31) % 10) / 70, /* (0.07-0.16 at first; boosted, the author) */
      ax: 20 + ((i * 17) % 40), ay: 20 + ((i * 29) % 40), fx: 0.5 + ((i * 7) % 10) / 10, fy: 0.4 + ((i * 11) % 10) / 10, p: i * 1.7 }));
    // (off for every intermission, not just Mina's film: the author, 2026-11-17)
    const raveOn = () => !!(rave && rave.on()) && g.scene.name !== "mina" && !/intermission/i.test(g.mode || "");
    const raveBeat = () => { const b = beat(), ph = b % 1; return { b, ph, kick: Math.exp(-ph * 5), bar: Math.floor(b / 4) }; };
    const HUES = [300, 190, 55, 130, 20, 260];                         // magenta, cyan, yellow, green, orange, violet
    // a colour on the rainbow (h degrees) as a tint (0-1 rgb), for the dots, energizers and letters that pulse
    function hueTint(h, l) {
      const a = Math.min(l, 1 - l), f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
      return [f(0), f(8), f(4)];
    }
    let decoTint = null; // set while the maze's lettering is drawn: print tints each letter (BO OZE ELR OY pulsing)
    function drawChar(o, x, y, phased, maze) {
      const a = o.animator();
      if (!a || !a.frames) return;
      o.frame = o.frame || 1;
      let frameIndex = a.frames[o.frame - 1];
      if (frameIndex === undefined) { o.frame = 1; frameIndex = a.frames[0]; }
      const s = sheets[a.spr];
      if (frameIndex === undefined || !s || frameIndex > s.count) return;
      const inGame = g.scene.name === "game";
      if (o.target && T(o.stunned)) setColor(Math.random(), Math.random(), Math.random());
      else if (o.target && !T(o.frightened) && !T(o.dead) && inGame && T(g.config.radar) && T(g.radarTimer)) {
        let alpha = 0;
        if (g.radarTimer > g.config.radar) alpha = g.radarTimer - g.config.radar;
        setColor(1, 1, 1, alpha / 60);
      }
      if (T(phased)) {
        const ab = core.curAbility();
        if (ab === 1) {
          if (phased >= 0) setColor(Math.random(), Math.random(), Math.random()); else setHollow();
        } else if (ab === 2) {
          if (phased < 0) setHollow(); // web edition: plain yellow while boosting (the Lua tinted him green)
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
      // web edition: the Vacuum's charge, the same way: solid until it's used, hollow until the next READY
      if (inGame && o === g.chars.pac && core.curAbility() === core.VACUUM && g.vacuumSpent) setHollow();
      if (inGame && o === g.chars.pac && core.curAbility() === core.PUSH && g.pushSpent) setHollow();
      if (inGame && o === g.chars.pac && core.curAbility() === core.PAUSE && g.pauseSpent && !(g.freezeLeft > 0)) setHollow();
      // web edition: the Rewind ability's charge shows the abilities' way: solid when ready, hollow once used
      if (inGame && o === g.chars.pac && core.curAbility() === core.REWIND && g.rewindSpent && !g.rewinding) setHollow(); // full while it plays back; spent once it's done
      // Jetpack too fast to hit a wall: red, laid over whatever else he is (hollow / spent included, so the warning
      // shows before the ability comes back; the author, 2026-11-15: hollow used to wipe it out)
      if (inGame && o === g.chars.pac && g.config.movement === 3 && g.chars.pac.speed > core.constants.MAX_THRUST) {
        col = [col[0], col[1] * 0.3, col[2] * 0.3, col[3]];
      }
      let angle = 0;
      if (T(o.stunned)) angle = (o.stunned * 6 * (o.spinDirection > 0.5 ? 1 : -1)) * Math.PI / 180;
      let hop = 0;
      const rv = raveOn() && (o.target || (g.chars && o === g.chars.pac) || o === g.attractPac) && !o.dead;
      if (rv) { // everybody dances: the ghosts hop to the beat, every other one on the offbeat, Pac-Man with the first lot
        const idx = o.target ? Math.max(0, ["blinky", "pinky", "inky", "clyde", "punky", "gunky", "gronky"].findIndex((n) => (g.chars && g.chars[n] === o) || (g.ghosts && g.ghosts[n] === o))) : 0;
        const ph = (beat() + (idx % 2) * 0.5) % 1; hop = -Math.round(2.5 * Math.exp(-ph * 4));
      }
      // the Pause ability's freeze: every ghost (eyes and the ones in the pen too) shakes like crazy, straining to move, but
      // never more than a pixel from where it really is: a new offset every frame (the author, 2026-11-18; drawing only)
      let sx = 0, sy = 0;
      if (inGame && o.target && g.freezeLeft > 0) {
        let sh = shakes.get(o);
        // (half a pixel each way at most: the screen has no half pixels, so the ghost is drawn smoothed half a pixel over and
        // its edges blend: a fine buzz, not a jump; the author wanted it tighter than a whole pixel)
        if (!sh || drawCount - sh.at >= SHAKE_EVERY) { sh = { at: drawCount, x: (Math.floor(Math.random() * 3) - 1) * SHAKE_PX, y: (Math.floor(Math.random() * 3) - 1) * SHAKE_PX }; shakes.set(o, sh); }
        sx = sh.x; sy = sh.y;
      }
      if (sx % 1 || sy % 1) ctx.imageSmoothingEnabled = true;
      blit(s, frameIndex - 1, (maze ? camX() : 0) + x + sx, (maze ? camY() : 0) + y + (maze ? 24 : 0) + hop + sy, angle, 8, 8);
      ctx.imageSmoothingEnabled = false;
      if (inGame) setColor(1, 1, 1);
    }

    function drawScenery(o, x, y, fade) {
      const a = o.animator();
      o.frame = o.frame || 1;
      const fadeA = fade ? g.fadeTimer / g.fadeLength() : 1;
      if (fade) setColor(1, 1, 1, fadeA);
      const rv = raveOn();
      if (rv) { // darkstar: the dots change colour in waves rolling across the maze; the energizers pulse with the beat
        // (fading ones, Haunted / Blackout, keep their colour as they fade: the author, 2026-11-17)
        const rb = raveBeat(), big = g.powers && g.powers.includes(o);
        const t = big ? hueTint((rb.bar * 60 + rb.b * 40) % 360, 0.55 + 0.25 * rb.kick) : hueTint((((x + y) * 18 - rb.b * 90) % 360 + 360) % 360, 0.62);
        setColor(t[0], t[1], t[2], fadeA);
      }
      // (and the energizers dance, on the offbeat like the fruit: the author, 2026-11-17)
      const hop = rv && g.powers && g.powers.includes(o) ? fruitHop() : 0;
      drawSprite(a.spr, a.frames[o.frame - 1], x * TILE, (y + 3) * TILE + hop, true);
      if (fade || rv) setColor(1, 1, 1);
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

    // web edition: maze style "27" (config 100; the author, 2026-11-15): the standard walls (style 1) as a living rainbow.
    // The walls are drawn into their own canvas, painted over (source-atop keeps their shapes), then laid on the picture.
    // Render only
    const RAINBOW = 100;
    const rainbowCanvas = document.createElement("canvas"), rctx = rainbowCanvas.getContext("2d");
    function rainbowPaint(c2, w, h, t) {
      t *= 0.8; // everything 20% slower than first tuned (the author)
      let raveLight = 0;
      if (raveOn()) { const rb = raveBeat(); t = rb.b * 0.6; raveLight = 22 * rb.kick; } // darkstar: it flows to the beat and flashes on the kick
      c2.globalCompositeOperation = "source-atop";
      // the rainbow flowing across the maze, quicker than at first, its direction wandering (a few slow waves added up:
      // smooth, never repeating, never spinning: a swirl and a twisting spiral were tried and made the author queasy)
      const dir = 0.8 + Math.sin(t * 0.15) * 1.3 + Math.sin(t * 0.085 + 1.7) * 0.9 + Math.sin(t * 0.26 + 4.1) * 0.4;
      const len = Math.hypot(w, h) / 2, dx = Math.cos(dir) * len, dy = Math.sin(dir) * len;
      const grad = c2.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
      const shift = (t * 0.3) % 1, light = Math.min(85, 57 + Math.sin(t * 3.5) * 13 + raveLight);
      for (let i = 0; i <= 12; i++) grad.addColorStop(i / 12, "hsl(" + Math.round(((i / 12) * 2 - shift) * 360) + ",100%," + light + "%)");
      c2.fillStyle = grad; c2.fillRect(0, 0, w, h);
      c2.globalCompositeOperation = "source-over";
    }
    function drawRainbowMaze(cm, showMaze, fadeOn) {
      const INDEXES = core.INDEXES, MAXC = core.MAX_COLORS, map = cm.map, s = sheets.spr8, ad = g.config.afterDark;
      const w = cm.w * TILE, h = (map.length + 3) * TILE;
      if (rainbowCanvas.width !== w || rainbowCanvas.height !== h) { rainbowCanvas.width = w; rainbowCanvas.height = h; rctx.imageSmoothingEnabled = false; }
      rctx.clearRect(0, 0, w, h);
      for (let y = 0; y < map.length; y++) {
        const row = map[y];
        for (let x = 0; x < row.length; x++) {
          let c = row[x];
          const fadeable = ad === 5 || INDEXES.indexOf(c) === -1;
          if (showMaze || g.mode === "gameover") c = cm.upperCase(c);
          const spriteNum = INDEXES.indexOf(c) + 1;
          if (spriteNum > 0 && c !== "P") { // (the door: drawMaze, in its own pink)
            const j = (spriteNum - 1) * MAXC + 2; // style 1 (the standard walls)
            rctx.globalAlpha = fadeOn && fadeable ? Math.max(0, Math.min(1, g.fadeTimer / g.fadeLength())) : 1;
            rctx.drawImage(s.img, (j % s.cols) * 8, Math.floor(j / s.cols) * 8, 8, 8, x * TILE, (y + 3) * TILE, 8, 8);
          }
        }
      }
      rctx.globalAlpha = 1;
      rainbowPaint(rctx, w, h, performance.now() / 1000);
      ctx.globalAlpha = col[3];
      ctx.drawImage(rainbowCanvas, camX(), camY());
      ctx.globalAlpha = 1;
    }
    const swatch = document.createElement("canvas"); swatch.width = 8; swatch.height = 8;
    const sctx = swatch.getContext("2d");
    function rainbowSwatch(x, y) { // style 1's swatch, rainbowed (the Options page)
      const s = sheets.spr8, j = 2;
      sctx.clearRect(0, 0, 8, 8);
      sctx.drawImage(s.img, (j % s.cols) * 8, Math.floor(j / s.cols) * 8, 8, 8, 0, 0, 8, 8);
      rainbowPaint(sctx, 24, 24, performance.now() / 1000);
      ctx.drawImage(swatch, x, y);
    }
    function drawMaze(cm, color) {
      if (raveOn() && color !== core.maze.maxColors) color = RAINBOW; // darkstar: the living rainbow, dancing (not the board-end flash)
      const ad = g.config.afterDark;
      const showMaze = !T(ad) || ad === 2 || ad >= 4;
      const fadeOn = (ad === 4 || ad === 5) && g.mode !== "gameover"; // (Haunted / Blackout fade; Lantern, 6, doesn't)
      const rainbow = color === RAINBOW;
      if (rainbow) drawRainbowMaze(cm, showMaze, fadeOn); // (the decorations still go on top, below)
      color = rainbow ? 0 : (color || 1) - 1;
      const INDEXES = core.INDEXES, MAXC = core.MAX_COLORS, map = cm.map;
      for (let y = 0; y < map.length; y++) {
        const row = map[y];
        for (let x = 0; x < row.length; x++) {
          let c = row[x];
          const fadeable = ad === 5 || INDEXES.indexOf(c) === -1;
          if (showMaze || g.mode === "gameover") c = cm.upperCase(c);
          if (rainbow && c !== "P") continue; // the rainbow has the walls; the pen door stays its pink
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
        if (ad === 4 || ad === 5) setColor(1, 1, 1, g.fadeTimer / g.fadeLength());
        if (raveOn()) { const rb = raveBeat(); decoTint = { base: rb.b * 45, l: 0.55 + 0.25 * rb.kick, a: col[3] }; } // darkstar: the lettering pulses
        dec();
        if (decoTint) { decoTint = null; setColor(1, 1, 1); }
        if (ad === 4 || ad === 5) setColor(1, 1, 1);
      }
    }

    function clearScreen() {
      const v = g.config.crtEffect && g.config.crtEffect !== "vector" ? 13 : 0; // (vector: true black, so faint fades still count)
      ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(0, 0, GW, GH);
    }
    // the living backgrounds (web edition, 2026-11-22: "space" and "ocean", src/living.js): canvases painted afresh each
    // frame on their own clock, which stands still while the game is paused; made the first time they're shown
    const living = {}, clock = { t: 0, last: 0 };
    function livingBackground(name) {
      if (typeof BoozeLiving === "undefined" || !BoozeLiving.NAMES.includes(name)) return null;
      const L = living[name] || (living[name] = Object.assign(BoozeLiving.create(name), { at: 0, t0: null }));
      L.canvas.living = true; // (the vector presenter re-uploads it every frame)
      const now = performance.now();
      if (L.at !== now) { // (once a frame, however many times it's drawn)
        if (clock.last !== now) { clock.t += g.paused || !clock.last ? 0 : Math.min(0.1, (now - clock.last) / 1000); clock.last = now; }
        L.paint(clock.t, L.t0 === null ? 0 : Math.min(0.1, clock.t - L.t0)); L.t0 = clock.t; L.at = now;
      }
      return L.canvas;
    }
    const backgroundOf = (name) => assets.backgrounds[name] || livingBackground(name);
    function drawBackground() {
      if (!g.currentBackground) g.currentBackground = g.config.background;
      const bg = backgroundOf(g.currentBackground);
      // (not in the picture in the vector look, where the beam would trace it and it would hide dim lines like maze style
      // 9's dark grey; there it's handed to the presenter instead as a backdrop behind the glass: R.backdrop)
      if (bg && g.config.crtEffect === "vector") backdrop = bg;
      else if (bg) ctx.drawImage(bg, 0, 0, GW, GH);   // baked at 25% (tools/prep_assets.py), the pictures brightened at load (main.js brighter)
      if (raveOn()) { // darkstar: a wash of colour from the middle on every beat
        const rb = raveBeat(), hue = HUES[rb.bar % HUES.length];
        const w = ctx.createRadialGradient(GW / 2, GH / 2, 10, GW / 2, GH / 2, 200);
        w.addColorStop(0, `hsla(${hue},100%,50%,${0.08 + 0.22 * rb.kick})`); w.addColorStop(1, "hsla(0,0%,0%,0)");
        ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = w; ctx.fillRect(0, 0, GW, GH);
        // bokeh: soft coloured circles of all sizes floating about behind the maze, each on its own slow, wandering path,
        // swelling a little on the beat (the author, 2026-11-17: they replaced specks drifting left to right)
        for (const o of BOKEH) {
          const t = rb.b * 0.12, x = o.x + Math.sin(t * o.fx + o.p) * o.ax, y = o.y + Math.cos(t * o.fy + o.p * 1.3) * o.ay;
          const r = o.r * (1 + 0.12 * rb.kick), hue = (o.h + rb.b * 4) % 360;
          const gr = ctx.createRadialGradient(x, y, r * 0.55, x, y, r);
          gr.addColorStop(0, `hsla(${hue},90%,60%,${o.a})`); gr.addColorStop(1, `hsla(${hue},90%,60%,0)`);
          ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
      }
    }

    // Elroy's drunk bubbles (web edition). The core still emits its particles exactly as the Lua does (same RNG use);
    // here some of them become pixel-art cartoon bubbles with their own (render-only) life: they wobble upward, woozy,
    // swell a little and pop.
    // (fire versions too, two of them that flicker: once Blinky is in his second Elroy, drunk with rage, the bubbles he
    // blows come out on fire: the author, 2026-11-19)
    const BUBBLE_SPRITES = [], FIRE_SPRITES = [[], []];
    const BLUE = { shine: "#dcdcff", top: "#a8a8ff", under: "#6a6aee", mid: "rgba(128,128,255,0.35)" };
    const FIRE = [{ shine: "#fff4b0", top: "#ffb020", under: "#e2340e", mid: "rgba(255,120,30,0.42)" },
      { shine: "#ffffff", top: "#ffd448", under: "#ff5a12", mid: "rgba(255,176,40,0.42)" }];
    function bubbleSprite(R, pal) {
      const S = 2 * R + 3, c = document.createElement("canvas"); c.width = S; c.height = S;
      const x = c.getContext("2d"), m = S / 2, hx = m - R * 0.45, hy = m - R * 0.45, hr = Math.max(0.7, R * 0.28);
      for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
        const d = Math.hypot(i + 0.5 - m, j + 0.5 - m);
        if (Math.hypot(i + 0.5 - hx, j + 0.5 - hy) < hr && d < R) x.fillStyle = pal.shine; // shine
        else if (Math.abs(d - R) < 0.62) x.fillStyle = j + 0.5 > m + R * 0.3 ? pal.under : pal.top; // rim, darker underneath
        else if (d < R - 0.62) x.fillStyle = pal.mid; // see-through middle (blue: the original's colour)
        else continue;
        x.fillRect(i, j, 1, 1);
      }
      return c;
    }
    for (let R = 1; R <= 5; R++) { BUBBLE_SPRITES[R] = bubbleSprite(R, BLUE); FIRE_SPRITES[0][R] = bubbleSprite(R, FIRE[0]); FIRE_SPRITES[1][R] = bubbleSprite(R, FIRE[1]); }
    const seenBubbles = new WeakSet(), bubbles = [];
    let bubbleCount = 0, bubbleT = 0, bubbleSource = null;
    function updateBubbles() {
      const now = performance.now(), dt = g.paused ? 0 : bubbleT ? Math.min(3, (now - bubbleT) / 16.67) : 1; bubbleT = now; // (held while paused)
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
    // Blinky in his second Elroy, the fastest (the dots left at or under the level's elroy2; not while it's suspended)
    // (in play only: his intermission bubbles stay the original blue, the author)
    const elroy2 = () => !!(g.scene.name === "game" && !String(g.mode).startsWith("intermission") && g.chars && g.chars.blinky && g.level && g.dots && g.dots.length <= g.level.elroy2 && !g.suspendElroy);
    function drawBubble(b) {
      const cx = -g.startX + b.x, cy = -g.startY + b.y + 24;
      if (b.age > b.life) { // pop: a little ring of specks flying out
        const t = (b.age - b.life) / 4, rr = b.r + 1 + t * 2;
        ctx.globalAlpha = (1 - t) * 0.7; ctx.fillStyle = b.fire ? "#ffb040" : "#b0b0ff";
        for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + b.phase; ctx.fillRect(Math.round(cx + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr), 1, 1); }
        ctx.globalAlpha = 1;
        return;
      }
      const R = Math.max(1, Math.min(3, Math.round(b.r))), spr = b.fire ? FIRE_SPRITES[Math.floor(b.age / 3 + b.phase) % 2][R] : BUBBLE_SPRITES[R];
      // fade in fast, dissolve over the second half of its life
      ctx.globalAlpha = Math.min(1, b.age / 2) * Math.min(1, 2 * (1 - b.age / b.life)) * 0.9;
      ctx.drawImage(spr, Math.round(cx - spr.width / 2), Math.round(cy - spr.height / 2));
      ctx.globalAlpha = 1;
    }
    // web edition (the author, 2026-11-15): a bit of the Jetpack's thruster while Boost is on, render only (Math.random,
    // its own list), so the core's particles and RNG are untouched: the same burst as the Jetpack's (core.js handlePlayerInput), frame for frame
    const flames = [];
    let flameT = 0;
    function updateFlames() {
      const now = performance.now(), dt = flameT ? Math.min(3, (now - flameT) / 16.67) : 1; flameT = now;
      const pac = g.chars && g.chars.pac;
      const live = g.scene.name === "game" && g.mode === "normal" && !g.paused && !g.rewinding;
      // out of his back, the way he's thrusting (facing), not the way he's moving: braking in Jetpack fires forwards
      const aim = pac && (pac.facing >= 0 && pac.facing <= 3 ? pac.facing : pac.dir);
      if (live && pac && core.curAbility() === 2 && pac.phased > 0 && aim >= 0 && aim <= 3) {
        const v = [[1, 0], [0, 1], [-1, 0], [0, -1]][aim], bx = -v[0], by = -v[1];
        const px = pac.x + bx * 4, py = pac.y + by * 4;
        const ri = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1)); // Lua's math.random(lo, hi)
        const ox = px + ri(-1, 1), oy = py + ri(-1, 1);
        for (let i = 0; i < 15; i++) { // the Jetpack's own burst: 5 orange-yellow, then 10 green
          const orange = i < 5, spread = (Math.random() - 0.5) * 0.5, sp = 1 + Math.random() * 5;
          flames.push({ x: ox, y: oy, vx: (bx + spread * (by !== 0 ? 1 : 0)) * sp, vy: (by + spread * (bx !== 0 ? 1 : 0)) * sp,
            c: orange ? [240, 60 + ri(0, 120), 10 + ri(0, 30)] : [0.3 * 255, (0.6 + Math.random() * 0.4) * 255, 0.3 * 255],
            life: orange ? 3 + ri(0, 3) : 1 + ri(0, 2), size: 0.5 + Math.random() });
        }
      }
      if (!live) flames.length = 0;
      for (let i = flames.length - 1; i >= 0; i--) {
        const f = flames[i];
        f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.97; f.vy *= 0.97; f.life -= dt;
        if (f.life <= 0) flames.splice(i, 1);
      }
    }
    function drawFlames() {
      for (const f of flames) {
        ctx.fillStyle = `rgb(${f.c[0] | 0},${f.c[1] | 0},${f.c[2] | 0})`;
        ctx.beginPath(); ctx.arc(-g.startX + f.x, -g.startY + f.y + 24, f.size, 0, Math.PI * 2); ctx.fill();
      }
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
              bubbles.push({ fire: elroy2(), x: p.x, y: p.y - 2, vx: p.vx * 0.6, vy: -(0.6 + Math.random() * 0.5) + p.vy * 0.3,
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

    // "new" (the author, 2026-11-16): ARENAS on the title while there's an arena this browser hasn't seen, and those arenas'
    // names in the list, pulse between white and green, or red and green while highlighted (the font has no green: drawn
    // white and tinted)
    function newPulse(selected) {
      // (the highlighted one pulses opposite the rest: red while they're green, so it always stands out)
      const k = 0.5 + 0.5 * Math.sin(performance.now() / 220 + (selected ? Math.PI : 0)), from = selected ? [1, 0.12, 0.12] : [1, 1, 1], to = [0.22, 1, 0.3];
      setColor(from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k);
    }
    function drawMenu(menu, x, y, spacing) {
      menu.forEach((item, i0) => {
        const i = i0 + 1;
        let color = menu.selectedItem === i ? 1 : 0;
        const fresh = !!(item.fresh || (menu === core.attractMenu && item.text === "Arenas" && g.newArena));
        if (fresh) { newPulse(color === 1); color = 0; }
        if (item.text) print(item.text, item.x !== undefined ? item.x : x, item.y !== undefined ? item.y : (y + i * spacing), color);
        if (fresh) setColor(1, 1, 1);
        else if (item.options) {
          const o = item.options[(item.selectedOption || 1) - 1];
          if (o) print(o.text, item.x !== undefined ? item.x : x, item.y !== undefined ? item.y : y + (i - 1) * spacing, color);
        }
      });
    }
    // web edition (the author, 2026-11-15): the ability in play, top right in a real game (where 2UP would be; the login
    // corner shows there only on menus and in the demo): Pac-Man yellow while it's ready, a dark yellow once spent
    function abilityReady() {
      const a = core.curAbility(), pac = g.chars && g.chars.pac;
      if (!a || !pac) return false;
      if (a === 1 || a === 2 || a === 3) return !T(pac.phased);
      if (a === core.REWIND) return !g.rewindSpent;
      if (a === core.PAUSE) return !g.pauseSpent;
      if (a === core.VACUUM) return !g.vacuumSpent;
      if (a === core.PUSH) return !g.pushSpent;
      return false;
    }
    function drawAbility() {
      const a = core.curAbility(), name = core.ABILITY_NAMES[a];
      if (!name) return;
      const x = 28 - name.length;
      if (abilityReady()) print(name, x, 0, 6);
      else { setColor(0.42, 0.42, 0.42); print(name, x, 0, 6); setColor(1, 1, 1); } // spent: a dark yellow (paler read too much like ready)
    }
    function drawHeader() {
      print("1up", 3, 0); print("high score", 9, 0);
      print(core.formatScore(g.score || 0), 0, 1, 0);
      if (g.neatOn) print("neat", 24, 1, 6); // NEAT (the "neat" cheat): its sticker, where 2UP's score would be
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
      unclip();
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
      unclip();
    }
    function begin(withBg) {
      ctx.globalAlpha = 1; setColor(1, 1, 1);
      clearScreen(); if (withBg) drawBackground();
    }
    // (the vector look's text mask is clipped the same way, or text scrolled out of sight would still mark it)
    const clip = (x, y, w, h) => { for (const c of [ctx, mctx]) { c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip(); } };
    const unclip = () => { ctx.restore(); mctx.restore(); };

    // ---- scenes
    function drawAttract() {
      begin(true);
      const msg1 = "jolt country games", msg2 = "presents";
      drawHeader();
      if (g.state.showHelperText) {
        // (everything on the title a row higher but CREDITS: the author, 2026-11-15; the menu's rows moved in core.js)
        print(msg1, 14 - msg1.length / 2, 4);
        print(msg2, 14 - msg2.length / 2, 6);
        drawMenu(core.attractMenu, 6, 23, 1);
        print("credits", 14 - "credits".length / 2, 35, 2); // (it said "web edition"; the author, 2026-11-15: the credits link, same pink)
        drawPicks();
        drawNeat();
      }
      if (g.mode === "restart" && core.mode.isStarted("restart") && g.ghosts) {
        ctx.save(); ctx.translate(0, -TILE); maskShift = -TILE; // the intro a tile higher too (the vector look's text mask with it)
        clip(0, 0, 224, 190);
        for (const name of ["blinky", "pinky", "inky", "clyde", "punky", "gunky", "gronky"]) { const c = g.ghosts[name]; if (c) drawChar(c, c.x, c.y); }
        const bump = raveOn() ? 1 + 0.06 * raveBeat().kick : 1, bw = assets.banner.width * bump, bh = assets.banner.height * bump; // darkstar: it bumps on the beat
        const bx = g.modeTimer > 135 ? g.ghosts.blinky.x - 100 : 12, by = g.modeTimer > 135 ? g.ghosts.blinky.y + 7 : 97;
        // the olive (the author's secret: every replay, round and round), clickable once the logo has come to rest: it sits
        // at 183-187, 8-12 in the banner, a few pixels' slack round it (the intro is drawn a tile higher: -8)
        if (oliveAction && Math.abs(bx - 12) < 0.5 && Math.abs(by - 97) < 0.5) oliveBox = { x0: 12 + 180, y0: 97 - 8 + 5, x1: 12 + 191, y1: 97 - 8 + 16, action: oliveAction, quiet: true }; // (quiet: no pointer cursor to give it away)
        ctx.drawImage(assets.banner, bx - (bw - assets.banner.width) / 2, by - (bh - assets.banner.height) / 2, bw, bh);
        unclip();
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
        ctx.restore(); maskShift = 0;
      }
    }

    function drawGame() {
      const cm = core.getCurrentMaze();
      ctx.globalAlpha = 1; setColor(1, 1, 1);
      clearScreen();
      const inter = g.mode === "intermission1" || g.mode === "placeholderIntermission" || g.mode === "intermission2" || g.mode === "intermission3";
      if (!inter) drawBackground();
      if (!inter && lanternOn() && backgroundOf(g.currentBackground) && g.config.crtEffect !== "vector") {
        // Lantern: the background above and below the maze faded like the dark inside it (no seam); the score and lives
        // go on top at full brightness
        const v = g.config.crtEffect ? 13 : 0;
        const k = lanternDark();
        ctx.fillStyle = `rgba(${v},${v},${v},${(1 - LANTERN_BG) * k})`; ctx.fillRect(0, 0, GW, 24); ctx.fillRect(0, 272, GW, GH - 272);
      }

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
        else if (replayInfo && replayInfo()) drawReplayLabel(replayInfo());
        else drawAbility();
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
          const f = (ad === 4 || ad === 5) && g.mode !== "playerUp" && g.mode !== "gameover";
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
        updateFlames(); drawFlames(); setColor(1, 1, 1);
        unclip();
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
        drawSprite(f.sheet, f.quad, fl.x - 8, fl.y + 24 - 8 + fruitHop(), true);
      }
      if (T(g.fruitScoreTimer)) {
        const fl = cm.fruitLoc;
        const quad = FRUIT_SCORES[g.level.fruit.score];
        for (let i = 0; i <= 2; i++) drawSprite("spr16", quad + i, fl.x - 8 + 16 * (i - 1), fl.y + 24 - 8, true);
      }

      clip(0, 24, 224, 248);
      const routes = debug && g.state.showGhosts && !g.state.hideMaze ? ghostRoutes() : null;
      if (routes) { drawNoUp(cm); drawRoutes(routes); }
      if (g.state.showPac) drawChar(g.chars.pac, g.chars.pac.x, g.chars.pac.y, g.chars.pac.phased, true);
      if (g.vacuumFx > 0 && core.curAbility() === core.VACUUM) drawVacuum();
      if (g.pushFx > 0 && core.curAbility() === core.PUSH) drawPush();
      if (g.state.showGhosts) {
        for (const name of core.charKeys()) { const c = g.chars[name]; if (c.target && !c.hidden) drawChar(c, c.x, c.y, false, true); }
      }
      if (lanternOn(cm)) { drawLantern(cm); if (routes) drawRoutes(routes); }
      unclip();
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

    // web edition: the Vacuum, sucking: everything it took (g.vacuumFly: dots, energizers, the fruit, eaten already)
    // pulled straight into Pac-Man, real size, the nearest first; and blue stun rings
    // rippling in from the vacuum's reach (6 tiles) (core.VACUUM_FX frames)
    function drawVacuum() {
      const pac = g.chars.pac, total = core.VACUUM_FX, k = 1 - g.vacuumFx / total; // 0 -> 1
      const tx = pac.x, ty = pac.y + 24;                                    // where he is now (he keeps moving)
      // the real things, at their real size, pulled straight in: they all start moving at once and speed up as they
      // come (suction), the nearest reaching him first, gone as they arrive (shrunk and swung along curves, they looked
      // like a particle effect to the author)
      for (const f of g.vacuumFly || []) {
        const t = Math.min(1, k / (0.35 + 0.6 * f.d / 6));
        if (t >= 1) continue;
        const e = t * t, sx = f.x, sy = f.y + 24;
        const cx = sx + (tx - sx) * e, cy = sy + (ty - sy) * e;
        if (f.fruit) drawSprite(f.fruit.sheet, f.fruit.quad, cx - 8, cy - 8, true);
        else { const a = f.item.animator(); drawSprite(a.spr, a.frames[(f.item.frame || 1) - 1], cx - 4, cy - 4, true); }
      }
      // the rings: the blue stun rings from the first Star Wars film (the author's picture): concentric rings of electric
      // blue, each a soft glow with a brighter core, rippling in from the vacuum's reach, one after the other (darker and
      // calmer than the first try: two rings, no shimmer)
      const cx = camX() + tx, cy = camY() + ty;
      ctx.save();
      for (let i = 0; i < 2; i++) {
        const p = k * 1.4 - i * 0.4;                                        // the second ring follows the first
        if (p <= 0 || p >= 1) continue;
        const R = 6 * TILE * (1 - p);                                       // closing in
        const fade = Math.sin(p * Math.PI);                                 // in, then out
        ctx.strokeStyle = "rgb(20,50,190)"; ctx.globalAlpha = 0.35 * fade; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, R), 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "rgb(60,100,230)"; ctx.globalAlpha = 0.85 * fade; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, R), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
    }

    // web edition: the Push, the Vacuum's rings the other way: two dark blue rings rippling out from Pac-Man to the
    // push's furthest reach (core.PUSH_MAX tiles) while the ghosts fly (the ghosts themselves are moved by the core)
    function drawPush() {
      const pac = g.chars.pac, k = 1 - g.pushFx / core.PUSH_FX, cx = camX() + pac.x, cy = camY() + pac.y + 24;
      ctx.save();
      for (let i = 0; i < 2; i++) {
        const p = k * 1.4 - i * 0.4;
        if (p <= 0 || p >= 1) continue;
        const R = core.PUSH_MAX * TILE * p, fade = Math.sin(p * Math.PI);
        ctx.strokeStyle = "rgb(20,50,190)"; ctx.globalAlpha = 0.35 * fade; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, R), 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "rgb(60,100,230)"; ctx.globalAlpha = 0.85 * fade; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, R), 0, Math.PI * 2); ctx.stroke();
      }
      ctx.restore();
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
    let backdrop = null; // the vector look: the background picture drawn this frame, shown behind the beam (not traced)
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
      if (mc === RAINBOW) rainbowSwatch(21 * TILE, 25 * TILE);
      else if (mc > 0 && mc < 99) drawSpriteAtTile("spr8", mc + 2, 21, 25);
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
    // web edition: "credits" on the title opens the credits; "pinback's picks" (the sign right of the menu) opens the picks
    const TITLE_LINKS = [{ x0: 76, y0: 276, x1: 148, y1: 288, scene: "credits" }];
    const creditsLinks = () => (g.scene.name === "credits" ? LINKS : g.scene.name === "attract" && g.state && g.state.showHelperText
      ? [...TITLE_LINKS, ...(picksBox ? [picksBox] : []), ...(neatBox ? [neatBox] : []), ...(oliveBox ? [oliveBox] : [])] : g.scene.links || []);
    let oliveBox = null, oliveAction = null; // (the olive in the title's martini: see drawAttract)
    let neatBox = null, neatAction = null; // (the "neat!" sticker, lower left of the title: see drawNeat)

    // "PINBACK'S PICKS" (the author, 2026-11-15; the one place the font leaves the grid): the game font, smaller, on a
    // jaunty angle right of the main menu, level with FAVORITES, rocking gently, a colour a line with a white shine
    // sweeping across now and then and the odd sparkle (the author: a first, busier try was hard to read); a click / tap opens the author's favorites (leaderboard.js picks). Render only.
    const PICKS_LINES = ["pinback's", "picks"], PICKS_SCALE = 0.875, PICKS_X = 188, PICKS_Y = 224, PICKS_ANGLE = -0.22;
    const PICKS_COLORS = [6, 3]; // a colour a line (yellow, cyan); a white shine sweeps across now and then (the author: calmer, readable)
    let picksBox = null;
    const sparkles = [];
    function picksGlyph(ch, o, x, y) { // one character at (x, y) in the sign's frame (an apostrophe: the top of "!", as print does)
      const s = sheets.text8; if (!s) return;
      const q = ch === "'" ? "!" : ch.toUpperCase(), idx = TEXT_CHARS.indexOf(q);
      if (idx < 0 || q === " ") return;
      const j = o * 64 + idx, sx = (j % s.cols) * 8, sy = Math.floor(j / s.cols) * 8;
      if (ch === "'") ctx.drawImage(s.img, sx, sy, 8, 3, x, y, 8, 3); // the top of "!"
      else ctx.drawImage(s.img, sx, sy, 8, 8, x, y, 8, 8);
    }
    function drawPicks() {
      const t = performance.now() / 1000, shine = ((t % 3.5) / 3.5) * 22 - 4; // the shine's letter position, every 3.5 s
      const ang = PICKS_ANGLE + Math.sin(t * 1.6) * 0.1;
      ctx.save();
      ctx.translate(PICKS_X, PICKS_Y); ctx.rotate(ang); ctx.scale(PICKS_SCALE, PICKS_SCALE);
      ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 1; // (smoothed: pixel for pixel, a smaller font at an angle breaks up)
      let n = 0;
      PICKS_LINES.forEach((line, li) => {
        const x0 = -line.length * 4, y0 = (li - PICKS_LINES.length / 2) * 10;
        for (let i = 0; i < line.length; i++, n++) picksGlyph(line[i], Math.abs(n - li * 2 - shine) < 0.8 ? 0 : PICKS_COLORS[li], x0 + i * 8, y0);
      });
      // sparkles: little four-pointed stars popping up round the words and twinkling out
      if (Math.random() < 0.025 && sparkles.length < 2) sparkles.push({ x: (Math.random() - 0.5) * 84, y: (Math.random() - 0.5) * 30, born: t, life: 0.8 + Math.random() * 0.6 });
      for (let i = sparkles.length - 1; i >= 0; i--) {
        const sp = sparkles[i], k = (t - sp.born) / sp.life;
        if (k >= 1) { sparkles.splice(i, 1); continue; }
        const r = Math.round(Math.sin(k * Math.PI) * 2);
        ctx.fillStyle = k < 0.5 ? "#ffffff" : "#ffff80";
        ctx.fillRect(sp.x - r, sp.y, r * 2 + 1, 1); ctx.fillRect(sp.x, sp.y - r, 1, r * 2 + 1);
      }
      ctx.imageSmoothingEnabled = false;
      ctx.restore();
      picksBox = { x0: PICKS_X - 38, y0: PICKS_Y - 24, x1: PICKS_X + 36, y1: PICKS_Y + 16, scene: "picks" };
    }
    // "NEAT!" (the author, 2026-11-22): a sticker in the title's lower left, the picks sign's small font, tilted the other
    // way and rocking out of step with it, a white shine passing now and then; a click / tap opens the NEAT page (main.js
    // openNeat, set by setNeat). Render only
    const NEAT_X = 32, NEAT_Y = 268, NEAT_ANGLE = 0.2;
    function drawNeat() {
      if (!neatAction) { neatBox = null; return; }
      const t = performance.now() / 1000, shine = ((t % 4.2) / 4.2) * 12 - 3, ang = NEAT_ANGLE + Math.sin(t * 1.3 + 1) * 0.08;
      ctx.save();
      ctx.translate(NEAT_X, NEAT_Y); ctx.rotate(ang); ctx.scale(PICKS_SCALE, PICKS_SCALE);
      ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 1;
      const word = "neat!";
      for (let i = 0; i < word.length; i++) picksGlyph(word[i], Math.abs(i - shine) < 0.8 ? 0 : 6, -word.length * 4 + i * 8, -4);
      ctx.imageSmoothingEnabled = false;
      ctx.restore();
      neatBox = { x0: NEAT_X - 26, y0: NEAT_Y - 12, x1: NEAT_X + 26, y1: NEAT_Y + 12, action: neatAction };
    }

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
    // a scene's settings summary, centred lines: each option's name white, its value in Pac-Man yellow (the author)
    // (the full 28 columns; maxLines: the room there is, which callers make enough for every setting where they can)
    function drawSummary(sc, top, maxLines) {
      if (!sc.summaryParts) { sc.summary(28).slice(0, maxLines).forEach((l, i) => center(l, top + i, 0)); return; }
      sc.summaryParts(28).slice(0, maxLines).forEach((line, i) => {
        const text = line.map(([l, v]) => (l ? l + " " : "") + v).join("  ");
        let x = 14 - text.length / 2;
        for (const [l, v, c] of line) {
          if (l) { print(l, x, top + i, 0); x += l.length + 1; }
          print(v, x, top + i, c !== undefined ? c : l ? 6 : 0); x += v.length + 2; // ("classic Pac-Man", with no name, stays white; a pick's name: yellow)
        }
      });
    }
    // ---- replays (EXPERIMENTAL, 2026-11-18): "REPLAY" (with its speed) and the player's name top right, where the ability
    // shows in a game; and an EXPERIMENTAL sticker at the bottom, a little crooked (the author's)
    let replayInfo = null;
    function drawReplayLabel(r) {
      const tag = "replay" + (r.paused ? " ii" : r.speed > 1 ? " " + r.speed + "x" : "");
      print(tag, 28 - tag.length, 0, Math.floor(performance.now() / 500) % 2 ? 1 : 2);
      const n = r.name.slice(0, 8); print(n, 28 - n.length, 1, 0); // (8: more runs into the HIGH SCORE)
      drawSticker();
    }
    let sticker = null;
    function drawSticker() {
      if (!sticker) { // yellow, the words cut out of it and backed in black: black on yellow, like a warning label
        const word = "experimental", W = word.length * 8 + 6, H = 12, c = document.createElement("canvas"); c.width = W; c.height = H;
        const x = c.getContext("2d"); x.fillStyle = "#ffd400"; x.fillRect(0, 0, W, H);
        x.globalCompositeOperation = "destination-out";
        const s2 = sheets.text8;
        for (let i = 0; i < word.length; i++) { const j = TEXT_CHARS.indexOf(word[i].toUpperCase()); x.drawImage(s2.img, (j % s2.cols) * 8, Math.floor(j / s2.cols) * 8, 8, 8, 3 + i * 8, 2, 8, 8); }
        x.globalCompositeOperation = "destination-over"; x.fillStyle = "#111"; x.fillRect(0, 0, W, H);
        x.globalCompositeOperation = "source-over"; x.strokeStyle = "#111"; x.lineWidth = 1; x.strokeRect(0.5, 0.5, W - 1, H - 1);
        sticker = c;
      }
      ctx.save(); ctx.imageSmoothingEnabled = true; ctx.translate(GW / 2, 280); ctx.rotate(-0.05); ctx.scale(0.75, 0.75);
      ctx.drawImage(sticker, -sticker.width / 2, -sticker.height / 2); ctx.restore(); ctx.imageSmoothingEnabled = false;
    }
    // the share icon: the usual curved arrow, up from the bottom left and off to the right (the author's pick; three
    // joined dots came first), no backing: it sits on whatever background there is
    const SHARE_ICON = ["....#..", "....##.", ".######", "#...##.", "#...#..", "#......"];
    function shareMark(px, ty) {
      ctx.fillStyle = "#ffb8ff";
      SHARE_ICON.forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === "#") ctx.fillRect(px + i, ty * TILE + 1 + j, 1, 1); });
    }
    function deleteMark(px, ty) { // the author's: a little red X (it deletes the replay, not the score)
      ctx.fillStyle = "#ff4040";
      for (let k = 0; k < 5; k++) { ctx.fillRect(px + k, ty * TILE + 2 + k, 1, 1); ctx.fillRect(px + 4 - k, ty * TILE + 2 + k, 1, 1); }
    }
    function playMark(px, ty) { ctx.fillStyle = "#ffb8ff"; for (let k = 0; k < 5; k++) ctx.fillRect(px, ty * TILE + 1 + k, k < 3 ? k + 1 : 5 - k, 1); }
    function drawLeaderboard() {
      const sc = g.scene;
      begin(true); drawHeader();
      if (sc.title) { center(sc.title(), 3, 3); center(sc.subtitle(), 4, 2); }
      else center("leaderboard", 4, 3);
      const lay = sc.layout || { summaryTop: 6, summaryLines: 5, listTop: 12, messageRow: 31 }; // the arena page packs tighter
      // every setting shows (the author, 2026-11-15: lines past the room used to be cut off): when the summary needs more
      // lines than the page's usual room, the top 10 moves down under it and goes single-spaced
      const nLines = sc.summaryParts ? sc.summaryParts(28).length : sc.summary(28).length;
      const fits = nLines <= lay.summaryLines;
      drawSummary(sc, lay.summaryTop, fits ? lay.summaryLines : nLines);
      const listTop = fits ? lay.listTop : lay.summaryTop + nLines + 1, step = fits ? 2 : 1;
      const b = sc.board();
      if (!b.entries.length) center(sc.emptyText ? sc.emptyText(b) : b.status === "loading" ? "loading" : b.status === "error" ? "leaderboard offline" : "no scores yet", Math.max(20, listTop + 4), 0);
      sc.rowRects = []; // (where each score's row is: leaderboard.js makes the ones with a replay clickable)
      b.entries.slice(0, 10).forEach((e, i) => {
        const y = listTop + i * step, hi = sc.highlight === i + 1;
        const o = hi ? (sc.fc % 30 < 15 ? 1 : 3) : 0;
        const rk = String(i + 1);
        print(rk, 3 - rk.length, y, o);
        print(core.formatScore(e.score), 4, y, o);
        print(e.name, 12, y, hi ? o : 4);
        sc.rowRects.push({ i, y });
        if (e.rid) { playMark(2, y); shareMark(216, y); if (sc.canDelete) deleteMark(206, y); } // a replay: a play mark, a share icon at the end (and for the author, a delete X)
      });
      if (sc.message) center(sc.message, lay.messageRow, 2);
      else if (b.entries.some((e) => e.rid)) { // a key to the marks: the little play mark, "replay available" (the author's wording)
        const t = "replay available", x0 = (14 - t.length / 2) * TILE + 6, y = lay.messageRow;
        print(t, 14 - t.length / 2 + 0.75, y, 2); playMark(x0 - 8, y);
      }
      drawMenu(sc.menu, 12, 33, 1);
    }
    // arena list: names are the menu; time left / winners / headings are sc.decor
    function drawArenas() {
      const sc = g.scene;
      begin(true); drawHeader();
      center(sc.title ? sc.title() : "arenas", 3, 3); // (the favorites list is drawn this way too; its own notes are decor)
      const st = sc.status();
      if (sc.name === "arenas" && !sc.menu.some((it) => it.id)) {
        if (st === "loading") center("loading", 15, 0);
        else if (st === "error") center("no running arenas", 15, 0);
      }
      for (const d of sc.decor) print(d.text, d.x, d.y, d.o);
      drawMenu(sc.menu, 0, 0, 1);
    }
    // web edition: the player's profile (src/account.js): name (shimmering), achievements (a row each; "prev 1/2 next" when they don't fit), (earned: yellow; not yet:
    // dimmed). Hovering / tapping a name shows its description and, once earned, "Achieved: MM/DD/YYYY" (an HTML popup, main.js). Rows 8-29 (account.js layout)
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
        print(a.name, 3, y, a.earned ? 6 : 0); // (the date it was earned is in its hover popup)
        ctx.globalAlpha = 1;
      });
      drawMenu(sc.menu, 12, 33, 1);
    }
    function drawNameEntry() {
      const sc = g.scene;
      begin(true); drawHeader();
      if (sc.mode === "createArena") {
        center("create arena", 3, 3);
        drawSummary(sc, 5, 5);
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
      sc.menu.forEach((it, i0) => {
        const on = sc.menu.selectedItem === i0 + 1, m = /^save replay (yes|no)$/.exec(it.text);
        if (!m) { print(it.text, it.x, it.y, on ? 1 : 0); return; }
        // save replay: YES in green, NO in yellow, so it reads as a switch (the author); the label shows the selection
        print("save replay", it.x, it.y, on ? 1 : 0);
        if (m[1] === "yes") { setColor(0.3, 1, 0.35); print("yes", it.x + 12, it.y, 0); setColor(1, 1, 1); } // (white, tinted green: the font has no green)
        else print("no", it.x + 12, it.y, 6); // (yellow, not red: red is the selection colour; the author)
      });
      if (sc.sending) center("saving", 30, 2);
      else if (sc.mode === "createArena") { if (sc.message) center(sc.message, 30, 1); center("esc to cancel", 32, 2); }
      else { if (sc.message) center(sc.message, 29, 1); center("time " + Math.ceil(sc.timer / 60), 30, 0); center("esc to skip", 32, 2); } // (28: save replay yes / no)
    }

    // clickable rows of the current menu, in game pixels (mirrors drawMenu's placement)
    function menuLayout() {
      const scene = g.scene.name;
      let spec = null;
      if (scene === "attract") { if (g.state && g.state.showHelperText) spec = [core.attractMenu, 6, 23, 1]; }
      else if (scene === "options") spec = [core.optMenu, 18, 5, 1];
      else if (scene === "credits") spec = [core.creditsMenu, 12, 27, 2];
      else if ((scene === "leaderboard" || scene === "nameEntry" || scene === "arenas" || scene === "arena" || scene === "profile" || scene === "favorites" || scene === "favorite" || scene === "picks") && !g.scene.sending) spec = [g.scene.menu, 0, 0, 1];
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
    // Blindfold: Lantern (afterDark 6; the author, 2026-11-16): dark but for a circle of light round Pac-Man, 8 tiles across
    // each way, its edge fading; energizers and the fruit always show, and blue ghosts while they're blue. The lights come
    // up at game over and when a board is cleared. Render only (the core never looks at 6)
    const LANTERN = 6, LANTERN_R = 8 * TILE, LANTERN_SOFT = 4 * TILE, LANTERN_BG = 0.4, LANTERN_TEXT = 0.45; // (faded to these, unlit)
    const dark = document.createElement("canvas"); dark.width = GW; dark.height = GH;
    const dctx = dark.getContext("2d");
    const lanternOn = () => g.config.afterDark === LANTERN && !g.state.hideMaze && g.mode !== "gameover" && g.mode !== "levelAnimation"
      && !/^intermission/.test(g.mode);
    // the whole maze shows at READY (a new life, a new board), then the dark comes down quickly once play starts (the
    // author, 2026-11-16); later stops in play (eating a ghost, Suck, Blow) don't bring it back
    const LANTERN_FADE = 600; // ms
    let lanternFrom = 0, lanternReady = true;
    function lanternDark() {
      if (g.mode === "ready" || g.mode === "playerUp") { lanternReady = true; return 0; }
      if (lanternReady) { lanternReady = false; lanternFrom = performance.now(); }
      return Math.min(1, (performance.now() - lanternFrom) / LANTERN_FADE);
    }
    function drawLantern(cm) {
      const k = lanternDark();
      if (k <= 0) return;
      const pac = g.chars.pac, cx = camX() + pac.x, cy = camY() + pac.y + 24;
      // the dark: the screen's own blank and the background picture, faded (the author: the background and lettering stay,
      // dimmed; only the maze, dots and ghosts are hidden)
      dctx.globalCompositeOperation = "source-over"; dctx.clearRect(0, 0, GW, GH);
      const v = g.config.crtEffect && g.config.crtEffect !== "vector" ? 13 : 0; // (clearScreen's blank)
      dctx.fillStyle = `rgb(${v},${v},${v})`; dctx.fillRect(0, 0, GW, GH);
      const bg = backgroundOf(g.currentBackground);
      if (bg && g.config.crtEffect !== "vector") { dctx.globalAlpha = LANTERN_BG; dctx.drawImage(bg, 0, 0, GW, GH); dctx.globalAlpha = 1; }
      dctx.globalCompositeOperation = "destination-out";
      const glow = dctx.createRadialGradient(cx, cy, LANTERN_R - LANTERN_SOFT, cx, cy, LANTERN_R);
      // (a wide, gradual fade: the light starts dimming halfway out; the author wanted more fade than 2 tiles, not less)
      glow.addColorStop(0, "rgba(0,0,0,1)"); glow.addColorStop(0.5, "rgba(0,0,0,0.5)"); glow.addColorStop(1, "rgba(0,0,0,0)");
      dctx.fillStyle = glow; dctx.fillRect(0, 0, GW, GH);
      ctx.globalAlpha = k; ctx.drawImage(dark, 0, 0); ctx.globalAlpha = 1;
      // the lettering (PLAYER ONE, READY!), faded where it's dark
      setColor(1, 1, 1, LANTERN_TEXT);
      if (g.mode === "playerUp") { print("player one", cm.w / 2 - 5, cm.playerone, 3, true); print("ready!", cm.w / 2 - 3, cm.ready, 6, true); }
      else if (g.state.showReady) print("ready!", cm.w / 2 - 3, cm.ready, 6, true);
      setColor(1, 1, 1);
      // always seen: the energizers and blue ghosts; the fruit too, but faded like the lettering (the author, 2026-11-16;
      // in the light it's drawn bright underneath anyway)
      for (const sc of g.powers) drawScenery(sc, sc.x, sc.y, false);
      if (T(g.fruitTimer)) {
        const fl = cm.fruitLoc; let f = g.level.fruit;
        if (g.config.plusMode) f = core.levels.plusModeFruitMap(f);
        setColor(1, 1, 1, LANTERN_TEXT); drawSprite(f.sheet, f.quad, fl.x - 8, fl.y + 24 - 8 + fruitHop(), true); setColor(1, 1, 1);
      }
      if (g.state.showGhosts) for (const name of core.charKeys()) {
        const c = g.chars[name];
        if (c.target && !c.hidden && T(c.frightened) && !c.dead) drawChar(c, c.x, c.y, false, true);
      }
    }
    let debug = false;
    // test mode: the tiles where a ghost may not turn up (above the pen, above Pac-Man's start: the arcade's hiding
    // spots), a red bar across the top of each, unless Unrestricted is on (the author, 2026-11-16)
    function drawNoUp(cm) {
      ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = "#ff3030";
      for (let y = 0; y < cm.h; y++) for (let x = 0; x < cm.w; x++) {
        if (!cm.isDisallowed(x, y)) continue;
        const px = camX() + x * TILE, py = camY() + (y + 3) * TILE;
        ctx.fillRect(px + 1, py, 6, 1); ctx.fillRect(px + 3, py + 1, 2, 2); // a bar with a little stop under it
      }
      ctx.restore();
    }
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

    const shakes = new WeakMap(); // (the renderer's own, so nothing visual lands on the game's objects)
    let drawCount = 0; const SHAKE_EVERY = 2, SHAKE_PX = 0.5; // (a new offset every other frame, half a pixel at most: the author tried 1, 2 and 3 frames and a whole pixel)
    function draw() {
      drawCount += 1;
      ctx.globalAlpha = 1; oyBlock = null; accountBox = null; picksBox = null; neatBox = null; oliveBox = null; film = false; backdrop = null;
      if (masking || g.config.crtEffect === "vector") mctx.clearRect(0, 0, GW, GH);
      masking = g.config.crtEffect === "vector";
      const scene = g.scene.name;
      // darkstar: an energizer shakes the whole picture for a moment, a few pixels at first, settling
      const shaking = shake > 0 && raveOn() && !g.paused; // (held while paused)
      if (shaking) {
        const amp = 4 * shake / SHAKE, dx = Math.round((Math.random() * 2 - 1) * amp), dy = Math.round((Math.random() * 2 - 1) * amp);
        ctx.fillStyle = "#000"; ctx.fillRect(0, 0, GW, GH);
        for (const c of [ctx, mctx]) { c.save(); c.translate(dx, dy); }
        shake -= 1;
      } else if (!g.paused) shake = 0;
      if (scene === "game") drawGame();
      else if (scene === "attract") drawAttract();
      else if (scene === "options") drawOptions();
      else if (scene === "credits") drawCredits();
      else if (scene === "leaderboard" || scene === "arena" || scene === "favorite") drawLeaderboard();
      else if (scene === "arenas" || scene === "favorites" || scene === "picks") drawArenas();
      else if (scene === "mina") { begin(false); drawIntermission3(g.scene.t, true); } // the "mina" cheat
      else if (scene === "nameEntry") drawNameEntry();
      else if (scene === "profile") drawProfile();
      else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, GW, GH); print(scene, 2, 2, 0); }
      if (raveOn()) drawRave(); else confetti = []; // (none kept through a stretch without the lights, an intermission, to pop up after it)
      if (shaking) { ctx.restore(); mctx.restore(); }
      drawToast();
    }
    // darkstar's lights, over everything: spotlights sweeping from the top, lasers fanning up from the bottom corners every
    // other phrase, and confetti when something good happens (the bokeh is in drawBackground, behind the maze)
    let confetti = [], lastMode = null, lastFright = 0;
    const SHAKE = 15; let shake = 0; // frames of screen shake left (an energizer: the author)
    function burst(x, y, n) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = 0.6 + Math.random() * 2.2;
        confetti.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.6, c: HUES[i % HUES.length], life: 60 + Math.random() * 50 });
      }
    }
    function drawRave() {
      const rb = raveBeat(), t = rb.b;
      ctx.save(); ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < 4; i++) { // spotlights
        const ox = 20 + i * 61, a = Math.PI / 2 + 0.55 * Math.sin(t * Math.PI / 8 + i * 1.7), wd = 0.17, L = 340;
        const hue = HUES[(rb.bar + i) % HUES.length];
        const gr = ctx.createLinearGradient(ox, 0, ox + Math.cos(a) * L, Math.sin(a) * L);
        gr.addColorStop(0, `hsla(${hue},100%,60%,${0.16 + 0.1 * rb.kick})`); gr.addColorStop(1, `hsla(${hue},100%,50%,0)`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(ox, -4);
        ctx.lineTo(ox + Math.cos(a - wd) * L, Math.sin(a - wd) * L); ctx.lineTo(ox + Math.cos(a + wd) * L, Math.sin(a + wd) * L); ctx.closePath(); ctx.fill();
      }
      if (Math.floor(rb.bar / 2) % 2 === 1) { // lasers, every other two bars
        ctx.lineWidth = 1;
        for (const [ox, sgn, hue] of [[0, 1, 120], [GW, -1, 330]]) for (let k = 0; k < 5; k++) {
          const a = -Math.PI / 2 + sgn * (0.25 + k * 0.14 + 0.3 * Math.sin(t * Math.PI / 2 + k));
          ctx.strokeStyle = `hsla(${hue},100%,60%,${0.35 + 0.3 * rb.kick})`;
          ctx.beginPath(); ctx.moveTo(ox, GH); ctx.lineTo(ox + Math.cos(a) * 420, GH + Math.sin(a) * 420); ctx.stroke();
        }
      }
      ctx.restore();
      // confetti: a ghost eaten, an energizer, a board cleared
      if (g.scene.name === "game" && g.chars && g.chars.pac) {
        const pac = g.chars.pac, px = camX() + pac.x, py = camY() + pac.y + 24;
        if (g.mode === "ateGhost" && lastMode !== "ateGhost") burst(px, py, 40);
        if (typeof g.frightened === "number" && g.frightened > lastFright + 30) { burst(px, py, 60); shake = SHAKE; }
        lastFright = typeof g.frightened === "number" ? g.frightened : 0;
      }
      lastMode = g.mode;
      if (!g.paused) confetti = confetti.filter((c) => (c.life -= 1) > 0); // (stopped in mid-air while paused)
      ctx.save(); ctx.globalCompositeOperation = "lighter"; // (the colours glow: brighter, more intense, the author)
      for (const c of confetti) {
        if (!g.paused) { c.vy += 0.06; c.vx *= 0.99; c.x += c.vx; c.y += c.vy; }
        ctx.fillStyle = `hsl(${c.c},100%,${62 + 18 * Math.sin(c.life * 0.5)}%)`;
        ctx.fillRect(Math.round(c.x), Math.round(c.y), Math.sin(c.life * 0.4) > 0 ? 2 : 1, 1);
      }
      ctx.restore();
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

    return { screen, textMask, draw, filmOn: () => film, backdrop: () => backdrop, setDebug: (on) => { debug = !!on; }, setRave: (r) => { rave = r; }, setReplay: (f) => { replayInfo = f; }, setOlive: (f) => { oliveAction = f; }, setNeat: (f) => { neatAction = f; }, ghostColor, print, drawSprite, drawChar, ctx, GW, GH, menuLayout, creditsLinks, oyBlock: () => oyBlock,
      // account corner: fn() -> the logged-in name or null (fn.online false: no corner); hot = under the mouse
      setAccount(fn, online) { accountName = fn; accountOnline = !!online; }, accountBox: () => accountBox, setAccountHot(h) { accountHot = !!h; } };
  }

  // =============================================================== presenter: normal CRT + "MAX" CRT (non-canon)
  function createPresenter(canvas, source, getConfig, smoothNow = () => false, textMask = null, getBackdrop = () => null) { // smoothNow: Mina's film is showing; textMask: where text is (vector look)
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
      // an outline pixel: rgb = its hue at full strength, a = its brightness (0 where it isn't on an outline). Brightness
      // is kept apart so the beam can be strictly in proportion to it (below): fades (Sonar ghosts, Blindfold mazes, the
      // dots fading in, "FOR MINA") fade exactly as in the other looks (2026-11-14; brightness used to be flattened above
      // 70% and cut off below 8-18%, so things popped instead of fading). The screen is cleared to true black here, so
      // "dark" can mean almost nothing; "another colour" is judged relative to brightness, so a fading ghost keeps its eyes
      vec4 edge(vec2 t){
        vec3 c = px(t); float m = mx(c);
        if (m < 0.012 || isText(t) > 0.5) return vec4(0.0);
        float e = 0.0;
        vec3 n0 = px(t + vec2(1.0, 0.0)), n1 = px(t - vec2(1.0, 0.0)), n2 = px(t + vec2(0.0, 1.0)), n3 = px(t - vec2(0.0, 1.0));
        e = max(e, step(mx(n0), 0.012)); e = max(e, step(mx(n1), 0.012)); e = max(e, step(mx(n2), 0.012)); e = max(e, step(mx(n3), 0.012));
        e = max(e, step(0.15, distance(c, n0) / max(m, mx(n0)))); e = max(e, step(0.15, distance(c, n1) / max(m, mx(n1))));
        e = max(e, step(0.15, distance(c, n2) / max(m, mx(n2)))); e = max(e, step(0.15, distance(c, n3) / max(m, mx(n3))));
        return vec4(c / m, m) * e;
      }
      void main(){
        // (the film at the CRT's brightness, and no glow in the vector look while it's on (present): with no scanlines or
        // grille to darken it, it came out washed out, and the glow blew its whites out)
        if (film > 0.5) { gl_FragColor = vec4(texture2D(tex, vuv).rgb * 0.72, 1.0); return; }
        vec2 p = vuv * srcSize - 0.5, b = floor(p + 0.5);
        vec3 acc = vec3(0.0); float bright = 0.0, wsum = 0.0;
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
          vec2 t = b + vec2(float(dx), float(dy)), d = p - t;
          vec4 e = edge(t);
          float w = exp(-dot(d, d) / 0.2) * step(0.001, e.a); // a thin beam (wider looked soft)
          acc += e.rgb * w; bright += e.a * w; wsum += w;
        }
        float k = max(acc.r, max(acc.g, acc.b));
        // the stroke's shape at full strength (saturating, keeps its hue; dimmed, with a small white core, for a crisp
        // line: brighter looked washed out), then scaled by the brightness of the pixels it traces
        vec3 beam = acc / max(k, 1e-4) * (1.0 - exp(-k * 1.8)) * 0.92;
        beam += vec3(0.34) * smoothstep(0.9, 1.3, k) * (1.0 - exp(-k));
        beam *= bright / max(wsum, 1e-4);
        // text: the CRT's way, each pixel a soft dot of light that runs into its neighbours sideways and leaves a dark
        // scanline between rows (flat blocks looked too clean); at the pixel's own brightness, so it fades like the rest
        vec3 txt = vec3(0.0);
        for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
          vec2 t = b + vec2(float(dx), float(dy)), d = p - t;
          if (isText(t) > 0.004) txt += px(t) * exp(-d.x * d.x / 0.45 - d.y * d.y / 0.11);
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
    const VEC_BACKDROP = "1.0";
    // the "discarded" look (an experiment): the monitor tilted by RUIN_ANGLE radians (also in main.js toGame, via
    // presenter.ruinAngle), its glass cracked, lying in a ruin
    const RUIN_ANGLE = 0.09; // the backdrop's brightness (the pictures are already at 25%)
    const pU = mk(HDR + `
      uniform sampler2D bezTex, back; uniform float backOn; uniform vec4 zmap; uniform vec2 res; uniform vec4 frame; uniform float time, dpr, hourAngle, tv, vec, ruin; // frame: the screen's rect in the canvas (uv); tv: 1 = living-room TV; vec: 1 = vector
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float sdBox(vec2 p, vec2 b, float r){ vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
      // the vector look's angular screen: straight edges, the corners cut off at 45 degrees (a vector cabinet's bezel)
      float sdChamfer(vec2 p){ vec2 a = abs(p); return max(max(a.x, a.y) - 1.0, (a.x + a.y - (2.0 - ${VEC_CHAMFER})) * 0.7071); }
      // the discarded look: the whole monitor tilted (screen-relative uv, rotated round the screen's middle; 224:288)
      vec2 tilt(vec2 f){ vec2 p = (f - 0.5) * vec2(0.7778, 1.0); float cs = cos(${RUIN_ANGLE}), sn = sin(${RUIN_ANGLE});
        p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y); return p / vec2(0.7778, 1.0) + 0.5; }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p){ return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 7.1) + 0.125 * vnoise(p * 4.1 + 3.3) + 0.0625 * vnoise(p * 8.3 + 1.7); }
      // the discarded look's cracks: point i of radial crack k (at set distances out, each a little off the crack's line)
      vec2 crackPt(float k, float i){
        float R = i < 0.5 ? 0.0 : 0.05 * (pow(1.62, i) - 1.0) / 0.62;
        float th = 6.2832 * (k + 0.6 * hash(vec2(k, 1.3))) / 11.0 + (i < 0.5 ? 0.0 : (hash(vec2(k, i + 0.7)) - 0.5) * 0.32);
        return R * vec2(cos(th), sin(th));
      }
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
        if (ruin > 0.5) fuv = tilt(fuv);
        vec2 q = fuv * 2.0 - 1.0;
        q *= ${CRT_ZOOM.toFixed(3)}; // > 1: the glass is smaller than the canvas, leaving a bezel round it
        q += (q.yx * q.yx) * q * (vec > 0.5 ? vec2(${VEC_BEND}) : vec2(0.04, 0.055)); // vector: nearly flat glass
        float d = vec > 0.5 ? sdChamfer(q) : sdBox(q, vec2(1.0), 0.06);
        float inside = 1.0 - smoothstep(-0.004, 0.012, d);
        vec2 uv = (q + 1.0) * 0.5;
        vec3 c = vec3(0.0), backdrop = vec3(0.0), ruinLight = vec3(0.0); float ruinHaze = 0.0, ruinDim = 1.0;
        if (inside > 0.0) { // the tube's effects only where the glass shows
          float ty = 1.0 - uv.y;
          float tick = floor(time * 7.0);
          // RGB convergence error grows toward the edges
          float rim = smoothstep(-0.25, 0.0, d);          // 0 in the middle, 1 at the glass edge
          vec2 ca = q * (0.003 + 0.002 * rim);
          if (tv > 0.5) c = rfTV(uv);
          else if (vec > 0.5) {
            c.r = texture2D(tex, uv + ca * 0.6).r; c.g = texture2D(tex, uv).g; c.b = texture2D(tex, uv - ca * 0.6).b;
            // the vector look's backdrop (the background picture, never traced; added here, not in pV, so it stays out of
            // the afterglow): like the painted backdrops some vector cabinets lit behind a half-silvered mirror (Star
            // Castle, Space Fury): dim, soft and a little cool, behind the lines, never over them
            if (backOn > 0.5) {
              vec2 bp = vec2(1.5 / 224.0, 1.5 / 288.0);
              vec3 bd = texture2D(back, uv).rgb * 0.4 + (texture2D(back, uv + vec2(bp.x, 0.0)).rgb + texture2D(back, uv - vec2(bp.x, 0.0)).rgb
                + texture2D(back, uv + vec2(0.0, bp.y)).rgb + texture2D(back, uv - vec2(0.0, bp.y)).rgb) * 0.15;
              bd = mix(vec3(dot(bd, vec3(0.299, 0.587, 0.114))), bd, 0.7) * vec3(0.85, 0.92, 1.1);
              backdrop = bd * ${VEC_BACKDROP} * (1.0 - clamp(max(c.r, max(c.g, c.b)) * 1.5, 0.0, 1.0)); // added after the flicker
            }
          }
          else {
            float halo = 0.0;
            if (ruin > 0.5) {
              // broken glass, the way glass breaks: an impact low on the right; radial cracks running out from it in
              // straight runs with sharp kinks (polylines through points at set distances, each a little off its line),
              // and the rings between them as straight chords from crack to crack, so the web is angular. A crack
              // segment catches the light depending on its angle: some bright, some barely there. Each shard bends the
              // picture a little its own way. (Drawn after the scanlines: it's on the glass.)
              vec2 cp = (fuv - vec2(0.7, 0.32)) * vec2(0.7778, 1.0);
              float r = length(cp), a = atan(cp.y, cp.x);
              vec2 LD = normalize(vec2(0.75, 0.66));
              float best = 1.0, light = 0.0;
              for (int k = 0; k < 11; k++) {
                float fk = float(k), nk = 2.0 + floor(4.0 * hash(vec2(fk, 2.9)));
                for (int i = 0; i < 5; i++) {
                  float fi = float(i);
                  if (fi >= nk) break;
                  vec2 A = crackPt(fk, fi), B = crackPt(fk, fi + 1.0);
                  vec2 pa = cp - A, ba = B - A; float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
                  float dd = length(pa - ba * t) / 0.7778;
                  float w = 0.0011 * (1.0 - 0.45 * clamp(length(A + ba * t) / 0.8, 0.0, 1.0));
                  float ln = 1.0 - smoothstep(w, w + 0.0012, dd);
                  light = max(light, ln * (0.12 + 0.88 * pow(abs(dot(normalize(ba), LD)), 3.0)));
                  halo = max(halo, 1.0 - smoothstep(0.0015, 0.005, dd));
                  // the ring chord from this crack to the next, at this point (not every one)
                  if (fi >= 1.0 && fi <= 3.0 && fi < 2.0 + floor(4.0 * hash(vec2(mod(fk + 1.0, 11.0), 2.9))) && hash(vec2(fk * 7.0 + fi, 4.4)) > 0.35) {
                    vec2 C = crackPt(mod(fk + 1.0, 11.0), fi);
                    vec2 pc = cp - A, cb = C - A; float tc = clamp(dot(pc, cb) / dot(cb, cb), 0.0, 1.0);
                    float dc = length(pc - cb * tc) / 0.7778;
                    float lc = 1.0 - smoothstep(0.0009, 0.0021, dc);
                    light = max(light, lc * (0.12 + 0.88 * pow(abs(dot(normalize(cb), LD)), 3.0)));
                    halo = max(halo, 1.0 - smoothstep(0.0015, 0.005, dc));
                  }
                }
              }
              float sector = floor((a + 3.14159) / 6.28318 * 11.0);
              float ring = r < 0.05 ? 0.0 : r < 0.131 ? 1.0 : r < 0.262 ? 2.0 : r < 0.474 ? 3.0 : 4.0;
              uv += (vec2(hash(vec2(sector, ring)), hash(vec2(ring, sector + 0.5))) - 0.5) * 0.008 * (1.0 - smoothstep(0.08, 0.7, r));
              if (r < 0.028) light = max(light, step(0.5, hash(floor(fuv * 300.0))) * (1.0 - r / 0.028) * 0.9); // crushed
              ruinLight = vec3(0.5, 0.52, 0.55) * light;
              // the tube itself, failing (the author: "like the CRT ain't quite workin' right anymore"):
              //   the vertical deflection weak at the bottom: the lowest part of the picture squashed
              if (uv.y < 0.2) uv.y = 0.2 * pow(max(uv.y, 0.0) / 0.2, 1.35);
              //   (a hum band creeping up the screen was tried: the author didn't want it)
              //   now and then a jolt, a brownout, and the picture torn sideways below a bright line
              float slot = floor(time * 2.5), ev = step(0.93, hash(vec2(slot, 5.0)));
              float tearY = hash(vec2(slot, 7.0));
              uv.y += ev * (hash(vec2(slot, 6.0)) - 0.5) * 0.012;
              uv.x += ev * step(uv.y, tearY) * (hash(vec2(slot, 8.0)) - 0.3) * 0.03;
              ruinDim = 1.0 - ev * 0.3;
              ruinLight += vec3(0.35, 0.36, 0.4) * ev * (1.0 - smoothstep(0.0, 0.002, abs(uv.y - tearY)));
              ca *= 3.5;                                                   // convergence long gone
              //   (the picture collapsing to a line and springing back was tried: the author didn't want it)
              // schmutz on the glass: greasy smudges hazing the picture and dried drips from the top (applied after the
              // scanlines too)
              float smudge = smoothstep(0.5, 0.75, fbm(fuv * vec2(2.6, 3.4) + 11.0)) * 0.75;
              // dried drips running down from the top (the author liked the first one: more of them), each wobbling its
              // own way and ending in a bead; some older and fainter
              float drip = 0.0;
              for (int dI = 0; dI < 6; dI++) {
                float fd = float(dI);
                float x0 = 0.08 + 0.84 * hash(vec2(fd, 41.0)), yEnd = 0.2 + 0.6 * hash(vec2(fd, 42.0));
                float wd = 0.003 + 0.004 * hash(vec2(fd, 43.0)), age = 0.45 + 0.55 * hash(vec2(fd, 44.0));
                float wob = (0.004 + 0.004 * hash(vec2(fd, 45.0))) * sin(fuv.y * (17.0 + 12.0 * hash(vec2(fd, 46.0))) + fd) + 0.003 * sin(fuv.y * 61.0 + fd * 2.0);
                float dx = fuv.x - x0 - wob;
                float run = (1.0 - smoothstep(wd, wd + 0.007, abs(dx))) * smoothstep(yEnd, yEnd + 0.12, fuv.y) * (0.6 + 0.4 * vnoise(vec2(fuv.y * 40.0, fd)));
                float wobEnd = (0.004 + 0.004 * hash(vec2(fd, 45.0))) * sin(yEnd * (17.0 + 12.0 * hash(vec2(fd, 46.0))) + fd) + 0.003 * sin(yEnd * 61.0 + fd * 2.0);
                float bead = 1.0 - smoothstep(wd + 0.004, wd + 0.011, length((fuv - vec2(x0 + wobEnd, yEnd + 0.004)) * vec2(1.0, 1.4)));
                drip = max(drip, max(run, bead * 0.9) * age);
              }
              // (a water-stain ring was tried: an almost perfect circle, out of place)
              ruinHaze = clamp(smudge + drip * 0.8, 0.0, 0.9);
              ruinLight += vec3(0.075, 0.06, 0.04) * drip;                   // dried residue catching the light
              // (fingerprints and swipe smears were tried: "fake crabmeat". Single bright dust specks before them looked
              // like dead pixels)
            }
            c.r = samp(uv, ca).r; c.g = samp(uv, vec2(0.0)).g; c.b = samp(uv, -ca).b;
            if (ruin > 0.5) {
              c += samp(uv - vec2(0.012, 0.0), vec2(0.0)) * 0.18;           // a ghost image to the right
              // a weak signal: faint snow always; once in a while a burst of it, or a bar of static across part of the
              // screen (occasional: the author)
              float sn = hash(floor(fuv * vec2(320.0, 400.0)) + fract(time * 61.0) * 97.0);
              float burst = step(0.984, hash(vec2(floor(time * 6.0), 11.0)));       // about every 10 s
              float bslot = floor(time * 4.0), by = hash(vec2(bslot, 14.0)), bh = 0.03 + 0.08 * hash(vec2(bslot, 15.0));
              float bar = step(0.96, hash(vec2(bslot, 16.0))) * (1.0 - smoothstep(bh * 0.6, bh, abs(fuv.y - by))); // about every 6 s
              c = mix(c, vec3(sn) * 0.75, clamp(0.05 + burst * 0.65 + bar * 0.7, 0.0, 0.85));
              // and the colour drains out for a moment now and then
              float dslot = floor(time / 5.0), dk = (time - dslot * 5.0 - 4.0 * hash(vec2(dslot, 17.0))) / 0.6;
              float drain = step(0.6, hash(vec2(dslot, 18.0))) * step(0.0, dk) * step(dk, 1.0);
              c = mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), drain * 0.9);
              float rr = length((fuv - vec2(0.18, 0.78)) * vec2(0.7778, 1.0));
              // a magnetised corner (purity gone): a purple stain with a green fringe
              float blot = 1.0 - smoothstep(0.08, 0.42, rr);
              c *= mix(vec3(1.0), mix(vec3(1.5, 0.5, 1.4), vec3(0.75, 1.4, 0.75), smoothstep(0.14, 0.34, rr)), blot);
              c += vec3(0.05, 0.0, 0.05) * blot;                           // the stain shows even where it's dark
              // a failing band at the top: dimmer, with a bright retrace line; and a few dead scanlines
              c *= 1.0 - 0.45 * smoothstep(0.915, 0.93, uv.y);
              c += vec3(0.25, 0.27, 0.3) * (1.0 - smoothstep(0.0, 0.0018, abs(uv.y - 0.925)));
              c *= 1.0 - 0.7 * step(0.988, hash(vec2(floor(uv.y * 288.0), 3.3)));
              c *= 0.82 * (1.0 - 0.4 * halo);
              c = mix(c, c * vec3(1.0, 0.93, 0.8), 0.6);                   // yellowed
            }
          }
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
          // the vector backdrop: after the grain (no shimmer: the author didn't like it), flickering with the beam at
          // half its strength (full strength was jarring on a bright backdrop; none at all, the author missed it)
          c += backdrop * (1.0 - 0.035 * hash(vec2(floor(time * 60.0), 1.0)));
          if (ruin > 0.5) { // the discarded look's glass: grime hazing the picture, then the cracks and specks catching the light
            c *= ruinDim;
            c = mix(c, c * 0.55 + vec3(0.07, 0.062, 0.048), ruinHaze);
            c += ruinLight;
          }
          // glass: glare at the top-right (web edition: moved off the 1UP score), faint dust streak, darkening near the rim
          float gl1 = exp(-pow(length((fuv - (ruin > 0.5 ? vec2(0.2, 0.16) : vec2(0.8, 0.84))) * vec2(1.0, 1.25)) / 0.30, 2.0)); // (discarded: lower left)
          float gl2 = exp(-pow(((1.0 - fuv.x) * 0.9 + fuv.y * 0.55 - 0.78) / 0.05, 2.0)) * 0.5;
          c += vec3(0.85, 0.9, 1.0) * (0.06 * gl1 + 0.018 * gl2);
          c *= 0.62 + 0.38 * smoothstep(-0.16, 0.0, -d);
          // glassy: a thick curved faceplate in front of the tube
          //   broad sheen from a room light, brightest up top and fading down the bulge
          float sheen = smoothstep(-0.1, 1.0, q.y * 0.85 + q.x * 0.35 + 0.15 * (1.0 - dot(q, q)));
          c += vec3(0.78, 0.84, 1.0) * 0.045 * sheen * sheen;
          //   a soft window-shaped reflection with a crisp lower edge, upper right
          vec2 WIN = ruin > 0.5 ? vec2(0.27, 0.2) : vec2(0.73, 0.8); // (the discarded look: lower left, lying on the ground)
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
          bez += r * vec3(0.95, 0.92, 0.88) * (vec > 0.5 ? 0.62 : ruin > 0.5 ? 0.12 : 0.42) * fall * (0.3 + 0.7 * side); // vector: shinier plastic; discarded: grimy
        }
        gl_FragColor = vec4(mix(bez, c, inside), 1.0);
      }`);

    // the bezel's static look (base colour, grain, rim highlight), drawn once per resize into Z; pU reads it back
    const pZ = mk(HDR + `
      uniform vec4 frame; uniform float dpr, tv, vec, ruin;
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float sdBox(vec2 p, vec2 b, float r){ vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
      // the vector look's angular screen: straight edges, the corners cut off at 45 degrees (a vector cabinet's bezel)
      float sdChamfer(vec2 p){ vec2 a = abs(p); return max(max(a.x, a.y) - 1.0, (a.x + a.y - (2.0 - ${VEC_CHAMFER})) * 0.7071); }
      // the discarded look: the whole monitor tilted (screen-relative uv, rotated round the screen's middle; 224:288)
      vec2 tilt(vec2 f){ vec2 p = (f - 0.5) * vec2(0.7778, 1.0); float cs = cos(${RUIN_ANGLE}), sn = sin(${RUIN_ANGLE});
        p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y); return p / vec2(0.7778, 1.0) + 0.5; }
      float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y); }
      float fbm(vec2 p){ return 0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03 + 7.1) + 0.125 * vnoise(p * 4.1 + 3.3) + 0.0625 * vnoise(p * 8.3 + 1.7); }
      // the discarded look's cracks: point i of radial crack k (at set distances out, each a little off the crack's line)
      vec2 crackPt(float k, float i){
        float R = i < 0.5 ? 0.0 : 0.05 * (pow(1.62, i) - 1.0) / 0.62;
        float th = 6.2832 * (k + 0.6 * hash(vec2(k, 1.3))) / 11.0 + (i < 0.5 ? 0.0 : (hash(vec2(k, i + 0.7)) - 0.5) * 0.32);
        return R * vec2(cos(th), sin(th));
      }
      void main(){
        vec2 fuv = (vuv - frame.xy) / frame.zw;
        if (ruin > 0.5) fuv = tilt(fuv);
        vec2 q = fuv * 2.0 - 1.0;
        q *= ${CRT_ZOOM.toFixed(3)};
        q += (q.yx * q.yx) * q * (vec > 0.5 ? vec2(${VEC_BEND}) : vec2(0.04, 0.055)); // vector: nearly flat glass
        float d = vec > 0.5 ? sdChamfer(q) : sdBox(q, vec2(1.0), 0.06);
        // the CRT's dark plastic; the ratty TV's (C key) is the same, just dark brown
        vec3 col = tv > 0.5 ? vec3(0.2, 0.12, 0.065) : vec > 0.5 ? vec3(0.03, 0.03, 0.034) : vec3(0.11, 0.1, 0.086); // TV: 1982 wood-panelling brown; vector: a black cabinet
        float grain = vec > 0.5 ? 1.0 : 0.8 + 0.2 * hash(floor(gl_FragCoord.xy / 2.0)); // vector: smooth, solid plastic
        vec3 bez = col * (0.55 + 0.6 * clamp(fuv.y, -0.15, 1.15)) * grain;
        bez += vec3(0.05) * smoothstep(0.0, 0.05, d) * (1.0 - smoothstep(0.05, 0.1, d));
        if (vec > 0.5) { // smooth, shiny black plastic: the light from above caught in it
          float outside = smoothstep(0.0, 0.004, d);
          float facing = clamp(q.y * 0.6 + 0.4, 0.0, 1.0);                   // top edges 1, sides 0.4, bottom 0
          // the bevel where the plastic turns into the screen: a crisp highlight along it
          float bev = smoothstep(0.004, 0.01, d) * (1.0 - smoothstep(0.016, 0.03, d));
          bez += vec3(0.2, 0.2, 0.22) * bev * (0.2 + 0.8 * facing);
          // a soft gloss band across the top, an overhead light reflected
          float band = exp(-pow((q.y - 1.13) / 0.045, 2.0)) * exp(-pow(q.x / 0.85, 4.0));
          bez += vec3(0.075, 0.075, 0.085) * band * outside;
          // a broad soft streak of light across the side panels, glancing down from the upper left, fading away from the screen
          float panel = smoothstep(1.02, 1.12, abs(q.x)) * exp(-pow((abs(q.x) - 1.0) / 1.8, 2.0));
          float streak = exp(-pow((q.x * 0.45 + q.y * 0.9 - 0.95) / 0.16, 2.0)) + 0.6 * exp(-pow((q.x * 0.45 + q.y * 0.9 + 0.55) / 0.1, 2.0));
          bez += vec3(0.055, 0.055, 0.062) * streak * panel;
          // 80s flair: two thin neon tubes following the screen's shape, each with a soft glow: green just outside the
          // bevel (it goes with the blue maze), and a dark fuchsia one shadowing it, a little further out and dimmer
          float nd = abs(d - 0.045), nd2 = abs(d - 0.07);
          vec3 NEON = vec3(0.2, 0.95, 0.22), NEON2 = vec3(0.62, 0.1, 0.55);
          bez += NEON * (0.4 * (1.0 - smoothstep(0.0015, 0.0045, nd)) + 0.14 * exp(-nd / 0.012) + 0.05 * exp(-nd / 0.05));
          bez += NEON2 * (0.42 * (1.0 - smoothstep(0.0015, 0.0045, nd2)) + 0.12 * exp(-nd2 / 0.012) + 0.04 * exp(-nd2 / 0.05));
        }
        if (ruin > 0.5) {
          // discarded: the monitor's own grimy, scuffed plastic only so far (bd < 0); round it, the floor of a ruin:
          // dusty concrete and dirt, rocks, a few shards of glass, the monitor's shadow
          vec2 pp = gl_FragCoord.xy / max(dpr, 1.0);                       // css px, the window's own (untilted)
          float bd = sdBox(q, vec2(1.17, 1.12), 0.1);
          float scuff = fbm(q * 9.0) * 0.5 + 0.5 * step(0.985, vnoise(vec2(q.x * 3.0 + q.y * 9.0, q.y * 140.0)));
          vec3 plastic = vec3(0.2, 0.045, 0.04) * (0.6 + 0.5 * clamp(fuv.y, -0.15, 1.15)) * (0.75 + 0.35 * scuff); // dark red (the author)
          plastic += vec3(0.07) * smoothstep(-0.02, 0.0, bd) * (1.0 - smoothstep(0.0, 0.01, bd)) * clamp(q.y * 0.4 + 0.6, 0.0, 1.0); // its edge
          bez = mix(bez, plastic, 0.85) * vec3(1.0, 0.97, 0.9);
          vec3 ground = vec3(0.15, 0.135, 0.11) * (0.55 + 0.6 * fbm(pp / 140.0)) * (0.85 + 0.25 * vnoise(pp / 9.0)) * (0.9 + 0.2 * hash(floor(pp / 1.5)));
          ground = mix(ground, vec3(0.1, 0.085, 0.07), smoothstep(0.55, 0.8, fbm(pp / 60.0 + 9.0)) * 0.6); // patches of dirt
          // rocks: one maybe per cell, a lumpy disc shaded by a light from the upper left, with a shadow to the lower right
          float rockA = 0.0, shadow = 0.0; vec3 rock = vec3(0.0);
          for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
            vec2 cell = floor(pp / 64.0) + vec2(float(i), float(j));
            float h = hash(cell * 1.7 + 0.3);
            float clump = fbm(cell * 0.23 + 4.0);                          // rubble gathers in some places, not others
            if (h < 0.95 - clump * 1.1) continue;                          // (more rubble: the author)
            vec2 pt = (cell + 0.15 + 0.7 * vec2(hash(cell + 5.1), hash(cell + 9.7))) * 64.0;
            float sz = hash(cell + 2.2);
            float rad = 3.0 + 9.0 * sz + 26.0 * pow(hash(cell + 3.3), 4.0); // mostly pebbles and stones, a few big chunks
            // a broken chunk: a jagged polygon (the furthest of 7 planes round it), with a flat top and flat side faces
            vec2 rel = (pp - pt) / rad, srel = rel - vec2(0.35, -0.35);
            float dd = -1.0, sd = -1.0; vec2 face = vec2(0.0);
            for (int k = 0; k < 7; k++) {
              float fk = float(k), ak = 6.2832 * fk / 7.0 + h * 9.0 + 0.5 * hash(cell + fk);
              vec2 dk = vec2(cos(ak), sin(ak)); float reach = 0.7 + 0.45 * hash(cell * 3.1 + fk);
              float pk = dot(rel, dk) / reach;
              if (pk > dd) { dd = pk; face = dk; }
              sd = max(sd, dot(srel, dk) / reach);
            }
            shadow = max(shadow, 1.0 - smoothstep(0.9, 1.2, sd));
            if (dd < 1.0) {
              vec3 L = normalize(vec3(-0.55, 0.6, 0.6));
              vec3 n = dd < 0.5 + 0.2 * hash(cell + 1.1) ? vec3(0.0, 0.0, 1.0) : normalize(vec3(face * 0.9, 0.45)); // top, or a side
              float lit = clamp(dot(n, L), 0.0, 1.0);
              vec3 tone = mix(vec3(0.25, 0.235, 0.215), vec3(0.3, 0.27, 0.22), hash(cell + 7.7));
              rock = tone * (0.2 + 0.9 * lit) * (0.82 + 0.3 * vnoise(pp / 2.5 + h * 50.0));
              rock *= 1.0 - 0.45 * (1.0 - smoothstep(0.0, 0.06, 1.0 - dd));        // a dark rim
              rockA = 1.0;
            }
          }
          ground *= 1.0 - 0.55 * shadow * (1.0 - rockA);
          ground = mix(ground, rock, rockA);
          // shards of glass on the ground: small, rare, catching the light
          vec2 sc = floor(pp / 23.0);
          if (hash(sc + 0.7) > 0.985) {
            vec2 sp = pp - (sc + 0.5) * 19.0; float sa = hash(sc + 1.9) * 6.28;
            sp = vec2(cos(sa) * sp.x - sin(sa) * sp.y, sin(sa) * sp.x + cos(sa) * sp.y);
            float tri = max(abs(sp.x) * 0.87 + sp.y * 0.5, -sp.y) - 1.5 - 1.5 * hash(sc + 4.4);
            float glint = step(0.8, hash(sc + 6.6));                        // most are dull; now and then one catches the light
            ground = mix(ground, vec3(0.3, 0.31, 0.32) * (0.6 + 0.3 * hash(sc + 8.8)) + vec3(0.35) * glint, (1.0 - smoothstep(-0.5, 0.5, tri)) * (1.0 - rockA) * 0.8);
          }
          // (soda cans and wrappers were tried: they looked like pills and hexagons, so they went)
          // the monitor's shadow on the ground, to the lower right
          float sh = sdBox(q - vec2(0.07, -0.09), vec2(1.17, 1.12), 0.1);
          ground *= 0.45 + 0.55 * smoothstep(-0.02, 0.22, sh);
          ground *= 0.75;                                                   // dim, so the game stays the thing to look at
          bez = mix(bez, ground, smoothstep(-0.004, 0.004, bd));
        }
        gl_FragColor = vec4(bez, 1.0);
      }`);

    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const newTex = (filter) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); return t; };
    const srcTex = newTex(gl.LINEAR), maskTex = newTex(gl.NEAREST), backTex = newTex(gl.LINEAR);
    let backImg = null; // the picture backTex holds
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
      webgl: true, ultra: true, zoom: CRT_ZOOM, vecBend: VEC_BEND_XY, ruinAngle: RUIN_ANGLE,
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
          gl.uniform1f(p.u("tv"), getConfig().crtEffect === "tv" ? 1 : 0); gl.uniform1f(p.u("vec"), getConfig().crtEffect === "vector" ? 1 : 0); gl.uniform1f(p.u("ruin"), getConfig().crtEffect === "discarded" ? 1 : 0); });
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
          let pic, bdImg = null, vfilm = false;
          if (vec) { // the beam's afterglow fades by time, not by frame (same trails at 60 or 144 Hz)
            const nxt = 1 - vh, film = smoothNow(); vfilm = film;
            if (textMask) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, maskTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textMask); }
            bdImg = film ? null : getBackdrop();
            if (bdImg && (bdImg !== backImg || bdImg.living)) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, backTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bdImg); backImg = bdImg; }
            pass(pV, VH[nxt], (p) => { gl.uniform1i(p.u("mask"), 2); gl.uniform2f(p.u("srcSize"), source.width, source.height); gl.uniform1f(p.u("decay"), film ? 0 : Math.pow(0.8, dt * 60)); gl.uniform1f(p.u("film"), film ? 1 : 0); }, srcTex, VH[vh].t, maskTex);
            vh = nxt; pic = VH[vh].t;
          } else {
            const nxt = 1 - ph;
            pass(pH, PH[nxt], (p) => gl.uniform1f(p.u("decay"), 0.58), srcTex, PH[ph].t);
            ph = nxt; pic = PH[ph].t;
          }
          pass(pU, A, (p) => { gl.uniform2f(p.u("res"), cw, ch); gl.uniform4f(p.u("frame"), fr[0], fr[1], fr[2], fr[3]); gl.uniform4f(p.u("zmap"), ...zmap); gl.uniform1f(p.u("tv"), getConfig().crtEffect === "tv" ? 1 : 0); gl.uniform1f(p.u("vec"), vec ? 1 : 0); gl.uniform1f(p.u("ruin"), getConfig().crtEffect === "discarded" ? 1 : 0); gl.uniform1f(p.u("time"), time); gl.uniform1f(p.u("dpr"), dpr); gl.uniform1f(p.u("hourAngle"), hourAngle()); gl.uniform1i(p.u("back"), 2); gl.uniform1f(p.u("backOn"), bdImg ? 1 : 0); }, pic, Z.t, backTex);
          pass(pT, B1, (p) => gl.uniform1f(p.u("minLuma"), vec && !vfilm ? 0.3 : 0.72), A.t);
          pass(pB, B2, (p) => { gl.uniform2f(p.u("dir"), 1 / BW, 0); gl.uniform1f(p.u("sigma"), 3.5); }, B1.t);
          pass(pB, B1, (p) => { gl.uniform2f(p.u("dir"), 0, 1 / BH); gl.uniform1f(p.u("sigma"), 3.5); }, B2.t);
          pass(pF, null, (p) => { gl.uniform3f(p.u("factors"), ...ULTRA_FACTORS); gl.uniform1f(p.u("glowK"), vfilm ? 0 : vec ? 0.48 : 0.55); }, A.t, B1.t);
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
