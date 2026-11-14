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
  // points in a mode: [id, name, how (for the description), option, value]; each comes as a 10,000-point one, a
  // 20,000-point "2" and a 30,000-point "3" (ids: id, id + "2", id + "3"; names: name + " 1", " 2", " 3"; the
  // author: "This isn't the Godfather", so the first one is "1" too), listed together. Earned at game over
  // (main.js) when the option has that value
  const MODES = [
    ["haunted", "house of horrors", "in Haunted mode (Blindfold: Haunted)", "afterDark", 4],
    ["terror", "house of terrors", "with Sonar: Terror", "radar", 120], // next to house of horrors (the author's symmetry)
    ["afterdark", "after dark", "with Blindfold: Maze", "afterDark", 1],
    ["rocketman", "rocketman", "in Jetpack mode", "movement", 3],
    ["coke", "coke and a smile", "in Plus Mode", "plusMode", true],
    ["booze", "best mazes ever", "with the Booze maze pack", "mazepack", "booze"],
    ["seven", "desaturating seven", "with 7 ghosts", "ghostCount", 7],
    ["yolo", "yolo", "with 1 starting life", "startingLives", 1],
    ["photo", "photographic memory", "with Blindfold: Blackout", "afterDark", 5],
  ];
  const TIERS = [[10000, ""], [20000, "2"], [30000, "3"]];
  // minGhosts: counts only in a game with at least that many ghosts (the author: fewer make it too easy); main.js
  // checks it for every achievement that has it, the description says it
  const G4 = "at least 4 ghosts";
  const modeTiers = MODES.flatMap(([id, name, how, key, value]) => TIERS.map(([points, suffix]) =>
    ({ id: id + suffix, name: name + " " + (suffix || "1"), desc: "Score " + points.toLocaleString("en-US") + " points " + how + (key === "ghostCount" ? "" : ", with " + G4) + ".", mode: { key, value }, points, minGhosts: 4 })));

  // Reaching a board (peer pressure, without a scratch 1-3, pac-man fever) counts only in a game started on
  // level 1 (the author: a high Starting Level mustn't skip there); main.js checks it, the descriptions say it.
  // in the profile's order, grouped: firsts, scores, points in a mode (each mode's 10,000 / 20,000 / 30,000 together),
  // arenas, leaderboards, secrets
  const LIST = [
    { id: "quarter", name: "spent a quarter", desc: "Finish a game." },
    { id: "respects", name: "pay respects", desc: "View the credits." },
    { id: "stylish", name: "stylish", desc: "Finish a game with a background or maze style other than the default." },
    { id: "park", name: "walk in the park", desc: "Start a game with zero ghosts." },
    { id: "kind", name: "be kind", desc: "Use Rewind in a game." },
    { id: "dedication", name: "dedication", desc: "See the third intermission." },
    { id: "martini", name: "peer pressure", desc: "Enjoy a delicious martini, in a game with " + G4 + " started on level 1.", minGhosts: 4 }, // the bonus on boards 9 and 10 ("galaxian")
    { id: "streak", name: "one week chip", desc: "Play a game on seven days in a row." },
    { id: "scratch", name: "without a scratch 1", desc: "Make it to the first intermission without losing a life, in a game with " + G4 + " started on level 1.", minGhosts: 4 },
    { id: "scratch2", name: "without a scratch 2", desc: "Make it to the second intermission without losing a life, in a game with " + G4 + " started on level 1.", minGhosts: 4 },
    { id: "scratch3", name: "without a scratch 3", desc: "Make it to the third intermission without losing a life, in a game with " + G4 + " started on level 1.", minGhosts: 4 },
    // the ninth key: boards 13-21 carry the key (pancakes in Plus Mode); earned past board 21
    { id: "fever", name: "pac-man fever", desc: "Complete the ninth key, in a game with " + G4 + " started on level 1.", minGhosts: 4 },

    { id: "clyde", name: "clyde", desc: "Score 10,000 points in a game with " + G4 + ".", score: 10000, minGhosts: 4 },
    { id: "inky", name: "inky", desc: "Score 30,000 points in a game with " + G4 + ".", score: 30000, minGhosts: 4 },
    { id: "pinky", name: "pinky", desc: "Score 60,000 points in a game with " + G4 + ".", score: 60000, minGhosts: 4 },
    { id: "blinky", name: "blinky", desc: "Score 100,000 points in a game with " + G4 + ".", score: 100000, minGhosts: 4 },

    ...modeTiers,
    { id: "elephant", name: "elephantine memory", desc: "Complete a large maze with Blindfold: Blackout and " + G4 + ".", minGhosts: 4 }, // the author: right after photographic memory 3

    { id: "arena", name: "party animal", desc: "Finish a game in an arena." },
    { id: "planner", name: "party planner", desc: "Create an arena." },
    { id: "dinner", name: "chicken dinner", desc: "Win an arena." },

    { id: "trailblazer", name: "trailblazer", desc: "Be the first to put a score on the leaderboard for a combination of settings nobody has a score on yet." },
    { id: "billy", name: "billy mitchell", desc: "Take the top spot on the Classic Pac-Man leaderboard (the untouched settings)." },
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
