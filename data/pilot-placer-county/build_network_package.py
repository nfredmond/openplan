#!/usr/bin/env python3
"""
Build the Nevada County pilot network package for OpenPlan.
Extracts road network, census tract zones, and produces GeoJSON artifacts.
"""
import geopandas as gpd
import pandas as pd
import json
import os

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(DATA_DIR, "package")
os.makedirs(OUT_DIR, exist_ok=True)

NEVADA_COUNTY_FIPS = "06061"

# ── 1. Load and filter roads ──────────────────────────────────────────────
print("Loading Placer County roads...")
roads = gpd.read_file(os.path.join(DATA_DIR, "roads", "tl_2023_06061_roads.shp"))
print(f"  Total road segments: {len(roads)}")

# MTFCC codes for functional classification
# S1100 = Primary Road (Interstate/US Highway)
# S1200 = Secondary Road (State Highway)
# S1400 = Local Road
# S1500 = Vehicular Trail (4WD)
# S1630 = Ramp
# S1640 = Service Drive
# S1740 = Internal Census Use
# S1780 = Parking Lot Road
# S1820 = Bike Path
# S1830 = Walkway/Pedestrian Trail
# Filter to drivable roads: S1100, S1200, S1400, S1500, S1630, S1640
DRIVABLE = ["S1100", "S1200", "S1400", "S1500", "S1630", "S1640"]
roads_filtered = roads[roads["MTFCC"].isin(DRIVABLE)].copy()
print(f"  Drivable road segments: {len(roads_filtered)}")

# Classify by functional class
def classify_road(mtfcc, fullname):
    fullname = str(fullname).upper() if fullname else ""
    if mtfcc == "S1100":
        return "interstate"
    elif mtfcc == "S1200":
        if "I-80" in fullname or "I 80" in fullname:
            return "interstate"
        return "state_highway"
    elif mtfcc in ("S1630", "S1640"):
        return "ramp_service"
    elif mtfcc == "S1500":
        return "local_unpaved"
    else:  # S1400
        # Try to identify major arterials by name
        major_names = ["BRUNSWICK", "MILL", "MAIN", "BROAD", "RIDGE", "GOLDEN GATE",
                       "PLEASANT VALLEY", "ALTA SIERRA", "COMBIE", "LIME KILN",
                       "DONNER PASS", "BROCKWAY"]
        for mn in major_names:
            if mn in fullname:
                return "collector"
        return "local"

roads_filtered["func_class"] = roads_filtered.apply(
    lambda r: classify_road(r["MTFCC"], r.get("FULLNAME")), axis=1
)

# Assign default speeds (mph) and capacity (veh/hr/lane) by class
SPEED_MAP = {
    "interstate": 65, "state_highway": 55, "collector": 35,
    "local": 25, "local_unpaved": 15, "ramp_service": 30
}
CAPACITY_MAP = {
    "interstate": 2000, "state_highway": 1200, "collector": 800,
    "local": 400, "local_unpaved": 100, "ramp_service": 1000
}
LANES_MAP = {
    "interstate": 2, "state_highway": 1, "collector": 1,
    "local": 1, "local_unpaved": 1, "ramp_service": 1
}

roads_filtered["speed_mph"] = roads_filtered["func_class"].map(SPEED_MAP)
roads_filtered["capacity_vph"] = roads_filtered["func_class"].map(CAPACITY_MAP)
roads_filtered["lanes"] = roads_filtered["func_class"].map(LANES_MAP)

# Compute segment lengths in miles
roads_projected = roads_filtered.to_crs(epsg=3310)  # CA Albers
roads_filtered["length_mi"] = roads_projected.geometry.length / 1609.34
roads_filtered["travel_time_min"] = (roads_filtered["length_mi"] / roads_filtered["speed_mph"]) * 60

# Summary
print("\n  Road classification summary:")
for cls, count in roads_filtered["func_class"].value_counts().sort_index().items():
    total_mi = roads_filtered[roads_filtered["func_class"] == cls]["length_mi"].sum()
    print(f"    {cls}: {count} segments, {total_mi:.1f} miles")

# Export network
network_cols = ["LINEARID", "FULLNAME", "MTFCC", "func_class", "speed_mph",
                "capacity_vph", "lanes", "length_mi", "travel_time_min", "geometry"]
roads_out = roads_filtered[network_cols].copy()
roads_out = roads_out.to_crs(epsg=4326)  # WGS84 for GeoJSON
roads_out.to_file(os.path.join(OUT_DIR, "network_links.geojson"), driver="GeoJSON")
print(f"\n  Exported: network_links.geojson ({len(roads_out)} links)")

# ── 2. Load and filter census tracts (zones) ─────────────────────────────
print("\nLoading Census tracts...")
tracts = gpd.read_file(os.path.join(DATA_DIR, "tracts", "tl_2023_06_tract.shp"))
nev_tracts = tracts[tracts["COUNTYFP"] == "061"].copy()
print(f"  Placer County tracts: {len(nev_tracts)}")

# Compute centroids for TAZ centroids
nev_tracts_proj = nev_tracts.to_crs(epsg=3310)
centroids = nev_tracts_proj.geometry.centroid.to_crs(epsg=4326)
nev_tracts["centroid_lon"] = centroids.x
nev_tracts["centroid_lat"] = centroids.y
nev_tracts["zone_id"] = range(1, len(nev_tracts) + 1)
nev_tracts["area_sq_mi"] = nev_tracts_proj.geometry.area / (1609.34 ** 2)

