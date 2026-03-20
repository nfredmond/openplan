#!/usr/bin/env python3
"""
Run AequilibraE assignment for Nevada County using OSM network import.
This is the correct approach — AequilibraE builds its own topology from OSM.

Steps:
1. Create project + import road network from OSM
2. Add zone centroids and connect them to the network
3. Build graph and run skims
4. Load demand matrix and run traffic assignment
5. Extract link volumes and build evidence packet
"""
import os
import sys
import json
import shutil
import numpy as np
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point, box

os.environ["SPATIALITE_LIBRARY_PATH"] = "/home/linuxbrew/.linuxbrew/lib/mod_spatialite"

from aequilibrae import Project
from aequilibrae.matrix import AequilibraeMatrix
from aequilibrae.paths import TrafficAssignment, TrafficClass, NetworkSkimming

# --- PATCH OSM BUILDER ---
import string
from typing import Tuple
from aequilibrae.project.network.osm.osm_builder import OSMBuilder

def patched_define_link_type(self, link_type: str) -> Tuple[str, str]:
    proj_link_types = self.project.network.link_types
    original_link_type = link_type
    link_type = "".join([x for x in link_type if x in string.ascii_letters + "_"]).lower()

    split = link_type.split("_")
    for i, piece in enumerate(split[1:]):
        if piece in ["link", "segment", "stretch"]:
            link_type = "_".join(split[0 : i + 1])

    if self._OSMBuilder__all_ltp.shape[0] >= 51:
        link_type = "aggregate_link_type"

    if len(link_type) == 0:
        link_type = "empty"

    if link_type in self._OSMBuilder__all_ltp.link_type.values:
        lt = proj_link_types.get_by_name(link_type)
        if lt is not None:
            if original_link_type not in lt.description:
                lt.description += f", {original_link_type}"
                lt.save()
            return [lt.link_type_id, link_type]

    letter = link_type[0]
    if letter in self._OSMBuilder__all_ltp.link_type_id.values:
        letter = letter.upper()
        if letter in self._OSMBuilder__all_ltp.link_type_id.values:
            for letter in string.ascii_letters:
                if letter not in self._OSMBuilder__all_ltp.link_type_id.values:
                    break
    
    # Check if letter is somehow already in proj_link_types
    try:
        lt = proj_link_types.new(letter)
        lt.link_type = link_type
        lt.description = f"Link types from Open Street Maps: {original_link_type}"
        lt.save()
    except Exception:
        lt = proj_link_types.get(letter)
        lt.link_type = link_type
        lt.description = f"Link types from Open Street Maps: {original_link_type}"
        lt.save()
        
    return [letter, link_type]

OSMBuilder._OSMBuilder__define_link_type = patched_define_link_type
# --- END PATCH ---

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
PKG_DIR = os.path.join(DATA_DIR, "package")
OUT_DIR = os.path.join(DATA_DIR, "run_output")
os.makedirs(OUT_DIR, exist_ok=True)
PROJECT_DIR = os.path.join(DATA_DIR, "aeq_project")

print("=" * 60)
print("AEQUILIBRAE ASSIGNMENT — NEVADA COUNTY PILOT (OSM)")
print("=" * 60)

# ── 1. Create project and import from OSM ────────────────────────────────
print("\n[1/6] Creating AequilibraE project from OSM...")

if os.path.exists(PROJECT_DIR):
    shutil.rmtree(PROJECT_DIR)

project = Project()
project.new(PROJECT_DIR)

# Use the fallback geometry: Grass Valley / Nevada City core area
# (full county is too large for OSM download in one shot)
# Bounding box: western Nevada County around GV/NC urban core
# This covers the SR-49/SR-20/SR-174 triangle where most population is
model_area = box(-121.15, 39.15, -120.90, 39.30)

print("  Downloading OSM network for Grass Valley/Nevada City area...")
print("  Bounding box: (-121.15, 39.15) to (-120.90, 39.30)")
project.network.create_from_osm(
    model_area=model_area,
    modes=["car"],
    clean=True
)

# Check what we got
num_links = project.network.count_links()
num_nodes = project.network.count_nodes()
print(f"  Network imported: {num_links} links, {num_nodes} nodes")

# ── 2. Add zone centroids ────────────────────────────────────────────────
print("\n[2/6] Adding zone centroids...")

