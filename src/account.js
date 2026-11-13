/* Booze Elroy - player accounts, browser side (web-edition addition): a username and a password.
 * The session token is kept in localStorage "booze-elroy-account" ({ name, token }) and checked with the server
 * once at start-up (a 401 logs out; no network keeps the saved login). Offline (no apiBase): never logged in.
 * Achievements (src/achievements.js) are earned only while logged in, and kept on the server.
 * Scene "profile" (clicking the name in the header corner): the player's name, their achievements, Log Out, Back.
 */
(function (root) {
  "use strict";
  const KEY = "booze-elroy-account";
  const ACH = root.BoozeAchievements;

  function create(opts) {
    const api = opts.apiBase || null, fetchFn = opts.fetch, storage = opts.storage;
    let me = null;
    try { const v = JSON.parse(storage.getItem(KEY)); if (v && typeof v.name === "string" && typeof v.token === "string") me = v; } catch { /* ignore */ }
    // earned achievements: { status: "none" | "loading" | "ok" | "error", have: { id: ms } }
    let ach = { status: "none", have: {} }, saving = Promise.resolve();
    // the login check / achievements load under way (ready() waits for it, so nothing already earned pops up again)
    let pending = null;
    const track = (p) => { pending = p; p.finally(() => { if (pending === p) pending = null; }); return p; };
    const save = (v) => {
      me = v; ach = { status: "none", have: {} };
      try { if (v) storage.setItem(KEY, JSON.stringify(v)); else storage.removeItem(KEY); } catch { /* ignore */ }
      if (v) loadAchievements();
    };
    const auth = () => (me ? { authorization: "Bearer " + me.token } : {});

    async function call(action, body) {
      if (!api) return { ok: false, status: 0 };
      try {
        const res = await fetchFn(api + "/" + action, { method: "POST", headers: { "content-type": "application/json", ...auth() }, body: JSON.stringify(body || {}) });
        let data = null; try { data = await res.json(); } catch { /* ignore */ }
        return { ok: res.ok, status: res.status, data };
      } catch { return { ok: false, status: 0 }; }
    }
    async function enter(action, name, password) {
      const r = await call(action, { name, password });
      if (r.ok && r.data && r.data.token) save({ name: r.data.name, token: r.data.token });
      return r;
    }
    function loadAchievements() { return track(loadAchievements_()); }
    async function loadAchievements_() {
      if (!api || !me) return;
      const was = me;
      ach = { status: "loading", have: ach.have };
      try {
        const res = await fetchFn(api + "/achievements", { headers: auth(), cache: "no-store" });
        if (me !== was) return;
        if (res.status === 401) { save(null); return; }
        const d = res.ok ? await res.json() : null;
        ach = d && d.achievements ? { status: "ok", have: { ...d.achievements, ...ach.have } } : { status: "error", have: ach.have };
      } catch { if (me === was) ach = { status: "error", have: ach.have }; }
    }
    /** earn an achievement (logged in only): the achievement the first time (shown at once, saved in the background), else null */
    function award(id) {
      if (!me || !ACH.isId(id) || ach.have[id]) return null;
      ach.have = { ...ach.have, [id]: Date.now() };
      // one save at a time: two at once could race on the account's blob
      saving = saving.then(() => call("achievements", { id })).then((r) => { if (r.ok && r.data && r.data.achievements) ach.have = { ...ach.have, ...r.data.achievements }; });
      return ACH.byId(id);
    }

    // ---------------------------------------------------------------- profile scene
    // hooks: wakka() (menu-move sound), setScene(name, opt), toast(text)
    let hooks = null;
    // where render.js drawProfile puts things: the list in rows 8-29, one row per achievement plus a row for the date
    // once it's earned, as many as fit on a page; the "prev  1/2  next" line on row 6 (PAGE_ROW)
    const ROW0 = 8, ROW_LAST = 29, NAME_X = 3, PAGE_ROW = 6;
    /** [[{ name, desc, earned, y }]]: the achievements split into pages, each with its row */
    function layout() {
      const out = [[]];
      let y = ROW0;
      for (const a of ACH.LIST) {
        const it = { name: a.name, desc: a.desc, earned: ach.have[a.id] || null };
        const h = it.earned ? 2 : 1;
        if (y + h - 1 > ROW_LAST) { out.push([]); y = ROW0; }
        out[out.length - 1].push({ ...it, y }); y += h;
      }
      return out;
    }
    const pages = () => layout().length;
    const menu = Object.assign([
      { text: "Log Out", x: 10.5, y: 31, action() { api_.logout(); hooks.toast("logged out"); hooks.setScene("attract", true); } },
      { text: "Back", x: 12, y: 33, action() { hooks.setScene("attract", true); } },
    ], { selectedItem: 2 });
    const move = (d) => { hooks.wakka(); menu.selectedItem = ((menu.selectedItem - 1 + d + menu.length) % menu.length) + 1; };
    const profile = {
      name: "profile", menu,
      page: 0,
      start() { menu.selectedItem = 2; this.page = 0; if (me && ach.status !== "loading") loadAchievements(); },
      update() {},
      flip(d) { const n = pages(); if (n < 2) return; hooks.wakka(); this.page = (this.page + d + n) % n; },
      // the page's achievement names (hovering or tapping one shows its description: main.js, an HTML popup, link.tip),
      // and prev / next when there's more than one page
      get links() {
        // exactly the achievement's own rows (the name, and the date under it once earned): the rows touch, so any
        // padding would overlap the next one and switch late
        const ls = this.pageItems().map((a) => ({ x0: NAME_X * 8 - 4, x1: (NAME_X + a.name.length) * 8 + 4, y0: a.y * 8, y1: (a.y + (a.earned ? 2 : 1)) * 8, tip: a.desc }));
        if (pages() > 1) {
          const t = this.pageLabel(), x = 14 - t.length / 2, y = PAGE_ROW * 8;
          ls.push({ x0: x * 8 - 6, x1: (x + 4) * 8 + 6, y0: y - 4, y1: y + 12, action: () => this.flip(-1) });
          ls.push({ x0: (x + t.length - 4) * 8 - 6, x1: (x + t.length) * 8 + 6, y0: y - 4, y1: y + 12, action: () => this.flip(1) });
        }
        return ls;
      },
      player: () => (me ? me.name : ""),
      // [{ name, desc, earned: ms | null }]: all of them; the page on show (each with its row y)
      achievements: () => ACH.LIST.map((a) => ({ name: a.name, desc: a.desc, earned: ach.have[a.id] || null })),
      pageItems() { const ps = layout(); return ps[Math.min(this.page, ps.length - 1)]; },
      pageLabel() { return pages() < 2 ? "" : "prev   " + (this.page + 1) + "/" + pages() + "   next"; },
      status: () => ach.status,
      keypressed(key) {
        if (key === "return" || key === "space") { hooks.wakka(); menu[menu.selectedItem - 1].action(); }
        else if (key === "left") this.flip(-1);
        else if (key === "right") this.flip(1);
        else if (key === "up") move(-1);
        else if (key === "down") move(1);
      },
      gamepadpressed(button) {
        if (button === "a") menu[menu.selectedItem - 1].action();
        else if (button === "b") menu[1].action();
        else if (button === "dpleft" || button === "leftshoulder") this.flip(-1);
        else if (button === "dpright" || button === "rightshoulder") this.flip(1);
        else if (button === "dpup") move(-1);
        else if (button === "dpdown") move(1);
      },
    };

    /** a top-10 score on a regular board -> how many different boards this account has placed on (null: unknown) */
    // (rank, score, settings: logged on the author's activity page)
    async function placedOn(board, rank, score, settings) {
      if (!me) return null;
      const r = await (saving = saving.then(() => call("placed", { board, rank, score, settings })));
      return r.ok && r.data ? r.data.count : null;
    }
    /** a top-10 score on an arena board (only logged, for the activity page) */
    function arenaPlaced(arena, rank, score) { if (me) saving = saving.then(() => call("placed", { arena, rank, score })); }
    /** a real game started on `day` (the player's "YYYY-MM-DD"), with these settings (a one-line summary) and in this
     *  arena (its name, or null) -> days in a row played (null: unknown). Every game (the activity page logs them) */
    async function playedOn(day, settings, arena) {
      if (!me) return null;
      const r = await (saving = saving.then(() => call("played", { day, settings, arena: arena || "" })));
      return r.ok && r.data ? r.data.streak : null;
    }
    const api_ = {
      online: !!api,
      placedOn, playedOn, arenaPlaced,
      name: () => (me ? me.name : null),
      auth, // { authorization: "Bearer ..." } logged in, else {}
      signup: (name, password) => enter("signup", name, password),
      login: (name, password) => enter("login", name, password),
      async logout() { if (me) { const t = me; save(null); try { await fetchFn(api + "/logout", { method: "POST", headers: { authorization: "Bearer " + t.token } }); } catch { /* ignore */ } } },
      award,
      scenes: { profile },
      attach(h) { hooks = h; },
      /** resolves once the earned achievements are known (or couldn't be loaded): award() before that could take an
       *  old one for new (the arena win checked at start-up, before the list came back) */
      ready: () => pending || Promise.resolve(),
      /** is the saved login still good? (a 401 logs out; a network failure keeps it). Loads the achievements too. */
      verify() { return track(verify_()); },
    };
    async function verify_() {
      if (!api || !me) return;
      const was = me;
      try {
        const res = await fetchFn(api + "/me", { headers: auth(), cache: "no-store" });
        if (me !== was) return;
        if (res.status === 401) { save(null); return; }
        if (res.ok) { const d = await res.json(); if (d && d.name && d.name !== me.name) { save({ ...me, name: d.name }); return; } }
        await loadAchievements_();
      } catch { /* offline: keep it */ }
    }
    return api_;
  }

  root.BoozeAccount = { create };
})(typeof self !== "undefined" ? self : this);
