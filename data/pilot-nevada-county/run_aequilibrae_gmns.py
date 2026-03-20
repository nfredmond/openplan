#!/usr/bin/env python3
"""
Run AequilibraE assignment using GMNS format network built from TIGER data.
Converts our existing TIGER GeoJSON into GMNS CSVs, imports into AequilibraE,
runs skims and assignment, and outputs evidence packet.
"""
import os
import json
import shutil
import numpy as np
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point, LineString

os.environ["SPATIALITE_LIBRARY_PATH"] = "/home/linuxbrew/.linuxbrew/lib/mod_spatialite"

from aequilibrae import Project
from aequilibrae.matrix import AequilibraeMatrix
from aequilibrae.paths import TrafficAssignment, TrafficClass, NetworkSkimming

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
PKG_DIR = os.path.join(DATA_DIR, "package")
OUT_DIR = os.path.join(DATA_DIR, "run_output")
GMNS_DIR = os.path.join(DATA_DIR, "gmns")
PROJECT_DIR = os.path.join(DATA_DIR, "aeq_project")

for d in [OUT_DIR, GMNS_DIR]:
    os.makedirs(d, exist_ok=True)

print("=" * 60)
print("AEQUILIBRAE ASSIGNMENT — NEVADA COUNTY PILOT")
print("=" * 60)

# ── 1. Build GMNS network from TIGER data ────────────────────────────────
print("\n[1/7] Building GMNS network from TIGER...")

roads = gpd.read_file(os.path.join(PKG_DIR, "network_links.geojson"))
zones = pd.read_csv(os.path.join(PKG_DIR, "zone_attributes.csv"))

# Focus on the core area (same as previous attempt)
core_bbox = (-121.15, 39.15, -120.90, 39.30)
roads_core = roads.cx[core_bbox[0]:core_bbox[2], core_bbox[1]:core_bbox[3]].copy()
print(f"  Core area links: {len(roads_core)} of {len(roads)}")

# Filter to major roads only (skip tiny local streets for assignment)
ASSIGNMENT_CLASSES = ["interstate", "state_highway", "collector", "ramp_service"]
roads_major = roads_core[roads_core["func_class"].isin(ASSIGNMENT_CLASSES)].copy()
# Also keep local roads that are named (likely collector-level)
roads_local_named = roads_core[
    (roads_core["func_class"] == "local") &
    roads_core["FULLNAME"].notna() &
    (roads_core["FULLNAME"] != "")
].copy()
roads_assign = pd.concat([roads_major, roads_local_named]).drop_duplicates(subset="LINEARID")
print(f"  Assignment-grade links: {len(roads_assign)}")

# Build node table from link endpoints
node_coords = {}  # (lon_round, lat_round) -> node_id
nodes_list = []
next_node = 1

def get_or_create_node(x, y):
    global next_node
    # Round to ~10m precision to snap nearby endpoints
    key = (round(x, 4), round(y, 4))
    if key not in node_coords:
        node_coords[key] = next_node
        nodes_list.append({
            "node_id": next_node,
            "x_coord": x,
            "y_coord": y,
            "node_type": "",
            "zone_id": "",
            "ctrl_type": 0
        })
        next_node += 1
    return node_coords[key]

# Build link table
links_list = []
for idx, road in roads_assign.iterrows():
    geom = road.geometry
    if geom is None or geom.is_empty:
        continue
    coords = list(geom.coords)
    if len(coords) < 2:
        continue

    a_node = get_or_create_node(coords[0][0], coords[0][1])
    b_node = get_or_create_node(coords[-1][0], coords[-1][1])

    if a_node == b_node:
        continue  # skip self-loops

    length_mi = road["length_mi"] if pd.notna(road["length_mi"]) else 0.1
    speed = road["speed_mph"] if pd.notna(road["speed_mph"]) else 25
    capacity = road["capacity_vph"] if pd.notna(road["capacity_vph"]) else 400
    lanes = road["lanes"] if pd.notna(road["lanes"]) else 1

    links_list.append({
        "link_id": len(links_list) + 1,
        "from_node_id": a_node,
        "to_node_id": b_node,
        "directed": 0,  # bidirectional
        "length": round(length_mi * 1.60934, 3),  # km
        "facility_type": road["func_class"],
        "capacity": int(capacity),
        "free_speed": round(speed * 1.60934, 1),  # km/h
        "lanes": int(lanes),
        "name": road.get("FULLNAME", ""),
        "geometry": geom.wkt
    })

print(f"  GMNS nodes: {len(nodes_list)}")
print(f"  GMNS links: {len(links_list)}")

