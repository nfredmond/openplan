"""Download public data and record where it came from.

Every download is cached under <project>/cache and logged with publisher, URL,
query and retrieval date, because a client map has to cite its sources and a
later run should not hammer public servers.
"""
from __future__ import annotations

import csv
import datetime
import hashlib
import io
import json
import os
import tempfile
import time
import zipfile
from pathlib import Path

import requests
from osgeo import gdal, ogr

from . import vec

UA = "transportation-gis-skill/1.0 (planning map production; contact: project owner)"
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
TIGERWEB = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer"


class Cache:
    """File cache plus a provenance log (cache/provenance.json)."""

    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.log_path = self.root / "provenance.json"
        self.log = json.loads(self.log_path.read_text()) if self.log_path.exists() else {}
        self.used = {"provenance.json"}

    def path(self, key: str, ext: str) -> Path:
        p = self.root / (hashlib.sha1(key.encode()).hexdigest()[:16] + ext)
        self.used.add(p.name)       # every file this build reads, so the package can archive exactly those
        return p

    def record(self, name, **meta):
        meta.setdefault("retrieved", datetime.date.today().isoformat())
        self.log[name] = meta
        self.log_path.write_text(json.dumps(self.log, indent=2))


class Offline(RuntimeError):
    pass


def _get(url, params=None, data=None, timeout=180, tries=3):
    if os.environ.get("TGIS_OFFLINE"):
        raise Offline(f"Offline rebuild: {url} is not in the archived sources. The archive is incomplete or project.yaml changed.")
    last = None
    for i in range(tries):
        try:
            if data is not None:
                r = requests.post(url, data=data, headers={"User-Agent": UA}, timeout=timeout)
            else:
                r = requests.get(url, params=params, headers={"User-Agent": UA}, timeout=timeout)
            if r.status_code == 200:
                return r
            last = RuntimeError(f"HTTP {r.status_code} from {url}: {r.text[:200]}")
            if r.status_code in (429, 504, 503):
                time.sleep(10 * (i + 1))
        except requests.RequestException as e:
            last = e
            time.sleep(3 * (i + 1))
    raise last


# --------------------------------------------------------------------------- OSM

OSMCONF = """
closed_ways_are_polygons=aeroway,amenity,boundary,building,craft,geological,historic,landuse,leisure,military,natural,office,place,shop,sport,tourism,waterway=riverbank,highway=platform,public_transport=platform
attribute_name_laundering=no
[points]
osm_id=yes
attributes=name,place,population,amenity,highway,railway,public_transport,shop,leisure,ref
other_tags=no
[lines]
osm_id=yes
attributes=name,ref,highway,railway,waterway,bicycle,foot,cycleway,cycleway:left,cycleway:right,cycleway:both,sidewalk,surface,lanes,maxspeed,oneway,bridge,tunnel,service,access,footway,segregated,network,route
other_tags=no
[multipolygons]
osm_id=yes
osm_way_id=yes
attributes=name,natural,water,waterway,leisure,landuse,amenity,building,boundary,admin_level,aeroway
other_tags=no
[multilinestrings]
osm_id=yes
attributes=name,type,route,ref,network
other_tags=no
[other_relations]
other_tags=no
"""


def overpass(bbox4326, cache: Cache, what="full", name="osm"):
    """Download OSM XML for a bbox (west, south, east, north). Returns the .osm path.

    what='full' pulls everything a base map needs; 'major' pulls only freeways,
    trunk and primary roads for the regional inset.
    """
    w, s, e, n = bbox4326
    b = f"({s:.5f},{w:.5f},{n:.5f},{e:.5f})"
    if what == "major":
        body = f'way["highway"~"^(motorway|trunk|primary)$"]{b};'
    else:
        body = "".join(
            f"{q}{b};" for q in (
                'way["highway"]', 'way["railway"~"^(rail|light_rail|subway|tram)$"]',
                'way["waterway"~"^(river|stream|canal)$"]',
                'way["natural"~"^(water|wood|scrub)$"]', 'relation["natural"="water"]',
                'way["leisure"~"^(park|nature_reserve|golf_course|pitch|playground|garden)$"]',
                'relation["leisure"~"^(park|nature_reserve)$"]',
                'way["landuse"~"^(forest|cemetery|recreation_ground|reservoir|basin|industrial|commercial|retail|residential|farmland|orchard|vineyard|meadow|grass)$"]',
                'way["amenity"~"^(school|college|university|hospital|library|community_centre)$"]',
                'relation["amenity"~"^(school|college|university|hospital)$"]',
                'way["aeroway"~"^(aerodrome|runway)$"]',
                'way["building"]',
                'node["place"]', 'node["amenity"~"^(school|college|university|hospital|library|community_centre|bus_station)$"]',
                'node["highway"~"^(bus_stop|traffic_signals|crossing)$"]',
                'node["railway"~"^(station|halt|tram_stop)$"]', 'node["public_transport"="platform"]',
            )
        )
    query = f"[out:xml][timeout:180];({body});(._;>;);out body;"
    path = cache.path("overpass" + query, ".osm")
    if not path.exists() or path.stat().st_size < 200:
        last = None
        for url in OVERPASS:
            try:
                r = _get(url, data={"data": query}, timeout=240, tries=2)
                if b"<osm" not in r.content[:400]:
                    raise RuntimeError("Overpass did not return OSM XML: " + r.text[:200])
                path.write_bytes(r.content)
                last = None
                break
            except Offline:
                raise
            except Exception as err:  # try the next mirror
                last = err
        if last:
            raise RuntimeError(f"All Overpass endpoints failed: {last}")
    cache.record(name, publisher="OpenStreetMap contributors", license="ODbL 1.0",
                 url="https://www.openstreetmap.org", access="Overpass API", query=query,
                 credit="© OpenStreetMap contributors")
    return path


