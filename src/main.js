/* Booze Elroy - browser glue: asset loading, input, fixed-timestep loop, CRT presentation. */
(function () {
  "use strict";
  const A = window.BOOZE_ASSETS;           // { data, images:{name:dataURI}, sounds:{name:b64}, backgrounds:{name:dataURI} }
  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const KEYMAP = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down", Enter: "return", NumpadEnter: "return",
    Escape: "escape", Space: "space", Backspace: "backspace", Tab: "tab", KeyA: "a", KeyD: "d", KeyW: "w", KeyS: "s", KeyZ: "z", KeyQ: "q" };
  for (let c = 65; c <= 90; c++) { const l = String.fromCharCode(c); KEYMAP["Key" + l] = KEYMAP["Key" + l] || l.toLowerCase(); }
  for (let d = 0; d <= 9; d++) KEYMAP["Digit" + d] = String(d);
  KEYMAP.F11 = null; KEYMAP.AltLeft = "lalt";

  async function start() {
    const down = {};
    const audio = BoozeAudio.createAudio(A.sounds);
    const hsKey = "booze-elroy-highscore";
    let hs = 0; try { hs = parseInt(localStorage.getItem(hsKey) || "0", 10) || 0; } catch { /* ignore */ }
    // xorshift-free: normal Math.random in the browser
    // intermission 3 plays a short video (with sound); core calls video.play()/stop()
    let videoEl = null, videoPrimed = false;
    if (A.video) {
      videoEl = document.createElement("video");
      // candidate sources, tried in order if the browser reports a media error (format/CSP differences between hosts)
      const mkBlob = (uri, type) => { const bin = Uint8Array.from(atob(uri.split(",")[1]), (c) => c.charCodeAt(0)); return URL.createObjectURL(new Blob([bin], { type })); };
      const cands = [];
      const add = (uri, type, label) => { if (!uri) return; cands.push({ label: label + " blob", get: () => mkBlob(uri, type) }); cands.push({ label: label + " data", get: () => uri }); };
      const canMp4 = !!videoEl.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"');
      if (canMp4) { add(A.video, "video/mp4", "mp4"); add(A.videoWebm, "video/webm", "webm"); }
      else { add(A.videoWebm, "video/webm", "webm"); add(A.video, "video/mp4", "mp4"); }
      let ci = 0;
      const tryNext = () => {
        if (ci >= cands.length) return;
        const c = cands[ci++];
        try { videoEl.src = c.get(); videoEl.load(); } catch (e) { tryNext(); }
        videoEl.dataset.src = c.label;
      };
      videoEl.preload = "auto"; videoEl.playsInline = true; videoEl.loop = false;
      videoEl.addEventListener("error", () => {
        const er = videoEl.error;
        console.warn("intermission video error (" + videoEl.dataset.src + ") code=" + (er && er.code) + " msg=" + (er && er.message));
        tryNext();
      });
      tryNext();
    }
    // browsers only let a media element start from script once it has been played during a user gesture
    function primeVideo() {
      if (!videoEl || videoPrimed) return;
      videoPrimed = true;
      videoEl.muted = true;
      const pr = videoEl.play();
      const done = () => { try { videoEl.pause(); videoEl.currentTime = 0; } catch { /* ignore */ } videoEl.muted = false; };
      if (pr && pr.then) pr.then(done, () => { videoPrimed = false; videoEl.muted = false; }); else done();
    }
    const video = {
      play() {
        if (!videoEl) return;
        try {
          videoEl.currentTime = 0; videoEl.muted = false;
          videoEl.volume = Math.max(0, Math.min(1, (core.g.config.volume || 0) / 10));
          const pr = videoEl.play();
          if (pr && pr.catch) pr.catch(() => { videoEl.muted = true; const p2 = videoEl.play(); if (p2 && p2.catch) p2.catch(() => {}); });
        } catch { /* ignore */ }
      },
      stop() { if (videoEl) try { videoEl.pause(); } catch { /* ignore */ } },
    };
    const core = BoozeCore.create(A.data, {
      noExit: true, video, rng: Math.random, isDown: (k) => !!down[k], makeSound: audio.makeSound,
      saveHighScore: (s) => { try { localStorage.setItem(hsKey, String(s)); } catch { /* ignore */ } },
      resetHighScore: () => { try { localStorage.removeItem(hsKey); } catch { /* ignore */ } },
      saveConfig: (c) => { try { localStorage.setItem("booze-elroy-options", JSON.stringify(c)); } catch { /* ignore */ } },
      loadConfig: () => { try { return JSON.parse(localStorage.getItem("booze-elroy-options") || "null"); } catch (e) { return null; } },
      setFullscreen: (on) => { try { if (on) document.documentElement.requestFullscreen(); else if (document.fullscreenElement) document.exitFullscreen(); } catch { /* ignore */ } },
    });
    core.T = BoozeCore.T;
    if (hs) core.g.highScore = hs;
    window.__core = core;

    const [spr16, spr8, text8, banner] = await Promise.all(["spr16", "spr8", "text8", "banner"].map((n) => loadImg(A.images[n])));
    const backgrounds = {};
    await Promise.all(Object.keys(A.backgrounds).map(async (n) => { backgrounds[n] = await loadImg(A.backgrounds[n]); }));
    await audio.ready;

    const R = BoozeRender.createRenderer(core, { sprites: { spr16, spr8, text8 }, banner, backgrounds, video: videoEl });
    const canvas = document.getElementById("screen");
    const P = BoozeRender.createPresenter(canvas, R.screen, () => core.g.config);
    function fit() {
      const dpr = window.devicePixelRatio || 1;
      const st = document.getElementById("stage"); const availH = st.clientHeight, availW = st.clientWidth;
      const scale = Math.min(availH / 288, availW / 224);
      const cssW = Math.floor(224 * scale), cssH = Math.floor(288 * scale);
      canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
      P.resize(Math.round(cssW * dpr), Math.round(cssH * dpr), cssH);
    }
    window.addEventListener("resize", fit); fit();

    core.init();
    if (core.g.highScore === undefined && hs) core.g.highScore = hs;

    window.addEventListener("keydown", (e) => {
      const k = KEYMAP[e.code]; if (k === undefined || k === null) return;
      e.preventDefault(); audio.unlock(); primeVideo(); primeVideo();
      if (!down[k]) { down[k] = true; core.keypressed(k); }
    });
    window.addEventListener("keyup", (e) => { const k = KEYMAP[e.code]; if (k) { down[k] = false; e.preventDefault(); } });
    // mouse / touch for the menus (pointer position is mapped back through the CRT barrel distortion)
    function toGame(e) {
      const rc = canvas.getBoundingClientRect();
      const ux = (e.clientX - rc.left) / rc.width, uy = 1 - (e.clientY - rc.top) / rc.height;
      let sx = ux, sy = uy;
      if (core.g.config.crtEffect) {
        let qx = ux * 2 - 1, qy = uy * 2 - 1;
        if (P.ultra) { qx *= 1.035; qy *= 1.035; }
        const kx = P.ultra ? 0.04 : 0.03, ky = P.ultra ? 0.055 : 0.04;
        const nx = qx + qy * qy * qx * kx, ny = qy + qx * qx * qy * ky;
        sx = (nx + 1) / 2; sy = (ny + 1) / 2;
      }
      return { x: sx * 224, y: (1 - sy) * 288 };
    }
    function openUrl(url) { const a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; document.body.appendChild(a); a.click(); a.remove(); }
    function linkAt(e) {
      const ls = R.creditsLinks(); if (!ls.length) return null;
      const p = toGame(e);
      return ls.find((L) => p.x >= L.x0 && p.x < L.x1 && p.y >= L.y0 && p.y < L.y1) || null;
    }
    function rowAt(e) {
      const p = toGame(e);
      return R.menuLayout().find((r) => p.x >= r.x0 && p.x < r.x1 && p.y >= r.y0 && p.y < r.y1) || null;
    }
    canvas.addEventListener("pointermove", (e) => {
      const row = rowAt(e);
      if (linkAt(e)) { canvas.style.cursor = "pointer"; return; }
      canvas.style.cursor = row ? "pointer" : (core.g.scene.name === "game" ? "none" : "default");
      if (row && row.menu.selectedItem !== row.index) { row.menu.selectedItem = row.index; core.g.sounds.wakka1.play(); }
    });
    canvas.addEventListener("pointerdown", (e) => {
      if (gestureStart(e)) return;
      { const L = linkAt(e); if (L) { e.preventDefault(); openUrl(L.url); return; } }
      const row = rowAt(e);
      if (!row) return;
      e.preventDefault();
      row.menu.selectedItem = row.index;
      if (row.hasOptions) core.keypressed(e.button === 2 ? "left" : "right");
      else core.keypressed("return");
    });
    // touch gameplay: swipe = direction (stays latched, like holding a key), tap = ability, two-finger tap = pause
    const touches = new Map(); let touchDir = null, twoFinger = false;
    const setTouchDir = (d) => {
      if (d === touchDir) return;
      if (touchDir) down[touchDir] = false;
      touchDir = d;
      if (d) { down[d] = true; core.keypressed(d); }
    };
    function gestureStart(e) {
      if (e.pointerType === "mouse" || core.g.scene.name !== "game") return false;
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
      if (touches.size === 2 && !twoFinger) { twoFinger = true; core.keypressed("p"); }
      return true;
    }
    function gestureMove(e) {
      const t = touches.get(e.pointerId); if (!t) return;
      const dx = e.clientX - t.x, dy = e.clientY - t.y, TH = 18;
      if (Math.abs(dx) < TH && Math.abs(dy) < TH) return;
      setTouchDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
      t.x = e.clientX; t.y = e.clientY; t.moved = true;
    }
    function gestureEnd(e) {
      const t = touches.get(e.pointerId); if (!t) return;
      touches.delete(e.pointerId);
      if (touches.size === 0) {
        if (!twoFinger && !t.moved && Math.hypot(e.clientX - t.sx, e.clientY - t.sy) < 12 && performance.now() - t.t < 350) core.keypressed("space");
        twoFinger = false;
      }
    }
    canvas.addEventListener("pointermove", gestureMove);
    canvas.addEventListener("pointerup", gestureEnd);
    canvas.addEventListener("pointercancel", gestureEnd);
    canvas.addEventListener("contextmenu", (e) => { if (core.g.scene.name !== "game") e.preventDefault(); });
    // fullscreen: standard page controls (button + F key); the browser's own Esc/F11 handling stays in charge
    const fsBtn = document.getElementById("fs");
    const root = document.documentElement;
    const fsApi = root.requestFullscreen ? { req: () => root.requestFullscreen(), exit: () => document.exitFullscreen(), el: () => document.fullscreenElement }
      : root.webkitRequestFullscreen ? { req: () => root.webkitRequestFullscreen(), exit: () => document.webkitExitFullscreen(), el: () => document.webkitFullscreenElement } : null;
    function toggleFullscreen() {
      if (!fsApi) return;
      try { const pr = fsApi.el() ? fsApi.exit() : fsApi.req(); if (pr && pr.catch) pr.catch(() => {}); } catch { /* ignore */ }
    }
    function syncFsButton() { fsBtn.title = fsApi && fsApi.el() ? "Exit fullscreen (F)" : "Fullscreen (F)"; setTimeout(() => window.dispatchEvent(new Event("resize")), 60); }
    if (fsApi && (document.fullscreenEnabled || document.webkitFullscreenEnabled || true)) {
      fsBtn.classList.add("on");
      fsBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); }, true);
      fsBtn.addEventListener("click", (e) => { e.preventDefault(); toggleFullscreen(); fsBtn.blur(); });
      document.addEventListener("fullscreenchange", syncFsButton);
      document.addEventListener("webkitfullscreenchange", syncFsButton);
      window.addEventListener("keydown", (e) => { if (e.code === "KeyF" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleFullscreen(); } });
    }
    // touch devices have no Esc key: a small button leaves the game / autoplay / sub-screens
    const escBtn = document.getElementById("esc");
    escBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); }, true);
    escBtn.addEventListener("click", (e) => { e.preventDefault(); core.keypressed("escape"); });
    window.addEventListener("blur", () => { for (const k in down) down[k] = false; });
    window.addEventListener("pointerdown", () => { audio.unlock(); primeVideo(); });

    // gamepad (standard mapping): d-pad -> arrows (held), A/start/B -> buttons
    const padPrev = {}, padDown = {};
    function pollPad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const held = { left: false, right: false, up: false, down: false };
      for (const p of pads) {
        if (!p) continue;
        const b = p.buttons;
        if (b[14] && b[14].pressed) held.left = true; if (b[15] && b[15].pressed) held.right = true;
        if (b[12] && b[12].pressed) held.up = true; if (b[13] && b[13].pressed) held.down = true;
        const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
        if (ax < -0.5) held.left = true; if (ax > 0.5) held.right = true; if (ay < -0.5) held.up = true; if (ay > 0.5) held.down = true;
        const names = { 0: "a", 1: "b", 9: "start" };
        for (const i in names) { const pr = b[i] && b[i].pressed; if (pr && !padPrev[i]) core.gamepadpressed(names[i]); padPrev[i] = pr; }
      }
      for (const d in held) {
        if (held[d] && !down[d]) { down[d] = true; padDown[d] = true; core.keypressed(d); }
        else if (!held[d] && padDown[d]) { down[d] = false; padDown[d] = false; }
      }
    }

    let last = performance.now(), acc = 0;
    function frame(now) {
      let dt = (now - last) / 1000; last = now;
      if (dt > 0.1) dt = 0.1;
      acc += dt;
      const step = core.FIXED_DT;
      if (touchDir && ["playerUp", "ready", "dying", "caught", "gameover", "levelAnimation", "intermission1", "intermission2", "intermission3", "destroyed"].includes(core.g.mode)) setTouchDir(null);
      pollPad();
      while (acc >= step) { core.update(); acc -= step; }
      R.draw(); P.present();
      escBtn.classList.toggle("on", core.g.scene.name !== "attract");
      if (core.g.scene.name === "game") canvas.style.cursor = "none";
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    document.getElementById("loading").remove();
  }
  start().catch((e) => { console.error(e); const l = document.getElementById("loading"); if (l) l.textContent = "Error: " + e.message; });
})();
