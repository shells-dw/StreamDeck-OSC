"""
Generates the plugin's icon set.

The mark
--------
A forward slash with transmission arcs. Every OSC address begins with '/', so
the slash is the one glyph that belongs to this subject and to nothing else;
the arcs read as "sent", which is all this plugin does. No lettering: it would
be unreadable at 20 px, and Stream Deck already prints the plugin name beside
the icon.

Two builds of the same geometry:

* Monochrome, white on transparent, for the actions list. One arc only — two
  merge into a smudge once the renderer is down to twenty pixels.
* Colour, for the key and the marketplace tile, where there is room for two
  arcs and the signal can visibly fade as it travels.

Palette is amber on deep indigo, borrowed from the backlighting of audio
hardware rather than from anything screen-native.

Run with: python3 generate.py
"""

from pathlib import Path

import cairosvg

OUT = Path(__file__).resolve().parent.parent / "de.shells.osc.sdPlugin" / "imgs"
SRC = Path(__file__).resolve().parent

# Palette ------------------------------------------------------------------
INK_TOP = "#2A2A52"  # raised corner of the field
INK_BOTTOM = "#0E0E20"  # deep indigo ground
AMBER = "#FFC24B"  # the slash: the signal at its source
AMBER_LIGHT = "#FFD782"
PERIWINKLE = "#8A8AE0"  # the signal further out, cooling as it travels

# Geometry -----------------------------------------------------------------
# Drawn on a 48-unit grid, then centred as a unit so one source scales cleanly
# from a 20 px list icon to a 512 px tile.
SLASH = '<path d="M 16 41 L 27 7 L 34 7 L 23 41 Z"/>'

ARC_NEAR = '<path d="M 33 18 A 9 9 0 0 1 33 30" fill="none" stroke-width="4" stroke-linecap="round"/>'
ARC_FAR = '<path d="M 39 12.5 A 16 16 0 0 1 39 35.5" fill="none" stroke-width="4" stroke-linecap="round"/>'
ARC_SOLO = '<path d="M 34 15 A 13 13 0 0 1 34 33" fill="none" stroke-width="4.6" stroke-linecap="round"/>'


def centred(body: str, scale: float, pivot: float = 27.0) -> str:
    return f'<g transform="translate(24 24) scale({scale}) translate({-pivot} -24)">{body}</g>'


def mono() -> str:
    """White on transparent, as Elgato requires for list iconography."""
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">'
        f'<g fill="#FFFFFF" stroke="#FFFFFF">{centred(SLASH + ARC_SOLO, 1.02)}</g>'
        "</svg>"
    )


def colour(radius: float) -> str:
    """Full-bleed field with the mark in amber and the arcs cooling outward."""
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <defs>
    <linearGradient id="field" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{INK_TOP}"/>
      <stop offset="1" stop-color="{INK_BOTTOM}"/>
    </linearGradient>
    <linearGradient id="stroke" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{AMBER_LIGHT}"/>
      <stop offset="1" stop-color="{AMBER}"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="48" height="48" rx="{radius}" ry="{radius}" fill="url(#field)"/>
  {centred(
      f'<g fill="url(#stroke)" stroke="url(#stroke)">{SLASH}</g>'
      f'<g stroke="{AMBER}" opacity="0.92">{ARC_NEAR}</g>'
      f'<g stroke="{PERIWINKLE}" opacity="0.75">{ARC_FAR}</g>',
      0.86,
  )}
</svg>"""


def write(svg: str, name: str, sizes: tuple[int, ...]) -> None:
    path = SRC / f"{name}.svg"
    path.write_text(svg)
    for size, suffix in zip(sizes, ("", "@2x")):
        target = OUT / f"{name}{suffix}.png"
        cairosvg.svg2png(url=str(path), write_to=str(target), output_width=size, output_height=size)
        print(f"  {target.name:28} {size}x{size}")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)

    print("monochrome (white on transparent):")
    # Action icon: 20 and 40. Category icon: 28 and 56.
    write(mono(), "icon", (20, 40))
    write(mono(), "categoryIcon", (28, 56))

    print("colour:")
    # Key image: 72 and 144. Stream Deck rounds the corners itself, so the
    # radius here is only a slight softening.
    write(colour(6), "pluginAction", (72, 144))
    # Marketplace and preferences tile: 256 and 512, with a fuller radius.
    write(colour(10), "pluginIcon", (256, 512))
