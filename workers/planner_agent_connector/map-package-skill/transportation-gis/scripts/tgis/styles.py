"""Engine-neutral styling.

Turns the `style:` blocks of project.yaml and the presets into plain renderer
dictionaries that the QGIS builder, the ArcGIS Pro builder, the web map, the KML
writer and the legend all read. Nothing here imports a GIS engine.

Symbol dictionaries (sizes in points at final page size):
  line     {kind, color, width, dash, casing, casing_width, opacity}
  polygon  {kind, fill, fill_opacity, stroke, stroke_width, stroke_dash, hatch}
  point    {kind, marker, size, fill, fill_opacity, stroke, stroke_width}
Renderers:
  {type: simple, label, symbol}
  {type: categorized, field, classes: [{values, label, symbol}], other}
  {type: graduated, field, classes: [{min, max, label, symbol}], nodata}
"""
from __future__ import annotations

import copy
import math
from pathlib import Path

import yaml

PRESET_FILE = Path(__file__).resolve().parents[2] / "assets" / "presets" / "styles.yaml"
INK = "#1f2d35"

DEFAULTS = {
    "line": {"color": "#44545c", "width": 1.2, "dash": None, "casing": None, "casing_width": None, "opacity": 1.0},
    "polygon": {"fill": "#b8d8cf", "fill_opacity": 1.0, "stroke": "#6b7a82", "stroke_width": 0.5,
                "stroke_dash": None, "hatch": None},
    "point": {"marker": "circle", "size": 5.5, "fill": "#2A4F7C", "fill_opacity": 1.0, "stroke": "#ffffff",
              "stroke_width": 0.7},
}
MARKERS = {"circle", "square", "triangle", "diamond", "star", "cross", "pentagon"}


def presets() -> dict:
    return yaml.safe_load(PRESET_FILE.read_text(encoding="utf-8"))


def symbol(kind: str, *parts) -> dict:
    s = dict(DEFAULTS[kind])
    for p in parts:
        if p:
            s.update(p)
    s["kind"] = kind
    if kind == "line" and s.get("casing") and not s.get("casing_width"):
        s["casing_width"] = s["width"] + 1.0
    if kind == "point" and s["marker"] not in MARKERS:
        raise ValueError(f"Unknown marker {s['marker']!r}. Use one of {sorted(MARKERS)}")
    return s


# ------------------------------------------------------------- classification

def _nice(v, span):
    """Round a break to a readable value for the size of the data range."""
    if span <= 0:
        return v
    mag = 10 ** math.floor(math.log10(span / 4))
    return round(v / mag) * mag


def breaks(values, n, method="quantile", manual=None):
    vals = sorted(v for v in values if v is not None and not (isinstance(v, float) and math.isnan(v)))
    if manual:
        return [float(b) for b in manual]
    if not vals:
        return []
    lo, hi = vals[0], vals[-1]
    if lo == hi:
        return []
    if method == "equal":
        raw = [lo + (hi - lo) * i / n for i in range(1, n)]
    elif method == "quantile":
        raw = [vals[min(len(vals) - 1, int(len(vals) * i / n))] for i in range(1, n)]
    else:
        raise ValueError(f"Unknown classification method {method!r}: use quantile, equal or manual breaks")
    out = []
    for b in raw:
        b = _nice(b, hi - lo)
        if lo < b < hi and b not in out:
            out.append(b)
    return out


def _fmt(v, fmt):
    if fmt:
        return fmt.format(v)
    if abs(v) >= 1000:
        return f"{v:,.0f}"
    if float(v).is_integer():
        return f"{v:.0f}"
    return f"{v:.1f}" if abs(v) >= 10 else f"{v:.2f}".rstrip("0").rstrip(".")


def _pick_ramp(ramp, n):
    """n colours from a 5-step ramp, keeping the light and dark ends."""
    if n >= len(ramp):
        return ramp
    idx = {1: [3], 2: [1, 3], 3: [0, 2, 3], 4: [0, 1, 2, 3]}.get(n) or list(range(n))
    return [ramp[i] for i in idx]


# ------------------------------------------------------------------ renderers

