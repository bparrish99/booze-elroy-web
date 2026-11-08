# Booze Elroy: Web Edition - notes for Claude

Pinback's Pac-Man variant "Booze Elroy" (original: Love2D/Lua, not in this repo). This repo is a faithful JS port, live at booze-elroy.com (Netlify, serves `public/`).

## Rules that matter
- The original Lua is canon. `src/core.js` mirrors it 1:1 (Lua truthiness helper `T()`, pinned iteration orders). Do not "clean up" logic; behaviour must match the original.
- Port-only deviations (approved by the author):
  - `logic.eatOverlappingFrightened`: a second frightened ghost sharing Pac-Man's tile after an ateGhost pause is also eaten.
  - The `large` pack's nonexistent "mega1" maps to "large1" (the original crashes there, likely the cause of old autoplay nil-reference crashes).
  - Online leaderboard (src/leaderboard.js, src/scorekey.js, netlify/): "Leaderboard" main-menu item in the old Exit slot; name entry after a top-10 game over; HIGH SCORE in the header = best for the current gameplay settings (online leader's name scrolls through the HIGH SCORE field); no Reset item in Options: the cheat "reset" (typed on a menu screen) opens a password dialog that resets the online boards (current settings or all). core.js only has small `env` hooks for this (env.scenes, env.afterGameOver, captureInput); without them it behaves like the original.
  - Arenas (src/leaderboard.js scenes "arenas"/"arena", netlify/lib/arenas.mjs, Blobs store "arenas"): 24-hour boards with fixed gameplay settings; main-menu "Arena" under Play 1P. Playing one applies its settings (starting level 1) until the player leaves (their own come back; never saved). Game over in an arena posts to the arena board and the regular board. Finished arenas stay listed 24 h with their winner. 15 min grace for scores after closing. "Share Arena" copies `?arena=<id>`, which opens that arena's page.
  - Cheat codes (main.js CHEATS): "mina" on menu screens plays the intermission 3 film; "delete" on an arena page opens the password dialog (admin) to delete that arena.
  - Elroy's bubbles are drawn as pixel-art cartoon bubbles by render.js (render-only life/motion); core still emits the same particles with the same RNG calls (`bubble: true` flag only).
  - "Share Config" (Options and the Leaderboard page; env.shareConfig / LB opts.share): copies `https://booze-elroy.com/?cfg=<6-char share code>` (scorekey.js shareCode: scrambled, with a check digit) and shows a "link copied to clipboard" popup (g.toast); opening such a link preselects those gameplay settings (not starting level or Audio/Video) and saves them.
- No music and no music option (Options row is "sfx volume"). Main menu is Play 1P / Arena / Options / Leaderboard, a blank row apart. No Exit or Autoplay menu items (autoplay code kept; env.noAutoplay). Main-menu and Options action items are centred (env.centerMenus). Credits is on the Options page (env.creditsInOptions; its Back/Esc return there) and "web edition" on the title links to it. No "click to play" overlay; title shows immediately.
- Title tag text is "WEB EDITION" (bottom row, pink). Full screen is the page button / `F`, not an option.
- The "max CRT" look (WebGL presenter in `render.js`) is canon. Backgrounds are pre-darkened to 25% brightness.
- Options and high score are saved in localStorage.
- Intermission 3 plays `assets/video/mina.*` (a dedication to the author's daughter). Treat it with care; it only works in real browsers.
- Credits: "pinback" pulses colours and links to a mailto; the bottom marquee ("what is seeing this?", one pass every ~2 s gap; "?" only exists in font colour 3) links to https://pinback.substack.com.

## Workflow
`npm run build` -> `public/index.html` (commit it). Node 24 via nvm (`.nvmrc`; system Node is an old 12, so `. ~/.nvm/nvm.sh` first). `npm run lint` (ESLint 9, must stay clean), `npm test` (unit + smoke + leaderboard e2e). `npm run dev` = local preview with the API. `assets/` is generated once by `tools/prep_assets.py` from the original source (needs Pillow, ffmpeg and BOOZE_SRC); `tools/export_data.py` regenerates `assets/data.json` from the Lua (needs lupa).
Verification against the original was done with a headless Lua-vs-JS trace diff kept outside this repo.

## Leaderboard
Netlify Function `netlify/functions/scores.mjs` + Netlify Blobs store "leaderboard", one JSON blob per settings combination (key from `scorekey.js`: 13 Game/Player/Ghost options; starting level and Audio/Video options never count). Top 10, names up to 16 chars (A-Z 0-9 ! - / space: the font has no "?" or "."), trust-the-client. Reset password: Netlify env var LEADERBOARD_ADMIN_PASSWORD. `npm run dev` previews locally (password "dev").
