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
    const setColor = (r, gg, b, a) => { col = [r, gg, b, a === undefined ? 1 : a]; };
    const tmp = document.createElement("canvas"); tmp.width = 16; tmp.height = 16;
    const tctx = tmp.getContext("2d");
    tctx.imageSmoothingEnabled = false;
    const camX = () => -Math.floor(g.startX || 0);
    const camY = () => -Math.floor(g.startY || 0);

    function blit(s, i, x, y, angle, ox, oy) {
      const sx = (i % s.cols) * s.fw, sy = Math.floor(i / s.cols) * s.fh;
      let src = s.img, ssx = sx, ssy = sy;
      const tinted = col[0] !== 1 || col[1] !== 1 || col[2] !== 1;
      if (tinted) {
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
          if (phased >= 0) setColor(Math.random(), Math.random(), Math.random()); else setColor(0.5, 0.5, 0);
        } else if (ab === 2) {
          if (phased >= 0) setColor(0, 1, 0); else setColor(0.5, 0.5, 0);
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
          setColor(0.5, 0.5, 0);
        }
      }
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
      pac() { print("BO", 3, 6, 3, true); print("OZE", 8, 6, 3, true); print("ELR", 17, 6, 3, true); print("OY", 23, 6, 3, true); },
      large1() { print("BO", 8, 6, 3, true); print("OZE", 13, 6, 3, true); print("ELR", 22, 6, 3, true); print("OY", 28, 6, 3, true); },
      booze3() { drawSprite("spr16", 91, 88, 55, true); drawSprite("spr16", 15, 103, 56, true); drawSprite("spr16", 2, 120, 57, true); },
    };

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

    function drawParticles() {
      for (const p of g.particles) {
        const alpha = p.alpha !== undefined ? p.alpha : 1;
        const c = p.colors;
        ctx.fillStyle = `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${alpha})`;
        ctx.beginPath(); ctx.arc(-g.startX + p.x, -g.startY + p.y + 24, p.size, 0, Math.PI * 2); ctx.fill();
      }
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
      if (g.highScore) print(core.formatScore(g.highScore), 10, 1);
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
        if (g.highScore) print(core.formatScore(g.highScore), 10, 1);
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
      if (g.state.showPac) drawChar(g.chars.pac, g.chars.pac.x, g.chars.pac.y, g.chars.pac.phased, true);
      if (g.state.showGhosts) {
        for (const name of core.charKeys()) { const c = g.chars[name]; if (c.target && !c.hidden) drawChar(c, c.x, c.y, false, true); }
      }
      ctx.restore();

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
    function drawIntermission3() {
      const t = g.modeTimer, v = assets.video;
      if (t <= 780 && t > 300 && core.mode.isStarted("intermission3") && v && v.readyState >= 2) {
        const w = 1024 * 0.47, h = 576 * 0.47;
        ctx.drawImage(v, -129, 0, w, h);
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
      print("AUDIO/VIDEO", 3, 23, 3);
      [["Background", 24], ["Maze Style", 25], ["CRT Effect", 26], ["sfx volume", 27]].forEach((r) => print(r[0], 3, r[1]));
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
    // endless, ghostly marquee along the bottom; links to the substack
    const PHRASE = "form is emptiness is ";
    function scrollMessage() {
      const t = performance.now() / 16.67, off = (t * 0.3) % (PHRASE.length * 8);
      const k0 = Math.floor(off / 8), k1 = Math.floor((off + 224) / 8) + 1;
      for (let k = k0; k <= k1; k++) {
        const px = Math.round(k * 8 - off);
        if (px < -8 || px > 224) continue;
        const edge = Math.max(0, Math.min(1, (px + 8) / 48, (224 - px) / 48));
        const a = (0.2 + 0.3 * (0.5 + 0.5 * Math.sin(t * 0.05 + k * 0.55))) * edge;
        const y = 34 * 8 + Math.round(Math.sin(t * 0.04 + k * 0.7) * 1.5);
        setColor(1, 1, 1, a);
        print(PHRASE[k % PHRASE.length], px / 8, y / 8, [3, 2, 0][(k + Math.floor(t / 40)) % 3]);
      }
      setColor(1, 1, 1);
    }
    const LINKS = [
      { x0: 80, y0: 84, x1: 144, y1: 100, url: "mailto:bparrish99@gmail.com" },
      { x0: 0, y0: 264, x1: 224, y1: 284, url: "https://pinback.substack.com" },
    ];
    const creditsLinks = () => (g.scene.name === "credits" ? LINKS : []);

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

    // clickable rows of the current menu, in game pixels (mirrors drawMenu's placement)
    function menuLayout() {
      const scene = g.scene.name;
      let spec = null;
      if (scene === "attract") { if (g.state && g.state.showHelperText) spec = [core.attractMenu, 6, 23, 1]; }
      else if (scene === "options") spec = [core.optMenu, 18, 5, 1];
      else if (scene === "credits") spec = [core.creditsMenu, 12, 27, 2];
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

    function draw() {
      ctx.globalAlpha = 1;
      const scene = g.scene.name;
      if (scene === "game") drawGame();
      else if (scene === "attract") drawAttract();
      else if (scene === "options") drawOptions();
      else if (scene === "credits") drawCredits();
      else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, GW, GH); print(scene, 2, 2, 0); }
    }

    return { screen, draw, print, drawSprite, drawChar, ctx, GW, GH, menuLayout, creditsLinks };
  }

  // =============================================================== presenter: normal CRT + "MAX" CRT (non-canon)
  function createPresenter(canvas, source, getConfig) {
    let gl = null;
    try { gl = canvas.getContext("webgl", { alpha: false, antialias: false, preserveDrawingBuffer: true }); } catch (e) { /* fall through */ }
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
    const pP = mk(HDR + `void main(){ gl_FragColor = vec4(texture2D(tex, vuv).rgb, 1.0); }`);
    // phosphor persistence: new = max(source, previous * decay)
    const pH = mk(HDR + `uniform sampler2D prev; uniform float decay;
      void main(){ vec3 s = texture2D(tex, vuv).rgb; vec3 p = texture2D(prev, vuv).rgb * decay; gl_FragColor = vec4(max(s, p), 1.0); }`);
    // the MAX CRT: heavy barrel, rounded glass, RGB convergence error, horizontal bleed, beam-width scanlines,
    // aperture-grille triads, vignette, mains flicker, rolling hum bar, tracking glitches, static grain, glass glare, plastic bezel
    const pU = mk(HDR + `
      uniform vec2 res; uniform float time, dpr;
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float sdBox(vec2 p, vec2 b, float r){ vec2 d = abs(p) - b + r; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r; }
      vec3 samp(vec2 uv, vec2 off){
        float dx = 1.0 / 448.0;
        vec3 a = texture2D(tex, uv + off + vec2(-dx, 0.0)).rgb;
        vec3 b = texture2D(tex, uv + off).rgb;
        vec3 c = texture2D(tex, uv + off + vec2(dx, 0.0)).rgb;
        return a * 0.1 + b * 0.8 + c * 0.1;
      }
      void main(){
        vec2 q = vuv * 2.0 - 1.0;
        q *= 1.035;
        q += (q.yx * q.yx) * q * vec2(0.04, 0.055);
        float d = sdBox(q, vec2(1.0), 0.06);
        float inside = 1.0 - smoothstep(-0.004, 0.012, d);
        vec2 uv = (q + 1.0) * 0.5;
        float ty = 1.0 - uv.y;
        float tick = floor(time * 7.0);
        // RGB convergence error grows toward the edges
        vec2 ca = q * 0.003;
        vec3 c;
        c.r = samp(uv, ca).r; c.g = samp(uv, vec2(0.0)).g; c.b = samp(uv, -ca).b;
        // scanlines: bright beams widen and fill the gap, dim ones leave dark lines
        float lum = dot(c, vec3(0.299, 0.587, 0.114));
        float v = fract(uv.y * 288.0);
        float w = mix(0.22, 0.62, clamp(lum * 1.2, 0.0, 1.0));
        float prof = exp(-pow((v - 0.5) / w, 2.0) * 1.7);
        c *= 0.12 + 1.05 * prof;
        // aperture grille triads (in css px)
        float px = floor(gl_FragCoord.x / max(dpr, 1.0));
        float t3 = mod(px, 3.0);
        vec3 m = vec3(step(abs(t3 - 0.0), 0.5), step(abs(t3 - 1.0), 0.5), step(abs(t3 - 2.0), 0.5));
        c *= 0.62 + 0.62 * m;
        // vignette + brightness
        float vg = 1.0 - 0.55 * pow(length(q * vec2(0.82, 0.74)), 2.6);
        c *= clamp(vg, 0.0, 1.0) * 1.4;
        c = pow(max(c, 0.0), vec3(0.88, 0.88, 0.8));   // lift shadows, blues most
        // mains flicker, rolling hum bar
        c *= 1.0 - 0.05 * hash(vec2(floor(time * 60.0), 1.0));
        c *= 1.0 + 0.1 * pow(0.5 + 0.5 * sin(6.2832 * (ty * 1.0 - time * 0.09)), 10.0);
        // static grain + sparse bright speckles
        float n = hash(gl_FragCoord.xy + fract(time) * 91.7);
        c += (n - 0.5) * 0.075;
        // glass: glare at the top-left, faint dust streak, darkening near the rim
        float gl1 = exp(-pow(length((vuv - vec2(0.2, 0.84)) * vec2(1.0, 1.25)) / 0.30, 2.0));
        float gl2 = exp(-pow((vuv.x * 0.9 + vuv.y * 0.55 - 0.78) / 0.05, 2.0)) * 0.5;
        c += vec3(0.85, 0.9, 1.0) * (0.06 * gl1 + 0.018 * gl2);
        c *= 0.62 + 0.38 * smoothstep(-0.16, 0.0, -d);
        // plastic bezel outside the glass
        vec3 bez = vec3(0.075, 0.068, 0.058) * (0.55 + 0.6 * vuv.y) * (0.8 + 0.2 * hash(floor(gl_FragCoord.xy / 2.0)));
        bez += vec3(0.05) * smoothstep(0.0, 0.05, d) * (1.0 - smoothstep(0.05, 0.1, d));
        gl_FragColor = vec4(mix(bez, c, inside), 1.0);
      }`);

    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const newTex = (filter) => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter); return t; };
    const srcTex = newTex(gl.LINEAR);
    const mkTarget = (w, h) => { const t = newTex(gl.LINEAR); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); return { t, f, w, h }; };
    let A = null, B1 = null, B2 = null, PH = null, ph = 0, cw = 0, ch = 0, cssH = 864, dpr = 1;
    const BW = 448, BH = 576;
    const pass = (prog, target, setup, ...texs) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.f : null);
      gl.viewport(0, 0, target ? target.w : cw, target ? target.h : ch);
      gl.useProgram(prog);
      texs.forEach((t, i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); });
      gl.uniform1i(prog.u("tex"), 0);
      if (texs.length > 1) { gl.uniform1i(prog.u("glow"), 1); gl.uniform1i(prog.u("prev"), 1); }
      if (setup) setup(prog);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const api = {
      webgl: true, ultra: true,
      resize(w, h, cssHeight) {
        canvas.width = w; canvas.height = h; cw = w; ch = h; cssH = cssHeight || h; dpr = h / cssH;
        A = mkTarget(w, h); B1 = mkTarget(BW, BH); B2 = mkTarget(BW, BH); PH = [mkTarget(BW, BH), mkTarget(BW, BH)];
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      },
      present() {
        if (!A) return;
        const crtOn = !!getConfig().crtEffect;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, srcTex);
        const f = (crtOn && !api.ultra) ? gl.LINEAR : gl.NEAREST;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        if (!crtOn) { pass(pP, null, null, srcTex); return; }
        const time = performance.now() / 1000;
        if (api.ultra) {
          const nxt = 1 - ph;
          pass(pH, PH[nxt], (p) => gl.uniform1f(p.u("decay"), 0.58), srcTex, PH[ph].t);
          ph = nxt;
          pass(pU, A, (p) => { gl.uniform2f(p.u("res"), cw, ch); gl.uniform1f(p.u("time"), time); gl.uniform1f(p.u("dpr"), dpr); }, PH[ph].t);
          pass(pT, B1, (p) => gl.uniform1f(p.u("minLuma"), 0.72), A.t);
          pass(pB, B2, (p) => { gl.uniform2f(p.u("dir"), 1 / BW, 0); gl.uniform1f(p.u("sigma"), 3.5); }, B1.t);
          pass(pB, B1, (p) => { gl.uniform2f(p.u("dir"), 0, 1 / BH); gl.uniform1f(p.u("sigma"), 3.5); }, B2.t);
          pass(pF, null, (p) => { gl.uniform3f(p.u("factors"), 1.08, 1.08, 1.25); gl.uniform1f(p.u("glowK"), 0.55); }, A.t, B1.t);
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