def osm_layers(osm_path, to_epsg):
    """Convert an .osm file to {'points','lines','multipolygons'} feature lists in to_epsg."""
    conf = Path(tempfile.gettempdir()) / "tgis_osmconf.ini"
    conf.write_text(OSMCONF)
    gdal.SetConfigOption("OSM_CONFIG_FILE", str(conf))
    gdal.SetConfigOption("OSM_MAX_TMPFILE_SIZE", "1024")
    tmp = Path(osm_path).with_suffix(f".{to_epsg}.gpkg")      # kept beside the download, so later runs skip the conversion
    if not tmp.exists() or tmp.stat().st_mtime < Path(osm_path).stat().st_mtime:
        part = tmp.with_suffix(".part.gpkg")
        if part.exists():
            part.unlink()
        # ogr2ogr reads the OSM driver in the interleaved mode it needs.
        gdal.VectorTranslate(str(part), str(osm_path), format="GPKG", layers=["points", "lines", "multipolygons"],
                             dstSRS=f"EPSG:{to_epsg}", layerCreationOptions=["SPATIAL_INDEX=NO"])
        part.replace(tmp)
    out = {}
    for name in ("points", "lines", "multipolygons"):
        try:
            feats, _, _ = vec.read(tmp, name)
        except ValueError:
            feats = []
        out[name] = feats
    return out


# ------------------------------------------------------------------ ArcGIS REST

