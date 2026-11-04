#!/usr/bin/env python3
"""Render Arcade's gecko mascot icons. Requires Inkscape on PATH.

Run from anywhere: python3 scripts/generate-icons.py
No Python packages or browser/runtime dependencies are required.
"""
from pathlib import Path
import base64
import shutil
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / "public"
ICONS = PUBLIC / "icons"
SOURCE = ICONS / "arcade.svg"
SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)


def variant(*, opaque=False, maskable=False, artwork=None):
    root = ET.parse(SOURCE).getroot()
    # Embed the maintained PNG so temporary SVGs and the favicon have no
    # external-file dependency. The compact favicon uses a 256px sprite.
    image = root.find(f"{{{SVG}}}g/{{{SVG}}}image")
    data = artwork if artwork is not None else (ICONS / "gecko-source.png").read_bytes()
    image.set("href", "data:image/png;base64," + base64.b64encode(data).decode("ascii"))
    if opaque:
        root.find(f"{{{SVG}}}rect").attrib.pop("rx", None)
    if maskable:
        mascot = root.find(f"{{{SVG}}}g")
        # The 48px sprite becomes a 36px square centered at (32,32).
        # Even its corners stay inside the 25.6px mask-safe radius.
        mascot.set("transform", "translate(8 8) scale(0.75)")
    return ET.tostring(root, encoding="unicode")


def render(source, destination, size):
    subprocess.run([
        "inkscape", str(source), "--export-type=png",
        f"--export-filename={destination}",
        f"--export-width={size}", f"--export-height={size}",
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if not shutil.which("inkscape"):
    raise SystemExit("Install Inkscape from its official distribution to regenerate these icons.")

with tempfile.TemporaryDirectory(prefix="arcade-icons-") as directory:
    temporary = Path(directory)
    # Compile a smaller transparent sprite for the SVG favicon. This keeps the
    # tab icon self-contained without embedding the full-resolution artwork.
    sprite = ET.parse(SOURCE).getroot()
    sprite.remove(sprite.find(f"{{{SVG}}}rect"))
    image = sprite.find(f"{{{SVG}}}g/{{{SVG}}}image")
    image.set("href", "data:image/png;base64," + base64.b64encode((ICONS / "gecko-source.png").read_bytes()).decode("ascii"))
    for key, value in {"x":"0", "y":"0", "width":"64", "height":"64"}.items():
        image.set(key, value)
    sprite_svg = temporary / "sprite.svg"
    sprite_svg.write_text(ET.tostring(sprite, encoding="unicode"))
    sprite_png = temporary / "sprite.png"
    render(sprite_svg, sprite_png, 256)
    shutil.copyfile(sprite_png, ICONS / "gecko-256.png")
    (PUBLIC / "favicon.svg").write_text(variant(artwork=sprite_png.read_bytes()))
    maskable = temporary / "maskable.svg"
    maskable.write_text(variant(opaque=True, maskable=True))
    apple = temporary / "apple.svg"
    apple.write_text(variant(opaque=True))
    for size in (192, 512):
        render(SOURCE, ICONS / f"arcade-{size}.png", size)
        render(maskable, ICONS / f"arcade-maskable-{size}.png", size)
    render(apple, PUBLIC / "apple-touch-icon.png", 180)
    frames = []
    for size in (16, 32, 48):
        target = temporary / f"favicon-{size}.png"
        render(SOURCE, target, size)
        frames.append((size, target.read_bytes()))
    # ICO permits PNG frames. Store all three sizes to keep older tab/taskbar
    # consumers crisp instead of asking them to downsample one large image.
    offset = 6 + 16 * len(frames)
    with (PUBLIC / "favicon.ico").open("wb") as output:
        output.write(struct.pack("<HHH", 0, 1, len(frames)))
        for size, png in frames:
            output.write(struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(png), offset))
            offset += len(png)
        for _, png in frames:
            output.write(png)
print("Regenerated SVG, ICO, Apple, and any/maskable PWA icons.")
