#!/usr/bin/env python3
"""Build an AADT validation/calibration count set for a study corridor from a
registered state-DOT AADT source (scripts/modeling/count_sources.py), matched to
the actual model network (a built AequilibraE project DB) so candidate link
names/types are real.

Provenance — publishing agency, station-id namespace, route label, count
vintage — comes from the source registry entry for the region being built, never
from a default. A count set carries the name of the DOT that actually published
it; a WSDOT or CDOT count must never reach an evidence packet wearing another
agency's attribution.

observed_volume = max(BACK_AADT, AHEAD_AADT): reproduces all three of the
original hand-picked Nevada County stations exactly (the mainline / higher-volume
segment), so the rule is validated against that baseline. Every value and
coordinate is real DOT data — nothing synthesized.
"""
import argparse
import csv
import json
import os
import re
import sqlite3

import count_sources

SPATIALITE = os.getenv("SPATIALITE_LIBRARY_PATH", "/usr/lib/x86_64-linux-gnu/mod_spatialite.so")

MAJOR_TYPES = ("motorway", "trunk", "primary", "secondary", "tertiary")
NEAR_M = 160.0        # radius to gather candidate route links (metres)
BOX_DEG = 0.0035      # station bbox half-size (~300m E-W, ~390m N-S at 39N)
CLASS_RANK = {"motorway": 5, "trunk": 4, "primary": 3, "secondary": 2, "tertiary": 1}
# Per-route plausible OSM classes — a small factual prior that disambiguates at
# multi-route junctions (California's SR-174 is a 2-lane secondary highway, never
# a freeway, so an SR-174 count near the SR-20 junction must not match the SR-20
# motorway). Keyed by region first because route numbers repeat across states:
# Washington's SR-20 is a different road than California's. A region with no
# entry gets no prior — every major class stays plausible.
ROUTE_CLASSES = {
    "CA": {
        "20": {"motorway", "trunk", "primary", "secondary"},
        "49": {"motorway", "trunk", "primary", "secondary"},
        "174": {"secondary", "primary", "tertiary"},
    },
}


def _as_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def load_points(geojson_path):
    d = json.load(open(geojson_path))
    uniq = {}
    for f in d["features"]:
        p, g = f["properties"], f.get("geometry")
        if not g:
            continue
        # Postmile/milepost is optional: not every DOT feed publishes one, and a
        # station without it is still a real count. It only ever names the
        # station, so a missing value falls back to the coordinate (see row()).
        pm = _as_float(p.get("PM"))
        key = (str(p.get("RTE") or ""), round(pm, 3) if pm is not None else None,
               p.get("DESCRIPTION") or "")
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
            uniq[key] = {"rte": str(p.get("RTE") or ""), "pm": pm,
                         "desc": p.get("DESCRIPTION") or "",
                         "obs": obs, "lon": float(lon), "lat": float(lat)}
    return list(uniq.values())


def route_link(conn, region, rte, lon, lat):
    """The route's OSM link at a count point: among nearby major links whose
    class is plausible for this route in this region, the highest road class,
    nearest-first. Returns (name, link_type, dist_m) or None. Class-then-distance
    ordering picks the route mainline over a closer lower-class cross-street."""
    allowed = ROUTE_CLASSES.get(region, {}).get(str(rte), set(MAJOR_TYPES))
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


