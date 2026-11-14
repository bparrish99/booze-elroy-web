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
    let muted = false;
    let volume = 60; // the page's volume slider, 0-100, 60 for new players (the game itself plays at a fixed 8: env.fixedVolume)
    try {
      muted = localStorage.getItem("booze-elroy-muted") === "1";
      const v = parseInt(localStorage.getItem("booze-elroy-volume"), 10);
      if (v >= 0 && v <= 100) volume = v;
    } catch { /* ignore */ }
    const masterGain = () => muted ? 0 : (volume / 100) ** 2; // squared: the slider feels even to the ear
    const filmVolume = () => Math.max(0, Math.min(1, (core.g.config.volume || 0) / 10 * masterGain()));
    // maze editor test play (tools/maze-editor; localhost only): ?testmaze plays the maze the editor left in localStorage,
    // whatever maze pack is chosen, offline
    let testMaze = null;
    if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && new URLSearchParams(location.search).has("testmaze")) {
      try {
        const m = JSON.parse(localStorage.getItem("booze-elroy-editor-test"));
        if (m && m.map) { A.data.mazes.editortest = m; A.data.mazeNames.push("editortest"); testMaze = "editortest"; }
      } catch { /* ignore */ }
    }
    // online leaderboard + per-settings high score (only over http(s); a file:// page plays offline)
    let storage = null; try { storage = window.localStorage; } catch { /* ignore */ }
    const LB = BoozeLeaderboard.create({
      storage: storage || { getItem: () => null, setItem() {}, removeItem() {} },
      apiBase: /^https?:$/.test(location.protocol) && !testMaze ? "/api/scores" : null,
      arenaBase: /^https?:$/.test(location.protocol) && !testMaze ? "/api/arenas" : null,
      fetch: (...a) => fetch(...a),
      share: (cfg) => shareConfig(cfg ? "?cfg=" + SK.shareCode(cfg) : null), // the board on show on the Leaderboards page
      shareArena: (id) => shareConfig("?arena=" + id), // link straight to an arena's page
      arenaCreated: () => earned(["planner"]),
      arenaWon: () => earned(["dinner"]),
      arenaPlaced: (p) => ACC.arenaPlaced(p.arena, p.rank, p.score),
      placed: (p) => {
        earned([...(p.rank === 1 && p.isDefault ? ["billy"] : []), ...(p.first ? ["trailblazer"] : [])]);
        // the booze dogs: top 10 on 3 / 5 / 10 / 20 different boards (counted by the server)
        ACC.placedOn(p.key, p.rank, p.score, p.settings).then((n) => { if (n) earned(BoozeAchievements.LIST.filter((a) => a.boards && n >= a.boards).map((a) => a.id)); });
      },
      auth: () => ACC.auth(), // logged in: score posts carry the login (an account's name is only its owner's)
      playerName: () => ACC.name(), // logged in: a top-10 score goes on the board under the account's name, no name entry
    });
    // player accounts (src/account.js): username + password; the corner where 2UP would be logs in / shows the name
    const ACC = BoozeAccount.create({
      storage: storage || { getItem: () => null, setItem() {}, removeItem() {} },
      apiBase: /^https?:$/.test(location.protocol) && !testMaze ? "/api/account" : null,
      fetch: (...a) => fetch(...a),
    });
    const verified = ACC.verify();
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
        try { videoEl.src = c.get(); videoEl.load(); } catch { tryNext(); }
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
          videoEl.currentTime = 0; videoEl.muted = muted;
          videoEl.volume = filmVolume();
          const pr = videoEl.play();
          if (pr && pr.catch) pr.catch(() => { videoEl.muted = true; const p2 = videoEl.play(); if (p2 && p2.catch) p2.catch(() => {}); });
        } catch { /* ignore */ }
      },
      stop() { if (videoEl) try { videoEl.pause(); } catch { /* ignore */ } },
    };
    // share links: ?cfg=<share code> preselects the gameplay settings (only those that pick a leaderboard)
    const SK = BoozeScoreKey;
    let sharedCfg = null;
    try { sharedCfg = SK.configFromCode(new URLSearchParams(location.search).get("cfg")); } catch { /* ignore */ }
    const loadSaved = () => { try { return JSON.parse(localStorage.getItem("booze-elroy-options") || "null"); } catch { return null; } };
    const showToast = (text) => { core.g.toast = { text, until: performance.now() + 2000 }; };
    function shareLink(query) {
      // the real site, except when running locally or on a Netlify deploy/branch preview ("name--site.netlify.app")
      const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) || location.hostname.includes("--");
      const base = /^https?:$/.test(location.protocol) && local ? location.origin + "/" : "https://booze-elroy.com/";
      return base + (query || "?cfg=" + SK.shareCode(core.g.config));
    }
    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
      return legacyCopy(text);
    }
    function legacyCopy(text) {
      const ta = document.createElement("textarea");
      ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand("copy"); } catch { /* ignore */ }
      ta.remove();
      return ok ? Promise.resolve() : Promise.reject(new Error("copy failed"));
    }
    function shareConfig(query) {
      const url = shareLink(typeof query === "string" ? query : null);
      copyText(url).then(() => showToast("link copied to clipboard"), () => { console.log("share link: " + url); showToast("could not copy link"); });
    }

    // secret: the intermission 3 film on its own (cheat "mina" on the menu screens)
    const mina = {
      name: "mina", captureInput: true,
      start(from) { this.from = from || "attract"; this.t = 840; }, // same timeline as intermission 3: 840 frames, film at 780
      update() {
        this.t -= 1;
        if (this.t === 780) video.play();
        if (this.t <= 0) this.end();
      },
      end() { video.stop(); core.setScene(this.from, true); },
      keypressed(k) { if (k === "escape" || k === "return" || k === "space" || k === "backspace") this.end(); },
      gamepadpressed() { this.end(); },
    };
    // cheat codes: letters typed on the menu screens (they do nothing there otherwise)
    const CHEAT_SCENES = ["attract", "options", "credits", "leaderboard", "arenas"];
    const CHEATS = {
      mina: { scenes: CHEAT_SCENES, run() { const from = core.g.scene.name; core.setScene("mina", from); } },
      reset: { scenes: CHEAT_SCENES, run() { openReset(); } }, // admin: reset high scores (asks for the password)
      delete: { scenes: ["arena"], run() { openReset("arena"); } }, // admin: delete the arena on screen (asks for the password)
      xyzzy: { scenes: [...CHEAT_SCENES, "arena"], run() { toggleFps(); } }, // test mode: frame rate, tiles, ghost targets and paths; Pro Mode always
    };
    // the frame-rate readout: off by default, remembered; counted in the frame loop, shown twice a second
    const fpsEl = document.getElementById("fps");
    let fpsOn = false, fpsFrames = 0, fpsAt = 0, fpsText = "", fpsHtml = "";
    try { fpsOn = localStorage.getItem("booze-elroy-fps") === "1"; } catch { /* ignore */ }
    function toggleFps() {
      fpsOn = !fpsOn; fpsFrames = 0; fpsAt = performance.now(); fpsEl.textContent = ""; fpsText = ""; fpsHtml = "";
      try { localStorage.setItem("booze-elroy-fps", fpsOn ? "1" : "0"); } catch { /* ignore */ }
      fpsEl.classList.toggle("on", fpsOn);
      R.setDebug(fpsOn);
    }
    fpsEl.classList.toggle("on", fpsOn);
    let typed = "";
    function cheatKey(e) {
      const sc = core.g.scene.name;
      if (!(CHEAT_SCENES.includes(sc) || sc === "arena") || sc === "attract" && !core.g.state.showHelperText) { typed = ""; return; }
      if (!/^[a-z]$/i.test(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
      typed = (typed + e.key.toLowerCase()).slice(-16);
      for (const code of Object.keys(CHEATS)) if (typed.endsWith(code) && CHEATS[code].scenes.includes(sc)) { typed = ""; CHEATS[code].run(); }
    }

    let rwd = null; // the Rewind ability (rewind.js), made once the core exists
    const core = BoozeCore.create(A.data, {
      testMaze, noExit: true, noAutoplay: true, crtKey: true, fixedVolume: 8, centerMenus: true, creditsInOptions: true, restoreKeepsAV: true, proMode: true, video, rng: Math.random, isDown: (k) => !!down[k], abilityHeld: () => !!(down.space || down.lalt || padAbility || touchHold), makeSound: audio.makeSound,
      scenes: { ...LB.scenes, ...ACC.scenes, mina },
      afterGameOver: (s) => {
        const c = core.g.config, d = core.g.defaultConfig, styled = c.background !== d.background || c.mazeColor !== d.mazeColor;
        const ach = BoozeAchievements.LIST;
        earned(["quarter", ...(LB.inArena() ? ["arena"] : []), ...(styled ? ["stylish"] : []),
          ...ach.filter((a) => a.mode && s >= a.points && c[a.mode.key] === a.mode.value).map((a) => a.id), // points in a mode (house of horrors, ...)
          ...ach.filter((a) => a.score && s >= a.score).map((a) => a.id)]); // clyde / inky / pinky / blinky: the final score
        return LB.afterGameOver(s);
      }, rewind: () => {
        if (!rwd) return;
        const was = rwd.active(); rwd.trigger();
        if (!was && rwd.active() && !core.g.attract && !core.g.autoplay) earned(["kind"]); // be kind (rewind)
      }, testMode: () => fpsOn /* test mode (xyzzy): Pro Mode always */, quitGameTo: () => LB.quitGameTo(), createArena: () => LB.createArena("options"),
      saveHighScore: (s) => LB.saveBest(s),
      saveConfig: (c) => { if (LB.borrowed()) return; try { localStorage.setItem("booze-elroy-options", JSON.stringify(c)); } catch { /* ignore */ } },
      loadConfig: () => (sharedCfg ? Object.assign(loadSaved() || {}, sharedCfg) : loadSaved()),
      shareConfig,
      setFullscreen: (on) => { try { if (on) document.documentElement.requestFullscreen(); else if (document.fullscreenElement) document.exitFullscreen(); } catch { /* ignore */ } },
    });
    core.T = BoozeCore.T;
    rwd = BoozeRewind.create(core);
    LB.attach(core);
    const toast = (text, ms) => { core.g.toast = { text, until: performance.now() + (ms || 2500) }; }; // "\n" for a second line
    ACC.attach({ wakka: () => LB.wakka(), setScene: (n, o) => core.setScene(n, o), toast });
    // achievements just earned share one popup (a game over and the board it lands on add up while it's showing).
    // Earned during a real game (any mode: playing, rewinding, dying, an intermission, game over): saved at once, the
    // popup held until the game is over or left (the author: never on screen mid-game).
    // Nothing is awarded before the account's earned list is known (ACC.ready), so an old one never pops up again.
    let unlocked = [], lastScene = null, held = [], run = null, fruitShown = false;
    // (and never over Mina's film: the "mina" scene holds them too)
    const livePlay = () => (core.g.scene.name === "game" && !core.g.attract && !core.g.autoplay) || core.g.scene.name === "mina";
    function earned(ids) {
      // a ghost minimum (src/achievements.js minGhosts): judged on the settings in play now, when it's earned
      ids = ids.filter((id) => { const a = BoozeAchievements.byId(id); return !(a && a.minGhosts && !(core.g.config.ghostCount >= a.minGhosts)); });
      if (!ids.length) return;
      ACC.ready().then(() => earned_(ids));
    }
    function earned_(ids) {
      const got = ids.map((id) => ACC.award(id)).filter(Boolean);
      if (!got.length) return;
      if (livePlay()) { held.push(...got); return; }
      showUnlocked(got);
    }
    function showUnlocked(got) {
      const t = core.g.toast;
      if (!(t && t.unlocked && performance.now() < t.until)) unlocked = [];
      unlocked.push(...got.map((a) => a.name));
      toast((unlocked.length > 1 ? "achievements unlocked" : "achievement unlocked") + "\n" + unlocked.join("\n"), 3500);
      core.g.toast.unlocked = true;
    }
    window.__core = core;
    window.__acc = ACC; // tests: log in / out without the dialog

    const [spr16, spr8, text8, banner] = await Promise.all(["spr16", "spr8", "text8", "banner"].map((n) => loadImg(A.images[n])));
    const backgrounds = {};
    await Promise.all(Object.keys(A.backgrounds).map(async (n) => { backgrounds[n] = await loadImg(A.backgrounds[n]); }));
    await audio.ready;

    const R = BoozeRender.createRenderer(core, { sprites: { spr16, spr8, text8 }, banner, backgrounds, video: videoEl });
    R.setDebug(fpsOn); // test mode: ghost targets and paths
    window.__R = R;
    const canvas = document.getElementById("screen");
    const P = BoozeRender.createPresenter(canvas, R.screen, () => core.g.config, () => R.filmOn());
    // CRT on (WebGL): the bezel fills the window. The live canvas is only the screen plus a margin wide enough for the rim
    // reflections to fade out; the rest of the bezel is a static image on #bezel behind it, drawn once per resize.
    // scr = the screen's rect inside the canvas, in css px
    const MARGIN = 1.163;
    const bezelCanvas = document.getElementById("bezel");
    let scr = { x: 0, y: 0, w: 1, h: 1 }, fullBezel = false, fitLook = null;
    const wantsFullBezel = () => !!(P.webgl && core.g.config && core.g.config.crtEffect);
    function fit() {
      const dpr = window.devicePixelRatio || 1;
      const st = document.getElementById("stage"); const availH = st.clientHeight, availW = st.clientWidth;
      const scale = Math.min(availH / 288, availW / 224);
      const cssW = Math.floor(224 * scale), cssH = Math.floor(288 * scale);
      fullBezel = wantsFullBezel(); fitLook = core.g.config && core.g.config.crtEffect; // the bezel is baked per look
      const cw = fullBezel ? Math.min(availW, Math.round(cssW * MARGIN)) : cssW, chh = fullBezel ? Math.min(availH, Math.round(cssH * MARGIN)) : cssH;
      const left = Math.round((availW - cw) / 2), top = Math.round((availH - chh) / 2);
      canvas.style.width = cw + "px"; canvas.style.height = chh + "px";
      canvas.style.position = fullBezel ? "absolute" : ""; canvas.style.left = fullBezel ? left + "px" : ""; canvas.style.top = fullBezel ? top + "px" : "";
      scr = { x: (cw - cssW) / 2, y: (chh - cssH) / 2, w: cssW, h: cssH };
      const W = Math.round(availW * dpr), H = Math.round(availH * dpr);
      const bg = P.resize(Math.round(cw * dpr), Math.round(chh * dpr), chh, { x: scr.x / cw, y: scr.y / chh, w: cssW / cw, h: cssH / chh },
        fullBezel ? { w: W, h: H, x: Math.round(left * dpr), y: Math.round(top * dpr) } : null);
      if (bg) { bezelCanvas.width = W; bezelCanvas.height = H; bezelCanvas.getContext("2d").putImageData(bg, 0, 0); }
      bezelCanvas.style.display = bg ? "block" : "none";
    }
    let fitQueued = false;
    window.addEventListener("resize", () => { if (!fitQueued) { fitQueued = true; requestAnimationFrame(() => { fitQueued = false; fit(); }); } });
    fit();

    core.init();
    // logged in: any arena won since last time (chicken dinner) shows up in the arena list
    verified.then(() => { if (ACC.name()) LB.loadArenas(true); });
    // ?arena=<id>: a shared arena link opens that arena's page
    {
      const arenaId = new URLSearchParams(location.search).get("arena");
      if (arenaId) {
        try { history.replaceState(null, "", location.pathname + location.hash); } catch { /* ignore */ }
        if (/^[a-z0-9]{10}$/.test(arenaId)) LB.openArena(arenaId);
      }
    }
    if (sharedCfg) {
      // keep the shared settings as the player's own, and drop ?cfg so a reload doesn't undo later changes
      try { localStorage.setItem("booze-elroy-options", JSON.stringify(core.g.config)); } catch { /* ignore */ }
      try { history.replaceState(null, "", location.pathname + location.hash); } catch { /* ignore */ }
    }

    // Reset High Scores: opened by the cheat "reset" on a menu screen (no menu item); wipes the online boards,
    // the password is checked by the server
    const rs = document.getElementById("reset"), rsForm = rs.querySelector("form"), rsMsg = rs.querySelector(".msg");
    // typing into a dialog (reset, account), or the game popped out into its own window: no hotkeys, no game keys
    let poppedOut = false; // the game is playing in the pop-out window (below)
    const dialogOpen = () => poppedOut || !!document.querySelector("dialog[open]");
    // the same dialog deletes an arena (cheat "delete" on an arena's page): rsMode "reset" | "arena"
    let rsMode = "reset";
    function openReset(mode) {
      if (typeof rs.showModal !== "function") return;
      for (const k in down) down[k] = false;
      rsMode = mode === "arena" ? "arena" : "reset";
      const arena = rsMode === "arena" ? LB.currentArena() : null;
      if (rsMode === "arena" && !arena) return;
      rs.querySelector("h2").textContent = arena ? "DELETE ARENA" : "RESET HIGH SCORES";
      const what = rs.querySelector(".what"); what.hidden = !arena; what.textContent = arena ? arena.name : "";
      for (const l of rs.querySelectorAll(".scope")) l.hidden = !!arena;
      rs.querySelector("button[value=reset]").textContent = arena ? "Delete" : "Reset";
      rsMsg.textContent = ""; rsForm.reset();
      rs.showModal();
    }
    rsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (e.submitter && e.submitter.value === "cancel") { rs.close(); return; }
      const pw = rsForm.elements.password.value;
      if (!pw) { rsMsg.textContent = "Enter the password."; return; }
      rsMsg.textContent = rsMode === "arena" ? "Deleting…" : "Resetting…";
      const res = rsMode === "arena" ? await LB.deleteArena(pw) : await LB.reset(pw, rsForm.elements.scope.value === "all");
      if (res.ok) { rsMsg.textContent = "Done."; setTimeout(() => rs.close(), 900); }
      else rsMsg.textContent = res.status === 403 ? "Wrong password." : res.status === 503 ? "Reset isn't set up on the server." : res.status === 0 ? "Can't reach the leaderboard server." : "Reset failed (" + res.status + ").";
    });
    rs.addEventListener("close", () => canvas.focus && canvas.focus());

    // account dialog (logged out): "login" | "signup". Logged in, the corner opens the profile page instead
    R.setAccount(ACC.name, ACC.online);
    const ac = document.getElementById("account"), acForm = ac.querySelector("form"), acMsg = ac.querySelector(".msg");
    const acSwitch = ac.querySelector(".switch a");
    let acMode = "login", acBusy = false;
    function setAcMode(mode) {
      acMode = mode;
      ac.querySelector("h2").textContent = mode === "signup" ? "CREATE ACCOUNT" : "LOG IN";
      ac.querySelector(".confirm").hidden = mode !== "signup";
      acForm.elements.password.autocomplete = mode === "signup" ? "new-password" : "current-password";
      acForm.querySelector("button.go").textContent = mode === "signup" ? "Create" : "Log in";
      acSwitch.textContent = mode === "signup" ? "I have an account: log in" : "Create an account";
      acMsg.textContent = "";
    }
    function openAccount() {
      const sc = core.g.scene.name;
      if (sc === "nameEntry" || sc === "profile") return; // don't walk out of a name entry
      if (ACC.name()) { LB.wakka(); core.setScene("profile"); return; }
      if (typeof ac.showModal !== "function" || ac.open) return;
      for (const k in down) down[k] = false;
      acForm.reset(); setAcMode("login");
      LB.wakka(); ac.showModal();
    }
    acSwitch.addEventListener("click", (e) => { e.preventDefault(); setAcMode(acMode === "signup" ? "login" : "signup"); acForm.elements.name.focus(); });
    acForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (acBusy) return;
      if (e.submitter && e.submitter.value === "cancel") { ac.close(); return; }
      const f = acForm.elements, name = SK.cleanName(f.name.value), pw = f.password.value;
      if (!name) { acMsg.textContent = f.name.value.trim() ? "Names use letters, digits, spaces and ! - / (up to 16)." : "Enter a username."; return; }
      if (acMode === "signup" && pw.length < 4) { acMsg.textContent = "Passwords need at least 4 characters."; return; }
      if (acMode === "signup" && pw !== f.password2.value) { acMsg.textContent = "The passwords don't match."; return; }
      if (!pw) { acMsg.textContent = "Enter your password."; return; }
      acBusy = true; acMsg.textContent = acMode === "signup" ? "Creating…" : "Logging in…";
      const res = acMode === "signup" ? await ACC.signup(name, pw) : await ACC.login(name, pw);
      acBusy = false;
      if (res.ok) { ac.close(); toast("welcome " + ACC.name().toLowerCase()); LB.loadArenas(true); return; }
      acMsg.textContent = res.status === 409 ? "That name is taken." : res.status === 403 ? "Wrong username or password." : res.status === 0 ? "Can't reach the server." : "That didn't work (" + res.status + ").";
    });
    ac.addEventListener("close", () => canvas.focus && canvas.focus());
    const accountAt = (e) => { const B = R.accountBox(); if (!B) return null; const p = toGame(e); return p.x >= B.x0 && p.x < B.x1 && p.y >= B.y0 && p.y < B.y1 ? B : null; };

    window.addEventListener("keydown", (e) => {
      if (dialogOpen()) return;
      cheatKey(e);
      // name entry takes typed characters as they are (shifted symbols included)
      if (core.g.scene.name === "nameEntry" && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); core.keypressed(e.key); return;
      }
      const k = KEYMAP[e.code]; if (k === undefined || k === null) return;
      // M in a game is the page's mute (below), in step with the volume control; the core's own M (the Lua's, which
      // zeroed the game volume) never sees it, or the two mutes would drift apart
      if (k === "m" && core.g.scene.name === "game") { e.preventDefault(); return; }
      e.preventDefault(); audio.unlock(); primeVideo(); primeVideo();
      if (!down[k]) { down[k] = true; core.keypressed(k); }
    });
    window.addEventListener("keyup", (e) => { const k = KEYMAP[e.code]; if (k) { down[k] = false; e.preventDefault(); } });
    // mouse / touch for the menus (pointer position is mapped back through the CRT barrel distortion)
    function toGame(e) {
      const rc = canvas.getBoundingClientRect();
      const ux = (e.clientX - rc.left - scr.x) / scr.w, uy = 1 - (e.clientY - rc.top - scr.y) / scr.h;
      let sx = ux, sy = uy;
      if (core.g.config.crtEffect) {
        let qx = ux * 2 - 1, qy = uy * 2 - 1;
        if (P.ultra) { const z = P.zoom || 1.035; qx *= z; qy *= z; }
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
      tipRow = row && row.menu === core.optMenu ? row.index : null;
      const acc = accountAt(e); R.setAccountHot(!!acc); accTip = acc ? (acc.name ? "Your profile" : "Log in or create an account") : "";
      const L = linkAt(e);
      if (L && L.tip) showTip(L.tip, e); else if (e.pointerType === "mouse") hideTip(); // touch: a tapped tip stays until the next tap
      if (acc || L) { canvas.style.cursor = L && L.tip ? "help" : "pointer"; return; }
      canvas.style.cursor = row ? "pointer" : "default";
      if (row && row.menu.selectedItem !== row.index) { row.menu.selectedItem = row.index; LB.wakka(); }
    });
    // easter egg: tapping the "OY" block on the maze plays oy.mp3 (doesn't swallow the tap); the attract demo mutes the game, so use the real volume
    const oySnd = audio.makeSound("oy");
    canvas.addEventListener("pointerdown", (e) => {
      { const B = R.oyBlock(), p = toGame(e);
        if (B && p.x >= B.x0 && p.x < B.x1 && p.y >= B.y0 && p.y < B.y1) { earned(["neil"]); audio.unlock(); oySnd.stop(); oySnd.setVolume((core.g.attract && core.g.originalVolume != null ? core.g.originalVolume : core.g.config.volume) / 10); oySnd.play(); } }
      if (accountAt(e)) { e.preventDefault(); audio.unlock(); openAccount(); return; }
      if (gestureStart(e)) return;
      { const L = linkAt(e); if (L && L.tip) { e.preventDefault(); showTip(L.tip, e); return; } hideTip();
        if (L && L.secret) earned([L.secret]); // the credits' "what is seeing this?": time to wake up
        if (L) { e.preventDefault(); if (L.action) L.action(); else if (L.scene) { LB.wakka(); core.setScene(L.scene); } else openUrl(L.url); return; } }
      const row = rowAt(e);
      if (!row) return;
      e.preventDefault();
      row.menu.selectedItem = row.index;
      // a touch only counts as a user gesture (needed for the clipboard) once the finger lifts
      if (e.pointerType !== "mouse" && row.menu[row.index - 1].share) { pendingShareTap = e.pointerId; return; }
      if (row.hasOptions) core.keypressed(e.button === 2 ? "left" : "right");
      else core.keypressed("return");
    });
    // mouse wheel scrolls scrollable pages (the arena list)
    canvas.addEventListener("wheel", (e) => {
      const sc = core.g.scene;
      if (!sc.scrollBy || !e.deltaY) return;
      e.preventDefault(); sc.scrollBy(e.deltaY > 0 ? 2 : -2);
    }, { passive: false });
    let pendingShareTap = null;
    canvas.addEventListener("pointerup", (e) => {
      if (pendingShareTap !== e.pointerId) return;
      pendingShareTap = null;
      const row = rowAt(e);
      if (row && row.menu[row.index - 1].share) core.keypressed("return");
    });
    canvas.addEventListener("pointercancel", () => { pendingShareTap = null; });
    canvas.addEventListener("pointerleave", (e) => { R.setAccountHot(false); accTip = ""; if (e.pointerType === "mouse") hideTip(); });
    // description popup (the profile's achievement names, link.tip): plain HTML text by the pointer, styled like the dialogs
    const tipEl = document.getElementById("tip");
    function showTip(text, e) {
      if (tipEl.textContent !== text) tipEl.textContent = text;
      tipEl.classList.add("on");
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
      tipEl.style.left = Math.max(8, Math.min(vw - w - 8, e.clientX + 14)) + "px";
      tipEl.style.top = (e.clientY + 18 + h > vh - 8 ? Math.max(8, e.clientY - h - 12) : e.clientY + 18) + "px";
    }
    function hideTip() { tipEl.classList.remove("on"); }
    // touch gameplay: swipe = direction (stays latched, like holding a key), tap = ability, two-finger tap = pause
    // With the Pause ability, a finger held still instead holds the ability button (after HOLD_MS, so a swipe that
    // starts slowly isn't one) until it lifts or moves
    const touches = new Map(); let touchDir = null, twoFinger = false, touchHold = false, holdTimer = 0;
    const HOLD_MS = 120;
    const pauseAbility = () => core.g.config.ability === core.PAUSE;
    const endHold = () => { clearTimeout(holdTimer); touchHold = false; };
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
      if (touches.size === 2 && !twoFinger) { twoFinger = true; endHold(); core.keypressed("p"); }
      else if (touches.size === 1 && pauseAbility()) {
        const id = e.pointerId;
        clearTimeout(holdTimer);
        holdTimer = setTimeout(() => { const t = touches.get(id); if (t && !t.moved && !twoFinger) { touchHold = true; core.keypressed("space"); } }, HOLD_MS);
      }
      return true;
    }
    function gestureMove(e) {
      const t = touches.get(e.pointerId); if (!t) return;
      const dx = e.clientX - t.x, dy = e.clientY - t.y, TH = 18;
      if (Math.abs(dx) < TH && Math.abs(dy) < TH) return;
      setTouchDir(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up"));
      t.x = e.clientX; t.y = e.clientY; t.moved = true;
      endHold();
    }
    function gestureEnd(e) {
      const t = touches.get(e.pointerId); if (!t) return;
      touches.delete(e.pointerId);
      if (touches.size === 0) {
        endHold();
        if (!twoFinger && !pauseAbility() && !t.moved && Math.hypot(e.clientX - t.sx, e.clientY - t.sy) < 12 && performance.now() - t.t < 350) core.keypressed("space");
        twoFinger = false;
      }
    }
    canvas.addEventListener("pointermove", gestureMove);
    canvas.addEventListener("pointerup", gestureEnd);
    canvas.addEventListener("pointercancel", gestureEnd);
    canvas.addEventListener("contextmenu", (e) => { if (core.g.scene.name !== "game") e.preventDefault(); });
    // fullscreen: standard page controls (button + F key); the browser's own Esc/F11 handling stays in charge
    const fsBtn = document.getElementById("fs");
    // volume (leftmost button): the speaker mutes / unmutes (also M during gameplay, where the Lua had it); a slider
    // drops down below it on hover, or on a first tap on touch screens (a second tap mutes). The whole page, remembered
    const volBox = document.getElementById("vol"), muteBtn = document.getElementById("mute"), volSlider = document.getElementById("volume");
    function syncMute() {
      const gain = masterGain();
      audio.setMaster(gain);
      if (videoEl) { videoEl.muted = muted; videoEl.volume = filmVolume(); }
      const silent = muted || volume === 0;
      muteBtn.classList.toggle("muted", silent);
      muteBtn.classList.toggle("low", volume < 50);
      muteBtn.title = silent ? "Unmute" : "Mute";
      muteBtn.setAttribute("aria-label", muteBtn.title);
      volSlider.value = String(volume);
      volSlider.style.setProperty("--v", (muted ? 0 : volume) + "%");
      volSlider.title = "Volume " + (muted ? 0 : volume) + "%";
    }
    const saveVolume = () => { try { localStorage.setItem("booze-elroy-muted", muted ? "1" : "0"); localStorage.setItem("booze-elroy-volume", String(volume)); } catch { /* ignore */ } };
    function toggleMute() {
      if (muted || volume === 0) { muted = false; if (volume === 0) volume = 50; } else muted = true;
      saveVolume(); syncMute();
    }
    let volTouch = false;
    const closeVol = () => volBox.classList.remove("open");
    volBox.addEventListener("pointerdown", (e) => { e.stopPropagation(); audio.unlock(); }, true);
    muteBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); volTouch = e.pointerType !== "mouse"; }, true);
    muteBtn.addEventListener("click", (e) => {
      e.preventDefault(); muteBtn.blur();
      if (volTouch && !volBox.classList.contains("open")) { volBox.classList.add("open"); return; } // touch: first tap shows the slider
      toggleMute();
    });
    volSlider.addEventListener("input", () => { volume = Math.max(0, Math.min(100, Math.round(+volSlider.value))); muted = false; saveVolume(); syncMute(); });
    volSlider.addEventListener("keydown", (e) => e.stopPropagation()); // its arrow keys are its own, not Pac-Man's
    volSlider.addEventListener("change", () => volSlider.blur());
    volSlider.addEventListener("pointerup", () => volSlider.blur());
    window.addEventListener("pointerdown", (e) => { if (!volBox.contains(e.target)) closeVol(); }, true);
    window.addEventListener("keydown", (e) => {
      if (dialogOpen() || core.g.scene.name !== "game" || core.g.attract || e.code !== "KeyM" || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); toggleMute();
    });
    syncMute();
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
      window.addEventListener("keydown", (e) => { if (!dialogOpen() && core.g.scene.name !== "nameEntry" && e.code === "KeyF" && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); toggleFullscreen(); } });
    }
    // pop-out window (the button right of fullscreen; desktop only, and not in the pop-out itself): the game in a window of
    // its own, sized to the screen's height. This tab stands still meanwhile (no updates, no sound, a "Playing in the
    // pop-out window" cover with "Play here instead") and picks up again when that window closes. Same site, so the
    // login and settings are shared through localStorage
    const POP_NAME = "booze-elroy-popout", popBtn = document.getElementById("pop"), popCover = document.getElementById("popped");
    let popWin = null, popTimer = null;
    function setPoppedOut(w) {
      poppedOut = !!w; popWin = w; popCover.classList.toggle("on", poppedOut);
      clearInterval(popTimer); popTimer = null;
      if (poppedOut) {
        if (audio.ctx) audio.ctx.suspend().catch(() => {});
        if (videoEl && !videoEl.paused) videoEl.pause();
        popTimer = setInterval(() => { if (!popWin || popWin.closed) setPoppedOut(null); }, 500);
      } else { if (audio.ctx) audio.ctx.resume().catch(() => {}); last = performance.now(); acc = 0; }
    }
    function popOut() {
      // about two thirds of the screen's height (the author: full height was too big, half too small; it can be resized)
      const sh = (screen.availHeight || 900) - 60, h = Math.max(420, Math.min(680, Math.round(sh * 2 / 3))), w = Math.round(h * 224 / 288);
      const left = Math.max(0, Math.round((screen.availWidth - w) / 2)), top = Math.max(0, Math.round((screen.availHeight - h) / 2 - 20));
      const win = window.open(location.origin + location.pathname, POP_NAME, `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
      if (!win) { core.g.toast = { text: "pop-up blocked", until: performance.now() + 2500 }; return; }
      win.focus();
      setPoppedOut(win);
    }
    // in the pop-out itself the controls would cover the picture (the window is sized tight round it): none there
    // (the author tried them fading in near the top: still in the way). The keys still work: C, F, Esc, M in a game
    if (window.name === POP_NAME) document.body.classList.add("popout");
    else if (matchMedia("(hover: hover) and (pointer: fine)").matches) {
      popBtn.classList.add("on");
      popBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); }, true);
      popBtn.addEventListener("click", (e) => { e.preventDefault(); popOut(); popBtn.blur(); });
    }
    document.getElementById("popBack").addEventListener("click", () => { try { if (popWin) popWin.close(); } catch { /* ignore */ } setPoppedOut(null); });
    // the look: CRT (true, the default) -> plain (false) -> 1982 living-room TV ("tv") -> CRT. The C key or the TV button
    // (between mute and fullscreen; phones have no C). Not an option on the Options page (env.crtKey); saved at once, into the player's
    // own settings even while an arena's / leaderboard's are borrowed
    const lookBtn = document.getElementById("look");
    const LOOK_NAMES = { true: "CRT", false: "clean", tv: "retro TV" };
    const syncLook = () => { lookBtn.title = "Visuals: " + LOOK_NAMES[core.g.config.crtEffect] + " (C to change)"; lookBtn.setAttribute("aria-label", lookBtn.title); };
    function cycleLook() {
      const crt = core.g.config.crtEffect;
      core.g.config.crtEffect = crt === "tv" ? true : crt ? false : "tv";
      try { localStorage.setItem("booze-elroy-options", JSON.stringify({ ...LB.ownSettings(), crtEffect: core.g.config.crtEffect })); } catch { /* ignore */ }
      syncLook();
    }
    window.addEventListener("keydown", (e) => {
      if (dialogOpen() || core.g.scene.name === "nameEntry" || e.code !== "KeyC" || e.ctrlKey || e.metaKey || e.altKey) return;
      e.preventDefault(); cycleLook();
    });
    lookBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); }, true);
    lookBtn.addEventListener("click", (e) => { e.preventDefault(); cycleLook(); lookBtn.blur(); });
    syncLook();
    // Options page tips (src/tips.js): the browser's own hover text on the option row under the mouse (what the option
    // does, and what its current value means)
    let tipRow = null, tipText = "", accTip = "";
    function syncTip() {
      const menu = core.optMenu;
      const tip = core.g.scene.name === "options" && tipRow ? BoozeTips.tipFor(menu[tipRow - 1]) : null;
      const t = accTip && R.accountBox() ? accTip : tip ? tip.text + (tip.value ? "\n\n" + tip.value : "") : "";
      if (t !== tipText) { tipText = t; canvas.title = t; }
    }

    // touch devices have no Esc key: a small button leaves the game / autoplay / sub-screens
    const escBtn = document.getElementById("esc");
    escBtn.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); }, true);
    escBtn.addEventListener("click", (e) => { e.preventDefault(); core.keypressed("escape"); });
    window.addEventListener("blur", () => { for (const k in down) down[k] = false; });
    window.addEventListener("pointerdown", () => { audio.unlock(); primeVideo(); });

    // gamepad (standard mapping): d-pad -> arrows (held), A/start/B -> buttons
    const padPrev = {}, padDown = {};
    let padAbility = false; // A held (the Pause ability lasts while the button is down)
    function pollPad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const held = { left: false, right: false, up: false, down: false };
      padAbility = false;
      for (const p of pads) {
        if (!p) continue;
        const b = p.buttons;
        if (b[14] && b[14].pressed) held.left = true; if (b[15] && b[15].pressed) held.right = true;
        if (b[12] && b[12].pressed) held.up = true; if (b[13] && b[13].pressed) held.down = true;
        const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
        if (ax < -0.5) held.left = true; if (ax > 0.5) held.right = true; if (ay < -0.5) held.up = true; if (ay > 0.5) held.down = true;
        if (b[0] && b[0].pressed) padAbility = true;
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
      if (poppedOut) { // playing in the pop-out window: stand still (and stay quiet: a key press could wake the audio)
        if (audio.ctx && audio.ctx.state === "running") audio.ctx.suspend().catch(() => {});
        last = now; requestAnimationFrame(frame); return;
      }
      let dt = (now - last) / 1000; last = now;
      if (dt > 0.1) dt = 0.1;
      acc += dt;
      const step = core.FIXED_DT;
      if (touchDir && ["playerUp", "ready", "dying", "caught", "gameover", "levelAnimation", "intermission1", "intermission2", "intermission3", "destroyed"].includes(core.g.mode)) setTouchDir(null);
      if (!dialogOpen()) pollPad();
      while (acc >= step) { if (!rwd.update()) core.update(); rwd.record(); acc -= step; } // a rewind playing back takes the frame
      LB.tick();
      if (wantsFullBezel() !== fullBezel || (core.g.config && core.g.config.crtEffect) !== fitLook) fit();
      R.draw(); P.present();
      if (fpsOn) {
        fpsFrames += 1;
        if (now - fpsAt >= 500) { if (fpsAt) fpsText = Math.round(fpsFrames * 1000 / (now - fpsAt)) + " fps"; fpsFrames = 0; fpsAt = now; }
        // and every character's tile (x,y), in its colour, during a game
        const g = core.g, rows = [fpsText];
        if (g.scene.name === "game" && g.chars && g.chars.pac && !g.state.hideMaze) {
          const cm = core.getCurrentMaze();
          for (const name of ["pac", ...core.charKeys().filter((n) => n !== "pac")]) {
            const c = g.chars[name]; if (!c) continue;
            const [x, , y] = cm.getLoc(c);
            rows.push(`<span style="color:${name === "pac" ? "#ffd400" : R.ghostColor(name)}">${name.padEnd(6)} ${String(x).padStart(2)},${String(y).padStart(2)}</span>`);
          }
        }
        const html = rows.join("\n");
        if (html !== fpsHtml) { fpsEl.innerHTML = html; fpsHtml = html; }
      }
      escBtn.classList.toggle("on", core.g.scene.name !== "attract");
      // achievements for what's on screen: a real game (not the demo / autoplay) just started with no ghosts; the
      // credits; intermission 3 (Mina's film) in a real game
      { const g = core.g, sn = g.scene.name, real = sn === "game" && !g.attract && !g.autoplay;
        if (real && lastScene !== "game" && g.config.ghostCount === 0) earned(["park"]);
        // without a scratch 1-3: past board 2 / 5 / 9 (where the intermissions come) with no life lost. By board, so
        // Pro Mode (no intermissions) counts too. These, pac-man fever and peer pressure: games started on level 1 only
        // (run.start)
        if (real && lastScene !== "game") run = { start: g.levelNumber, lives: null, scratched: false, level: g.levelNumber, maze: g.currentMaze };
        if (real && run) {
          if (run.lives === null) { if (g.mode === "normal") run.lives = g.lives; } // the lives on hand once play starts
          else { if (g.lives < run.lives) run.scratched = true; run.lives = g.lives; }
          if (run.start === 1 && !run.scratched && run.lives !== null) earned([[2, "scratch"], [5, "scratch2"], [9, "scratch3"]].filter(([b]) => g.levelNumber > b).map(([, id]) => id));
          if (run.start === 1 && g.levelNumber > 21) earned(["fever"]); // pac-man fever: past the ninth key board (21)
          // elephantine memory: a large maze (bigger than the arcade's 28x31: the Jr. mazes, large1) completed on
          // Blindfold: Blackout; noticed as the next board starts, from the maze the last one was played on
          if (g.levelNumber > run.level) {
            const m = core.maze.getMaze(run.maze);
            if (g.config.afterDark === 5 && m && (m.w > 28 || m.h > 31)) earned(["elephant"]);
            run.level = g.levelNumber;
          }
          run.maze = g.currentMaze;
        }
        // peer pressure: the martini (the bonus on boards 9 and 10, "galaxian" in the data) eaten in a real game
        const fruitNow = real && !!g.fruitScoreTimer;
        if (fruitNow && !fruitShown && run && run.start === 1 && g.level && g.level.fruit && g.level.fruit.name === "galaxian") earned(["martini"]);
        fruitShown = fruitNow;
        if (real && lastScene !== "game") { // one week chip: a game on 7 days in a row (the player's own calendar); every
          // game is logged for the activity page, with its settings (and starting level when it isn't 1) and arena
          const d = new Date(), p2 = (n) => String(n).padStart(2, "0");
          const settings = LB.summary(200).join("  ") + (g.config.startingLevel > 1 ? "  starting level " + g.config.startingLevel : "");
          const ar = LB.inArena() && LB.currentArena();
          ACC.playedOn(d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()), settings, ar ? ar.name : null).then((n) => { if (n >= 7) earned(["streak"]); });
        }
        if (sn === "credits" && lastScene !== "credits") earned(["respects"]);
        // dedication: Mina's film, however it's reached (a game from any level, or the "mina" cheat); the author just
        // wants people to see her
        if ((real && g.mode === "intermission3") || (sn === "mina" && lastScene !== "mina")) earned(["dedication"]);
        if (held.length && !livePlay()) { const h = held; held = []; showUnlocked(h); }
        lastScene = sn; }
      if (core.g.scene.name !== "profile") hideTip();
      syncTip();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    document.getElementById("loading").remove();
  }
  start().catch((e) => { console.error(e); const l = document.getElementById("loading"); if (l) l.textContent = "Error: " + e.message; });
})();
