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
  // (and under them, "save replay yes / no": a score's replay goes up with it unless the player says no; the author, 2026-11-18)
  { let n = 0; for (const row of GRID) { ROW_START.push(n); ROW_LEN.push(row.length); n += row.length; } ROW_START.push(n); ROW_LEN.push(SPECIALS.length); ROW_START.push(n + SPECIALS.length); ROW_LEN.push(1); ROW_START.push(n + SPECIALS.length + 1); }
  const NCHARS = ROW_START[GRID.length], END = NCHARS + 2, KEEP = NCHARS + 3, SPECIAL_ROW = GRID.length, KEEP_ROW = GRID.length + 1, NROWS = GRID.length + 2, KEEP_Y = 28;
  const SPECIAL_COL = [1, 5, 8]; // grid column each special sits under
  const ENTRY_FRAMES = 60 * 60; // a minute to enter a name, like a cabinet
  const HOUR = 3600 * 1000;
  const LIST_TOP = 5, LIST_BOTTOM = 29; // arena list rows (one blank row under the title: the author, 2026-11-16; it was two)
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
    // the name to fill in next time: logged out, the last one typed; logged in, the last one this account put on a board
    // (a player asked, 2026-11-16: people who post under a fun name want it again, not their login), kept per account
    const loginName = () => (opts.playerName && opts.playerName()) || null;
    const nameKey = () => (loginName() ? NAME + "/" + loginName() : NAME);
    const ELNAME = "booze-elroy-elroids-name", elNameKey = () => (loginName() ? ELNAME + "/" + loginName() : ELNAME); // (the hidden games' own, shared)

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
    // logged in, score posts carry the login (opts.auth): only its owner may use an account's name
    const headers = () => ({ "content-type": "application/json", ...(opts.auth ? opts.auth() : {}) });
    async function post(path, body) {
      const r = await fetchFn(api + path, { method: "POST", headers: headers(), body: JSON.stringify(body) });
      let d = null; try { d = await r.json(); } catch { /* ignore */ }
      return { ok: r.ok, status: r.status, data: d };
    }
    async function post2(url, body) {
      const r = await fetchFn(url, { method: "POST", headers: headers(), body: JSON.stringify(body) });
      let d = null; try { d = await r.json(); } catch { /* ignore */ }
      return { ok: r.ok, status: r.status, data: d };
    }
    // (NEAT, opts.neat: its own boards, the same settings' key with "neat:" in front; never seen by anyone else)
    const neatOn = () => !!(opts.neat && opts.neat());
    const currentKey = () => { const k = SK.keyFor(g.config); return k && neatOn() ? SK.NEAT + k : k; };
    const taken = (r) => !!(r && r.status === 403 && r.data && r.data.error === "name taken");

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
      g.newArena = hasNewArena(); // (render: the title's green dot)
      if (scene === "attract" && arenaApi && performance.now() - arenaList.at > 120000) loadArenas(); // a new one turns up
      // left the arena (or the leaderboard whose settings were borrowed) some other way: the player's own settings come back
      if (ownConfig && scene !== "game" && scene !== "nameEntry" && !(playingBoard ? scene === "leaderboard" || scene === borrowHome : scene === "arena")) leaveArena();
      if (scene === "game") {
        // a real game is starting: refresh its board(s) so name entry has current data at game over
        if (lastScene !== "game" && !g.attract && !g.autoplay) {
          // and HIGH SCORE is that board's: the settings in play, borrowed ones too (a pick, a leaderboard's, an arena's;
          // the author, 2026-11-16: it kept the page before's), shown from the cache, then again once the board is in
          const key = currentKey();
          refreshHeader(key);
          load(key, true).then(() => {
            if (g.scene.name !== "game" || g.attract || currentKey() !== key) return;
            const score = g.score || 0;
            refreshHeader(key);
            if (score > 0 && score > (g.highScore || 0)) g.highScore = score; // never below the game's own score
          });
          if (ownConfig && arena) loadArena(arena.id);
        }
        lastScene = scene;
        return; // in a game the core keeps HIGH SCORE up to date itself
      }
      lastScene = scene;
      if (scene === "arena" || (scene === "nameEntry" && ownConfig && arena)) { arenaHeader(); return; }
      if (scene === "leaderboard" && g.scene.key) { refreshHeader(g.scene.key); return; } // the board on show
      // the favorites / picks lists: the highlighted one's board; a favorite's page: its board (the author, 2026-11-16)
      const shownKey = g.scene.headerKey && g.scene.headerKey();
      if (shownKey) { load(shownKey); refreshHeader(shownKey); return; }
      const key = currentKey();
      if (key !== lastKey) { lastKey = key; keyChangedAt = performance.now(); }
      // flicking through Options changes the key a lot: only fetch once it settles. After that load() refetches once its
      // copy is a minute old, so a tab left on the title picks up a new high score set elsewhere (a hidden tab doesn't
      // tick, and refreshes as soon as it's back on screen)
      if (key && performance.now() - keyChangedAt > 350) load(key);
      refreshHeader(key);
    }

    // ---------------------------------------------------------------- settings summary (leaderboard page)
    function optionText(field, vals, i) {
      const item = core.optMenu.find((it) => it.key === field);
      return item && item.options[i] ? item.options[i].text : String(vals[i]);
    }
    // the settings that differ from the arcade's, as lines of [label, value] pairs fitting `width` columns (drawn with
    // the option's name white and its value in Pac-Man yellow: the author, 2026-11-15); summary() is the same as text
    function summaryParts(width, cfg) {
      cfg = cfg || g.config;
      const diffs = [];
      for (const [k, vals] of SK.FIELDS) {
        const i = vals.indexOf(cfg[k]) >= 0 ? vals.indexOf(cfg[k]) : vals.indexOf(!!cfg[k]);
        const d = vals.indexOf(g.defaultConfig[k]);
        if (i !== d) diffs.push([LABELS[k], optionText(k, vals, i)]);
      }
      if (!diffs.length) return [[["", "classic Pac-Man"]]]; // the untouched settings: the original arcade game (the author's name, 2026-11-14)
      const lines = [], len = (line) => line.reduce((n, [l, v]) => n + (n ? 2 : 0) + (l ? l.length + 1 : 0) + v.length, 0);
      for (const d of diffs) {
        const last = lines[lines.length - 1], dl = len([d]);
        if (last !== undefined && len(last) + 2 + dl <= width) last.push(d);
        else lines.push([d]);
      }
      return lines;
    }
    const partsText = (line) => line.map(([l, v]) => (l ? l + " " : "") + v).join("  ");
    function summary(width, cfg) { return summaryParts(width, cfg).map(partsText); }
    // a board's settings, or the pick's name when it's one of Pinback's Picks (leaderboard and arena pages; not Classic
    // Pac-Man, which stays "classic Pac-Man" whatever the pick is called)
    function boardParts(width, key) {
      const pick = key !== SK.keyFor(g.defaultConfig) && picksGet().list.find((f) => f.board === key);
      if (pick) return [[["", "pinback's pick"]], [["", pick.name, 6]]];
      return summaryParts(width, SK.configFor(key));
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
    // new arenas (the author, 2026-11-16): the newest arena this browser has seen in the arena list ("createdAt", server
    // ms; 0: never looked, so every open arena is new). The title shows a pulsing green energizer by ARENAS while an open
    // arena is newer; the list marks those the same way on that visit, and visiting clears them
    const SEEN = "booze-elroy-arenas-seen";
    let seenAt = Number(store.get(SEEN, 0)) || 0;
    const openArenas = () => arenaList.arenas.filter((a) => a && a.endsAt > serverNow());
    const hasNewArena = () => arenaList.status === "ok" && openArenas().some((a) => a.createdAt > seenAt);
    function markArenasSeen() {
      const newest = Math.max(seenAt, ...arenaList.arenas.map((a) => a.createdAt || 0));
      if (newest > seenAt) { seenAt = newest; store.set(SEEN, seenAt); }
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
    let borrowHome = null; // the page a borrowed board's games come back to ("leaderboard" now for picks too)
    let fromPick = false; // the borrowed board is one of Pinback's Picks: its leaderboard's Back goes to the picks
    const arenaOpen = (a) => !!a && serverNow() < a.endsAt;
    function applyArena(a) {
      if (!ownConfig) ownConfig = { ...g.config };
      Object.assign(g.config, SK.configFor(a.board), { startingLevel: 1 });
    }
    function applyBoard(key, home) {
      if (!ownConfig) ownConfig = { ...g.config };
      Object.assign(g.config, SK.configFor(key));
      playingBoard = key; arena = null; borrowHome = home || "leaderboard";
    }
    function leaveArena() {
      // the player's own settings come back, except CRT: the C key may have toggled it meanwhile (main.js saves it)
      if (ownConfig) { const crt = g.config.crtEffect; Object.assign(g.config, ownConfig, { crtEffect: crt }); ownConfig = null; }
      arena = null; playingBoard = null; borrowHome = null; fromPick = false;
    }
    const borrowed = () => !!ownConfig; // someone else's settings are applied: never save them as the player's
    const ownSettings = () => ownConfig || g.config; // the player's own settings, borrowed or not
    const inArena = () => !!ownConfig && !playingBoard;
    // where quitting a game (Esc / the X button) goes: back to the arena or leaderboard it was started from, else the title
    const quitGameTo = () => (!ownConfig ? null : playingBoard ? borrowHome : "arena");
    // straight into a game (the title's "play" step only runs on the title scene, which would give the settings back)
    // (the coin drop after the switch: starting the game scene silences every sound, so played first it was cut off at once
    // on these pages; the title's Play 1P waits a moment before switching, so it kept its coin: the author noticed)
    function startGame() { g.autoplay = false; g.attract = false; core.setScene("game"); sfx("coindrop"); }
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
    // (NEAT: its own list, ?neat=1; switching NEAT on or off fetches the other)
    const boardList = { status: api ? "loading" : "error", boards: [], p: null, neat: false };
    function loadBoardList() {
      if (!api) return Promise.resolve(boardList);
      const neat = neatOn();
      if (boardList.neat !== neat) { boardList.neat = neat; boardList.boards = []; boardList.status = "loading"; boardList.p = null; }
      if (boardList.p) return boardList.p;
      boardList.p = fetchFn(api + "/boards" + (neat ? "?neat=1" : ""), { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
        .then((d) => { if (boardList.neat !== neat) return; boardList.boards = (d.boards || []).filter((b) => (neat ? SK.isNeat(b.board) && SK.isBoardKey(b.board) : SK.isKey(b.board))); boardList.status = "ok"; })
        .catch(() => { if (boardList.status !== "ok") boardList.status = "error"; })
        .finally(() => { boardList.p = null; });
      return boardList.p;
    }

    // PLAY 1P plays the board on show (its settings borrowed for the game); Share Config only when the page can copy
    // links (opts.share; it shares the board on show)
    // (Add Favorite: the author, 2026-11-15; sharing settings is a favorite's job now, so no Share Config here)
    const SHARE_X = 216, DEL_X = 206; // (where render.js draws a replay's share icon, and the author's delete X, game px)
    // replays (EXPERIMENTAL, 2026-11-18): a score that has one (rid) plays it when clicked / tapped, or by its rank's number
    // key (1-9, 0 for 10); back: how to come back to the page afterwards
    async function watch(e, url, back) {
      if (!e || !e.rid || !opts.watch) return;
      g.toast = { text: "loading replay", until: performance.now() + 4000 };
      let r = null;
      try { r = await fetchFn(url + "/replay?id=" + encodeURIComponent(e.rid), { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)); } catch { r = null; }
      g.toast = null;
      if (!r || !r.replay) { g.toast = { text: "replay not available", until: performance.now() + 2500 }; return; }
      opts.watch(r.replay, e.name, back, e.rid);
    }
    // a page's score rows as links (render.js notes where it drew them, sc.rowRects) for the ones with a replay
    // (and its share icon at the row's right end, which copies a ?replay= link: the author, 2026-11-18; listed first, so a
    // click on the icon shares rather than watches)
    // (and, for the author's account only, an X left of the share icon that deletes the replay, the score staying:
    // 2026-11-19; del: how to on this page, posting { board } or { id } with the rid; the server checks the login too)
    function rowLinks(sc, url, back, del) {
      const b = sc.board(), rows = (sc.rowRects || []).filter((rr) => b.entries[rr.i] && b.entries[rr.i].rid);
      sc.canDelete = !!del && isOwner();
      const share = opts.shareReplay ? rows.map((rr) => ({ x0: SHARE_X - 3, y0: rr.y * 8 - 1, x1: 224, y1: rr.y * 8 + 9, share: true, action: () => opts.shareReplay(b.entries[rr.i].rid) })) : [];
      const dels = sc.canDelete ? rows.map((rr) => ({ x0: DEL_X - 2, y0: rr.y * 8 - 1, x1: SHARE_X - 3, y1: rr.y * 8 + 9, del: true, action: () => del(b.entries[rr.i]) })) : [];
      const end = sc.canDelete ? DEL_X - 2 : opts.shareReplay ? SHARE_X - 3 : 224;
      return [...share, ...dels, ...rows.map((rr) => ({ x0: 0, y0: rr.y * 8, x1: end, y1: rr.y * 8 + 8, action: () => watch(b.entries[rr.i], url, back) }))];
    }
    const isOwner = () => !!(opts.playerName && opts.playerName() === "PINBACK");
    async function unreplay(e, url, body, done) {
      if (!e || !e.rid || (typeof confirm === "function" && !confirm("Delete this replay? (The score stays.)"))) return;
      let r = null;
      try { r = await post2(url + "/unreplay", { ...body, rid: e.rid }); } catch { r = null; }
      if (r && r.ok && r.data) { done(r.data.entries || []); g.toast = { text: "replay deleted", until: performance.now() + 2000 }; }
      else g.toast = { text: "could not delete it" + (r ? " (" + r.status + ")" : ""), until: performance.now() + 2500 };
    }
    const watchKey = (sc, key, url, back) => {
      const n = key === "0" ? 10 : /^[1-9]$/.test(key) ? Number(key) : 0;
      if (!n) return false;
      const e = sc.board().entries[n - 1]; if (e && e.rid) watch(e, url, back);
      return true;
    };
    const lbMenu = Object.assign([
      { text: "Play 1P", x: 10.5, y: 31, action() { applyBoard(leaderboard.key); startGame(); } },
      ...(opts.addFavorite ? [{ text: "Add Favorite", x: 8, y: 33, action() { opts.addFavorite(leaderboard.key); } }] : []),
      { text: "Back", x: 12, y: 35, action() { core.setScene(fromPick ? "picks" : "attract", true); } }, // (a pick's board: back to the picks)
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
        this.key = o.key || currentKey(); // (o.key: back from a replay of this board)
        lbMenu.selectedItem = 1;
        if (!o.fresh) load(this.key, true);
        loadBoardList();
        if (opts.picks) opts.picks.load(); // (to name the boards that are picks: fresh every time, so a renamed pick shows at once)
        const lx = (x, n) => ({ x0: x * 8 - 6, y0: 3 * 8, x1: (x + n) * 8 + 6, y1: 6 * 8 }); // roomy: the CRT curve bends the corners
        this.navLinks = [{ ...lx(4, 4), action: () => this.flip(-1) }, { ...lx(20, 4), action: () => this.flip(1) }];
        this.links = this.navLinks;
      },
      update() {
        this.fc += 1;
        const key = this.key; // (and the scores with a replay, clickable)
        this.links = [...this.navLinks, ...rowLinks(this, api, () => core.setScene("leaderboard", { key }),
          (e) => unreplay(e, api, { board: key }, (entries) => boards.set(key, { status: "ok", entries, at: performance.now() })))];
      },
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
      // a board that's one of Pinback's Picks shows the pick's name instead of its settings (the author, 2026-11-18), but
      // not Classic Pac-Man, which stays "classic Pac-Man" whatever the pick is called
      summaryParts(width) { return boardParts(width, this.key); },
      escape() { lbBack(); }, // (Esc does what Back does: the picks after a pick's game, else the title)
      keypressed(key) {
        const bk = this.key;
        if (watchKey(this, key, api, () => core.setScene("leaderboard", { key: bk }))) return;
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
      if (key === "return" || key === "space") { const it = m[m.selectedItem - 1]; if (!it.coin) wakka(); it.action(); } // (a game starting has its coin drop instead)
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
        this.newSince = seenAt; // the arenas newer than this get the green dot on this visit
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
        if (arenaList.status === "ok") markArenasSeen(); // seen now: the title's dot goes, and next visit's marks start here
        for (const a of open) {
          const it = { id: a.id, text: a.name, x: 2, action: pick(a), fresh: a.createdAt > this.newSince };
          items.push(it);
          rows.push({ h: 2, item: it, draw: (y) => { const t = timeLeft(a.endsAt - now); decor.push({ text: t, x: 26 - t.length, y, o: 2 }); } });
        }
        if (arenaList.status === "ok" && !open.length) rows.push({ h: 2, draw: (y) => decor.push({ text: "no running arenas", x: 14 - 8.5, y, o: 2 }) });
        if (done.length) rows.push({ h: 3, draw: (y) => decor.push({ text: "finished", x: 14 - 4, y: y + 1, o: 3 }) }); // (a blank line above it, centred: the author, 2026-11-16)
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
        if (opts.picks) opts.picks.load(); // (to name a pick's board)
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
        const a = arena; this.links = rowLinks(this, arenaApi, () => core.setScene("arena", { arena: a }), // (scores with a replay)
          (e) => unreplay(e, arenaApi, { id: a.id }, (entries) => arenaBoards.set(a.id, { status: "ok", entries, at: performance.now() })));
      },
      links: [],
      build() {
        const items = [];
        if (arenaOpen(arena) && api) items.push({ text: "Play 1P", coin: true, x: 10.5, y: 30, action: () => this.play() });
        if (opts.addFavorite) items.push({ text: "Add Favorite", x: 8, y: 31.5, action: () => opts.addFavorite(arena.board) });
        if (opts.shareArena) items.push({ text: "Share Arena", share: true, x: 8.5, y: 33, action: () => opts.shareArena(arena.id) });
        items.push({ text: "Back", x: 12, y: 34.5, action: () => this.back() });
        rebuildMenu(this, items);
      },
      play() { applyArena(arena); startGame(); },
      back() { leaveArena(); core.setScene("arenas"); },
      title() { return arena.name; },
      subtitle() { return arenaOpen(arena) ? "ends in " + timeLeft(arena.endsAt - serverNow()) : "finished"; },
      summary(width) { return summary(width, SK.configFor(arena.board)); },
      summaryParts(width) { return boardParts(width, arena.board); }, // (a pick's name, like the leaderboard page: the author, 2026-11-20)
      board() { return arenaBoards.get(arena.id) || { status: "loading", entries: [] }; },
      emptyText(b) { return b.status === "loading" ? "loading" : b.status === "gone" ? "arena not found" : b.status === "error" ? "try again soon" : "no scores yet"; },
      keypressed(key) {
        if (key === "escape" || key === "backspace") { wakka(); this.back(); return; }
        const a = arena;
        if (watchKey(this, key, arenaApi, () => core.setScene("arena", { arena: a }))) return;
        menuKeys(this, key);
      },
      gamepadpressed(button) {
        if (button === "b") this.back();
        else if (button === "start") core.setScene("attract");
        else menuPad(this, button);
      },
    };

    // ---------------------------------------------------------------- favorites (the author, 2026-11-15)
    // the list: a name a row (picking one opens its page), the highlighted one's settings underneath. opts.favorites:
    // { get() -> { status, list: [{ name, board }] }, load(), remove(name) -> Promise }
    const FAV_TOP = 6;
    const favGet = () => (opts.favorites ? opts.favorites.get() : { status: "error", list: [] });
    const favoritesScene = {
      name: "favorites",
      menu: Object.assign([], { selectedItem: 1 }),
      decor: [], links: [],
      start() {
        leaveArena();
        this.menu = Object.assign([], { selectedItem: 1 }); this.hadList = false;
        if (opts.favorites) opts.favorites.load();
        this.build(); this.menu.selectedItem = 1;
      },
      update() { this.build(); },
      status() { return favGet().status; },
      title() { return "favorites"; },
      headerKey() { const it = this.menu[this.menu.selectedItem - 1]; return it && it.fav ? it.fav.board : null; },
      build() {
        const f = favGet(), decor = [];
        const items = f.list.map((fav, i) => ({ id: "f:" + fav.name, text: fav.name, x: 2, y: FAV_TOP + i, fav, action: () => core.setScene("favorite", { fav }) }));
        items.push({ text: "Back", x: 12, y: 31, action() { core.setScene("attract", true); } });
        rebuildMenu(this, items);
        if (!this.hadList && f.list.length) this.menu.selectedItem = 1; // the list just arrived: its first, not Back
        this.hadList = f.list.length > 0;
        const mid = (t, y, o) => decor.push({ text: t, x: 14 - t.length / 2, y, o });
        if (!f.list.length) {
          if (f.status === "loading" || f.status === "none") mid("loading", 12, 0);
          else if (f.status === "error") mid("try again soon", 12, 0);
          else { mid("no favorites yet", 11, 2); mid("add one from options,", 14, 0); mid("a leaderboard or an arena", 16, 0); }
        }
        const sel = this.menu[this.menu.selectedItem - 1];
        // (up to 8 lines, rows 22-29, above Back: every setting shows)
        if (sel && sel.fav) summaryParts(28, SK.configFor(sel.fav.board)).slice(0, 8).forEach((line, i) => { // name white, value yellow
          let x = 14 - partsText(line).length / 2;
          for (const [l, v] of line) {
            if (l) { decor.push({ text: l, x, y: 22 + i, o: 0 }); x += l.length + 1; }
            decor.push({ text: v, x, y: 22 + i, o: l ? 6 : 0 }); x += v.length + 2;
          }
        });
        this.decor = decor;
      },
      keypressed(key) {
        if (key === "escape" || key === "backspace") { wakka(); core.setScene("attract", true); return; }
        menuKeys(this, key);
      },
      gamepadpressed(button) { if (button === "b") core.setScene("attract", true); else menuPad(this, button); },
    };
    // one favorite: its settings and that board's top 10 (drawn like the leaderboard page); Play 1P makes them the
    // player's settings and starts a game; Create Arena makes an arena with them; Remove
    const favoriteScene = {
      name: "favorite",
      captureInput: true,
      layout: { summaryTop: 5, summaryLines: 4, listTop: 10, messageRow: 29 },
      menu: Object.assign([], { selectedItem: 1 }),
      fav: null, highlight: null, message: null, fc: 0,
      start(o) {
        o = o || {};
        if (o.fav) { // opened from the list: its settings become the player's own at once, saved (the author, 2026-11-16:
          this.fav = o.fav; // picking one of your own favorites is enough; Pinback's Picks are still only borrowed)
          leaveArena();
          Object.assign(g.config, SK.configFor(this.fav.board));
          if (opts.saveSettings) opts.saveSettings();
        }
        this.fc = 0; this.highlight = null; this.message = null;
        load(this.fav.board, true);
        const items = [{ text: "Play 1P", coin: true, x: 10.5, y: 30, action: () => this.play() }];
        // (it had Share, copying a ?cfg= link; the author, 2026-11-16: nobody shares settings, they make an arena for their friends)
        items.push({ text: "Create Arena", x: 8, y: 31.5, action: () => createArena("favorite", this.fav.board) });
        items.push({ text: "Remove", x: 11, y: 33, action: () => this.remove() });
        items.push({ text: "Back", x: 12, y: 34.5, action: () => core.setScene("favorites") });
        this.menu = Object.assign(items, { selectedItem: 1 });
      },
      update() { // (scores with a replay)
        this.fc += 1; const key = this.fav.board;
        this.links = rowLinks(this, api, () => core.setScene("favorite"), (e) => unreplay(e, api, { board: key }, (entries) => boards.set(key, { status: "ok", entries, at: performance.now() })));
      },
      links: [],
      play() {
        leaveArena();
        Object.assign(g.config, SK.configFor(this.fav.board)); // they become the player's own settings (the author)
        if (opts.saveSettings) opts.saveSettings();
        startGame();
      },
      remove() {
        const name = this.fav.name;
        if (opts.favorites) opts.favorites.remove(name);
        g.toast = { text: "removed " + name.toLowerCase(), until: performance.now() + 2000 };
        core.setScene("favorites");
      },
      title() { return this.fav.name; },
      subtitle() { return "favorite"; },
      headerKey() { return this.fav ? this.fav.board : null; },
      summary(width) { return summary(width, SK.configFor(this.fav.board)); },
      summaryParts(width) { return summaryParts(width, SK.configFor(this.fav.board)); },
      board() { return boardFor(this.fav.board); },
      keypressed(key) {
        if (key === "escape" || key === "backspace") { wakka(); core.setScene("favorites"); return; }
        if (watchKey(this, key, api, () => core.setScene("favorite"))) return;
        menuKeys(this, key);
      },
      gamepadpressed(button) { if (button === "b") core.setScene("favorites"); else menuPad(this, button); },
    };

    // ---------------------------------------------------------------- Pinback's Picks (the author, 2026-11-15)
    // the author's favorites for everyone, from the title's sign: the list (like favorites; the highlighted one's
    // settings underneath); picking one starts a game at once (the author: no page of its own), its settings borrowed
    // like the Leaderboards page's, and quitting or finishing comes back to the list, where the player's own come
    // back. Playing one earns "trust me" (opts.pickPlayed). opts.picks: { get() -> { status, list: [{ name, board }] }, load() }
    const picksGet = () => (opts.picks ? opts.picks.get() : { status: "error", list: [] });
    let lastPick = null; // the pick just played: highlighted again back on the list, so Enter plays it again (the author)
    // (its game over, or Esc, lands on that pick's leaderboard, top 10 or not, its settings still borrowed; Back from
    // there returns to the picks: the author, 2026-11-18. It used to come straight back to the picks)
    function playPick(fav) { lastPick = fav.name; applyBoard(fav.board, "leaderboard"); fromPick = true; if (opts.pickPlayed) opts.pickPlayed(); startGame(); }
    const picksScene = {
      name: "picks",
      menu: Object.assign([], { selectedItem: 1 }),
      decor: [], links: [],
      start() {
        leaveArena();
        this.menu = Object.assign([], { selectedItem: 1 }); this.hadList = false;
        if (opts.picks) opts.picks.load();
        this.build(); // (it highlights the pick last played, else the first)
      },
      update() { this.build(); },
      status() { return picksGet().status; },
      title() { return "pinback's picks"; },
      headerKey() { const it = this.menu[this.menu.selectedItem - 1]; return it && it.fav ? it.fav.board : null; },
      build() {
        const f = picksGet(), decor = [];
        const items = f.list.map((fav, i) => ({ id: "p:" + fav.name, text: fav.name, x: 2, y: FAV_TOP + i, fav, coin: true, action: () => playPick(fav) }));
        items.push({ text: "Back", x: 12, y: 31, action() { core.setScene("attract", true); } });
        rebuildMenu(this, items);
        if (!this.hadList && f.list.length) { // the list just arrived: the pick last played, else the first (not Back)
          const i = lastPick ? f.list.findIndex((fav) => fav.name === lastPick) : -1;
          this.menu.selectedItem = i >= 0 ? i + 1 : 1;
        }
        this.hadList = f.list.length > 0;
        const mid = (t, y, o) => decor.push({ text: t, x: 14 - t.length / 2, y, o });
        if (!f.list.length) {
          if (f.status === "loading" || f.status === "none") mid("loading", 12, 0);
          else if (f.status === "error") mid("try again soon", 12, 0);
          else mid("nothing picked yet", 12, 2);
        }
        const sel = this.menu[this.menu.selectedItem - 1];
        if (sel && sel.fav) summaryParts(28, SK.configFor(sel.fav.board)).slice(0, 8).forEach((line, i) => { // name white, value yellow
          let x = 14 - partsText(line).length / 2;
          for (const [l, v] of line) {
            if (l) { decor.push({ text: l, x, y: 22 + i, o: 0 }); x += l.length + 1; }
            decor.push({ text: v, x, y: 22 + i, o: l ? 6 : 0 }); x += v.length + 2;
          }
        });
        this.decor = decor;
      },
      keypressed(key) {
        if (key === "escape" || key === "backspace") { wakka(); core.setScene("attract", true); return; }
        menuKeys(this, key);
      },
      gamepadpressed(button) { if (button === "b") core.setScene("attract", true); else menuPad(this, button); },
    };

    // grid cells double as a "menu" so the mouse / touch code can hover and click them

    let pending = null;
    // a score placed on a regular board: opts.placed({ key, rank, score, settings, isDefault, first }) (achievements and the
    // activity log; settings: a one-line summary; first: the board's first ever score)
    const placed = (key, rank, entries, score) => {
      if (rank && opts.placed && !SK.isNeat(key)) opts.placed({ key, rank, score, settings: summary(200, SK.configFor(key)).join("  "), isDefault: key === SK.keyFor(g.defaultConfig), first: rank === 1 && entries.length === 1 });
      // (a NEAT board: no achievements, only the activity page's NEAT log)
      if (rank && opts.neatPlaced && SK.isNeat(key)) opts.neatPlaced({ key, rank, score, settings: "NEAT  " + summary(200, SK.configFor(key)).join("  ") });
    };
    const neMenu = [];
    GRID.forEach((row, r) => { for (let c = 0; c < row.length; c++) neMenu.push({ text: row[c], char: row[c], x: GRID_X + c * 2, y: GRID_Y + r * 2 }); });
    for (const s of SPECIALS) neMenu.push({ text: s.text, x: s.x, y: SPECIAL_Y });
    neMenu.push({ text: "", x: 6.5, y: KEEP_Y }); // save replay yes / no (blank when naming an arena)
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
        this.keepReplay = true; this.keepCol = 4; this.keepText();
        neMenu.selectedItem = (this.entry ? END : 0) + 1; // a remembered name is one press from done
        // logged in (opts.playerName): the account's name is filled in, one press from done, and can still be changed
        // (an actual player missed putting funny names up, so the author made it a pre-fill, not an auto-save)
        // (and once the account has put a score up under another name, that name: the player's request, 2026-11-16)
        const player = this.mode === "score" && opts.playerName && SK.cleanName(opts.playerName() || "");
        if (player) {
          const last = store.get(nameKey(), "");
          this.entry = (typeof last === "string" && SK.cleanName(last)) || player; neMenu.selectedItem = END + 1;
        }
        // the hidden games (Elroids, Booze Invaders): this same screen for their boards (the author: "just like the Pac-Man
        // one"), opened over the game by main.js, which hands its keys straight here (never through a recording game's
        // replay); done(result) goes back to it. Their own remembered name, else the account's
        if (this.mode === "mini") {
          this.onDone = o.onDone; this.top = o.top || o.score; this.board = o.board; this.title = o.title;
          const last = store.get(elNameKey(), "");
          this.entry = (typeof last === "string" && SK.cleanName(last)) || SK.cleanName((opts.playerName && opts.playerName()) || "") || "";
          neMenu.selectedItem = (this.entry ? END : 0) + 1;
        }
      },
      finish(r) { const f = this.onDone; this.onDone = null; if (f) f(r); },
      update() {
        this.fc += 1;
        if (this.sending || this.mode === "createArena") return;
        this.timer -= 1;
        if (this.timer <= 0) { if (this.entry.trim()) this.submit(); else this.leave(); }
      },
      leave() { if (this.mode === "mini") { this.finish(null); return; } core.setScene(this.mode === "createArena" ? this.from || "arenas" : quitGameTo() || "attract"); },
      summary(width) { return summary(width); },
      summaryParts(width) { return summaryParts(width); },
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
        else if (i === KEEP) { if (this.mode === "score") { this.keepReplay = !this.keepReplay; this.keepText(); wakka(); } }
        else if (this.entry.trim()) this.submit();
      },
      keepText() { neMenu[KEEP].text = this.mode === "score" ? "save replay " + (this.keepReplay ? "yes" : "no") : ""; },
      move(dr, dc) {
        const i = neMenu.selectedItem - 1, rows = this.mode === "score" ? NROWS : NROWS - 1; // (no replay row naming an arena)
        let r = 0; while (r < rows - 1 && i >= ROW_START[r + 1]) r++;
        let c = i - ROW_START[r];
        if (dr) {
          const col = r === SPECIAL_ROW ? SPECIAL_COL[c] : r === KEEP_ROW ? this.keepCol : c; // keep roughly the same column
          r = (r + dr + rows) % rows;
          if (r === KEEP_ROW) this.keepCol = col; // (the one-item replay row remembers the column it was entered from)
          c = r === SPECIAL_ROW ? (col < 3 ? 0 : col < 7 ? 1 : 2) : r === KEEP_ROW ? 0 : Math.min(col, ROW_LEN[r] - 1);
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
        if (this.mode === "mini") return this.submitMini(name);
        store.set(nameKey(), name); // remembered for next time (logged in: for this account)
        if (this.arenaId) return this.submitArena(name);
        let res = null;
        const replay = this.keepReplay && opts.replay ? await opts.replay(this.score) : null; // (its replay goes up with it, unless the player said no: kept if it places)
        const body = { board: this.key, name, score: this.score, settings: (SK.isNeat(this.key) ? "NEAT  " : "") + summary(200, SK.configFor(this.key)).join("  ") };
        try { res = await post("", { ...body, ...(replay ? { replay } : {}) }); } catch { res = null; }
        // a replay must never cost a score: refused with one, the score goes again without it
        if (replay && res && (res.status === 400 || res.status === 413)) { try { res = await post("", body); } catch { res = null; } }
        if (taken(res)) return this.taken(name);
        if (res && res.ok && res.data) {
          boards.set(this.key, { status: "ok", entries: res.data.entries || [], at: performance.now() });
          placed(this.key, res.data.rank, res.data.entries || [], this.score);
          core.setScene("leaderboard", { fresh: true, highlight: res.data.rank, message: res.data.rank ? null : "not in the top 10" });
        } else core.setScene("leaderboard", { message: "score could not be saved" });
      },
      async submitMini(name) {
        store.set(elNameKey(), name);
        let res = null;
        try { res = await post("", { board: this.board, name, score: this.score, settings: this.board.toUpperCase() }); } catch { res = null; }
        if (taken(res)) { // an account's name: pick another, the clock started over
          if (store.get(elNameKey(), "") === name) store.set(elNameKey(), "");
          this.sending = false; this.message = "that name is taken"; this.entry = ""; this.timer = ENTRY_FRAMES; neMenu.selectedItem = 1; return;
        }
        if (res && res.ok && res.data) {
          if (res.data.rank && opts.miniPlaced) opts.miniPlaced(this.board, res.data.rank, this.score); // (logged in: the activity page)
          this.finish({ entries: res.data.entries || [], rank: res.data.rank || null }); return;
        }
        this.finish(null);
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
      // the name is an account's (and this isn't its login): pick another one, with the clock started over
      taken(name) {
        this.sending = false; this.message = "that name is taken";
        if (store.get(nameKey(), "") === name) store.set(nameKey(), "");
        this.entry = ""; this.timer = ENTRY_FRAMES; neMenu.selectedItem = 1;
      },
      // a game in an arena: the arena board, and the regular board for these settings too
      async submitArena(name) {
        const replay = this.keepReplay && opts.replay ? await opts.replay(this.score) : null;
        // (with its replay; refused with one, each goes again without it: a replay must never cost a score)
        const again = async (send, body) => { let r = await send(replay ? { ...body, replay } : body).catch(() => null); if (replay && r && (r.status === 400 || r.status === 413)) r = await send(body).catch(() => null); return r; };
        const [ar, gr] = await Promise.all([
          again((b) => post2(arenaApi + "/score", b), { id: this.arenaId, name, score: this.score }),
          again((b) => post("", b), { board: this.key, name, score: this.score, settings: (SK.isNeat(this.key) ? "NEAT  " : "") + summary(200, SK.configFor(this.key)).join("  ") }),
        ]);
        if (taken(ar) || taken(gr)) return this.taken(name);
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
    function afterGameOver(score, testMode) {
      // test mode (xyzzy) shows what the ghosts are up to: its games stay off the boards and arenas (the author, 2026-11-16)
      if (testMode) return !ownConfig ? null : playingBoard ? borrowHome : "arena"; // (silently: the author)
      if (neatOn() && ownConfig && !playingBoard) return "arena"; // (NEAT: never an arena's, silently; the author, 2026-11-22)
      if (ownConfig && !playingBoard) return afterArenaGame(score);
      // a game borrowed from the Leaderboards page ends back on that board
      return afterBoardGame(score) || (playingBoard ? borrowHome : null);
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
    // key: the settings (a board key) the arena gets; the current ones if not given (a favorite's page gives its own)
    const createArena = (from, key) => {
      if (opts.playerName && !opts.playerName()) { g.toast = { text: "log in to create an arena", until: performance.now() + 2500 }; return; }
      core.setScene("nameEntry", { mode: "createArena", from, ...(key ? { key } : {}) });
    };
    // every replay there is, on every board and arena (the olive's endless loop, main.js): [{ rid, name, url }]; one
    // request for the boards and one for the arenas (it used to fetch every board in turn: slow, the author noticed)
    async function allReplays() {
      const get = async (base) => { if (!base) return []; try { const r = await fetchFn(base + "/replays", { cache: "no-store" }); const d = r.ok ? await r.json() : null; return (d && d.replays || []).map((e) => ({ ...e, url: base })); } catch { return []; } };
      const [b, a] = await Promise.all([get(api), get(arenaApi)]);
      return [...b, ...a];
    }
    async function fetchReplay(it) {
      try { const r = await fetchFn(it.url + "/replay?id=" + encodeURIComponent(it.rid), { cache: "no-store" }).then((x) => (x.ok ? x.json() : null)); return r && r.replay; } catch { return null; }
    }
    return { allReplays, fetchReplay, summaryParts, attach, scenes: { leaderboard, nameEntry, arenas, arena: arenaScene, favorites: favoritesScene, favorite: favoriteScene, picks: picksScene }, tick, wakka, inArena, borrowed, ownSettings, quitGameTo, createArena, leaveArena, loadArenas, arenaList, deleteArena, openArena, currentArena: () => arena, saveBest, afterGameOver, reset, load, boards, summary, BOARD_SIZE };
  }

  root.BoozeLeaderboard = { create };
})(typeof self !== "undefined" ? self : this);
