/* Booze Elroy - leaderboard replays (web edition, the author's idea, 2026-11-18; EXPERIMENTAL).
   The game is deterministic: the same settings, random seed and inputs give the same game, frame for frame (the golden
   replay test proves it every run). So a replay is no video, just those: the settings, the seed, and the player's input
   per game step (the direction keys held, as a bitmask, and every key / button pressed). Watching one re-runs the game
   with them, in the real renderer. Recorded for every real game; uploaded with a score that makes a top 10.
   Time is counted in steps of play only (core env.playStep: each update that reads the controls), not every update: so
   the stretches nobody plays (the jingle, READY, deaths, board ends), which Pro Mode shortens or skips, don't matter, and a
   replay is watched with the viewer's own Pro Mode (the author: a pro's game still shows the jingle to a viewer without).
   Format v1: { v: core.REPLAY_VERSION, seed, cfg: {gameplay settings, startingLevel}, keys: "<delta>.<mask>,..." (base 36,
   a change of held keys, by play step), ev: [[play steps before it, "k" | "g", name], ...], end: play steps, score }. */
(function (root) {
  "use strict";
  // the settings that change how a game plays out (the rest: looks, sound)
  const CFG = ["mazepack", "difficulty", "plusMode", "afterDark", "radar", "startingLives", "freeGuy", "ability", "movement",
    "ghostCount", "pinkyBug", "scatterOption", "freeGhost", "startingLevel"]; // (not proMode: the viewer's own)
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // replays from before version 3 that need the player's own Pro Mode / Random looks to play back right (Pro Mode skipped
  // the first intermission, whose bubbles drew from the game's RNG; before version 2 the Random looks did too): the few on
  // the boards when this came in, each worked out by playing it every way (2026-11-19). While one plays, these are the
  // viewer's for the moment, theirs back after. Every other old one plays as it is (all three version 2s: Pro Mode)
  const OLD = {
    "svzENS4TC7yi": { proMode: false, background: "none", mazeColor: 99 },                         // RJ REPLAY, 50,000
    "S1Gsyiwb5zaI": { proMode: false, background: "random", mazeColor: 99 },   // PINBACK REPLAY, 24,690
    "KMe-1b0ilrRX": { background: "random", mazeColor: 99 },                   // PINBACK REPLAY2, 7,510
  };
  function create(core, opts) {
    const KEYS = Object.keys(core.constants.JOY_DIRS);             // the direction keys the game reads, a bit each
    let rand = Math.random;                                         // the core's RNG (main.js passes rng: () => replay.rng())
    let rec = null, play = null, step = 0, idle = 0; // step: steps of play so far; idle: updates since the last one

    function maskOf(isDown) { let m = 0; KEYS.forEach((k, i) => { if (isDown(k)) m |= 1 << i; }); return m; }

    const api = {
      rng: () => rand(),
      recording: () => !!rec && !play,
      playing: () => !!play,
      info: () => play && { name: play.name, speed: play.speed, paused: play.paused, old: play.old },
      /** a real game is starting (core env.gameStarting): seed it, and record it (unless it's a replay starting) */
      gameStarting() {
        if (play) { rand = mulberry32(play.data.seed); step = 0; idle = 0; play.ki = 0; play.ei = 0; play.mask = 0; return; }
        const seed = (Math.random() * 4294967296) >>> 0;
        rand = mulberry32(seed); step = 0;
        const cfg = {}; for (const k of CFG) cfg[k] = core.g.config[k];
        // (prev: the maze on show before the game: a pack's first pick avoids repeating it, so playback puts it back first)
        rec = { v: core.REPLAY_VERSION, seed, cfg, prev: core.g.currentMaze, keys: [], ev: [], mask: 0, end: 0, score: 0 };
      },
      /** before each update (main.js): a replay's presses made after this many steps of play go in now */
      beforeStep() {
        if (!play) return;
        const d = play.data;
        while (play.ei < d.ev.length && d.ev[play.ei][0] <= step) { const [, t, n] = d.ev[play.ei++]; if (t === "k") opts.keypressed(n); else opts.gamepadpressed(n); }
        if (++idle > 3600) api.finish(); // a minute with no play: it went out of step somewhere
      },
      afterStep() {},
      /** a step of play, about to read the controls (core env.playStep): note the held keys, or set the replay's */
      playStep(isDown) {
        idle = 0;
        if (play) {
          const d = play.data;
          while (play.ki < d.keys.length && d.keys[play.ki][0] <= step) { play.mask = d.keys[play.ki][1]; play.ki++; }
        } else if (rec) { const m = maskOf(isDown); if (m !== rec.mask) { rec.keys.push([step, m]); rec.mask = m; } }
        if (rec || play) step++;
      },
      /** a key or button reaching the game while recording */
      note(type, name) { if (rec && !play && core.g.scene.name === "game") rec.ev.push([step, type, name]); },
      /** the held keys the game sees: the replay's while one plays */
      isDown(k, real) { if (!play) return real(k); const i = KEYS.indexOf(k); return i >= 0 && !!(play.mask & (1 << i)); },
      /** the game is over (env.afterGameOver): keep the recording's end and score for the score post */
      gameOver(score) { if (rec && !play) { rec.end = step; rec.score = score; rec.done = true; } },
      /** the finished game's replay, packed (gzipped and base64 where the browser can), for a score of `score` */
      async packed(score) {
        if (!rec || !rec.done || rec.score !== score) return null;
        let prev = 0;
        const keys = rec.keys.map(([s, m]) => { const d = s - prev; prev = s; return d.toString(36) + "." + m.toString(36); }).join(",");
        const json = JSON.stringify({ v: rec.v, seed: rec.seed, cfg: rec.cfg, prev: rec.prev, keys, ev: rec.ev, end: rec.end, score: rec.score });
        try {
          if (typeof CompressionStream === "undefined") throw new Error("no gzip");
          const buf = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
          let bin = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
          return "gz:" + btoa(bin);
        } catch { return "js:" + json; }
      },
      /** unpack a stored replay -> its data, or null */
      async unpack(s) {
        try {
          let json;
          if (s.startsWith("gz:")) {
            const bin = atob(s.slice(3)), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
            json = await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
          } else if (s.startsWith("js:")) json = s.slice(3);
          else return null;
          const d = JSON.parse(json); let at = 0;
          d.keys = d.keys ? d.keys.split(",").map((p) => { const [a, b] = p.split("."); at += parseInt(a, 36); return [at, parseInt(b, 36)]; }) : [];
          return d;
        } catch { return null; }
      },
      /** watch one: its settings borrowed for the game (the viewer's own come back after), the game re-run from its seed */
      start(data, name, back, rid) {
        rec = null;
        const own = {}; for (const k of CFG) own[k] = core.g.config[k];
        const fix = data.v < 3 && OLD[rid] || null;
        if (fix) for (const k of Object.keys(fix)) own[k] = core.g.config[k];
        // (the header's 1UP: the replay's while it plays, the viewer's back after; the author, 2026-11-19. The high score
        // needs nothing: the page a replay goes back to, a leaderboard or the title, sets its own)
        const shown = { score: core.g.score };
        play = { data, name, back, rid, fix, own, shown, speed: 1, paused: false, old: data.v !== core.REPLAY_VERSION, ki: 0, ei: 0, mask: 0 };
        Object.assign(core.g.config, data.cfg, fix || {});
        // (the maze before the game, as when it was played; an older replay didn't keep it: none, the pick without a reroll,
        // the same every viewing)
        core.g.currentMaze = data.prev !== undefined ? data.prev : null;
        core.g.autoplay = false; core.g.attract = false;
        core.setScene("game"); // (env.gameStarting seeds it)
      },
      /** done (its game over, Esc, or out of step): the viewer's own settings back, and back to where it was started */
      finish(reason) { // reason: "esc" (the viewer left) or "end" (its game over, or out of step)
        if (!play) return;
        const p = play; play = null; rand = Math.random;
        Object.assign(core.g.config, p.own);
        core.g.score = p.shown.score;
        for (const k of Object.keys(core.g.sounds)) if (core.g.sounds[k].isPlaying()) core.g.sounds[k].stop();
        if (p.back) p.back(reason || "end");
      },
      /** the viewer's keys while a replay plays: Esc leaves, Space / Enter changes speed (1x, 2x, 4x), P pauses */
      viewerKey(k) {
        if (!play) return;
        if (k === "escape" || k === "backspace") api.finish("esc");
        else if (k === "space" || k === "return") play.speed = play.speed >= 4 ? 1 : play.speed * 2;
        else if (k === "p") play.paused = !play.paused;
      },
      speed: () => (play ? (play.paused ? 0 : play.speed) : 1),
      /** a version 1 replay: its style picks drew from the game's RNG (version 2 doesn't), so they must again */
      oldStyleRng: () => !!(play && play.data.v < 2),
      /** a replay recorded before version v is playing */
      olderThan: (v) => !!(play && play.data.v < v),
      /** an older replay (before version 3) recorded without Pro Mode: its game drew the first intermission's bubbles from
       *  the game's RNG, so they must again (Pro Mode skipped them; version 3 never draws them from it). Which ones: the
       *  few on the boards when this came in, worked out by playing each both ways (2026-11-19); others, as with Pro Mode */
      oldIntermissionRng: () => !!(play && play.data.v < 3 && play.fix && play.fix.proMode === false),
    };
    return api;
  }
  root.BoozeReplay = { create, mulberry32 };
})(typeof self !== "undefined" ? self : this);
