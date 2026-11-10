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
    ["ability", [false, 1, 2, 3, 4]], // 4 = Rewind (web edition, appended later; see LEGACY_LENGTHS)
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
  // The option indices make one mixed-radix number below the number of combinations; it is scrambled with an affine map
  // (the multiplier is prime and doesn't divide the modulus, so the map is reversible), written in base 36, plus 1 check
  // digit so typos and made-up codes are rejected.
  //  - 6 characters (5 + check): the original format, frozen. It packs only the values that existed when it shipped
  //    (LEGACY_LENGTHS), so every link shared since then keeps working.
  //  - 7 characters (6 + check): settings the old format can't hold (values appended later, e.g. the Rewind ability).
  const LEGACY_LENGTHS = [10, 3, 2, 6, 5, 3, 5, 4, 4, 8, 2, 4, 2]; // never change: the 6-character format depends on it
  const LENGTHS = FIELDS.map(([, vals]) => vals.length);
  const COMBOS = LEGACY_LENGTHS.reduce((n, l) => n * l, 1);
  const COMBOS7 = LENGTHS.reduce((n, l) => n * l, 1);
  const MUL = 27644437, ADD = 12345678, B36 = "0123456789abcdefghijklmnopqrstuvwxyz";
  const mulmod = (a, b, m) => Number((BigInt(a) * BigInt(b)) % BigInt(m));
  const inverse = (m) => { // modular inverse of MUL by extended Euclid
    let [r0, r1, t0, t1] = [m, MUL % m, 0, 1];
    while (r1) { const q = Math.floor(r0 / r1); [r0, r1] = [r1, r0 - q * r1]; [t0, t1] = [t1, t0 - q * t1]; }
    return ((t0 % m) + m) % m;
  };
  const FORMATS = { 6: { lengths: LEGACY_LENGTHS, combos: COMBOS, inv: inverse(COMBOS) }, 7: { lengths: LENGTHS, combos: COMBOS7, inv: inverse(COMBOS7) } };
  const check = (s) => { let c = 7; for (let i = 0; i < s.length; i++) c = (c * 31 + B36.indexOf(s[i]) * (i + 3)) % 36; return B36[c]; };
  /** short share code for a config, e.g. "k4t9x2" (7 characters if it needs a later value); null for unknown values */
  function shareCode(config) {
    const idx = [];
    for (const [k, vals] of FIELDS) { const i = indexOf(vals, config[k]); if (i < 0) return null; idx.push(i); }
    const f = FORMATS[idx.every((i, k) => i < LEGACY_LENGTHS[k]) ? 6 : 7];
    let n = 0;
    idx.forEach((i, k) => { n = n * f.lengths[k] + i; });
    const body = ((mulmod(n, MUL, f.combos) + ADD) % f.combos).toString(36).padStart(f === FORMATS[6] ? 5 : 6, "0");
    return body + check(body);
  }
  /** the gameplay settings a share code stands for, or null if it isn't a valid code */
  function configFromCode(s) {
    if (typeof s !== "string" || !/^[0-9a-z]{6,7}$/i.test(s)) return null;
    s = s.toLowerCase();
    const f = FORMATS[s.length], body = s.slice(0, -1);
    if (check(body) !== s[s.length - 1]) return null;
    const m = parseInt(body, 36);
    if (m >= f.combos) return null;
    let n = mulmod((m - ADD % f.combos + f.combos) % f.combos, f.inv, f.combos);
    const c = {};
    for (let k = FIELDS.length - 1; k >= 0; k--) { const [key, vals] = FIELDS[k]; c[key] = vals[n % f.lengths[k]]; n = Math.floor(n / f.lengths[k]); }
    const out = {};
    for (const [key] of FIELDS) out[key] = c[key];
    // a 7-character code always holds a later value; one that doesn't is a made-up code
    if (s.length === 7 && FIELDS.every(([key, vals], k) => indexOf(vals, out[key]) < LEGACY_LENGTHS[k])) return null;
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

  return { FIELDS, keyFor, configFor, shareCode, configFromCode, COMBOS, COMBOS7, isKey, cleanName, placeOf, NAME_MAX, NAME_CHARS, MAX_SCORE, BOARD_SIZE };
});