def resolve(style, kind, feats, title=None, lid="layer"):
    """Build the renderer for one thematic layer.

    feats is the layer's feature list; classes with no features are dropped so the
    legend only lists what the map shows, and unmatched values are reported.
    Returns (renderer, warnings).
    """
    P = presets()
    style = copy.deepcopy(style or {})
    warn = []
    base = {}
    if "preset" in style:
        if style["preset"] not in P:
            raise ValueError(f"{lid}: unknown style preset {style['preset']!r}")
        base = copy.deepcopy(P[style["preset"]])
    merged = {**base, **{k: v for k, v in style.items() if k != "preset"}}
    rtype = merged.get("type") or ("categorized" if merged.get("classes") and isinstance(merged["classes"], list) else "simple")
    over = merged.get("override") or {}
    r = {"type": rtype, "title": merged.get("title") or title}

    if rtype == "simple":
        r["label"] = merged.get("label") or title or lid
        r["symbol"] = symbol(kind, merged.get("symbol"), over)
        return r, warn

    field = merged.get("field")
    if not field:
        raise ValueError(f"{lid}: a {rtype} style needs `field`")
    present = [p.get(field) for _, p in feats]
    if feats and field not in feats[0][1]:
        raise ValueError(f"{lid}: style field {field!r} is not in the data. Fields: {sorted(feats[0][1])}")
    r["field"] = field

    if rtype == "categorized":
        have = {v for v in present if v is not None}
        classes, matched = [], set()
        for c in merged["classes"]:
            vals = c.get("values", [c.get("value")])
            hit = [v for v in have if v in vals or str(v) in [str(x) for x in vals]]
            matched.update(hit)
            cs = merged.get("class_symbols") or {}
            tweak = next((cs[k] for k in cs if str(k) == str(c.get("label")) or str(k) in [str(x) for x in vals]), None)
            if hit or merged.get("keep_empty"):
                # Order of precedence: preset class symbol, then `override` (all classes), then `class_symbols` (this class).
                classes.append({"values": sorted(hit, key=str) or list(vals), "label": c.get("label") or str(vals[0]) + (merged.get("label_suffix") or ""),
                                "symbol": symbol(kind, merged.get("symbol"), c.get("symbol"), over, tweak),
                                "count": sum(1 for v in present if v in hit)})
                if merged.get("label_suffix") and c.get("label"):
                    classes[-1]["label"] = c["label"] + merged["label_suffix"]
        rest = have - matched
        if merged.get("show_counts"):
            for c in classes:
                c["label"] += f" ({c['count']:,})"
        r["classes"] = classes
        r["draw_order"] = merged.get("draw_order", "forward")
        r["other"] = None
        nulls = sum(1 for v in present if v is None)
        if rest or nulls:
            n = sum(1 for v in present if v in rest) + nulls
            warn.append(f"{lid}: {n} features have {field} values with no class in the style ({sorted(map(str, rest))[:6]}{' and null' if nulls else ''}); drawn as 'Other'")
            neutral = {"line": {"color": "#8a979e", "width": 1.0}, "polygon": {"fill": "#e3e6e6", "stroke": "#8a979e"},
                       "point": {"marker": "circle", "size": 4, "fill": "#8a979e"}}[kind]
            r["other"] = {"label": merged.get("other_label", "Other or not stated"), "symbol": symbol(kind, neutral), "count": n}
        return r, warn

    if rtype == "graduated":
        vals = [v for v in present if isinstance(v, (int, float)) and not isinstance(v, bool)]
        n = int(merged.get("classes", 4)) if not isinstance(merged.get("classes"), list) else len(merged["classes"])
        bk = breaks(vals, n, merged.get("method", "quantile"), merged.get("breaks"))
        k = len(bk) + 1
        fmt = merged.get("format")
        ramp = merged.get("ramp", "teal")
        colors = _pick_ramp(P["ramps"][ramp] if isinstance(ramp, str) else ramp, k)
        widths, sizes = merged.get("widths"), merged.get("sizes")
        lo = min(vals) if vals else 0.0
        hi = max(vals) if vals else 0.0
        classes = []
        for i in range(k):
            a = bk[i - 1] if i else None
            b = bk[i] if i < len(bk) else None
            if a is None and b is None:
                label = f"{_fmt(lo, fmt)} to {_fmt(hi, fmt)}" if vals and lo != hi else (_fmt(lo, fmt) if vals else "No values")
            elif a is None:
                label = f"Less than {_fmt(b, fmt)}"
            elif b is None:
                label = f"{_fmt(a, fmt)} or more"
            else:
                label = f"{_fmt(a, fmt)} to {_fmt(b, fmt)}"
            sym = {}
            if kind == "polygon":
                sym["fill"] = colors[i]
            elif kind == "line":
                sym["width"] = (widths or [0.9, 1.8, 3.0, 4.6, 6.0])[min(i, len(widths or [0] * 5) - 1)]
                if not widths:
                    sym["color"] = colors[min(i + 1, len(colors) - 1)]
            else:
                sym["size"] = (sizes or [3.6, 6, 9, 13, 17])[min(i, len(sizes or [0] * 5) - 1)]
            classes.append({"min": a, "max": b, "label": label, "symbol": symbol(kind, merged.get("symbol"), sym, over),
                            "count": sum(1 for v in vals if (a is None or v >= a) and (b is None or v < b))})
        if merged.get("show_counts"):
            for c in classes:
                c["label"] += f" ({c['count']:,})"
        r["classes"] = classes
        r["unit_note"] = merged.get("unit_note")
        nulls = len(present) - len(vals)
        r["nodata"] = None
        if nulls:
            nd = {"polygon": {"fill": "#ecebe7", "stroke": "#ffffff", "hatch": {"angle": 45, "spacing": 3.5, "color": "#b9bdbd", "width": 0.4}},
                  "line": {"color": "#b9bdbd", "width": 0.8, "dash": [2, 2]}, "point": {"marker": "cross", "size": 4, "fill": "#8a979e"}}[kind]
            r["nodata"] = {"label": merged.get("nodata_label", "No data"), "symbol": symbol(kind, nd), "count": nulls}
        return r, warn

    raise ValueError(f"{lid}: unknown style type {rtype!r}")


