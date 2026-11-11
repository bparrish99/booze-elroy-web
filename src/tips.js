/* Booze Elroy web edition - the Options page's tips: what each option does, and what its current value means.
   Shown by main.js in #tip for the selected option row (mouse hover, keyboard or a tap all select a row). */
(function (root) {
  "use strict";
  const TIPS = {
    difficulty: { text: "Determines starting board and board progression" },
    plusMode: { text: "Enables Pac-Man Plus rules/graphics" },
    afterDark: { text: "Various options for hiding parts of the playing field" },
    radar: { text: "Limited ghost visibility, with differing delays" },
    ability: { text: "Various special abilities Pac-Man can use" },
    movement: { text: "Pac-Man’s base speed" },
    pinkyBug: { text: "In the original game, Pinky would target the wrong tile when Pac-Man was facing up. This bug is preserved by default but can be disabled" },
    scatterOption: { text: "Determines rules for where ghosts aim for when not chasing Pac-Man" },
    freeGhost: { text: "By default, there are some corridors ghosts are not allowed to enter. These restrictions can be disabled" },
    proMode: { text: "No jingle, no death animations, no intermissions, shorter delays" },
  };
  // the tip for an option row: { title, text, value } (value: what the current choice means), or null
  function tipFor(item) {
    const t = item && item.key && TIPS[item.key];
    if (!t) return null;
    const o = item.options && item.options[(item.selectedOption || 1) - 1];
    const v = o && t.values && t.values[o.text];
    return { text: t.text, value: v ? o.text + ": " + v : null };
  }
  const api = { TIPS, tipFor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BoozeTips = api;
})(typeof self !== "undefined" ? self : this);
