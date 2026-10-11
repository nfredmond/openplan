"""project.yaml to spec/map_package.json.

The package spec is the contract. The QGIS builder, the ArcGIS Pro builder, the web
map, the KML writer and the documents all read it and nothing else, so a map
means the same thing in every output.
"""
from __future__ import annotations

import copy
import datetime
import json
import math
from pathlib import Path

import yaml
from osgeo import ogr

from . import data as datamod
from . import layout, styles, vec

SCHEMA = 1
LABEL_DEFAULTS = {"size": 7.2, "weight": "regular", "italic": False, "color": "#1f2d35", "halo": 1.1, "halo_color": "#ffffff",
                  "priority": 6, "upper": False, "letter_spacing": 0.0, "shield": False, "where": None, "repeat_in": 6.0,
                  "wrap": None, "min_size_mm": None}


def load_yaml(project_dir):
    p = Path(project_dir) / "project.yaml"
    if not p.exists():
        raise FileNotFoundError(f"{p} not found. Run `tgis.py init <dir>` to create one.")
    spec = yaml.safe_load(p.read_text(encoding="utf-8"))
    for key in ("project", "maps"):
        if key not in spec:
            raise ValueError(f"project.yaml is missing the `{key}` section")
    return spec


def _date_line(d):
    if isinstance(d, (datetime.date, datetime.datetime)):
        return d.strftime("%B %Y")
    try:
        return datetime.date.fromisoformat(str(d)).strftime("%B %Y")
    except ValueError:
        return str(d)


def _label(lab, kind):
    if not lab:
        return []
    out = []
    for l in (lab if isinstance(lab, list) else [lab]):
        l = {"field": l} if isinstance(l, str) else dict(l)
        d = dict(LABEL_DEFAULTS)
        d["placement"] = {"line": "curved", "point": "point", "polygon": "polygon"}[kind]
        d.update(l)
        out.append(d)
    return out


def _scale_symbol(sym, k):
    if k == 1.0:
        return sym
    s = dict(sym)
    for key in ("width", "casing_width", "stroke_width", "size"):
        if s.get(key):
            s[key] = round(s[key] * k, 3)
    for key in ("dash", "stroke_dash"):
        if s.get(key):
            s[key] = [round(v * k, 3) for v in s[key]]
    if s.get("hatch"):
        s["hatch"] = {**s["hatch"], "spacing": s["hatch"]["spacing"] * k, "width": s["hatch"]["width"] * k}
    return s


def _scale_renderer(r, k):
    if k == 1.0:
        return r
    r = copy.deepcopy(r)
    if r["type"] == "simple":
        r["symbol"] = _scale_symbol(r["symbol"], k)
    else:
        for c in r["classes"]:
            c["symbol"] = _scale_symbol(c["symbol"], k)
        for extra in ("other", "nodata"):
            if r.get(extra):
                r[extra]["symbol"] = _scale_symbol(r[extra]["symbol"], k)
    return r


def _scale_labels(labels, k):
    return [{**l, "size": round(l["size"] * k, 2), "halo": round((l.get("halo") or 0) * k, 2)} for l in labels]


def _map_layers(mspec, catalog, k, pkg):
    """Thematic layers of one map as resolved dicts, bottom to top."""
    out = []
    for entry in mspec.get("layers") or []:
        e = {"id": entry} if isinstance(entry, str) else dict(entry)
        lid = e["id"]
        if lid not in catalog or "renderer" not in catalog[lid]:
            raise ValueError(f"Map {mspec['id']}: layer {lid!r} is not defined under `layers:` in project.yaml")
        c = catalog[lid]
        labels = c.get("labels", []) if e.get("labels", True) else []
        rend = c["renderer"]
        if e.get("where") and rend["type"] == "categorized":
            # A filtered use of a layer lists only the classes that survive the filter.
            kept, _, _ = vec.read(pkg / c["file"], c["layer"], e["where"])
            have = {str(p.get(rend["field"])) for _, p in kept}
            rend = {**rend, "classes": [cl for cl in rend["classes"] if have & {str(v) for v in cl["values"]}]}
        out.append({"id": lid, "title": e.get("title") or c["title"], "group": "thematic", "file": c["file"], "layer": c["layer"],
                    "kind": c["kind"], "where": e.get("where"), "renderer": _scale_renderer(rend, k),
                    "labels": _scale_labels(labels, k), "key": c.get("key") if labels else None,
                    "opacity": float(e.get("opacity", c.get("opacity", 1.0))), "legend": e.get("legend", True),
                    "legend_label": e.get("legend_label"), "legend_title": e.get("legend_title"), "credit": c.get("credit")})
    # project.yaml lists layers top first, like a legend. Draw polygons, then lines, then points.
    out.reverse()
    if not mspec.get("keep_order"):
        rank = {"polygon": 0, "line": 1, "point": 2}
        out.sort(key=lambda l: rank[l["kind"]])
    return out


