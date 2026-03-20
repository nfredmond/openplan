#!/usr/bin/env python3
"""
Run AequilibraE assignment for Nevada County using OSM network + Manual Graph.
This uses OSM for proper road topology, but bypasses the buggy AequilibraE 
build_graphs() by querying the SQLite DB directly and building the Graph in Python.
"""
import os
import sys
import json
import shutil
import sqlite3
import numpy as np
import pandas as pd
from shapely.geometry import Point, box

os.environ["SPATIALITE_LIBRARY_PATH"] = "/home/linuxbrew/.linuxbrew/lib/mod_spatialite"

from aequilibrae import Project
from aequilibrae.matrix import AequilibraeMatrix
from aequilibrae.paths import TrafficAssignment, TrafficClass, NetworkSkimming, Graph

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
PKG_DIR = os.path.join(DATA_DIR, "package")
OUT_DIR = os.path.join(DATA_DIR, "run_output")
PROJECT_DIR = os.path.join(DATA_DIR, "aeq_project")
os.makedirs(OUT_DIR, exist_ok=True)

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
    try:
        lt = proj_link_types.new(letter)
        lt.link_type = link_type
        lt.description = f"Link types from Open Street Maps: {original_link_type}"
        lt.save()
    except Exception:
        lt = proj_link_types.get(letter)
        if lt is not None:
            lt.link_type = link_type
            lt.description = f"Link types from Open Street Maps: {original_link_type}"
            lt.save()
    return [letter, link_type]

OSMBuilder._OSMBuilder__define_link_type = patched_define_link_type
# --- END PATCH ---

print("=" * 60)
print("AEQUILIBRAE ASSIGNMENT — NEVADA COUNTY PILOT (OSM + MANUAL GRAPH)")
print("=" * 60)

# ── 1. Create project and import from OSM ────────────────────────────────
print("\n[1/7] Creating AequilibraE project from OSM...")

if os.path.exists(PROJECT_DIR):
    shutil.rmtree(PROJECT_DIR)

project = Project()
project.new(PROJECT_DIR)

# GV/NC core area
model_area = box(-121.15, 39.15, -120.90, 39.30)
project.network.create_from_osm(model_area=model_area, modes=["car"], clean=True)
project.close() # Close to access DB directly

# ── 2. Add zone centroids and connectors via SQL ─────────────────────────
print("\n[2/7] Adding zone centroids and connectors...")

db_path = os.path.join(PROJECT_DIR, "project_database.sqlite")
conn = sqlite3.connect(db_path)
conn.enable_load_extension(True)
conn.load_extension("/home/linuxbrew/.linuxbrew/lib/mod_spatialite")

zones = pd.read_csv(os.path.join(PKG_DIR, "zone_attributes.csv"))
zone_mask = (
    (zones["centroid_lon"] >= -121.15) & (zones["centroid_lon"] <= -120.90) &
    (zones["centroid_lat"] >= 39.15) & (zones["centroid_lat"] <= 39.30)
)
active_zones = zones[zone_mask].copy().reset_index(drop=True)
print(f"  Zones within model area: {len(active_zones)}")

max_node_id = conn.execute("SELECT MAX(node_id) FROM nodes").fetchone()[0] or 0
centroid_start = max_node_id + 1
active_zones["run_zone_id"] = range(centroid_start, centroid_start + len(active_zones))

# Insert centroids
centroid_map = {}
for _, z in active_zones.iterrows():
    zid = int(z["run_zone_id"])
    conn.execute("""
        INSERT INTO nodes (node_id, is_centroid, geometry)
        VALUES (?, 1, MakePoint(?, ?, 4326))
    """, (zid, z["centroid_lon"], z["centroid_lat"]))
    centroid_map[int(z["zone_id"])] = zid  # Map original zone_id to run_zone_id

