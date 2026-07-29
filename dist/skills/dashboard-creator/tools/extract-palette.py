#!/usr/bin/env python3
"""
Sample a color palette from a reference image.

Usage:
    python3 extract-palette.py <image_path> [--out palette.json]

Output is a JSON object with named role keys the dashboard-creator
skill drops directly into CSS variables:

    {
      "accent":        "#f8c094",
      "accent_strong": "#ec9f78",
      "ink":           "#666666",
      "ink_strong":    "#1a1a1a",
      "ink_muted":     "#9a9a9a",
      "bg":            "#f7f5f2",
      "frame":         "#ffffff",
      "card":          "#ffffff"
    }

Heuristic palette assignment:
- The brightest, most saturated warm color → accent (the highlight).
- A slightly darker, more saturated version of accent → accent_strong.
- The darkest grayscale-ish color → ink_strong.
- A mid-gray → ink, with a lighter mid-gray → ink_muted.
- The dominant near-white → bg (canvas background).
- frame and card default to pure white unless the image is dark.

Dependencies: Pillow (pip install pillow). scikit-learn would give
prettier clusters but is heavyweight for a v1 tool; we use a simple
quantize-then-bucket approach instead.
"""

import argparse
import colorsys
import json
import sys
from collections import Counter
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("error: Pillow not installed. Run: pip install pillow", file=sys.stderr)
    sys.exit(1)


def to_hex(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def saturation(rgb):
    r, g, b = [c / 255.0 for c in rgb]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return s


def lightness(rgb):
    r, g, b = [c / 255.0 for c in rgb]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return l


def hue(rgb):
    r, g, b = [c / 255.0 for c in rgb]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    return h


def is_warm(rgb):
    h = hue(rgb)
    # Reds, oranges, yellows: 0..0.18 or 0.95..1.0
    return h < 0.18 or h > 0.95


def darken(rgb, amount=0.15):
    r, g, b = [c / 255.0 for c in rgb]
    h, l, s = colorsys.rgb_to_hls(r, g, b)
    l = max(0.0, l - amount)
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return (int(r * 255), int(g * 255), int(b * 255))


def extract(image_path, n_colors=24):
    img = Image.open(image_path).convert("RGB")
    img.thumbnail((400, 400))
    quantized = img.convert("P", palette=Image.ADAPTIVE, colors=n_colors)
    palette = quantized.getpalette()
    counts = Counter(quantized.getdata())
    # Build (rgb, count) tuples for non-trivial colors.
    swatches = []
    for idx, count in counts.most_common():
        rgb = tuple(palette[idx * 3:idx * 3 + 3])
        swatches.append((rgb, count))
    return swatches


def assign_roles(swatches):
    # Filter out near-pure-white and near-pure-black noise.
    body = [s for s in swatches if 0.05 < lightness(s[0]) < 0.95]
    if not body:
        body = swatches

    # accent: brightest warm color with reasonable saturation.
    warm = [s for s in body if is_warm(s[0]) and saturation(s[0]) > 0.25]
    if warm:
        warm.sort(key=lambda s: -saturation(s[0]))
        accent = warm[0][0]
    else:
        # fallback: most-saturated color of any hue.
        body_by_sat = sorted(body, key=lambda s: -saturation(s[0]))
        accent = body_by_sat[0][0]

    accent_strong = darken(accent, 0.10)

    # ink_strong: darkest low-saturation color.
    grays = [s for s in body if saturation(s[0]) < 0.20]
    grays.sort(key=lambda s: lightness(s[0]))
    if grays:
        ink_strong = grays[0][0]
        ink = grays[len(grays) // 2][0] if len(grays) >= 3 else grays[-1][0]
        ink_muted = grays[-1][0]
    else:
        ink_strong = (26, 26, 26)
        ink = (102, 102, 102)
        ink_muted = (154, 154, 154)

    # bg: brightest near-white in the original swatches.
    lights = [s for s in swatches if lightness(s[0]) > 0.92]
    if lights:
        lights.sort(key=lambda s: -s[1])
        bg = lights[0][0]
    else:
        bg = (247, 245, 242)

    return {
        "accent": to_hex(accent),
        "accent_strong": to_hex(accent_strong),
        "ink": to_hex(ink),
        "ink_strong": to_hex(ink_strong),
        "ink_muted": to_hex(ink_muted),
        "bg": to_hex(bg),
        "frame": "#ffffff",
        "card": "#ffffff",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", help="Path to the reference image")
    parser.add_argument("--out", help="Write JSON to file (default: stdout)")
    args = parser.parse_args()

    path = Path(args.image)
    if not path.exists():
        print(f"error: image not found: {path}", file=sys.stderr)
        sys.exit(1)

    swatches = extract(path)
    palette = assign_roles(swatches)
    out = json.dumps(palette, indent=2)
    if args.out:
        Path(args.out).write_text(out + "\n")
    else:
        print(out)


if __name__ == "__main__":
    main()