def _is_fill(layer):
    r = layer["renderer"]
    syms = [r["symbol"]] if r["type"] == "simple" else [c["symbol"] for c in r["classes"]]
    return layer["kind"] == "polygon" and any(s.get("fill") and s.get("fill_opacity", 1) > 0.3 for s in syms)


def _sources(layers, extra, base_credit=True):
    seen, out = set(), []
    for c in list(extra or []) + [l.get("credit") for l in layers]:
        if c and c not in seen:
            seen.add(c); out.append(c.rstrip("."))
    if base_credit and "© OpenStreetMap contributors" not in seen:
        out.append("base map © OpenStreetMap contributors")
    return ("Sources: " + "; ".join(out) + ".") if out else ""


def _target_bbox(ext, ctx, catalog, pkg):
    if ext in (None, "study_area"):
        e = ctx.study.GetEnvelope()
        return [e[0], e[2], e[1], e[3]], None, None
    if ext == "study_area_main" or (isinstance(ext, dict) and ext.get("study_area") == "largest_part"):
        # A city with a small detached parcel: frame the main body, not the bounding box of everything.
        g = ctx.study
        parts = [g.GetGeometryRef(i) for i in range(g.GetGeometryCount())] if g.GetGeometryName() == "MULTIPOLYGON" else [g]
        e = max(parts, key=lambda p: p.GetArea()).GetEnvelope()
        return [e[0], e[2], e[1], e[3]], (ext.get("scale") if isinstance(ext, dict) else None), None
    if isinstance(ext, dict) and "layer" in ext:
        c = catalog[ext["layer"]]
        feats, _, _ = vec.read(pkg / c["file"], c["layer"], ext.get("where"))
        return list(vec.extent(feats)), ext.get("scale"), None
    if isinstance(ext, dict) and "bbox" in ext:
        w, s, e, n = ext["bbox"]
        ct = vec.transformer(4326, ctx.epsg)
        pts = [ct.TransformPoint(x, y)[:2] for x, y in ((w, s), (w, n), (e, s), (e, n))]
        return [min(p[0] for p in pts), min(p[1] for p in pts), max(p[0] for p in pts), max(p[1] for p in pts)], ext.get("scale"), None
    if isinstance(ext, dict) and "center" in ext:
        ct = vec.transformer(4326, ctx.epsg)
        x, y, _ = ct.TransformPoint(*ext["center"])
        return [x, y, x, y], ext.get("scale", 12000), (x, y)
    raise ValueError(f"Unknown extent {ext!r}: use study_area, {{layer: id}}, {{bbox: [w, s, e, n]}} or {{center: [lon, lat], scale: n}}")


def _quiet_corners(lay, extent, thematic, catalog, pkg, ctx, forced=None):
    """Put the scale bar, an overlaid inset and an overlaid legend in the corners with the least mapped content.

    A panel sitting on top of the data the map exists to show is the most common
    layout fault, so each floating element goes to the corner where the fewest
    thematic features fall. `corners:` in project.yaml overrides the choice.
    """
    fr = lay["frame"]
    upi = (extent[2] - extent[0]) / fr["w"]
    feats = []
    for l in thematic:
        if _is_fill(l):
            continue   # a choropleth covers the whole frame; no corner is better than another
        c = catalog[l["id"]]
        fs, _, _ = vec.read(pkg / c["file"], c["layer"])
        feats += [(g, 3.0 if l["kind"] == "point" else 1.0) for g, _ in fs]
    feats.append((ctx.study.Boundary(), 2.0))

    def score(corner, size):
        w, h = size[0] * upi, size[1] * upi
        x0 = extent[0] if corner.endswith("l") else extent[2] - w
        y0 = extent[3] - h if corner.startswith("t") else extent[1]
        box = vec.bbox_polygon(x0, y0, x0 + w, y0 + h)
        total = 0.0
        for g, wt in feats:
            if not g.Intersects(box):
                continue
            if wt == 3.0:
                total += wt
            else:      # lines count by how much of them the panel would cover
                try:
                    total += wt * min(4.0, g.Intersection(box).Length() / max(w, h) * 4)
                except RuntimeError:
                    total += wt
        return total

    prefs = {"furniture": ["bl", "br"], "inset": ["tr", "tl", "br", "bl"], "legend": ["br", "tr", "tl", "bl"]}
    out, taken = {}, set()
    for name in ("legend", "inset", "furniture"):   # largest first
        if name not in lay["floating"]:
            continue
        if forced and forced.get(name):
            out[name] = forced[name]
        else:
            free = [c for c in prefs[name] if c not in taken]
            out[name] = min(free, key=lambda c: (score(c, lay["floating"][name]), prefs[name].index(c)))
        taken.add(out[name])
    return out