# Add zone centroids as nodes
zone_core = zones[
    (zones["centroid_lon"] >= core_bbox[0]) & (zones["centroid_lon"] <= core_bbox[2]) &
    (zones["centroid_lat"] >= core_bbox[1]) & (zones["centroid_lat"] <= core_bbox[3])
].copy()
print(f"  Zones in core area: {len(zone_core)}")

centroid_node_ids = []
for _, z in zone_core.iterrows():
    nid = get_or_create_node(z["centroid_lon"], z["centroid_lat"])
    # Mark as centroid
    for n in nodes_list:
        if n["node_id"] == nid:
            n["zone_id"] = int(z["zone_id"])
            n["node_type"] = "centroid"
            break
    centroid_node_ids.append(nid)

    # Create centroid connectors to nearest 3 road nodes
    from scipy.spatial import cKDTree
    road_nodes = [(n["x_coord"], n["y_coord"], n["node_id"])
                  for n in nodes_list if n["node_type"] != "centroid"]
    if not road_nodes:
        continue
    coords_arr = np.array([(n[0], n[1]) for n in road_nodes])
    tree = cKDTree(coords_arr)
    dists, idxs = tree.query([z["centroid_lon"], z["centroid_lat"]], k=min(3, len(road_nodes)))

    if not hasattr(idxs, '__iter__'):
        idxs = [idxs]
        dists = [dists]

    for i, dist_idx in enumerate(zip(dists, idxs)):
        d, ix = dist_idx
        target_nid = road_nodes[ix][2]
        connector_len = d * 111.0  # rough km
        links_list.append({
            "link_id": len(links_list) + 1,
            "from_node_id": nid,
            "to_node_id": target_nid,
            "directed": 0,
            "length": round(max(connector_len, 0.01), 3),
            "facility_type": "centroid_connector",
            "capacity": 99999,
            "free_speed": 50.0,
            "lanes": 1,
            "name": f"connector_zone_{int(z['zone_id'])}",
            "geometry": f"LINESTRING({z['centroid_lon']} {z['centroid_lat']}, {road_nodes[ix][0]} {road_nodes[ix][1]})"
        })

print(f"  Total GMNS links (with connectors): {len(links_list)}")
print(f"  Centroids: {len(centroid_node_ids)}")

# Write GMNS CSVs
nodes_df = pd.DataFrame(nodes_list)
links_df = pd.DataFrame(links_list)
nodes_df.to_csv(os.path.join(GMNS_DIR, "node.csv"), index=False)
links_df.to_csv(os.path.join(GMNS_DIR, "link.csv"), index=False)
print("  GMNS files written")

# ── 2. Create AequilibraE project from GMNS ──────────────────────────────
print("\n[2/7] Creating AequilibraE project from GMNS...")

if os.path.exists(PROJECT_DIR):
    shutil.rmtree(PROJECT_DIR)

project = Project()
project.new(PROJECT_DIR)
project.network.create_from_gmns(
    link_file_path=os.path.join(GMNS_DIR, "link.csv"),
    node_file_path=os.path.join(GMNS_DIR, "node.csv"),
    srid=4326
)

num_links = project.network.count_links()
num_nodes = project.network.count_nodes()
print(f"  Imported: {num_links} links, {num_nodes} nodes")

# ── 3. Build graph ───────────────────────────────────────────────────────
print("\n[3/7] Building graph...")

project.network.build_graphs()
graph = project.network.graphs["c"]

# Find the right cost field
avail = list(graph.graph.columns)
cost_field = "free_flow_time" if "free_flow_time" in avail else "travel_time" if "travel_time" in avail else "distance"
print(f"  Graph columns: {avail}")
print(f"  Cost field: {cost_field}")

graph.set_graph(cost_field)
graph.set_blocked_centroid_flows(True)

# Set centroids
centroid_arr = np.array(sorted(centroid_node_ids))
graph.prepare_graph(centroid_arr)

print(f"  Graph: {graph.num_links} links, {graph.num_nodes} nodes")
print(f"  Centroids: {len(centroid_arr)}")

# ── 4. Run skims ─────────────────────────────────────────────────────────
print("\n[4/7] Computing travel time skims...")

graph.set_skimming([cost_field, "distance"])
skimming = NetworkSkimming(graph)
skimming.execute()

skim_mat = skimming.results.skims
time_skim = skim_mat.matrix[cost_field]
valid = time_skim[time_skim > 0]

