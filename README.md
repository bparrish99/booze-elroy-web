# Booze Elroy: Web Edition

A faithful JavaScript/browser port of **Booze Elroy**, a Pac-Man variant by Pinback.
Play it at https://booze-elroy.com

The game logic in `src/core.js` is a 1:1 port of the original Love2D/Lua source (v1.0, 5/22/2026): same data tables,
same iteration orders, same RNG usage. `src/render.js` draws it on a 224x288 canvas and adds the optional CRT shader.

## Layout
| Path | What |
|---|---|
| `src/` | `core.js` game logic, `render.js` drawing + CRT, `audio.js` sound, `main.js` input/touch/mouse/fullscreen, `leaderboard.js` online leaderboard + name entry, `scorekey.js` settings -> board key (shared with the server) |
| `netlify/` | `functions/scores.mjs` leaderboard API (Netlify Function), `lib/scores.mjs` its logic |
| `assets/` | sprites, backgrounds (pre-darkened), sounds (FLAC), intermission video, `data.json` (level/maze tables) |
| `template/index.html` | page shell |
| `tools/build.py` | bundles everything into `public/index.html` |
| `public/` | the built site (committed; this is what Netlify serves) |
| `branding/` | ghost logo PNGs and favicons |
| `tools/dev-server.mjs` | local preview: game + leaderboard API + local Blobs store |
| `tests/` | `unit.test.mjs` (keys, API), `smoke.js` (offline page), `leaderboard.e2e.mjs` (full leaderboard flow) |

## Build and run
Node 24 (`nvm use` reads `.nvmrc`) and Python 3.
```
npm install                          # @netlify/blobs + dev tools (eslint, playwright)
npx playwright install chromium      # once; on WSL/Linux also: sudo apt-get install libnspr4 libnss3 libglib2.0-0
npm run build      # python3 tools/build.py  ->  public/index.html
npm run dev        # http://localhost:8888  game + leaderboard API, scores in .dev-blobs/ (reset password "dev")
npm run serve      # http://localhost:8080  static only (leaderboard shows "offline")
npm run lint       # eslint
npm test           # unit tests, offline smoke test, leaderboard end-to-end test
```
## Deploy
Netlify serves `public/` as-is and deploys the function in `netlify/functions/` (see `netlify.toml`).
Run the build, commit `public/index.html`, push.

## Online leaderboard
- One top-10 board per combination of the Game/Player/Ghost options; Audio/Video options don't matter.
- Scores live in the Netlify Blobs store `leaderboard`, one JSON blob per board, keyed by the settings
  (e.g. `pac.0.f.f.f.3.1.f.0.4.t.f.f` = defaults). Netlify UI: Project > Blobs.
- Typing `reset` on a menu screen (title, Options, ...) opens the reset dialog (no menu item) to wipe the current board or all boards. It needs the password in the Netlify
  environment variable `LEADERBOARD_ADMIN_PASSWORD`; without it, reset is disabled.
- Arenas: 24-hour boards for one set of settings (Netlify Blobs store `arenas`: an `index` blob plus `e/<id>` per arena).
  Anyone can create one; open arena names are unique. Admin delete: `POST /api/arenas/delete {id, password}`.
- Scores are trusted as sent by the browser (no anti-cheat).

## Controls
Keyboard, mouse (menus), and touch (swipe to steer, tap to select, two fingers to pause, X button to go back).
`F` toggles full screen.