def arcgis_layer(url, cache: Cache, where="1=1", bbox4326=None, fields="*", name=None, max_features=200000):
    """Download every feature of an ArcGIS REST layer (FeatureServer/N or MapServer/N).

    Pages with resultOffset. Asks for GeoJSON and falls back to Esri JSON for old
    servers. Returns (features in EPSG:4326, layer metadata).
    """
    url = url.rstrip("/")
    key = json.dumps([url, where, bbox4326, fields])
    path = cache.path("arcgis" + key, ".json")
    mpath = cache.path("arcgismeta" + url, ".json")
    if mpath.exists() and path.exists():
        meta = json.loads(mpath.read_text())
    else:
        meta = _get(url, params={"f": "json"}).json()
        if "error" in meta:
            raise RuntimeError(f"{url}: {meta['error']}")
        mpath.write_text(json.dumps(meta))
    if not path.exists():
        page = min(int(meta.get("maxRecordCount") or 1000), 2000)
        base = {"where": where, "outFields": fields, "outSR": 4326, "returnGeometry": "true"}
        if bbox4326:
            base.update(geometry=",".join(str(v) for v in bbox4326), geometryType="esriGeometryEnvelope",
                        inSR=4326, spatialRel="esriSpatialRelIntersects")
        pages, offset, fmt = [], 0, "geojson"
        while True:
            params = dict(base, f=fmt, resultOffset=offset, resultRecordCount=page)
            try:
                r = _get(url + "/query", params=params, tries=2)
            except Offline:
                raise
            except Exception:
                if page <= 10:
                    raise
                page = max(10, page // 5)   # heavy polygons time out in big pages; ask for fewer at a time
                continue
            try:
                js = r.json()
            except ValueError:
                raise RuntimeError(f"{url}: response was not JSON: {r.text[:200]}")
            if "error" in js:
                if fmt == "geojson":
                    fmt = "json"   # old server: fall back to Esri JSON
                    continue
                raise RuntimeError(f"{url}: {js['error']}")
            n = len(js.get("features", []))
            pages.append({"fmt": fmt, "data": js})
            offset += n
            more = js.get("exceededTransferLimit") or (js.get("properties") or {}).get("exceededTransferLimit")
            if n == 0 or not more or offset >= max_features:
                break
        path.write_text(json.dumps(pages))
    feats = []
    for pg in json.loads(path.read_text()):
        if pg["fmt"] == "geojson":
            feats += vec.from_geojson_obj(pg["data"])
        else:
            tmp = Path(tempfile.mkdtemp()) / "esri.json"
            tmp.write_text(json.dumps(pg["data"]))
            f2, _, _ = vec.read(tmp)
            feats += f2
    cache.record(name or meta.get("name", url), publisher=" ".join((meta.get("copyrightText") or "").split())[:160] or "[PUBLISHER NOT STATED BY THE SERVICE]",
                 url=url, query={"where": where, "bbox": bbox4326}, service_name=meta.get("name"),
                 description=(meta.get("description") or "")[:400], count=len(feats))
    return feats, meta


def tiger_layer_id(name_contains: str, cache: Cache = None) -> int:
    lp = cache.root / "tigerweb_layers.json" if cache else None
    if cache:
        cache.used.add("tigerweb_layers.json")
    if lp and lp.exists():
        js = json.loads(lp.read_text())
    else:
        js = _get(TIGERWEB, params={"f": "json"}).json()
        if lp:
            lp.write_text(json.dumps({"layers": js["layers"]}))
    for l in js["layers"]:
        if l["name"].strip().lower() == name_contains.lower():
            return l["id"]
    for l in js["layers"]:
        if name_contains.lower() in l["name"].lower() and "label" not in l["name"].lower():
            return l["id"]
    raise RuntimeError(f"TIGERweb has no layer named like {name_contains!r}")


def tiger(layer_name, cache: Cache, where="1=1", bbox4326=None, fields="*", name=None):
    lid = tiger_layer_id(layer_name, cache)
    feats, meta = arcgis_layer(f"{TIGERWEB}/{lid}", cache, where=where, bbox4326=bbox4326, fields=fields,
                               name=name or f"tiger_{layer_name}")
    cache.record(name or f"tiger_{layer_name}", publisher="U.S. Census Bureau, TIGERweb (current)",
                 url=f"{TIGERWEB}/{lid}", license="Public domain", query={"where": where, "bbox": bbox4326},
                 credit="U.S. Census Bureau TIGER/Line", count=len(feats))
    return feats


STATE_FIPS = {
    "AL": "01", "AK": "02", "AZ": "04", "AR": "05", "CA": "06", "CO": "08", "CT": "09", "DE": "10", "DC": "11",
    "FL": "12", "GA": "13", "HI": "15", "ID": "16", "IL": "17", "IN": "18", "IA": "19", "KS": "20", "KY": "21",
    "LA": "22", "ME": "23", "MD": "24", "MA": "25", "MI": "26", "MN": "27", "MS": "28", "MO": "29", "MT": "30",
    "NE": "31", "NV": "32", "NH": "33", "NJ": "34", "NM": "35", "NY": "36", "NC": "37", "ND": "38", "OH": "39",
    "OK": "40", "OR": "41", "PA": "42", "RI": "44", "SC": "45", "SD": "46", "TN": "47", "TX": "48", "UT": "49",
    "VT": "50", "VA": "51", "WA": "53", "WV": "54", "WI": "55", "WY": "56", "PR": "72",
}
STATE_NAMES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO",
    "connecticut": "CT", "delaware": "DE", "district of columbia": "DC", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI",
    "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
    "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX",
    "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "puerto rico": "PR",
}


def place_boundary(place: str, cache: Cache):
    """'Winters, CA' or 'Placer County, California' to boundary features (EPSG:4326)."""
    parts = [p.strip() for p in place.split(",")]
    if len(parts) < 2:
        raise ValueError("Write the place as 'Name, ST', for example 'Winters, CA' or 'Placer County, CA'")
    nm, st = parts[0], parts[1]
    st = STATE_NAMES.get(st.lower(), st.upper())
    fips = STATE_FIPS.get(st)
    if not fips:
        raise ValueError(f"Unknown state in place name: {place}")
    safe = nm.replace("'", "''")
    if nm.lower().endswith(" county") or nm.lower().endswith(" parish"):
        layers = ["Counties"]
        where = f"STATE='{fips}' AND NAME='{safe}'"
    else:
        layers = ["Incorporated Places", "Census Designated Places"]
        where = f"STATE='{fips}' AND BASENAME='{safe}'"
    for ln in layers:
        feats = tiger(ln, cache, where=where, name=f"study_area ({place})")
        if feats:
            return feats
    raise RuntimeError(f"TIGERweb returned no boundary for {place!r}. Check the spelling, or give study_area.file or study_area.bbox.")


