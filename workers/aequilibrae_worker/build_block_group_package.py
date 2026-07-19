#!/usr/bin/env python3
"""Build a KEYLESS block-group (sub-tract TAZ) worker package from a tract package.

Disaggregates a tract package's ACS population/households to its census block
groups by LODES residence share (RAC), takes block-group jobs from LODES WAC,
and builds a production-scale gravity OD over the finer zones. This is the
offline/reproducible path that needs no CENSUS key (it reuses an existing tract
package's real population); the live dynamic path is
generate_package(zone_geography="block_group").

Usage:
    python build_block_group_package.py [TRACT_PKG_DIR] [OUT_PKG_DIR] [minlon minlat maxlon maxlat]

Defaults build the Nevada County block-group pilot from the tract pilot.
"""
import json
import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import data_pipeline as dp
import lodes

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "data"))
TRACT_PKG = sys.argv[1] if len(sys.argv) > 1 else os.path.join(_ROOT, "pilot-nevada-county", "package")
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(_ROOT, "pilot-nevada-county-bg", "package")
BBOX = tuple(float(a) for a in sys.argv[3:7]) if len(sys.argv) >= 7 else (-121.30, 39.00, -120.00, 39.50)
CACHE = os.path.join(os.path.dirname(__file__), ".lodes_cache")


def main() -> None:
    os.makedirs(OUT, exist_ok=True)

    tz = pd.read_csv(os.path.join(TRACT_PKG, "zone_attributes.csv"))
    # Some tract packages stored GEOIDs numerically, dropping the leading zero of
    # 06057…; pad back to the canonical 11-digit tract GEOID so BG parents match.
    tz["GEOID"] = tz["GEOID"].astype(str).str.zfill(11)
    print(f"tracts: {len(tz)}  pop={tz['est_population'].sum():,.0f}  hh={tz['households'].sum():,.0f}")

    bg = dp.fetch_block_groups_for_study_area(BBOX)
    bg = bg[bg["parent_tract"].isin(set(tz["GEOID"]))].reset_index(drop=True)
    print(f"block groups: {len(bg)} across {bg['parent_tract'].nunique()} parent tracts")

    states = {g[:2] for g in tz["GEOID"]}
    residents_by_bg: dict[str, int] = {}
    jobs_by_bg: dict[str, int] = {}
    for fips in sorted(states):
        abbr = lodes.STATE_FIPS_TO_ABBR.get(fips)
        if not abbr:
            continue
        residents_by_bg.update(lodes.aggregate_rac_by_block_group(lodes.download_lodes_rac(abbr, cache_dir=CACHE)))
        jobs_by_bg.update(lodes.aggregate_wac_jobs_by_block_group(lodes.download_lodes_wac(abbr, cache_dir=CACHE)))

    zones = dp.disaggregate_tracts_to_block_groups(tz, bg, residents_by_bg=residents_by_bg, jobs_by_bg=jobs_by_bg)
    assert zones["est_population"].sum() == int(round(tz["est_population"].sum())), "population marginal drift"
    print(f"BG zones: {len(zones)}  pop={zones['est_population'].sum():,.0f}  jobs={zones['total_jobs'].sum():,.0f}")

    od = dp.build_daily_od_matrix(zones, od_by_pair=None, od_meta=None)
    arr = np.asarray(od.to_numpy(), dtype=float)
    intr = float(np.trace(arr))
    print(f"OD total={arr.sum():,.0f} ({arr.sum()/zones['est_population'].sum():.2f}/capita)  "
          f"intrazonal={intr:,.0f} ({intr / arr.sum() * 100:.1f}%)")

    zones.to_csv(os.path.join(OUT, "zone_attributes.csv"), index=False)
    zids = [int(v) for v in zones["zone_id"].tolist()]
    pd.DataFrame(np.round(arr).astype(int), index=pd.Index(zids, name="origin_zone"),
                 columns=[str(v) for v in zids]).to_csv(os.path.join(OUT, "od_trip_matrix.csv"))

    cent = {"type": "FeatureCollection", "name": "zone_centroids", "features": [
        {"type": "Feature",
         "properties": {"GEOID": r.GEOID, "NAMELSAD": r.NAMELSAD, "zone_id": int(r.zone_id)},
         "geometry": {"type": "Point", "coordinates": [float(r.centroid_lon), float(r.centroid_lat)]}}
        for r in zones.itertuples(index=False)]}
    with open(os.path.join(OUT, "zone_centroids.geojson"), "w") as fh:
        json.dump(cent, fh)

    geo_by_geoid = dict(zip(bg["geoid"].astype(str), bg["geometry_geojson"]))
    polys = {"type": "FeatureCollection", "name": "zones", "features": [
        {"type": "Feature",
         "properties": {"GEOID": r.GEOID, "NAMELSAD": r.NAMELSAD, "zone_id": int(r.zone_id)},
         "geometry": geo_by_geoid.get(str(r.GEOID))}
        for r in zones.itertuples(index=False)]}
    with open(os.path.join(OUT, "zones.geojson"), "w") as fh:
        json.dump(polys, fh)

    manifest = {
        "package_name": os.path.basename(os.path.dirname(OUT)) or "block-group-package",
        "version": "1.0.0-bg", "calibration_status": "uncalibrated",
        "zone_geography": "block_group",
        "total_population": int(zones["est_population"].sum()),
        "zones": int(len(zones)), "bbox": list(BBOX),
        "provenance": (
            "Block-group TAZs: TIGERweb geometry; parent-tract ACS population "
            "disaggregated by LODES RAC residence share (keyless, marginal-preserving); "
            "block-group jobs from LODES WAC. Screening-grade, NOT ACS-measured BG population."
        ),
    }
    with open(os.path.join(OUT, "manifest.json"), "w") as fh:
        json.dump(manifest, fh, indent=2)
    print(f"wrote block-group package to {OUT}")


if __name__ == "__main__":
    main()
