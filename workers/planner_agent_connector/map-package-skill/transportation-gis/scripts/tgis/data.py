"""Data step: study area, thematic layers, OSM base layers and the regional inset.

Everything lands in three GeoPackages in one projected CRS:
  data/project.gpkg  study area and the thematic layers named in project.yaml
  data/base.gpkg     base map layers derived from OpenStreetMap
  data/region.gpkg   counties, places and major roads for the locator inset
"""
from __future__ import annotations

import ast
import math
import operator
import re
from pathlib import Path

from osgeo import ogr

from . import crs as crsmod
from . import fetch, vec

ROAD_CLASS = {
    "motorway": "freeway", "trunk": "highway", "primary": "major", "secondary": "arterial",
    "tertiary": "collector", "residential": "local", "unclassified": "local", "living_street": "local",
    "motorway_link": "ramp", "trunk_link": "ramp", "primary_link": "ramp", "secondary_link": "ramp",
    "tertiary_link": "ramp", "service": "service", "road": "local",
}
ROAD_RANK = {"freeway": 7, "highway": 6, "major": 5, "arterial": 4, "collector": 3, "ramp": 2, "local": 1, "service": 0}
PATH_TYPES = {"footway", "path", "cycleway", "pedestrian", "track", "bridleway", "steps"}
PLACE_RANK = {"city": 5, "town": 4, "village": 3, "suburb": 2, "hamlet": 2, "neighbourhood": 1, "locality": 0}
MILE_M = 1609.344


class Ctx:
    """Everything the data step shares: paths, CRS, study area, caches."""

    def __init__(self, project_dir, pkg_dir, log=print):
        self.project_dir = Path(project_dir)
        self.pkg = Path(pkg_dir)
        self.cache = fetch.Cache(self.project_dir / "cache")
        self.log = log
        self.epsg = None
        self.crs = None
        self.study = None          # ogr polygon, project CRS
        self.study_feats = None
        self.osm = {}              # bbox key -> layers
        self.catalog = {}          # layer id -> info dict

    # -- units
    def mi(self, miles: float) -> float:
        """Miles to CRS units."""
        return miles * MILE_M / self.crs["meters_per_unit"]

    def to4326(self, bbox):
        ct = vec.transformer(self.epsg, 4326)
        xs, ys = [], []
        for x, y in ((bbox[0], bbox[1]), (bbox[0], bbox[3]), (bbox[2], bbox[1]), (bbox[2], bbox[3])):
            px, py, _ = ct.TransformPoint(x, y)
            xs.append(px); ys.append(py)
        return [min(xs), min(ys), max(xs), max(ys)]

    def osm_layers(self, bbox_proj, what="full", name="osm"):
        key = (tuple(round(v) for v in bbox_proj), what)
        if key not in self.osm:
            # Snap the download box outward to a 0.02 degree grid, so a small change to a map extent reuses the cached download.
            w, s_, e, n = self.to4326(bbox_proj)
            g = 0.02
            snapped = [math.floor(w / g) * g, math.floor(s_ / g) * g, math.ceil(e / g) * g, math.ceil(n / g) * g]
            path = fetch.overpass(snapped, self.cache, what=what, name=name)
            self.osm[key] = fetch.osm_layers(path, self.epsg)
        return self.osm[key]


# ------------------------------------------------------------------ study area

def study_area(spec, ctx: Ctx):
    sa = spec.get("study_area") or {}
    if "place" in sa:
        feats = fetch.place_boundary(sa["place"], ctx.cache)
        src = 4326
    elif "file" in sa:
        feats, src, _ = vec.read(ctx.project_dir / sa["file"], sa.get("layer"), sa.get("where"))
    elif "bbox" in sa:
        feats, src = [(vec.bbox_polygon(*sa["bbox"]), {"name": "Study area"})], 4326
    else:
        raise ValueError("project.yaml needs study_area.place, study_area.file or study_area.bbox")
    if not feats:
        raise ValueError("The study area source has no features")
    # CRS: stated, or the State Plane zone at the study area centre.
    g4326 = vec.union([g for g, _ in (vec.reproject(feats, src, 4326) if src != 4326 else feats)])
    c = g4326.Centroid()
    want = (spec.get("project") or {}).get("crs", "auto")
    ctx.epsg = crsmod.pick(c.GetX(), c.GetY()) if str(want).lower() == "auto" else int(str(want).upper().replace("EPSG:", ""))
    ctx.crs = crsmod.describe(ctx.epsg)
    feats = vec.reproject(feats, src, ctx.epsg)
    geom = vec.union([g for g, _ in feats])
    buf = float(sa.get("buffer_mi") or 0)
    if vec.kind_of(geom) != "polygon" and buf <= 0:
        buf = 0.25   # a line or point study area needs some width to be a mappable area
    if buf > 0:
        geom = geom.Buffer(ctx.mi(buf), 24)
    ctx.study = geom
    name = sa.get("name") or (sa.get("place", "").split(",")[0] if "place" in sa else "Study area")
    ctx.study_feats = [(geom, {"name": name})]
    return geom


