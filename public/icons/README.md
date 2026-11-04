# Arcade app icon

`gecko-source.png` is the original generated gecko mascot artwork, with a
transparent background. `arcade.svg` places it on evergreen for the app icon.
The mascot has lime-green skin, cream eyes and coral spots. The same artwork identifies every
app in browser tabs and on installed home screens.

Regenerate the checked-in variants with:

```sh
python3 scripts/generate-icons.py
```

The generator needs Inkscape, but no Python packages or runtime dependencies.

- `/favicon.svg`: self-contained SVG browser-tab icon with an embedded 256px mascot.
- `/favicon.ico`: embedded 16, 32, and 48 pixel PNG frames for fallback clients.
- `/apple-touch-icon.png`: opaque 180 × 180 icon for Apple home screens.
- `arcade-{192,512}.png`: general PWA icons with rounded corners.
- `arcade-maskable-{192,512}.png`: opaque, full-bleed icons with the gecko inside
  the central 80%-diameter safe circle. Platform-specific masks can crop the
  outer area without cutting off the artwork.

Every HTML entry point links the same `/manifest.webmanifest` and icon assets.
The manifest identifies Arcade at `/`, so opening another game does not create
a separate installed app. The games use live server state and still require a
network connection; the manifest does not advertise offline support.

The shared navigation bar uses the generated transparent `/icons/gecko-256.png` for its mascot and the same evergreen, lime and coral palette. The generator embeds artwork in temporary SVGs and the favicon, so exported icons never depend on external image requests.