# --------------------------------------------------------------------------- ACS

def acs(variables: dict, counties: list[tuple[str, str]], cache: Cache, year=2023, geography="tract", key=None):
    """ACS 5-year estimates. Returns {GEOID: {name: value}}.

    variables maps your field name to a Census variable id, for example
    {'pop': 'B01003_001E', 'hh': 'B08201_001E', 'hh_noveh': 'B08201_002E'}.
    counties is a list of (state_fips, county_fips).
    """
    key = key or os.environ.get("CENSUS_API_KEY")
    out = {}
    ids = list(dict.fromkeys(variables.values()))
    geo_for = "tract:*" if geography == "tract" else "block group:*"
    for st, co in sorted(set(counties)):
        params = {"get": ",".join(["NAME"] + ids), "for": geo_for,
                  "in": f"state:{st} county:{co}" + ("" if geography == "tract" else " tract:*")}
        if key:
            params["key"] = key
        url = f"https://api.census.gov/data/{year}/acs/acs5"
        path = cache.path("acs" + json.dumps([url, params]), ".json")
        if not path.exists():
            text = _get(url, params=params).text
            if not text.lstrip().startswith("["):
                if "Missing Key" in text or "missing_key" in text or not key:
                    raise RuntimeError("The Census API needs a key. Get a free one at https://api.census.gov/data/key_signup.html "
                                       "and set the CENSUS_API_KEY environment variable, or use an ArcGIS REST source instead "
                                       "(see references/data-sources.md).")
                raise RuntimeError("Census API did not return data: " + text[:200])
            path.write_text(text)
        rows = json.loads(path.read_text())
        head = rows[0]
        for row in rows[1:]:
            rec = dict(zip(head, row))
            geoid = rec["state"] + rec["county"] + rec["tract"] + (rec.get("block group") or "")
            vals = {}
            for nm, vid in variables.items():
                try:
                    v = float(rec[vid])
                    vals[nm] = None if v <= -666666 else v   # Census sentinel for missing
                except (TypeError, ValueError):
                    vals[nm] = None
            out[geoid] = vals
        cache.record(f"acs_{year}_{st}{co}_{geography}", publisher="U.S. Census Bureau",
                     dataset=f"American Community Survey {year - 4} to {year} 5-year estimates",
                     url=url, query=params.get("get"), license="Public domain",
                     credit=f"U.S. Census Bureau, ACS {year - 4} to {year} 5-year estimates")
    return out


# -------------------------------------------------------------------------- GTFS

def gtfs(source, cache: Cache, name="gtfs"):
    """GTFS zip (path or URL) to (route line features, stop point features) in EPSG:4326."""
    if str(source).startswith("http"):
        path = cache.path("gtfs" + str(source), ".zip")
        if not path.exists():
            path.write_bytes(_get(source).content)
    else:
        path = Path(source)
    z = zipfile.ZipFile(path)

    def table(n):
        if n not in z.namelist():
            return []
        return list(csv.DictReader(io.TextIOWrapper(z.open(n), encoding="utf-8-sig")))

    routes = {r["route_id"]: r for r in table("routes.txt")}
    shape_route = {}
    for t in table("trips.txt"):
        if t.get("shape_id"):
            shape_route.setdefault(t["shape_id"], t["route_id"])
    pts = {}
    for s in table("shapes.txt"):
        pts.setdefault(s["shape_id"], []).append((int(s["shape_pt_sequence"]), float(s["shape_pt_lon"]), float(s["shape_pt_lat"])))
    lines = []
    for sid, seq in pts.items():
        r = routes.get(shape_route.get(sid, ""), {})
        g = ogr.Geometry(ogr.wkbLineString)
        for _, x, y in sorted(seq):
            g.AddPoint_2D(x, y)
        lines.append((g, {"route_id": r.get("route_id"), "route_short_name": r.get("route_short_name"),
                          "route_long_name": r.get("route_long_name"), "route_type": r.get("route_type"),
                          "route_color": ("#" + r["route_color"]) if r.get("route_color") else None, "shape_id": sid}))
    stops = []
    for s in table("stops.txt"):
        try:
            g = ogr.Geometry(ogr.wkbPoint)
            g.AddPoint_2D(float(s["stop_lon"]), float(s["stop_lat"]))
        except (KeyError, ValueError):
            continue
        stops.append((g, {"stop_id": s.get("stop_id"), "stop_name": s.get("stop_name"), "stop_code": s.get("stop_code")}))
    cache.record(name, publisher="Transit agency GTFS feed", url=str(source), count=len(lines) + len(stops))
    return lines, stops
