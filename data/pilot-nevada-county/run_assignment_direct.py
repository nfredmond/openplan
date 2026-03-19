#!/usr/bin/env python3
"""
Run AequilibraE assignment by building the project database directly via SQL.
Bypasses the buggy OSM and GMNS importers.
"""
import os
import json
import shutil
import sqlite3
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
PROJECT_DIR = os.path.join(DATA_DIR, "aeq_project")

os.makedirs(OUT_DIR, exist_ok=True)

print("=" * 60)
print("AEQUILIBRAE ASSIGNMENT — NEVADA COUNTY PILOT")
print("=" * 60)

# ── 1. Prepare network data ──────────────────────────────────────────────
print("\n[1/7] Preparing network data...")

roads = gpd.read_file(os.path.join(PKG_DIR, "network_links.geojson"))
zones = pd.read_csv(os.path.join(PKG_DIR, "zone_attributes.csv"))

# Focus on core area
core_bbox = (-121.15, 39.15, -120.90, 39.30)
roads_core = roads.cx[core_bbox[0]:core_bbox[2], core_bbox[1]:core_bbox[3]].copy()

# Keep major roads + named local roads
MAJOR = ["interstate", "state_highway", "collector", "ramp_service"]
roads_major = roads_core[roads_core["func_class"].isin(MAJOR)]
roads_named = roads_core[
    (roads_core["func_class"] == "local") &
    roads_core["FULLNAME"].notna() & (roads_core["FULLNAME"] != "")
]
roads_assign = pd.concat([roads_major, roads_named]).drop_duplicates(subset="LINEARID")
print(f"  Assignment links: {len(roads_assign)}")

# Build topology: snap endpoints to nodes
node_coords = {}
next_node_id = 1

def snap_node(x, y):
    global next_node_id
    key = (round(x, 4), round(y, 4))
    if key not in node_coords:
        node_coords[key] = {"id": next_node_id, "x": x, "y": y, "is_centroid": 0}
        next_node_id += 1
    return node_coords[key]["id"]

link_rows = []
for _, road in roads_assign.iterrows():
    geom = road.geometry
    if geom is None or geom.is_empty:
        continue
    coords = list(geom.coords)
    if len(coords) < 2:
        continue

    a = snap_node(coords[0][0], coords[0][1])
    b = snap_node(coords[-1][0], coords[-1][1])
    if a == b:
        continue

    speed = float(road["speed_mph"]) if pd.notna(road["speed_mph"]) else 25.0
    cap = float(road["capacity_vph"]) if pd.notna(road["capacity_vph"]) else 400.0
    lanes = int(road["lanes"]) if pd.notna(road["lanes"]) else 1
    length_km = float(road["length_mi"]) * 1.60934 if pd.notna(road["length_mi"]) else 0.1
    tt_min = (length_km / (speed * 1.60934)) * 60 if speed > 0 else 99

    link_rows.append({
        "a_node": a, "b_node": b, "direction": 0,
        "distance": length_km,
        "modes": "c", "link_type": "default",
        "name": str(road.get("FULLNAME", "")),
        "speed_ab": speed, "speed_ba": speed,
        "capacity_ab": cap, "capacity_ba": cap,
        "lanes_ab": lanes, "lanes_ba": lanes,
        "travel_time_ab": tt_min, "travel_time_ba": tt_min,
        "geometry": geom.wkt
    })

# Add zone centroids
zone_core = zones[
    (zones["centroid_lon"] >= core_bbox[0]) & (zones["centroid_lon"] <= core_bbox[2]) &
    (zones["centroid_lat"] >= core_bbox[1]) & (zones["centroid_lat"] <= core_bbox[3])
].copy()
print(f"  Zones in core: {len(zone_core)}")

centroid_ids = []
for _, z in zone_core.iterrows():
    nid = snap_node(z["centroid_lon"], z["centroid_lat"])
    node_coords[(round(z["centroid_lon"], 4), round(z["centroid_lat"], 4))]["is_centroid"] = 1
    centroid_ids.append(nid)

