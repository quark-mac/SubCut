"""Creation-time colors, mirrored in frontend/src/speakerColors.ts; never recolor on load."""
import colorsys
import json
import math
from pathlib import Path

_palette = json.loads((Path(__file__).resolve().parents[1] / 'speaker_palette.json').read_text(encoding='utf-8'))
SPECIAL_COLORS = _palette['special']


def linear_rgb(color):
    rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]


def oklab(color):
    r, g, b = linear_rgb(color)
    l = (.4122214708 * r + .5363325363 * g + .0514459929 * b) ** (1 / 3)
    m = (.2119034982 * r + .6806995451 * g + .1073969566 * b) ** (1 / 3)
    s = (.0883024619 * r + .2817188376 * g + .6299787005 * b) ** (1 / 3)
    return (.2104542553 * l + .793617785 * m - .0040720468 * s,
            1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
            .0259040371 * l + .7827717662 * m - .808675766 * s)


def next_color(occupied):
    used = {c.lower() for c in occupied} | set(SPECIAL_COLORS.values())
    labs = [oklab(c) for c in sorted(used)]

    def score(c):
        lab = oklab(c)
        return min(sum((a - b) ** 2 for a, b in zip(lab, old)) for old in labs)

    candidates = [c for c in _palette['candidates'] if c not in used]
    best = max(candidates, key=score) if candidates else None
    if best is not None and score(best) >= .01:
        return best
    # Golden-angle hues + alternating lightness/saturation extend the palette.
    # Skip occupied RGBs rather than wrapping back to a fixed list.
    i, generated = 0, 0
    while generated < 72:
        rgb = colorsys.hls_to_rgb((i * .618033988749895) % 1, (.62, .74, .82)[i % 3], (.65, .85)[i % 2])
        c = '#' + ''.join(f'{math.floor(v * 255 + .5):02x}' for v in rgb)
        i += 1
        luminance = sum(v * weight for v, weight in zip(linear_rgb(c), (.2126, .7152, .0722)))
        if c not in used and c not in candidates and luminance >= .30:
            candidates.append(c)
            generated += 1
    return max(candidates, key=score)