def _compose(mspec, spec, ctx, catalog, pkg, page_texts=None):
    """Resolve one map: layout, extent, scale, layers. Base layers are added later."""
    proj = spec["project"]
    brand = spec.get("brand") or {}
    page = mspec.get("page", "letter-landscape")
    W, H, pname = layout.page_size(page)
    k_guess = layout.type_k(page, mspec.get("type_scale"))
    thematic = _map_layers(mspec, catalog, k_guess, pkg)
    legend_src = list(thematic)
    if mspec.get("legend_study_area", True) and mspec.get("boundary", True):
        legend_src.insert(0, {"id": "base_boundary", "legend": True, "title": "Study area",
                              "renderer": {"type": "simple", "label": (spec.get("study_area") or {}).get("legend_label", "Study area"),
                                           "symbol": styles.symbol("polygon", {"fill": None, "stroke": styles.BASE["boundary"], "stroke_width": 0.95 * k_guess,
                                                                               "stroke_dash": [6 * k_guess, 2 * k_guess, 1.2 * k_guess, 2 * k_guess]})}})
    groups = styles.legend_groups(legend_src)
    for l in reversed(thematic):
        if l.get("key"):       # numbered features: the key lists number and name under the legend
            groups.append({"title": l["key"]["title"], "items": [], "note": "\n".join(l["key"]["lines"])})
    for extra in mspec.get("legend_extra") or []:   # reference entries such as parks or rail
        groups.append(extra)
    bbox, scale, center = _target_bbox(mspec.get("extent"), ctx, catalog, pkg)
    scale = mspec.get("scale") or scale
    texts = {
        "figure": mspec.get("figure", ""), "title": mspec.get("title", proj.get("title", "")), "subtitle": mspec.get("subtitle", ""),
        "notes": mspec.get("notes", ""), "client": proj.get("client", ""), "status": proj.get("status", ""),
        "date_line": _date_line(proj.get("date", datetime.date.today())),
        "sources": _sources(thematic, mspec.get("sources"), base_credit=mspec.get("basemap", True) is not False),
        # A practice package says so on every map face, not only in the documents.
        "projection": "", "stamp": mspec.get("stamp") or (proj.get("practice_label", "PRACTICE ONLY: includes hypothetical or unverified content") if proj.get("practice") else ""),
    }
    if page_texts:
        texts.update(page_texts)
    want_inset = mspec.get("inset", True)
    lay = layout.build(mspec.get("template", "auto"), page, texts, groups, brand, inset=bool(want_inset),
                       legend_columns=mspec.get("legend_columns"), type_scale=mspec.get("type_scale"))
    fr = lay["frame"]
    extent, scale = layout.fit_extent(bbox, fr["w"], fr["h"], ctx.crs["meters_per_unit"], pad=float(mspec.get("pad", 0.07)), scale=scale, center=center)
    corners = _quiet_corners(lay, extent, thematic, catalog, pkg, ctx, mspec.get("corners"))
    # The projection line needs the scale, which needs the frame, so fill it in now and rebuild.
    texts["projection"] = f"{ctx.crs['name']} (EPSG:{ctx.epsg}), grid north. {layout.scale_text(scale, ctx.crs['is_feet'])} at {W:g} by {H:g} in."
    lay = layout.build(mspec.get("template", "auto"), page, texts, groups, brand, inset=bool(want_inset),
                       legend_columns=mspec.get("legend_columns"), corners=corners, type_scale=mspec.get("type_scale"))
    fr = lay["frame"]
    extent, scale = layout.fit_extent(bbox, fr["w"], fr["h"], ctx.crs["meters_per_unit"], pad=float(mspec.get("pad", 0.07)), scale=scale, center=center)
    m = {
        "id": mspec["id"], "figure": texts["figure"], "title": texts["title"], "subtitle": texts["subtitle"], "notes": texts["notes"],
        "alt": mspec.get("alt", ""), "sources": texts["sources"], "page": lay["page"], "template": lay["template"], "k": lay["k"],
        "frame": fr, "extent": [round(v, 3) for v in extent], "scale": scale, "scale_text": layout.scale_text(scale, ctx.crs["is_feet"]),
        "rotation": 0.0, "background": styles.BASE["land"], "elements": lay["elements"], "legend": lay["legend"],
        "legend_groups": groups, "inset": lay.get("inset"), "furniture": lay["furniture"],
        "scalebar": layout.scalebar(scale, ctx.crs["is_feet"], 1.5 * lay["k"]), "thematic": thematic,
        "truncated": lay.get("truncated", []),
        "options": {"mask": mspec.get("mask", True), "boundary": mspec.get("boundary", True), "quiet": mspec.get("quiet_base", False),
                    "basemap": mspec.get("basemap", True), "buildings": mspec.get("buildings", "auto"),
                    "place_labels": mspec.get("place_labels", True)},
        "cramped": lay.get("cramped", False),
    }
    return m


