#!/usr/bin/env python3
"""Render Arcade's hand-authored vector icon. Requires Inkscape on PATH.

Run from anywhere: python3 scripts/generate-icons.py
No Python packages or browser/runtime dependencies are required.
"""
from pathlib import Path
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


def variant(*, opaque=False, maskable=False):
    root = ET.parse(SOURCE).getroot()
    if opaque:
        root.find(f"{{{SVG}}}rect").attrib.pop("rx", None)
    if maskable:
        cabinet = root.find(f"{{{SVG}}}g")
        # Every non-background pixel stays inside the central 80%-diameter
        # safe circle, including the top corners and sloping cabinet base.
        cabinet.set("transform", "translate(6.4 6.4) scale(0.8)")
    return ET.tostring(root, encoding="unicode")


def render(source, destination, size):
    subprocess.run([
        "inkscape", str(source), "--export-type=png",
        f"--export-filename={destination}",
        f"--export-width={size}", f"--export-height={size}",
    ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if not shutil.which("inkscape"):
    raise SystemExit("Install Inkscape from its official distribution to regenerate these icons.")

# The SVG favicon is the scalable source; keep it directly available at the
# conventional root path without making browser tabs depend on an external use.
shutil.copyfile(SOURCE, PUBLIC / "favicon.svg")
with tempfile.TemporaryDirectory(prefix="arcade-icons-") as directory:
    temporary = Path(directory)
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