if len(valid) > 0:
    print(f"  Skim shape: {time_skim.shape}")
    print(f"  Avg zone-to-zone time: {np.nanmean(valid):.1f} min")
    print(f"  Max zone-to-zone time: {np.nanmax(valid):.1f} min")
    print(f"  Reachable pairs: {len(valid)} of {time_skim.size}")
else:
    print("  WARNING: No valid skim values")

skim_path = os.path.join(OUT_DIR, "travel_time_skims.omx")
skim_mat.export(skim_path)
print(f"  Exported: travel_time_skims.omx")

# ── 5. Load demand ───────────────────────────────────────────────────────
print("\n[5/7] Loading demand matrix...")

od_full = pd.read_csv(os.path.join(PKG_DIR, "od_trip_matrix.csv"), index_col=0)
n = len(zone_core)
od_array = np.zeros((n, n))

zone_ids_in_order = sorted(zone_core["zone_id"].astype(int).values)
for ii, orig_i in enumerate(zone_ids_in_order):
    for jj, orig_j in enumerate(zone_ids_in_order):
        try:
            od_array[ii, jj] = od_full.iloc[orig_i - 1, orig_j - 1]
        except (IndexError, KeyError):
            pass

total_trips = od_array.sum()
print(f"  OD matrix: {n}x{n}, total trips: {total_trips:,.0f}")

demand_path = os.path.join(OUT_DIR, "demand.omx")
demand_mat = AequilibraeMatrix()
demand_mat.create_empty(
    file_name=demand_path,
    zones=n,
    matrix_names=["demand"],
    memory_only=False,
)
demand_mat.index = centroid_arr
demand_mat.matrix["demand"][:, :] = od_array
demand_mat.computational_view(["demand"])

# ── 6. Run assignment ────────────────────────────────────────────────────
print("\n[6/7] Running traffic assignment (BFW)...")

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

assig.execute()

rgap = assig.assignment.rgap
iters = assig.assignment.iteration
print(f"  Done! Gap={rgap:.6f}, Iterations={iters}")

# ── 7. Extract results ────────────────────────────────────────────────────
print("\n[7/7] Extracting results...")

results = assig.results()
link_results = results.get_load_results()
link_results.to_csv(os.path.join(OUT_DIR, "link_volumes.csv"))
print(f"  Exported: link_volumes.csv ({len(link_results)} links)")

# Evidence packet
evidence = {
    "run_id": "nevada-county-pilot-001",
    "engine": "AequilibraE 1.6.1",
    "network_source": "TIGER/Line 2023 → GMNS",
    "model_area": "Grass Valley / Nevada City core (-121.15, 39.15 to -120.90, 39.30)",
    "algorithm": "bi-conjugate Frank-Wolfe (BFW)",
    "vdf": "BPR (alpha=0.15, beta=4.0)",
    "convergence": {"final_gap": float(rgap), "iterations": int(iters), "target_gap": 0.01},
    "network": {"total_links": int(graph.num_links), "total_nodes": int(graph.num_nodes), "zones": n},
    "demand": {"total_trips": float(total_trips), "source": "LODES 2021 OD × 4.0 expansion"},
    "skims": {
        "avg_travel_time": float(np.nanmean(valid)) if len(valid) > 0 else None,
        "max_travel_time": float(np.nanmax(valid)) if len(valid) > 0 else None,
    },
    "artifacts": ["travel_time_skims.omx", "demand.omx", "link_volumes.csv", "evidence_packet.json"],
    "caveats": [
        "Uncalibrated — default speeds/capacities from functional class",
        "Model area limited to GV/NC core (not full county)",
        "Closed boundary — no external trips",
        "Synthetic demand — LODES work trips × expansion",
        "All outputs are screening-grade only"
    ],
    "calibration_status": "uncalibrated",
    "created_at": "2026-03-19",
    "created_by": "Bartholomew Hale (COO), Nat Ford"
}

with open(os.path.join(OUT_DIR, "evidence_packet.json"), "w") as f:
    json.dump(evidence, f, indent=2)

print("\n" + "=" * 60)
print("AEQUILIBRAE ASSIGNMENT — RUN COMPLETE")
print("=" * 60)
print(f"  Engine: AequilibraE 1.6.1 (TIGER→GMNS)")
print(f"  Algorithm: BFW, gap={rgap:.6f}, iters={iters}")
print(f"  Network: {graph.num_links} links, {graph.num_nodes} nodes, {n} zones")
print(f"  Demand: {total_trips:,.0f} daily trips")
print(f"  Output: {OUT_DIR}/")
print(f"  Status: UNCALIBRATED SCREENING RUN")
print("=" * 60)

project.close()