zones = pd.read_csv(os.path.join(PKG_DIR, "zone_attributes.csv"))

# Filter zones that fall within our model area
zone_mask = (
    (zones["centroid_lon"] >= -121.15) & (zones["centroid_lon"] <= -120.90) &
    (zones["centroid_lat"] >= 39.15) & (zones["centroid_lat"] <= 39.30)
)
active_zones = zones[zone_mask].copy().reset_index(drop=True)
print(f"  Zones within model area: {len(active_zones)} of {len(zones)}")

if len(active_zones) < 2:
    print("  WARNING: Too few zones in model area. Expanding to all county zones...")
    active_zones = zones.copy()

# Find the actual count of nodes (not max ID) and use contiguous IDs
# AequilibraE internal arrays are sized by max node ID — sparse IDs cause OOB
import sqlite3 as _sqlite3
_conn = _sqlite3.connect(os.path.join(PROJECT_DIR, "project_database.sqlite"))
_conn.enable_load_extension(True)
_conn.load_extension("/home/linuxbrew/.linuxbrew/lib/mod_spatialite")
max_node_id = _conn.execute("SELECT MAX(node_id) FROM nodes").fetchone()[0] or 0
node_count = _conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0] or 0

# Renumber all nodes to be contiguous (1..N) to avoid sparse array issues
print(f"  Renumbering nodes: {node_count} nodes, max_id was {max_node_id}")
# Get all current node IDs sorted
old_ids = [r[0] for r in _conn.execute("SELECT node_id FROM nodes ORDER BY node_id").fetchall()]

# Build renumbering map: old_id -> new_id (starting at 1)
# Skip if already contiguous
if max_node_id > node_count * 2:
    id_map = {old: new for new, old in enumerate(old_ids, 1)}
    # Disable triggers temporarily
    _conn.execute("PRAGMA defer_foreign_keys = ON")
    for old_id, new_id in id_map.items():
        if old_id != new_id:
            # Use negative temp IDs to avoid collisions
            _conn.execute("UPDATE nodes SET node_id = ? WHERE node_id = ?", (-new_id, old_id))
            _conn.execute("UPDATE links SET a_node = ? WHERE a_node = ?", (-new_id, old_id))
            _conn.execute("UPDATE links SET b_node = ? WHERE b_node = ?", (-new_id, old_id))
    # Now flip from negative to positive
    _conn.execute("UPDATE nodes SET node_id = -node_id WHERE node_id < 0")
    _conn.execute("UPDATE links SET a_node = -a_node WHERE a_node < 0")
    _conn.execute("UPDATE links SET b_node = -b_node WHERE b_node < 0")
    _conn.commit()
    new_max = _conn.execute("SELECT MAX(node_id) FROM nodes").fetchone()[0]
    print(f"  Renumbered to contiguous range 1..{new_max}")
else:
    print(f"  Node IDs already reasonably contiguous")

max_node_id = _conn.execute("SELECT MAX(node_id) FROM nodes").fetchone()[0] or 0
_conn.close()
print(f"  Max node ID after renumber: {max_node_id}")

# Centroids start right after existing nodes
centroid_start = max_node_id + 1
active_zones["run_zone_id"] = range(centroid_start, centroid_start + len(active_zones))

# Add centroids to the project
nodes = project.network.nodes
centroid_map = {}  # run_zone_id -> node_id

for _, z in active_zones.iterrows():
    zid = int(z["run_zone_id"])
    try:
        c = nodes.new_centroid(zid)
        c.geometry = Point(z["centroid_lon"], z["centroid_lat"])
        c.save()
        centroid_map[zid] = zid
    except Exception as e:
        print(f"  Warning: centroid {zid} failed: {e}")

print(f"  Added {len(centroid_map)} centroids (IDs {centroid_start}–{centroid_start + len(active_zones) - 1})")

# Connect centroids to network via direct SQL (bypass the buggy link_id auto-increment)
print("  Connecting centroids to network via nearest-node SQL...")
import sqlite3 as _sql
_db = _sql.connect(os.path.join(PROJECT_DIR, "project_database.sqlite"))
_db.enable_load_extension(True)
_db.load_extension("/home/linuxbrew/.linuxbrew/lib/mod_spatialite")

# Find next available link_id
next_link_id = _db.execute("SELECT COALESCE(MAX(link_id),0)+1 FROM links").fetchone()[0]

