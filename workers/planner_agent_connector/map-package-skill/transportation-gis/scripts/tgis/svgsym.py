"""Symbol dictionaries to small SVG and PNG swatches (web legend, KML icons, documents)."""
from __future__ import annotations

import math


def marker_points(shape, r):
    if shape == "square":
        pts = [(-.88, -.88), (-.88, .88), (.88, .88), (.88, -.88)]
    elif shape == "triangle":
        pts = [(0, -1), (1, .84), (-1, .84)]
    elif shape == "diamond":
        pts = [(0, -1), (.84, 0), (0, 1), (-.84, 0)]
    elif shape == "star":
        pts = [(math.cos(-math.pi / 2 + i * math.pi / 5) * (1 if i % 2 == 0 else .42), math.sin(-math.pi / 2 + i * math.pi / 5) * (1 if i % 2 == 0 else .42)) for i in range(10)]
    elif shape == "pentagon":
        pts = [(math.cos(-math.pi / 2 + i * 2 * math.pi / 5), math.sin(-math.pi / 2 + i * 2 * math.pi / 5)) for i in range(5)]
    elif shape == "cross":
        a, b = 1, .32
        pts = [(-b, -a), (b, -a), (b, -b), (a, -b), (a, b), (b, b), (b, a), (-b, a), (-b, b), (-a, b), (-a, -b), (-b, -b)]
    else:
        return None
    return [(x * r, y * r) for x, y in pts]


def marker_svg(s, scale=1.0, cx=0.0, cy=0.0):
    """SVG element for a point symbol centred at cx, cy. Sizes are points times scale."""
    r = s.get("size", 5) * scale / 2
    fill = s.get("fill") or "none"
    stroke = s.get("stroke") or "none"
    sw = (s.get("stroke_width") or 0) * scale
    op = s.get("fill_opacity", 1.0)
    pts = marker_points(s.get("marker", "circle"), r)
    common = f'fill="{fill}" fill-opacity="{op}" stroke="{stroke}" stroke-width="{sw:.2f}" stroke-linejoin="round"'
    if pts is None:
        return f'<circle cx="{cx:.2f}" cy="{cy:.2f}" r="{r:.2f}" {common}/>'
    d = " ".join(f"{cx + x:.2f},{cy + y:.2f}" for x, y in pts)
    return f'<polygon points="{d}" {common}/>'


def swatch(s, w=34, h=16, scale=1.25):
    """A legend swatch as a complete inline <svg>."""
    body = ""
    if s["kind"] == "line":
        y = h / 2
        if s.get("casing"):
            body += f'<line x1="2" y1="{y}" x2="{w - 2}" y2="{y}" stroke="{s["casing"]}" stroke-width="{s["casing_width"] * scale:.2f}" stroke-linecap="round"/>'
        dash = f' stroke-dasharray="{" ".join(f"{v * scale:.1f}" for v in s["dash"])}"' if s.get("dash") else ' stroke-linecap="round"'
        body += f'<line x1="2" y1="{y}" x2="{w - 2}" y2="{y}" stroke="{s["color"]}" stroke-width="{s["width"] * scale:.2f}"{dash}/>'
    elif s["kind"] == "polygon":
        fill = s.get("fill") or "none"
        stroke = s.get("stroke") or "none"
        dash = f' stroke-dasharray="{" ".join(f"{v * scale * 0.6:.1f}" for v in s["stroke_dash"])}"' if s.get("stroke_dash") else ""
        pid = f"h{abs(hash(str(s))) % 10 ** 8}"
        if s.get("hatch"):
            hh = s["hatch"]
            sp = hh.get("spacing", 4) * scale
            body += (f'<defs><pattern id="{pid}" width="{sp:.1f}" height="{sp:.1f}" patternUnits="userSpaceOnUse" patternTransform="rotate({-hh.get("angle", 45)})">'
                     f'<line x1="0" y1="0" x2="{sp:.1f}" y2="0" stroke="{hh.get("color", "#333")}" stroke-width="{hh.get("width", 0.5) * scale:.2f}"/></pattern></defs>')
        body += f'<rect x="2" y="2.5" width="{w - 4}" height="{h - 5}" fill="{fill}" fill-opacity="{s.get("fill_opacity", 1.0)}" stroke="none"/>'
        if s.get("hatch"):
            body += f'<rect x="2" y="2.5" width="{w - 4}" height="{h - 5}" fill="url(#{pid})"/>'
        body += f'<rect x="2" y="2.5" width="{w - 4}" height="{h - 5}" fill="none" stroke="{stroke}" stroke-width="{(s.get("stroke_width") or 0) * scale:.2f}"{dash}/>'
    else:
        body += marker_svg(s, scale, w / 2, h / 2)
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" aria-hidden="true">{body}</svg>'


def marker_png(s, path, px=64):
    """Raster icon for KML, drawn with Pillow at 4x and reduced for clean edges."""
    from PIL import Image, ImageDraw

    S = px * 4
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = S * 0.40
    c = S / 2

    def rgba(v, a=1.0):
        if not v:
            return None
        v = v.lstrip("#")
        return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4)) + (int(255 * a),)

    fill = rgba(s.get("fill"), s.get("fill_opacity", 1.0))
    stroke = rgba(s.get("stroke"))
    sw = max(1, int(round((s.get("stroke_width") or 0) / max(s.get("size", 5), 1) * 2 * r))) if stroke else 0
    pts = marker_points(s.get("marker", "circle"), r)
    if pts is None:
        d.ellipse([c - r, c - r, c + r, c + r], fill=fill, outline=stroke, width=sw)
    else:
        poly = [(c + x, c + y) for x, y in pts]
        d.polygon(poly, fill=fill)
        if stroke:
            d.line(poly + [poly[0], poly[1]], fill=stroke, width=sw, joint="curve")
    img.resize((px, px), Image.LANCZOS).save(path)
