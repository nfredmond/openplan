#!/usr/bin/env python3
"""
AequilibraE Nevada County pilot — v3 (use place_name import for cleaner setup).
"""
import os, json, shutil
import numpy as np
import pandas as pd
from shapely.geometry import box

os.environ["SPATIALITE_LIBRARY_PATH"] = "/home/linuxbrew/.linuxbrew/lib/mod_spatialite"

from aequilibrae import Project
from aequilibrae.matrix import AequilibraeMatrix
from aequilibrae.paths import TrafficAssignment, TrafficClass, NetworkSkimming

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
PKG_DIR = os.path.join(DATA_DIR, "package")
OUT_DIR = os.path.join(DATA_DIR, "run_output")
os.makedirs(OUT_DIR, exist_ok=True)
PROJECT_DIR = os.path.join(DATA_DIR, "aeq_project")

print("=" * 60)
print("AEQUILIBRAE ASSIGNMENT — NEVADA COUNTY PILOT v3")
print("=" * 60)

# ── 1. Create project from OSM ───────────────────────────────────────────
print("\n[1/6] Creating AequilibraE project...")
if os.path.exists(PROJECT_DIR):
    shutil.rmtree(PROJECT_DIR)

project = Project()
project.new(PROJECT_DIR)

# Download from OSM using bounding box (place_name has bugs in AequilibraE 1.6.1)
model_area = box(-121.10, 39.18, -120.95, 39.25)
print("  Downloading OSM network (Grass Valley/Nevada City bbox)...")
project.network.create_from_osm(model_area=model_area, modes=["car"])

num_links = project.network.count_links()
num_nodes = project.network.count_nodes()
print(f"  Network: {num_links} links, {num_nodes} nodes")

# ── 2. Add centroids via the proper AequilibraE API ──────────────────────
print("\n[2/6] Adding zone centroids...")

zones = pd.read_csv(os.path.join(PKG_DIR, "zone_attributes.csv"))

# Use zones whose centroids fall within the model bbox
active_zones = zones[
    (zones["centroid_lon"].between(-121.10, -120.95)) &
    (zones["centroid_lat"].between(39.18, 39.25))
].copy()

active_zones = active_zones.reset_index(drop=True)
n_zones = len(active_zones)
print(f"  Zones within network extent: {n_zones}")

if n_zones < 2:
    print("  ERROR: Need at least 2 zones. Aborting.")
    project.close()
    exit(1)

# Add centroids using AequilibraE's proper API 
# Use IDs that are low (1..N) — these won't collide since the network uses 
# OSM-based internal IDs that are much higher
from shapely.geometry import Point
import sqlite3 as _sql
nodes = project.network.nodes
centroid_ids = []

# Fix the link_id auto-increment counter (AequilibraE OSM bug)
_db_path = os.path.join(PROJECT_DIR, "project_database.sqlite")
_fix_conn = _sql.connect(_db_path)
_fix_conn.enable_load_extension(True)
_fix_conn.load_extension("/home/linuxbrew/.linuxbrew/lib/mod_spatialite")
max_link = _fix_conn.execute("SELECT COALESCE(MAX(link_id),0) FROM links").fetchone()[0]
max_ogc = _fix_conn.execute("SELECT COALESCE(MAX(ogc_fid),0) FROM links").fetchone()[0]
# Reset the SQLite autoincrement sequence
_fix_conn.execute("DELETE FROM sqlite_sequence WHERE name='links'")
_fix_conn.execute("INSERT INTO sqlite_sequence (name, seq) VALUES ('links', ?)", (max(max_link, max_ogc) + 100,))
_fix_conn.commit()
_fix_conn.close()
print(f"  Fixed link_id sequence (was max={max_link}, now starts at {max(max_link, max_ogc) + 101})")

for idx, z in active_zones.iterrows():
    cid = idx + 1  # 1-based
    try:
        c = nodes.new_centroid(cid)
        c.geometry = Point(z["centroid_lon"], z["centroid_lat"])
        c.save()
        # Connect to network
        c.connect_mode("c", connectors=3)
        centroid_ids.append(cid)
    except Exception as e:
        print(f"  Warning: zone {cid} failed: {e}")

print(f"  Added and connected {len(centroid_ids)} centroids")

# ── 3. Build graph and skim ──────────────────────────────────────────────
print("\n[3/6] Building graph...")

project.network.build_graphs()
graph = project.network.graphs["c"]

# Determine cost field
cols = list(graph.graph.columns)
cost_field = "travel_time" if "travel_time" in cols else "free_flow_time"
print(f"  Cost field: {cost_field}")
print(f"  Graph columns: {cols}")