# -------------------------------------------------------------- compute fields

_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.Pow: operator.pow, ast.Mod: operator.mod, ast.USub: operator.neg,
        ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt, ast.LtE: operator.le,
        ast.Gt: operator.gt, ast.GtE: operator.ge}
_FUNCS = {"min": min, "max": max, "round": round, "abs": abs, "float": float, "int": int, "str": str, "len": len}


def safe_eval(expr: str, row: dict):
    """Evaluate a small arithmetic expression over a feature's fields.

    Returns None if any field it uses is null or a division by zero occurs, so a
    missing input stays missing on the map instead of becoming a zero.
    """
    def ev(n):
        if isinstance(n, ast.Constant):
            return n.value
        if isinstance(n, ast.Name):
            if n.id not in row:
                raise KeyError(f"compute expression uses unknown field {n.id!r}")
            v = row[n.id]
            if v is None:
                raise _Null()
            return v
        if isinstance(n, ast.BinOp):
            return _OPS[type(n.op)](ev(n.left), ev(n.right))
        if isinstance(n, ast.UnaryOp):
            return _OPS[type(n.op)](ev(n.operand))
        if isinstance(n, ast.Compare) and len(n.ops) == 1:
            return _OPS[type(n.ops[0])](ev(n.left), ev(n.comparators[0]))
        if isinstance(n, ast.BoolOp):
            vals = [ev(v) for v in n.values]
            return all(vals) if isinstance(n.op, ast.And) else any(vals)
        if isinstance(n, ast.IfExp):
            return ev(n.body) if ev(n.test) else ev(n.orelse)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "coalesce":
            # coalesce(field, default): the first argument that is not null. The way to treat a null flag as "no".
            for a in n.args:
                try:
                    return ev(a)
                except _Null:
                    continue
            raise _Null()
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in _FUNCS:
            return _FUNCS[n.func.id](*[ev(a) for a in n.args])
        raise ValueError(f"Unsupported expression: {expr}")
    try:
        return ev(ast.parse(expr, mode="eval").body)
    except (_Null, ZeroDivisionError):
        return None


class _Null(Exception):
    pass


# ----------------------------------------------------------------- OSM themes

def _bike_class(p):
    hw = p.get("highway")
    cw = {p.get(k) for k in ("cycleway", "cycleway:left", "cycleway:right", "cycleway:both")} - {None, "no", "none"}
    if hw == "cycleway" or (hw == "path" and p.get("bicycle") == "designated"):
        return "I"
    if cw & {"track", "separate"}:
        return "IV"
    if cw & {"lane", "opposite_lane"}:
        return "II"
    if cw & {"shared_lane", "share_busway", "shared"}:
        return "III"
    return None