def _finish_layers(m, has_buildings):
    """Stack base and thematic layers, bottom to top."""
    th = m.pop("thematic")
    for l in th:     # a label class with `only_below_scale` shows on large-scale maps and sheets only
        l["labels"] = [lab for lab in l["labels"] if not lab.get("only_below_scale") or m["scale"] <= float(lab["only_below_scale"])]
    fills = [l for l in th if _is_fill(l)]
    rest = [l for l in th if l not in fills]
    o = m["options"]
    if o["basemap"] is False:
        m["layers"] = fills + rest
        return
    below, above = styles.base_layers(m["scale"], has_choropleth=bool(fills), buildings=has_buildings, quiet=o["quiet"] or bool(fills),
                                      mask=o["mask"] and not fills,    # dimming a choropleth would look like a second, unexplained class
                                      boundary=o["boundary"], k=m["k"])
    for l in below + above:
        l["labels"] = _scale_labels([{**LABEL_DEFAULTS, **lab} for lab in l["labels"]], m["k"])
    places = [l for l in above if l["id"] == "base_places" and o.get("place_labels", True)]
    above = [l for l in above if l["id"] != "base_places"]
    m["layers"] = below + fills + above + rest + places


def _fit_free(bbox, w, h, pad):
    """Smallest extent with the frame's aspect that holds bbox plus padding (no scale rounding)."""
    cx, cy = (bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2
    bw, bh = (bbox[2] - bbox[0]) * (1 + 2 * pad), (bbox[3] - bbox[1]) * (1 + 2 * pad)
    if bw / bh > w / h:
        bh = bw * h / w
    else:
        bw = bh * w / h
    return [round(cx - bw / 2, 2), round(cy - bh / 2, 2), round(cx + bw / 2, 2), round(cy + bh / 2, 2)]


# --------------------------------------------------------------------- atlas

def _rect(cx, cy, w, h, angle_deg=0.0):
    a = math.radians(angle_deg)
    ring = ogr.Geometry(ogr.wkbLinearRing)
    for dx, dy in ((-w / 2, -h / 2), (-w / 2, h / 2), (w / 2, h / 2), (w / 2, -h / 2), (-w / 2, -h / 2)):
        ring.AddPoint_2D(cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a))
    p = ogr.Geometry(ogr.wkbPolygon)
    p.AddGeometry(ring)
    return p


