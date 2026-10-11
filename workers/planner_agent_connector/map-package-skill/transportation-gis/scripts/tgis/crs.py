"""Pick a projected coordinate system for a study area.

US projects default to the NAD83 State Plane zone in US survey feet, which is what
agencies and ArcGIS Pro users expect. Outside State Plane coverage the fallback is
the NAD83 or WGS84 UTM zone in metres. project.yaml can always state `crs:` outright.
"""
from __future__ import annotations

import re

from pyproj import CRS
from pyproj.aoi import AreaOfInterest
from pyproj.database import query_crs_info


def pick(lon: float, lat: float) -> int:
    aoi = AreaOfInterest(lon - 0.01, lat - 0.01, lon + 0.01, lat + 0.01)
    cands = []
    for c in query_crs_info(auth_name="EPSG", pj_types=["PROJECTED_CRS"], area_of_interest=aoi, contains=True):
        if re.match(r"^NAD83 / .*\(ftUS\)$", c.name) and "BLM" not in c.name and not c.deprecated:
            a = c.area_of_use
            # Zone boxes overlap at their edges, so take the zone whose centre is nearest.
            d = ((a.west + a.east) / 2 - lon) ** 2 + ((a.south + a.north) / 2 - lat) ** 2
            cands.append((d, int(c.code)))
    if cands:
        return sorted(cands)[0][1]
    zone = int((lon + 180) // 6) + 1
    if -170 < lon < -50 and lat > 14:
        return 26900 + zone  # NAD83 / UTM north
    return (32600 if lat >= 0 else 32700) + zone


def describe(epsg: int) -> dict:
    c = CRS.from_epsg(epsg)
    unit = c.axis_info[0].unit_name
    feet = "foot" in unit.lower() or "ft" in unit.lower()
    # US survey foot unless the definition says international foot.
    per_unit_m = c.axis_info[0].unit_conversion_factor
    return {
        "epsg": epsg,
        "name": c.name,
        "unit": "US survey foot" if feet and "US" in unit else unit,
        "is_feet": feet,
        "meters_per_unit": per_unit_m,
        "label": f"{c.name} (EPSG:{epsg})",
    }
