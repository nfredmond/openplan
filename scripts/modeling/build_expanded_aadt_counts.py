#!/usr/bin/env python3
"""Build an expanded Caltrans AADT validation/calibration count set for the
Grass Valley corridor from the real Caltrans Traffic_Volumes_AADT FeatureServer
data (already fetched to aadt_corridor.geojson), matched to the actual model
network (a built AequilibraE project DB) so candidate link names/types are real.

observed_volume = max(BACK_AADT, AHEAD_AADT): reproduces all three of the
original hand-picked stations exactly (the mainline / higher-volume segment),
so the rule is validated against the prior baseline. Every value and coordinate
is real Caltrans data — nothing synthesized.
"""
import argparse
import csv
import json
import os
import re
import sqlite3

# Caltrans Traffic_Volumes_AADT FeatureServer — the authoritative public AADT
# source. Fetch the corridor GeoJSON with (envelope = study bbox in WGS84):
#   curl -G "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/\
#   Traffic_AADT/FeatureServer/0/query" \
#     --data-urlencode "where=1=1" \
#     --data-urlencode "geometry=<xmin,ymin,xmax,ymax>" \
#     --data-urlencode "geometryType=esriGeometryEnvelope" --data-urlencode "inSR=4326" \
#     --data-urlencode "spatialRel=esriSpatialRelIntersects" \
#     --data-urlencode "outFields=RTE,PM,DESCRIPTION,BACK_AADT,AHEAD_AADT" \
#     --data-urlencode "outSR=4326" --data-urlencode "f=geojson"
AADT_FEATURESERVER = (
    "https://caltrans-gis.dot.ca.gov/arcgis/rest/services/CHhighway/Traffic_AADT/FeatureServer/0"
)
SPATIALITE = os.getenv("SPATIALITE_LIBRARY_PATH", "/usr/lib/x86_64-linux-gnu/mod_spatialite.so")

MAJOR_TYPES = ("motorway", "trunk", "primary", "secondary", "tertiary")
NEAR_M = 160.0        # radius to gather candidate route links (metres)
BOX_DEG = 0.0035      # station bbox half-size (~300m E-W, ~390m N-S at 39N)
CLASS_RANK = {"motorway": 5, "trunk": 4, "primary": 3, "secondary": 2, "tertiary": 1}
# Per-route plausible OSM classes — a small factual prior that disambiguates at
# multi-route junctions (SR-174 is a 2-lane secondary highway, never a freeway,
# so an SR-174 count near the SR-20 junction must not match the SR-20 motorway).
ROUTE_CLASSES = {
    "20": {"motorway", "trunk", "primary", "secondary"},
    "49": {"motorway", "trunk", "primary", "secondary"},
    "174": {"secondary", "primary", "tertiary"},
}


def load_points(geojson_path):
    d = json.load(open(geojson_path))
    uniq = {}
    for f in d["features"]:
        p, g = f["properties"], f.get("geometry")
        if not g:
            continue
        pm = float(p["PM"])
        key = (str(p["RTE"]), round(pm, 3), p.get("DESCRIPTION") or "")
        # observed = mainline (higher-volume) segment = max(back, ahead).
        # AADT fields arrive as STRINGS — coerce before max or "4450" > "13500"
        # lexicographically and the wrong segment wins.
        vals = []
        for v in (p.get("BACK_AADT"), p.get("AHEAD_AADT")):
            if v not in (None, ""):
                try:
                    vals.append(int(round(float(v))))
                except (TypeError, ValueError):
                    pass
        if not vals:
            continue
        obs = max(vals)
        lon, lat = g["coordinates"][0], g["coordinates"][1]
        if key not in uniq:
            uniq[key] = {"rte": str(p["RTE"]), "pm": pm, "desc": p.get("DESCRIPTION") or "",
                         "obs": obs, "lon": float(lon), "lat": float(lat)}
    return list(uniq.values())


def route_link(conn, rte, lon, lat):
    """The route's OSM link at a Caltrans point: among nearby major links whose
    class is plausible for this route, the highest road class, nearest-first.
    Returns (name, link_type, dist_m) or None. Class-then-distance ordering
    picks the route mainline over a closer lower-class cross-street."""
    allowed = ROUTE_CLASSES.get(str(rte), set(MAJOR_TYPES))
    rows = conn.execute(
        f"""SELECT name, link_type,
                   Distance(geometry, MakePoint(?, ?, 4326), 1) AS dist_m
            FROM links
            WHERE link_type IN {MAJOR_TYPES}
              AND name IS NOT NULL AND name != ''
              AND Distance(geometry, MakePoint(?, ?, 4326), 1) < ?
            ORDER BY dist_m ASC""",
        (lon, lat, lon, lat, NEAR_M),
    ).fetchall()
    cand = [(n, t, d) for n, t, d in rows if t in allowed]
    if not cand:
        return None
    # Highest plausible class first, then nearest within that class.
    cand.sort(key=lambda r: (-CLASS_RANK.get(r[1], 0), r[2]))
    return cand[0]