# Add centroid connectors
from scipy.spatial import cKDTree
road_nodes = [(v["x"], v["y"], v["id"]) for v in node_coords.values() if v["is_centroid"] == 0]
if road_nodes:
    coords_arr = np.array([(n[0], n[1]) for n in road_nodes])
    tree = cKDTree(coords_arr)

    for cid in centroid_ids:
        cnode = [v for v in node_coords.values() if v["id"] == cid][0]
        dists, idxs = tree.query([cnode["x"], cnode["y"]], k=min(3, len(road_nodes)))
        if not hasattr(idxs, '__iter__'):
            dists, idxs = [dists], [idxs]
        for d, ix in zip(dists, idxs):
            target = road_nodes[ix][2]
            conn_km = max(d * 111.0, 0.01)
            link_rows.append({
                "a_node": cid, "b_node": target, "direction": 0,
                "distance": conn_km,
                "modes": "c", "link_type": "centroid_connector",
                "name": f"connector",
                "speed_ab": 50, "speed_ba": 50,
                "capacity_ab": 99999, "capacity_ba": 99999,
                "lanes_ab": 1, "lanes_ba": 1,
                "travel_time_ab": (conn_km / 50) * 60,
                "travel_time_ba": (conn_km / 50) * 60,
                "geometry": f"LINESTRING({cnode['x']} {cnode['y']}, {road_nodes[ix][0]} {road_nodes[ix][1]})"
            })

print(f"  Total links: {len(link_rows)}, Nodes: {len(node_coords)}")

# ── 2. Create AequilibraE project and populate via SQL ────────────────────
print("\n[2/7] Building AequilibraE project via SQL...")

if os.path.exists(PROJECT_DIR):
    shutil.rmtree(PROJECT_DIR)

project = Project()
project.new(PROJECT_DIR)

db_path = os.path.join(PROJECT_DIR, "project_database.sqlite")
conn = sqlite3.connect(db_path)
conn.enable_load_extension(True)
conn.load_extension("/home/linuxbrew/.linuxbrew/lib/mod_spatialite")

# Insert nodes
for ndata in node_coords.values():
    conn.execute("""
        INSERT INTO nodes (node_id, is_centroid, geometry)
        VALUES (?, ?, MakePoint(?, ?, 4326))
    """, (ndata["id"], ndata["is_centroid"], ndata["x"], ndata["y"]))

# Insert links
for i, lk in enumerate(link_rows, 1):
    conn.execute("""
        INSERT INTO links (link_id, a_node, b_node, direction, distance,
                           modes, link_type, name,
                           speed_ab, speed_ba, capacity_ab, capacity_ba,
                           geometry)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                GeomFromText(?, 4326))
    """, (i, lk["a_node"], lk["b_node"], lk["direction"], lk["distance"],
          lk["modes"], lk["link_type"], lk["name"],
          lk["speed_ab"], lk["speed_ba"], lk["capacity_ab"], lk["capacity_ba"],
          lk["geometry"]))

conn.commit()

# Verify and renumber nodes to be strictly 1..N contiguous
# AequilibraE Cython arrays are sized by count, not max_id
all_node_ids = [r[0] for r in conn.execute("SELECT node_id FROM nodes ORDER BY node_id").fetchall()]
max_id = max(all_node_ids) if all_node_ids else 0
count = len(all_node_ids)

if max_id != count:
    print(f"  Fixing node IDs: {count} nodes but max_id={max_id}, renumbering...")
    id_remap = {old: new for new, old in enumerate(all_node_ids, 1)}

    # Use temp negative IDs to avoid collision
    for old_id, new_id in id_remap.items():
        if old_id != new_id:
            conn.execute("UPDATE nodes SET node_id=? WHERE node_id=?", (-new_id, old_id))
            conn.execute("UPDATE links SET a_node=? WHERE a_node=?", (-new_id, old_id))
            conn.execute("UPDATE links SET b_node=? WHERE b_node=?", (-new_id, old_id))
    conn.execute("UPDATE nodes SET node_id=-node_id WHERE node_id<0")
    conn.execute("UPDATE links SET a_node=-a_node WHERE a_node<0")
    conn.execute("UPDATE links SET b_node=-b_node WHERE b_node<0")
    conn.commit()

    # Update centroid_ids
    centroid_ids = [id_remap.get(c, c) for c in centroid_ids]
    print(f"  New centroid IDs: {sorted(centroid_ids)}")

