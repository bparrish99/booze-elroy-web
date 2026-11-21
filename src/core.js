/* Booze Elroy - game logic (port of the Lua source, kept structurally 1:1).
 *
 * Lua/JS traps handled deliberately:
 *  - Lua treats 0 as truthy: variables that can hold `false | number` are tested with T(), never with `if (x)`.
 *  - Lua's % has the sign of the divisor: use mod() wherever a value can be negative.
 *  - pairs(g.chars) is not deterministic in LuaJIT (string-hash order varies per process), so the port pins one
 *    canonical order: Pac-Man first, then the ghosts in the usual sequence (CHAR_ORDER).
 * No DOM access here: this file also runs under Node for the trace comparison against the original Lua.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BoozeCore = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const T = (v) => v !== false && v !== undefined && v !== null;       // Lua truthiness for false|number|nil
  const mod = (a, b) => a - Math.floor(a / b) * b;                      // Lua's %
  const TILE = 8, CENTER = 4, SPEED_FACTOR = 20 / 16;
  const FIXED_DT = 1 / 60.606061;
  const DELTAS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  const JOY_DIRS = { down: 1, right: 0, z: 1, left: 2, up: 3, a: 2, w: 3, d: 0, s: 1, q: 3 };
  const FRUIT_FRIGHT = [6, 6, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
  // ---- EXACT (the side project, 2026-11-20): the arcade's own numbers, read from the ROMs, used only when env.exact()
  // is on (never for the game booze-elroy.com plays). The arcade's speed sets (its table at 0x330F; levels use sets 3-6):
  // speeds as the fractions this game uses, and the scatter / chase switch frames
  const EXACT_SETS = {
    3: { pacSpeed: 0.8, pacFrightenedSpeed: 0.9, elroy2Speed: 0.85, elroy1Speed: 0.8, ghostSpeed: 0.75, frightenedSpeed: 0.5, tunnelSpeed: 0.4, switch: [420, 1620, 2040, 3240, 3540, 4740, 5040] },
    4: { pacSpeed: 0.9, pacFrightenedSpeed: 0.95, elroy2Speed: 0.95, elroy1Speed: 0.9, ghostSpeed: 0.85, frightenedSpeed: 0.55, tunnelSpeed: 0.45, switch: [420, 1620, 2040, 3240, 3540, 65534, 65535] },
    5: { pacSpeed: 1, pacFrightenedSpeed: 1, elroy2Speed: 1.05, elroy1Speed: 1, ghostSpeed: 0.95, frightenedSpeed: 0.6, tunnelSpeed: 0.5, switch: [300, 1500, 1800, 3000, 3300, 65534, 65535] },
    6: { pacSpeed: 0.9, pacFrightenedSpeed: 0.9, elroy2Speed: 1.05, elroy1Speed: 1, ghostSpeed: 0.95, frightenedSpeed: 0.45, tunnelSpeed: 0.5, switch: [300, 1500, 1800, 3000, 3300, 65534, 65535] },
  };
  // and its speed patterns: per set, 32 bits each (the ROM's bytes in its order), rotated left one bit a tick (two ticks a
  // frame), a 1 rotating out = a pixel's step: Pac-Man, Pac-Man frightened, Elroy 2, Elroy 1, ghost, ghost frightened, tunnel
  const EXACT_PATTERNS = {
    3: ["55555555", "d56ad56a", "aa6a55d5", "55555555", "aa2a5555", "92249224", "22222222"],
    4: ["d56ad56a", "d65aadb5", "d65aadb5", "d56ad56a", "aa6a55d5", "92242549", "48242291"],
    5: ["6d6d6d6d", "6d6d6d6d", "b66d6ddb", "6d6d6d6d", "d65aadb5", "25252525", "92249224"],
    6: ["d56ad56a", "d56ad56a", "b66d6ddb", "6d6d6d6d", "d65aadb5", "48242291", "92249224"],
  };
  const PATTERN_KINDS = ["pac", "pacFright", "elroy2", "elroy1", "ghost", "ghostFright", "tunnel"];
  // the ROM's 4 bytes (as stored) -> the 32-bit value its code rotates (high word first, each word little-endian)
  const patternValue = (h) => { const b = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16)); return ((b[1] << 24) | (b[0] << 16) | (b[3] << 8) | b[2]) >>> 0; };
  // Pac-Man Plus's level table (decrypted from pacplus.zip, 7 bytes a level at 0x07AC): [speed set, pen dot limits
  // (pinky, inky, clyde), Elroy dots (1, 2), scare time s, no-dot timer frames, the fruit's scare time s]; level 21 on
  const EXACT_PLUS = [
    [5, 0, 0, 50, 30, 15, 4, 240, 6], [5, 0, 0, 0, 40, 20, 3, 240, 6], [5, 0, 0, 0, 50, 25, 2, 240, 5], [5, 0, 0, 0, 50, 25, 2, 240, 4],
    [5, 0, 0, 0, 60, 30, 2, 180, 3], [5, 0, 0, 0, 60, 30, 4, 180, 5], [5, 0, 0, 0, 80, 40, 2, 180, 3], [5, 0, 0, 0, 80, 40, 1, 180, 3],
    [5, 0, 0, 0, 80, 40, 1, 180, 2], [5, 0, 0, 0, 100, 50, 2, 180, 4], [5, 0, 0, 0, 100, 50, 1, 180, 2], [5, 0, 0, 0, 100, 50, 0, 180, 2],
    [5, 0, 0, 0, 100, 50, 0, 180, 2], [5, 0, 0, 0, 80, 40, 2, 180, 4], [5, 0, 0, 0, 100, 50, 0, 180, 2], [6, 0, 0, 0, 100, 50, 1, 180, 2],
    [6, 0, 0, 0, 120, 60, 0, 180, 2], [6, 0, 0, 0, 120, 60, 2, 180, 2], [6, 0, 0, 0, 120, 60, 0, 180, 1], [6, 0, 0, 0, 120, 60, 0, 180, 1],
    [6, 0, 0, 0, 120, 60, 0, 180, 0],
  ];
  // the speed set a level of this game's own tables runs at (by its speeds)
  const exactSetOf = (l) => (l.ghostSpeed <= 0.75 ? 3 : l.ghostSpeed <= 0.85 ? 4 : l.pacSpeed >= 1 ? 5 : 6);
  const BACKGROUND_OPTIONS = ["none", "stars", "beach", "arcade", "forest", "city", "canyon", "clouds", "planets", "abstract",
    "wave1", "wave2", "lines", "retro", "tan", "aqua", "green", "blue", "purple", "pac1", "pac2", "pac3"]; // (purple: web edition, the author, 2026-11-16)
  const SOUND_NAMES = ["thrust", "crash", "bonk", "ping", "reload", "opening", "wakka1", "wakka2", "fruit", "died", "scared", "ateGhost", "siren1", "siren2", "siren3",
    "siren4", "siren5", "dead", "extrapac", "coindrop", "phase", "intermission1"];
  const LOOPING = new Set(["scared", "siren1", "siren2", "siren3", "siren4", "siren5", "dead"]);
  const MAZE_PACKS = {
    pac: { order: 1, list: ["pac"] },
    mspac: { order: 3, list: ["mspac1", "mspac2", "mspac3", "mspac4"] },
    junior: { order: 4, list: ["junior1", "junior2", "junior3", "junior4", "junior5", "junior6", "junior7"] },
    booze: { order: 2, list: ["booze1", "booze2", "booze3", "booze4"] },
    ultra: { order: 5, list: ["ultra1", "ultra2", "ultra3", "ultra4", "ultra5"] },
    arrange: { order: 6, list: ["arrange1", "arrange2", "arrange3"] },
    mega: { order: 7, list: ["large1"] },
    normal: { order: 8, list: ["pac", "mspac1", "mspac2", "mspac3", "mspac4", "booze1", "booze2", "booze3", "booze4", "ultra1", "ultra2", "ultra3", "ultra4", "ultra5", "arrange1", "arrange2", "arrange3"] },
    // the Lua lists "mega1" here, which does not exist (the only mega maze is "large1"); mapped to it so it cannot crash
    large: { order: 9, list: ["junior1", "junior2", "junior3", "junior4", "junior5", "junior6", "junior7", "large1"] },
  };
  // web edition: mazes made with the maze editor (tools/maze-editor) named booze5, booze6, ... join the booze pack and
  // Normal (after booze4). env.testMaze (the editor's test play) makes every pack that one maze.
  const extraBooze = (DATA) => DATA.mazeNames.filter((n) => /^booze\d+$/.test(n) && !MAZE_PACKS.booze.list.includes(n))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  function mazePacks(DATA, env) {
    const packs = JSON.parse(JSON.stringify(MAZE_PACKS)), extra = extraBooze(DATA);
    packs.booze.list.push(...extra);
    packs.normal.list.splice(packs.normal.list.indexOf("booze4") + 1, 0, ...extra);
    if (env.testMaze) for (const k of Object.keys(packs)) packs[k].list = [env.testMaze];
    return packs;
  }
  const PACK_ORDER = ["pac", "mspac", "junior", "booze", "ultra", "arrange", "mega", "normal", "large"];
  const INDEXES = "123456789ABCDEFGHIJKLMNOPQRSTUVWXY";
  const CHAR_ORDER = ["pac", "blinky", "pinky", "inky", "clyde", "punky", "gunky", "gronky"];
  const JOY_KEY_ORDER = ["left", "right", "up", "down", "a", "d", "w", "s", "z", "q"];

  class StubSound {
    constructor(loop) { this.playing = false; this.looping = !!loop; this.volume = 1; }
    play() { this.playing = true; }
    stop() { this.playing = false; }
    pause() { this.playing = false; }
    isPlaying() { return this.playing; }
    setVolume(v) { this.volume = v; }
    setLooping(l) { this.looping = l; }
  }

  function create(DATA, env) {
    env = env || {};
    const rng = env.rng || Math.random;
    // web edition: leaderboard replays (src/replay.js) re-run a game from its seed and inputs; bump this whenever gameplay
    // changes (anything the golden replay would catch, or a fix to a mode it doesn't cover), so older replays are marked
    const REPLAY_VERSION = 4; // 2: style picks off the game's RNG (2026-11-18); 3: the intermission's bubbles too (2026-11-19);
    // 4: a death on the step that clears the board goes straight to the board done (2026-11-20)
    // the Random background / maze style picks (looks only): the game's own RNG unless the web edition hands in another
    // (env.styleRand, 2026-11-18: a viewer's Random styles drew from the game's RNG and threw replays out of step, a
    // phone's replay of a PC's game went its own way); without it, as in the original
    const styleRand = (m, n) => (env.styleRand ? env.styleRand(m, n, rand) : rand(m, n));
    const rand = (m, n) => {
      const r = rng();
      if (m === undefined) return r;
      if (n === undefined) { n = m; m = 1; }
      return m + Math.floor(r * (n - m + 1));
    };
    const rawRand = rand;
    // the first intermission's bubbles (looks only): the game's RNG unless the web edition hands in another (env.fxRand,
    // 2026-11-19: Pro Mode skips the intermission, so its draws threw a replay out when the viewer's Pro Mode differed
    // from the player's); without it, as in the original
    const fxRand = (m, n) => (env.fxRand ? env.fxRand(m, n, rand) : rand(m, n));
    const isDown = env.isDown || (() => false);
    const makeSound = env.makeSound || ((name, loop) => new StubSound(loop));

    const animations = DATA.animations;
    const fruits = DATA.fruits;

    // resolve {"$fruit": name} references into shared fruit objects (identity matters for plus-mode mapping)
    function resolveFruits(o) {
      if (Array.isArray(o)) return o.map(resolveFruits);
      if (o && typeof o === "object") {
        if (o.$fruit) return fruits[o.$fruit];
        for (const k of Object.keys(o)) o[k] = resolveFruits(o[k]);
      }
      return o;
    }
    const LEVELS = resolveFruits(JSON.parse(JSON.stringify(DATA.levels)));
    for (const name of Object.keys(fruits)) fruits[name].name = name;

    // ------------------------------------------------------------------ global state
    const g = {
      scaleOption: 3, state: {}, autoplay: true,
      fadeLength: () => (g.config.afterDark === 4 ? 480 : 240),
      defaultConfig: {
        startingLives: 3, startingLevel: 1, freeGuy: 1, difficulty: 0, afterDark: false, pinkyBug: true,
        scatterOption: false, freeGhost: false, movement: 0, ability: false, phased: false, ghostCount: 4,
        background: "none", mazeColor: 99, fullscreen: false, crtEffect: true, volume: 4, musicVolume: 8,
        mazepack: "pac", plusMode: false, radar: false, proMode: false,
      },
      config: {},
      particles: [],
      sounds: {},
      music: {},
      fever: null,
      mazes: mazePacks(DATA, env),
      backgroundOptions: BACKGROUND_OPTIONS,
    };
    function resetConfigs() {
      const fullscreen = g.config.fullscreen;
      g.config = Object.assign({}, g.defaultConfig);
      g.config.fullscreen = fullscreen;
    }
    resetConfigs();
    // web edition: the Rewind ability (env.rewind does the work, see rewind.js). Every gameplay check sees it as "Off":
    // only the ability button behaves differently
    const REWIND = 4;
    // web edition: the Pause ability (author's design; 2026-11-15 the author's rework): a press of the ability button
    // freezes every ghost (eyes too) for PAUSE_MAX frames (2 s; a fixed length, not held: easier on phones, the author).
    // Ghost-eat pauses don't use it up. Pac-Man moves freely. One charge per life and per board, refilled at READY and by an energizer, like Suck and Blow
    // (g.pauseSpent; g.freezeLeft: frames of freeze left). (Until then it stopped Pac-Man instead, with a 1 s reload)
    // Like Rewind, every gameplay check sees it as "Off"
    const PAUSE = 5, PAUSE_MAX = 120;
    // web edition: the Vacuum ability (author's design, 2026-11-14): one charge per life and per board (refilled at every
    // READY, like Rewind; g.vacuumSpent). The button sucks up everything within VACUUM_RADIUS tiles in a straight line,
    // through walls: energizers first (so a ghost they turn blue is eaten, not deadly), then dots, the fruit, and ghosts
    // (not eyes, not ones in the house): a blue one is eaten, one at a time with the usual pause and score chain (the rest
    // wait in g.vacuumQueue, eaten as each ateGhost pause ends); a ghost that isn't blue catches him. Each thing eaten
    // goes through the normal eating code, as if he were standing on it. Like Rewind and Pause, gameplay checks see it as Off
    const VACUUM = 6, VACUUM_RADIUS = 6, VACUUM_FX = 48; // VACUUM_FX: frames of the picture of it sucking (render only)
    // web edition: the Push ability (author's design, 2026-11-14), the Vacuum's opposite: one charge per life and per board
    // (refilled at every READY; g.pushSpent). Ghosts within PUSH_REACH tiles (blue ones too; not eyes, not ones in the
    // house) are flung straight away from Pac-Man, over walls, landing on the open corridor tile (one he could walk to:
    // a flood fill from him, the house and tunnels left out) that best lies along that line, at most PUSH_MAX tiles from
    // him, facing away. Play stops while they fly (mode "push", PUSH_FX frames). No daze (the author)
    const PUSH = 7, PUSH_REACH = 4, PUSH_MAX = 8, PUSH_FX = 40;
    // web edition: the Random ability (the author, 2026-11-15): a new one of the seven picked at every new board (never
    // the same twice running; kept through lives lost on that board), with the game's own RNG so it replays the same.
    // curAbility() is the ability in play: the setting, or Random's pick; everything asks it, not the setting
    const RANDOM = 8, ABILITY_NAMES = ["", "phase", "boost", "stun", "rewind", "pause", "suck", "blow"];
    function curAbility() { return g.config.ability === RANDOM ? (g.randomAbility || 1) : g.config.ability; }
    function pickRandomAbility() {
      const pool = [1, 2, 3, 4, 5, 6, 7].filter((a) => a !== g.randomAbility);
      g.randomAbility = pool[rand(pool.length) - 1];
    }
    function ability() { const a = curAbility(); return a === REWIND || a === PAUSE || a === VACUUM || a === PUSH ? false : a; }
    const freezeGhosts = () => {
      if (g.pauseSpent || g.mode !== "normal") return;
      g.pauseSpent = true; g.freezeLeft = PAUSE_MAX; g.freezeEaten = 0;
      if (g.sounds.phase.isPlaying()) g.sounds.phase.stop();
      g.sounds.phase.play();
    };
    // web edition: Pro Mode (Options > Style, env.proMode; also always on in test mode, env.testMode): real games skip
    // the opening jingle, the death animation, the board-complete flashing and the intermissions, and READY is short.
    // Not the attract demo; no gameplay changes (none of it runs during play)
    const PRO_READY = 45, PRO_BOARD_DONE = 45;
    // EXACT (the side project): the arcade-exact switch; off, this is the author's game, untouched (the golden replay)
    const exact = () => !!(env.exact && env.exact());
    const pro = () => !g.attract && ((!!env.proMode && g.config.proMode === true) || !!(env.testMode && env.testMode()));

    for (const name of SOUND_NAMES) g.sounds[name] = makeSound(name, LOOPING.has(name));
    ["world0", "world1", "world2", "world3", "world4", "world5", "bossfight"].forEach((n) => { g.music[n] = new StubSound(true); });
    g.fever = new StubSound(true);

    const applyVolume = () => {
      const v = g.config.volume / 10;
      for (const k of Object.keys(g.sounds)) if (g.sounds[k].setVolume) g.sounds[k].setVolume(v);
    };
    const applyMusicVolume = () => {
      const v = g.config.musicVolume / 10;
      for (const k of Object.keys(g.music)) g.music[k].setVolume(v);
      g.fever.setVolume(v);
    };

    // ------------------------------------------------------------------ maze
    function Maze(name) {
      const P = DATA.mazes[name];
      const self = Object.assign({ name }, P);
      const map = P.map;
      self.w = map[0].length;
      self.h = map.length;
      const UPPER_MAP = { "@": "2", "#": "3", "$": "4", "%": "5", "^": "6", "&": "7", "*": "8", "(": "9" };
      const upperCase = (c) => UPPER_MAP[c] || c.toUpperCase();
      self.upperCase = upperCase;
      self.getLoc = (c) => [Math.floor(c.x / TILE), mod(c.x, TILE), Math.floor(c.y / TILE), mod(c.y, TILE)];
      // which tile a character is in, for what asks that (targets, collisions, eating, the tunnel) rather than where it is
      // within one (centres, turns: getLoc). EXACT: the arcade's screen is mirrored to this game's, so its tiles start a
      // pixel over horizontally (the centres agree; the boundaries are a pixel apart): its tile is (x - 1) / 8
      self.occ = (c) => { const L = self.getLoc(c); if (exact()) L[0] = Math.floor((c.x - 1) / TILE); return L; };
      self.getChar = (x, y) => (x < 0 || x >= map[0].length || y < 0 || y >= map.length) ? false : map[y][x];
      self.isWall = (x, y) => {
        if (x < 0 || x >= map[0].length || y < 0 || y >= map.length) return false;
        return INDEXES.indexOf(upperCase(map[y][x])) !== -1;
      };
      self.isTunnel = (x, y) => {
        if (x < 0 || x >= map[0].length || y < 0 || y >= map.length) return false;
        return map[y][x] === "_";
      };
      self.isDisallowed = (x, y) => {
        if (x < 0 || x >= map[0].length || y < 0 || y >= map.length || g.config.freeGhost) return false;
        const c = map[y][x];
        return c === ";" || c === ":";
      };
      self.isBlocked = (c, dir) => {
        const [xTile, , yTile] = self.getLoc(c);
        return self.isWall(xTile + DELTAS[dir].x, yTile + DELTAS[dir].y);
      };
      self.getPowers = () => {
        const out = [];
        for (let y = 0; y < map.length; y++) for (let x = 0; x < map[0].length; x++) if (map[y][x] === "`") out.push({ x, y });
        return out;
      };
      self.getDots = () => {
        const out = [];
        for (let y = 0; y < map.length; y++) for (let x = 0; x < map[0].length; x++) { const c = map[y][x]; if (c === "." || c === ":") out.push({ x, y }); }
        return out;
      };
      self.init = () => {
        g.powers = []; g.dots = [];
        for (const p of self.getPowers()) g.powers.push({ x: p.x, y: p.y, score: 50, skipCounter: 3, action: handlers.handlePowerEaten, animator: () => animations.power });
        for (const d of self.getDots()) g.dots.push({ x: d.x, y: d.y, score: 10, skipCounter: 1, action: handlers.handleDotEaten, animator: () => animations.dot });
      };
      return self;
    }
    const mazeInstances = {};
    for (const name of DATA.mazeNames) mazeInstances[name] = Maze(name);
    const maze = { getMaze: (n) => mazeInstances[n], maxColors: DATA.maxColors };
    const getCurrentMaze = () => { return maze.getMaze(g.currentMaze); };
    const allPackMazes = () => { const out = []; for (const k of PACK_ORDER) for (const m of g.mazes[k].list) out.push(m); return out; };
    const setCurrentMaze = (pack) => {
      if (pack === "random") { const all = allPackMazes(); g.currentMaze = all[rand(1, all.length) - 1]; return g.currentMaze; }
      const list = g.mazes[pack].list;
      g.currentMaze = list[rand(1, list.length) - 1];
      return g.currentMaze;
    };

    // ------------------------------------------------------------------ levels
    const levels = {
      plusModeFruitMap: (f) => { const to = DATA.plusModeFruitMap[f.name]; return to ? fruits[to] : f; },
      getLevel(levelNumber) {
        const currentLevels = g.config.difficulty === 1 ? LEVELS.hard : g.config.difficulty === 2 ? LEVELS.plus : LEVELS.normal;
        const defaultLevel = g.config.difficulty === 1 ? 19 : 21;
        let lvl;
        if (currentLevels[levelNumber]) {
          lvl = currentLevels[levelNumber];
          lvl.fruitFrightenedDuration = FRUIT_FRIGHT[levelNumber - 1] * 60;
        } else {
          lvl = currentLevels[defaultLevel];
          lvl.fruitFrightenedDuration = FRUIT_FRIGHT[FRUIT_FRIGHT.length - 1] * 60;
        }
        if (exact()) lvl = levels.exactLevel(lvl, levelNumber);
        return lvl;
      },
      // EXACT: a level with the arcade's numbers (a copy: this game's own tables stay as they are). The scatter / chase
      // switches are the ROM's for the level's speed set (level 1's last is 5040, not 4200); on the Plus difficulty, the
      // whole level is Pac-Man Plus's, its fruit scare time too
      exactLevel(own, n) {
        const lvl = { ...own };
        if (g.config.difficulty === 2) {
          const [set, pc, ic, cc, e1, e2, fr, starv, fruit] = EXACT_PLUS[Math.min(n, 21) - 1];
          Object.assign(lvl, EXACT_SETS[set], { pinkyCounter: pc, inkyCounter: ic, clydeCounter: cc, elroy1: e1, elroy2: e2, frightened: fr * 60, starvation: starv, fruitFrightenedDuration: fruit * 60 });
        }
        lvl.exactSet = g.config.difficulty === 2 ? EXACT_PLUS[Math.min(n, 21) - 1][0] : exactSetOf(own);
        lvl.switch = EXACT_SETS[lvl.exactSet].switch;
        return lvl;
      },
      // EXACT: every character's own copies of the level's patterns (the arcade copies them in at a level's start; each
      // only turns while it's the one in use, so a speed change doesn't lose its place)
      exactPatterns() {
        const P = EXACT_PATTERNS[g.level.exactSet || 3];
        g.exactPat = {};
        for (const name of charKeys()) { const o = {}; PATTERN_KINDS.forEach((k, i) => { o[k] = patternValue(P[i]); }); g.exactPat[name] = o; }
      },
      startLevel() {
        const musicList = Object.keys(g.music);
        const idx = rand(1, musicList.length);
        g.levelMusic = g.music[musicList[idx - 1]];
        g.level = levels.getLevel(g.levelNumber);
        g.exactPatLevel = null; // EXACT: the level's patterns copied in afresh
        g.fruitTimer = false; g.fruitScoreTimer = false; g.starvation = 0;
        g.level.timer = 0;
        g.radarTimer = false;
        g.fadeTimer = g.fadeLength();
        g.level.chase = g.config.scatterOption === 3 ? true : false;
        g.frightened = false; g.mazeFrightened = false; g.fruitFrightened = false; g.globalCounter = false; g.suspendElroy = false;
        const mazepack = g.config.mazepack;
        const mazes = mazepack === "random" ? allPackMazes() : g.mazes[mazepack].list;
        // only avoid a repeat if there is more than one maze in the pack
        if (mazes.length > 1) {
          const prev = g.currentMaze;
          let newMaze, tries = 0;
          do { newMaze = mazes[rand(1, mazes.length) - 1]; tries += 1; } while (newMaze === prev && tries <= 10);
          g.currentMaze = newMaze;
        } else {
          setCurrentMaze(mazepack);
        }
        const defaultColor = (g.config.plusMode && g.currentMaze === "pac") ? 5 : getCurrentMaze().defaultColor;
        if (g.config.mazeColor === 99) g.currentMazeColor = defaultColor;
        else if (g.config.mazeColor === 0) g.currentMazeColor = styleRand(1, maze.maxColors - 1); // Random: 1-26 (never 27, darkstar: the author)
        else g.currentMazeColor = g.config.mazeColor;
        g.currentBackground = g.config.background === "random" ? BACKGROUND_OPTIONS[styleRand(2, BACKGROUND_OPTIONS.length) - 1] : g.config.background;
        g.startX = (getCurrentMaze().w * 8 / 2) - 224 / 2;
        g.startY = (getCurrentMaze().h * 8 / 2) - 248 / 2;
        g.xDelta = 0;
        g.yDelta = 0;
      },
      resetLevel() {
        g.level = levels.getLevel(g.levelNumber);
        g.fruitTimer = false; g.fruitScoreTimer = false; g.starvation = 0;
        g.level.timer = 0;
        g.radarTimer = false;
        if (g.config.afterDark === 4) g.fadeTimer = g.fadeLength();
        g.level.chase = g.config.scatterOption === 3 ? true : false;
        g.frightened = false; g.mazeFrightened = false; g.fruitFrightened = false;
        g.startX = (getCurrentMaze().w * 8 / 2) - 224 / 2;
        g.startY = (getCurrentMaze().h * 8 / 2) - (31 * 8) / 2;
        g.xDelta = 0;
        g.yDelta = 0;
      },
    };

    // ------------------------------------------------------------------ globals from main.lua
    const playSiren = () => {
      if (g.config.ghostCount === 0) return;
      const triggers = getCurrentMaze().sirenTriggers;
      for (let i = 1; i <= triggers.length; i++) {
        if (g.dots.length <= triggers[i - 1]) { g.sounds["siren" + (6 - i)].play(); return; }
      }
      g.sounds.siren1.play();
    };
    const stopSiren = () => { for (let i = 5; i >= 1; i--) g.sounds["siren" + i].stop(); };
    const formatScore = (s) => s === 0 ? "     00" : " ".repeat(7 - String(s).length) + String(s);

    function score(s) {
      if (g.attract) return;
      const oldScore = g.score;
      g.score = g.score + s;
      if (g.config.freeGuy === 1) {
        if (oldScore < 10000 && g.score >= 10000) { g.sounds.extrapac.play(); g.lives += 1; }
      } else if (g.config.freeGuy === 2) {
        if (oldScore < 20000 && g.score >= 20000) { g.sounds.extrapac.play(); g.lives += 1; }
      } else if (g.config.freeGuy === 3) {
        const extra = Math.floor(g.score / 10000) - Math.floor(oldScore / 10000);
        if (extra > 0) { g.sounds.extrapac.play(); g.lives += extra; }
      } else if (g.config.freeGuy === 4) {
        const extra = Math.floor(g.score / 5000) - Math.floor(oldScore / 5000);
        if (extra > 0) { g.sounds.extrapac.play(); g.lives += extra; }
      }
      if ((!g.highScore || g.score > g.highScore) && g.score > 0) {
        g.highScore = g.score;
        if (env.saveHighScore) env.saveHighScore(g.score);
      }
    }

    // ------------------------------------------------------------------ animation helpers
    const graphics = {
      animations,
      updateAnimation(o, frameCounter) {
        const a = o.animator();
        if (!a) return;
        o.frame = o.frame || 1;
        if (a.speed && frameCounter % a.speed === 0) o.frame = (o.frame % a.frames.length) + 1;
      },
      emitBlinkyBubbles(x, y, rand = rawRand) {
        const n = rand(0, 1);
        for (let i = 0; i < n; i++) {
          const offsetX = (rand() - 0.5) * 8;
          const offsetY = -6 + (rand() - 0.5) * 4;
          const angle = rand() * Math.PI * 2;
          const speed = 1 + rand() * 0.2;
          g.particles.push({
            x: x + offsetX, y: y + offsetY, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
            life: 20, maxLife: 20, size: 1.5 + rand() * 1.5, colors: [0.5, 0.5, 1.0], alpha: 0.6,
            bubble: true, // web edition: render.js draws these as cartoon bubbles (no effect on the RNG)
          });
        }
      },
      updateParticles() {
        for (let i = g.particles.length - 1; i >= 0; i--) {
          const p = g.particles[i];
          p.x += p.vx; p.y += p.vy; p.vx *= 0.97; p.vy *= 0.97; p.life -= 1;
          if (p.alpha !== undefined) p.alpha = (p.life / p.maxLife) * 0.6;
          if (p.life <= 0) g.particles.splice(i, 1);
        }
      },
    };

    // ------------------------------------------------------------------ handlers
    const handlers = {
      activateFrightenedMode(byFruit) {
        byFruit = byFruit || false;
        if (!byFruit) { g.fruitFrightened = false; g.mazeFrightened = false; }
        g.frightened = byFruit ? g.level.fruitFrightenedDuration : g.level.frightened;
        if (g.frightened === 0) g.frightened = false;
        else {
          if (exact()) g.exactFrightTicks = g.frightened * 2; // EXACT: the arcade counts it in ticks, from the tick it began
          g.ghostScore = false;
          const pac = g.chars.pac;
          if (g.config.movement === 0 && ((!T(ability()) || ability() === 1) || (!T(pac.phased) || pac.phased <= 0))) pac.speed = g.level.pacFrightenedSpeed;
          if (!g.sounds.scared.isPlaying()) { g.sounds.scared.play(); stopSiren(); }
          let immuneChar;
          if (g.config.plusMode && !byFruit) {
            if (rand() < 0.5) {
              const candidates = [];
              for (const name of charKeys()) { const c = g.chars[name]; if (c.target && !c.dead) candidates.push(c); }
              immuneChar = candidates[rand(1, candidates.length) - 1];
            }
            if (g.levelNumber > 2) { if (rand() < 0.5) g.mazeFrightened = true; }
          }
          for (const name of charKeys()) {
            const c = g.chars[name];
            if (c.target && !c.dead) {
              if (c !== immuneChar) { c.leaveRight = false; c.frightened = true; c.speed = logic.getGhostSpeed(c); }
            }
          }
        }
        for (const name of charKeys()) {
          const c = g.chars[name];
          if (c.target) {
            if (exact()) c.exactReverse = true; // EXACT: every ghost, those in the house too, turns round at its next tile centre out in the maze
            else if (!c.housing && !c.leaving && !c.entering) { c.dir = (c.dir + 2) % 4; c.target(); }
          }
        }
      },
      handleDotEaten() {
        if (g.wakka) { g.sounds.wakka2.play(); g.wakka = false; } else { g.sounds.wakka1.play(); g.wakka = true; }
        const cm = maze.getMaze(g.currentMaze);
        let found = false;
        for (const v of cm.sirenTriggers) if (v === g.dots.length) { found = true; break; }
        if (found && !g.sounds.dead.isPlaying() && !g.sounds.scared.isPlaying()) { stopSiren(); playSiren(); }
        for (const v of cm.fruitTriggers) if (g.dots.length === v) { g.fruitTimer = 9 * 60 + rand(0, 60); break; }
        g.starvation = 0;
        const leaving = [];
        for (const name of charKeys()) { const c = g.chars[name]; if (c.housing && c.leavingPreference != null) leaving.push(c); }
        leaving.sort((a, b) => a.leavingPreference - b.leavingPreference);
        if (T(g.globalCounter)) g.globalCounter += 1;
        else {
          for (const c of leaving) { if (c.dotCounter > 0) { c.dotCounter -= 1; break; } }
        }
      },
      handlePowerEaten() {
        if (g.wakka) { g.sounds.wakka2.play(); g.wakka = false; } else { g.sounds.wakka1.play(); g.wakka = true; }
        if (exact()) g.starvation = 0; // EXACT: an energizer restarts the no-dot timer too, as the arcade's
        rechargeAbilities();
        handlers.activateFrightenedMode();
        if (g.config.afterDark === 4) g.fadeTimer = g.fadeLength();
      },
    };

    // fixed visiting order for g.chars (see header)
    const charKeys = () => g.charOrder;

    // ------------------------------------------------------------------ characters
    const getRandomFrightenedDir = () => {
      // EXACT: the first way a frightened ghost tries can come from outside (env.frightPick: the harness feeds it the arcade's own
      // generator from the player's ROM, to check fright frame for frame; NEAT itself keeps this game's randomness)
      if (exact() && env.frightPick) return env.frightPick() & 3;
      const r = rand();
      if (r < 0.252) return 0;
      if (r < 0.537) return 1;
      if (r < 0.836) return 2;
      return 3;
    };
    const getCandidates = (self) => {
      const cm = getCurrentMaze();
      const out = [];
      for (let i = 0; i <= 3; i++) if (!cm.isBlocked(self, i) && Math.abs(i - self.dir) !== 2) out.push(i);
      return out;
    };
    const handleFrightenedDirection = (self, candidates) => {
      let nextDir = getRandomFrightenedDir();
      let checked = 0, found = false;
      while (checked < 4) {
        for (const dir of candidates) if (dir === nextDir) { self.iDir = nextDir; found = true; break; }
        if (found) break;
        nextDir = (nextDir + 1) % 4;
        checked += 1;
      }
    };
    const findBestDirection = (self, xTile, yTile, targetX, targetY, candidates) => {
      let shortest = Infinity;
      const isGhost = self.target != null;
      candidates.sort((a, b) => a - b);
      for (const dir of candidates) {
        const nx = xTile + DELTAS[dir].x, ny = yTile + DELTAS[dir].y;
        const cm = getCurrentMaze();
        if (!isGhost || g.config.freeGhost || !cm.isDisallowed(nx, ny)) {
          const dist = (nx - targetX) ** 2 + (ny - targetY) ** 2;
          if (dist <= shortest) { shortest = dist; self.iDir = dir; }
        }
      }
    };
    // (animator needs `self`; build as closures per character below)
    const ghostAnimator = (ghostName, elroyCheck) => (self) => {
      if (self.dead) return animations.dead[self.dir];
      if (self.frightened) {
        if (g.frightened < 120 && Math.floor(g.frightened / 14) % 2 === 0) {
          return g.config.plusMode ? animations.scaredWhitePlus : animations.scaredWhite;
        }
        if (!g.fruitFrightened) return g.config.plusMode ? animations.scaredBluePlus : animations.scaredBlue;
        if (g.frightened < 120 || T(self.stunned)) return animations.scaredBluePlus;
        return undefined;
      }
      if (elroyCheck && g.dots.length <= g.level.elroy1 && !g.suspendElroy) return animations.booze;
      if (T(self.iDir) && !self.leaving && !self.housing) return animations[ghostName][self.iDir];
      return animations[ghostName][self.dir];
    };

    // generic ghost brain; `chase(self, ctx)` supplies the per-ghost target tile when chasing
    // (web edition, test mode's overlay: the brain keeps its chase rule and the last target it aimed at, see projectGhost)
    const lastTargets = new WeakMap();
    const makeTarget = (chaseFn, random) => Object.assign(function () {
      const self = this;
      if (!T(self.iDir)) { self.iDir = self.dir; return; }
      const cm = getCurrentMaze();
      // EXACT: the arcade plans one tile ahead (self.exactNext: the next tile, its exits, never back the way it came)
      const ahead = exact() && self.exactNext;
      const [xTile, , yTile] = ahead ? [ahead[0], 0, ahead[1]] : cm.getLoc(self);
      const candidates = ahead ? [0, 1, 2, 3].filter((i) => !cm.isWall(xTile + DELTAS[i].x, yTile + DELTAS[i].y) && Math.abs(i - self.dir) !== 2) : getCandidates(self);
      if (self.frightened && exact() && env.frightPick) { handleFrightenedDirection(self, candidates); return; } // (EXACT: the arcade draws at every tile, one way or not)
      if (candidates.length === 1) { self.iDir = candidates[0]; return; }
      if (self.frightened) { handleFrightenedDirection(self, candidates); return; }
      const hc = cm.houseCenter;
      let targetX, targetY;
      if (self.dead) { targetX = hc.x - 1; targetY = hc.y - 3; }
      else [targetX, targetY] = chaseFn(self, cm, xTile, yTile);
      findBestDirection(self, xTile, yTile, targetX, targetY, candidates);
      if (self.name === "blinky") { self.targetX = targetX; self.targetY = targetY; }
      lastTargets.set(self, [targetX, targetY]);
    }, { chase: chaseFn, random: !!random });

    // web edition (test mode's overlay): where a ghost is headed and the tiles it will take to get there, by its own rules
    // (a choice on entering each tile: no reversing, the free neighbour nearest the target in a straight line, ties to the
    // later direction, no turning into restricted tiles, turns only inside the maze, tunnels wrap). The target is worked
    // out afresh on every tile (Clyde's depends on where he is), with Pac-Man and the mode as they are now. Makes no RNG
    // calls and changes nothing: Punky and Gronky aim at random, so theirs is the last target they picked, and their path
    // stops at the next choice. null when the ghost has no target (frightened, in or leaving the pen).
    const projectGhost = (c, maxSteps = 150) => {
      if (!c || !c.target || !c.target.chase || c.housing || c.leaving || c.entering || T(c.frightened)) return null;
      const cm = getCurrentMaze(), hc = cm.houseCenter;
      const [x0, , y0] = cm.getLoc(c);
      const targetAt = (x, y) => c.dead ? [hc.x - 1, hc.y - 3] : c.target.random ? lastTargets.get(c) || null : c.target.chase(c, cm, x, y);
      const inside = (x, y) => y > 0 && y < cm.h && x > 0 && x < cm.w;
      const target = targetAt(x0, y0);
      if (!target) return null;
      let x = x0, y = y0, iDir = T(c.iDir) ? c.iDir : c.dir, d = inside(x, y) ? iDir : c.dir, end = "steps";
      const path = [[x, y]], seen = new Set();
      for (let step = 0; step < maxSteps; step++) {
        if (cm.isWall(x + DELTAS[d].x, y + DELTAS[d].y)) { end = "stuck"; break; }
        x += DELTAS[d].x; y += DELTAS[d].y;
        if (x === cm.w + 2) x = -2; else if (x === -3) x = cm.w + 1;
        if (y === cm.h + 2) y = -2; else if (y === -3) y = cm.h + 1;
        path.push([x, y]);
        const t = targetAt(x, y);
        if (x === t[0] && y === t[1]) { end = "target"; break; }
        const key = x + "," + y + "," + d;
        if (seen.has(key)) { end = "loop"; break; }
        seen.add(key);
        const cands = [];
        for (let i = 0; i <= 3; i++) if (!cm.isWall(x + DELTAS[i].x, y + DELTAS[i].y) && Math.abs(i - d) !== 2) cands.push(i);
        if (cands.length === 1) iDir = cands[0];
        else {
          let shortest = Infinity;
          for (const i of cands) {
            const nx = x + DELTAS[i].x, ny = y + DELTAS[i].y;
            if (g.config.freeGhost || !cm.isDisallowed(nx, ny)) { const dist = (nx - t[0]) ** 2 + (ny - t[1]) ** 2; if (dist <= shortest) { shortest = dist; iDir = i; } }
          }
        }
        if (inside(x, y) && !cm.isWall(x + DELTAS[iDir].x, y + DELTAS[iDir].y)) d = iDir;
        if (c.target.random && cands.length > 1) { end = "random"; break; }
      }
      return { target: targetAt(x0, y0), path, end };
    };

    const characters = {
      initialize() {
        const level = levels.getLevel(g.levelNumber);
        const chars = {};
        const cm = getCurrentMaze();
        const hc = cm.houseCenter, ps = cm.pacStart, sp = cm.scatterPositions;
        chars.pac = { name: "pac", x: 8 * ps.x, y: 8 * ps.y + 4, dir: 2, turnWindow: 3 };
        chars.pac.animator = () => animations.pac[g.chars.pac.facing];
        const N = g.config.ghostCount;
        const mk = (name, props, brain, animName, elroyCheck) => {
          const c = Object.assign({ name }, props);
          c.target = brain;
          c.animator = () => ghostAnimator(animName, elroyCheck)(c);
          chars[name] = c;
        };
        if (N > 0) mk("blinky", {
          x: 8 * hc.x, y: 8 * (hc.y - 3) + 4, dir: 2, scatterX: sp.blinky.x, scatterY: sp.blinky.y, houseX: hc.x, houseY: hc.y, elroy: true,
        }, makeTarget((self, cm2) => {
          if (g.level.chase || (g.dots.length <= g.level.elroy1 && !g.suspendElroy)) {
            const [px, , py] = cm2.occ(g.chars.pac); return [px, py];
          }
          return [self.scatterX, self.scatterY];
        }), "blinky", true);
        if (N > 1) mk("pinky", {
          x: 8 * hc.x, y: 8 * hc.y + 4, dir: 1, housing: true, scatterX: sp.pinky.x, scatterY: sp.pinky.y, houseX: hc.x, houseY: hc.y,
          leavingPreference: 0, dotCounter: level.pinkyCounter, globalCounter: 7,
        }, makeTarget((self, cm2) => {
          if (g.level.chase) {
            const [px, , py] = cm2.occ(g.chars.pac);
            const d = DELTAS[g.chars.pac.dir];
            let tx = px + d.x * 4; const ty = py + d.y * 4;
            if (g.config.pinkyBug && g.chars.pac.dir === 3) tx = px - 4;
            return [tx, ty];
          }
          return [self.scatterX, self.scatterY];
        }), "pinky", false);
        if (N > 2) mk("inky", {
          x: 8 * (hc.x - 2), y: 8 * hc.y + 4, dir: 3, housing: true, scatterX: sp.inky.x, scatterY: sp.inky.y, houseX: hc.x - 2, houseY: hc.y,
          leavingPreference: 1, globalCounter: 17, dotCounter: level.inkyCounter,
        }, makeTarget((self, cm2) => {
          if (g.level.chase) {
            const [px, , py] = cm2.occ(g.chars.pac);
            const [bx, , by] = cm2.occ(g.chars.blinky);
            const d = DELTAS[g.chars.pac.dir];
            let midX = px + d.x * 2; const midY = py + d.y * 2;
            if (g.config.pinkyBug && g.chars.pac.dir === 3) midX = px - 2;
            return [bx + (midX - bx) * 2, by + (midY - by) * 2];
          }
          return [self.scatterX, self.scatterY];
        }), "inky", false);
        if (N > 3) mk("clyde", {
          x: 8 * (hc.x + 2), y: 8 * hc.y + 4, dir: 3, housing: true, scatterX: sp.clyde.x, scatterY: sp.clyde.y, houseX: hc.x + 2, houseY: hc.y,
          leavingPreference: 2, dotCounter: level.clydeCounter, globalCounter: 32,
        }, makeTarget((self, cm2, xTile, yTile) => {
          if (g.level.chase) {
            const [px, , py] = cm2.occ(g.chars.pac);
            if ((xTile - px) ** 2 + (yTile - py) ** 2 >= 64) return [px, py];
          }
          return [self.scatterX, self.scatterY];
        }), "clyde", false);
        if (N > 4) { const s = cm.punkyStart; mk("punky", {
          x: 8 * s.x, y: 8 * s.y + 4, dir: 0, houseX: hc.x, houseY: hc.y, leavesRight: true,
        }, makeTarget((self, cm2) => {
          const [px, , py] = cm2.occ(g.chars.pac);
          const d = DELTAS[g.chars.pac.dir];
          const tx = px + d.y * (rand(0, 8) - 4);
          const ty = py + d.x * (rand(0, 8) - 4);
          return [tx, ty];
        }, true), "punky", false); }
        if (N > 5) { const s = cm.gunkyStart; mk("gunky", {
          x: 8 * s.x, y: 8 * s.y + 4, dir: 0, houseX: hc.x, houseY: hc.y, leavesRight: false,
        }, makeTarget((self, cm2) => {
          const [px, , py] = cm2.occ(g.chars.pac);
          const px2 = cm2.w / 2 - px, py2 = cm2.h / 2 - py;
          return [px + px2 * 2, py + py2 * 2];
        }), "gunky", false); }
        if (N > 6) { const s = cm.gronkyStart; const dir0 = rand(0, 1) * 2; const lr = rand(0, 1) === 1; mk("gronky", {
          x: 8 * s.x, y: 8 * s.y + 4, dir: dir0, houseX: hc.x, houseY: hc.y, leavesRight: lr,
        }, makeTarget((self, cm2, xTile, yTile) => {
          const tx = xTile + DELTAS[rand(0, 3)].x;
          const ty = yTile + DELTAS[rand(0, 3)].y;
          return [tx, ty];
        }, true), "gronky", false); }
        g.chars = chars;
        g.charOrder = CHAR_ORDER.filter((n) => chars[n]);
      },
      reset() {
        const cm = getCurrentMaze();
        const hc = cm.houseCenter;
        const N = g.config.ghostCount;
        // the Lua only treats the "mspac" scatter option (2) like "random" (1) for blinky and pinky
        const randomScatter = (c, allowMs) => {
          if (g.config.scatterOption === 1 || (allowMs && g.config.scatterOption === 2)) {
            const r = cm.scatterTiles[rand(1, 4) - 1];
            c.scatterX = r.x; c.scatterY = r.y;
          }
        };
        if (N > 0) {
          const c = g.chars.blinky;
          c.frame = 1; c.x = 8 * hc.x; c.y = 8 * (hc.y - 3) + 4; c.dir = 2; c.iDir = 2;
          c.entering = false; c.leaving = false; c.dead = false; c.frightened = false; c.stunned = false; c.leaveRight = false;
          c.speed = logic.getGhostSpeed(c);
          randomScatter(c, true);
        }
        if (N > 1) {
          const c = g.chars.pinky;
          c.x = 8 * hc.x; c.y = 8 * hc.y + 4; c.frame = 1; c.housing = true; c.entering = false; c.leaving = false; c.dead = false;
          c.frightened = false; c.stunned = false; c.leaveRight = false; c.dir = 1; c.iDir = 3; c.speed = logic.getGhostSpeed(c);
          randomScatter(c, true);
        }
        if (N > 2) {
          const c = g.chars.inky;
          c.x = 8 * (hc.x - 2); c.y = 8 * hc.y + 4; c.frame = 1; c.housing = true; c.entering = false; c.leaving = false; c.dead = false;
          c.frightened = false; c.stunned = false; c.leaveRight = false; c.dir = 3; c.iDir = 3; c.speed = logic.getGhostSpeed(c);
          randomScatter(c);
        }
        if (N > 3) {
          const c = g.chars.clyde;
          c.x = 8 * (hc.x + 2); c.y = 8 * hc.y + 4; c.frame = 1; c.housing = true; c.entering = false; c.leaving = false; c.dead = false;
          c.frightened = false; c.stunned = false; c.leaveRight = false; c.dir = 3; c.iDir = 3; c.speed = logic.getGhostSpeed(c);
          randomScatter(c);
        }
        if (N > 4) { const s = cm.punkyStart, c = g.chars.punky; c.frame = 1; c.x = 8 * s.x; c.y = 8 * s.y + 4; c.dir = 0; c.iDir = 0;
          c.entering = false; c.leaving = false; c.dead = false; c.frightened = false; c.stunned = false; c.leaveRight = false; c.speed = logic.getGhostSpeed(c); }
        if (N > 5) { const s = cm.gunkyStart, c = g.chars.gunky; c.frame = 1; c.x = 8 * s.x; c.y = 8 * s.y + 4; c.dir = 0; c.iDir = 0;
          c.entering = false; c.leaving = false; c.dead = false; c.frightened = false; c.stunned = false; c.leaveRight = false; c.speed = logic.getGhostSpeed(c); }
        if (N > 6) { const s = cm.gronkyStart, c = g.chars.gronky; c.frame = 1; c.x = 8 * s.x; c.y = 8 * s.y + 4; c.dir = rand(0, 1) * 2; c.iDir = c.dir;
          c.leavesRight = rand(0, 1) === 1;
          c.entering = false; c.leaving = false; c.dead = false; c.frightened = false; c.stunned = false; c.leaveRight = false; c.speed = logic.getGhostSpeed(c); }
        const ps = cm.pacStart, pac = g.chars.pac;
        pac.x = 8 * ps.x; pac.y = 8 * ps.y + 4; pac.dir = 2; pac.facing = 2; pac.phased = false;
        pac.speed = logic.getPacSpeed();
      },
    };

    // ------------------------------------------------------------------ logic
    const logic = {};
    const THRUSTER_SPEED = 0.008, MAX_THRUST = 1.6, STUN_DISTANCE = 6, BOOST_THRUST = 2;
    const phaseActive = () => (ability() && ability() === 1 && T(g.chars.pac.phased) && g.chars.pac.phased >= 0);

    const checkCollisions = (collectibles, xTile, yTile) => {
      if (phaseActive()) return;
      for (let i = collectibles.length - 1; i >= 0; i--) {
        const item = collectibles[i];
        if (xTile === item.x && yTile === item.y) {
          score(item.score);
          g.chars.pac.skipCounter = exact() ? (item.skipCounter === 1 ? 2 : 7) : item.skipCounter; // EXACT: the arcade's pause, in ticks (a dot 2, an energizer 7)
          collectibles.splice(i, 1);
          if (item.action) item.action(xTile, yTile);
        }
      }
    };

    // Port-only fix: after the ateGhost pause, eat a second frightened ghost that shared Pac-Man's tile
    // (the collision loop stops after the first ghost, and collisions are off during ateGhost).
    logic.eatOverlappingFrightened = () => {
      const cm = getCurrentMaze();
      const [pX, , pY] = cm.occ(g.chars.pac);
      for (const name of charKeys()) {
        const ch = g.chars[name];
        if (ch.target && T(ch.frightened) && !T(ch.dead)) {
          const [gX, , gY] = cm.occ(ch);
          if (handleGhostCollision(ch, pX, pY, gX, gY)) break;
        }
      }
    };
    // web edition (the author, 2026-11-14): the one-charge abilities (Rewind, Suck, Blow; Pause since 2026-11-15) refill at every READY (a new
    // life, a new board) and, new, when Pac-Man eats an energizer; the reload sound says so. Energizers the Suck swallows
    // recharge it too, so sucked energizers chain. (Phase / Boost / Stun / Pause keep their own reload timers)
    function rechargeAbilities() {
      const a = curAbility();
      let did = false;
      if (a === REWIND && g.rewindSpent && !g.rewinding) { g.rewindSpent = false; did = true; }
      if (a === VACUUM && g.vacuumSpent) { g.vacuumSpent = false; did = true; }
      if (a === PUSH && g.pushSpent) { g.pushSpent = false; did = true; }
      if (a === PAUSE && g.pauseSpent && !(g.freezeLeft > 0)) { g.pauseSpent = false; did = true; }
      if (did) g.sounds.reload.play();
    }
    function vacuum() {
      if (g.vacuumSpent || g.mode !== "normal" || !g.state.running) return;
      g.vacuumSpent = true; g.vacuumFx = VACUUM_FX;
      if (g.sounds.phase.isPlaying()) g.sounds.phase.stop();
      g.sounds.phase.play();
      const cm = getCurrentMaze();
      const [pX, , pY] = cm.occ(g.chars.pac);
      const near = (x, y) => (x - pX) * (x - pX) + (y - pY) * (y - pY) <= VACUUM_RADIUS * VACUUM_RADIUS;
      // what it takes, for the picture of it being sucked in (render.js drawVacuum; it's all eaten right now regardless)
      const fly = g.powers.concat(g.dots).filter((it) => near(it.x, it.y))
        .map((it) => ({ item: it, x: it.x * 8 + 4, y: it.y * 8 + 4, d: Math.sqrt((it.x - pX) ** 2 + (it.y - pY) ** 2) }));
      for (const p of g.powers.filter((it) => near(it.x, it.y))) checkCollisions(g.powers, p.x, p.y); // (recharging it, if any)
      for (const d of g.dots.filter((it) => near(it.x, it.y))) checkCollisions(g.dots, d.x, d.y);
      const fl = cm.fruitLoc;
      if (T(g.fruitTimer) && near(fl.x / 8, fl.y / 8)) {
        fly.push({ fruit: g.config.plusMode ? levels.plusModeFruitMap(g.level.fruit) : g.level.fruit, x: fl.x, y: fl.y, d: Math.sqrt((fl.x / 8 - pX) ** 2 + (fl.y / 8 - pY) ** 2) });
        eatFruit(true);
      }
      g.vacuumFly = fly;
      // play stops while it sucks (mode "vacuum", VACUUM_FX frames; the author: so you see what's happening), and ghosts
      // in reach are dragged in for real, so you can see what's coming (it wasn't clear why you died): pulled across the
      // maze into Pac-Man (already blue if an energizer in reach frightened them); vacuumEnd settles it when they arrive
      g.vacuumGhosts = [];
      for (const name of charKeys()) {
        const ch = g.chars[name];
        if (!ch.target || T(ch.dead) || ch.hidden || ch.housing || ch.entering) continue;
        const [gX, , gY] = cm.occ(ch);
        if (near(gX, gY)) g.vacuumGhosts.push({ ch, x0: ch.x, y0: ch.y });
      }
      mode.setMode("vacuum");
    }
    // the Push: where each ghost in reach lands, then play stops while they fly there (pushStep / pushEnd)
    function push() {
      if (g.pushSpent || g.mode !== "normal" || !g.state.running) return;
      g.pushSpent = true; g.pushFx = PUSH_FX;
      if (g.sounds.phase.isPlaying()) g.sounds.phase.stop();
      g.sounds.phase.play();
      const cm = getCurrentMaze(), hc = cm.houseCenter, pac = g.chars.pac;
      const [pX, , pY] = cm.occ(pac);
      // the tiles he could walk to (flood fill), leaving out the house and the tunnels
      // the pen itself: its inside and door, not a tile more (a wider box swallowed the corridor beside the pen's right
      // wall, and standing there the Push found nowhere to throw a ghost and did nothing: the author)
      const inHouse = (x, y) => x >= hc.x - 3 && x <= hc.x + 2 && y >= hc.y - 2 && y <= hc.y + 1;
      // (it walks through tunnels, which aren't landing spots, and starts from his own tile wherever he is: from a tunnel
      // it used to find nowhere at all, so the Push did nothing there)
      const open = new Set(), seen = new Set(), stack = [[pX, pY, true]];
      while (stack.length) {
        const [x, y, first] = stack.pop(), key = x + "," + y;
        if (seen.has(key)) continue;
        if (!first && (x < 0 || y < 0 || x >= cm.w || y >= cm.h || cm.isWall(x, y) || inHouse(x, y))) continue;
        seen.add(key);
        if (!first && !cm.isTunnel(x, y)) open.add(key);
        stack.push([x + 1, y, false], [x - 1, y, false], [x, y + 1, false], [x, y - 1, false]);
      }
      const back = DELTAS[(pac.dir + 2) % 4];
      g.pushGhosts = [];
      for (const name of charKeys()) {
        const ch = g.chars[name];
        if (!ch.target || T(ch.dead) || ch.hidden || ch.housing || ch.entering || ch.leaving) continue;
        const [gX, , gY] = cm.occ(ch);
        const d0 = Math.sqrt((gX - pX) ** 2 + (gY - pY) ** 2); // (sqrt, not hypot: the same to the last bit in every browser, for replays)
        if (d0 > PUSH_REACH) continue;
        let ux = gX - pX, uy = gY - pY;                                    // away from him (on his tile: behind him)
        if (!ux && !uy) { ux = back.x; uy = back.y; }
        const ul = Math.sqrt(ux * ux + uy * uy); ux /= ul; uy /= ul;
        // the landing: far and along the line, both counting (the line used to count so much more that a ghost a tile
        // short of a tunnel mouth was "pushed" one tile on, and it looked like nothing happened: the author); at least
        // 2 tiles further than it was if anywhere allows, otherwise anywhere further at all
        let best = null, bestScore = -Infinity, bestNear = null, bestNearScore = -Infinity;
        for (const key of open) {
          const [x, y] = key.split(",").map(Number), dx = x - pX, dy = y - pY, dd = Math.sqrt(dx * dx + dy * dy);
          if (dd > PUSH_MAX || dd <= d0) continue;
          const align = (dx * ux + dy * uy) / dd, score = align * 2 + dd * 0.6;
          if (dd >= d0 + 2) { if (score > bestScore) { bestScore = score; best = [x, y]; } }
          else if (score > bestNearScore) { bestNearScore = score; bestNear = [x, y]; }
        }
        if (!best) best = bestNear;
        if (!best) continue;                                               // nowhere further to go: stays put
        // facing away: the open way out of the landing tile that best follows the push
        let dir = ch.dir, bestA = -Infinity;
        for (let i = 0; i < 4; i++) {
          if (cm.isWall(best[0] + DELTAS[i].x, best[1] + DELTAS[i].y)) continue;
          const a = DELTAS[i].x * ux + DELTAS[i].y * uy;
          if (a > bestA) { bestA = a; dir = i; }
        }
        g.pushGhosts.push({ ch, x0: ch.x, y0: ch.y, x1: best[0] * TILE + CENTER, y1: best[1] * TILE + CENTER, dir });
      }
      if (g.pushGhosts.length >= 4 && env.feat) env.feat("space"); // four ghosts in one Blow
      mode.setMode("push");
    }
    // while it pushes: the ghosts fly out, fast at first, easing as they land
    function pushStep() {
      const k = 1 - g.modeTimer / PUSH_FX, e = 1 - (1 - k) * (1 - k);
      for (const v of g.pushGhosts || []) { v.ch.x = Math.round(v.x0 + (v.x1 - v.x0) * e); v.ch.y = Math.round(v.y0 + (v.y1 - v.y0) * e); }
    }
    // they've landed. Their plan (iDir, the turn they'd decided on for the next tile) is reset to where they're heading:
    // a stale one could point back the way they came, and a reversal is taken at once without a wall check, so a ghost
    // landed under a wall turned into it and stood stuck until an energizer reversed everyone (found by the author).
    // Speed too, for where they are now (flung out of a tunnel, say)
    function pushEnd() {
      for (const v of g.pushGhosts || []) {
        v.ch.x = v.x1; v.ch.y = v.y1; v.ch.dir = v.dir; v.ch.facing = v.dir; v.ch.iDir = v.dir; v.ch.accum16 = 0;
        updateGhostSpeed(v.ch, Math.floor(v.x1 / TILE), Math.floor(v.y1 / TILE));
      }
      g.pushGhosts = [];
    }
    // while it sucks: the ghosts it caught slide in toward Pac-Man, faster as they come
    function vacuumStep() {
      const k = 1 - g.modeTimer / VACUUM_FX, e = k * k * (3 - 2 * k), pac = g.chars.pac;
      for (const v of g.vacuumGhosts || []) { v.ch.x = Math.round(v.x0 + (pac.x - v.x0) * e); v.ch.y = Math.round(v.y0 + (pac.y - v.y0) * e); }
    }
    // they've arrived (at Pac-Man): any ghost that isn't blue catches him; the blue ones are eaten, one per pause
    function vacuumEnd() {
      const caught = g.vacuumGhosts || [], pac = g.chars.pac;
      g.vacuumGhosts = [];
      for (const v of caught) { v.ch.x = pac.x; v.ch.y = pac.y; }
      for (const v of caught) if (!T(v.ch.frightened) && !T(v.ch.dead) && handleGhostCollision(v.ch, 0, 0, 0, 0)) { g.vacuumQueue = []; return; }
      g.vacuumQueue = caught.filter((v) => T(v.ch.frightened)).map((v) => v.ch);
      if (g.vacuumQueue.length >= 4 && env.feat) env.feat("hoover"); // four blue ghosts in one Suck (all eaten, one by one)
      vacuumNext();
    }
    // the next blue ghost the vacuum caught, if it's still blue (one per ateGhost pause)
    function vacuumNext() {
      while (g.vacuumQueue && g.vacuumQueue.length) {
        const ch = g.vacuumQueue.shift();
        if (T(ch.frightened) && !T(ch.dead) && handleGhostCollision(ch, 0, 0, 0, 0)) return;
      }
    }
    const handleGhostCollision = (ghost, pacX, pacY, ghostX, ghostY) => {
      if (phaseActive()) return false;
      if (T(ghost.stunned) && !ghost.frightened) return false;
      if (g.mode === "ateGhost" || g.mode === "caught") return false;
      if (pacX === ghostX && pacY === ghostY) {
        if (ghost.frightened) {
          ghost.dead = true;
          ghost.stunned = false;
          if (ghost.leaving) { ghost.leaving = false; ghost.entering = true; }
          ghost.frightened = false;
          ghost.speed = logic.getGhostSpeed(ghost);
          ghost.target();
          ghost.hidden = true;
          mode.setMode("ateGhost");
          g.sounds.thrust.stop();
          g.sounds.ateGhost.play();
          if (T(g.ghostScore)) g.ghostScore = g.ghostScore * 2; else g.ghostScore = g.fruitFrightened ? 400 : 200;
          if (g.freezeLeft > 0 && (g.freezeEaten = (g.freezeEaten || 0) + 1) === 4 && env.feat) env.feat("now"); // four in one Pause
          score(g.ghostScore);
          return true;
        } else if (!ghost.dead) {
          mode.setMode("caught");
          if (g.chars.clyde) g.suspendElroy = true;
          g.globalCounter = 0;
          return true;
        }
      }
      return false;
    };

    const updateGhostSpeed = (c, xTile, yTile) => {
      if (!c.dead && getCurrentMaze().isTunnel(xTile, yTile)) c.speed = g.level.tunnelSpeed;
      else if (c.frightened) c.speed = g.level.frightenedSpeed;
      else if (!c.housing) c.speed = logic.getGhostSpeed(c);
    };

    const handleGhostMovement = (c, oldX, oldY, newX, newY) => {
      if (newX !== oldX || newY !== oldY) {
        if (T(c.leaveRight)) {
          c.leaveRight -= 1;
          if (c.leaveRight === 0) { c.leaveRight = false; c.dir = 0; }
        } else {
          rand(); // nod to the OG random number thing
          if (!exact()) c.target(); // (EXACT: decided a pixel past the last tile's centre instead, below)
          if (!exact()) updateGhostSpeed(c, newX, newY); // (EXACT: by the arcade's tiles, below)
        }
      }
    };

    logic.advance = (c, xOff, yOff) => {
      c.x += DELTAS[c.dir].x;
      c.y += DELTAS[c.dir].y;
      if (!c.housing && !c.leaving && !c.entering) {
        if (c.dir % 2 === 0) {
          if (yOff > CENTER) c.y -= 1;
          if (yOff < CENTER) c.y += 1;
        } else if (exact()) { // EXACT: a corner cut pulls him toward the centre of the tile he's in by the arcade's tiles
          const cx = getCurrentMaze().occ(c)[0] * TILE + CENTER, x0 = c.x - DELTAS[c.dir].x;
          if (x0 < cx) c.x += 1;
          if (x0 > cx) c.x -= 1;
        } else {
          if (xOff < CENTER) c.x += 1;
          if (xOff > CENTER) c.x -= 1;
        }
        const cm = getCurrentMaze();
        const [xTile, xo, yTile, yo] = cm.getLoc(c);
        if (xTile === cm.w + 2) c.x = -2 * TILE + xo;
        else if (xTile === -3) c.x = (cm.w + 1) * TILE + xo;
        if (yTile === cm.h + 2) c.y = -2 * TILE + yo;
        else if (yTile === -3) c.y = (cm.h + 1) * TILE + yo;
      }
      c.moved = true;
    };

    // EXACT: which of a character's patterns the arcade would turn now (null: not moved by pattern: the house, eyes, the
    // other movement modes, an ability's speed); by its speed, which already follows the arcade's order (tunnel first)
    const exactKind = (c) => {
      if (g.exactPatLevel !== g.levelNumber) { levels.exactPatterns(); g.exactPatLevel = g.levelNumber; } // (a new level: fresh copies)
      if (!g.exactPat[c.name]) return null;
      const L = g.level;
      if (c === g.chars.pac) {
        if (g.config.movement !== 0) return null;
        if (T(g.frightened) && c.speed === L.pacFrightenedSpeed) return "pacFright";
        return c.speed === L.pacSpeed ? "pac" : null;
      }
      if (!c.target || c.housing || c.leaving || c.entering || c.dead || T(c.stunned)) return null;
      return c.speed === L.tunnelSpeed ? "tunnel" : c.speed === L.frightenedSpeed ? "ghostFright" : c.speed === L.elroy2Speed && c.elroy ? "elroy2"
        : c.speed === L.elroy1Speed && c.elroy ? "elroy1" : c.speed === L.ghostSpeed ? "ghost" : null;
    };
    logic.move = (c) => {
      const isPac = c === g.chars.pac;
      if (exact()) { // EXACT: a pattern's bit a tick for what the arcade moves by pattern; everything else once a frame
        const kind = exactKind(c);
        if (!kind && g.exactTick === 0) return;
        if (kind) {
          if (c.skipCounter && c.skipCounter > 0) { c.skipCounter -= 1; return; } // (the dot pause: the pattern stands still)
          const pat = g.exactPat[c.name], v = pat[kind];
          pat[kind] = ((v << 1) | (v >>> 31)) >>> 0;
          if (!(v >>> 31)) return;
          if (isPac) logic.turn(c); // EXACT: the arcade reads the stick only on a tick he moves (after the pause, a 1 from his pattern)
          c.accum16 = 16;
        }
      }
      if (c.skipCounter && c.skipCounter > 0) { c.skipCounter -= 1; return; }
      c.accum16 = c.accum16 || 0;
      const speed16 = c.speed * SPEED_FACTOR * 16;
      if (!(exact() && exactKind(c))) c.accum16 += speed16;
      while (c.accum16 >= 16) {
        c.moved = false;
        const cm = getCurrentMaze();
        const [xTile, xOff, yTile, yOff] = cm.getLoc(c);
        const oldX = xTile, oldY = yTile;
        c.accum16 -= 16;
        const exactPac = isPac && exact() && exactKind(c); // EXACT: his walls and centres by the arcade's tiles
        const ex = exactPac ? cm.occ(c) : null, ecx = ex && ex[0] * TILE + CENTER, ecy = ex && ex[2] * TILE + CENTER;
        if (exactPac ? (!cm.isWall(ex[0] + DELTAS[c.dir].x, ex[2] + DELTAS[c.dir].y) || (c.dir === 2 && c.x > ecx) || (c.dir === 3 && c.y > ecy) ||
          (c.dir === 0 && c.x < ecx) || (c.dir === 1 && c.y < ecy)) :
          (c.housing || c.leaving || c.entering || !cm.isBlocked(c, c.dir) ||
          (c.dir === 2 && xOff > CENTER) || (c.dir === 3 && yOff > CENTER) ||
          (c.dir === 0 && xOff < CENTER) || (c.dir === 1 && yOff < CENTER))) {
          logic.advance(c, xOff, yOff);
          // EXACT: the tunnel's slow zone by the arcade's tiles (its boundary a pixel over horizontally)
          if (exact() && c.target && !c.housing && !c.leaving && !c.entering) {
            const [ox, , oy] = cm.occ(c), key = ox + "," + oy;
            if (key !== c.exactTile) { c.exactTile = key; if (!T(c.leaveRight)) updateGhostSpeed(c, ox, oy); }
          }
          // EXACT: a ghost decides one pixel past a tile's centre, for the next tile (the arcade's one tile ahead)
          if (exact() && c.target && !c.housing && !c.leaving && !c.entering && !T(c.leaveRight) && (c.dir % 2 === 0 ? xOff === CENTER : yOff === CENTER)) {
            const [tx, , ty] = cm.occ(c);
            if (tx <= 0 || tx >= cm.w - 1) c.iDir = c.dir; // (no decisions at the tunnel's ends and beyond: straight on, as the arcade)
            else { c.exactNext = [tx + DELTAS[c.dir].x, ty + DELTAS[c.dir].y]; c.target(); c.exactNext = null; }
          }
          // EXACT: a reversal the mode change (or an energizer) asked for happens when the ghost reaches its tile's centre
          if (c.exactReverse && c.target && exact() && !c.housing && !c.leaving && !c.entering && mod(c.x, TILE) === CENTER && mod(c.y, TILE) === CENTER) { c.exactReverse = false; c.dir = (c.dir + 2) % 4; c.facing = c.dir; c.iDir = c.dir; } // (no new decision till the next tile)
        } else if (T(c.iDir) && !cm.isBlocked(c, c.iDir)) {
          if (isPac && g.config.movement === 3) {
            if (c.speed > MAX_THRUST) {
              mode.setMode("destroyed");
              if (g.chars.clyde) g.suspendElroy = true;
              g.globalCounter = 0;
            }
          } else {
            c.dir = c.iDir;
            c.facing = c.iDir;
            logic.advance(c, xOff, yOff);
          }
        }

        if (c.moved) {
          const [newX, newXOff, newY, newYOff] = cm.getLoc(c);
          if (c.target) {
            if (!c.leaving && !c.housing) handleGhostMovement(c, oldX, oldY, newX, newY);
            const hc = getCurrentMaze().houseCenter;
            if (c.dead && newY === c.houseY - 3 && newX === hc.x && newXOff === 0) {
              c.dir = 1; c.facing = 1; c.iDir = false; c.entering = true; c.speed = logic.getGhostSpeed(c);
            }
            if (c.entering && newY === c.houseY && newX === c.houseX && newXOff === 0) {
              c.dir = 3; c.facing = 3; c.iDir = false; c.dead = false;
              let anyDead = false, anyFrightened = false;
              for (const name of charKeys()) {
                const ch = g.chars[name];
                if (ch.dead) anyDead = true;
                if (ch.frightened) anyFrightened = true;
              }
              if (!anyDead) {
                g.sounds.dead.stop();
                if (anyFrightened) g.sounds.scared.play(); else playSiren();
              }
              c.entering = false;
              if (!T(c.leavingPreference)) c.leaving = true; else c.housing = true;
              c.speed = logic.getGhostSpeed(c);
            }
            if (c.leaving && newY === c.houseY - 3 && newYOff === CENTER) {
              c.dir = c.leavesRight ? 0 : 2;
              c.facing = c.dir;
              c.iDir = false; c.leaving = false; c.speed = logic.getGhostSpeed(c);
              if (!T(c.leaveRight) && !exact()) c.target();
            }
            if (g.mode !== "ateGhost") {
              const [pX, , pY] = cm.occ(g.chars.pac);
              const [gX, , gY] = cm.occ(c);
              if (handleGhostCollision(c, pX, pY, gX, gY)) break;
            }
          } else {
            const [pX, , pY] = cm.occ(g.chars.pac);
            checkCollisions(g.powers, pX, pY);
            checkCollisions(g.dots, pX, pY);
            // web edition bug fix (2026-11-13; the Lua had it too): in Plus Mode the fruit frightens the ghosts like an energizer, so
            // it wins a tie with a ghost the same way: eaten before the ghosts are checked (it used to come after, and a
            // ghost reached on the same step caught him). Elsewhere the fruit is still eaten after them, as before
            if (g.config.plusMode) eatFruit();
            for (const name of charKeys()) {
              const ch = g.chars[name];
              if (ch.target) {
                const [gX, , gY] = cm.occ(ch);
                if (handleGhostCollision(ch, pX, pY, gX, gY)) break;
              }
            }
          }

          logic.turn(c);
          eatFruit();
        } else if (isPac && g.config.movement === 3) {
          if (g.chars.pac.speed > MAX_THRUST) {
            mode.setMode("destroyed");
            if (g.chars.clyde) g.suspendElroy = true;
            g.globalCounter = 0;
          } else {
            if (g.chars.pac.speed > 0.8) g.sounds.bonk.play();
            g.chars.pac.speed = 0;
          }
        } else if (!isPac && !c.housing && !c.leaving && !c.entering) {
          // web edition safety net: a ghost blocked with no legal turn planned. Never happens in ordinary play (a ghost
          // always plans a legal turn ahead; the golden replay proves this branch never runs there), but the Blow could
          // leave one facing a wall with a stale plan, and it stood stuck until an energizer reversed it (found by the
          // author, twice). It takes an open way, sideways first, back the way it came last, and plans from there.
          // No RNG, so nothing else shifts
          for (const d of [(c.dir + 1) % 4, (c.dir + 3) % 4, (c.dir + 2) % 4]) {
            if (!cm.isWall(xTile + DELTAS[d].x, yTile + DELTAS[d].y)) { c.dir = d; c.facing = d; c.iDir = d; break; }
          }
        }
      }
    };

    // the fruit, eaten when Pac-Man is on its spot (not while phased through things); in Plus Mode it frightens the ghosts
    function eatFruit(vacuumed) {
      const fl = getCurrentMaze().fruitLoc;
      if (T(g.fruitTimer) && (vacuumed || (g.chars.pac.x === fl.x && g.chars.pac.y === fl.y)) &&
        (!T(ability()) || ability() >= 2 || (!T(g.chars.pac.phased) || g.chars.pac.phased <= 0))) {
        score(g.level.fruit.score);
        g.fruitTimer = false;
        g.fruitScoreTimer = 120;
        g.sounds.fruit.play();
        if (g.config.plusMode) {
          g.fruitFrightened = true; g.mazeFrightened = false;
          if (g.config.afterDark === 4) g.fadeTimer = g.fadeLength();
          handlers.activateFrightenedMode(true);
        }
      }
    }

    logic.turn = (c) => {
      const isPac = c === g.chars.pac;
      const cm = getCurrentMaze();
      const [xTile, xOff, yTile, yOff] = cm.getLoc(c);
      if (c.housing) {
        if (exact()) { // EXACT: the arcade's bob runs 4 pixels either side of the house's middle, turning on whole tiles
          if (yOff === 0) { if (yTile <= cm.houseCenter.y) { c.dir = 1; c.facing = 1; } else { c.dir = 3; c.facing = 3; } }
        } else {
          if (yOff === 0) { c.dir = 1; c.facing = 1; }
          if (yOff === 7) { c.dir = 3; c.facing = 3; }
        }
      } else if (c.leaving) {
        const hc = cm.houseCenter;
        if (xTile < hc.x) c.dir = 0;
        else if (xTile > hc.x || xOff > 0) { c.dir = 2; c.facing = 2; }
        else { c.dir = 3; c.facing = 3; }
      } else if (c.entering) {
        if (yTile === c.houseY && yOff === CENTER) {
          if (c.houseX < xTile) { c.dir = 2; c.facing = 2; }
          else if (c.houseX > xTile) { c.dir = 0; c.facing = 0; }
        }
      } else if (T(c.iDir)) {
        if (Math.abs(c.dir - c.iDir) === 2) {
          c.facing = c.iDir;
          if (isPac && g.config.movement === 3) {
            if (g.playerInput) {
              g.chars.pac.speed = g.chars.pac.speed - thrust();
              if (g.chars.pac.speed < 0) { g.chars.pac.speed = Math.abs(g.chars.pac.speed); c.dir = c.iDir; }
            }
          } else {
            c.dir = c.iDir;
          }
        }
        if (isPac && g.config.movement === 3 && c.iDir === c.dir && g.playerInput) {
          g.chars.pac.speed = g.chars.pac.speed + thrust(); // no max!
        }
        if (mod(c.dir - c.iDir, 2) === 1 && yTile > 0 && yTile < cm.h && xTile > 0 && xTile < cm.w) {
          const turnWindow = c.turnWindow || 0;
          if (exact() && isPac) { // EXACT: the arcade turns him anywhere inside the junction's tile (its tiles: 4 pixels short of the centre on one side, 3 on the other)
            const [ox, , oy] = cm.occ(c);
            if (!cm.isWall(ox + DELTAS[c.iDir].x, oy + DELTAS[c.iDir].y)) { c.dir = c.iDir; c.facing = c.iDir; }
          } else if (c.dir % 2 === 0) {
            if (!cm.isBlocked(c, c.iDir) && Math.abs(xOff - CENTER) <= turnWindow) { c.dir = c.iDir; c.facing = c.iDir; }
          } else if (!cm.isBlocked(c, c.iDir) && Math.abs(yOff - CENTER) <= turnWindow) { c.dir = c.iDir; c.facing = c.iDir; }
        }
      }
      if (isPac && g.config.movement === 3 && T(c.iDir)) c.facing = c.iDir;
    };

    logic.getGhostSpeed = (c) => {
      if (c.housing) return exact() ? 0.4 : 0.35; // EXACT: half a pixel a frame, as the arcade
      if (c.leaving) return exact() ? 0.4 : 0.35;
      if (c.dead) return 1.6;
      if (c.elroy && !g.suspendElroy) {
        if (g.dots.length <= g.level.elroy2) return g.level.elroy2Speed;
        else if (g.dots.length <= g.level.elroy1) return g.level.elroy1Speed;
      }
      if (c.frightened) return g.level.frightenedSpeed;
      return g.level.ghostSpeed;
    };

    logic.getPacSpeed = () => {
      if (g.config.movement === 0) return g.level.pacSpeed;
      if (g.config.movement === 1) return 1.2;
      if (g.config.movement === 2) return 1.6;
      if (g.config.movement === 3) return 0;
    };

    // ------------------------------------------------------------------ modes
    const stopMusic = () => {
      if (!g.attract) { for (const k of Object.keys(g.music)) if (g.music[k].isPlaying()) g.music[k].stop(); if (g.fever.isPlaying()) g.fever.stop(); }
    };
    const mode = {};
    const modes = {
      attract: {
        // The original waited 30 + 112 frames (timed to the "pac-man fever" music) before showing the title; this port has no
        // music, so it starts straight on the title (set env.originalAttract for the frame-exact comparison against the Lua).
        startup: env.originalAttract
          ? { frames: 30, state: {}, nextMode: "hideGame", startFunc() { g.booze.x = 0; } }
          : { frames: 1, state: { showHelperText: true, showGameName: true, showBooze: true }, nextMode: "restart", startFunc() { g.booze.x = 0; } },
        hideGame: {
          startFunc() { if (!g.fever.isPlaying()) g.fever.play(); },
          frames: 112, state: { showHelperText: true, showGameName: false }, nextMode: "restart",
        },
        restart: {
          frames: 720, state: { showHelperText: true, showGameName: true, showBooze: true },
          startFunc() { g.ghosts = null; },
          endFunc() {
            g.attract = true; g.originalVolume = g.config.volume;
            if (g.config.movement === 3) { g.originalMovement = g.config.movement; g.config.movement = 0; }
            g.config.volume = 0; setScene("game");
          },
        },
        play: {
          frames: 20, state: { showHelperText: false, showGameName: false, showBooze: false },
          endFunc() { setScene("game"); },
        },
      },
      game: {
        pregame: {
          startFunc() {
            if (!g.attract) { for (const k of Object.keys(g.music)) if (g.music[k].isPlaying()) g.music[k].stop(); if (g.fever.isPlaying()) g.fever.stop(); }
          },
          frames: 30, state: { running: false, showPac: false, showGhosts: false, hideMaze: true }, nextMode: "playerUp",
          endFunc() { if (pro()) mode.setMode("ready"); }, // web edition: Pro Mode skips the jingle
        },
        playerUp: {
          frames: 135, state: { running: false, showPac: false, showGhosts: false }, nextMode: "ready",
          startFunc() { for (const p of g.powers) p.frame = 1; g.sounds.opening.play(); },
        },
        ready: {
          frames: 120, nextMode: "normal",
          startFunc() {
            if (!g.attract) for (const k of Object.keys(g.music)) if (g.music[k].isPlaying()) g.music[k].stop();
            for (const p of g.powers) p.frame = 1;
            g.chars.pac.frame = 1;
            if (g.config.ability === RANDOM && ((g.newLevel && !g.randomFresh) || !g.randomAbility)) pickRandomAbility(); // Random: a new board's pick
            g.randomFresh = false;
            const died = !g.newLevel;
            if (g.newLevel) g.newLevel = false; else g.lives = g.lives - 1;
            if (g.lives < 0) mode.setMode("gameover");
            // web edition (the author, 2026-11-20): caught on the step that cleared the board (a Suck taking the last dots
            // and a ghost that isn't blue): after the death, straight to the board done, no READY and no frame of play on
            // an empty board first (an older replay plays it the old way: env.oldClearedDeath)
            else if (died && g.dots.length === 0 && g.powers.length === 0 && !(env.oldClearedDeath && env.oldClearedDeath())) {
              characters.reset();
              mode.setMode("levelComplete");
            } else {
              if (pro()) g.modeTimer = PRO_READY;
              g.fruitTimer = false; g.fruitScoreTimer = false;
              g.state = { showPac: true, showGhosts: true, showReady: true };
              g.starvation = 0;
              g.vacuumSpent = false; g.vacuumQueue = []; g.vacuumFx = 0; g.vacuumFly = []; g.vacuumGhosts = []; // the Vacuum's charge, back at every READY
              g.pushSpent = false; g.pushGhosts = []; g.pushFx = 0;             // and the Push's
              g.pauseSpent = false; g.freezeLeft = 0;                            // and the Pause's
              characters.reset();
              levels.resetLevel();
              if (exact()) { // EXACT: every life starts the movement counters afresh (the house bob's rhythm restarts with it); the arcade's
                // pause counter is 0 at every READY, so Pac-Man sits out each life's first tick
                for (const name of charKeys()) g.chars[name].accum16 = undefined;
                g.exactPatLevel = null; // (and the speed patterns copied in afresh, as the arcade does every life)
                g.chars.pac.skipCounter = 1;
                if (env.frightReset) env.frightReset(); // (and the arcade's generator back to its start)
              }
            }
          },
          endFunc() { playSiren(); },
        },
        normal: {
          startFunc() { if (!g.attract) g.levelMusic.play(); },
          state: { running: true, showPac: true, showGhosts: true },
        },
        // web edition: the Vacuum dragging ghosts in (play stopped meanwhile); vacuumEnd settles it (the mode's already
        // normal by then, so it can go straight to ateGhost or caught)
        vacuum: {
          state: { running: false, showPac: true, showGhosts: true }, frames: VACUUM_FX, nextMode: "normal",
          endFunc() { vacuumEnd(); },
        },
        // web edition: the Push flinging ghosts away (play stopped meanwhile)
        push: {
          state: { running: false, showPac: true, showGhosts: true }, frames: PUSH_FX, nextMode: "normal",
          endFunc() { pushEnd(); },
        },
        ateGhost: {
          state: { running: false, showPac: false, showGhosts: true }, frames: 60, nextMode: "normal",
          endFunc() {
            for (const name of charKeys()) g.chars[name].hidden = false;
            g.sounds.scared.stop();
            if (!g.sounds.dead.isPlaying()) g.sounds.dead.play();
            logic.eatOverlappingFrightened();
            if (g.mode === "ateGhost") return;
            vacuumNext(); // the Vacuum's next ghost, if it caught more (the mode is already back to normal here)
          },
        },
        caught: {
          state: { running: false, showPac: true, showGhosts: true }, frames: 60, nextMode: "dying",
          endFunc() { if (pro()) mode.setMode("ready"); }, // web edition: Pro Mode has no death animation
          startFunc() {
            g.sounds.thrust.stop();
            if (!g.attract) for (const k of Object.keys(g.music)) if (g.music[k].isPlaying()) g.music[k].stop();
            if (g.config.radar) g.radarTimer = g.config.radar + 60;
            g.particles = [];
            g.state.turnaroundCooldown = null;
            stopSiren(); g.sounds.dead.stop(); g.sounds.scared.stop();
          },
        },
        destroyed: {
          state: { running: false, showPac: false, showGhosts: true }, frames: 60, nextMode: "dying",
          endFunc() { if (pro()) mode.setMode("ready"); },
          startFunc() {
            g.sounds.crash.play(); g.sounds.thrust.stop();
            if (!g.attract) for (const k of Object.keys(g.music)) if (g.music[k].isPlaying()) g.music[k].stop();
            if (g.config.radar) g.radarTimer = g.config.radar + 60;
            g.particles = [];
            g.state.turnaroundCooldown = null;
            stopSiren(); g.sounds.dead.stop(); g.sounds.scared.stop();
          },
        },
        dying: {
          state: { running: false, showPac: false, showGhosts: false }, frames: 210, nextMode: "ready",
          startFunc() { g.diedSoundPlayed = false; },
          endFunc() {
            if (g.attract) {
              g.config.volume = g.originalVolume; g.attract = false; g.originalVolume = null;
              setScene("attract", true);
            }
          },
        },
        gameover: {
          state: { running: false, showPac: false, showGhosts: false }, frames: 240,
          // web edition: env.afterGameOver can route a real (non-autoplay, non-demo) game to name entry
          endFunc() { if (g.autoplay) setScene("game"); else setScene((!g.attract && env.afterGameOver && env.afterGameOver(g.score)) || "attract"); },
        },
        levelComplete: {
          state: { running: false, showPac: true, showGhosts: true }, frames: 120,
          startFunc() {
            g.fadeTimer = g.fadeLength(); g.particles = []; stopSiren(); g.sounds.dead.stop(); g.sounds.scared.stop(); g.sounds.thrust.stop();
            if (pro()) g.modeTimer = PRO_BOARD_DONE;
          },
          nextMode: "levelAnimation",
          // web edition: Pro Mode: a brief pause, then the next board (no flashing maze, so no intermissions either)
          endFunc() { if (pro()) mode.setMode("pause"); },
        },
        placeholderIntermission: {
          startFunc() { stopMusic(); g.startX = 0; g.startY = 0; },
          state: { running: false, showPac: false, showGhosts: false, hideMaze: true, hideScore: true, hideLines: true },
          frames: 720, nextMode: "pause", endFunc() { g.intermissionBoozes = null; },
        },
        intermission1: {
          startFunc() { stopMusic(); g.startX = 0; g.startY = 0; },
          state: { running: false, showPac: false, showGhosts: false, hideMaze: true, hideScore: true, hideLines: true },
          frames: 720, nextMode: "pause", endFunc() { g.particles = []; },
        },
        intermission2: {
          startFunc() { stopMusic(); g.startX = 0; g.startY = 0; },
          state: { running: false, showPac: false, showGhosts: false, hideMaze: true, hideScore: true, hideLines: true },
          frames: 720, nextMode: "pause", endFunc() { g.particles = []; },
        },
        intermission3: {
          startFunc() { stopMusic(); g.startX = 0; g.startY = 0; },
          state: { running: false, showPac: false, showGhosts: false, hideMaze: true, hideScore: true, hideLines: true },
          frames: 840, nextMode: "pause", endFunc() { g.particles = []; },
        },
        levelAnimation: {
          state: { running: false, showPac: false, showGhosts: false }, frames: 85,
          startFunc() { g.fruitTimer = false; g.fruitScoreTimer = false; },
          endFunc() {
            const n = g.levelNumber;
            if (n === 2 || n === 13) mode.setMode("intermission1");
            else if (n === 5 || n === 17) mode.setMode("intermission2");
            else if (n === 9) mode.setMode("intermission3");
            else mode.setMode("pause");
          },
        },
        pause: {
          state: { hideMaze: true, running: false, showPac: false, showGhosts: false }, frames: 20, nextMode: "ready",
          endFunc() {
            g.levelNumber += 1;
            levels.startLevel(g.levelNumber);
            characters.initialize();
            characters.reset();
            getCurrentMaze().init();
            g.newLevel = true;
          },
        },
      },
    };
    mode.isStarted = (name) => modes[g.scene.name][name].started;
    mode.setMode = (name) => {
      if (modes[g.scene.name][name]) { g.mode = name; modes[g.scene.name][name].started = false; }
    };
    mode.handle = () => {
      if (g.mode && modes[g.scene.name][g.mode]) {
        const cur = modes[g.scene.name][g.mode];
        if (!cur.started) {
          if (cur.frames) { g.modeTimer = cur.frames; cur.started = true; }
          if (cur.startFunc) cur.startFunc();
          if (cur.state) g.state = cur.state;
        }
        if (cur.frames) {
          g.modeTimer -= 1;
          if (g.modeTimer === 0) {
            if (cur.nextMode) mode.setMode(cur.nextMode);
            if (cur.endFunc) cur.endFunc();
            cur.started = false;
          }
        }
      }
    };

    // ------------------------------------------------------------------ menus (main menu only for now)
    const wakka = () => { if (g.wakka) { g.sounds.wakka2.play(); g.wakka = false; } else { g.sounds.wakka1.play(); g.wakka = true; } };
    const menus = {
      main: Object.assign([
        { text: "Play 1P", x: 10, y: 25, action() { g.autoplay = false; mode.setMode("play"); } },
        { text: "Options", x: 10, y: 27, action() { setScene("options"); } },
        { text: "Credits", x: 10, y: 28, action() { setScene("credits"); } },
        { text: "Exit", x: 10, y: 29, action() { if (env.quit) env.quit(); } },
        { text: "Autoplay", x: 10, y: 31, action() { g.autoplay = true; if (g.config.movement === 3) { g.originalMovement = g.config.movement; g.config.movement = 0; } mode.setMode("play"); } },
      ], { selectedItem: 1 }),
    };
    if (env.noExit) { menus.main.splice(3, 1); menus.main[3].y -= 1; }
    // web edition: the online leaderboard takes the old Exit slot (Autoplay back at its original row)
    if (env.scenes && env.scenes.leaderboard) { menus.main.splice(3, 0, { text: "Leaderboards", x: 10, y: 29, action() { setScene("leaderboard"); } }); menus.main[4].y = 31; }
    // web edition: "Share Config" copies a link that carries the gameplay settings (env.shareConfig, see main.js)
    const shareItem = (x, y) => ({ text: "Share Config", share: true, x, y, action() { env.shareConfig(); } });
    // web edition: no Autoplay item (env.noAutoplay; the autoplay code itself stays), Share Config in its row
    if (env.noAutoplay) menus.main.splice(menus.main.findIndex((it) => it.text === "Autoplay"), 1);
    // (Share Config is on the Options and Leaderboard pages, not the main menu)
    // web edition: Credits is a link on the title (env.creditsOnTitle; render.js) or on the Options page
    // (env.creditsInOptions), not a main-menu item; its row stays blank
    if (env.creditsInOptions || env.creditsOnTitle) menus.main.splice(menus.main.findIndex((it) => it.text === "Credits"), 1);
    // web edition: Arenas (24-hour leaderboards) right under Play
    if (env.scenes && env.scenes.arenas) {
      menus.main.splice(1, 0, { text: "Arenas", x: 10, y: 27, action() { setScene("arenas"); } });
      for (const it of menus.main) if (it.text === "Options") it.y = 29; else if (it.text === "Leaderboards") it.y = 31; // a blank row between items
    }
    // web edition: Favorites (the author, 2026-11-15: saved gameplay settings, logged in) under Arena; logged out it says
    // so, like Create Arena
    if (env.scenes && env.scenes.favorites) {
      menus.main.splice(menus.main.findIndex((it) => it.text === "Options"), 0, { text: "Favorites", x: 10, y: 29, action() {
        if (env.loggedIn && !env.loggedIn()) { g.toast = { text: "log in to save favorites", until: (typeof performance !== "undefined" ? performance.now() : 0) + 2500 }; return; }
        setScene("favorites");
      } });
      for (const it of menus.main) if (it.text === "Options") it.y = 31; else if (it.text === "Leaderboards") it.y = 33;
    }
    // web edition: the title's menu a row higher, with the rest of the title (the author, 2026-11-15; not CREDITS)
    if (env.scenes) for (const it of menus.main) it.y -= 1;
    const menuConfirm = (menu) => {
      const item = menu[menu.selectedItem - 1];
      if (item.text && (item.text === "Play" || item.text === "Play 1P")) { g.sounds.coindrop.stop(); g.sounds.coindrop.play(); } // (web edition: the item became "Play 1P" and lost its coin drop for a while: the author noticed, 2026-11-17)
      else if (item.sound) { g.sounds[item.sound].stop(); g.sounds[item.sound].play(); } else wakka();
      if (item.options) { menu.selectedItem += 1; clampMenu(menu); }
      else { item.action(); if (menu.autosave) menu.autosave(); }
    };
    const clampMenu = (menu) => {
      if (menu.selectedItem < 1) menu.selectedItem = menu.length;
      if (menu.selectedItem > menu.length) menu.selectedItem = 1;
    };
    const cycle = (menu, dir) => {
      const item = menu[menu.selectedItem - 1];
      if (!item.options) return false;
      wakka();
      item.selectedOption += dir;
      if (item.selectedOption < 1) item.selectedOption = item.options.length;
      if (item.selectedOption > item.options.length) item.selectedOption = 1;
      item.options[item.selectedOption - 1].action();
      if (menu.autosave) menu.autosave();
      return true;
    };
    const mLeft = (menu) => { cycle(menu, -1); };
    const mRight = (menu) => { wakka(); const item = menu[menu.selectedItem - 1]; if (item.options) { item.selectedOption += 1; if (item.selectedOption > item.options.length) item.selectedOption = 1; item.options[item.selectedOption - 1].action(); if (menu.autosave) menu.autosave(); } else menuConfirm(menu); };
    menus.keypressed = (menu, key) => {
      if (key === "up") { wakka(); menu.selectedItem -= 1; }
      else if (key === "down") { wakka(); menu.selectedItem += 1; }
      else if (key === "left") mLeft(menu);
      else if (key === "right") mRight(menu);
      clampMenu(menu);
      if (key === "return") menuConfirm(menu);
    };
    menus.gamepadpressed = (menu, button) => {
      if (g.mode === "restart") g.modeTimer = 600;
      if (button === "dpup") { wakka(); menu.selectedItem -= 1; }
      else if (button === "dpdown") { wakka(); menu.selectedItem += 1; }
      else if (button === "dpleft") mLeft(menu);
      else if (button === "dpright") mRight(menu);
      clampMenu(menu);
      if (button === "a") menuConfirm(menu);
    };
    menus.update = () => {};

    // ------------------------------------------------------------------ scenes
    const attractMenu = menus.main;
    g.booze = { x: 0, y: 180, dir: 0, speed: 0.75, animator: () => animations.booze };
    let attractFc = 0, gameFc = 0;
    let keyPressTimes = {};

    const GHOST_ORDER = ["blinky", "pinky", "inky", "clyde", "punky", "gunky", "gronky"];
    const attract = {
      name: "attract",
      start(skipMusic) {
        g.particles = [];
        g.startX = 0;
        g.startY = 24;
        mode.setMode("startup");
        attractMenu.selectedItem = 1;
        stopSiren();
        if (g.originalMovement !== undefined && g.originalMovement !== null) { g.config.movement = g.originalMovement; g.originalMovement = null; }
        if (g.originalVolume) { g.config.volume = g.originalVolume; g.originalVolume = null; }
        if (g.volumeBeforeMute) g.config.volume = g.volumeBeforeMute;
        g.attract = false;
        applyVolume();
        for (const k of Object.keys(g.sounds)) g.sounds[k].stop();
        if (!skipMusic) {
          for (const k of Object.keys(g.music)) if (g.music[k].isPlaying()) g.music[k].stop();
          if (g.fever.isPlaying()) g.fever.stop();
        }
      },
      update() {
        attractFc += 1;
        mode.handle();
        menus.update(attractMenu);

        if (g.mode === "restart" && mode.isStarted("restart")) {
          if (!g.ghosts) {
            const mkg = (x, y, dir, anim, idx) => ({ x, y, dir, speed: 0.6, accum: 0, anim, animIdx: idx, animator() { return animations[this.anim][this.animIdx]; } });
            g.ghosts = {
              blinky: { x: 112, y: 185, dir: 3, speed: 0.6, accum: 0, scared: false, animator() { return this.scared ? animations.scaredBlue : animations.booze; } },
              pinky: mkg(-6, 90, 0, "pinky", 0), inky: mkg(-26, 90, 0, "inky", 0), clyde: mkg(-46, 90, 0, "clyde", 0),
              punky: mkg(230, 90, 2, "punky", 2), gunky: mkg(250, 90, 2, "gunky", 2), gronky: mkg(270, 90, 2, "gronky", 2),
            };
            // original animators return the direction-indexed ghost animation, or scared blue once Pac gets close
            for (const n of GHOST_ORDER) {
              const c = g.ghosts[n];
              if (n === "blinky") continue;
              const base = c.animator;
              c.scared = false;
              c.animator = function () { return this.scared ? animations.scaredBlue : base.call(this); };
            }
          }

          if (g.modeTimer < 720) {
            const animTimer = 720 - g.modeTimer;
            for (const name of GHOST_ORDER) {
              const char = g.ghosts[name];
              if (g.modeTimer > 560 || g.modeTimer <= 135) {
                char.accum += char.speed;
                while (char.accum > 1) {
                  char.accum -= 1;
                  char.x += DELTAS[char.dir].x;
                  char.y += DELTAS[char.dir].y;
                }
              }
              if (g.modeTimer === 560) {
                for (const n of ["pinky", "inky", "clyde", "punky", "gunky", "gronky"]) g.ghosts[n].animIdx = 1;
              }
              if (g.modeTimer === 135) {
                for (const n of GHOST_ORDER) { g.ghosts[n].dir = 2; g.ghosts[n].speed = 1.4; }
              }
              graphics.updateAnimation(char, animTimer);
            }

            if (g.modeTimer === 560) {
              g.attractPac = { x: -10, y: 180, dir: 0, speed: 0.44, accum: 0, animator: () => animations.pac[0] };
            }
            if (g.modeTimer < 560) {
              const ap = g.attractPac;
              ap.accum += ap.speed;
              while (ap.accum > 1) {
                ap.accum -= 1;
                ap.x += DELTAS[ap.dir].x;
                ap.y += DELTAS[ap.dir].y;
              }
              graphics.updateAnimation(ap, animTimer);
              graphics.emitBlinkyBubbles(g.ghosts.blinky.x, g.ghosts.blinky.y);
              graphics.updateParticles();
              if (ap.x === 176) for (const n of GHOST_ORDER) g.ghosts[n].scared = true;
            }
          }
        }
      },
      keypressed(key) { menus.keypressed(attractMenu, key); },
      gamepadpressed(button) { menus.gamepadpressed(attractMenu, button); },
    };

    // ---- autoplay helpers
    const isScaryMonster = (xTile, yTile, dir, distance) => {
      distance = distance || 1;
      for (const name of charKeys()) {
        const char = g.chars[name];
        if (char.target && !char.dead && !char.frightened && !char.housing) {
          const d = DELTAS[dir];
          const tx = xTile + d.x * distance, ty = yTile + d.y * distance;
          const [cx, , cy] = getCurrentMaze().getLoc(char);
          if (cx === tx && cy === ty) return true;
        }
      }
      return false;
    };
    // web edition (the author, 2026-11-15): Boost in Jetpack (which has no top speed for it to raise) is Jetpack's own
    // thrust, BOOST_THRUST times as strong, for Boost's second, whichever way he faces, stick held or not: so he can turn
    // round and blast off the other way. The physics are Jetpack's (braking, turning round, the crash rule).
    const jetBoost = () => g.config.movement === 3 && ability() === 2 && T(g.chars.pac.phased) && g.chars.pac.phased > 0;
    const thrust = () => jetBoost() ? THRUSTER_SPEED * BOOST_THRUST : THRUSTER_SPEED;
    const phasePac = () => {
      g.chars.pac.phaseDir = g.chars.pac.dir;
      g.chars.pac.phased = 60;
      if (g.sounds.phase.isPlaying()) g.sounds.phase.stop();
      g.sounds.phase.play();
      if ((g.config.movement === 0 || g.config.movement === 1) && ability() === 2) g.chars.pac.speed = 1.6;
      if (ability() === 3) {
        for (const name of charKeys()) {
          const ch = g.chars[name];
          if (ch.target && !ch.dead) {
            const cm = getCurrentMaze();
            const [cx, , cy] = cm.occ(ch);
            const [px, , py] = cm.occ(g.chars.pac);
            const dv = DELTAS[g.chars.pac.dir];
            for (let i = 1; i <= STUN_DISTANCE; i++) {
              const tx = px + dv.x * i, ty = py + dv.y * i;
              if (cm.isWall(tx, ty)) break;
              if (cx === tx && cy === ty) { ch.stunned = 60; ch.spinDirection = rand(); break; }
            }
          }
        }
      }
    };

    const handlePlayerInput = () => {
      const pac = g.chars.pac;
      if (g.config.movement !== 3) pac.iDir = false;
      g.playerInput = false;
      if (g.autoplay || g.attract) {
        const cm = getCurrentMaze();
        const [xTile, xOff, yTile, yOff] = cm.occ(pac);
        const d = DELTAS[pac.dir];
        const oneAhead = { xTile: xTile + d.x, yTile: yTile + d.y };
        if (isScaryMonster(xTile, yTile, pac.dir, 1) || isScaryMonster(xTile, yTile, pac.dir, 2) ||
          isScaryMonster(oneAhead.xTile, oneAhead.yTile, (pac.dir + 1) % 4, 1) ||
          isScaryMonster(oneAhead.xTile, oneAhead.yTile, mod(pac.dir - 1, 4), 1)) {
          if (T(ability()) && !T(pac.phased)) phasePac();
          if (curAbility() === REWIND && env.rewind) env.rewind(); // web edition: the autoplayer rewinds out of trouble too
          if (curAbility() === PUSH) push(); // web edition: and blows them away (once a life / board / energizer)
          if (!T(pac.phased)) {
            pac.iDir = (pac.dir + 2) % 4;
            return;
          }
        }
        if (xOff === CENTER && yOff === CENTER) {
          if (T(g.state.turnaroundCooldown) && g.state.turnaroundCooldown > 0) {
            g.state.turnaroundCooldown -= 1;
            if (g.state.turnaroundCooldown === 0) g.state.turnaroundCooldown = null;
          }
          const candidates = [];
          for (let i = 0; i <= 3; i++) {
            const cm2 = getCurrentMaze();
            if (!cm2.isBlocked(pac, i) && (T(pac.phased) || (!isScaryMonster(xTile, yTile, i, 1) && !isScaryMonster(xTile, yTile, i, 2)))) {
              if (Math.abs(i - pac.dir) === 2 && !T(g.state.turnaroundCooldown)) candidates.push(i);
              else if (Math.abs(i - pac.dir) !== 2) candidates.push(i);
            }
          }
          if (candidates.length === 1) { pac.iDir = candidates[0]; return; }
          const positions = [];
          if (T(g.fruitTimer)) { const fl = getCurrentMaze().fruitLoc; positions.push({ x: fl.x / 8, y: fl.y / 8 }); }
          for (const dot of g.dots) positions.push({ x: dot.x, y: dot.y });
          for (const p of g.powers) positions.push({ x: p.x, y: p.y });
          let minDist = null, closest = [];
          for (const pos of positions) {
            const dx = pos.x - xTile, dy = pos.y - yTile;
            const dist = dx * dx + dy * dy;
            if (minDist === null || dist < minDist) { minDist = dist; closest = [pos]; }
            else if (dist === minDist) closest.push(pos);
          }
          let bestTarget;
          if (closest.length > 1) bestTarget = closest[rand(closest.length) - 1]; else bestTarget = closest[0];
          findBestDirection(pac, xTile, yTile, bestTarget.x, bestTarget.y, candidates);
          if (T(pac.iDir) && Math.abs(pac.iDir - pac.dir) === 2) {
            const cm3 = getCurrentMaze();
            g.state.turnaroundCooldown = Math.ceil(Math.max(cm3.w, cm3.h) / 2);
          }
        }
      }
      // web edition (the author, 2026-11-14): in autoplay and the attract demo the player's keys and pad don't steer him
      // (they used to override the autoplayer's choice)
      if (g.autoplay || g.attract) return;
      // gamepad (d-pad has priority, then left stick)
      const pad = env.gamepad && env.gamepad();
      if (pad) {
        if (pad.dpright) { pac.iDir = 0; g.playerInput = true; }
        if (pad.dpdown) { pac.iDir = 1; g.playerInput = true; }
        if (pad.dpleft) { pac.iDir = 2; g.playerInput = true; }
        if (pad.dpup) { pac.iDir = 3; g.playerInput = true; }
        if (pac.iDir === false) {
          const dz = 0.3, ax = Math.abs(pad.leftx), ay = Math.abs(pad.lefty);
          if (ax > dz || ay > dz) {
            { if (ax > ay) pac.iDir = pad.leftx > 0 ? 0 : 2; else pac.iDir = pad.lefty > 0 ? 1 : 3; g.playerInput = true; }
          }
        }
      }
      // keyboard: the most recently pressed direction key wins
      const currentlyDown = {};
      for (const joyDir of JOY_KEY_ORDER) {
        if (isDown(joyDir)) {
          if (keyPressTimes[joyDir] === undefined) keyPressTimes[joyDir] = gameFc;
          currentlyDown[joyDir] = JOY_DIRS[joyDir];
        } else delete keyPressTimes[joyDir];
      }
      let mostRecentKey = null, mostRecentFrame = -1;
      for (const joyDir of JOY_KEY_ORDER) {
        if (currentlyDown[joyDir] !== undefined && keyPressTimes[joyDir] !== undefined && keyPressTimes[joyDir] > mostRecentFrame) {
          mostRecentFrame = keyPressTimes[joyDir]; mostRecentKey = joyDir;
        }
      }
      if (mostRecentKey) { pac.iDir = currentlyDown[mostRecentKey]; g.playerInput = true; }
      if (jetBoost()) { // Boost thrusts whether the stick is held or not; before any steering (a new life), the way he faces
        if (!T(pac.iDir)) pac.iDir = T(pac.facing) || pac.facing === 0 ? pac.facing : pac.dir;
        g.playerInput = true;
      }

      if (!g.playerInput && g.config.movement === 3) {
        pac.speed = Math.max(pac.speed - THRUSTER_SPEED / 2, 0);
      }

      if (g.config.movement === 3) {
        if (g.playerInput) {
          g.sounds.thrust.play();
          let px = pac.x + rand(-1, 1);
          let py = pac.y + rand(-1, 1);
          const dir = pac.iDir;
          if (dir !== undefined && dir !== null) {
            if (dir === 0) px -= 4; else if (dir === 2) px += 4; else if (dir === 1) py -= 4; else if (dir === 3) py += 4;
            const dirTable = { 0: { x: -1, y: 0 }, 1: { x: 0, y: -1 }, 2: { x: 1, y: 0 }, 3: { x: 0, y: 1 } };
            const dv = dirTable[dir];
            if (dv) {
              for (let i = 1; i <= 5; i++) {
                const spread = (rand() - 0.5) * 0.5;
                const dx = dv.x + spread * (dv.y !== 0 ? 1 : 0);
                const dy = dv.y + spread * (dv.x !== 0 ? 1 : 0);
                const speed = 1 + rand() * 5;
                const c1 = 240 / 255, c2 = (60 + rand(0, 120)) / 255, c3 = (10 + rand(0, 30)) / 255;
                const life = 3 + rand(0, 3);
                const size = 0.5 + rand();
                g.particles.push({ x: px, y: py, vx: dx * speed, vy: dy * speed, colors: [c1, c2, c3], life, maxLife: 6, size });
              }
              for (let i = 1; i <= 10; i++) {
                const spread = (rand() - 0.5) * 0.5;
                const dx = dv.x + spread * (dv.y !== 0 ? 1 : 0);
                const dy = dv.y + spread * (dv.x !== 0 ? 1 : 0);
                const speed = 1 + rand() * 5;
                rand(); // `local red = math.random() < 0.8` (unused, but it consumes a random number)
                const c2 = 0.6 + rand() * 0.4;
                const life = 1 + rand(0, 2);
                const size = 0.5 + rand();
                g.particles.push({ x: px, y: py, vx: dx * speed, vy: dy * speed, colors: [0.3, c2, 0.3], life, maxLife: 3, size });
              }
            }
          }
        } else {
          g.sounds.thrust.stop();
        }
      }
    };
    const updateFrightenedState = (tick) => {
      if (exact() && !tick) return; // (EXACT: counted a tick at a time, in the tick loop)
      if (T(g.frightened) && tick) { // EXACT: a tick's worth; it ends on the very tick (the frame count follows, for the flashing)
        g.exactFrightTicks -= 1;
        if (g.exactFrightTicks > 0) { g.frightened = Math.ceil(g.exactFrightTicks / 2); return; }
        g.frightened = 1;
      }
      if (T(g.frightened)) {
        g.frightened -= 1;
        if (g.frightened <= 0) {
          g.sounds.scared.stop();
          let anyDead = false;
          for (const name of charKeys()) if (g.chars[name].dead) { anyDead = true; break; }
          if (!anyDead) playSiren();
          g.fruitFrightened = false;
          g.frightened = false;
          if (g.mazeFrightened) { g.mazeFrightened = false; if (g.config.afterDark === 5) g.fadeTimer = g.fadeLength(); }
          if (g.config.movement === 0 && (!T(ability()) || ability() === 1)) g.chars.pac.speed = g.level.pacSpeed;
          for (const name of charKeys()) {
            const c = g.chars[name];
            // (the speed is worked out while it's still frightened, so it stays slow till its next tile: the author's game;
            // EXACT: the arcade's ghost is back to normal speed at once)
            if (c.target && c.frightened) { if (exact()) c.frightened = false; c.speed = logic.getGhostSpeed(c); c.frightened = false; }
          }
        }
      }
    };

    const handleModeSwitching = () => {
      if (g.config.scatterOption === 3) return;
      if (!T(g.frightened)) {
        g.level.timer += 1;
        const sw = g.level.switch;
        for (let si = 0; si < sw.length; si++) {
          const switchTime = sw[si];
          if (g.level.timer === switchTime) {
            // web edition (the author, watching a real Ms. Pac-Man machine, 2026-11-14): in MSPAC only the first two
            // switches do anything (to chase and reverse, then reverse again, still chasing); after that the ghosts
            // never reverse on the timer again
            if (g.config.scatterOption === 2 && si > 1) break;
            if (!g.config.scatterOption || g.config.scatterOption !== 2 || si === 0) g.level.chase = !g.level.chase;
            for (const name of charKeys()) {
              const c = g.chars[name];
              if (c.target) {
                if (exact()) { if (!c.dead) c.exactReverse = true; } // EXACT: every ghost, in the house too, turns round at its next tile centre out in the maze
                else {
                  if (c.housing) c.leaveRight = 2;
                  if (!c.housing && !c.leaving && !c.entering && !c.dead) { c.dir = (c.dir + 2) % 4; c.facing = c.dir; c.target(); }
                }
              }
            }
            break;
          }
        }
      }
    };

    const updateCharacterMovement = (char) => {
      if (exact() && g.exactTick === 0 && !exactKind(char)) return; // EXACT: what doesn't move by pattern moves once a frame, after the ticks (the arcade's per-frame routines)
      char.moved = false;
      if (T(char.stunned) && char.stunned > 0) {
        char.stunned -= 1;
        if (char.stunned === 0) char.stunned = false;
      } else {
        logic.move(char);
      }
    };

    // the house: a ghost whose time has come leaves (the no-dot timer, the shared counter after a death, its own dot limit)
    // (EXACT: the arcade checks the dot counts after Pac-Man's step each tick, "dots", and the no-dot timer at the frame's
    // end, after the house ghosts' move, "timer"; otherwise both at once)
    const releaseGhosts = (only) => {
      const leavingChars = [];
      for (const name of charKeys()) { const c = g.chars[name]; if (c.housing && c.leavingPreference != null) leavingChars.push(c); }
      leavingChars.sort((a, b) => a.leavingPreference - b.leavingPreference);
      for (const char of leavingChars) {
        if (only !== "dots" && g.starvation >= g.level.starvation) { forceLeave(char); g.starvation = 0; break; }
        if (only === "timer") continue;
        if (T(g.globalCounter)) {
          if (g.globalCounter === char.globalCounter) {
            forceLeave(char);
            if (g.globalCounter === 32) g.globalCounter = false;
          }
        } else if (char.dotCounter === 0) { forceLeave(char); break; }
      }
    };
    const forceLeave = (char) => {
      char.leaving = true; char.housing = false; char.speed = logic.getGhostSpeed(char);
      if (exact()) logic.turn(char); // EXACT: a released ghost heads for the door at once (not one more step of its bob)
      if (char === g.chars.clyde && g.suspendElroy) g.suspendElroy = false;
    };

    // ------------------------------------------------------------------ intermissions (ports of intermission1/2/3.lua)
    // (the Lua accumulates dt and runs exactly one tick per fixed step; here update() is already called once per step)
    const I1 = { START: 660, PAC_HIDDEN_START: 460, PAC_HIDDEN_END: 440, BOOZE_TRANSFORM: 180 };
    const moveI1 = (ch) => {
      ch.accum16 += ch.speed * SPEED_FACTOR * 16;
      while (ch.accum16 >= 16) { ch.accum16 -= 16; ch.x += DELTAS[ch.dir].x; }
    };
    const i1PacVisible = (t) => t > I1.PAC_HIDDEN_START || t <= I1.BOOZE_TRANSFORM;
    const intermissions = {
      intermission1: {
        pacVisible: i1PacVisible,
        update() {
          if (g.modeTimer <= I1.START && mode.isStarted("intermission1")) {
            if (g.modeTimer === I1.START) {
              g.sounds.intermission1.play();
              g.intermission1 = {
                blinky: { x: -140, y: 140, dir: 0, animator: () => animations.blinky[0], speed: 1, accum16: 0 },
                pac: { x: -10, y: 140, dir: 0, animator: () => animations.pac[0], speed: 0.8, accum16: 0 },
              };
            }
            const I = g.intermission1;
            if (g.modeTimer < I1.START) {
              const t = g.modeTimer;
              if (t > I1.PAC_HIDDEN_START) { moveI1(I.blinky); moveI1(I.pac); }
              else if (t > I1.PAC_HIDDEN_END || t <= I1.BOOZE_TRANSFORM) {
                moveI1(I.blinky);
                if (t <= I1.BOOZE_TRANSFORM) moveI1(I.pac);
              }
            }
            if (g.modeTimer === I1.BOOZE_TRANSFORM) {
              I.blinky.animator = () => animations.booze;
              I.blinky.dir = 2;
              I.blinky.speed = 0.2;
            }
            if (g.modeTimer <= I1.BOOZE_TRANSFORM) {
              graphics.emitBlinkyBubbles(I.blinky.x, I.blinky.y - 24, fxRand);
              graphics.updateParticles();
            }
            const animTimer = I1.START - g.modeTimer;
            graphics.updateAnimation(I.blinky, animTimer);
            if (i1PacVisible(g.modeTimer)) graphics.updateAnimation(I.pac, animTimer);
          }
        },
      },
      intermission2: {
        update() {
          const START = 660;
          if (g.modeTimer <= START && mode.isStarted("intermission2")) {
            if (g.modeTimer === START) {
              g.sounds.intermission1.play();
              const mk = (x, y, anim, idx, speed) => ({ x, y, dir: 0, speed: speed === undefined ? 0.8 : speed, accum: 0, anim, idx, animator() { return animations[this.anim][this.idx]; } });
              g.intermission2 = {
                blinky: { x: -70, y: 140, dir: 0, animator: () => animations.booze, speed: 0.8, accum: 0 },
                pac: mk(-10, 140, "pac", 0), pinky: mk(-100, 80, "pinky", 0), inky: mk(-90, 100, "inky", 0), clyde: mk(-80, 120, "clyde", 0),
                punky: mk(-80, 160, "punky", 0), gunky: mk(-90, 180, "gunky", 0), gronky: mk(-100, 200, "gronky", 0),
              };
            }
            const I = g.intermission2;
            const names = ["blinky", "pac", "pinky", "inky", "clyde", "punky", "gunky", "gronky"];
            if (g.modeTimer < START) {
              for (const n of names) {
                const ch = I[n];
                ch.accum += ch.speed;
                while (ch.accum >= 1) { ch.accum -= 1; ch.x += DELTAS[ch.dir].x; }
              }
            }
            if (g.modeTimer === 440) {
              I.blinky.speed = 0; I.blinky.dir = 2;
              I.pac.speed = 0; I.pac.dir = 2; I.pac.idx = 2;
            }
            if (g.modeTimer === 365) {
              for (const n of ["inky", "pinky", "clyde", "punky", "gunky", "gronky"]) { I[n].speed = 0; I[n].dir = 2; I[n].idx = 2; }
            }
            if (g.modeTimer === 120) { I.blinky.speed = 1.6; I.pac.speed = 0.6; }
            const animTimer = START - g.modeTimer;
            for (const n of names) graphics.updateAnimation(I[n], animTimer);
          }
        },
      },
      intermission3: {
        update() {
          if (g.modeTimer === 780 && mode.isStarted("intermission3")) { if (env.video) env.video.play(); }
          if (g.modeTimer === 1 && env.video) env.video.stop();
        },
      },
    };
    const game = {
      name: "game",
      start() {
        // web edition (replays, 2026-11-18): a real game is starting, before it draws its first random number (main.js
        // seeds the RNG here and starts recording)
        if (env.gameStarting && !g.attract && !g.autoplay) env.gameStarting();
        g.volumeBeforeMute = null;
        g.muted = false;
        keyPressTimes = {};
        // main.lua's reloadAudioSources(): stop every sound (and music unless this is the attract demo)
        for (const k of Object.keys(g.sounds)) if (g.sounds[k].isPlaying()) g.sounds[k].stop();
        if (!g.attract) {
          for (const k of Object.keys(g.music)) if (g.music[k].isPlaying()) g.music[k].stop();
          if (g.fever.isPlaying()) g.fever.stop();
        }
        applyVolume();
        g.levelNumber = g.config.startingLevel;
        g.scenery = {};
        if (g.attract) mode.setMode("ready"); else mode.setMode("pregame");
        g.lives = g.config.startingLives;
        // Random picks for the first board now, as the game starts (picked at its first READY instead, the header showed a
        // stand-in for a moment first: the author)
        g.randomAbility = null; g.randomFresh = false;
        if (g.config.ability === RANDOM) { pickRandomAbility(); g.randomFresh = true; }
        if (!g.attract) g.score = 0;
        g.paused = false;
        g.wakka = false;
        g.particles = [];
        g.state = { hideMaze: true };
        levels.startLevel(g.levelNumber);
        getCurrentMaze().init();
        characters.initialize();
        characters.reset();
      },
      update() {
        if (g.paused) return;
        gameFc += 1;
        if (g.vacuumFx > 0) g.vacuumFx -= 1; // the Vacuum's swirl (render.js)
        if (g.pushFx > 0) g.pushFx -= 1;     // the Push's rings
        mode.handle();
        if (g.mode === "vacuum") vacuumStep(); // (after the mode has started: its timer is the vacuum's)
        if (g.mode === "push") pushStep();
        if (T(g.fruitScoreTimer)) {
          g.fruitScoreTimer -= 1;
          if (g.fruitScoreTimer <= 0) g.fruitScoreTimer = false;
        }
        if (g.state.running) {
          g.starvation = g.starvation || 0;
          if (!exact()) g.starvation += 1; // (EXACT: counted after the ticks, below)
          const pac = g.chars.pac;
          if (g.config.radar) {
            let allFrightened = true;
            for (const name of charKeys()) {
              const c = g.chars[name];
              if (c.target && !c.frightened && !c.dead) { allFrightened = false; break; }
            }
            if (!T(g.radarTimer) || g.radarTimer <= 0) {
              if (!allFrightened) { g.sounds.ping.stop(); g.sounds.ping.play(); }
              g.radarTimer = g.config.radar + 60;
            } else {
              g.radarTimer -= 1;
            }
          }
          if (g.freezeLeft > 0) g.freezeLeft -= 1; // the Pause's freeze running down
          if (T(pac.phased)) {
            pac.phased -= 1;
            if (pac.phased === -60) { pac.phased = false; g.sounds.reload.play(); }
            if (pac.phased === 0 && (g.config.movement === 0 || g.config.movement === 1) && ability() === 2) pac.speed = logic.getPacSpeed();
          }
          if (g.fadeTimer > 0) g.fadeTimer -= 1;

          // EXACT: the arcade checks the house after Pac-Man's step, every tick (a dot that frees a ghost frees it that frame)
          if (!exact()) releaseGhosts();

          updateFrightenedState();
          handleModeSwitching();
          if (env.playStep) env.playStep(); // web edition: a step of play, about to read the controls (replays count these)
          handlePlayerInput();
          g.ghostEatenThisFrame = false;
          const frozen = g.freezeLeft > 0; // the Pause ability: the ghosts stand still
          // EXACT: two ticks a frame, as the arcade's game loop (each character a pixel at most a tick, by its pattern)
          for (let tick = 0, ticks = exact() ? 2 : 1; tick < ticks; tick++) {
            g.exactTick = tick;
            if (exact()) updateFrightenedState(true);
            if (!(exact() && exactKind(g.chars.pac))) logic.turn(g.chars.pac);
            for (const name of charKeys()) {
              const char = g.chars[name];
              if (frozen && char !== g.chars.pac) { char.moved = false; continue; }
              if (g.mode !== "caught" && g.mode !== "ateGhost") updateCharacterMovement(char);
              if (exact() && char === g.chars.pac) releaseGhosts("dots");
            }
          }
          // EXACT: the no-dot timer stands still while Pac-Man is paused (a dot, an energizer): it counts a frame he ends unpaused
          if (exact() && !(g.chars.pac.skipCounter > 0)) g.starvation = (g.starvation || 0) + 1;
          if (exact()) releaseGhosts("timer");
          if (T(g.fruitTimer)) {
            g.fruitTimer -= 1;
            if (g.fruitTimer === 0) g.fruitTimer = false;
          }
          if (g.dots.length === 0 && g.powers.length === 0) mode.setMode("levelComplete");
          const b = g.chars.blinky;
          if (b && !b.dead && !b.frightened && !b.hidden && g.state.showGhosts && g.dots.length <= g.level.elroy1 && !g.suspendElroy && (!g.config.radar || g.radarTimer > g.config.radar)) {
            graphics.emitBlinkyBubbles(b.x, b.y);
          }
          graphics.updateParticles();
          if (g.chars.pac.moved || (g.config.movement === 3 && g.chars.pac.speed > 0.3)) graphics.updateAnimation(g.chars.pac, gameFc);
        } else if (g.mode === "ateGhost") {
          // (the eyes head home during the pause, as in the arcade; not while the Pause ability has the ghosts frozen:
          // a second ghost eaten used to set the first one's eyes going again, the author, 2026-11-17)
          if (!(g.freezeLeft > 0)) for (const name of charKeys()) {
            const c = g.chars[name];
            if (c.dead && !c.hidden) updateCharacterMovement(c);
          }
        }

        if (g.chars && g.mode !== "playerUp" && g.mode !== "ready" && g.mode !== "levelComplete") {
          for (const p of g.powers) graphics.updateAnimation(p, gameFc);
          if (g.mode !== "ateGhost") {
            if (!(g.freezeLeft > 0)) for (const name of charKeys()) { const c = g.chars[name]; if (c.target) graphics.updateAnimation(c, gameFc); } // (frozen: not even their feet)
          }
        }

        if (intermissions[g.mode]) intermissions[g.mode].update();

        // camera
        if (g.state.running) {
          const pac = g.chars.pac;
          const cmz = getCurrentMaze();
          if (pac.moved && pac.dir === 2 && pac.x < g.startX + (248 / 2) * 1 && Math.abs(g.xDelta) <= pac.speed) g.xDelta -= 0.02;
          else if (pac.moved && pac.dir === 0 && pac.x > g.startX + 248 / 2 && Math.abs(g.xDelta) <= pac.speed) g.xDelta += 0.02;
          else { if (g.xDelta > 0) g.xDelta -= 0.01; else if (g.xDelta < 0) g.xDelta += 0.02; }

          if (pac.moved && pac.dir === 3 && pac.y < g.startY + (248 / 3) * 2) g.yDelta -= 0.01;
          else if (pac.moved && pac.dir === 1 && pac.y > g.startY + 248 / 3) g.yDelta += 0.01;
          else { if (g.yDelta > 0) g.yDelta -= 0.03; else if (g.yDelta < 0) g.yDelta += 0.02; }

          g.startX += g.xDelta;
          g.startY += g.yDelta;

          if (pac.dir === 2 && pac.x < g.startX + 248 / 4) g.xDelta -= 0.025;
          if (pac.dir === 0 && pac.x > g.startX + 224 - 248 / 4) g.xDelta += 0.025;
          if (pac.dir === 3 && pac.y < g.startY + 248 / 4) g.yDelta -= 0.025;
          if (pac.dir === 1 && pac.y > g.startY + 248 - 248 / 4) g.yDelta += 0.025;

          if (g.startX <= 0) { g.startX = 0; g.xDelta = 0; }
          if (g.startY <= 0) { g.startY = 0; g.yDelta = 0; }
          if (g.startX >= cmz.w * 8 - 224) { g.startX = cmz.w * 8 - 224; g.xDelta = 0; }
          if (g.startY >= cmz.h * 8 - 248) { g.startY = cmz.h * 8 - 248; g.yDelta = 0; }

          if (pac.x < g.startX) g.startX = Math.max(0, pac.x);
          if (pac.x > g.startX + 224) g.startX = Math.min(cmz.w * 8 - 224, pac.x - 224);
          if (pac.y < g.startY) g.startY = Math.max(0, pac.y);
          if (pac.y > g.startY + 248) g.startY = Math.min(cmz.h * 8 - 248, pac.y - 248);
        }

        if (g.mode === "gameover") {
          const cmz = getCurrentMaze();
          const targetStartX = (cmz.w * 8 / 2) - 224 / 2;
          if (Math.abs(g.startX - targetStartX) > 0.1) g.startX = g.startX + (targetStartX - g.startX) * 0.02;
          else g.startX = targetStartX;
          const targetStartY = (cmz.h * 8 / 2) - 248 / 2;
          if (Math.abs(g.startX - targetStartX) > 0.1) g.startY = g.startY + (targetStartY - g.startY) * 0.02;
          else g.startY = targetStartY;
        }
      },
      keypressed(key) {
        if (key === "m") {
          if (g.muted) {
            g.config.volume = g.volumeBeforeMute; g.config.musicVolume = g.musicVolumeBeforeMute;
          } else {
            g.volumeBeforeMute = g.config.volume; g.musicVolumeBeforeMute = g.config.musicVolume;
            g.config.volume = 0; g.config.musicVolume = 0;
          }
          applyVolume(); applyMusicVolume();
          g.muted = !g.muted;
          return;
        }
        if (abilityKeys() && (key === "space" || key === "lalt") && curAbility() === REWIND && env.rewind) env.rewind();
        if (abilityKeys() && (key === "space" || key === "lalt") && curAbility() === PAUSE) freezeGhosts();
        if (abilityKeys() && (key === "space" || key === "lalt") && curAbility() === VACUUM) vacuum();
        if (abilityKeys() && (key === "space" || key === "lalt") && curAbility() === PUSH) push();
        if (abilityKeys() && (key === "space" || key === "lalt") && !T(g.chars.pac.phased) && T(ability())) phasePac();
        if (key === "tab" || key === "p") togglePause();
      },
      gamepadpressed(button) {
        if (abilityKeys() && button === "a" && curAbility() === REWIND && env.rewind) env.rewind();
        if (abilityKeys() && button === "a" && curAbility() === PAUSE) freezeGhosts();
        if (abilityKeys() && button === "a" && curAbility() === VACUUM) vacuum();
        if (abilityKeys() && button === "a" && curAbility() === PUSH) push();
        if (abilityKeys() && button === "a" && !T(g.chars.pac.phased) && T(ability())) phasePac();
        if (button === "x") togglePause();
      },
    };

    // web edition (the author, 2026-11-14): the ability button only works in play: not while the game is paused, and not
    // in autoplay or the attract demo (the autoplayer uses the abilities itself)
    function abilityKeys() { return g.state.running && !g.paused && !g.autoplay && !g.attract; }
    function togglePause() {
      if (!g.paused) {
        g.paused = true;
        g.playingSounds = [];
        for (const k of Object.keys(g.sounds)) if (g.sounds[k].isPlaying()) { g.playingSounds.push(g.sounds[k]); g.sounds[k].pause(); }
      } else {
        g.paused = false;
        for (const s of g.playingSounds) s.play();
        g.playingSounds = [];
      }
    }

    // ------------------------------------------------------------------ options + credits (ports of options.lua / credits.lua)
    const opt = (key, values, texts, after) => ({
      key, selectedOption: 1,
      options: values.map((v, i) => ({ text: String(texts ? texts[i] : v), action() { g.config[key] = v; if (after) after(v); } })),
    });
    const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };
    const ON_OFF = (key, after) => opt(key, [true, false], ["On", "Off"], after);
    const cap = (n) => n.charAt(0).toUpperCase() + n.slice(1);
    const bgNames = BACKGROUND_OPTIONS.concat(["random"]);
    const PACKS = ["pac", "booze", "mspac", "junior", "ultra", "arrange", "mega", "normal", "large", "random"];
    // web edition: the pack sizes follow the packs (the maze editor adds booze mazes); "random" is shown as "all"
    const PACK_TEXTS = PACKS.map((p) => p === "random" ? "all"
      : p + "-" + (MAZE_PACKS[p].list.length + (p === "booze" || p === "normal" ? extraBooze(DATA).length : 0)));
    const saveConfig = () => { if (env.saveConfig) env.saveConfig(g.config); };
    const AV_KEYS = ["background", "mazeColor", "crtEffect", "volume", "musicVolume", "proMode"]; // the Audio/Video section
    // web edition: 100 = style "27": DARKSTAR, the author's rave (2026-11-17; src/rave.js, render.js; the living rainbow
    // maze, music and lights); 27 itself is the white flash at a board's end. Random never picks it
    const MAZE_COLORS = [99].concat(range(1, 26), [100, 0]);
    const optMenu = Object.assign([
      Object.assign(opt("mazepack", PACKS, PACK_TEXTS, (v) => { g.currentMaze = setCurrentMaze(v); }), { y: 4 }),
      Object.assign(opt("startingLevel", range(1, 21)), { y: 5 }),
      Object.assign(opt("difficulty", [0, 1, 2], ["Normal", "Hard", "Plus"]), { y: 6 }),
      Object.assign(opt("plusMode", [false, true], ["Off", "On"]), { y: 7 }),
      Object.assign(opt("afterDark", [false, 1, 2, 3, 4, 5, 6], ["Off", "Maze", "Dots", "Maze/Dots", "Haunted", "Blackout", "Lantern"]) /* 6: Lantern, web edition (render.js) */, { y: 8 }),
      Object.assign(opt("radar", [false, 30, 60, 90, 120], ["Off", "Tame", "Tricky", "Tough", "Terror"]), { y: 9 }),
      Object.assign(opt("startingLives", [1, 3, 5]), { y: 12 }),
      Object.assign(opt("freeGuy", [1, 2, 3, 4, 5], ["10000", "20000", "every 10k", "every 5k", "none"]), { y: 13 }),
      Object.assign(opt("ability", [false, 1, 2, 3, 4, 5, 6, 7, 8], ["Off", "Phase", "Boost", "Stun", "Rewind", "Pause", "Suck", "Blow", "Random"]), { y: 14 }),
      Object.assign(opt("movement", [0, 1, 2, 3], ["Normal", "Faster", "Fastest", "Jetpack"]), { y: 15 }),
      Object.assign(opt("ghostCount", range(0, 7)), { y: 18 }),
      Object.assign(ON_OFF("pinkyBug"), { y: 19 }),
      Object.assign(opt("scatterOption", [false, 1, 2, 3], ["Normal", "Random", "mspac", "Never"]), { y: 20 }),
      Object.assign(ON_OFF("freeGhost"), { y: 21 }),
      Object.assign(opt("background", bgNames, bgNames.map(cap), (v) => { g.currentBackground = v === "random" ? BACKGROUND_OPTIONS[styleRand(2, BACKGROUND_OPTIONS.length) - 1] : v; }), { y: 24 }),
      Object.assign(opt("mazeColor", MAZE_COLORS, ["Default"].concat(range(1, 26), [27, "Random"])), { y: 25 }),
      Object.assign(ON_OFF("crtEffect"), { y: 26 }),
      Object.assign(opt("volume", range(0, 10), null, () => applyVolume()), { y: 27, x: 18 }),
      { text: "Reset Classic Pac-Man", sound: "phase", x: 6, y: 29, action() {
        // web edition (env.restoreKeepsAV): Audio/Video settings stay as they are; only Game/Player/Ghost options reset
        const keep = env.restoreKeepsAV ? AV_KEYS.map((k) => [k, g.config[k]]) : [];
        resetConfigs(); for (const [k, v] of keep) g.config[k] = v;
        resetSelectedOptions(); saveConfig();
      } },
      { text: "Reset High Score", sound: "phase", x: 6, y: 30, action() { g.highScore = false; if (env.resetHighScore) env.resetHighScore(); } },
      { text: "Back", x: 12, y: 32, action() { setScene("attract", true); } },
    ], { selectedItem: 1, autosave: saveConfig });
    // web edition: the online boards are reset from a hidden page link instead (see main.js), so the item goes;
    // Share Config takes its row
    if (env.scenes) optMenu.splice(optMenu.findIndex((it) => it.text === "Reset High Score"), 1);
    // (Add Favorite took Share Config's row, 2026-11-15: the author, sharing is a favorite's job now)
    if (env.addFavorite) optMenu.splice(optMenu.length - 1, 0, { text: "Add Favorite", x: 6, y: 30, action() { env.addFavorite(); } });
    else if (env.shareConfig) optMenu.splice(optMenu.length - 1, 0, shareItem(6, 30));
    // web edition: the CRT effect is the C key (env.crtKey), not an option; sfx volume moves up into its row
    if (env.crtKey) { optMenu.splice(optMenu.findIndex((it) => it.key === "crtEffect"), 1); optMenu.find((it) => it.key === "volume").y = 26; }
    // web edition: no volume setting (env.fixedVolume; the browser / system volume does the job), the game plays at that level
    if (env.fixedVolume != null) {
      optMenu.splice(optMenu.findIndex((it) => it.key === "volume"), 1);
      optMenu.find((it) => it.text === "Reset Classic Pac-Man").y = 28; // the freed row: a blank line after Classic Pac-Man (once Restore Defaults)
    }
    // web edition: Pro Mode in the Style section (the freed row under Maze Style)
    if (env.proMode) optMenu.splice(optMenu.findIndex((it) => it.text === "Reset Classic Pac-Man"), 0, Object.assign(opt("proMode", [false, true], ["Off", "On"]), { y: 26 }));
    // web edition: Create Arena (an arena with the current settings) under Share Config
    if (env.createArena) optMenu.splice(optMenu.length - 1, 0, { text: "Create Arena", x: 6, y: 31, action() { env.createArena(); } });
    if (env.creditsInOptions) {
      optMenu.splice(optMenu.length - 1, 0, { text: "Credits", x: 6, y: env.createArena ? 32 : 31, action() { setScene("credits", "options"); } });
      optMenu[optMenu.length - 1].y = env.createArena ? 34 : 33; // Back
    } else if (env.createArena) optMenu[optMenu.length - 1].y = 33; // Back, a blank row under Create Arena
    // web edition: plain menu items (not option values) centred on the 28-column screen
    if (env.centerMenus) for (const m of [menus.main, optMenu]) for (const it of m) if (it.text && !it.options) it.x = 14 - it.text.length / 2;
    // value lists kept alongside for selection lookup
    const OPT_VALUES = {
      mazepack: PACKS, startingLevel: range(1, 21), difficulty: [0, 1, 2], plusMode: [false, true],
      afterDark: [false, 1, 2, 3, 4, 5, 6], radar: [false, 30, 60, 90, 120], startingLives: [1, 3, 5], freeGuy: [1, 2, 3, 4, 5],
      ability: [false, 1, 2, 3, 4, 5, 6, 7, 8], movement: [0, 1, 2, 3], ghostCount: range(0, 7), pinkyBug: [true, false],
      scatterOption: [false, 1, 2, 3], freeGhost: [true, false], background: bgNames, mazeColor: MAZE_COLORS,
      crtEffect: [true, false], volume: range(0, 10), proMode: [false, true],
    };
    function selectFromConfig() {
      for (const it of optMenu) {
        if (!it.options) continue;
        const vals = OPT_VALUES[it.key];
        // Lua treats any falsy/nil flag as the "off" entry; keep that for booleans
        let v = g.config[it.key];
        let i = vals.indexOf(v);
        if (i < 0 && typeof vals[0] === "boolean") i = vals.indexOf(!!v);
        it.selectedOption = (i < 0 ? 0 : i) + 1;
      }
    }
    function resetSelectedOptions() {
      selectFromConfig();
      for (const it of optMenu) if (it.options) it.options[it.selectedOption - 1].action();
    }
    const options = env.options || {
      name: "options",
      start(keep) { selectFromConfig(); if (!keep) optMenu.selectedItem = 1; }, // keep: back from credits (web edition)
      update() {},
      keypressed(key) { menus.keypressed(optMenu, key); },
      gamepadpressed(button) { menus.gamepadpressed(optMenu, button); },
      menu: optMenu,
    };

    // web edition: credits can be opened from Options (setScene("credits", "options")) and then goes back there
    let creditsReturn = "attract";
    const leaveCredits = () => { if (creditsReturn === "options") setScene("options", true); else setScene("attract", true); };
    const creditsMenu = Object.assign([{ text: "Back", action() { leaveCredits(); } }], { selectedItem: 1 });
    let creditsFc = 0;
    const creditsBooze = { x: 112, y: 35, dir: 0, speed: 0, animator: () => animations.booze };
    const credits = env.credits || {
      name: "credits",
      start(from) { creditsMenu.selectedItem = 1; creditsFc = 0; if (from !== true) creditsReturn = from === "options" ? "options" : "attract"; }, // true: coming back (keep where to return)
      update() { creditsFc += 1; graphics.updateAnimation(creditsBooze, creditsFc); },
      keypressed(key) { menus.keypressed(creditsMenu, key); },
      gamepadpressed(button) { menus.gamepadpressed(creditsMenu, button); },
      menu: creditsMenu, booze: creditsBooze,
    };

    function setScene(s, opt) {
      if (s === "game") g.scene = game;
      else if (s === "attract") g.scene = attract;
      else if (s === "credits") g.scene = credits;
      else if (s === "options") g.scene = options;
      else if (env.scenes && env.scenes[s]) g.scene = env.scenes[s]; // web edition: leaderboard, name entry
      g.scene.start(opt);
    }

    // love.keypressed from main.lua
    // web edition (the author, 2026-11-15): in the attract demo, Enter / Space (a tap on touch) / gamepad A or Start starts
    // a real game, as Play 1P does (it used to take Esc to the title, then Play 1P); Esc still goes to the title
    function playFromDemo() {
      setScene("attract", true);
      const it = attractMenu.find((i) => i.text === "Play 1P");
      g.sounds.coindrop.stop(); g.sounds.coindrop.play();
      if (it) it.action();
    }
    function keypressed(key) {
      if (g.scene.captureInput) { g.scene.keypressed(key); return; } // web-edition scenes handle Esc/Backspace themselves
      if (g.scene === game && g.attract && (key === "return" || key === "space")) { playFromDemo(); return; }
      if (key === "escape" || key === "backspace") {
        if (g.scene === attract) { if (env.quit) env.quit(); }
        else if (g.scene === game && !g.attract) { // web edition: an arena game goes back to its arena, silencing the game like the title does
          const to = env.quitGameTo && env.quitGameTo();
          if (to) { for (const k of Object.keys(g.sounds)) g.sounds[k].stop(); setScene(to); } else setScene("attract");
        }
        else if (g.scene === credits) leaveCredits();
        else if (g.scene.escape) g.scene.escape(); // web edition: a page that says where Esc goes (a pick's leaderboard: the picks)
        else setScene("attract", true);
        return;
      }
      if (g.scene.keypressed) g.scene.keypressed(key);
    }

    // love.gamepadpressed from main.lua
    function gamepadpressed(button) {
      if (g.scene.captureInput) { g.scene.gamepadpressed(button); return; }
      if (g.scene === game && g.attract && (button === "a" || button === "start")) { playFromDemo(); return; } // the demo: a game
      if (button === "start") { setScene("attract"); return; }
      if (button === "b") {
        if (g.scene === credits && creditsReturn === "options") setScene("options", true);
        else if (g.scene === options || g.scene === credits) setScene("attract");
        return;
      }
      if (g.scene.gamepadpressed) g.scene.gamepadpressed(button);
    }

    function init() {
      resetConfigs();
      const saved = env.loadConfig ? env.loadConfig() : null;
      if (saved && typeof saved === "object") for (const k of Object.keys(saved)) if (g.defaultConfig[k] !== undefined && k !== "fullscreen") g.config[k] = saved[k];
      if (env.fixedVolume != null) g.config.volume = g.defaultConfig.volume = env.fixedVolume; // web edition: a saved volume no longer counts
      if (g.config.background === "random") g.currentBackground = BACKGROUND_OPTIONS[styleRand(2, BACKGROUND_OPTIONS.length) - 1];
      setCurrentMaze(g.config.mazepack);
      applyVolume(); applyMusicVolume();
      setScene("attract");
    }

    return {
      g, init, setScene, keypressed, update: () => g.scene.update(FIXED_DT),
      FIXED_DT, mode, maze, levels, graphics, getCurrentMaze, applyVolume, applyMusicVolume, resetConfigs, rand, curAbility, ABILITY_NAMES, RANDOM, REWIND, PAUSE, VACUUM, VACUUM_FX, PUSH, PUSH_FX, PUSH_MAX,
      // web edition (rewind.js): put the looping sounds back in line with the game state, the way the game itself picks
      // them: eyes heading home -> "dead", any ghost frightened -> "scared", otherwise the siren for the dots left
      resyncLoops() {
        stopSiren(); g.sounds.dead.stop(); g.sounds.scared.stop(); g.sounds.thrust.stop();
        let anyDead = false, anyFrightened = false;
        for (const name of charKeys()) { const c = g.chars[name]; if (c.dead) anyDead = true; if (c.frightened) anyFrightened = true; }
        if (anyDead) g.sounds.dead.play(); else if (anyFrightened) g.sounds.scared.play(); else playSiren();
      },
      formatScore, projectGhost, constants: { TILE, CENTER, DELTAS, JOY_DIRS, MAX_THRUST, STUN_DISTANCE }, charKeys, animations, fruits,
      gamepadpressed, gameFc: () => gameFc, attractFc: () => attractFc, attractMenu, REPLAY_VERSION,
      intermissions, MAX_COLORS: DATA.maxColors, INDEXES, optMenu, creditsMenu, creditsBooze,
    };
  }

  return { create, T, mod, FIXED_DT, JOY_DIRS };
});
