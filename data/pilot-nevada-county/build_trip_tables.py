#!/usr/bin/env python3
"""
Build trip generation and OD tables for Nevada County pilot from LODES/Census data.
Produces zone-level employment, population, and a gravity-model trip table.
"""
import geopandas as gpd
import pandas as pd
import numpy as np
import json
import os

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
PKG_DIR = os.path.join(DATA_DIR, "package")

# ── 1. Load zones ────────────────────────────────────────────────────────
print("Loading zones...")
zones = gpd.read_file(os.path.join(PKG_DIR, "zones.geojson"))
zone_geoids = set(zones["GEOID"].values)
print(f"  {len(zones)} zones loaded")
print(f"  GEOIDs: {sorted(zone_geoids)[:5]}... (tract-level, e.g. 06057000100)")

# ── 2. Load LODES WAC (Workplace Area Characteristics) ───────────────────
print("\nLoading LODES workplace employment data...")
wac = pd.read_csv(os.path.join(DATA_DIR, "ca_wac_S000_JT00_2021.csv.gz"))
print(f"  Total CA blocks: {len(wac)}")

# LODES uses Census block (15 chars), we need to aggregate to tract (11 chars)
wac["tract_geoid"] = wac["w_geocode"].astype(str).str.zfill(15).str[:11]

# Filter to Nevada County tracts
wac_nev = wac[wac["tract_geoid"].isin(zone_geoids)].copy()
print(f"  Nevada County blocks: {len(wac_nev)}")

# Aggregate employment by tract
# C000 = total jobs, CNS01-CNS20 = jobs by NAICS sector
emp_by_tract = wac_nev.groupby("tract_geoid").agg(
    total_jobs=("C000", "sum"),
    retail_jobs=("CNS07", "sum"),      # Retail Trade
    health_jobs=("CNS12", "sum"),      # Health Care
    education_jobs=("CNS15", "sum"),   # Education
    accommodation_jobs=("CNS18", "sum"), # Accommodation/Food
    govt_jobs=("CNS20", "sum"),        # Public Admin
).reset_index()
emp_by_tract.rename(columns={"tract_geoid": "GEOID"}, inplace=True)

print(f"\n  Employment by tract:")
print(f"    Total jobs in county: {emp_by_tract['total_jobs'].sum():,}")
for _, row in emp_by_tract.iterrows():
    if row["total_jobs"] > 500:
        print(f"    {row['GEOID']}: {row['total_jobs']:,} jobs")

# ── 3. Load LODES OD (Origin-Destination) ────────────────────────────────
print("\nLoading LODES OD flows (this may take a moment)...")
# Read in chunks to filter quickly
od_chunks = []
for chunk in pd.read_csv(os.path.join(DATA_DIR, "ca_od_main_JT00_2021.csv.gz"), chunksize=500000):
    chunk["o_tract"] = chunk["w_geocode"].astype(str).str.zfill(15).str[:11]
    chunk["d_tract"] = chunk["h_geocode"].astype(str).str.zfill(15).str[:11]
    # Keep flows where at least one end is in Nevada County
    mask = chunk["o_tract"].isin(zone_geoids) | chunk["d_tract"].isin(zone_geoids)
    if mask.any():
        od_chunks.append(chunk[mask][["o_tract", "d_tract", "S000"]].copy())

od_nev = pd.concat(od_chunks, ignore_index=True)
print(f"  Flows involving Nevada County: {len(od_nev):,}")

# Aggregate to tract-to-tract
od_tract = od_nev.groupby(["o_tract", "d_tract"]).agg(
    total_flow=("S000", "sum")
).reset_index()

# Filter to internal flows only (both ends within county)
od_internal = od_tract[
    od_tract["o_tract"].isin(zone_geoids) & od_tract["d_tract"].isin(zone_geoids)
].copy()
print(f"  Internal tract-to-tract OD pairs: {len(od_internal):,}")
print(f"  Total internal commute trips: {od_internal['total_flow'].sum():,}")