def _atlas_pages(aspec, frame, ctx, catalog, pkg, base_extent):
    """Index features for a map series. Returns (features, scale)."""
    cov = aspec.get("coverage") or {"grid": {}}
    upi = 0.0254 / ctx.crs["meters_per_unit"]
    overlap = float(cov.get("overlap", 0.08))
    if "grid" in cov:
        g = cov["grid"] or {}
        e = ctx.study.GetEnvelope()
        bx = [e[0], e[2], e[1], e[3]]
        if g.get("scale"):
            scale = float(g["scale"])
        else:
            cols, rows = int(g.get("cols", 2)), int(g.get("rows", 2))
            need = max((bx[2] - bx[0]) / (cols * (1 - overlap)) / (frame["w"] * upi), (bx[3] - bx[1]) / (rows * (1 - overlap)) / (frame["h"] * upi))
            scale = next((s for s in layout.NICE_SCALES if s >= need), need)
        tw, th = frame["w"] * upi * scale, frame["h"] * upi * scale
        sx, sy = tw * (1 - overlap), th * (1 - overlap)
        cols = max(1, math.ceil(((bx[2] - bx[0]) - tw * overlap) / sx))
        rows = max(1, math.ceil(((bx[3] - bx[1]) - th * overlap) / sy))
        x0 = (bx[0] + bx[2]) / 2 - (cols * sx + tw * overlap) / 2
        y1 = (bx[1] + bx[3]) / 2 + (rows * sy + th * overlap) / 2
        feats, n = [], 0
        for r in range(rows):
            for c in range(cols):
                poly = _rect(x0 + c * sx + tw / 2, y1 - r * sy - th / 2, tw, th)
                if not poly.Intersects(ctx.study):
                    continue
                n += 1
                feats.append((poly, {"page": n, "name": f"Sheet {chr(65 + r)}{c + 1}", "rotation": 0.0, "scale": scale}))
        return feats, scale
    if "layer" in cov:
        c = catalog[cov["layer"]]
        src, _, _ = vec.read(pkg / c["file"], c["layer"], cov.get("where"))
        field = cov.get("name_field")
        need = 0
        for g, _ in src:
            e = g.GetEnvelope()
            need = max(need, (e[1] - e[0]) * 1.14 / (frame["w"] * upi), (e[3] - e[2]) * 1.14 / (frame["h"] * upi))
        scale = float(cov.get("scale") or next((s for s in layout.NICE_SCALES if s >= need), need))
        tw, th = frame["w"] * upi * scale, frame["h"] * upi * scale
        feats = []
        for i, (g, p) in enumerate(sorted(src, key=lambda f: str(f[1].get(field, "")))):
            e = g.GetEnvelope()
            feats.append((_rect((e[0] + e[1]) / 2, (e[2] + e[3]) / 2, tw, th), {"page": i + 1, "name": str(p.get(field) or f"Sheet {i + 1}"), "rotation": 0.0, "scale": scale}))
        return feats, scale
    if "strip" in cov:
        from qgis.core import QgsGeometry   # line merge and interpolation
        s = cov["strip"]
        c = catalog[s["layer"]]
        src, _, _ = vec.read(pkg / c["file"], c["layer"], s.get("where"))
        merged = QgsGeometry.unaryUnion([QgsGeometry.fromWkt(g.ExportToWkt()) for g, _ in src]).mergeLines()
        parts = merged.asGeometryCollection() if merged.isMultipart() else [merged]
        line = max(parts, key=lambda p: p.length())
        total = line.length()
        if s.get("scale"):
            scale = float(s["scale"])
            tw = frame["w"] * upi * scale
            step = tw * (1 - overlap)
        else:
            step = ctx.mi(float(s.get("length_mi", 0.5)))
            need = step / (1 - overlap) / (frame["w"] * upi)
            scale = next((v for v in layout.NICE_SCALES if v >= need), need)
            tw = frame["w"] * upi * scale
            step = tw * (1 - overlap)
        th = frame["h"] * upi * scale
        n = max(1, math.ceil(total / step))
        step = total / n
        feats = []
        for i in range(n):
            a = line.interpolate(i * step).asPoint()
            b = line.interpolate(min(total, (i + 1) * step)).asPoint()
            ang = math.degrees(math.atan2(b.y() - a.y(), b.x() - a.x()))
            if ang > 90:
                ang -= 180
            elif ang < -90:
                ang += 180       # keep pages reading left to right, never upside down
            nbrs = [str(j) for j in (i, i + 2) if 1 <= j <= n]
            adj = (" (adjoins sheet" + ("s " if len(nbrs) > 1 else " ") + " and ".join(nbrs) + ")") if nbrs else ""
            feats.append((_rect((a.x() + b.x()) / 2, (a.y() + b.y()) / 2, tw, th, ang),
                          {"page": i + 1, "name": f"Sheet {i + 1}{adj}", "rotation": round(ang, 2), "scale": scale}))
        return feats, scale
    raise ValueError("atlas.coverage needs grid, layer or strip")


# ---------------------------------------------------------------------- main