def sql_literal(v):
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("'", "''") + "'"


def class_where(renderer, cls, which="class"):
    """SQL that selects the features of one renderer class (works in OGR, QGIS and ArcGIS)."""
    f = '"' + renderer["field"] + '"'
    if renderer["type"] == "categorized":
        if which == "other":
            vals = [v for c in renderer["classes"] for v in c["values"]]
            return f"({f} IS NULL OR {f} NOT IN ({', '.join(sql_literal(v) for v in vals)}))" if vals else "1=1"
        return f"{f} IN ({', '.join(sql_literal(v) for v in cls['values'])})"
    if which == "nodata":
        return f"{f} IS NULL"
    parts = []
    if cls["min"] is not None:
        parts.append(f"{f} >= {cls['min']!r}")
    if cls["max"] is not None:
        parts.append(f"{f} < {cls['max']!r}")
    return " AND ".join(parts) or f"{f} IS NOT NULL"


# ------------------------------------------------------------------- base map

BASE = {
    "land": "#f5f4ef",
    "water": "#cddde6", "water_edge": "#a9c4d2", "water_label": "#3f7387",
    "parks": "#dde8d0", "green": "#e7ecdd", "campus": "#efe9da", "airport": "#e8e7ea", "buildings": "#e2dfd7",
    "boundary": "#44545c",
}