connected = 0
for zid in sorted(centroid_map.keys()):
    # Find the 3 nearest non-centroid nodes
    nearest = _db.execute("""
        SELECT n.node_id,
               ST_Distance(n.geometry,
                           (SELECT geometry FROM nodes WHERE node_id=?)) as dist
        FROM nodes n
        WHERE n.is_centroid = 0
        ORDER BY dist ASC
        LIMIT 3
    """, (zid,)).fetchall()

    for near_id, dist in nearest:
        # Get coordinates for building a connector line
        c_geom = _db.execute("SELECT AsText(geometry) FROM nodes WHERE node_id=?", (zid,)).fetchone()[0]
        n_geom = _db.execute("SELECT AsText(geometry) FROM nodes WHERE node_id=?", (near_id,)).fetchone()[0]
        # Parse POINT(x y) -> x, y
        cx, cy = [float(v) for v in c_geom.replace("POINT(","").replace(")","").split()]
        nx, ny = [float(v) for v in n_geom.replace("POINT(","").replace(")","").split()]
        line_wkt = f"LINESTRING({cx} {cy}, {nx} {ny})"
        length_m = dist * 111000  # rough deg-to-meters conversion

        _db.execute("""
            INSERT INTO links (link_id, a_node, b_node, direction, distance,
                               modes, link_type, name, speed_ab, speed_ba,
                               capacity_ab, capacity_ba, geometry)
            VALUES (?, ?, ?, 0, ?, 'c', 'centroid_connector', 'connector', 30, 30,
                    99999, 99999, GeomFromText(?, 4326))
        """, (next_link_id, zid, near_id, length_m / 1000, line_wkt))
        next_link_id += 1
        connected += 1

_db.commit()
_db.close()
print(f"  Created {connected} centroid connector links")

# ── 3. Build graph and run skims ─────────────────────────────────────────
print("\n[3/6] Building graph and computing skims...")

# Reopen project to pick up SQL-injected connector links
project.close()
project = Project()
project.open(PROJECT_DIR)

project.network.build_graphs()
graph = project.network.graphs["c"]

# OSM import uses 'travel_time' not 'free_flow_time'
cost_field = "travel_time" if "travel_time" in graph.graph.columns else "free_flow_time"
print(f"  Using cost field: {cost_field}")
graph.set_graph(cost_field)
graph.set_blocked_centroid_flows(True)

centroid_ids = np.array(sorted(centroid_map.values()))
graph.prepare_graph(centroid_ids)

print(f"  Graph: {graph.num_links} links, {graph.num_nodes} nodes")
print(f"  Centroids in graph: {len(centroid_ids)}")
print(f"  Graph columns: {list(graph.graph.columns)}")

# Run skims
print("  Computing travel time skims...")
graph.set_skimming([cost_field, "distance"])
skimming = NetworkSkimming(graph)
skimming.execute()

skim_matrix = skimming.results.skims
time_skim = skim_matrix.matrix[cost_field]
valid_times = time_skim[time_skim > 0]

if len(valid_times) > 0:
    print(f"  Skim matrix: {time_skim.shape}")
    print(f"  Avg zone-to-zone time: {np.nanmean(valid_times):.1f} min")
    print(f"  Max zone-to-zone time: {np.nanmax(valid_times):.1f} min")
else:
    print("  WARNING: No valid skim values — network connectivity issue")

# Export skims
skim_path = os.path.join(OUT_DIR, "travel_time_skims.omx")
skim_matrix.export(skim_path)
print(f"  Exported: travel_time_skims.omx")

# ── 4. Load demand matrix ────────────────────────────────────────────────
print("\n[4/6] Loading demand matrix...")

od_full = pd.read_csv(os.path.join(PKG_DIR, "od_trip_matrix.csv"), index_col=0)

# Extract sub-matrix for active zones
n = len(active_zones)
od_array = np.zeros((n, n))

# Map original zone_ids to run_zone_ids
orig_to_run = dict(zip(active_zones["zone_id"].astype(int), active_zones["run_zone_id"].astype(int)))

for orig_i, run_i in orig_to_run.items():
    for orig_j, run_j in orig_to_run.items():
        try:
            od_array[run_i - 1, run_j - 1] = od_full.iloc[orig_i - 1, orig_j - 1]
        except (IndexError, KeyError):
            pass

