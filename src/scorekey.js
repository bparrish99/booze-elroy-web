/* Booze Elroy - leaderboard keys (web-edition addition, not in the Lua original).
 * Every option that affects gameplay gets its own board. The board key is the selected values in a fixed order,
 * e.g. "pac.0.f.f.f.3.1.f.0.4.t.f.f". Cosmetic options (background, maze style, CRT, volume) are left out, and so is
 * the starting level (starting on level 2 is the same game as starting on 1).
 * Shared by the browser bundle (global BoozeScoreKey) and the Netlify Function (CommonJS import).
 * The value lists mirror OPT_VALUES in core.js, in the same order; tests/unit.test.js checks that they match.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BoozeScoreKey = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };
  // [config key, allowed values]  (order is part of the key format: append only, never reorder)
  const FIELDS = [
    ["mazepack", ["pac", "booze", "mspac", "junior", "ultra", "arrange", "mega", "normal", "large", "random"]],
    ["difficulty", [0, 1, 2]],
    ["plusMode", [false, true]],
    ["afterDark", [false, 1, 2, 3, 4, 5]],
    ["radar", [false, 30, 60, 90, 120]],
    ["startingLives", [1, 3, 5]],
    ["freeGuy", [1, 2, 3, 4, 5]],
    ["ability", [false, 1, 2, 3]],
    ["movement", [0, 1, 2, 3]],
    ["ghostCount", range(0, 7)],
    ["pinkyBug", [true, false]],
    ["scatterOption", [false, 1, 2, 3]],
    ["freeGhost", [true, false]],
  ];
  const tok = (v) => (v === true ? "t" : v === false ? "f" : String(v));

  // index of a config value in its list; like core's selectFromConfig, any falsy value means "off" for boolean lists
  function indexOf(vals, v) {
    let i = vals.indexOf(v);
    if (i < 0 && vals.some((x) => typeof x === "boolean")) i = vals.indexOf(v ? true : false);
    return i;
  }
  /** board key for a game config, or null if some gameplay option holds a value we don't know */
  function keyFor(config) {
    const parts = [];
    for (const [k, vals] of FIELDS) {
      const i = indexOf(vals, config[k]);
      if (i < 0) return null;
      parts.push(tok(vals[i]));
    }
    return parts.join(".");
  }
  /** the gameplay settings a key stands for ({mazepack: "pac", ...}), or null if it isn't a well-formed key.
   *  Used by share links (?cfg=<key>). */
  function configFor(s) {
    if (!isKey(s)) return null;
    const parts = s.split("."), c = {};
    FIELDS.forEach(([k, vals], i) => { c[k] = vals.find((v) => tok(v) === parts[i]); });
    return c;
  }

  // Share codes: the same settings packed into one short, scrambled token (obfuscation, not security).
  // The option indices make one mixed-radix number below COMBOS; it is scrambled with an affine map mod COMBOS
  // (the multiplier is prime and doesn't divide COMBOS, so the map is reversible), written as 5 base-36 digits,
  // plus 1 check digit so typos and made-up codes are rejected.
  const COMBOS = FIELDS.reduce((n, [, vals]) => n * vals.length, 1);
  const MUL = 27644437, ADD = 12345678, B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
  const mulmod = (a, b, m) => Number((BigInt(a) * BigInt(b)) % BigInt(m));
  const MUL_INV = (() => { // modular inverse by extended Euclid
    let [r0, r1, t0, t1] = [COMBOS, MUL % COMBOS, 0, 1];
    while (r1) { const q = Math.floor(r0 / r1); [r0, r1] = [r1, r0 - q * r1]; [t0, t1] = [t1, t0 - q * t1]; }
    return ((t0 % COMBOS) + COMBOS) % COMBOS;
  })();
  const check = (s) => { let c = 7; for (let i = 0; i < s.length; i++) c = (c * 31 + B36.indexOf(s[i]) * (i + 3)) % 36; return B36[c]; };
  /** short share code for a config, e.g. "k4t9x2"; null if some gameplay option holds a value we don't know */
  function shareCode(config) {
    let n = 0;
    for (const [k, vals] of FIELDS) { const i = indexOf(vals, config[k]); if (i < 0) return null; n = n * vals.length + i; }
    const body = ((mulmod(n, MUL, COMBOS) + ADD) % COMBOS).toString(36).padStart(5, "0");
    return body + check(body);
  }
  /** the gameplay settings a share code stands for, or null if it isn't a valid code */
  function configFromCode(s) {
    if (typeof s !== "string" || !/^[0-9a-z]{6}$/i.test(s)) return null;
    s = s.toLowerCase();
    const body = s.slice(0, 5);
    if (check(body) !== s[5]) return null;
    const m = parseInt(body, 36);
    if (m >= COMBOS) return null;
    let n = mulmod((m - ADD + COMBOS) % COMBOS, MUL_INV, COMBOS);
    const c = {};
    for (let f = FIELDS.length - 1; f >= 0; f--) { const [k, vals] = FIELDS[f]; c[k] = vals[n % vals.length]; n = Math.floor(n / vals.length); }
    const out = {};
    for (const [k] of FIELDS) out[k] = c[k];
    return out;
  }
  /** true if s is a well-formed board key */
  function isKey(s) {
    if (typeof s !== "string" || s.length > 100) return false;
    const parts = s.split(".");
    return parts.length === FIELDS.length && FIELDS.every(([, vals], i) => vals.some((v) => tok(v) === parts[i]));
  }

  // names: what the game font can draw (see TEXT_CHARS in render.js). Its "?" slot is blank and "$%^&*()_" are
  // pieces of the logo, so the symbols are just ! - /
  const NAME_MAX = 16;
  const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!-/ ";
  /** upper-cased, trimmed, inner spaces collapsed; null if empty, too long or using other characters */
  function cleanName(s) {
    if (typeof s !== "string") return null;
    const n = s.toUpperCase().replace(/\s+/g, " ").trim();
    if (!n.length || n.length > NAME_MAX) return null;
    for (const c of n) if (!NAME_CHARS.includes(c)) return null;
    return n;
  }
  const MAX_SCORE = 9999999; // 7 digits, what formatScore can show
  const BOARD_SIZE = 10;
  /** 0-based position a score would take (after existing equal scores), or -1 if it doesn't make the board */
  function placeOf(entries, score) {
    let i = entries.findIndex((e) => e.score < score);
    if (i < 0) i = entries.length;
    return i < BOARD_SIZE ? i : -1;
  }

  return { FIELDS, keyFor, configFor, shareCode, configFromCode, COMBOS, isKey, cleanName, placeOf, NAME_MAX, NAME_CHARS, MAX_SCORE, BOARD_SIZE };
});