def osm_theme(theme: str, layers):
    """Ready-made thematic layers from the OSM download. Returns (features, kind).

    OSM is a draft-quality source for facility inventories. Maps that use these
    themes carry an OSM credit and the figure notes say the inventory is unverified.
    """
    pts, lines, polys = layers["points"], layers["lines"], layers["multipolygons"]
    if theme == "bikeways":
        out = []
        for g, p in lines:
            c = _bike_class(p)
            if c:
                out.append((g, {"name": p.get("name"), "bike_class": c, "osm_id": p.get("osm_id"), "surface": p.get("surface")}))
        return out, "line"
    if theme == "trails":
        return [(g, {"name": p.get("name"), "type": p.get("highway"), "surface": p.get("surface")})
                for g, p in lines if p.get("highway") in ("path", "footway", "track", "bridleway", "cycleway") and p.get("footway") not in ("sidewalk", "crossing")], "line"
    if theme in ("schools", "hospitals", "libraries"):
        tag = {"schools": ("school", "college", "university"), "hospitals": ("hospital",), "libraries": ("library",)}[theme]
        out, seen = [], set()
        for g, p in polys:
            if p.get("amenity") in tag:
                key = (p.get("name") or "").lower() or id(g)
                if key not in seen:
                    seen.add(key)
                    out.append((g.PointOnSurface(), {"name": p.get("name"), "type": p.get("amenity")}))
        for g, p in pts:
            if p.get("amenity") in tag:
                key = (p.get("name") or "").lower() or id(g)
                if key not in seen:
                    seen.add(key)
                    out.append((g, {"name": p.get("name"), "type": p.get("amenity")}))
        return out, "point"
    if theme == "transit_stops":
        out = []
        for g, p in pts:
            if p.get("highway") == "bus_stop" or p.get("public_transport") == "platform" or p.get("railway") in ("station", "halt", "tram_stop"):
                out.append((g, {"name": p.get("name"), "type": "rail" if p.get("railway") else "bus", "ref": p.get("ref")}))
        return out, "point"
    if theme == "signals":
        return [(g, {"type": "signal"}) for g, p in pts if p.get("highway") == "traffic_signals"], "point"
    if theme == "crossings":
        return [(g, {"type": "crossing"}) for g, p in pts if p.get("highway") == "crossing"], "point"
    if theme == "parks":
        return [(g, {"name": p.get("name"), "type": p.get("leisure")}) for g, p in polys
                if p.get("leisure") in ("park", "nature_reserve", "playground", "garden", "pitch")], "polygon"
    if theme == "roads":
        out = []
        for g, p in lines:
            c = ROAD_CLASS.get(p.get("highway") or "")
            if c and c not in ("service",):
                out.append((g, {"name": p.get("name"), "ref": p.get("ref"), "road_class": c, "lanes": p.get("lanes"), "maxspeed": p.get("maxspeed")}))
        return out, "line"
    raise ValueError(f"Unknown osm theme {theme!r}. Known: bikeways, trails, schools, hospitals, libraries, transit_stops, signals, crossings, parks, roads")


# ------------------------------------------------------------ thematic sources

