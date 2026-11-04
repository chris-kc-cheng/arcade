# Arcade app icon

The mark is a lime-green arcade joystick (round ball, stem, base with a coral button) on
evergreen `#0f2723`. It is a single drawing, so it stays recognisable from a 16 px browser tab
to a maskable home-screen icon. `arcade.svg` is the source; `/favicon.svg` is the same drawing
at its natural 64 px size, and the toolbar's inline mark (`MARK` in `public/platform.js`) repeats
it. A test fails if they drift apart.

Regenerate every raster file with:

```sh
node scripts/generate-icons.js
```

The script needs Chrome or Chromium (set `CHROME_BIN` if it is not found) and no npm packages.
It writes the SVGs, then rasterises them with headless Chrome, so nothing is edited by hand.

- `/favicon.svg`: self-contained vector tab icon (no embedded images, no external requests).
- `/favicon.ico`: embedded 16, 32 and 48 pixel PNG frames for fallback clients. The two small
  frames draw the mark slightly larger so it stays legible.
- `/apple-touch-icon.png`: opaque 180 × 180 icon for Apple home screens.
- `arcade-{192,512}.png`: general PWA icons with rounded corners.
- `arcade-maskable-{192,512}.png`: opaque, full-bleed icons with the joystick inside the central
  80%-diameter safe circle, so platform masks can crop the outer area without cutting off the artwork.

Every HTML entry point links the same `/manifest.webmanifest` and icon assets. The manifest
identifies Arcade at `/`, so opening another game does not create a separate installed app. The
games use live server state and still require a network connection; the manifest does not
advertise offline support.

The toolbar's interface icons are separate: inline SVG line icons (24 px grid, 2 px `currentColor`
stroke, round caps and joins) defined in `public/platform.js`.