# Remove orphan nodes (nodes not referenced by any link)
orphans = conn.execute("""
    DELETE FROM nodes WHERE node_id NOT IN (
        SELECT a_node FROM links UNION SELECT b_node FROM links
    )
""").rowcount
conn.commit()
if orphans:
    print(f"  Removed {orphans} orphan nodes")

    # Renumber again after orphan removal
    all_node_ids = [r[0] for r in conn.execute("SELECT node_id FROM nodes ORDER BY node_id").fetchall()]
    id_remap2 = {old: new for new, old in enumerate(all_node_ids, 1)}
    for old_id, new_id in id_remap2.items():
        if old_id != new_id:
            conn.execute("UPDATE nodes SET node_id=? WHERE node_id=?", (-new_id, old_id))
            conn.execute("UPDATE links SET a_node=? WHERE a_node=?", (-new_id, old_id))
            conn.execute("UPDATE links SET b_node=? WHERE b_node=?", (-new_id, old_id))
    conn.execute("UPDATE nodes SET node_id=-node_id WHERE node_id<0")
    conn.execute("UPDATE links SET a_node=-a_node WHERE a_node<0")
    conn.execute("UPDATE links SET b_node=-b_node WHERE b_node<0")
    conn.commit()
    centroid_ids = [id_remap2.get(c, c) for c in centroid_ids]

verify_links = conn.execute("SELECT COUNT(*) FROM links").fetchone()[0]
verify_nodes = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
verify_cents = conn.execute("SELECT COUNT(*) FROM nodes WHERE is_centroid=1").fetchone()[0]
verify_max = conn.execute("SELECT MAX(node_id) FROM nodes").fetchone()[0]
conn.close()
print(f"  DB: {verify_links} links, {verify_nodes} nodes (max_id={verify_max}), {verify_cents} centroids")
assert verify_max == verify_nodes, f"Node IDs not contiguous: max={verify_max}, count={verify_nodes}"

# ── 3. Build graph manually (bypass build_graphs compressed graph bug) ────
print("\n[3/7] Building graph...")

from aequilibrae.paths import Graph

# Read network from DB
conn2 = sqlite3.connect(db_path)
conn2.enable_load_extension(True)
conn2.load_extension("/home/linuxbrew/.linuxbrew/lib/mod_spatialite")

links_data = pd.read_sql("""
    SELECT link_id, a_node, b_node, direction, distance,
           speed_ab, speed_ba, capacity_ab, capacity_ba, modes
    FROM links
""", conn2)

nodes_data = pd.read_sql("SELECT node_id, is_centroid FROM nodes", conn2)
conn2.close()

# AequilibraE stores distance from geometry in km (SpatiaLite GeodesicLength)
# Speed is stored in mph in our data → convert to km/h
# free_flow_time = distance_km / speed_kmh * 60 = minutes
# But if the distance is actually from our insert (which was length_mi * 1.60934 = km)
# OR from AequilibraE's internal geometry calculation...
# Let's check: if distance values are > 10 they're likely in meters (SpatiaLite default)
median_dist = links_data["distance"].median()
if median_dist > 10:
    # Distance is likely in meters from SpatiaLite
    dist_km = links_data["distance"] / 1000.0
    print(f"  Distance appears to be in meters (median={median_dist:.0f}m), converting to km")
else:
    dist_km = links_data["distance"]
    print(f"  Distance appears to be in km (median={median_dist:.3f}km)")

links_data["free_flow_time"] = np.where(
    links_data["speed_ab"] > 0,
    (dist_km / (links_data["speed_ab"] * 1.60934)) * 60,  # (km / km/h) * 60 = min
    5.0
)
print(f"  Travel time stats: mean={links_data['free_flow_time'].mean():.2f} min, max={links_data['free_flow_time'].max():.2f} min")

# Build graph from dataframe
graph = Graph()
graph.network = links_data
graph.prepare_graph(np.array(sorted(centroid_ids)), remove_dead_ends=False)
graph.set_graph("free_flow_time")
graph.set_blocked_centroid_flows(True)

avail = list(graph.graph.columns) if hasattr(graph, 'graph') else []
print(f"  Graph columns: {avail}")
print(f"  Graph: {graph.num_links} links, {graph.num_nodes} nodes")

cost_field = "free_flow_time"
centroid_arr = np.array(sorted(centroid_ids))

# ── 4. Run skims ─────────────────────────────────────────────────────────
print("\n[4/7] Computing skims...")

graph.set_skimming([cost_field, "distance"])
skimming = NetworkSkimming(graph)
skimming.execute()

skim_mat = skimming.results.skims
time_skim = skim_mat.matrix[cost_field]
valid = time_skim[time_skim > 0]

if len(valid) > 0:
    print(f"  Avg zone-to-zone: {np.nanmean(valid):.1f} min, Max: {np.nanmax(valid):.1f} min")
    print(f"  Reachable pairs: {len(valid)}/{time_skim.size}")