def load_source(lid: str, lspec: dict, ctx: Ctx, bbox_proj):
    """Load one thematic layer described in project.yaml into the project CRS."""
    src = lspec.get("source") or {}
    kind = lspec.get("geometry")
    bbox4326 = ctx.to4326(bbox_proj)
    credit = None
    if "file" in src:
        path = ctx.project_dir / src["file"]
        if path.suffix.lower() == ".csv" and src.get("x") and src.get("y"):
            feats, _, _ = vec.read(path, open_options=[f"X_POSSIBLE_NAMES={src['x']}", f"Y_POSSIBLE_NAMES={src['y']}", "KEEP_GEOM_COLUMNS=NO", "AUTODETECT_TYPE=YES"])
            in_epsg = src.get("crs", 4326)
        else:
            feats, in_epsg, _ = vec.read(path, src.get("layer"), src.get("where"))
            in_epsg = src.get("crs") or in_epsg
            if in_epsg is None:
                raise ValueError(f"{lid}: {path.name} has no CRS. Add source.crs (for example 4326) in project.yaml.")
        feats = vec.reproject(feats, str(in_epsg).upper().replace("EPSG:", ""), ctx.epsg) if str(in_epsg) != str(ctx.epsg) else feats
        ctx.cache.record(lid, publisher=src.get("publisher") or src.get("credit") or "Supplied file", url=str(src["file"]),
                         credit=src.get("credit"), license=src.get("license"))
        credit = src.get("credit")
    elif "arcgis" in src:
        want = src.get("fields") or lspec.get("fields")
        feats, meta = fetch.arcgis_layer(src["arcgis"], ctx.cache, where=src.get("where", "1=1"),
                                         bbox4326=None if src.get("all") else bbox4326, name=lid,
                                         fields=",".join(want) if want else "*")
        feats = vec.reproject(feats, 4326, ctx.epsg)
        credit = src.get("credit") or meta.get("copyrightText") or None
        if src.get("credit"):
            ctx.cache.log[lid]["credit"] = src["credit"]
            ctx.cache.log[lid]["publisher"] = src.get("publisher") or src["credit"]
        if src.get("license"):
            ctx.cache.log[lid]["license"] = src["license"]
    elif "osm" in src:
        feats, k2 = osm_theme(src["osm"], ctx.osm_layers(bbox_proj))
        kind = kind or k2
        credit = "© OpenStreetMap contributors"
        ctx.cache.record(lid, publisher="OpenStreetMap contributors", license="ODbL 1.0", url="https://www.openstreetmap.org",
                         query=f"osm theme: {src['osm']}", credit=credit,
                         caveat="Volunteered data. Treat as a draft inventory until checked against the agency's records.")
    elif "tiger" in src:
        feats = vec.reproject(fetch.tiger(src["tiger"], ctx.cache, where=src.get("where", "1=1"), bbox4326=bbox4326, name=lid), 4326, ctx.epsg)
        credit = "U.S. Census Bureau TIGER/Line"
    elif "acs" in src:
        a = src["acs"]
        geo = a.get("geography", "tract")
        tfeats = fetch.tiger("Census Tracts" if geo == "tract" else "Census Block Groups", ctx.cache, bbox4326=bbox4326, name=lid + "_geometry")
        counties = sorted({(p.get("STATE"), p.get("COUNTY")) for _, p in tfeats if p.get("STATE")})
        year = int(a.get("year", 2023))
        table = fetch.acs(a["variables"], counties, ctx.cache, year=year, geography=geo)
        feats = []
        for g, p in tfeats:
            row = {"GEOID": p.get("GEOID"), "NAME": p.get("NAME") or p.get("BASENAME")}
            row.update(table.get(p.get("GEOID"), {k: None for k in a["variables"]}))
            feats.append((g, row))
        feats = vec.reproject(feats, 4326, ctx.epsg)
        kind = "polygon"
        credit = f"U.S. Census Bureau, ACS {year - 4} to {year} 5-year estimates"
        ctx.cache.record(lid, publisher="U.S. Census Bureau", dataset=f"ACS {year - 4} to {year} 5-year estimates, {geo}",
                         url=f"https://api.census.gov/data/{year}/acs/acs5", query=a["variables"], license="Public domain", credit=credit)
    elif "gtfs" in src:
        g = src["gtfs"]
        gsrc = g if isinstance(g, str) else g["feed"]
        part = "routes" if isinstance(g, str) else g.get("part", "routes")
        if not str(gsrc).startswith("http"):
            gsrc = ctx.project_dir / gsrc
        lines, stops = fetch.gtfs(gsrc, ctx.cache, name=lid)
        feats = vec.reproject(stops if part == "stops" else lines, 4326, ctx.epsg)
        kind = "point" if part == "stops" else "line"
        credit = src.get("credit")
    else:
        raise ValueError(f"{lid}: source needs one of file, arcgis, osm, tiger, acs, gtfs")

    if not kind:
        kinds = {vec.kind_of(g) for g, _ in feats} - {None}
        if len(kinds) > 1:
            raise ValueError(f"{lid}: mixed geometry types {sorted(kinds)}. Set geometry: point, line or polygon.")
        kind = kinds.pop() if kinds else "polygon"

    # Trim to what the maps can show. Tract-like polygons are kept whole so rates stay honest.
    lab = lspec.get("label")
    # A numbered key lists every feature by name, so by default it covers the study area only.
    clip_mode = lspec.get("clip") or ("study_area" if isinstance(lab, dict) and lab.get("number") else "bbox")
    lspec = {**lspec, "clip": clip_mode}
    if clip_mode == "study_area":
        feats = vec.clip(feats, ctx.study, kind)
    elif clip_mode == "bbox" and "acs" not in src:
        feats = vec.clip(feats, vec.bbox_polygon(*bbox_proj), kind)

    for name, expr in (lspec.get("compute") or {}).items():
        for _, p in feats:
            p[name] = safe_eval(expr, p)
    if lspec.get("filter"):
        feats = [(g, p) for g, p in feats if safe_eval(lspec["filter"], p)]
    keep = lspec.get("fields")
    if keep:
        keep = list(keep) + [k for k in (lspec.get("compute") or {}) if k not in keep]
        feats = [(g, {k: p.get(k) for k in keep}) for g, p in feats]
    info = vec.write_gpkg(ctx.pkg / "data" / "project.gpkg", lid, feats, ctx.epsg, kind,
                          description=lspec.get("title", lid))
    info.update(file="data/project.gpkg", title=lspec.get("title", lid.replace("_", " ").title()), credit=credit,
                clip=lspec.get("clip", "bbox"), filter=lspec.get("filter"))
    ctx.catalog[lid] = info
    ctx.log(f"  layer {lid}: {info['count']} {kind} features")
    return info


