/* Booze Elroy - online leaderboard, browser side (web-edition addition, not in the Lua original).
 *  - one board per gameplay configuration (BoozeScoreKey.keyFor)
 *  - the header's HIGH SCORE shows the best for the current settings: the online leader (name on the row below)
 *    or this browser's own best for those settings, whichever is higher
 *  - scenes "nameEntry" (arcade letter grid, up to 16 characters) and "leaderboard" (top 10 for the current settings)
 * Works offline: with no server (file://, network down) the boards simply stay empty and name entry is skipped.
 */
(function (root) {
  "use strict";
  const SK = root.BoozeScoreKey;
  const { NAME_MAX, BOARD_SIZE } = SK;

  // option labels as the Options screen shows them
  const LABELS = {
    mazepack: "maze", difficulty: "difficulty", plusMode: "plus mode", afterDark: "blindfold",
    radar: "sonar", startingLives: "lives", freeGuy: "extra life", ability: "ability", movement: "speed",
    ghostCount: "ghosts", pinkyBug: "pinky bug", scatterOption: "scatter", freeGhost: "unrestricted",
  };
  // name-entry grid: every character in BoozeScoreKey.NAME_CHARS, ten per row, then SPACE / DEL / END
  const GRID = ["ABCDEFGHIJ", "KLMNOPQRST", "UVWXYZ0123", "456789!-/"];
  const SPECIALS = [{ text: "space", x: 5 }, { text: "del", x: 13 }, { text: "end", x: 20 }];
  const GRID_X = 5, GRID_Y = 17, SPECIAL_Y = 26;
  const ROW_START = [], ROW_LEN = [];
  { let n = 0; for (const row of GRID) { ROW_START.push(n); ROW_LEN.push(row.length); n += row.length; } ROW_START.push(n); ROW_LEN.push(SPECIALS.length); }
  const NCHARS = ROW_START[GRID.length], END = NCHARS + 2, SPECIAL_ROW = GRID.length, NROWS = GRID.length + 1;
  const SPECIAL_COL = [1, 5, 8]; // grid column each special sits under
  const ENTRY_FRAMES = 60 * 60; // a minute to enter a name, like a cabinet

  // created before the core (the core reads env.scenes when it builds the main menu), then attach(core)
  function create(opts) {
    let core = null, g = null;
    const storage = opts.storage;
    const api = opts.apiBase || null; // null = offline
    const fetchFn = opts.fetch;
    const store = {
      get(k, d) { try { const v = storage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
      set(k, v) { try { storage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
    };
    const BESTS = "booze-elroy-highscores", NAME = "booze-elroy-name";

    // ---------------------------------------------------------------- boards (cache + network)
    const boards = new Map(); // key -> { status: "loading" | "ok" | "error", entries, at }
    const inflight = new Map();
    const boardFor = (key) => boards.get(key) || { status: api ? "loading" : "error", entries: [] };
    function load(key, force) {
      if (!api || !key) return Promise.resolve(boardFor(key));
      const b = boards.get(key);
      if (!force && b && (b.status === "ok" || b.status === "error") && performance.now() - b.at < 60000) return Promise.resolve(b);
      if (inflight.has(key)) return inflight.get(key);
      if (!b) boards.set(key, { status: "loading", entries: [], at: 0 });
      const p = fetchFn(api + "?board=" + encodeURIComponent(key), { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
        .then((d) => { const nb = { status: "ok", entries: d.entries || [], at: performance.now() }; boards.set(key, nb); return nb; })
        .catch(() => { const old = boards.get(key); const nb = { status: old && old.status === "ok" ? "ok" : "error", entries: old ? old.entries : [], at: performance.now() }; boards.set(key, nb); return nb; })
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
      return p;
    }
    async function post(path, body) {
      const r = await fetchFn(api + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      let d = null; try { d = await r.json(); } catch { /* ignore */ }
      return { ok: r.ok, status: r.status, data: d };
    }
    const currentKey = () => SK.keyFor(g.config);

    // ---------------------------------------------------------------- header high score per configuration
    let lastKey = null, keyChangedAt = 0, lastScene = null;
    function saveBest(score) {
      if (g.autoplay) return; // only real games count as "your best"
      const key = currentKey(); if (!key) return;
      const bests = store.get(BESTS, {});
      if (!(bests[key] >= score)) { bests[key] = score; store.set(BESTS, bests); }
    }
    function refreshHeader(key) {
      const b = boardFor(key), leader = b.entries[0];
      const mine = key ? store.get(BESTS, {})[key] || 0 : 0;
      const best = Math.max(leader ? leader.score : 0, mine);
      g.highScore = best > 0 ? best : false;
      g.highScoreName = leader && leader.score >= mine ? leader.name : null;
      g.highScoreNameScore = leader ? leader.score : 0;
    }
    // once per frame, from main.js
    function tick() {
      const scene = g.scene.name;
      if (scene === "game") {
        // a real game is starting: refresh its board so name entry has current data at game over
        if (lastScene !== "game" && !g.attract && !g.autoplay) load(currentKey(), true);
        lastScene = scene;
        return; // in a game the core keeps HIGH SCORE up to date itself
      }
      lastScene = scene;
      const key = currentKey();
      if (key !== lastKey) { lastKey = key; keyChangedAt = performance.now(); }
      // flicking through Options changes the key a lot: only fetch once it settles
      if (key && !boards.has(key) && performance.now() - keyChangedAt > 350) load(key);
      refreshHeader(key);
    }

    // ---------------------------------------------------------------- settings summary (leaderboard page)
    function optionText(field, vals, i) {
      const item = core.optMenu.find((it) => it.key === field);
      return item && item.options[i] ? item.options[i].text : String(vals[i]);
    }
    function summary(width) {
      const diffs = [];
      for (const [k, vals] of SK.FIELDS) {
        const i = vals.indexOf(g.config[k]) >= 0 ? vals.indexOf(g.config[k]) : vals.indexOf(!!g.config[k]);
        const d = vals.indexOf(g.defaultConfig[k]);
        if (i !== d) diffs.push(LABELS[k] + " " + optionText(k, vals, i));
      }
      if (!diffs.length) return ["default settings"];
      const lines = [];
      for (const d of diffs) {
        const last = lines[lines.length - 1];
        if (last !== undefined && last.length + 2 + d.length <= width) lines[lines.length - 1] = last + "  " + d;
        else lines.push(d);
      }
      return lines;
    }

    // ---------------------------------------------------------------- scenes
    const sfx = (n) => { const s = g.sounds[n]; if (s) { s.stop(); s.play(); } };

    // Share Config only when the page can copy links (opts.share); otherwise just Back
    const lbMenu = Object.assign([
      ...(opts.share ? [{ text: "Share Config", share: true, x: 8, y: 33, action() { opts.share(); } }] : []),
      { text: "Back", x: 12, y: opts.share ? 35 : 33, action() { core.setScene("attract", true); } },
    ], { selectedItem: 1 });
    const lbMove = (d) => { sfx("wakka1"); lbMenu.selectedItem = ((lbMenu.selectedItem - 1 + d + lbMenu.length) % lbMenu.length) + 1; };
    const lbBack = () => lbMenu[lbMenu.length - 1].action();
    const leaderboard = {
      name: "leaderboard",
      menu: lbMenu,
      highlight: null, message: null,
      start(o) {
        o = o || {};
        this.highlight = o.highlight || null;
        this.message = o.message || null;
        this.fc = 0;
        lbMenu.selectedItem = 1;
        if (!o.fresh) load(currentKey(), true);
      },
      update() { this.fc += 1; },
      board() { return boardFor(currentKey()); },
      summary,
      keypressed(key) {
        if (key === "return" || key === "space") { sfx("wakka1"); lbMenu[lbMenu.selectedItem - 1].action(); }
        else if (key === "up" || key === "left") lbMove(-1);
        else if (key === "down" || key === "right") lbMove(1);
      },
      gamepadpressed(button) {
        if (button === "a") lbMenu[lbMenu.selectedItem - 1].action();
        else if (button === "b") lbBack();
        else if (button === "dpup" || button === "dpleft") lbMove(-1);
        else if (button === "dpdown" || button === "dpright") lbMove(1);
      },
    };

    // grid cells double as a "menu" so the mouse / touch code can hover and click them
    let pending = null;
    const neMenu = [];
    GRID.forEach((row, r) => { for (let c = 0; c < row.length; c++) neMenu.push({ text: row[c], char: row[c], x: GRID_X + c * 2, y: GRID_Y + r * 2 }); });
    for (const s of SPECIALS) neMenu.push({ text: s.text, x: s.x, y: SPECIAL_Y });
    neMenu.selectedItem = 1;
    const nameEntry = {
      name: "nameEntry",
      captureInput: true,
      menu: neMenu,
      start(o) {
        o = o || pending || {}; pending = null;
        this.key = o.key; this.score = o.score; this.place = o.place;
        this.entry = store.get(NAME, "") || "";
        if (typeof this.entry !== "string" || !SK.cleanName(this.entry)) this.entry = "";
        this.timer = ENTRY_FRAMES; this.sending = false; this.fc = 0;
        neMenu.selectedItem = (this.entry ? END : 0) + 1; // a remembered name is one press from done
      },
      update() {
        this.fc += 1;
        if (this.sending) return;
        this.timer -= 1;
        if (this.timer <= 0) { if (this.entry.trim()) this.submit(); else core.setScene("attract"); }
      },
      add(ch) {
        if (this.entry.length >= NAME_MAX) { neMenu.selectedItem = END + 1; return; }
        if (ch === " " && (!this.entry.length || this.entry.endsWith(" "))) return;
        this.entry += ch; sfx("wakka1");
        if (this.entry.length >= NAME_MAX) neMenu.selectedItem = END + 1;
      },
      del() { if (this.entry.length) { this.entry = this.entry.slice(0, -1); sfx("wakka2"); } },
      activate() {
        const i = neMenu.selectedItem - 1;
        if (i < NCHARS) this.add(neMenu[i].char);
        else if (i === NCHARS) this.add(" ");
        else if (i === NCHARS + 1) this.del();
        else if (this.entry.trim()) this.submit();
      },
      move(dr, dc) {
        const i = neMenu.selectedItem - 1;
        let r = 0; while (r < SPECIAL_ROW && i >= ROW_START[r + 1]) r++;
        let c = i - ROW_START[r];
        if (dr) {
          const col = r === SPECIAL_ROW ? SPECIAL_COL[c] : c; // keep roughly the same column
          r = (r + dr + NROWS) % NROWS;
          c = r === SPECIAL_ROW ? (col < 3 ? 0 : col < 7 ? 1 : 2) : Math.min(col, ROW_LEN[r] - 1);
        } else c = (c + dc + ROW_LEN[r]) % ROW_LEN[r];
        neMenu.selectedItem = ROW_START[r] + c + 1;
        sfx("wakka1");
      },
      keypressed(key) {
        if (this.sending) return;
        if (key === "escape") { core.setScene("attract"); return; }
        if (key === "backspace") return this.del();
        if (key === "up") return this.move(-1, 0);
        if (key === "down") return this.move(1, 0);
        if (key === "left") return this.move(0, -1);
        if (key === "right") return this.move(0, 1);
        if (key === "return") return this.activate();
        if (key === "space") return this.add(" ");
        if (typeof key === "string" && key.length === 1 && SK.NAME_CHARS.includes(key.toUpperCase())) this.add(key.toUpperCase());
      },
      gamepadpressed(button) {
        if (this.sending) return;
        if (button === "a") this.activate();
        else if (button === "b") this.del();
        else if (button === "start") { if (this.entry.trim()) this.submit(); }
      },
      async submit() {
        const name = SK.cleanName(this.entry);
        if (!name) return;
        this.sending = true; sfx("coindrop");
        store.set(NAME, name);
        let res = null;
        try { res = await post("", { board: this.key, name, score: this.score }); } catch { res = null; }
        if (res && res.ok && res.data) {
          boards.set(this.key, { status: "ok", entries: res.data.entries || [], at: performance.now() });
          core.setScene("leaderboard", { fresh: true, highlight: res.data.rank, message: res.data.rank ? null : "not in the top 10" });
        } else core.setScene("leaderboard", { message: "score could not be saved" });
      },
    };

    // ---------------------------------------------------------------- hooks for core
    function afterGameOver(score) {
      if (!api || !(score > 0)) return null;
      const key = currentKey(); if (!key) return null;
      const b = boards.get(key);
      if (!b || b.status !== "ok") return null; // server unreachable: don't make people type a name for nothing
      const place = SK.placeOf(b.entries, score);
      if (place < 0) return null;
      pending = { key, score, place: place + 1 };
      return "nameEntry"; // core switches scene; nameEntry.start picks up `pending`
    }
    async function reset(password, allBoards) {
      if (!api) return { ok: false, status: 0 };
      const key = currentKey();
      let res;
      try { res = await post("/reset", allBoards ? { password } : { password, board: key }); } catch { return { ok: false, status: 0 }; }
      if (res.ok) {
        if (allBoards) { store.set(BESTS, {}); boards.clear(); }
        else { const bests = store.get(BESTS, {}); delete bests[key]; store.set(BESTS, bests); boards.delete(key); }
        try { storage.removeItem("booze-elroy-highscore"); } catch { /* ignore */ }
        load(key, true);
      }
      return res;
    }

    const attach = (c) => { core = c; g = c.g; };
    return { attach, scenes: { leaderboard, nameEntry }, tick, saveBest, afterGameOver, reset, load, boards, summary, BOARD_SIZE };
  }

  root.BoozeLeaderboard = { create };
})(typeof self !== "undefined" ? self : this);
