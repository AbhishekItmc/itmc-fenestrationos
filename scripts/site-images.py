#!/usr/bin/env python3
"""Copy the light-theme app screenshots used by the public website into frontend/public/site/ as WebP,
and build the Open Graph preview image (1200x630). Run after `npx playwright test screenshots.spec.ts` (e2e/).

    python3 scripts/site-images.py
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "screenshots"
OUT = ROOT / "frontend" / "public" / "site"
SHOTS = ["editor", "calc-drawer", "cutting", "nesting", "production", "station-phone", "purchasing", "quotes"]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for name in SHOTS:
        im = Image.open(SRC / f"{name}.png").convert("RGB")
        im.save(OUT / f"{name}.webp", "WEBP", quality=86, method=6)
        print(f"{name}.webp  {im.size[0]}x{im.size[1]}  {(OUT / f'{name}.webp').stat().st_size // 1024} KB")
    # Open Graph: the editor screenshot cropped to 1.905:1 and scaled to 1200x630
    ed = Image.open(SRC / "editor.png").convert("RGB")
    w, h = ed.size
    ch = round(w * 630 / 1200)
    top = max(0, (h - ch) // 2 - 40)
    ed.crop((0, top, w, top + ch)).resize((1200, 630), Image.LANCZOS).save(OUT / "og-image.png", optimize=True)
    print("og-image.png 1200x630")


if __name__ == "__main__":
    main()