# (fill, casing, fill width, casing width) by scale tier. None means the class is not drawn.
ROADS = {
    "regional": {
        "freeway": ("#fbe6a8", "#a68b4a", 1.9, 2.9), "highway": ("#fdf3d0", "#b2a274", 1.3, 2.1),
        "major": ("#ffffff", "#a3acaa", 0.9, 1.6), "arterial": ("#ffffff", "#b0b8b5", 0.6, 1.2),
        "ramp": None, "collector": None, "local": None, "service": None,
    },
    "vicinity": {
        "freeway": ("#fbe6a8", "#a68b4a", 2.2, 3.3), "highway": ("#fdf3d0", "#b2a274", 1.8, 2.7),
        "major": ("#ffffff", "#8f9a97", 1.5, 2.4), "arterial": ("#ffffff", "#9aa4a1", 1.3, 2.1),
        "ramp": ("#fbe6a8", "#a68b4a", 0.9, 1.6), "collector": ("#ffffff", "#a8b0ad", 1.0, 1.7),
        "local": ("#cfd4d0", None, 0.6, None), "service": None,
    },
    "corridor": {
        "freeway": ("#fbe6a8", "#a68b4a", 2.6, 3.8), "highway": ("#fdf3d0", "#b2a274", 2.2, 3.2),
        "major": ("#ffffff", "#8f9a97", 1.9, 2.9), "arterial": ("#ffffff", "#98a29f", 1.7, 2.6),
        "ramp": ("#fbe6a8", "#a68b4a", 1.1, 1.9), "collector": ("#ffffff", "#a3acaa", 1.35, 2.15),
        "local": ("#ffffff", "#bcc3bf", 0.95, 1.6), "service": ("#dadeda", None, 0.55, None),
    },
}
ROAD_ORDER = ["service", "local", "ramp", "collector", "arterial", "major", "highway", "freeway"]


def tier(scale: float) -> str:
    return "regional" if scale > 90000 else "vicinity" if scale > 22000 else "corridor"