total_trips = od_array.sum()
print(f"  Active OD matrix: {n}x{n}, total trips: {total_trips:,.0f}")

# Create AequilibraE matrix
demand_path = os.path.join(OUT_DIR, "demand.omx")
demand_mat = AequilibraeMatrix()
demand_mat.create_empty(
    file_name=demand_path,
    zones=n,
    matrix_names=["demand"],
    memory_only=False,
)
demand_mat.index = centroid_ids
demand_mat.matrix["demand"][:, :] = od_array
demand_mat.computational_view(["demand"])
print(f"  Demand matrix ready")

# ── 5. Run traffic assignment ─────────────────────────────────────────────
print("\n[5/6] Running traffic assignment...")

assig = TrafficAssignment()

tc = TrafficClass(name="car", graph=graph, matrix=demand_mat)
tc.set_pce(1.0)
assig.add_class(tc)

assig.set_vdf("BPR")
assig.set_vdf_parameters({"alpha": 0.15, "beta": 4.0})
cap_field = "capacity_ab" if "capacity_ab" in graph.graph.columns else "capacity"
assig.set_capacity_field(cap_field)
assig.set_time_field(cost_field)
assig.max_iter = 100
assig.rgap_target = 0.01

assig.set_algorithm("bfw")

print("  Running BFW assignment...")
assig.execute()

rgap = assig.assignment.rgap
iters = assig.assignment.iteration
print(f"  Assignment complete! Gap={rgap:.6f}, Iterations={iters}")

# ── 6. Extract results ────────────────────────────────────────────────────
print("\n[6/6] Extracting results...")

results = assig.results()
link_results = results.get_load_results()
link_results.to_csv(os.path.join(OUT_DIR, "link_volumes.csv"))
print(f"  Exported: link_volumes.csv ({len(link_results)} links)")

# Build evidence packet
evidence = {
    "run_id": "nevada-county-pilot-001",
    "engine": "AequilibraE 1.6.1",
    "network_source": "OpenStreetMap (Overpass API)",
    "model_area": "Grass Valley / Nevada City core (-121.15, 39.15 to -120.90, 39.30)",
    "algorithm": "bi-conjugate Frank-Wolfe (BFW)",
    "vdf": "BPR (alpha=0.15, beta=4.0)",
    "convergence": {
        "final_gap": float(rgap),
        "iterations": int(iters),
        "target_gap": 0.01
    },
    "network": {
        "total_links": int(graph.num_links),
        "total_nodes": int(graph.num_nodes),
        "zones": int(n)
    },
    "demand": {
        "total_trips": float(total_trips),
        "source": "LODES 2021 OD x 4.0 expansion (filtered to model area)"
    },
    "skims": {
        "avg_travel_time_min": float(np.nanmean(valid_times)) if len(valid_times) > 0 else None,
        "max_travel_time_min": float(np.nanmax(valid_times)) if len(valid_times) > 0 else None
    },
    "artifacts": [
        "travel_time_skims.omx",
        "demand.omx",
        "link_volumes.csv",
        "evidence_packet.json"
    ],
    "caveats": [
        "Uncalibrated — OSM default speeds/capacities",
        "Model area limited to GV/NC core (not full county)",
        "Closed boundary — no external trips modeled",
        "Synthetic demand — LODES work trips x expansion",
        "No transit, no time-of-day factoring",
        "All outputs are screening-grade only"
    ],
    "calibration_status": "uncalibrated",
    "created_at": "2026-03-19",
    "created_by": "Bartholomew Hale (COO), Nat Ford"
}

with open(os.path.join(OUT_DIR, "evidence_packet.json"), "w") as f:
    json.dump(evidence, f, indent=2)
print(f"  Exported: evidence_packet.json")

# Summary
print("\n" + "=" * 60)
print("AEQUILIBRAE ASSIGNMENT — RUN COMPLETE")
print("=" * 60)
print(f"  Engine: AequilibraE 1.6.1 (OSM network)")
print(f"  Algorithm: BFW, gap={rgap:.6f}, iters={iters}")
print(f"  Network: {graph.num_links} links, {graph.num_nodes} nodes, {n} zones")
print(f"  Demand: {total_trips:,.0f} daily trips")
print(f"  Output: {OUT_DIR}/")
print(f"  Status: UNCALIBRATED SCREENING RUN")
print("=" * 60)

project.close()