# Export zones
zone_cols = ["GEOID", "NAMELSAD", "zone_id", "centroid_lon", "centroid_lat",
             "area_sq_mi", "geometry"]
zones_out = nev_tracts[zone_cols].copy().to_crs(epsg=4326)
zones_out.to_file(os.path.join(OUT_DIR, "zones.geojson"), driver="GeoJSON")
print(f"  Exported: zones.geojson ({len(zones_out)} zones)")

# Export centroid points
centroid_gdf = gpd.GeoDataFrame(
    nev_tracts[["GEOID", "NAMELSAD", "zone_id"]],
    geometry=centroids,
    crs="EPSG:4326"
)
centroid_gdf.to_file(os.path.join(OUT_DIR, "zone_centroids.geojson"), driver="GeoJSON")
print(f"  Exported: zone_centroids.geojson ({len(centroid_gdf)} centroids)")

# ── 3. Define key corridors ──────────────────────────────────────────────
print("\nDefining corridors...")
corridors = [
    {"id": "C01", "name": "SR-49 (North-South)", "route_names": ["State Rte 49"],
     "description": "Primary N-S corridor connecting Auburn to Downieville through Grass Valley and Nevada City"},
    {"id": "C02", "name": "SR-20 (East-West)", "route_names": ["State Rte 20"],
     "description": "E-W corridor connecting Marysville to I-80 via Grass Valley/Nevada City"},
    {"id": "C03", "name": "SR-174", "route_names": ["State Rte 174"],
     "description": "Connector from Grass Valley south to Colfax/I-80"},
    {"id": "C04", "name": "I-80 (Truckee Segment)", "route_names": ["I- 80", "Golden Center Fwy"],
     "description": "Interstate corridor through eastern Nevada County / Truckee area"},
    {"id": "C05", "name": "Brunswick Road", "route_names": ["Brunswick"],
     "description": "Key local arterial in Grass Valley connecting SR-49 to SR-174/south county"},
]

corridor_data = []
for corr in corridors:
    # Match road segments by name
    mask = roads_out["FULLNAME"].str.contains("|".join(corr["route_names"]), case=False, na=False)
    matched = roads_out[mask]
    total_mi = matched["length_mi"].sum()
    corridor_data.append({
        "corridor_id": corr["id"],
        "name": corr["name"],
        "description": corr["description"],
        "segment_count": len(matched),
        "total_miles": round(total_mi, 2)
    })
    print(f"  {corr['id']}: {corr['name']} — {len(matched)} segments, {total_mi:.1f} mi")

with open(os.path.join(OUT_DIR, "corridors.json"), "w") as f:
    json.dump(corridor_data, f, indent=2)
print(f"  Exported: corridors.json")

# ── 4. Build package manifest ────────────────────────────────────────────
print("\nBuilding package manifest...")
manifest = {
    "package_name": "placer-county-accessibility-v1",
    "version": "1.0.0-draft",
    "geography": {
        "name": "Placer County, California",
        "fips": "06061",
        "state_fips": "06",
        "county_fips": "061",
        "bbox": {
            "west": float(roads_out.total_bounds[0]),
            "south": float(roads_out.total_bounds[1]),
            "east": float(roads_out.total_bounds[2]),
            "north": float(roads_out.total_bounds[3])
        }
    },
    "network": {
        "source": "TIGER/Line 2023 Roads (tl_2023_06061_roads)",
        "total_links": len(roads_out),
        "total_miles": round(roads_out["length_mi"].sum(), 1),
        "classification": {k: int(v) for k, v in roads_filtered["func_class"].value_counts().sort_index().items()},
        "crs": "EPSG:4326",
        "file": "network_links.geojson"
    },
    "zones": {
        "source": "TIGER/Line 2023 Census Tracts (tl_2023_06_tract)",
        "count": len(zones_out),
        "type": "Census Tracts",
        "crs": "EPSG:4326",
        "file": "zones.geojson",
        "centroids_file": "zone_centroids.geojson"
    },
    "corridors": {
        "count": len(corridors),
        "file": "corridors.json"
    },
    "calibration_status": "uncalibrated",
    "caveats": [
        "Network attributes (speed, capacity, lanes) are default estimates, not field-verified",
        "Zone boundaries are Census tracts, not custom TAZs",
        "No transit network included in v1",
        "Trip generation will be synthetic (gravity model from Census/LODES data)",
        "All outputs carry 'uncalibrated screening' label until validated against observed counts"
    ],
    "created_at": "2026-03-19",
    "created_by": "Bartholomew Hale (COO), Nat Ford"
}

with open(os.path.join(OUT_DIR, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=2)
print(f"  Exported: manifest.json")

# ── Summary ──────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("PLACER COUNTY PILOT NETWORK PACKAGE — BUILD COMPLETE")
print("=" * 60)
print(f"  Network: {len(roads_out)} links, {roads_out['length_mi'].sum():.1f} total miles")
print(f"  Zones: {len(zones_out)} Census tracts")
print(f"  Corridors: {len(corridors)} defined")
print(f"  Output: {OUT_DIR}/")
print(f"  Calibration: UNCALIBRATED (screening only)")
print("=" * 60)
