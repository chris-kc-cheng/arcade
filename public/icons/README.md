# Arcade app icon

`arcade.svg` is the hand-authored, font-free vector source: an arcade cabinet in
acid yellow, cyan, and coral on midnight ink. The same artwork identifies every
app in browser tabs and on installed home screens.

Regenerate the checked-in variants with:

```sh
python3 scripts/generate-icons.py
```

The generator needs Inkscape, but no Python packages or runtime dependencies.

- `/favicon.svg`: scalable browser-tab icon.
- `/favicon.ico`: embedded 16, 32, and 48 pixel PNG frames for fallback clients.
- `/apple-touch-icon.png`: opaque 180 × 180 icon for Apple home screens.
- `arcade-{192,512}.png`: general PWA icons with rounded corners.
- `arcade-maskable-{192,512}.png`: opaque, full-bleed icons with the cabinet inside
  the central 80%-diameter safe circle. Platform-specific masks can crop the
  outer area without cutting off the artwork.

Every HTML entry point links the same `/manifest.webmanifest` and icon assets.
The manifest identifies Arcade at `/`, so opening another game does not create
a separate installed app. The games use live server state and still require a
network connection; the manifest does not advertise offline support.