def station_row(pt, prov, route_name, route_type, exclude_name):
    """One output CSV row for a matched count point.

    Pure, and the ONLY place a count's provenance is stamped: agency, station-id
    namespace, route label and vintage all come from `prov` (the registry entry
    for the region actually being built), so this can be checked without a
    network fetch or a built project DB."""
    rte = pt["rte"]
    facility = f"{prov['route_label_prefix']} {rte}".strip()
    desc = (pt.get("desc") or "").strip()
    # Postmile names the station when the feed publishes one; otherwise the
    # coordinate does, which every station has.
    if pt.get("pm") is not None:
        tag = "PM" + re.sub(r"[^0-9]", "_", "{:.3f}".format(pt["pm"]))
    else:
        tag = "AT" + re.sub(r"[^0-9]", "_", "{:.5f}_{:.5f}".format(pt["lon"], pt["lat"]))
    vintage = prov.get("count_year")
    notes = f"{prov['name']}; observed=max(back,ahead); network-derived candidates"
    if vintage is None:
        # Say so rather than let a blank year read as an oversight — or worse,
        # let some other source's year be assumed for it.
        notes += "; count vintage not published by this source"
    return {
        "station_id": f"{prov['station_prefix']}_RTE{rte}_{tag}",
        "label": f"{facility} at {desc.title()}" if desc else facility,
        "facility_name": facility,
        "count_year": vintage if vintage is not None else "",
        "count_type": "AADT",
        "direction": "two_way",
        "observed_volume": pt["obs"],
        "source_agency": prov["agency"],
        "source_description": desc,
        "candidate_model_names": route_name,
        "candidate_link_types": route_type,
        "exclude_model_names": exclude_name,
        "bbox_min_lon": round(pt["lon"] - BOX_DEG, 5),
        "bbox_min_lat": round(pt["lat"] - BOX_DEG, 5),
        "bbox_max_lon": round(pt["lon"] + BOX_DEG, 5),
        "bbox_max_lat": round(pt["lat"] + BOX_DEG, 5),
        "notes": notes,
    }


def main():
    ap = argparse.ArgumentParser(description="Build a DOT AADT count set for any corridor in a registered region.")
    ap.add_argument("--geojson", help="Pre-fetched AADT GeoJSON (RTE/PM/DESCRIPTION/BACK_AADT/AHEAD_AADT).")
    ap.add_argument("--fetch-bbox", help="minlon,minlat,maxlon,maxlat — fetch AADT via count_sources instead of --geojson")
    # Required, with no default: the region decides whose name goes on every row,
    # so guessing it would mean publishing counts under an agency that never
    # produced them. A pre-fetched --geojson must declare its region too.
    ap.add_argument("--region", required=True,
                    help="Count-source region key — supplies the publishing agency (see count_sources.COUNT_SOURCES)")
    ap.add_argument("--db", required=True, help="A built AequilibraE project_database.sqlite (for real link names/types)")
    ap.add_argument("--out", required=True, help="Output counts CSV path")
    args = ap.parse_args()

    # Fails closed on an unregistered region — before any fetch or file write.
    prov = count_sources.source_provenance(args.region)

    # Source the AADT: either a pre-fetched GeoJSON, or fetch live from the
    # region's DOT FeatureServer via the count-source registry (multi-state).
    geojson_path = args.geojson
    if args.fetch_bbox:
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
    # Stations without a postmile sort last within their route, deterministically.
    for pt in sorted(pts, key=lambda x: (x["rte"], x["pm"] is None, x["pm"] or 0.0)):
        rl = route_link(conn, args.region, pt["rte"], pt["lon"], pt["lat"])
        if not rl:
            unmatched.append(pt)
            continue
        route_name, route_type, _ = rl
        excl = cross_street_exclude(pt["desc"], [route_name])
        out_rows.append(station_row(pt, prov, route_name, route_type, excl))
    conn.close()

    with open(args.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(out_rows)

    print(f"source: {prov['name']} (agency {prov['agency']}, region {prov['region']})")
    print(f"points with AADT: {len(pts)} | stations written: {len(out_rows)} | no nearby major link: {len(unmatched)}")
    for u in unmatched:
        print(f"  unmatched: RTE {u['rte']} PM {u['pm']} {u['desc']} ({u['lon']:.4f},{u['lat']:.4f})")
    # Eyeball check for the operator: the heaviest stations are the ones a bad
    # count→link match distorts most, so they are worth reading before use.
    for r in sorted(out_rows, key=lambda r: r["observed_volume"], reverse=True)[:3]:
        print(f"  top station {r['station_id']}: observed={r['observed_volume']} ({r['label']})")


if __name__ == "__main__":
    main()
