"""Quick check: build a simple PNG, call animate() for a dog (limb) and a tree (sway)."""
from __future__ import annotations

import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

os.makedirs(os.path.join(ROOT, "output_api"), exist_ok=True)

from animation_engine.pipeline import animate  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402


def main() -> None:
    out = os.path.join(ROOT, "output_api", "_smoke_dog.png")
    img = Image.new("RGB", (256, 256), (255, 255, 255))
    d = ImageDraw.Draw(img)
    d.line((60, 200, 200, 200), fill=0, width=4)  # ground
    d.line((130, 200, 130, 100), fill=0, width=3)  # body
    d.ellipse((90, 50, 170, 120), outline=0, width=2)  # head
    d.line((100, 180, 100, 210), fill=0, width=2)  # leg
    d.line((160, 180, 160, 210), fill=0, width=2)
    img.save(out)
    g1 = os.path.join(ROOT, "output_api", "_smoke_dog.gif")
    animate(out, {"category": "dog"}, g1)
    t = os.path.join(ROOT, "output_api", "_smoke_tree.png")
    timg = Image.new("RGB", (256, 256), (255, 255, 255))
    td = ImageDraw.Draw(timg)
    td.line((120, 220, 120, 40), fill=0, width=6)  # trunk
    timg.save(t)
    g2 = os.path.join(ROOT, "output_api", "_smoke_tree.gif")
    animate(t, {"category": "tree"}, g2)
    print("OK", g1, g2, "bytes", os.path.getsize(g1), os.path.getsize(g2))


if __name__ == "__main__":
    main()