# Connect centroids to nearest nodes
next_link_id = conn.execute("SELECT COALESCE(MAX(link_id),0)+1 FROM links").fetchone()[0]
for zid in centroid_map.values():
    nearest = conn.execute("""
        SELECT n.node_id, ST_Distance(n.geometry, (SELECT geometry FROM nodes WHERE node_id=?)) as dist
        FROM nodes n WHERE n.is_centroid = 0 ORDER BY dist ASC LIMIT 3
    """, (zid,)).fetchall()
    
    for near_id, dist in nearest:
        c_geom = conn.execute("SELECT AsText(geometry) FROM nodes WHERE node_id=?", (zid,)).fetchone()[0]
        n_geom = conn.execute("SELECT AsText(geometry) FROM nodes WHERE node_id=?", (near_id,)).fetchone()[0]
        cx, cy = [float(v) for v in c_geom.replace("POINT(","").replace(")","").split()]
        nx, ny = [float(v) for v in n_geom.replace("POINT(","").replace(")","").split()]
        line_wkt = f"LINESTRING({cx} {cy}, {nx} {ny})"
        length_km = max(dist * 111.0, 0.01) # deg to km approx
        
        conn.execute("""
            INSERT INTO links (link_id, a_node, b_node, direction, distance, modes, link_type, name, speed_ab, speed_ba, capacity_ab, capacity_ba, geometry)
            VALUES (?, ?, ?, 0, ?, 'c', 'centroid_connector', 'connector', 30, 30, 99999, 99999, GeomFromText(?, 4326))
        """, (next_link_id, zid, near_id, length_km, line_wkt))
        next_link_id += 1

conn.commit()
print(f"  Added {len(centroid_map)} centroids and their connectors.")

# ── 3. Renumber nodes and read links for manual Graph ────────────────────
print("\n[3/7] Renumbering nodes for contiguous IDs...")

all_nodes = [r[0] for r in conn.execute("SELECT node_id FROM nodes ORDER BY node_id").fetchall()]
id_remap = {old: new for new, old in enumerate(all_nodes, 1)}

# Remap nodes and links in pandas (we don't even need to update DB if we use Graph manually!)
links_df = pd.read_sql("SELECT link_id, a_node, b_node, direction, distance, speed_ab, speed_ba, capacity_ab, capacity_ba, modes FROM links", conn)
conn.close()

links_df["a_node"] = links_df["a_node"].map(id_remap)
links_df["b_node"] = links_df["b_node"].map(id_remap)
# Some OSM links might have speed_ab == 0 or missing, fill with defaults
links_df["speed_ab"] = pd.to_numeric(links_df["speed_ab"].astype(str).str.replace(" mph", "").str.replace("mph", ""), errors="coerce").fillna(25).replace(0, 25)
links_df["speed_ba"] = pd.to_numeric(links_df["speed_ba"].astype(str).str.replace(" mph", "").str.replace("mph", ""), errors="coerce").fillna(25).replace(0, 25)
links_df["capacity_ab"] = pd.to_numeric(links_df["capacity_ab"]).fillna(800).replace(0, 800)
links_df["capacity_ba"] = pd.to_numeric(links_df["capacity_ba"]).fillna(800).replace(0, 800)
# OSM distance might be in meters or degrees. Let's check:
dist_median = links_df["distance"].median()
dist_km = links_df["distance"] / 1000.0 if dist_median > 10 else links_df["distance"]
# Travel time in minutes
links_df["travel_time"] = (dist_km / links_df["speed_ab"]) * 60

g = Graph()
g.network = links_df.copy()
# The list of centroid IDs must use the remapped IDs!
remapped_centroids = np.array(sorted([id_remap[zid] for zid in centroid_map.values()]))
g.prepare_graph(remapped_centroids, remove_dead_ends=False)
g.set_graph("travel_time")
g.set_blocked_centroid_flows(True)

print(f"  Graph ready: {g.num_links} links, {g.num_nodes} nodes, {len(remapped_centroids)} centroids")

# ── 4. Run skims ─────────────────────────────────────────────────────────
print("\n[4/7] Computing travel time skims...")

g.set_skimming(["travel_time"])
skimming = NetworkSkimming(g)
skimming.execute()
skim_mat = skimming.results.skims
time_skim = skim_mat.matrix["travel_time"]
valid = time_skim[time_skim > 0]

if len(valid) > 0:
    print(f"  Avg zone-to-zone: {np.nanmean(valid):.1f} min, Max: {np.nanmax(valid):.1f} min")
    print(f"  Reachable pairs: {len(valid)} / {time_skim.size - len(remapped_centroids)}")
