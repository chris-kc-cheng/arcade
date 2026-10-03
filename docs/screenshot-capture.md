# Local gameplay captures

## Capture limitation during the navigation refresh

At the time of the navigation refresh, the six existing PNGs were preserved browser captures from before that refresh. The Type/Off, Many Words, and Quick Poll SVGs were illustrations, not evidence of the current UI. Those source assets are all 1280×720. README previews are always displayed at 320×180; its status note describes the currently linked set.

This change could not produce new browser captures in its execution environment: installed Chromium aborted at startup with `socket() failed: Operation not permitted`, and the supported cloud browser rejected the local app URL with `ERR_BLOCKED_BY_CLIENT`. The capture script below is prepared but has **not been validated end-to-end in a permitted browser**. No screenshot is fabricated or silently replaced with an illustration.

## Run a complete refresh

Requirements:

- Node.js 18 or newer and the project's installed dependencies (`npm ci`)
- An installed Chrome or Chromium executable
- Permission to launch that browser and access a temporary loopback HTTP/WebSocket server

```sh
npm run screenshots
npm run screenshots:check
npm test
```

Set `CHROME_BIN` when Chrome is not on `PATH`:

```sh
CHROME_BIN=/path/to/chrome npm run screenshots
```

The command builds the application, starts its own temporary local server on a free port, and creates a fresh browser profile. It does not use production, publish a preview, touch a running match, or use real personal data. Chrome runs with its sandbox enabled by default. Only in an already isolated container that explicitly requires it, set `CHROME_NO_SANDBOX=1`; do not use that option to bypass an access restriction.

## What it captures

The script drives the actual app and sends normal validated WebSocket actions. It never rewrites game state, scores, canvases, page text, or styles to create a mock screenshot.

| Experience | Synthetic scene |
| --- | --- |
| Drawing Board | Alex, Sam, and Jo collaborating on a small streetscape with room chat and cursors |
| Tank | A connected three-pilot arena, scoreboard, first-person view, and tactical map |
| Penalty Shootout | A two-player shot with independently selected target and dive |
| Line Fighter | Two fighters moving together and a real Hadoken action |
| Snake | Three connected players in a live shared match |
| Big-D | Four synthetic players, a dealt hand, and a legal opening card |
| Type/Off | A live head-to-head race with partial typed progress |
| Many Words | A private five-letter puzzle with submitted guesses |
| Quick Poll | A participant's view of live results from four synthetic votes |

The new set uses **1920×1080 at 100% scale** to leave space for the longer game controls while preserving the common 16:9 aspect ratio. README thumbnails remain 320×180. Game randomness and animation timing intentionally remain real, so successive captures need not be pixel-identical.

Captures first go to temporary staging. The script checks dimensions, runtime exceptions, the nine-link navigation, its current-page marker, and horizontal overflow. Only after all nine captures succeed does it copy the PNGs into `public/screenshots/`, update the README links/status, and write `public/screenshots/capture-manifest.json` with viewport and navigation evidence. Original SVGs are retained as historical artwork.

Before committing, visually review every new PNG for clipping, loading or error states, useful gameplay, and readable navigation. The automatic checks cannot establish visual quality. If the browser is blocked, preserve the existing assets and report the blocker rather than changing the status to claim a refresh.

`npm run screenshots:check` is browser-free. It checks the nine currently linked assets, a shared 16:9 source size, and identical 320×180 README thumbnail dimensions.
