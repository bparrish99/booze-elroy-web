/* Booze Elroy - the Rewind ability (web-edition addition, not in the Lua original).
 * Ability button: the last 3 seconds of play run backwards on screen at 2x speed (VCR style), then play resumes from
 * there. One charge, refilled by every new life and every new board. Death can't be undone: snapshots are only taken in
 * normal play, and the history is dropped whenever play stops (caught, level complete, ...), so a rewind never reaches
 * back across a life or a board.
 *
 * A snapshot is the game state as data: every plain value on g (all of them, minus a few that aren't gameplay), the dots
 * and energizers, the characters, the particles, the frame state and the level's scatter/chase timer. It is restored
 * in place, into the very same objects, because the characters' animators and brains are closures over those objects.
 * The RNG isn't rewound (nothing needs it to be: the ghosts just roll their frightened turns afresh).
 */
(function (root) {
  "use strict";
  const HISTORY = 180;  // frames kept: 3 seconds
  const SPEED = 2;      // playback: 2 frames of history per screen frame (3 s back in 1.5 s, slow enough to follow)
  // plain values on g that aren't part of the play to rewind (settings, scene and mode bookkeeping, presentation)
  const SKIP = new Set(["scaleOption", "autoplay", "currentMaze", "mode", "attract", "muted", "levelNumber", "paused",
    "currentMazeColor", "currentBackground", "modeTimer", "diedSoundPlayed", "newLevel", "rewindSpent", "rewinding"]);
  // state kept in objects, captured explicitly
  const OBJECTS = new Set(["state", "particles", "powers", "dots", "chars", "level"]);

  const isObj = (v) => v !== null && typeof v === "object";
  /** deep copy of an object's data (functions left out) */
  function data(v) {
    if (Array.isArray(v)) return v.map(data);
    if (!isObj(v)) return v;
    const out = {};
    for (const k of Object.keys(v)) if (typeof v[k] !== "function") out[k] = data(v[k]);
    return out;
  }
  /** make obj's data equal to snap again, keeping the object (and its functions) */
  function restoreInto(obj, snap) {
    for (const k of Object.keys(obj)) if (typeof obj[k] !== "function" && !(k in snap)) delete obj[k];
    for (const k of Object.keys(snap)) obj[k] = data(snap[k]);
  }

  const plainKey = (g, k) => !SKIP.has(k) && !OBJECTS.has(k) && typeof g[k] !== "function" && !isObj(g[k]);
  function snapshot(g) {
    const s = { plain: {}, chars: {}, dots: g.dots.map((d) => [d, data(d)]), powers: g.powers.map((p) => [p, data(p)]),
      particles: data(g.particles), state: [g.state, data(g.state)], level: { timer: g.level.timer, chase: g.level.chase } };
    for (const k of Object.keys(g)) if (plainKey(g, k)) s.plain[k] = g[k];
    for (const n of g.charOrder) s.chars[n] = data(g.chars[n]);
    return s;
  }
  function restore(g, s) {
    for (const k of Object.keys(g)) if (plainKey(g, k) && !(k in s.plain)) delete g[k]; // not set yet back then
    for (const k of Object.keys(s.plain)) g[k] = s.plain[k];
    for (const n of g.charOrder) restoreInto(g.chars[n], s.chars[n]);
    const refill = (arr, saved) => { arr.length = 0; for (const [o, d] of saved) { restoreInto(o, d); arr.push(o); } };
    refill(g.dots, s.dots); refill(g.powers, s.powers);
    g.particles.length = 0; for (const p of s.particles) g.particles.push(data(p));
    // g.state is usually the normal mode's own (shared) state object, but on the first frame of play it is still the one
    // READY made: put back the same object, then its contents (never pour one into the other)
    g.state = s.state[0]; restoreInto(g.state, s.state[1]);
    g.level.timer = s.level.timer; g.level.chase = s.level.chase;
  }

  function create(core) {
    const g = core.g;
    let history = [];          // oldest first
    let playback = null;       // { i } while the rewind plays on screen
    let lastMode = null;
    g.rewindSpent = false; g.rewinding = false;
    const enabled = () => g.scene.name === "game" && !g.attract && !g.autoplay && g.config.ability === core.REWIND;

    /** after every game frame: keep the history, refill the charge on a new life / board */
    function record() {
      if (playback) return; // the playback restores old frames: they're not new history
      if (g.scene.name !== "game") { history = []; lastMode = null; return; }
      if (g.mode !== lastMode) { if (g.mode === "ready") g.rewindSpent = false; lastMode = g.mode; }
      if (!enabled()) { history = []; return; }
      if (g.mode === "normal") {
        history.push(snapshot(g));
        if (history.length > HISTORY + 1) history.shift();
      } else if (g.mode !== "ateGhost") history = []; // play stopped (a death, the board done, ...): nothing to go back to
    }
    /** the ability button (core calls env.rewind() during normal play) */
    function trigger() {
      if (!enabled() || playback || g.rewindSpent || g.mode !== "normal" || history.length < 2) return;
      g.rewindSpent = true; g.rewinding = true;
      const s = g.sounds.phase; if (s.isPlaying()) s.stop(); s.play(); // the abilities' activation sound
      for (const n of ["siren1", "siren2", "siren3", "siren4", "siren5", "scared", "dead", "thrust"]) g.sounds[n].stop();
      history.pop(); // the current frame
      playback = { i: history.length - 1 };
    }
    /** in place of the game's own update while the rewind plays; true if it took the frame */
    function update() {
      if (!playback) return false;
      if (g.scene.name !== "game") { playback = null; g.rewinding = false; history = []; return false; }
      playback.i = Math.max(0, playback.i - SPEED);
      restore(g, history[playback.i]);
      if (playback.i === 0) { // back as far as it goes: play on from here
        history = []; // the frame it lands on is recorded by record(), like any other
        playback = null; g.rewinding = false;
        core.resyncLoops();
      }
      return true;
    }
    return { record, trigger, update, active: () => !!playback, historyLength: () => history.length };
  }

  const api = { create, snapshot, restore, HISTORY, SPEED, SKIP };
  root.BoozeRewind = api;
  if (typeof module === "object" && module.exports) module.exports = api; // Node (tests)
})(typeof self !== "undefined" ? self : globalThis);
