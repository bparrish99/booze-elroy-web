# Booze Elroy: Web Edition

A faithful JavaScript/browser port of **Booze Elroy**, a Pac-Man variant by Pinback.
Play it at https://booze-elroy.com

The game logic in `src/core.js` is a 1:1 port of the original Love2D/Lua source (v1.0, 5/22/2026): same data tables,
same iteration orders, same RNG usage. `src/render.js` draws it on a 224x288 canvas and adds the optional CRT shader.

## Layout
| Path | What |
|---|---|
| `src/` | `core.js` game logic, `render.js` drawing + CRT, `audio.js` sound, `main.js` input/touch/mouse/fullscreen |
| `assets/` | sprites, backgrounds (pre-darkened), sounds (FLAC), intermission video, `data.json` (level/maze tables) |
| `template/index.html` | page shell |
| `tools/build.py` | bundles everything into `public/index.html` |
| `public/` | the built site (committed; this is what Netlify serves) |
| `branding/` | ghost logo PNGs and favicons |
| `tests/smoke.js` | Playwright smoke test |

## Build and run
Node 24 (`nvm use` reads `.nvmrc`) and Python 3.
```
npm install                          # dev tools: eslint, playwright
npx playwright install chromium      # once; on WSL/Linux also: sudo apt-get install libnspr4 libnss3 libglib2.0-0
npm run build      # python3 tools/build.py  ->  public/index.html
npm run serve      # http://localhost:8080
npm run lint       # eslint src tests
npm test           # Playwright smoke test against public/index.html
```
## Deploy
Netlify serves `public/` as-is (see `netlify.toml`). Run the build, commit `public/index.html`, push.

## Controls
Keyboard, mouse (menus), and touch (swipe to steer, tap to select, two fingers to pause, X button to go back).
`F` toggles full screen.