def resolve(project_dir, pkg_dir, log=print):
    project_dir, pkg = Path(project_dir), Path(pkg_dir)
    spec = load_yaml(project_dir)
    proj = spec["project"]
    ctx = datamod.Ctx(project_dir, pkg, log)
    warnings = []

    for m in list(spec["maps"]) + list(spec.get("atlases") or []):    # catch a bad page name before any download
        layout.page_size(m.get("page", "letter-landscape"))
    log("Study area")
    datamod.study_area(spec, ctx)
    e = ctx.study.GetEnvelope()
    sb = [e[0], e[2], e[1], e[3]]
    span = max(sb[2] - sb[0], sb[3] - sb[1])
    # Thematic layers are fetched for the study area plus a generous margin; maps rarely show more.
    grow = max(span * 0.6, ctx.mi(0.75))
    fetch_bbox = [sb[0] - grow, sb[1] - grow, sb[2] + grow, sb[3] + grow]
    for name, feats in (("study_area", ctx.study_feats),):
        info = vec.write_gpkg(pkg / "data" / "project.gpkg", name, feats, ctx.epsg, "polygon")
        info.update(file="data/project.gpkg", title="Study area")
        ctx.catalog[name] = info

    log("Thematic layers")
    for lid, lspec in (spec.get("layers") or {}).items():
        if lid != vec.safe_field(lid):
            raise ValueError(f"Layer id {lid!r} must be letters, digits and underscores (it becomes a table name)")
        info = datamod.load_source(lid, lspec, ctx, fetch_bbox)
        feats, _, _ = vec.read(pkg / info["file"], lid)
        renderer, w = styles.resolve(lspec.get("style"), info["kind"], feats, title=info["title"], lid=lid)
        warnings += w
        info["renderer"] = renderer
        info["labels"] = _label(lspec.get("label"), info["kind"])
        lab0 = lspec.get("label") if isinstance(lspec.get("label"), dict) else {}
        if lab0.get("number"):
            # Numbered key: features are numbered north to south, the map shows the number, the legend lists the names.
            name_f = lab0.get("field")
            order = sorted(range(len(feats)), key=lambda i: -feats[i][0].Centroid().GetY())
            for n, i in enumerate(order, 1):
                feats[i][1]["map_no"] = n
            vec.write_gpkg(pkg / "data" / "project.gpkg", lid, feats, ctx.epsg, info["kind"])
            info["fields"] = info.get("fields", []) + ["map_no"]
            info["labels"] = _label({**{k: v for k, v in lab0.items() if k != "number"}, "field": "map_no", "weight": lab0.get("weight", "semibold")}, info["kind"])
            info["key"] = {"title": lspec.get("key_title", info["title"]),
                           "lines": [f"{n}  {feats[i][1].get(name_f) or '[NAME NEEDED]'}" for n, i in enumerate(order, 1)]}
        info["opacity"] = float(lspec.get("opacity", 1.0))
        info["description"] = lspec.get("description", "")
        info["popup"] = lspec.get("popup")
        if info["count"] == 0:
            warnings.append(f"{lid}: the source returned no features inside the study area")

    log("Maps")

    def is_index(entry):
        lid = entry if isinstance(entry, str) else entry.get("id", "")
        return lid.startswith("atlas_") and lid.endswith("_index")

    # A map may show a map book's sheet outlines (layer id atlas_<atlas id>_index). Those outlines do not
    # exist until the atlas is laid out, so such maps are composed without them first and again afterwards.
    maps = [_compose({**m, "layers": [e for e in (m.get("layers") or []) if not is_index(e)]}, spec, ctx, ctx.catalog, pkg) for m in spec["maps"]]
    ids = [m["id"] for m in maps]
    if len(ids) != len(set(ids)):
        raise ValueError("Map ids must be unique")

    atlases = []
    for a in spec.get("atlases") or []:
        base = next((m for m in spec["maps"] if m["id"] == a.get("base_map")), None)
        if base is None:
            raise ValueError(f"Atlas {a['id']}: base_map {a.get('base_map')!r} is not a map id")
        # A map book starts as a copy of its base map; any map key set on the atlas (layers, notes, legend options) replaces the base map's.
        ms = {**base, **{k: v for k, v in a.items() if k not in ("coverage", "base_map")}, "id": a["id"]}
        ms["title"] = a.get("title", base.get("title"))
        ms["extent"] = base.get("extent")
        ms.setdefault("legend_study_area", True)
        if "alt" not in a:
            ms["alt"] = f"Map book: {ms['title']}."
        am = _compose(ms, spec, ctx, ctx.catalog, pkg, page_texts={"figure": "Sheet {page_number} of {page_count}", "subtitle": a.get("subtitle", "{page_name}"),
                                  "inset_caption": "Sheet index"})
        feats, scale = _atlas_pages(a, am["frame"], ctx, ctx.catalog, pkg, am["extent"])
        if not feats:
            raise ValueError(f"Atlas {a['id']}: the coverage produced no pages")
        idx = f"atlas_{a['id']}_index"
        info = vec.write_gpkg(pkg / "data" / "project.gpkg", idx, feats, ctx.epsg, "polygon", fields=["page", "name", "rotation", "scale"])
        info.update(file="data/project.gpkg", title=f"{am['title']} sheet index")
        info["renderer"] = {"type": "simple", "title": None, "label": f"{am['title']} sheet",
                            "symbol": styles.symbol("polygon", {"fill": None, "stroke": "#7b2d8e", "stroke_width": 0.9})}
        info["labels"] = _label({"field": "page", "size": 9, "weight": "semibold", "color": "#7b2d8e", "halo": 1.4}, "polygon")
        info["opacity"] = 1.0
        ctx.catalog[idx] = info
        am["scale"] = scale
        am["scale_text"] = layout.scale_text(scale, ctx.crs["is_feet"])
        am["scalebar"] = layout.scalebar(scale, ctx.crs["is_feet"], 1.5 * am["k"])
        for el in am["elements"]:
            if el["id"] == "projection":
                W, H = am["page"]["w"], am["page"]["h"]
                el["text"] = "\n".join(layout.wrap(f"{ctx.crs['name']} (EPSG:{ctx.epsg}). {am['scale_text']} at {W:g} by {H:g} in.", el["w"], el["size"]))
        ext = vec.extent(feats)
        am["extent"] = [round(v, 3) for v in ext]
        am["alt"] = a.get("alt") or f"Map book of {len(feats)} sheets: {am['title']}."
        am["atlas"] = {"index_layer": idx, "file": "data/project.gpkg", "pages": [
            {"page": p["page"], "name": p["name"], "rotation": p["rotation"],
             "center": [round((g.GetEnvelope()[0] + g.GetEnvelope()[1]) / 2, 3), round((g.GetEnvelope()[2] + g.GetEnvelope()[3]) / 2, 3)]} for g, p in feats],
            "kind": next(iter((a.get("coverage") or {"grid": {}}).keys()))}
        atlases.append(am)

    for i, m in enumerate(spec["maps"]):
        if any(is_index(e) for e in (m.get("layers") or [])):
            maps[i] = _compose(m, spec, ctx, ctx.catalog, pkg)

    # Base data must cover every map and atlas sheet.
    allm = maps + atlases
    ux = [min(m["extent"][0] for m in allm), min(m["extent"][1] for m in allm), max(m["extent"][2] for m in allm), max(m["extent"][3] for m in allm)]
    padx = (ux[2] - ux[0]) * 0.04
    ux = [ux[0] - padx, ux[1] - padx, ux[2] + padx, ux[3] + padx]
    bopt = (spec.get("basemap") or {}).get("buildings", "auto")
    min_scale = min(m["scale"] for m in allm)
    has_buildings = bool(bopt is True or (bopt == "auto" and min_scale <= 7200))
    if any(m["options"]["basemap"] is not False for m in allm):
        log("Base map (OpenStreetMap)")
        datamod.build_base(ctx, ux, buildings=has_buildings)
    else:
        big = vec.bbox_polygon(ux[0] - 5e6, ux[1] - 5e6, ux[2] + 5e6, ux[3] + 5e6)
        info = vec.write_gpkg(pkg / "data" / "project.gpkg", "study_mask", [(big.Difference(ctx.study), {"name": "Outside study area"})], ctx.epsg, "polygon")
        info.update(file="data/project.gpkg", title="Outside study area")
        ctx.catalog["study_mask"] = info

    # Locator inset: a region wide enough to place the study area in its county.
    if any(m.get("inset") for m in allm):
        log("Regional inset")
        cx, cy = (sb[0] + sb[2]) / 2, (sb[1] + sb[3]) / 2
        ground = min(max(ctx.mi(44), span * 9), ctx.mi(320))
        datamod.build_region(ctx, (cx, cy), ground * 0.8)
        c = ogr.Geometry(ogr.wkbPoint); c.AddPoint_2D(cx, cy)
        info = vec.write_gpkg(pkg / "data" / "region.gpkg", "study_point", [(c, {"name": ctx.study_feats[0][1]["name"]})], ctx.epsg, "point")
        info.update(file="data/region.gpkg"); ctx.catalog["region_study_point"] = info
        for m in allm:
            if m.get("inset") and m.get("atlas"):
                # A map book sheet shows where it sits in the whole book, not where the city sits in the region.
                ins = m["inset"]
                ins["extent"] = _fit_free(m["extent"], ins["w"], ins["h"], 0.06)
                ins["overview"] = True
                idx = m["atlas"]["index_layer"]
                ins["layers"] = [
                    {"id": "index_roads", "title": "Major roads", "group": "inset", "file": "data/base.gpkg", "layer": "roads", "kind": "line",
                     "where": "\"road_class\" IN ('freeway', 'highway', 'major', 'arterial', 'collector')", "opacity": 1.0, "legend": False, "labels": [],
                     "renderer": {"type": "simple", "label": "Road", "title": None, "symbol": styles.symbol("line", {"color": "#c3c9c6", "width": 0.5})}},
                    {"id": "index_boundary", "title": "Study area", "group": "inset", "file": "data/project.gpkg", "layer": "study_area", "kind": "polygon",
                     "where": None, "opacity": 1.0, "legend": False, "labels": [],
                     "renderer": {"type": "simple", "label": "Study area", "title": None,
                                  "symbol": styles.symbol("polygon", {"fill": None, "stroke": "#2b3a42", "stroke_width": 0.7, "stroke_dash": [4, 1.5, 1, 1.5]})}},
                    {"id": "index_sheets", "title": "Sheet index", "group": "inset", "file": "data/project.gpkg", "layer": idx, "kind": "polygon",
                     "where": None, "opacity": 1.0, "legend": False,
                     "labels": [{**LABEL_DEFAULTS, "field": "page", "size": 7.0, "weight": "semibold", "color": "#4a565c", "halo": 1.0, "placement": "polygon"}],
                     "renderer": {"type": "simple", "label": "Sheet", "title": None,
                                  "symbol": styles.symbol("polygon", {"fill": None, "stroke": "#7d878c", "stroke_width": 0.5})}},
                ]
                for l in ins["layers"]:
                    l["labels"] = _scale_labels(l["labels"], m["k"])
                    l["renderer"] = _scale_renderer(l["renderer"], m["k"])
                continue
            if m.get("inset"):
                iw, ih = m["inset"]["w"], m["inset"]["h"]
                s = ground / max(iw, ih * iw / ih)
                m["inset"]["extent"] = [round(v, 2) for v in (cx - ground / 2, cy - ground / 2 * ih / iw, cx + ground / 2, cy + ground / 2 * ih / iw)]
                m["inset"]["layers"] = styles.region_layers() + [{
                    "id": "region_study_point", "title": "Study area location", "group": "inset", "file": "data/region.gpkg", "layer": "study_point",
                    "kind": "point", "where": None, "opacity": 1.0, "legend": False, "labels": [
                        {**LABEL_DEFAULTS, "field": "name", "size": 6.8, "weight": "semibold", "color": "#1f2d35", "halo": 1.2, "placement": "point", "priority": 10}],
                    "renderer": {"type": "simple", "label": "Study area", "title": None,
                                 "symbol": styles.symbol("point", {"marker": "circle", "size": 5.2, "fill": "#E8A51D", "stroke": "#4a3a12", "stroke_width": 0.8})}}]
                for l in m["inset"]["layers"]:
                    l["labels"] = _scale_labels([{**LABEL_DEFAULTS, **lab} for lab in l["labels"]], m["k"])
                    l["renderer"] = _scale_renderer(l["renderer"], m["k"])

    for m in allm:
        _finish_layers(m, has_buildings)
        for tid in m.get("truncated", []):
            warnings.append(f"{m['id']}: the {tid} text is too long for its space and was cut with '...'. Shorten it.")
        if m.get("cramped"):
            warnings.append(f"{m['id']}: the legend and footer leave less than half the page for the map. Shorten the notes, drop a layer or use a taller page.")
        if m["legend"]["mode"] == "sidebar" and m["legend"]["h"] > m["legend"]["available"] * 1.6 + 0.5:
            raise ValueError(f"{m['id']}: the legend needs {m['legend']['h']:.1f} in and the page has {m['legend']['available']:.1f} in for it, so the page "
                             "cannot be laid out. Usual causes: a numbered key or a classified layer that includes features from outside the study area "
                             "(set `clip: study_area` on that layer), too many layers on one map, or long notes. Fix project.yaml and render again.")
        if m["legend"]["h"] > m["legend"]["available"] + 0.05:
            warnings.append(f"{m['id']}: the legend needs {m['legend']['h']:.2f} in but only {m['legend']['available']:.2f} in is free. "
                            "Shorten labels, drop a layer, turn off the inset or use a larger page.")

    pid = vec.safe_field(proj.get("id") or proj.get("title", "project")).lower()
    package = {
        "schema": SCHEMA,
        "cache_files": sorted(ctx.cache.used),
        "project": {"id": pid, "title": proj.get("title", ""), "subtitle": proj.get("subtitle", ""), "client": proj.get("client", ""),
                    "prepared_by": proj.get("prepared_by", ""), "status": proj.get("status", ""), "date": str(proj.get("date", datetime.date.today())),
                    "date_line": _date_line(proj.get("date", datetime.date.today())), "description": proj.get("description", ""),
                    "number": proj.get("number", ""), "review": proj.get("review", ""),
                    "practice": bool(proj.get("practice", False)), "notice": proj.get("notice", "")},
        "crs": ctx.crs,
        "font": {"family": (spec.get("brand") or {}).get("font", "Inter")},
        "brand": spec.get("brand") or {},
        "study_area": {"name": ctx.study_feats[0][1]["name"], "bbox_4326": [round(v, 6) for v in ctx.to4326(sb)]},
        "data": ctx.catalog,
        "maps": maps,
        "atlases": atlases,
        "provenance": ctx.cache.log,
        "warnings": warnings,
        "outputs": spec.get("outputs") or ["pdf", "png", "svg", "atlas", "web", "kmz", "qgis", "arcgis", "illustrator", "zip"],
    }
    (pkg / "spec").mkdir(parents=True, exist_ok=True)
    (pkg / "spec" / "map_package.json").write_text(json.dumps(package, indent=1, default=str), encoding="utf-8")
    (pkg / "spec" / "project.yaml").write_text((project_dir / "project.yaml").read_text(encoding="utf-8"), encoding="utf-8")
    for w in warnings:
        log("  WARNING " + w)
    return package
