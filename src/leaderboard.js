/* Booze Elroy - online leaderboard, browser side (web-edition addition, not in the Lua original).
 *  - one board per gameplay configuration (BoozeScoreKey.keyFor)
 *  - the header's HIGH SCORE shows the best for the current settings: the online leader (name on the row below)
 *    or this browser's own best for those settings, whichever is higher
 *  - scenes "nameEntry" (arcade letter grid, up to 16 characters) and "leaderboard" (top 10 for the current settings)
 *  - arenas: 24-hour boards with fixed settings (scenes "arenas" = list, "arena" = one arena; nameEntry names new ones).
 *    Playing an arena applies its settings (starting level 1) until the player leaves it; their own options come back.
 *  - PLAY 1P on the Leaderboards page borrows the board's settings the same way (own starting level), until the player
 *    leaves the leaderboard; quitting or finishing that game comes back to the board.
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
  const HOUR = 3600 * 1000;
  const LIST_TOP = 6, LIST_BOTTOM = 29; // arena list rows
  /** "23h", or "45m" in the last hour */
  const timeLeft = (ms) => (ms >= HOUR ? Math.ceil(ms / HOUR) + "h" : Math.max(1, Math.ceil(ms / 60000)) + "m");

  // created before the core (the core reads env.scenes when it builds the main menu), then attach(core)
  function create(opts) {
    let core = null, g = null;
    const storage = opts.storage;
    const api = opts.apiBase || null; // null = offline
    const fetchFn = opts.fetch;
    const arenaApi = opts.arenaBase || null;
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
    async function post2(url, body) {
      const r = await fetchFn(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
      // left the arena (or the leaderboard whose settings were borrowed) some other way: the player's own settings come back
      if (ownConfig && scene !== "game" && scene !== "nameEntry" && scene !== (playingBoard ? "leaderboard" : "arena")) leaveArena();
      if (scene === "game") {
        // a real game is starting: refresh its board(s) so name entry has current data at game over
        if (lastScene !== "game" && !g.attract && !g.autoplay) { load(currentKey(), true); if (ownConfig && arena) loadArena(arena.id); }
        lastScene = scene;
        return; // in a game the core keeps HIGH SCORE up to date itself
      }
      lastScene = scene;
      if (scene === "arena" || (scene === "nameEntry" && ownConfig && arena)) { arenaHeader(); return; }
      if (scene === "leaderboard" && g.scene.key) { refreshHeader(g.scene.key); return; } // the board on show
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
    function summary(width, cfg) {
      cfg = cfg || g.config;
      const diffs = [];
      for (const [k, vals] of SK.FIELDS) {
        const i = vals.indexOf(cfg[k]) >= 0 ? vals.indexOf(cfg[k]) : vals.indexOf(!!cfg[k]);
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

    // ---------------------------------------------------------------- arenas (list, boards, the one being played)
    let clockOffset = 0; // server clock - this browser's clock
    const serverNow = () => Date.now() + clockOffset;
    const arenaList = { status: arenaApi ? "loading" : "error", arenas: [], at: -1e9, p: null };
    function loadArenas(fresh) {
      if (!arenaApi) return Promise.resolve(arenaList);
      if (arenaList.p) return fresh ? arenaList.p.then(() => loadArenas()) : arenaList.p; // fresh: not one already under way
      arenaList.p = fetchFn(arenaApi, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
        .then((d) => { clockOffset = d.now - Date.now(); arenaList.arenas = d.arenas || []; arenaList.status = "ok"; checkWins(arenaList.arenas); })
        .catch(() => { if (arenaList.status !== "ok") arenaList.status = "error"; })
        .finally(() => { arenaList.at = performance.now(); arenaList.p = null; });
      return arenaList.p;
    }
    // arenas the logged-in player (opts.playerName) won: closed, past the 15-minute grace for late scores, theirs on top
    // -> opts.arenaWon(arena) (achievements; may be told more than once)
    const ARENA_GRACE = 15 * 60 * 1000;
    function checkWins(list) {
      const me = opts.playerName && opts.playerName();
      if (!me || !opts.arenaWon) return;
      for (const a of list) if (a && a.leader && a.leader.name === me && a.endsAt + ARENA_GRACE <= serverNow()) opts.arenaWon(a);
    }
    const arenaBoards = new Map(); // id -> { status: "loading" | "ok" | "error" | "gone", entries, at }
    function loadArena(id) {
      if (!arenaApi) return Promise.resolve(null);
      if (!arenaBoards.has(id)) arenaBoards.set(id, { status: "loading", entries: [], at: 0 });
      return fetchFn(arenaApi + "/board?id=" + encodeURIComponent(id), { cache: "no-store" })
        .then(async (r) => {
          if (r.status === 404) { arenaBoards.set(id, { status: "gone", entries: [], at: performance.now() }); return; }
          if (!r.ok) throw new Error("HTTP " + r.status);
          const d = await r.json();
          clockOffset = d.now - Date.now();
          if (arena && arena.id === id) arena = d.arena;
          if (d.arena) checkWins([d.arena]);
          arenaBoards.set(id, { status: "ok", entries: d.entries || [], at: performance.now() });
        })
        .catch(() => { const old = arenaBoards.get(id); arenaBoards.set(id, { status: old && old.status === "ok" ? "ok" : "error", entries: old ? old.entries : [], at: performance.now() }); });
    }
    let arena = null; // the arena being viewed / played
    let ownConfig = null; // the player's own settings while an arena's (or a leaderboard's) are applied
    let playingBoard = null; // the board key while its settings are borrowed from the Leaderboards page (PLAY 1P)
    const arenaOpen = (a) => !!a && serverNow() < a.endsAt;
    function applyArena(a) {
      if (!ownConfig) ownConfig = { ...g.config };
      Object.assign(g.config, SK.configFor(a.board), { startingLevel: 1 });
    }
    function applyBoard(key) {
      if (!ownConfig) ownConfig = { ...g.config };
      Object.assign(g.config, SK.configFor(key));
      playingBoard = key; arena = null;
    }
    function leaveArena() {
      // the player's own settings come back, except CRT: the C key may have toggled it meanwhile (main.js saves it)
      if (ownConfig) { const crt = g.config.crtEffect; Object.assign(g.config, ownConfig, { crtEffect: crt }); ownConfig = null; }
      arena = null; playingBoard = null;
    }
    const borrowed = () => !!ownConfig; // someone else's settings are applied: never save them as the player's
    const ownSettings = () => ownConfig || g.config; // the player's own settings, borrowed or not
    const inArena = () => !!ownConfig && !playingBoard;
    // where quitting a game (Esc / the X button) goes: back to the arena or leaderboard it was started from, else the title
    const quitGameTo = () => (!ownConfig ? null : playingBoard ? "leaderboard" : "arena");
    // straight into a game (the title's "play" step only runs on the title scene, which would give the settings back)
    function startGame() { sfx("coindrop"); g.autoplay = false; g.attract = false; core.setScene("game"); }
    function arenaHeader() {
      const b = arena && arenaBoards.get(arena.id), leader = b && b.entries[0];
      g.highScore = leader ? leader.score : false;
      g.highScoreName = leader ? leader.name : null;
      g.highScoreNameScore = leader ? leader.score : 0;
    }

    // ---------------------------------------------------------------- scenes
    const sfx = (n) => { const s = g.sounds[n]; if (s) { s.stop(); s.play(); } };
    // menu moves alternate the two wakka sounds, like the core menus (sharing its g.wakka flip-flop)
    const wakka = () => { if (g.wakka) { sfx("wakka2"); g.wakka = false; } else { sfx("wakka1"); g.wakka = true; } };

    // every board that has scores (the Leaderboards page flips through them), from GET /api/scores/boards
    const boardList = { status: api ? "loading" : "error", boards: [], p: null };
    function loadBoardList() {
      if (!api) return Promise.resolve(boardList);
      if (boardList.p) return boardList.p;
      boardList.p = fetchFn(api + "/boards", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
        .then((d) => { boardList.boards = (d.boards || []).filter((b) => SK.isKey(b.board)); boardList.status = "ok"; })
        .catch(() => { if (boardList.status !== "ok") boardList.status = "error"; })
        .finally(() => { boardList.p = null; });
      return boardList.p;
    }

    // PLAY 1P plays the board on show (its settings borrowed for the game); Share Config only when the page can copy
    // links (opts.share; it shares the board on show)
    const lbMenu = Object.assign([
      { text: "Play 1P", x: 10.5, y: 31, action() { applyBoard(leaderboard.key); startGame(); } },
      ...(opts.share ? [{ text: "Share Config", share: true, x: 8, y: 33, action() { opts.share(SK.configFor(leaderboard.key)); } }] : []),
      { text: "Back", x: 12, y: opts.share ? 35 : 33, action() { core.setScene("attract", true); } },
    ], { selectedItem: 1 });
    const lbMove = (d) => { wakka(); lbMenu.selectedItem = ((lbMenu.selectedItem - 1 + d + lbMenu.length) % lbMenu.length) + 1; };
    const lbBack = () => lbMenu[lbMenu.length - 1].action();
    // Leaderboards: starts on the current settings' board; left / right (or prev / next) flip through every board
    // with scores: the current one first, then the busiest (most entries, then highest top score)
    const leaderboard = {
      name: "leaderboard",
      menu: lbMenu,
      layout: { summaryTop: 5, summaryLines: 4, listTop: 10, messageRow: 29 }, // room for a three-item menu
      highlight: null, message: null, key: null, links: [],
      start(o) {
        o = o || {};
        this.highlight = o.highlight || null;
        this.message = o.message || null;
        this.fc = 0;
        this.key = currentKey();
        lbMenu.selectedItem = 1;
        if (!o.fresh) load(this.key, true);
        loadBoardList();
        const lx = (x, n) => ({ x0: x * 8 - 6, y0: 3 * 8, x1: (x + n) * 8 + 6, y1: 6 * 8 }); // roomy: the CRT curve bends the corners
        this.links = [{ ...lx(4, 4), action: () => this.flip(-1) }, { ...lx(20, 4), action: () => this.flip(1) }];
      },
      update() { this.fc += 1; },
      keys() {
        const cur = currentKey();
        const rest = boardList.boards.filter((b) => b.board !== cur)
          .sort((a, b) => b.count - a.count || b.top.score - a.top.score || (a.board < b.board ? -1 : 1));
        return [cur, ...rest.map((b) => b.board)];
      },
      flip(d) {
        const ks = this.keys();
        if (ks.length < 2) return;
        wakka();
        const i = Math.max(0, ks.indexOf(this.key));
        this.key = ks[(i + d + ks.length) % ks.length];
        this.highlight = null; this.message = null;
        load(this.key);
      },
      title() { return "leaderboards"; },
      // "prev   3/14   next" (just the count while there's only the one)
      subtitle() {
        const ks = this.keys(), n = String(Math.max(1, ks.indexOf(this.key) + 1)) + "/" + ks.length;
        return ks.length < 2 ? n : "prev" + " ".repeat(Math.max(1, 6 - Math.ceil(n.length / 2))) + n + " ".repeat(Math.max(1, 6 - Math.floor(n.length / 2))) + "next";
      },
      board() { return boardFor(this.key); },
      summary(width) { return summary(width, SK.configFor(this.key)); },
      keypressed(key) {
        if (key === "return" || key === "space") { const it = lbMenu[lbMenu.selectedItem - 1]; if (it.text !== "Play 1P") wakka(); it.action(); }
        else if (key === "left") this.flip(-1);
        else if (key === "right") this.flip(1);
        else if (key === "up") lbMove(-1);
        else if (key === "down") lbMove(1);
      },
      gamepadpressed(button) {
        if (button === "a") lbMenu[lbMenu.selectedItem - 1].action();
        else if (button === "b") lbBack();
        else if (button === "dpleft" || button === "leftshoulder") this.flip(-1);
        else if (button === "dpright" || button === "rightshoulder") this.flip(1);
        else if (button === "dpup") lbMove(-1);
        else if (button === "dpdown") lbMove(1);
      },
    };

    // shared menu moves for the arena scenes
    const menuMove = (menu, d) => { wakka(); menu.selectedItem = ((menu.selectedItem - 1 + d + menu.length) % menu.length) + 1; };
    const menuKeys = (sc, key) => {
      const m = sc.menu;
      if (key === "return" || key === "space") { wakka(); m[m.selectedItem - 1].action(); }
      else if (key === "up" || key === "left") menuMove(m, -1);
      else if (key === "down" || key === "right") menuMove(m, 1);
    };
    const menuPad = (sc, button) => {
      const m = sc.menu;
      if (button === "a") m[m.selectedItem - 1].action();
      else if (button === "dpup" || button === "dpleft") menuMove(m, -1);
      else if (button === "dpdown" || button === "dpright") menuMove(m, 1);
    };
    // keep the same item selected when a menu is rebuilt
    function rebuildMenu(sc, items) {
      const old = sc.menu[sc.menu.selectedItem - 1], id = old && (old.id || old.text);
      const i = id ? items.findIndex((it) => (it.id || it.text) === id) : -1;
      sc.menu = Object.assign(items, { selectedItem: i >= 0 ? i + 1 : Math.min(sc.menu.selectedItem || 1, items.length) });
    }

    // arena list: running arenas (name, time left), then ones finished in the last day (name, winner); scrolls
    const arenas = {
      name: "arenas",
      menu: Object.assign([], { selectedItem: 1 }),
      decor: [], links: [], scroll: 0, lastSel: 0, fc: 0,
      start() {
        leaveArena();
        this.fc = 0; this.scroll = 0; this.lastSel = 0;
        this.menu = Object.assign([], { selectedItem: 1 });
        loadArenas(true);
        this.build();
        this.menu.selectedItem = 1;
      },
      update() {
        this.fc += 1;
        if (performance.now() - arenaList.at > 30000) loadArenas();
        this.build();
      },
      status() { return arenaList.status; },
      build() {
        const now = serverNow();
        const open = arenaList.arenas.filter((a) => a.endsAt > now).sort((a, b) => a.endsAt - b.endsAt);
        const done = arenaList.arenas.filter((a) => a.endsAt <= now).sort((a, b) => b.endsAt - a.endsAt);
        // virtual rows { h, item?, draw(y) }, laid out top to bottom and scrolled
        const rows = [], items = [], decor = [];
        const pick = (a) => () => core.setScene("arena", { arena: a });
        for (const a of open) {
          const it = { id: a.id, text: a.name, x: 2, action: pick(a) };
          items.push(it);
          rows.push({ h: 2, item: it, draw: (y) => { const t = timeLeft(a.endsAt - now); decor.push({ text: t, x: 26 - t.length, y, o: 2 }); } });
        }
        if (arenaList.status === "ok" && !open.length) rows.push({ h: 2, draw: (y) => decor.push({ text: "no running arenas", x: 14 - 8.5, y, o: 2 }) });
        if (done.length) rows.push({ h: 2, draw: (y) => decor.push({ text: "finished", x: 2, y, o: 3 }) });
        for (const a of done) {
          const it = { id: a.id, text: a.name, x: 2, action: pick(a) };
          items.push(it);
          rows.push({ h: 3, item: it, draw: (y) => decor.push({ text: a.leader ? "won by " + a.leader.name : "no scores", x: 4, y: y + 1, o: a.leader ? 4 : 2 }) });
        }
        items.push({ text: "Create Arena", x: 8, y: 32, action() { createArena(); } });
        items.push({ text: "Back", x: 12, y: 34, action() { core.setScene("attract", true); } });
        rebuildMenu(this, items);
        // scrolling: follow the selection when it moves; otherwise stay where the wheel / "more" left it
        let vy = 0; for (const r of rows) { r.vy = vy; vy += r.h; }
        const view = LIST_BOTTOM - LIST_TOP + 1, maxScroll = Math.max(0, vy - 1 - view);
        const sel = this.menu[this.menu.selectedItem - 1];
        if (this.menu.selectedItem !== this.lastSel) {
          this.lastSel = this.menu.selectedItem;
          const r = rows.find((x) => x.item === sel);
          if (r) { if (r.vy < this.scroll) this.scroll = r.vy; else if (r.vy + r.h - 1 > this.scroll + view) this.scroll = r.vy + r.h - 1 - view; }
        }
        this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
        for (const r of rows) {
          const y = LIST_TOP + r.vy - this.scroll;
          const visible = y >= LIST_TOP && y + r.h - 2 <= LIST_BOTTOM;
          if (r.item) r.item.y = visible ? y : -10;
          if (visible) r.draw(y);
        }
        this.links = [];
        if (this.scroll > 0) { decor.push({ text: "more", x: 12, y: LIST_TOP - 1, o: 2 }); this.links.push({ x0: 88, y0: (LIST_TOP - 1) * 8 - 2, x1: 136, y1: LIST_TOP * 8, action: () => this.scrollBy(-6) }); }
        if (this.scroll < maxScroll) { decor.push({ text: "more", x: 12, y: LIST_BOTTOM + 1, o: 2 }); this.links.push({ x0: 88, y0: (LIST_BOTTOM + 1) * 8 - 2, x1: 136, y1: (LIST_BOTTOM + 2) * 8 + 2, action: () => this.scrollBy(6) }); }
        this.decor = decor;
      },
      scrollBy(n) { this.scroll += n; this.build(); },
      keypressed(key) { menuKeys(this, key); },
      gamepadpressed(button) { if (button === "b") core.setScene("attract", true); else menuPad(this, button); },
    };

    // one arena: its settings, time left and top 10; Play (while open) applies its settings and starts a game
    const arenaScene = {
      name: "arena",
      captureInput: true, // Esc goes back to the arena list, not the title
      layout: { summaryTop: 5, summaryLines: 3, listTop: 9, messageRow: 29 }, // leaves room for a spaced-out menu
      menu: Object.assign([], { selectedItem: 1 }),
      highlight: null, message: null, fc: 0,
      start(o) {
        o = o || {};
        if (o.arena) arena = o.arena;
        this.highlight = o.highlight || null;
        this.message = o.message || null;
        this.fc = 0;
        this.menu = Object.assign([], { selectedItem: 1 });
        if (!o.fresh) loadArena(arena.id);
        this.build();
        this.menu.selectedItem = 1;
      },
      update() {
        this.fc += 1;
        if (this.fc % 1800 === 0) loadArena(arena.id); // every 30 s
        this.build();
      },
      build() {
        const items = [];
        if (arenaOpen(arena) && api) items.push({ text: "Play 1P", x: 10.5, y: 31, action: () => this.play() });
        if (opts.shareArena) items.push({ text: "Share Arena", share: true, x: 8.5, y: 33, action: () => opts.shareArena(arena.id) });
        items.push({ text: "Back", x: 12, y: 35, action: () => this.back() });
        rebuildMenu(this, items);
      },
      play() { applyArena(arena); startGame(); },
      back() { leaveArena(); core.setScene("arenas"); },
      title() { return arena.name; },
      subtitle() { return arenaOpen(arena) ? "ends in " + timeLeft(arena.endsAt - serverNow()) : "finished"; },
      summary(width) { return summary(width, SK.configFor(arena.board)); },
      board() { return arenaBoards.get(arena.id) || { status: "loading", entries: [] }; },
      emptyText(b) { return b.status === "loading" ? "loading" : b.status === "gone" ? "arena not found" : b.status === "error" ? "try again soon" : "no scores yet"; },
      keypressed(key) {
        if (key === "escape" || key === "backspace") { wakka(); this.back(); return; }
        menuKeys(this, key);
      },
      gamepadpressed(button) {
        if (button === "b") this.back();
        else if (button === "start") core.setScene("attract");
        else menuPad(this, button);
      },
    };

    // grid cells double as a "menu" so the mouse / touch code can hover and click them

    let pending = null;
    // a score placed on a regular board: opts.placed({ key, rank, score, settings, isDefault, first }) (achievements and the
    // activity log; settings: a one-line summary; first: the board's first ever score)
    const placed = (key, rank, entries, score) => {
      if (rank && opts.placed) opts.placed({ key, rank, score, settings: summary(200, SK.configFor(key)).join("  "), isDefault: key === SK.keyFor(g.defaultConfig), first: rank === 1 && entries.length === 1 });
    };
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
        this.mode = o.mode || "score"; // "score" (after a game) | "createArena" (naming a new arena)
        this.from = o.from || null; // createArena: the page it was opened from (Esc goes back there)
        this.key = o.key || currentKey(); this.score = o.score; this.place = o.place;
        this.arenaId = o.arenaId || null; this.arenaName = o.arenaName || null; this.arenaPlace = !!o.arenaPlace;
        this.message = null;
        this.entry = this.mode === "score" ? store.get(NAME, "") || "" : "";
        if (typeof this.entry !== "string" || !SK.cleanName(this.entry)) this.entry = "";
        this.timer = ENTRY_FRAMES; this.sending = false; this.fc = 0;
        neMenu.selectedItem = (this.entry ? END : 0) + 1; // a remembered name is one press from done
        // logged in (opts.playerName): the account's name goes straight on the board
        const player = this.mode === "score" && opts.playerName && SK.cleanName(opts.playerName() || "");
        if (player) { this.entry = player; this.submit(); }
      },
      update() {
        this.fc += 1;
        if (this.sending || this.mode !== "score") return;
        this.timer -= 1;
        if (this.timer <= 0) { if (this.entry.trim()) this.submit(); else this.leave(); }
      },
      leave() { core.setScene(this.mode === "createArena" ? this.from || "arenas" : quitGameTo() || "attract"); },
      summary(width) { return summary(width); },
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
        wakka();
      },
      keypressed(key) {
        if (this.sending) return;
        if (key === "escape") { this.leave(); return; }
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
        this.sending = true; this.message = null; sfx("coindrop");
        if (this.mode === "createArena") return this.createArena(name);
        if (!(opts.playerName && opts.playerName())) store.set(NAME, name); // the remembered name is for logged-out entry
        if (this.arenaId) return this.submitArena(name);
        let res = null;
        try { res = await post("", { board: this.key, name, score: this.score }); } catch { res = null; }
        if (res && res.ok && res.data) {
          boards.set(this.key, { status: "ok", entries: res.data.entries || [], at: performance.now() });
          placed(this.key, res.data.rank, res.data.entries || [], this.score);
          core.setScene("leaderboard", { fresh: true, highlight: res.data.rank, message: res.data.rank ? null : "not in the top 10" });
        } else core.setScene("leaderboard", { message: "score could not be saved" });
      },
      async createArena(name) {
        let res = null;
        try { res = await post2(arenaApi, { name, board: this.key }); } catch { res = null; }
        if (res && res.ok && res.data && res.data.arena) {
          const a = res.data.arena;
          clockOffset = res.data.now - Date.now();
          arenaList.arenas = arenaList.arenas.filter((x) => x.id !== a.id).concat([a]);
          arenaBoards.set(a.id, { status: "ok", entries: [], at: performance.now() });
          core.setScene("arena", { arena: a, fresh: true });
          if (opts.arenaCreated) opts.arenaCreated(a);
          return;
        }
        this.sending = false;
        this.message = res && res.status === 409 && res.data && res.data.error === "name taken" ? "that name is taken" : "could not create arena";
      },
      // a game in an arena: the arena board, and the regular board for these settings too
      async submitArena(name) {
        const [ar, gr] = await Promise.all([
          post2(arenaApi + "/score", { id: this.arenaId, name, score: this.score }).catch(() => null),
          post("", { board: this.key, name, score: this.score }).catch(() => null),
        ]);
        if (gr && gr.ok && gr.data) { boards.set(this.key, { status: "ok", entries: gr.data.entries || [], at: performance.now() }); placed(this.key, gr.data.rank, gr.data.entries || [], this.score); }
        const grank = gr && gr.ok && gr.data ? gr.data.rank : null;
        let rank = null, msg;
        if (ar && ar.ok && ar.data) {
          arenaBoards.set(this.arenaId, { status: "ok", entries: ar.data.entries || [], at: performance.now() });
          if (ar.data.arena) arena = ar.data.arena;
          rank = ar.data.rank;
          if (rank && opts.arenaPlaced) opts.arenaPlaced({ rank, score: this.score, arena: this.arenaName }); // the activity log
          msg = grank ? "leaderboard rank " + grank : rank ? null : ar.data.best ? "your arena best is " + ar.data.best : "not in the arena top 10";
        } else msg = ar && ar.status === 410 ? "the arena has closed" : "score could not be saved";
        core.setScene("arena", { fresh: !!(ar && ar.ok), highlight: rank, message: msg });
      },
    };

    // ---------------------------------------------------------------- hooks for core
    function afterGameOver(score) {
      if (ownConfig && !playingBoard) return afterArenaGame(score);
      // a game borrowed from the Leaderboards page ends back on that board
      return afterBoardGame(score) || (playingBoard ? "leaderboard" : null);
    }
    function afterBoardGame(score) {
      if (!api || !(score > 0)) return null;
      const key = currentKey(); if (!key) return null;
      const b = boards.get(key);
      if (!b || b.status !== "ok") return null; // server unreachable: don't make people type a name for nothing
      const place = SK.placeOf(b.entries, score);
      if (place < 0) return null;
      pending = { key, score, place: place + 1 };
      return "nameEntry"; // core switches scene; nameEntry.start picks up `pending`
    }
    // a game in an arena: name entry if the score places on the arena board or the regular one, else back to the arena
    function afterArenaGame(score) {
      if (!(score > 0)) return "arena";
      const key = currentKey(), gb = boards.get(key), ab = arenaBoards.get(arena.id);
      const ap = ab && ab.status === "ok" ? SK.placeOf(ab.entries, score) : -1;
      const gp = gb && gb.status === "ok" ? SK.placeOf(gb.entries, score) : -1;
      if (ap < 0 && gp < 0) return "arena";
      pending = { key, score, place: ap >= 0 ? ap + 1 : gp + 1, arenaId: arena.id, arenaName: arena.name, arenaPlace: ap >= 0 };
      return "nameEntry";
    }
    // a shared arena link (?arena=<id>): open its page once it's loaded; unknown / gone -> the arena list
    // (a 404 also says so in a toast; a network failure doesn't, since the arena may well still exist)
    async function openArena(id) {
      if (!arenaApi) return;
      let d = null, gone = false;
      try {
        const r = await fetchFn(arenaApi + "/board?id=" + encodeURIComponent(id), { cache: "no-store" });
        if (r.ok) d = await r.json(); else gone = r.status === 404;
      } catch { d = null; }
      if (g.scene.name !== "attract") return; // the player already went somewhere else
      if (d && d.arena) {
        clockOffset = d.now - Date.now();
        arenaBoards.set(id, { status: "ok", entries: d.entries || [], at: performance.now() });
        core.setScene("arena", { arena: d.arena, fresh: true });
      } else {
        core.setScene("arenas");
        if (gone) g.toast = { text: "that arena has ended", until: performance.now() + 3000 };
      }
    }
    // admin: delete the arena being viewed (password checked by the server); then back to the list
    async function deleteArena(password) {
      if (!arenaApi || !arena) return { ok: false, status: 0 };
      const id = arena.id;
      let res;
      try { res = await post2(arenaApi + "/delete", { id, password }); } catch { return { ok: false, status: 0 }; }
      if (res.ok || res.status === 404) {
        arenaList.arenas = arenaList.arenas.filter((a) => a.id !== id);
        arenaBoards.delete(id);
        if (g.scene.name === "arena") core.setScene("arenas");
        return { ok: true, status: 200 };
      }
      return res;
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
    // Create Arena on the Options page: names a new arena with the current settings; Esc goes back to Options
    // creating an arena takes an account (the author's first restriction, 2026-11-12): logged out, just a note
    const createArena = (from) => {
      if (opts.playerName && !opts.playerName()) { g.toast = { text: "log in to create an arena", until: performance.now() + 2500 }; return; }
      core.setScene("nameEntry", { mode: "createArena", from });
    };
    return { attach, scenes: { leaderboard, nameEntry, arenas, arena: arenaScene }, tick, wakka, inArena, borrowed, ownSettings, quitGameTo, createArena, leaveArena, loadArenas, arenaList, deleteArena, openArena, currentArena: () => arena, saveBest, afterGameOver, reset, load, boards, summary, BOARD_SIZE };
  }

  root.BoozeLeaderboard = { create };
})(typeof self !== "undefined" ? self : this);