def base_layers(scale, has_choropleth=False, buildings=False, quiet=False, mask=True, boundary=True, k=1.0):
    """The base map as ordinary resolved layers, bottom to top.

    Returns (below, above): layers that sit under filled thematic polygons and the
    reference layers (roads, rail, mask, boundary) that sit over them.
    `quiet` thins the road network further for maps where the thematic data is dense.
    """
    t = tier(scale)
    wide = 1.25 if scale < 9000 else 1.0
    below, above = [], []

    def lyr(lid, layer, kind, renderer, title, labels=None, where=None, opacity=1.0, file="data/base.gpkg"):
        return {"id": lid, "title": title, "group": "base", "file": file, "layer": layer, "kind": kind,
                "where": where, "renderer": renderer, "labels": labels or [], "opacity": opacity, "legend": False}

    def simple(kind, label, **sym):
        return {"type": "simple", "label": label, "title": None, "symbol": symbol(kind, sym)}

    if not has_choropleth:
        below.append(lyr("base_green", "green", "polygon", simple("polygon", "Woodland", fill=BASE["green"], stroke=None), "Woodland"))
        below.append(lyr("base_parks", "parks", "polygon", simple("polygon", "Park or open space", fill=BASE["parks"], stroke=None), "Parks and open space",
                         labels=[] if t == "regional" else [{"field": "name", "size": 6.6, "weight": "regular", "italic": True, "color": "#4f7245", "halo": 1.0,
                                                           "placement": "polygon", "priority": 2, "wrap": 14, "min_size_mm": 9}]))
        if t == "corridor":
            below.append(lyr("base_campus", "campus", "polygon", simple("polygon", "School or hospital grounds", fill=BASE["campus"], stroke=None), "Campuses"))
        below.append(lyr("base_airport", "airport", "polygon", simple("polygon", "Airport", fill=BASE["airport"], stroke=None), "Airport"))
    below.append(lyr("base_water", "water", "polygon", simple("polygon", "Water", fill=BASE["water"], stroke=BASE["water_edge"], stroke_width=0.3), "Water",
                     labels=[{"field": "name", "size": 7.2, "weight": "regular", "italic": True, "color": BASE["water_label"], "halo": 1.0,
                              "placement": "polygon", "priority": 3, "wrap": 14, "min_size_mm": 10}]))
    below.append(lyr("base_waterways", "waterways", "line",
                     simple("line", "Stream or canal", color=BASE["water_edge"], width=0.7 if t != "regional" else 0.5), "Streams and canals",
                     where="\"type\" = 'river'" if t == "regional" else None,
                     labels=[{"field": "name", "size": 7.0, "weight": "regular", "italic": True, "color": BASE["water_label"], "halo": 1.0,
                              "placement": "curved", "priority": 2, "repeat_in": 4.5}]))
    if buildings and t == "corridor" and not has_choropleth:
        below.append(lyr("base_buildings", "buildings", "polygon", simple("polygon", "Building", fill=BASE["buildings"], stroke=None), "Buildings"))

    if t == "corridor" and not quiet:
        above.append(lyr("base_paths", "paths", "line", simple("line", "Path", color="#b5ad9c", width=0.55, dash=[2.2, 1.6]), "Paths and trails"))

    # Roads: one categorized layer; casings are drawn first across all classes so junctions merge.
    spec = ROADS[t]
    classes = []
    for c in ROAD_ORDER:
        v = spec.get(c)
        if not v or (quiet and c in ("service", "local") and t != "corridor"):
            continue
        fill, casing, fw, cw = v
        classes.append({"values": [c], "label": c.capitalize(), "symbol": symbol("line", {
            "color": fill, "width": fw * wide * k, "casing": casing, "casing_width": (cw * wide * k) if cw else None})})
    drawn = [c["values"][0] for c in classes]
    in_list = ", ".join("'" + c + "'" for c in drawn)
    big = "('freeway', 'highway', 'major', 'arterial')" if t != "corridor" else "('freeway', 'highway', 'major', 'arterial', 'collector')"
    labels = [
        {"field": "shield", "where": "\"shield\" IS NOT NULL AND \"road_class\" IN ('freeway', 'highway', 'major')", "size": 6.6, "weight": "semibold",
         "color": "#33414a", "halo": 0, "placement": "line", "shield": True, "priority": 9, "repeat_in": 5.0},
        {"field": "name", "where": f"\"shield\" IS NULL AND \"road_class\" IN {big}", "size": 7.4 if t == "corridor" else 7.0, "weight": "regular", "color": "#3a474e",
         "halo": 1.1, "placement": "curved", "priority": 7, "repeat_in": 3.6},
    ]
    if t == "corridor":
        labels.append({"field": "name", "where": "\"road_class\" IN ('local')", "size": 6.2, "weight": "regular", "color": "#5d6a70",
                       "halo": 1.0, "placement": "curved", "priority": 3, "repeat_in": 5})
    elif t == "vicinity":
        labels.append({"field": "name", "where": "\"road_class\" IN ('collector')", "size": 6.2, "weight": "regular", "color": "#5d6a70",
                       "halo": 1.0, "placement": "curved", "priority": 3, "repeat_in": 5})
    above.append(lyr("base_roads", "roads", "line",
                     {"type": "categorized", "field": "road_class", "title": "Roads", "classes": classes, "other": None,
                      "symbol_levels": True, "draw_order": "forward"},
                     "Roads", labels=labels, where=f"\"road_class\" IN ({in_list})"))
    above.append(lyr("base_rail", "rail", "line", simple("line", "Railroad", color="#ffffff", width=0.55 * k, dash=[4.5, 4.5], casing="#7d878c", casing_width=1.35 * k), "Railroad"))
    if mask:
        above.append(lyr("base_mask", "study_mask", "polygon", simple("polygon", "Outside study area", fill="#ffffff", fill_opacity=0.42, stroke=None),
                         "Outside study area (dimmed)", file="data/project.gpkg"))
    if boundary:
        above.append(lyr("base_boundary", "study_area", "polygon",
                         simple("polygon", "Study area", fill=None, stroke=BASE["boundary"], stroke_width=0.95 * k, stroke_dash=[6, 2, 1.2, 2]),
                         "Study area boundary", file="data/project.gpkg"))
    # Place names sit on top of everything.
    place_rank = 3 if t == "regional" else 2 if t == "vicinity" else 1
    above.append(lyr("base_places", "places", "point", {"type": "simple", "label": "Place", "title": None,
                                                         "symbol": symbol("point", {"marker": "circle", "size": 0.01, "fill": None, "stroke": None})},
                     "Place names", where=f"\"rank\" >= {place_rank}",
                     labels=[{"field": "name", "where": "\"rank\" >= 4", "size": 10, "weight": "medium", "color": "#33454d", "halo": 1.3, "placement": "point", "priority": 10},
                             {"field": "name", "where": "\"rank\" < 4", "size": 8, "weight": "regular", "color": "#5a6a72", "halo": 1.2, "placement": "point", "priority": 6,
                              "upper": True, "letter_spacing": 0.6}]))
    return below, above


