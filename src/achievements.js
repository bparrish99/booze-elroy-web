/* Booze Elroy - achievements (web-edition addition): the list, shared by the browser bundle (global
 * BoozeAchievements) and the accounts Netlify Function (CommonJS import). Earned ones are kept per account on the
 * server (netlify/lib/accounts.mjs). Names are drawn in the game font (a-z 0-9 ! - / and spaces only, 26 at most);
 * descriptions are plain text in an HTML popup (hovering / tapping a name on the profile page), so anything goes.
 * Ids are stored: never rename one.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BoozeAchievements = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // points in a mode: [id, name, how (for the description), option, value]; each comes as a 10,000-point one and a
  // 20,000-point "2" (id + "2", name + " 2"). Earned at game over (main.js) when the option has that value
  const MODES = [
    ["haunted", "house of horrors", "in Haunted mode (Blindfold: Haunted)", "afterDark", 4],
    ["terror", "house of terrors", "with Sonar: Terror", "radar", 120], // next to house of horrors (the author's symmetry)
    ["afterdark", "after dark", "with Blindfold: Maze", "afterDark", 1],
    ["rocketman", "rocketman", "in Jetpack mode", "movement", 3],
    ["coke", "coke and a smile", "in Plus Mode", "plusMode", true],
    ["booze", "best mazes ever", "with the Booze maze pack", "mazepack", "booze"],
    ["seven", "desaturating seven", "with 7 ghosts", "ghostCount", 7],
    ["yolo", "yolo", "with 1 starting life", "startingLives", 1],
  ];
  const tier = (points, suffix) => MODES.map(([id, name, how, key, value]) =>
    ({ id: id + suffix, name: name + (suffix ? " " + suffix : ""), desc: "Score " + points.toLocaleString("en-US") + " points " + how + ".", mode: { key, value }, points }));

  // in the profile's order, grouped: firsts, scores, points in a mode (10,000, then 20,000), arenas, leaderboards, secrets
  const LIST = [
    { id: "quarter", name: "spent a quarter", desc: "Finish a game." },
    { id: "respects", name: "pay respects", desc: "View the credits." },
    { id: "stylish", name: "stylish", desc: "Finish a game with a background or maze style other than the default." },
    { id: "park", name: "walk in the park", desc: "Start a game with zero ghosts." },
    { id: "kind", name: "be kind", desc: "Use Rewind in a game." },
    { id: "dedication", name: "dedication", desc: "See the third intermission." },
    { id: "streak", name: "one week chip", desc: "Play a game on seven days in a row." },
    { id: "scratch", name: "without a scratch", desc: "Make it to the first intermission without losing a life." },
    { id: "scratch2", name: "without a scratch 2", desc: "Make it to the second intermission without losing a life." },

    { id: "clyde", name: "clyde", desc: "Score 10,000 points in a game.", score: 10000 },
    { id: "inky", name: "inky", desc: "Score 30,000 points in a game.", score: 30000 },
    { id: "pinky", name: "pinky", desc: "Score 60,000 points in a game.", score: 60000 },
    { id: "blinky", name: "blinky", desc: "Score 100,000 points in a game.", score: 100000 },

    ...tier(10000, ""),
    ...tier(20000, "2"),

    { id: "arena", name: "party animal", desc: "Finish a game in an arena." },
    { id: "planner", name: "party planner", desc: "Create an arena." },
    { id: "dinner", name: "chicken dinner", desc: "Win an arena." },

    { id: "trailblazer", name: "trailblazer", desc: "Be the first to put a score on the leaderboard for a combination of settings nobody has a score on yet." },
    { id: "billy", name: "billy mitchell", desc: "Take the top spot on the default-settings leaderboard." },
    { id: "pug", name: "booze pug", desc: "Make the top 10 on 3 different leaderboards.", boards: 3 },
    { id: "beagle", name: "booze beagle", desc: "Make the top 10 on 5 different leaderboards.", boards: 5 },
    { id: "boxer", name: "booze boxer", desc: "Make the top 10 on 10 different leaderboards.", boards: 10 },
    { id: "hound", name: "booze hound", desc: "Make the top 10 on 20 different leaderboards.", boards: 20 },

    // secret ones last; their hover text is just "SECRET ACHIEVEMENT"
    { id: "wake", name: "time to wake up", desc: "SECRET ACHIEVEMENT", secret: true },
    { id: "neil", name: "neil rogers", desc: "SECRET ACHIEVEMENT", secret: true },
  ];
  const isId = (id) => LIST.some((a) => a.id === id);
  const byId = (id) => LIST.find((a) => a.id === id) || null;
  return { LIST, isId, byId };
});