# ------------------------------------------------------------------- base map

def _shield(ref):
    """'I 505;CA 128' -> ('I', '505'). Returns (network, number) or (None, None)."""
    if not ref:
        return None, None
    first = re.split(r"[;,/]", ref)[0].strip()
    m = re.match(r"^(I|US|SR|CA|[A-Z]{2}|CR|County)[ -]?(\d+[A-Z]?)\b", first)
    if not m:
        return None, None
    net = {"SR": "State", "CR": "County"}.get(m.group(1), m.group(1))
    if len(net) == 2 and net not in ("US",):
        net = "State"
    return net, m.group(2)


def build_base(ctx: Ctx, bbox_proj, buildings=False):
    """Base map layers from OSM, clipped to the union of all map extents."""
    L = ctx.osm_layers(bbox_proj)
    gp = ctx.pkg / "data" / "base.gpkg"
    box = vec.bbox_polygon(*bbox_proj)
    roads, paths, rail, wline = [], [], [], []
    for g, p in L["lines"]:
        hw = p.get("highway")
        if hw:
            if p.get("tunnel") in ("yes", "building_passage"):
                continue
            c = ROAD_CLASS.get(hw)
            if c == "service" and (p.get("service") or p.get("access") in ("private", "no")):
                continue   # driveways, parking aisles and private roads clutter a planning map
            if c:
                net, num = _shield(p.get("ref"))
                roads.append((g, {"name": p.get("name"), "ref": p.get("ref"), "shield": num, "shield_net": net,
                                  "road_class": c, "rank": ROAD_RANK[c], "osm_highway": hw,
                                  "lanes": p.get("lanes"), "maxspeed": p.get("maxspeed"), "oneway": p.get("oneway"),
                                  "bridge": p.get("bridge")}))
            elif hw in PATH_TYPES and p.get("footway") not in ("sidewalk", "crossing"):
                paths.append((g, {"name": p.get("name"), "type": hw, "bicycle": p.get("bicycle"), "surface": p.get("surface")}))
        elif p.get("railway"):
            if p.get("service") in ("yard", "siding", "spur") or p.get("tunnel") == "yes":
                continue
            rail.append((g, {"name": p.get("name"), "type": p.get("railway")}))
        elif p.get("waterway"):
            wline.append((g, {"name": p.get("name"), "type": p.get("waterway")}))
    water, parks, green, bldg, campus, air = [], [], [], [], [], []
    for g, p in L["multipolygons"]:
        if p.get("natural") == "water" or p.get("landuse") in ("reservoir", "basin") or p.get("waterway") == "riverbank":
            water.append((g, {"name": p.get("name"), "type": p.get("water") or "water"}))
        elif p.get("leisure") in ("park", "nature_reserve", "golf_course", "pitch", "playground", "garden") or p.get("landuse") in ("cemetery", "recreation_ground"):
            parks.append((g, {"name": p.get("name"), "type": p.get("leisure") or p.get("landuse")}))
        elif p.get("natural") in ("wood", "scrub") or p.get("landuse") in ("forest",):
            green.append((g, {"name": p.get("name"), "type": p.get("natural") or p.get("landuse")}))
        elif p.get("amenity") in ("school", "college", "university", "hospital"):
            campus.append((g, {"name": p.get("name"), "type": p.get("amenity")}))
        elif p.get("aeroway"):
            air.append((g, {"name": p.get("name"), "type": p.get("aeroway")}))
        elif p.get("building") and buildings:
            bldg.append((g, {"type": p.get("building")}))
    places = []
    for g, p in L["points"]:
        if p.get("place") in PLACE_RANK and p.get("name"):
            pop = None
            try:
                pop = int(str(p.get("population")).replace(",", ""))
            except (TypeError, ValueError):
                pass
            places.append((g, {"name": p["name"], "place": p["place"], "rank": PLACE_RANK[p["place"]], "population": pop}))

    sets = [("water", water, "polygon"), ("parks", parks, "polygon"), ("green", green, "polygon"),
            ("campus", campus, "polygon"), ("airport", air, "polygon"), ("buildings", bldg, "polygon"),
            ("waterways", wline, "line"), ("rail", rail, "line"), ("paths", paths, "line"), ("roads", roads, "line"),
            ("places", places, "point")]
    for name, feats, kind in sets:
        if name == "buildings" and not buildings:
            continue
        info = vec.write_gpkg(gp, name, vec.clip(feats, box, kind), ctx.epsg, kind)
        info.update(file="data/base.gpkg", credit="© OpenStreetMap contributors")
        ctx.catalog["base_" + name] = info
    # Study area outline and a mask that dims everything outside it.
    big = vec.bbox_polygon(bbox_proj[0] - 5e6, bbox_proj[1] - 5e6, bbox_proj[2] + 5e6, bbox_proj[3] + 5e6)
    mask = big.Difference(ctx.study)
    for name, feats in (("study_area", ctx.study_feats), ("study_mask", [(mask, {"name": "Outside study area"})])):
        info = vec.write_gpkg(ctx.pkg / "data" / "project.gpkg", name, feats, ctx.epsg, "polygon")
        info.update(file="data/project.gpkg", title="Study area" if name == "study_area" else "Outside study area")
        ctx.catalog[name] = info
    ctx.log(f"  base map: {len(roads)} road segments, {len(water)} water bodies, {len(parks)} parks")