def region_layers():
    """Layers of the locator inset, bottom to top."""
    def simple(kind, label, **sym):
        return {"type": "simple", "label": label, "title": None, "symbol": symbol(kind, sym)}
    f = "data/region.gpkg"
    return [
        {"id": "region_counties", "title": "Counties", "group": "inset", "file": f, "layer": "counties", "kind": "polygon", "where": None,
         "renderer": simple("polygon", "County", fill="#f5f4ef", stroke="#b3bbb8", stroke_width=0.5), "opacity": 1.0, "legend": False,
         "labels": [{"field": "BASENAME", "size": 5.8, "weight": "medium", "color": "#8a969b", "halo": 0.8, "placement": "polygon", "upper": True,
                     "letter_spacing": 0.5, "priority": 2}]},
        {"id": "region_places", "title": "Cities", "group": "inset", "file": f, "layer": "places", "kind": "polygon", "where": None,
         "renderer": simple("polygon", "City", fill="#e6e3da", stroke=None), "opacity": 1.0, "legend": False, "labels": []},
        {"id": "region_roads", "title": "Major roads", "group": "inset", "file": f, "layer": "major_roads", "kind": "line", "where": None,
         "renderer": {"type": "categorized", "field": "road_class", "title": None, "other": None, "symbol_levels": True, "draw_order": "forward", "classes": [
             {"values": ["major"], "label": "Major road", "symbol": symbol("line", {"color": "#c9cfcc", "width": 0.45})},
             {"values": ["highway"], "label": "Highway", "symbol": symbol("line", {"color": "#c9b98a", "width": 0.8})},
             {"values": ["freeway"], "label": "Freeway", "symbol": symbol("line", {"color": "#b89a4f", "width": 1.1})}]},
         "opacity": 1.0, "legend": False,
         "labels": [{"field": "shield", "where": "\"shield\" IS NOT NULL AND \"road_class\" IN ('freeway', 'highway')", "size": 5.6, "weight": "semibold", "color": "#4a565c",
                     "halo": 0, "placement": "line", "shield": True, "priority": 8, "repeat_in": 4.0}]},
        {"id": "region_study_area", "title": "Study area", "group": "inset", "file": f, "layer": "study_area", "kind": "polygon", "where": None,
         "renderer": simple("polygon", "Study area", fill="#E8A51D", fill_opacity=0.85, stroke="#4a3a12", stroke_width=0.6), "opacity": 1.0, "legend": False, "labels": []},
    ]


# --------------------------------------------------------------------- legend

def legend_groups(layers):
    """Legend content for a map from its thematic layers, top layer first.

    Simple layers with no title are gathered into one untitled group; classified
    layers become a titled group each.
    """
    def sw(sym):
        # A pale or unstroked fill needs an outline to read as a swatch on white paper.
        if sym["kind"] == "polygon" and sym.get("fill") and (not sym.get("stroke") or sym["stroke"].lower() in ("#ffffff", "#fff")):
            return {**sym, "stroke": "#9aa4a8", "stroke_width": 0.4, "stroke_dash": None}
        return sym

    groups, loose = [], []
    for l in reversed(layers):
        if not l.get("legend", True):
            continue
        r = l["renderer"]
        if r["type"] == "simple":
            loose.append({"label": l.get("legend_label") or r["label"], "symbol": sw(r["symbol"]), "layer": l["id"]})
        else:
            items = [{"label": c["label"], "symbol": sw(c["symbol"]), "layer": l["id"]} for c in r["classes"]]
            for extra in ("other", "nodata"):
                if r.get(extra):
                    items.append({"label": r[extra]["label"], "symbol": sw(r[extra]["symbol"]), "layer": l["id"]})
            groups.append({"title": l.get("legend_title") or r.get("title") or l["title"], "items": items, "note": r.get("unit_note"), "layer": l["id"]})
    if loose:
        groups.append({"title": None, "items": loose})
    return groups
