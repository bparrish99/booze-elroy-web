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
  const BACKGROUND_OPTIONS = ["none", "stars", "beach", "arcade", "forest", "city", "canyon", "clouds", "planets", "abstract",
    "wave1", "wave2", "lines", "retro", "tan", "aqua", "green", "blue", "pac1", "pac2", "pac3"];
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
    const rand = (m, n) => {
      const r = rng();
      if (m === undefined) return r;
      if (n === undefined) { n = m; m = 1; }
      return m + Math.floor(r * (n - m + 1));
    };
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
        mazepack: "pac", plusMode: false, radar: false,
      },
      config: {},
      particles: [],
      sounds: {},
      music: {},
      fever: null,
      mazes: MAZE_PACKS,
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
    function ability() { return g.config.ability === REWIND ? false : g.config.ability; }

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
        return lvl;
      },
      startLevel() {
        const musicList = Object.keys(g.music);
        const idx = rand(1, musicList.length);
        g.levelMusic = g.music[musicList[idx - 1]];
        g.level = levels.getLevel(g.levelNumber);
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
        else if (g.config.mazeColor === 0) g.currentMazeColor = rand(1, maze.maxColors - 1);
        else g.currentMazeColor = g.config.mazeColor;
        g.currentBackground = g.config.background === "random" ? BACKGROUND_OPTIONS[rand(2, BACKGROUND_OPTIONS.length) - 1] : g.config.background;
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
      emitBlinkyBubbles(x, y) {
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
            if (!c.housing && !c.leaving && !c.entering) { c.dir = (c.dir + 2) % 4; c.target(); }
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
        handlers.activateFrightenedMode();
        if (g.config.afterDark === 4) g.fadeTimer = g.fadeLength();
      },
    };

    // fixed visiting order for g.chars (see header)
    const charKeys = () => g.charOrder;

    // ------------------------------------------------------------------ characters
    const getRandomFrightenedDir = () => {
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
    const makeTarget = (chaseFn) => function () {
      const self = this;
      if (!T(self.iDir)) { self.iDir = self.dir; return; }
      const cm = getCurrentMaze();
      const [xTile, , yTile] = cm.getLoc(self);
      const candidates = getCandidates(self);
      if (candidates.length === 1) { self.iDir = candidates[0]; return; }
      if (self.frightened) { handleFrightenedDirection(self, candidates); return; }
      const hc = cm.houseCenter;
      let targetX, targetY;
      if (self.dead) { targetX = hc.x - 1; targetY = hc.y - 3; }
      else [targetX, targetY] = chaseFn(self, cm, xTile, yTile);
      findBestDirection(self, xTile, yTile, targetX, targetY, candidates);
      if (self.name === "blinky") { self.targetX = targetX; self.targetY = targetY; }
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
            const [px, , py] = cm2.getLoc(g.chars.pac); return [px, py];
          }
          return [self.scatterX, self.scatterY];
        }), "blinky", true);
        if (N > 1) mk("pinky", {
          x: 8 * hc.x, y: 8 * hc.y + 4, dir: 1, housing: true, scatterX: sp.pinky.x, scatterY: sp.pinky.y, houseX: hc.x, houseY: hc.y,
          leavingPreference: 0, dotCounter: level.pinkyCounter, globalCounter: 7,
        }, makeTarget((self, cm2) => {
          if (g.level.chase) {
            const [px, , py] = cm2.getLoc(g.chars.pac);
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
            const [px, , py] = cm2.getLoc(g.chars.pac);
            const [bx, , by] = cm2.getLoc(g.chars.blinky);
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
            const [px, , py] = cm2.getLoc(g.chars.pac);
            if ((xTile - px) ** 2 + (yTile - py) ** 2 >= 64) return [px, py];
          }
          return [self.scatterX, self.scatterY];
        }), "clyde", false);
        if (N > 4) { const s = cm.punkyStart; mk("punky", {
          x: 8 * s.x, y: 8 * s.y + 4, dir: 0, houseX: hc.x, houseY: hc.y, leavesRight: true,
        }, makeTarget((self, cm2) => {
          const [px, , py] = cm2.getLoc(g.chars.pac);
          const d = DELTAS[g.chars.pac.dir];
          const tx = px + d.y * (rand(0, 8) - 4);
          const ty = py + d.x * (rand(0, 8) - 4);
          return [tx, ty];
        }), "punky", false); }
        if (N > 5) { const s = cm.gunkyStart; mk("gunky", {
          x: 8 * s.x, y: 8 * s.y + 4, dir: 0, houseX: hc.x, houseY: hc.y, leavesRight: false,
        }, makeTarget((self, cm2) => {
          const [px, , py] = cm2.getLoc(g.chars.pac);
          const px2 = cm2.w / 2 - px, py2 = cm2.h / 2 - py;
          return [px + px2 * 2, py + py2 * 2];
        }), "gunky", false); }
        if (N > 6) { const s = cm.gronkyStart; const dir0 = rand(0, 1) * 2; const lr = rand(0, 1) === 1; mk("gronky", {
          x: 8 * s.x, y: 8 * s.y + 4, dir: dir0, houseX: hc.x, houseY: hc.y, leavesRight: lr,
        }, makeTarget((self, cm2, xTile, yTile) => {
          const tx = xTile + DELTAS[rand(0, 3)].x;
          const ty = yTile + DELTAS[rand(0, 3)].y;
          return [tx, ty];
        }), "gronky", false); }
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
    const THRUSTER_SPEED = 0.008, MAX_THRUST = 1.6, STUN_DISTANCE = 6;
    const phaseActive = () => (ability() && ability() === 1 && T(g.chars.pac.phased) && g.chars.pac.phased >= 0);

    const checkCollisions = (collectibles, xTile, yTile) => {
      if (phaseActive()) return;
      for (let i = collectibles.length - 1; i >= 0; i--) {
        const item = collectibles[i];
        if (xTile === item.x && yTile === item.y) {
          score(item.score);
          g.chars.pac.skipCounter = item.skipCounter;
          collectibles.splice(i, 1);
          if (item.action) item.action(xTile, yTile);
        }
      }
    };

    // Port-only fix: after the ateGhost pause, eat a second frightened ghost that shared Pac-Man's tile
    // (the collision loop stops after the first ghost, and collisions are off during ateGhost).
    logic.eatOverlappingFrightened = () => {
      const cm = getCurrentMaze();
      const [pX, , pY] = cm.getLoc(g.chars.pac);
      for (const name of charKeys()) {
        const ch = g.chars[name];
        if (ch.target && T(ch.frightened) && !T(ch.dead)) {
          const [gX, , gY] = cm.getLoc(ch);
          if (handleGhostCollision(ch, pX, pY, gX, gY)) break;
        }
      }
    };
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
          c.target();
          updateGhostSpeed(c, newX, newY);
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

    logic.move = (c) => {
      const isPac = c === g.chars.pac;
      if (c.skipCounter && c.skipCounter > 0) { c.skipCounter -= 1; return; }
      c.accum16 = c.accum16 || 0;
      const speed16 = c.speed * SPEED_FACTOR * 16;
      c.accum16 += speed16;
      while (c.accum16 >= 16) {
        c.moved = false;
        const cm = getCurrentMaze();
        const [xTile, xOff, yTile, yOff] = cm.getLoc(c);
        const oldX = xTile, oldY = yTile;
        c.accum16 -= 16;
        if (c.housing || c.leaving || c.entering || !cm.isBlocked(c, c.dir) ||
          (c.dir === 2 && xOff > CENTER) || (c.dir === 3 && yOff > CENTER) ||
          (c.dir === 0 && xOff < CENTER) || (c.dir === 1 && yOff < CENTER)) {
          logic.advance(c, xOff, yOff);
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
              if (!T(c.leaveRight)) c.target();
            }
            if (g.mode !== "ateGhost") {
              const [pX, , pY] = cm.getLoc(g.chars.pac);
              const [gX, , gY] = cm.getLoc(c);
              if (handleGhostCollision(c, pX, pY, gX, gY)) break;
            }
          } else {
            const [pX, , pY] = cm.getLoc(g.chars.pac);
            checkCollisions(g.powers, pX, pY);
            checkCollisions(g.dots, pX, pY);
            for (const name of charKeys()) {
              const ch = g.chars[name];
              if (ch.target) {
                const [gX, , gY] = cm.getLoc(ch);
                if (handleGhostCollision(ch, pX, pY, gX, gY)) break;
              }
            }
          }

          logic.turn(c);

          const fl = getCurrentMaze().fruitLoc;
          if (T(g.fruitTimer) && g.chars.pac.x === fl.x && g.chars.pac.y === fl.y &&
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
        } else if (isPac && g.config.movement === 3) {
          if (g.chars.pac.speed > MAX_THRUST) {
            mode.setMode("destroyed");
            if (g.chars.clyde) g.suspendElroy = true;
            g.globalCounter = 0;
          } else {
            if (g.chars.pac.speed > 0.8) g.sounds.bonk.play();
            g.chars.pac.speed = 0;
          }
        }
      }
    };

    logic.turn = (c) => {
      const isPac = c === g.chars.pac;
      const cm = getCurrentMaze();
      const [xTile, xOff, yTile, yOff] = cm.getLoc(c);
      if (c.housing) {
        if (yOff === 0) { c.dir = 1; c.facing = 1; }
        if (yOff === 7) { c.dir = 3; c.facing = 3; }
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
              g.chars.pac.speed = g.chars.pac.speed - THRUSTER_SPEED;
              if (g.chars.pac.speed < 0) { g.chars.pac.speed = Math.abs(g.chars.pac.speed); c.dir = c.iDir; }
            }
          } else {
            c.dir = c.iDir;
          }
        }
        if (isPac && g.config.movement === 3 && c.iDir === c.dir && g.playerInput) {
          g.chars.pac.speed = g.chars.pac.speed + THRUSTER_SPEED; // no max!
        }
        if (mod(c.dir - c.iDir, 2) === 1 && yTile > 0 && yTile < cm.h && xTile > 0 && xTile < cm.w) {
          const turnWindow = c.turnWindow || 0;
          if (c.dir % 2 === 0) {
            if (!cm.isBlocked(c, c.iDir) && Math.abs(xOff - CENTER) <= turnWindow) { c.dir = c.iDir; c.facing = c.iDir; }
          } else if (!cm.isBlocked(c, c.iDir) && Math.abs(yOff - CENTER) <= turnWindow) { c.dir = c.iDir; c.facing = c.iDir; }
        }
      }
      if (isPac && g.config.movement === 3 && T(c.iDir)) c.facing = c.iDir;
    };

    logic.getGhostSpeed = (c) => {
      if (c.housing) return 0.35;
      if (c.leaving) return 0.35;
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
            if (g.newLevel) g.newLevel = false; else g.lives = g.lives - 1;
            if (g.lives < 0) mode.setMode("gameover");
            else {
              g.fruitTimer = false; g.fruitScoreTimer = false;
              g.state = { showPac: true, showGhosts: true, showReady: true };
              g.starvation = 0;
              characters.reset();
              levels.resetLevel();
            }
          },
          endFunc() { playSiren(); },
        },
        normal: {
          startFunc() { if (!g.attract) g.levelMusic.play(); },
          state: { running: true, showPac: true, showGhosts: true },
        },
        ateGhost: {
          state: { running: false, showPac: false, showGhosts: true }, frames: 60, nextMode: "normal",
          endFunc() {
            for (const name of charKeys()) g.chars[name].hidden = false;
            g.sounds.scared.stop();
            if (!g.sounds.dead.isPlaying()) g.sounds.dead.play();
            logic.eatOverlappingFrightened();
          },
        },
        caught: {
          state: { running: false, showPac: true, showGhosts: true }, frames: 60, nextMode: "dying",
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
          startFunc() { g.fadeTimer = g.fadeLength(); g.particles = []; stopSiren(); g.sounds.dead.stop(); g.sounds.scared.stop(); g.sounds.thrust.stop(); },
          nextMode: "levelAnimation",
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
    // web edition: Credits lives on the Options page (env.creditsInOptions); its row stays blank
    if (env.creditsInOptions) menus.main.splice(menus.main.findIndex((it) => it.text === "Credits"), 1);
    // web edition: Arenas (24-hour leaderboards) right under Play
    if (env.scenes && env.scenes.arenas) {
      menus.main.splice(1, 0, { text: "Arena", x: 10, y: 27, action() { setScene("arenas"); } });
      for (const it of menus.main) if (it.text === "Options") it.y = 29; else if (it.text === "Leaderboards") it.y = 31; // a blank row between items
    }
    const menuConfirm = (menu) => {
      const item = menu[menu.selectedItem - 1];
      if (item.text && item.text === "Play") { g.sounds.coindrop.stop(); g.sounds.coindrop.play(); }
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
            const [cx, , cy] = cm.getLoc(ch);
            const [px, , py] = cm.getLoc(g.chars.pac);
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
        const [xTile, xOff, yTile, yOff] = cm.getLoc(pac);
        const d = DELTAS[pac.dir];
        const oneAhead = { xTile: xTile + d.x, yTile: yTile + d.y };
        if (isScaryMonster(xTile, yTile, pac.dir, 1) || isScaryMonster(xTile, yTile, pac.dir, 2) ||
          isScaryMonster(oneAhead.xTile, oneAhead.yTile, (pac.dir + 1) % 4, 1) ||
          isScaryMonster(oneAhead.xTile, oneAhead.yTile, mod(pac.dir - 1, 4), 1)) {
          if (T(ability()) && !T(pac.phased)) phasePac();
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
    const updateFrightenedState = () => {
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
            if (c.target && c.frightened) { c.speed = logic.getGhostSpeed(c); c.frightened = false; }
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
            if (!g.config.scatterOption || g.config.scatterOption !== 2 || si === 0) g.level.chase = !g.level.chase;
            for (const name of charKeys()) {
              const c = g.chars[name];
              if (c.target) {
                if (c.housing) c.leaveRight = 2;
                if (!c.housing && !c.leaving && !c.entering && !c.dead) { c.dir = (c.dir + 2) % 4; c.facing = c.dir; c.target(); }
              }
            }
            break;
          }
        }
      }
    };

    const updateCharacterMovement = (char) => {
      char.moved = false;
      if (T(char.stunned) && char.stunned > 0) {
        char.stunned -= 1;
        if (char.stunned === 0) char.stunned = false;
      } else {
        logic.move(char);
      }
    };

    const forceLeave = (char) => {
      char.leaving = true; char.housing = false; char.speed = logic.getGhostSpeed(char);
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
              graphics.emitBlinkyBubbles(I.blinky.x, I.blinky.y - 24);
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
        mode.handle();
        if (T(g.fruitScoreTimer)) {
          g.fruitScoreTimer -= 1;
          if (g.fruitScoreTimer <= 0) g.fruitScoreTimer = false;
        }
        if (g.state.running) {
          g.starvation = g.starvation || 0;
          g.starvation += 1;
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
          if (T(pac.phased)) {
            pac.phased -= 1;
            if (pac.phased === -60) { pac.phased = false; g.sounds.reload.play(); }
            if (pac.phased === 0 && (g.config.movement === 0 || g.config.movement === 1) && ability() === 2) pac.speed = logic.getPacSpeed();
          }
          if (g.fadeTimer > 0) g.fadeTimer -= 1;

          const leavingChars = [];
          for (const name of charKeys()) { const c = g.chars[name]; if (c.housing && c.leavingPreference != null) leavingChars.push(c); }
          leavingChars.sort((a, b) => a.leavingPreference - b.leavingPreference);
          for (const char of leavingChars) {
            if (g.starvation >= g.level.starvation) { forceLeave(char); g.starvation = 0; break; }
            if (T(g.globalCounter)) {
              if (g.globalCounter === char.globalCounter) {
                forceLeave(char);
                if (g.globalCounter === 32) g.globalCounter = false;
              }
            } else if (char.dotCounter === 0) { forceLeave(char); break; }
          }

          updateFrightenedState();
          handleModeSwitching();
          handlePlayerInput();
          g.ghostEatenThisFrame = false;
          logic.turn(g.chars.pac);
          for (const name of charKeys()) {
            const char = g.chars[name];
            if (g.mode !== "caught" && g.mode !== "ateGhost") updateCharacterMovement(char);
          }
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
          for (const name of charKeys()) {
            const c = g.chars[name];
            if (c.dead && !c.hidden) updateCharacterMovement(c);
          }
        }

        if (g.chars && g.mode !== "playerUp" && g.mode !== "ready" && g.mode !== "levelComplete") {
          for (const p of g.powers) graphics.updateAnimation(p, gameFc);
          if (g.mode !== "ateGhost") {
            for (const name of charKeys()) { const c = g.chars[name]; if (c.target) graphics.updateAnimation(c, gameFc); }
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
        if (g.state.running && (key === "space" || key === "lalt") && g.config.ability === REWIND && env.rewind) env.rewind();
        if (g.state.running && (key === "space" || key === "lalt") && !T(g.chars.pac.phased) && T(ability())) phasePac();
        if (key === "tab" || key === "p") togglePause();
      },
      gamepadpressed(button) {
        if (g.state.running && button === "a" && g.config.ability === REWIND && env.rewind) env.rewind();
        if (g.state.running && button === "a" && !T(g.chars.pac.phased) && T(ability())) phasePac();
        if (button === "x") togglePause();
      },
    };

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
    const PACK_TEXTS = ["pac-1", "booze-4", "mspac-4", "junior-7", "ultra-5", "arrange-3", "mega-1", "normal-17", "large-8", "random"];
    const saveConfig = () => { if (env.saveConfig) env.saveConfig(g.config); };
    const AV_KEYS = ["background", "mazeColor", "crtEffect", "volume", "musicVolume"]; // the Audio/Video section
    const MAZE_COLORS = [99].concat(range(1, 26), [0]);
    const optMenu = Object.assign([
      Object.assign(opt("mazepack", PACKS, PACK_TEXTS, (v) => { g.currentMaze = setCurrentMaze(v); }), { y: 4 }),
      Object.assign(opt("startingLevel", range(1, 21)), { y: 5 }),
      Object.assign(opt("difficulty", [0, 1, 2], ["Normal", "Hard", "Plus"]), { y: 6 }),
      Object.assign(opt("plusMode", [false, true], ["Off", "On"]), { y: 7 }),
      Object.assign(opt("afterDark", [false, 1, 2, 3, 4, 5], ["Off", "Maze", "Dots", "Maze/Dots", "Haunted", "Blackout"]), { y: 8 }),
      Object.assign(opt("radar", [false, 30, 60, 90, 120], ["Off", "Tame", "Tricky", "Tough", "Terror"]), { y: 9 }),
      Object.assign(opt("startingLives", [1, 3, 5]), { y: 12 }),
      Object.assign(opt("freeGuy", [1, 2, 3, 4, 5], ["10000", "20000", "every 10k", "every 5k", "none"]), { y: 13 }),
      Object.assign(opt("ability", [false, 1, 2, 3, 4], ["Off", "Phase", "Boost", "Stun", "Rewind"]), { y: 14 }),
      Object.assign(opt("movement", [0, 1, 2, 3], ["Normal", "Faster", "Fastest", "Jetpack"]), { y: 15 }),
      Object.assign(opt("ghostCount", range(0, 7)), { y: 18 }),
      Object.assign(ON_OFF("pinkyBug"), { y: 19 }),
      Object.assign(opt("scatterOption", [false, 1, 2, 3], ["Normal", "Random", "mspac", "None"]), { y: 20 }),
      Object.assign(ON_OFF("freeGhost"), { y: 21 }),
      Object.assign(opt("background", bgNames, bgNames.map(cap), (v) => { g.currentBackground = v === "random" ? BACKGROUND_OPTIONS[rand(2, BACKGROUND_OPTIONS.length) - 1] : v; }), { y: 24 }),
      Object.assign(opt("mazeColor", MAZE_COLORS, ["Default"].concat(range(1, 26), ["Random"])), { y: 25 }),
      Object.assign(ON_OFF("crtEffect"), { y: 26 }),
      Object.assign(opt("volume", range(0, 10), null, () => applyVolume()), { y: 27, x: 18 }),
      { text: "Restore Defaults", sound: "phase", x: 6, y: 29, action() {
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
    if (env.shareConfig) optMenu.splice(optMenu.length - 1, 0, shareItem(6, 30));
    // web edition: the CRT effect is the C key (env.crtKey), not an option; sfx volume moves up into its row
    if (env.crtKey) { optMenu.splice(optMenu.findIndex((it) => it.key === "crtEffect"), 1); optMenu.find((it) => it.key === "volume").y = 26; }
    // web edition: no volume setting (env.fixedVolume; the browser / system volume does the job), the game plays at that level
    if (env.fixedVolume != null) {
      optMenu.splice(optMenu.findIndex((it) => it.key === "volume"), 1);
      optMenu.find((it) => it.text === "Restore Defaults").y = 28; // the freed row: a blank line after Restore Defaults
    }
    // web edition: Create Arena (an arena with the current settings) under Share Config
    if (env.createArena) optMenu.splice(optMenu.length - 1, 0, { text: "Create Arena", x: 6, y: 31, action() { env.createArena(); } });
    if (env.creditsInOptions) {
      optMenu.splice(optMenu.length - 1, 0, { text: "Credits", x: 6, y: env.createArena ? 32 : 31, action() { setScene("credits", "options"); } });
      optMenu[optMenu.length - 1].y = env.createArena ? 34 : 33; // Back
    }
    // web edition: plain menu items (not option values) centred on the 28-column screen
    if (env.centerMenus) for (const m of [menus.main, optMenu]) for (const it of m) if (it.text && !it.options) it.x = 14 - it.text.length / 2;
    // value lists kept alongside for selection lookup
    const OPT_VALUES = {
      mazepack: PACKS, startingLevel: range(1, 21), difficulty: [0, 1, 2], plusMode: [false, true],
      afterDark: [false, 1, 2, 3, 4, 5], radar: [false, 30, 60, 90, 120], startingLives: [1, 3, 5], freeGuy: [1, 2, 3, 4, 5],
      ability: [false, 1, 2, 3, 4], movement: [0, 1, 2, 3], ghostCount: range(0, 7), pinkyBug: [true, false],
      scatterOption: [false, 1, 2, 3], freeGhost: [true, false], background: bgNames, mazeColor: MAZE_COLORS,
      crtEffect: [true, false], volume: range(0, 10),
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
    function keypressed(key) {
      if (g.scene.captureInput) { g.scene.keypressed(key); return; } // web-edition scenes handle Esc/Backspace themselves
      if (key === "escape" || key === "backspace") {
        if (g.scene === attract) { if (env.quit) env.quit(); }
        else if (g.scene === game && !g.attract) { // web edition: an arena game goes back to its arena, silencing the game like the title does
          const to = env.quitGameTo && env.quitGameTo();
          if (to) { for (const k of Object.keys(g.sounds)) g.sounds[k].stop(); setScene(to); } else setScene("attract");
        }
        else if (g.scene === credits) leaveCredits();
        else setScene("attract", true);
        return;
      }
      if (g.scene.keypressed) g.scene.keypressed(key);
    }

    // love.gamepadpressed from main.lua
    function gamepadpressed(button) {
      if (g.scene.captureInput) { g.scene.gamepadpressed(button); return; }
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
      if (g.config.background === "random") g.currentBackground = BACKGROUND_OPTIONS[rand(2, BACKGROUND_OPTIONS.length) - 1];
      setCurrentMaze(g.config.mazepack);
      applyVolume(); applyMusicVolume();
      setScene("attract");
    }

    return {
      g, init, setScene, keypressed, update: () => g.scene.update(FIXED_DT),
      FIXED_DT, mode, maze, levels, graphics, getCurrentMaze, applyVolume, applyMusicVolume, resetConfigs, rand, REWIND,
      // web edition (rewind.js): put the looping sounds back in line with the game state, the way the game itself picks
      // them: eyes heading home -> "dead", any ghost frightened -> "scared", otherwise the siren for the dots left
      resyncLoops() {
        stopSiren(); g.sounds.dead.stop(); g.sounds.scared.stop(); g.sounds.thrust.stop();
        let anyDead = false, anyFrightened = false;
        for (const name of charKeys()) { const c = g.chars[name]; if (c.dead) anyDead = true; if (c.frightened) anyFrightened = true; }
        if (anyDead) g.sounds.dead.play(); else if (anyFrightened) g.sounds.scared.play(); else playSiren();
      },
      formatScore, constants: { TILE, CENTER, DELTAS, JOY_DIRS, MAX_THRUST, STUN_DISTANCE }, charKeys, animations, fruits,
      gamepadpressed, gameFc: () => gameFc, attractFc: () => attractFc, attractMenu,
      intermissions, MAX_COLORS: DATA.maxColors, INDEXES, optMenu, creditsMenu, creditsBooze,
    };
  }

  return { create, T, mod, FIXED_DT, JOY_DIRS };
});