def build_region(ctx: Ctx, center, half_width):
    """Counties, places and major roads around the study area, for the locator inset."""
    gp = ctx.pkg / "data" / "region.gpkg"
    bbox = [center[0] - half_width, center[1] - half_width, center[0] + half_width, center[1] + half_width]
    b4326 = ctx.to4326(bbox)
    box = vec.bbox_polygon(*bbox)
    try:
        counties = vec.reproject(fetch.tiger("Counties", ctx.cache, bbox4326=b4326, fields="NAME,BASENAME,GEOID,STATE", name="region_counties"), 4326, ctx.epsg)
        places = vec.reproject(fetch.tiger("Incorporated Places", ctx.cache, bbox4326=b4326, fields="NAME,BASENAME,GEOID", name="region_places"), 4326, ctx.epsg)
    except fetch.Offline:
        raise
    except Exception as e:
        ctx.log(f"  region: TIGERweb unavailable ({e}); inset will show roads only")
        counties, places = [], []
    try:
        L = ctx.osm_layers(bbox, what="major", name="osm_region")
        roads = []
        for g, p in L["lines"]:
            c = ROAD_CLASS.get(p.get("highway") or "")
            if c in ("freeway", "highway", "major"):
                net, num = _shield(p.get("ref"))
                roads.append((g, {"name": p.get("name"), "ref": p.get("ref"), "shield": num, "shield_net": net, "road_class": c, "rank": ROAD_RANK[c]}))
    except fetch.Offline:
        raise
    except Exception as e:
        ctx.log(f"  region: Overpass unavailable ({e}); inset will have no roads")
        roads = []
    for name, feats, kind in (("counties", counties, "polygon"), ("places", places, "polygon"), ("major_roads", roads, "line")):
        info = vec.write_gpkg(gp, name, vec.clip(feats, box, kind), ctx.epsg, kind)
        info.update(file="data/region.gpkg")
        ctx.catalog["region_" + name] = info
    info = vec.write_gpkg(gp, "study_area", ctx.study_feats, ctx.epsg, "polygon")
    info.update(file="data/region.gpkg")
    ctx.catalog["region_study_area"] = info
    return bbox
