"""Page templates.

A template turns a page size, the map's text and its legend content into exact
positions for every element, in inches from the top-left corner of the page. The
QGIS builder and the ArcGIS Pro builder both place elements from these numbers,
so the two projects come out with the same page design.

Text is measured with the bundled Inter files and wrapped here, so both engines
break lines in the same places.
"""
from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

from PIL import ImageFont

FONT_DIR = Path(__file__).resolve().parents[2] / "assets" / "fonts" / "inter-ttf"
WEIGHT_FILE = {"regular": "Inter-Regular.ttf", "medium": "Inter-Medium.ttf", "semibold": "Inter-SemiBold.ttf",
               "bold": "Inter-Bold.ttf", "italic": "Inter-Italic.ttf"}

PAGES = {"letter": (8.5, 11), "legal": (8.5, 14), "tabloid": (11, 17), "arch-c": (18, 24), "arch-d": (24, 36),
         "arch-e": (36, 48), "a4": (8.268, 11.693), "a3": (11.693, 16.535), "slide": (7.5, 13.333)}

INK = "#1f2d35"
GRAY = "#5b6970"
RULE = "#c5ccce"

NICE_SCALES = [600, 1200, 2400, 3600, 4800, 6000, 7200, 9000, 12000, 15000, 18000, 24000, 30000, 36000, 48000,
               60000, 72000, 96000, 120000, 150000, 180000, 240000, 300000, 360000, 480000, 600000, 750000,
               1000000, 1500000, 2000000, 3000000, 5000000]


def page_size(page):
    """'letter-landscape', 'tabloid-portrait', 'figure-6.5x4.5' or [w, h] to (w, h, name)."""
    if isinstance(page, (list, tuple)):
        return float(page[0]), float(page[1]), f"{page[0]}x{page[1]}"
    name = str(page).lower()
    if name.startswith("figure-") or name.startswith("custom-"):
        w, h = name.split("-", 1)[1].split("x")
        return float(w), float(h), name
    base, orient = name, ""
    for suffix in ("-landscape", "-portrait"):
        if name.endswith(suffix):
            base, orient = name[: -len(suffix)], suffix[1:]
    if base not in PAGES:
        raise ValueError(f"Unknown page {page!r}. Use one of {sorted(PAGES)} with -landscape or -portrait, or figure-WxH in inches.")
    a, b = PAGES[base]
    return (b, a, name) if orient == "landscape" else (a, b, name)


@lru_cache(maxsize=None)
def _font(weight, size10):
    return ImageFont.truetype(str(FONT_DIR / WEIGHT_FILE.get(weight, WEIGHT_FILE["regular"])), 100)


def text_width(text, size, weight="regular", letter_spacing=0.0):
    """Width in inches of a single line of text at `size` points."""
    f = _font(weight, 0)
    return (f.getlength(text) * size / 100.0 + letter_spacing * max(len(text) - 1, 0)) / 72.0


def wrap(text, width_in, size, weight="regular", letter_spacing=0.0):
    """Greedy word wrap to a width in inches. Returns a list of lines."""
    lines = []
    for para in str(text).split("\n"):
        cur = ""
        for word in para.split():
            trial = (cur + " " + word).strip()
            if cur and text_width(trial, size, weight, letter_spacing) > width_in:
                lines.append(cur)
                cur = word
            else:
                cur = trial
        lines.append(cur)
    return lines


def fit_extent(bbox, frame_w, frame_h, meters_per_unit, pad=0.07, scale=None, center=None):
    """Extent for a frame (inches) that holds bbox with padding, at a round scale.

    Returns (extent [xmin, ymin, xmax, ymax], scale).
    """
    cx = center[0] if center else (bbox[0] + bbox[2]) / 2
    cy = center[1] if center else (bbox[1] + bbox[3]) / 2
    upi = 0.0254 / meters_per_unit           # CRS units per page inch at 1:1
    if not scale:
        w = (bbox[2] - bbox[0]) * (1 + 2 * pad)
        h = (bbox[3] - bbox[1]) * (1 + 2 * pad)
        need = max(w / (frame_w * upi), h / (frame_h * upi))
        scale = next((s for s in NICE_SCALES if s >= need), need)
    hw, hh = frame_w * upi * scale / 2, frame_h * upi * scale / 2
    return [cx - hw, cy - hh, cx + hw, cy + hh], float(scale)