else:
    print("  WARNING: No valid skim values!")

skim_path = os.path.join(OUT_DIR, "travel_time_skims.omx")
skim_mat.export(skim_path)

# ── 5. Load demand ───────────────────────────────────────────────────────
print("\n[5/7] Loading demand matrix...")

od_full = pd.read_csv(os.path.join(PKG_DIR, "od_trip_matrix.csv"), index_col=0)
n = len(active_zones)
od_array = np.zeros((n, n))

# The demand matrix must be aligned with remapped_centroids
# remapped_centroids is sorted. Let's match them back to original zone_ids.
remap_to_orig = {id_remap[run_id]: orig_id for orig_id, run_id in centroid_map.items()}
sorted_remapped = sorted(list(remap_to_orig.keys()))

for i, remap_i in enumerate(sorted_remapped):
    orig_i = remap_to_orig[remap_i]
    for j, remap_j in enumerate(sorted_remapped):
        orig_j = remap_to_orig[remap_j]
        try:
            od_array[i, j] = od_full.loc[orig_i, str(orig_j)]
        except KeyError:
            pass

total_trips = od_array.sum()
print(f"  OD: {n}x{n}, total trips: {total_trips:,.0f}")

demand_path = os.path.join(OUT_DIR, "demand.omx")
demand_mat = AequilibraeMatrix()
demand_mat.create_empty(file_name=demand_path, zones=n, matrix_names=["demand"], memory_only=False)
demand_mat.index = np.array(sorted_remapped)
demand_mat.matrix["demand"][:, :] = od_array
demand_mat.computational_view(["demand"])

# ── 6. Run assignment ────────────────────────────────────────────────────
print("\n[6/7] Running BFW assignment...")

assig = TrafficAssignment()
tc = TrafficClass(name="car", graph=g, matrix=demand_mat)
tc.set_pce(1.0)
assig.add_class(tc)

assig.set_vdf("BPR")
assig.set_vdf_parameters({"alpha": 0.15, "beta": 4.0})
assig.set_capacity_field("capacity_ab")
assig.set_time_field("travel_time")
assig.max_iter = 50
assig.rgap_target = 0.01
assig.set_algorithm("bfw")

assig.execute()

rgap = getattr(assig.assignment, "rgap", float("nan"))
iters = getattr(assig.assignment, "iteration", getattr(assig.assignment, "iter", assig.max_iter))
print(f"  Done! Gap={rgap:.6f}, Iterations={iters}")

# ── 7. Extract results ────────────────────────────────────────────────────
print("\n[7/7] Extracting results...")

results = assig.results()
lr = results.get_load_results()
lr.to_csv(os.path.join(OUT_DIR, "link_volumes.csv"))
print(f"  Exported: link_volumes.csv ({len(lr)} links)")

loaded_links = lr[lr["PCE_tot"] > 0]
print(f"  Links with assigned volume: {len(loaded_links)} / {len(lr)}")

if len(loaded_links) > 0:
    top = loaded_links.nlargest(5, "PCE_tot")[["link_id", "PCE_tot"]]
    print("\n  Top 5 loaded links:")
    for idx, row in top.iterrows():
        print(f"    Link {int(row['link_id'])}: {row['PCE_tot']:,.0f} veh")

evidence = {
    "run_id": "nevada-county-pilot-001",
    "engine": "AequilibraE 1.6.1",
    "network_source": "OSM + Manual Graph",
    "model_area": "GV/NC core",
    "convergence": {"final_gap": float(rgap), "iterations": int(iters)},
    "network": {"links": int(g.num_links), "nodes": int(g.num_nodes), "zones": n},
    "demand": {"total_trips": float(total_trips)},
    "skims": {"avg_time": float(np.nanmean(valid)) if len(valid) > 0 else None},
    "caveats": ["Uncalibrated", "OSM default speeds"],
    "calibration_status": "uncalibrated",
    "created_at": "2026-03-19"
}
with open(os.path.join(OUT_DIR, "evidence_packet.json"), "w") as f:
    json.dump(evidence, f, indent=2)

print("\n============================================================")
print("AEQUILIBRAE ASSIGNMENT — RUN COMPLETE ✅")
print("============================================================")