else:
    print("  WARNING: No valid skim values — check network connectivity")

skim_mat.export(os.path.join(OUT_DIR, "travel_time_skims.omx"))

# ── 5. Load demand ───────────────────────────────────────────────────────
print("\n[5/7] Loading demand...")

od_full = pd.read_csv(os.path.join(PKG_DIR, "od_trip_matrix.csv"), index_col=0)
n = len(zone_core)
od_array = np.zeros((n, n))
zids = sorted(zone_core["zone_id"].astype(int).values)
for ii, oi in enumerate(zids):
    for jj, oj in enumerate(zids):
        try:
            od_array[ii, jj] = od_full.iloc[oi - 1, oj - 1]
        except:
            pass

total_trips = od_array.sum()
print(f"  OD: {n}x{n}, {total_trips:,.0f} trips")

demand_mat = AequilibraeMatrix()
demand_mat.create_empty(file_name=os.path.join(OUT_DIR, "demand.omx"),
                        zones=n, matrix_names=["demand"], memory_only=False)
demand_mat.index = centroid_arr
demand_mat.matrix["demand"][:, :] = od_array
demand_mat.computational_view(["demand"])

# ── 6. Run assignment ────────────────────────────────────────────────────
print("\n[6/7] Running BFW assignment...")

assig = TrafficAssignment()
tc = TrafficClass(name="car", graph=graph, matrix=demand_mat)
tc.set_pce(1.0)
assig.add_class(tc)

assig.set_vdf("BPR")
assig.set_vdf_parameters({"alpha": 0.15, "beta": 4.0})
cap_field = "capacity_ab" if "capacity_ab" in avail else "capacity"
assig.set_capacity_field(cap_field)
assig.set_time_field(cost_field)
assig.max_iter = 100
assig.rgap_target = 0.01
assig.set_algorithm("bfw")

assig.execute()

rgap = getattr(assig.assignment, 'rgap', float('nan'))
iters = getattr(assig.assignment, 'iteration', getattr(assig.assignment, 'iter', assig.max_iter))
print(f"  Done! Gap={rgap:.6f}, Iterations={iters}")

# ── 7. Results ────────────────────────────────────────────────────────────
print("\n[7/7] Extracting results...")

lr = assig.results()
lr.to_csv(os.path.join(OUT_DIR, "link_volumes.csv"))
print(f"  link_volumes.csv ({len(lr)} links)")

# Top loaded links
if "tot_vol_ab" in lr.columns:
    top = lr.nlargest(10, "tot_vol_ab")[["tot_vol_ab"]].copy()
    print("\n  Top 10 loaded links:")
    for idx, row in top.iterrows():
        print(f"    Link {idx}: {row['tot_vol_ab']:,.0f} veh")

evidence = {
    "run_id": "nevada-county-pilot-001",
    "engine": "AequilibraE 1.6.1",
    "network_source": "TIGER/Line 2023 (direct SQL build)",
    "model_area": "GV/NC core (-121.15,39.15 to -120.90,39.30)",
    "algorithm": "BFW", "vdf": "BPR (α=0.15, β=4.0)",
    "convergence": {"final_gap": float(rgap), "iterations": int(iters)},
    "network": {"links": int(graph.num_links), "nodes": int(graph.num_nodes), "zones": n},
    "demand": {"total_trips": float(total_trips), "source": "LODES 2021 × 4.0"},
    "skims": {
        "avg_time": float(np.nanmean(valid)) if len(valid) > 0 else None,
        "max_time": float(np.nanmax(valid)) if len(valid) > 0 else None
    },
    "caveats": ["Uncalibrated", "Closed boundary", "Synthetic demand", "Screening-grade only"],
    "calibration_status": "uncalibrated",
    "created_at": "2026-03-19"
}
with open(os.path.join(OUT_DIR, "evidence_packet.json"), "w") as f:
    json.dump(evidence, f, indent=2)

print("\n" + "=" * 60)
print("AEQUILIBRAE ASSIGNMENT — RUN COMPLETE ✅")
print("=" * 60)
print(f"  Engine: AequilibraE 1.6.1")
print(f"  BFW: gap={rgap:.6f}, iters={iters}")
print(f"  Network: {graph.num_links} links, {graph.num_nodes} nodes, {n} zones")
print(f"  Demand: {total_trips:,.0f} daily trips")
print(f"  Output: {OUT_DIR}/")
print("=" * 60)

project.close()