def scale_text(scale, is_feet):
    if is_feet:
        ft = scale / 12.0
        if ft >= 5280 and (ft / 5280).is_integer():
            return f"1 inch = {ft / 5280:.0f} mile{'s' if ft != 5280 else ''}"
        return f"1 inch = {ft:,.0f} feet"
    return f"1:{scale:,.0f}"


def scalebar(scale, is_feet, target_in=1.5):
    """A two-segment scale bar near target_in inches long. Returns {units, total, length_in}."""
    ground_m = target_in * scale * 0.0254
    if not is_feet:
        opts = [(v, "m", v) for v in (50, 100, 200, 250, 500)] + [(v, "km", v * 1000) for v in (1, 2, 2.5, 5, 10, 20, 25, 50, 100, 200)]
    else:
        opts = [(v, "ft", v * 0.3048006096) for v in (100, 200, 250, 500, 1000, 2000)] + \
               [(v, "mi", v * 1609.344) for v in (0.5, 1, 2, 4, 5, 10, 20, 25, 50, 100)]
    total, unit, m = min(opts, key=lambda o: abs(math.log(o[2] / ground_m)))
    return {"units": unit, "total": total, "segments": 2, "length_in": m / (scale * 0.0254),
            "meters": m, "label": f"{total:g} {'mile' if unit == 'mi' and total == 1 else {'mi': 'miles', 'ft': 'feet', 'm': 'metres', 'km': 'kilometres'}[unit]}"}


# ------------------------------------------------------------------- legend

def legend_metrics(k=1.0):
    return {"font": 7.8 * k, "title_font": 8.0 * k, "sym_w": 0.30 * k, "sym_h": 0.125 * k, "row": 0.185 * k,
            "title_h": 0.20 * k, "group_gap": 0.10 * k, "sym_gap": 0.09 * k, "line": 7.8 * k * 1.22 / 72}


def legend_layout(groups, width, k=1.0, columns=1, col_gap=0.25):
    """Place every legend row. Returns (rows, total height in inches).

    rows are dicts with x, y relative to the legend origin: {type: 'title'|'item'|'note', ...}.
    Long labels are wrapped with a hanging indent, and a group title is never left
    at the bottom of a column without its first item.
    """
    M = legend_metrics(k)
    col_w = (width - col_gap * (columns - 1)) / columns
    label_w = col_w - M["sym_w"] - M["sym_gap"]
    blocks = []   # one block per group: list of (kind, payload, height)
    for g in groups:
        rows = []
        if g.get("title"):
            tl = wrap(g["title"], col_w, M["title_font"], "semibold")
            rows.append(("title", {"lines": tl}, M["title_h"] + (len(tl) - 1) * M["title_font"] * 1.2 / 72))
        for it in g["items"]:
            ll = wrap(it["label"], label_w, M["font"])
            rows.append(("item", {"lines": ll, "symbol": it["symbol"], "label": it["label"]}, max(M["row"], len(ll) * M["line"] + 0.045 * k)))
        if g.get("note"):
            nl = wrap(g["note"], col_w, M["font"] * 0.92)
            rows.append(("note", {"lines": nl}, len(nl) * M["line"] + 0.03))
        blocks.append(rows)
    total = sum(h for b in blocks for _, _, h in b) + M["group_gap"] * max(len(blocks) - 1, 0)
    target = total / columns if columns > 1 else float("inf")
    out, col, y, tallest = [], 0, 0.0, 0.0
    for bi, rows in enumerate(blocks):
        bh = sum(h for _, _, h in rows)
        if columns > 1 and col < columns - 1 and y > 0 and y + bh * 0.6 > target * 1.08:
            col += 1
            y = 0.0
        elif y > 0:
            y += M["group_gap"]
        for kind, payload, h in rows:
            out.append({"type": kind, "x": col * (col_w + col_gap), "y": y, "h": h, "w": col_w, **payload})
            y += h
        tallest = max(tallest, y)
    return out, tallest


# ----------------------------------------------------------------- templates

def _corner_xy(frame, corner, w, h, inset):
    """Top-left of a w by h box tucked into a corner of the frame ('tl', 'tr', 'bl', 'br')."""
    x = frame["x"] + inset if corner.endswith("l") else frame["x"] + frame["w"] - w - inset
    y = frame["y"] + inset if corner.startswith("t") else frame["y"] + frame["h"] - h - inset
    return x, y