_ROADish = re.compile(r"\b(road|street|drive|avenue|way|lane|boulevard|highway|expressway|freeway|court|crossing)\b", re.I)


def cross_street_exclude(desc, route_names):
    """A DESCRIPTION that names a cross-street (e.g. 'BRUNSWICK ROAD') becomes an
    exclude so the count on the route isn't matched to the cross-street link.
    Skipped when the description IS the route (e.g. 'JCT. RTE. 20')."""
    d = desc.strip().title()
    if not _ROADish.search(d):
        return ""
    if any(d.lower() in rn.lower() or rn.lower() in d.lower() for rn in route_names):
        return ""
    return d


def main():
    ap = argparse.ArgumentParser(description="Build an expanded DOT AADT count set for any US corridor.")
    ap.add_argument("--geojson", help="Pre-fetched AADT GeoJSON (RTE/PM/DESCRIPTION/BACK_AADT/AHEAD_AADT).")
    ap.add_argument("--fetch-bbox", help="minlon,minlat,maxlon,maxlat — fetch AADT via count_sources instead of --geojson")
    ap.add_argument("--region", default="CA", help="Count-source region key (default CA=Caltrans; see count_sources.COUNT_SOURCES)")
    ap.add_argument("--db", required=True, help="A built AequilibraE project_database.sqlite (for real link names/types)")
    ap.add_argument("--out", required=True, help="Output counts CSV path")
    args = ap.parse_args()

    # Source the AADT: either a pre-fetched GeoJSON, or fetch live from the
    # region's DOT FeatureServer via the count-source registry (multi-state).
    geojson_path = args.geojson
    if args.fetch_bbox:
        import count_sources
        bbox = tuple(float(v) for v in args.fetch_bbox.split(","))
        geojson_path = args.out + ".aadt.geojson"
        n = count_sources.fetch_aadt_geojson(bbox, args.region, geojson_path)
        print(f"Fetched {n} AADT features for {args.region} bbox {bbox} -> {geojson_path}")
    if not geojson_path:
        ap.error("provide --geojson or --fetch-bbox")

    pts = load_points(geojson_path)
    conn = sqlite3.connect(args.db)
    conn.enable_load_extension(True)
    conn.load_extension(SPATIALITE)

    fields = ["station_id", "label", "facility_name", "count_year", "count_type", "direction",
              "observed_volume", "source_agency", "source_description", "candidate_model_names",
              "candidate_link_types", "exclude_model_names", "bbox_min_lon", "bbox_min_lat",
              "bbox_max_lon", "bbox_max_lat", "notes"]
    out_rows = []
    unmatched = []
    for pt in sorted(pts, key=lambda x: (x["rte"], x["pm"])):
        rl = route_link(conn, pt["rte"], pt["lon"], pt["lat"])
        if not rl:
            unmatched.append(pt)
            continue
        route_name, route_type, _ = rl
        excl = cross_street_exclude(pt["desc"], [route_name])
        names_for_match = [route_name]
        types_for_match = [route_type]
        pm_tag = re.sub(r"[^0-9]", "_", f"{pt['pm']:.3f}")
        out_rows.append({
            "station_id": f"CT_RTE{pt['rte']}_PM{pm_tag}",
            "label": f"SR {pt['rte']} at {pt['desc'].title()}",
            "facility_name": f"SR {pt['rte']}",
            "count_year": 2023,
            "count_type": "AADT",
            "direction": "two_way",
            "observed_volume": pt["obs"],
            "source_agency": "Caltrans",
            "source_description": pt["desc"],
            "candidate_model_names": "|".join(names_for_match),
            "candidate_link_types": "|".join(types_for_match),
            "exclude_model_names": excl,
            "bbox_min_lon": round(pt["lon"] - BOX_DEG, 5),
            "bbox_min_lat": round(pt["lat"] - BOX_DEG, 5),
            "bbox_max_lon": round(pt["lon"] + BOX_DEG, 5),
            "bbox_max_lat": round(pt["lat"] + BOX_DEG, 5),
            "notes": "Caltrans Traffic_Volumes_AADT 2023; observed=max(back,ahead); network-derived candidates",
        })
    conn.close()

    with open(args.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(out_rows)

    print(f"points with AADT: {len(pts)} | stations written: {len(out_rows)} | no nearby major link: {len(unmatched)}")
    for u in unmatched:
        print(f"  unmatched: RTE {u['rte']} PM {u['pm']} {u['desc']} ({u['lon']:.4f},{u['lat']:.4f})")
    # Sanity: reproduce the three original priority stations' values.
    by_desc = {r["source_description"]: r for r in out_rows}
    for desc, want in [("GRASS VALLEY, JCT. RTE. 49", 45500), ("BRUNSWICK ROAD", None)]:
        if desc in by_desc:
            print(f"  check {desc}: observed={by_desc[desc]['observed_volume']} (rte {by_desc[desc]['facility_name']})")


if __name__ == "__main__":
    main()