# ── 4. Estimate population by tract (from ACS via Census API or proxy) ───
# Use a simple proxy: residential employment ratio + LODES RAC if available
# For now, use a standard population-to-employment ratio for rural CA (~2.5:1)
# This will be replaced with real ACS data in calibration pass
POP_EMP_RATIO = 2.5
emp_by_tract["est_population"] = (emp_by_tract["total_jobs"] * POP_EMP_RATIO).astype(int)
# Nevada County actual pop ~102,000 per Census. Adjust if needed.
actual_pop = 102000
est_total_pop = emp_by_tract["est_population"].sum()
if est_total_pop > 0:
    scale = actual_pop / est_total_pop
    emp_by_tract["est_population"] = (emp_by_tract["est_population"] * scale).astype(int)
print(f"\n  Estimated population: {emp_by_tract['est_population'].sum():,} (scaled to ~102k)")

# ── 5. Build zone attribute table ────────────────────────────────────────
zone_attrs = zones[["GEOID", "NAMELSAD", "zone_id", "centroid_lon", "centroid_lat", "area_sq_mi"]].merge(
    emp_by_tract, on="GEOID", how="left"
).fillna(0)

zone_attrs.to_csv(os.path.join(PKG_DIR, "zone_attributes.csv"), index=False)
print(f"\n  Exported: zone_attributes.csv ({len(zone_attrs)} zones)")

# ── 6. Build OD trip matrix ──────────────────────────────────────────────
print("\nBuilding OD trip matrix...")

# Map GEOIDs to zone_ids
geoid_to_zone = dict(zip(zones["GEOID"], zones["zone_id"]))
od_internal["o_zone"] = od_internal["o_tract"].map(geoid_to_zone)
od_internal["d_zone"] = od_internal["d_tract"].map(geoid_to_zone)
od_internal = od_internal.dropna(subset=["o_zone", "d_zone"])
od_internal["o_zone"] = od_internal["o_zone"].astype(int)
od_internal["d_zone"] = od_internal["d_zone"].astype(int)

# Create matrix
n_zones = len(zones)
trip_matrix = np.zeros((n_zones, n_zones))
for _, row in od_internal.iterrows():
    i = row["o_zone"] - 1
    j = row["d_zone"] - 1
    trip_matrix[i, j] = row["total_flow"]

# Apply expansion factor: LODES is work trips only
# Typical expansion: work trips ~25% of total daily trips
EXPANSION_FACTOR = 4.0
trip_matrix_expanded = trip_matrix * EXPANSION_FACTOR

# Save as CSV
zone_ids = sorted(zones["zone_id"].values)
od_df = pd.DataFrame(trip_matrix_expanded, index=zone_ids, columns=zone_ids)
od_df.index.name = "origin_zone"
od_df.to_csv(os.path.join(PKG_DIR, "od_trip_matrix.csv"))
print(f"  Exported: od_trip_matrix.csv ({n_zones}x{n_zones})")
print(f"  Total daily trips (expanded): {trip_matrix_expanded.sum():,.0f}")
print(f"    of which work trips: {trip_matrix.sum():,.0f}")

# ── 7. Summary stats ─────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("TRIP GENERATION TABLES — BUILD COMPLETE")
print("=" * 60)
print(f"  Zones: {n_zones}")
print(f"  Total employment: {emp_by_tract['total_jobs'].sum():,}")
print(f"  Estimated population: {emp_by_tract['est_population'].sum():,}")
print(f"  Internal OD pairs: {len(od_internal):,}")
print(f"  Total daily trip estimate: {trip_matrix_expanded.sum():,.0f}")
print(f"  Expansion factor: {EXPANSION_FACTOR}x (work → all purposes)")
print(f"  Output: {PKG_DIR}/")
print("=" * 60)
print("\nCAVEATS:")
print("  - Population is estimated from employment ratio, not ACS")
print("  - OD matrix is LODES work trips × expansion factor")
print("  - External trips not included (county boundary = closed)")
print("  - No time-of-day factoring in this version")