def _text(tid, text, x, y, w, size, weight="regular", color=INK, align="left", upper=False, letter_spacing=0.0,
          italic=False, max_lines=None, valign="top"):
    t = str(text).upper() if upper else str(text)
    lines = wrap(t, w, size, weight, letter_spacing)
    cut = False
    if max_lines and len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(" ,;.") + "..."
        cut = True
    h = len(lines) * size * 1.2 / 72
    return {"type": "text", "id": tid, "text": "\n".join(lines), "x": x, "y": y, "w": w, "h": h, "size": size, "weight": weight,
            "color": color, "align": align, "valign": valign, "italic": italic, "letter_spacing": letter_spacing, "lines": len(lines),
            "truncated": cut}


def type_k(page, type_scale=None):
    """Scale factor for type and symbols: 1.0 on a letter page, larger on larger pages."""
    W, H, pname = page_size(page)
    short = min(W, H)
    if pname.startswith("figure-"):
        k = 0.92
    elif short >= 18:
        k = short / 8.5             # a wall poster: everything grows in proportion to the page (not the gentler 0.85 power)
    else:
        k = max(1.0, (short / 8.5) ** 0.85)
    return k * float(type_scale or 1.0)


FURN_W = 2.95     # inches (times k) reserved for the north arrow and scale bar when they sit under the map