graph.set_graph(cost_field)
graph.set_blocked_centroid_flows(True)

cids = np.array(centroid_ids)
graph.prepare_graph(cids)
print(f"  Graph ready: {graph.num_links} links, {graph.num_nodes} nodes, {len(cids)} centroids")

# Skims
print("  Computing skims...")
graph.set_skimming([cost_field, "distance"])
skimming = NetworkSkimming(graph)
skimming.execute()

skim_mat = skimming.results.skims
time_skim = skim_mat.matrix[cost_field]
valid = time_skim[(time_skim > 0) & np.isfinite(time_skim)]
print(f"  Skim shape: {time_skim.shape}")
if len(valid) > 0:
    print(f"  Avg time: {np.mean(valid):.1f} min, Max: {np.max(valid):.1f} min")
else:
    print("  WARNING: No valid skim entries")

skim_path = os.path.join(OUT_DIR, "travel_time_skims.omx")
skim_mat.export(skim_path)

# ── 4. Load demand ───────────────────────────────────────────────────────
print("\n[4/6] Loading demand...")

od_full = pd.read_csv(os.path.join(PKG_DIR, "od_trip_matrix.csv"), index_col=0)
n = len(centroid_ids)
od_array = np.zeros((n, n))

orig_zone_ids = active_zones["zone_id"].astype(int).values
for i, oi in enumerate(orig_zone_ids):
    for j, oj in enumerate(orig_zone_ids):
        try:
            od_array[i, j] = od_full.iloc[oi - 1, oj - 1]
        except (IndexError, KeyError):
            pass

total_trips = od_array.sum()
print(f"  OD: {n}x{n}, total trips: {total_trips:,.0f}")

demand_path = os.path.join(OUT_DIR, "demand.omx")
demand_mat = AequilibraeMatrix()
demand_mat.create_empty(file_name=demand_path, zones=n, matrix_names=["demand"], memory_only=False)
demand_mat.index = cids
demand_mat.matrix["demand"][:, :] = od_array
demand_mat.computational_view(["demand"])

# ── 5. Assignment ─────────────────────────────────────────────────────────
print("\n[5/6] Running assignment...")

assig = TrafficAssignment()
tc = TrafficClass(name="car", graph=graph, matrix=demand_mat)
tc.set_pce(1.0)
assig.add_class(tc)

assig.set_vdf("BPR")
assig.set_vdf_parameters({"alpha": 0.15, "beta": 4.0})

cap_field = "capacity_ab" if "capacity_ab" in cols else "capacity"
assig.set_capacity_field(cap_field)
assig.set_time_field(cost_field)
assig.max_iter = 100
assig.rgap_target = 0.01
assig.set_algorithm("bfw")

print("  Running BFW...")
assig.execute()

rgap = assig.assignment.rgap
iters = assig.assignment.iteration
print(f"  Done! Gap={rgap:.6f}, Iterations={iters}")

# ── 6. Results ────────────────────────────────────────────────────────────
print("\n[6/6] Extracting results...")

results = assig.results()
link_results = results.get_load_results()
link_results.to_csv(os.path.join(OUT_DIR, "link_volumes.csv"))

evidence = {
    "run_id": "nevada-county-pilot-001",
    "engine": "AequilibraE 1.6.1",
    "network_source": "OpenStreetMap",
    "algorithm": "BFW",
    "vdf": "BPR (alpha=0.15, beta=4.0)",
    "convergence": {"final_gap": float(rgap), "iterations": int(iters), "target_gap": 0.01},
    "network": {"links": int(graph.num_links), "nodes": int(graph.num_nodes), "zones": n},
    "demand": {"total_trips": float(total_trips), "source": "LODES 2021 x4"},
    "skims": {
        "avg_time_min": float(np.mean(valid)) if len(valid) > 0 else None,
        "max_time_min": float(np.max(valid)) if len(valid) > 0 else None
    },
    "calibration_status": "uncalibrated",
    "caveats": [
        "OSM default speeds/capacities",
        "Limited model area (Grass Valley core)",
        "Closed boundary, no external trips",
        "LODES work trips x expansion, screening-grade only"
    ],
    "created_at": "2026-03-19"
}
with open(os.path.join(OUT_DIR, "evidence_packet.json"), "w") as f:
    json.dump(evidence, f, indent=2)

print("\n" + "=" * 60)
print("RUN COMPLETE")
print("=" * 60)
print(f"  Gap={rgap:.6f}, Iters={iters}")
print(f"  {graph.num_links} links, {n} zones, {total_trips:,.0f} trips")
print(f"  Output: {OUT_DIR}/")
print("=" * 60)

project.close()