def build(template, page, texts, legend_groups, brand=None, inset=True, legend_columns=None, corners=None, type_scale=None):
    """Compute the page design. texts: figure, title, subtitle, sources, notes, client, date_line, projection, status.

    On sidebar and banner pages the north arrow and scale bar sit under the map frame, beside the
    source line, so they can never cover mapped data. On a report figure, which has no margin to
    spare, they sit on an opaque panel in the emptiest corner of the map.
    """
    W, H, pname = page_size(page)
    brand = brand or {}
    corners = {"furniture": "bl", "inset": "tr", "legend": "br", **(corners or {})}
    accent = brand.get("accent", "#1f5673")
    if template == "auto":
        template = "figure" if pname.startswith("figure-") else ("sidebar" if W > H else "banner")
    k = type_k(page, type_scale)
    m = 0.4 * min(k, 2.2)
    els = []
    out = {"template": template, "page": {"w": W, "h": H, "name": pname}, "k": round(k, 3), "accent": accent}
    status = (texts.get("status") or "").strip()
    draft = status.capitalize() if status and status.lower() != "final" else ""
    date_line = ", ".join(v for v in (draft, texts.get("date_line", "")) if v)
    fs = 6.6 * k                      # footer type
    furn = None

    if template == "sidebar":
        sb = min(2.7 * k, W * 0.30)
        gap = 0.2 * k
        x0 = W - m - sb
        fw = W - 2 * m - sb - gap
        src = _text("sources", texts.get("sources", ""), m + FURN_W * k, 0, fw - FURN_W * k, fs, color=GRAY, max_lines=5)
        proj = _text("projection", texts.get("projection", ""), x0, 0, sb, fs, color=GRAY, max_lines=3)
        foot_h = max(src["h"], proj["h"], 0.47 * k)
        frame = {"x": m, "y": m, "w": fw, "h": H - 2 * m - foot_h - 0.1 * k}
        fy = frame["y"] + frame["h"] + 0.1 * k
        src["y"] = proj["y"] = fy
        els += [src, proj]
        furn = {"x": m, "y": fy, "panel": False}
        y = m
        els.append({"type": "rect", "id": "accent_bar", "x": x0, "y": y, "w": sb, "h": 0.05 * k, "fill": accent, "stroke": None})
        y += 0.05 * k + 0.13 * k
        if texts.get("figure"):
            t = _text("figure_label", texts["figure"], x0, y, sb, 7.6 * k, "semibold", accent, upper=True, letter_spacing=0.7 * k)
            els.append(t); y += t["h"] + 0.05 * k
        t = _text("title", texts["title"], x0, y, sb, 16.5 * k, "semibold", INK)
        els.append(t); y += t["h"] + 0.07 * k
        if texts.get("subtitle"):
            t = _text("subtitle", texts["subtitle"], x0, y, sb, 8.8 * k, "regular", GRAY)
            els.append(t); y += t["h"] + 0.06 * k
        y += 0.07 * k
        els.append({"type": "line", "id": "rule_top", "x1": x0, "y1": y, "x2": x0 + sb, "y2": y, "color": RULE, "width": 0.6})
        y += 0.15 * k
        # Bottom stack, built upward from the bottom of the map frame.
        yb = frame["y"] + frame["h"]
        t = _text("date_line", date_line, x0, 0, sb, 7.2 * k, "regular", GRAY)
        yb -= t["h"]; t["y"] = yb; els.append(t)
        t = _text("client", texts.get("client", ""), x0, 0, sb, 8.6 * k, "semibold", INK)
        yb -= t["h"] + 0.02 * k; t["y"] = yb; els.append(t)
        yb -= 0.12 * k
        els.append({"type": "line", "id": "rule_bottom", "x1": x0, "y1": yb, "x2": x0 + sb, "y2": yb, "color": RULE, "width": 0.6})
        yb -= 0.14 * k
        if inset:
            ih = min(1.9 * k, sb * 0.7)
            yb -= ih
            out["inset"] = {"x": x0, "y": yb, "w": sb, "h": ih}
            t = _text("inset_caption", texts.get("inset_caption") or "Location", x0, 0, sb, 6.6 * k, "semibold", GRAY, upper=True, letter_spacing=0.6 * k)
            yb -= t["h"] + 0.05 * k; t["y"] = yb; els.append(t)
            yb -= 0.14 * k
        if texts.get("notes"):
            t = _text("notes", texts["notes"], x0, 0, sb, 7.2 * k, "regular", GRAY, max_lines=14)
            yb -= t["h"]; t["y"] = yb; els.append(t)
            yb -= 0.14 * k
        rows, lh = legend_layout(legend_groups, sb, k, 1)
        out["legend"] = {"mode": "sidebar", "x": x0, "y": y, "w": sb, "h": lh, "available": yb - y, "columns": 1, "rows": rows, "panel": False}

    elif template == "banner":
        y = m
        els.append({"type": "rect", "id": "accent_bar", "x": m, "y": y, "w": W - 2 * m, "h": 0.05 * k, "fill": accent, "stroke": None})
        y += 0.05 * k + 0.12 * k
        right_w = min(2.6 * k, (W - 2 * m) * 0.34)
        left_w = W - 2 * m - right_w - 0.25 * k
        t = _text("client", texts.get("client", ""), W - m - right_w, y, right_w, 8.6 * k, "semibold", INK, align="right")
        els.append(t)
        els.append(_text("date_line", date_line, W - m - right_w, y + t["h"] + 0.02 * k, right_w, 7.2 * k, "regular", GRAY, align="right"))
        if texts.get("figure"):
            t = _text("figure_label", texts["figure"], m, y, left_w, 7.6 * k, "semibold", accent, upper=True, letter_spacing=0.7 * k)
            els.append(t); y += t["h"] + 0.04 * k
        t = _text("title", texts["title"], m, y, left_w, 16.5 * k, "semibold", INK, max_lines=2)
        els.append(t); y += t["h"] + 0.05 * k
        if texts.get("subtitle"):
            t = _text("subtitle", texts["subtitle"], m, y, left_w, 8.8 * k, "regular", GRAY, max_lines=3)
            els.append(t); y += t["h"]
        y += 0.12 * k
        cols = legend_columns or max(1, min(4, int((W - 2 * m) // (2.35 * k))))
        n_items = sum(len(g["items"]) for g in legend_groups)
        cols = max(1, min(cols, n_items))
        rows, lh = legend_layout(legend_groups, W - 2 * m, k, cols)
        full = W - 2 * m
        pw = full * 0.27
        src = _text("sources", texts.get("sources", ""), m + FURN_W * k, 0, full - FURN_W * k - pw - 0.2 * k, fs, color=GRAY, max_lines=5)
        proj = _text("projection", texts.get("projection", ""), W - m - pw, 0, pw, fs, color=GRAY, align="right", max_lines=4)
        notes = _text("notes", texts["notes"], m, 0, full, 7.2 * k, "regular", GRAY, max_lines=6) if texts.get("notes") else None
        foot_h = max(src["h"], proj["h"], 0.47 * k)
        bottom = H - m - foot_h
        src["y"] = proj["y"] = bottom
        els += [src, proj]
        furn = {"x": m, "y": bottom, "panel": False}
        bottom -= 0.1 * k
        els.append({"type": "line", "id": "rule_bottom", "x1": m, "y1": bottom, "x2": W - m, "y2": bottom, "color": RULE, "width": 0.6})
        bottom -= 0.12 * k
        if notes:
            bottom -= notes["h"]; notes["y"] = bottom; els.append(notes); bottom -= 0.1 * k
        bottom -= lh
        out["legend"] = {"mode": "band", "x": m, "y": bottom, "w": full, "h": lh, "available": lh, "columns": cols, "rows": rows, "panel": False}
        bottom -= 0.14 * k
        frame = {"x": m, "y": y, "w": full, "h": bottom - y}
        if inset:
            iw, ih = 1.75 * k, 1.3 * k
            ix, iy = _corner_xy(frame, corners["inset"], iw, ih, 0.1 * k)
            out["inset"] = {"x": ix, "y": iy, "w": iw, "h": ih, "overlay": True, "corner": corners["inset"]}

    elif template == "figure":
        # A figure to place in a report or application. The document supplies the figure number and
        # caption, so there is no title block: map on top, legend in columns under it, then one footer
        # row with the north arrow, scale bar, draft status, any note and the sources. Nothing overlays the map.
        foot = " ".join(v for v in ((date_line + ".") if draft else "", texts.get("notes", ""), texts.get("sources", "")) if v)
        fx = FURN_W * k
        src = _text("sources", foot, fx, 0, W - fx - 0.02, 5.8, color=GRAY, max_lines=7)
        foot_h = max(src["h"], 0.47 * k)
        cols = legend_columns or max(1, min(3, int(W // 2.1)))
        n_items = sum(len(g["items"]) for g in legend_groups)
        cols = max(1, min(cols, n_items))
        rows, lh = legend_layout(legend_groups, W - 0.1, k, cols)
        fy = H - foot_h
        src["y"] = fy
        els.append(src)
        furn = {"x": 0.02, "y": fy + 0.02, "panel": False}
        ly = fy - 0.09 - lh
        out["legend"] = {"mode": "band", "x": 0.05, "y": ly, "w": W - 0.1, "h": lh, "available": lh, "columns": cols, "rows": rows, "panel": False, "k": k}
        frame = {"x": 0.0, "y": 0.0, "w": W, "h": ly - 0.09}
        if frame["h"] < H * 0.45:
            out["cramped"] = True     # legend and footer leave less than half the page for the map
    else:
        raise ValueError(f"Unknown template {template!r}: use auto, sidebar, banner or figure")

    out["frame"] = {kk: round(v, 4) for kk, v in frame.items()}
    out["floating"] = {}
    # On the map face, top-left: a DRAFT tag on report figures (they have no title block to carry it)
    # and any `stamp:` text, used for placeholders such as "[PROJECT LIMITS TO BE ADDED]".
    tags = []
    if template == "figure" and draft:
        tags.append(("draft_tag", draft.upper(), "semibold", 6.6 * k, 0.5))
    if texts.get("stamp"):
        tags.append(("stamp", texts["stamp"], "medium", 7.2 * k, 0.0))
    ty = frame["y"] + 0.08 * k
    for tid, txt, wt, size, ls in tags:
        tw = min(frame["w"] * 0.6, max(text_width(l_, size, wt, ls) for l_ in wrap(txt, frame["w"] * 0.55, size, wt, ls)) + 0.02)
        t = _text(tid, txt, frame["x"] + 0.14 * k, ty + 0.04 * k, tw, size, wt, INK, letter_spacing=ls)
        els.append({"type": "rect", "id": tid + "_box", "x": frame["x"] + 0.08 * k, "y": ty, "w": tw + 0.12 * k, "h": t["h"] + 0.08 * k,
                    "fill": "#ffffff", "stroke": "#8e9a9e", "stroke_width": 0.5})
        els.append(t)
        ty += t["h"] + 0.12 * k
    if furn:
        out["furniture"] = {**furn, "k": round(k, 3)}
    else:
        fc = corners["furniture"]
        out["furniture"] = {"corner": fc, "k": round(k, 3), "panel": True,
                            "x": frame["x"] + 0.08 * k if fc.endswith("l") else frame["x"] + frame["w"] - 0.08 * k,
                            "y": frame["y"] + frame["h"] - 0.08 * k if fc.startswith("b") else frame["y"] + 0.08 * k}
        out["floating"]["furniture"] = (2.45 * k, 0.6 * k)
    # Sizes of the things that float over the map, so the caller can find the emptiest corner for each.
    if out.get("inset", {}).get("overlay"):
        out["floating"]["inset"] = (out["inset"]["w"] + 0.1 * k, out["inset"]["h"] + 0.1 * k)
    if out["legend"]["mode"] == "overlay":
        out["floating"]["legend"] = (out["legend"]["w"] + 0.3, out["legend"]["h"] + 0.3)
    out["elements"] = els
    out["truncated"] = [e["id"] for e in els if e.get("truncated")]
    out["k"] = round(k, 3)
    return out
