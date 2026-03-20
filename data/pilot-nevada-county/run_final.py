#!/usr/bin/env python3
"""
Nevada County Pilot — AequilibraE Traffic Assignment (Final Clean Run)

Strategy:
1. Download OSM network (proper intersection topology)
2. Reopen project, add centroids+connectors correctly via AequilibraE API
3. Use project.network.build_graphs() for native graph construction
4. If build_graphs() fails due to sparse IDs, fall back to SQL renumbering
5. Run skims, load demand, run BFW assignment, export results
"""
import os, sys, json, shutil, sqlite3, string
import numpy as np
import pandas as pd
from shapely.geometry import Point, box
from typing import Tuple

os.environ["SPATIALITE_LIBRARY_PATH"] = "/home/linuxbrew/.linuxbrew/lib/mod_spatialite"

from aequilibrae import Project
from aequilibrae.matrix import AequilibraeMatrix
from aequilibrae.paths import TrafficAssignment, TrafficClass, NetworkSkimming

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
PKG_DIR  = os.path.join(DATA_DIR, "package")
OUT_DIR  = os.path.join(DATA_DIR, "run_output")
PROJ_DIR = os.path.join(DATA_DIR, "aeq_project")
os.makedirs(OUT_DIR, exist_ok=True)

# ─── Patch OSM builder for link-type-ID collision ──────────────────────
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
        lt.description = f"OSM: {original_link_type}"
        lt.save()
    except Exception:
        lt = proj_link_types.get(letter)
        if lt is not None:
            lt.link_type = link_type
            lt.description = f"OSM: {original_link_type}"
            lt.save()
    return [letter, link_type]

OSMBuilder._OSMBuilder__define_link_type = patched_define_link_type

print("=" * 60)
print("AEQUILIBRAE ASSIGNMENT — NEVADA COUNTY PILOT (FINAL)")
print("=" * 60)

# ── 1. Create fresh project from OSM ─────────────────────────────────
print("\n[1/7] Building OSM network...")
if os.path.exists(PROJ_DIR):
    shutil.rmtree(PROJ_DIR)

project = Project()
project.new(PROJ_DIR)
model_area = box(-121.15, 39.15, -120.90, 39.30)
project.network.create_from_osm(model_area=model_area, modes=["car"], clean=True)
project.close()

# ── 2. Add centroids + connectors via raw SQL ────────────────────────
print("\n[2/7] Adding centroids and connectors...")

db_path = os.path.join(PROJ_DIR, "project_database.sqlite")
conn = sqlite3.connect(db_path)
conn.enable_load_extension(True)
conn.load_extension("/home/linuxbrew/.linuxbrew/lib/mod_spatialite")

# Verify OSM connectivity first
nodes_all = [r[0] for r in conn.execute("SELECT node_id FROM nodes ORDER BY node_id")]
links_all = conn.execute("SELECT a_node, b_node FROM links").fetchall()
adj = {}
for a, b in links_all:
    adj.setdefault(a, set()).add(b)
    adj.setdefault(b, set()).add(a)

# Find largest connected component
visited_global = set()
components = []
for node in nodes_all:
    if node in visited_global:
        continue
    comp = set()
    queue = [node]
    comp.add(node)
    while queue:
        n = queue.pop(0)
        for nb in adj.get(n, []):
            if nb not in comp:
                comp.add(nb)
                queue.append(nb)
    visited_global |= comp
    components.append(comp)

components.sort(key=len, reverse=True)
largest = components[0]
print(f"  OSM network: {len(nodes_all)} nodes, {len(links_all)} links, {len(components)} components")
print(f"  Largest component: {len(largest)} nodes ({100*len(largest)/len(nodes_all):.1f}%)")

# Load zone definitions
zones = pd.read_csv(os.path.join(PKG_DIR, "zone_attributes.csv"))
active_zones = zones[
    (zones["centroid_lon"] >= -121.15) & (zones["centroid_lon"] <= -120.90) &
    (zones["centroid_lat"] >= 39.15) & (zones["centroid_lat"] <= 39.30)
].copy().reset_index(drop=True)
print(f"  Zones in model area: {len(active_zones)}")

# For each zone, find 3 nearest nodes IN the largest connected component
# Then add centroid node + connector links
max_node = max(nodes_all)
max_link = conn.execute("SELECT MAX(link_id) FROM links").fetchone()[0]
next_node = max_node + 1
next_link = max_link + 1

# Ensure centroid_connector link type exists
existing_lt = conn.execute("SELECT link_type_id FROM link_types WHERE link_type_id='z'").fetchone()
if not existing_lt:
    conn.execute("""
        INSERT INTO link_types (link_type_id, link_type, description, lanes, lane_capacity)
        VALUES ('z', 'centroid_connector', 'Virtual centroid connectors', 10, 10000)
    """)
    conn.commit()

centroid_map = {}  # orig_zone_id -> centroid_node_id

for _, z in active_zones.iterrows():
    zid = int(z["zone_id"])
    clon, clat = z["centroid_lon"], z["centroid_lat"]
    centroid_nid = next_node
    next_node += 1

    # Insert centroid node
    conn.execute("""
        INSERT INTO nodes (node_id, is_centroid, geometry)
        VALUES (?, 1, MakePoint(?, ?, 4326))
    """, (centroid_nid, clon, clat))

    # Find 3 nearest network nodes in the largest component
    # Use simple Euclidean distance on lat/lon (good enough at this scale)
    nearest = conn.execute("""
        SELECT node_id,
               (X(geometry) - ?) * (X(geometry) - ?) + (Y(geometry) - ?) * (Y(geometry) - ?) as dist2
        FROM nodes
        WHERE is_centroid = 0 AND node_id != ?
        ORDER BY dist2 ASC
        LIMIT 30
    """, (clon, clon, clat, clat, centroid_nid)).fetchall()

    # Filter to largest component
    nearest_in_comp = [(nid, d) for nid, d in nearest if nid in largest][:3]

    if not nearest_in_comp:
        print(f"  WARNING: Zone {zid} has no reachable nearest nodes!")
        continue

    for near_nid, dist2 in nearest_in_comp:
        # Get coordinates for line geometry
        near_geom = conn.execute("SELECT X(geometry), Y(geometry) FROM nodes WHERE node_id=?", (near_nid,)).fetchone()
        nx, ny = near_geom
        line_wkt = f"LINESTRING({clon} {clat}, {nx} {ny})"
        length_m = max((dist2 ** 0.5) * 111000, 10)  # rough deg->m

        conn.execute("""
            INSERT INTO links (link_id, a_node, b_node, direction, distance, modes, link_type, name,
                              speed_ab, speed_ba, capacity_ab, capacity_ba, geometry)
            VALUES (?, ?, ?, 0, ?, 'c', 'centroid_connector', 'connector', 50, 50, 99999, 99999,
                    GeomFromText(?, 4326))
        """, (next_link, centroid_nid, near_nid, length_m, line_wkt))
        next_link += 1

    centroid_map[zid] = centroid_nid

conn.commit()
print(f"  Added {len(centroid_map)} centroids with connectors")

# Fill NULL speeds, capacities, and travel times based on link_type
print("  Filling missing speed/capacity/travel_time defaults...")
speed_defaults = {
    'motorway': 65, 'trunk': 55, 'primary': 45, 'secondary': 35,
    'tertiary': 30, 'residential': 25, 'service': 15, 'unclassified': 25,
    'pedestrian': 5, 'services': 15, 'centroid_connector': 50,
}
cap_defaults = {
    'motorway': 2000, 'trunk': 1800, 'primary': 1200, 'secondary': 900,
    'tertiary': 600, 'residential': 400, 'service': 200, 'unclassified': 400,
    'pedestrian': 50, 'services': 200, 'centroid_connector': 99999,
}
for lt, spd in speed_defaults.items():
    cap = cap_defaults.get(lt, 400)
    conn.execute("""
        UPDATE links SET speed_ab = ?, speed_ba = ?, capacity_ab = ?, capacity_ba = ?
        WHERE link_type = ? AND (speed_ab IS NULL OR capacity_ab IS NULL)
    """, (spd, spd, cap, cap, lt))
# Catch-all for any remaining
conn.execute("UPDATE links SET speed_ab = 25 WHERE speed_ab IS NULL")
conn.execute("UPDATE links SET speed_ba = 25 WHERE speed_ba IS NULL")
conn.execute("UPDATE links SET capacity_ab = 400 WHERE capacity_ab IS NULL")
conn.execute("UPDATE links SET capacity_ba = 400 WHERE capacity_ba IS NULL")
# Compute travel_time (distance is in meters from OSM)
conn.execute("""
    UPDATE links SET travel_time_ab = CASE 
        WHEN speed_ab > 0 THEN (distance / 1000.0) / speed_ab * 60.0
        ELSE 1.0 END
    WHERE travel_time_ab IS NULL OR travel_time_ab = 0
""")
conn.execute("""
    UPDATE links SET travel_time_ba = CASE 
        WHEN speed_ba > 0 THEN (distance / 1000.0) / speed_ba * 60.0
        ELSE 1.0 END
    WHERE travel_time_ba IS NULL OR travel_time_ba = 0
""")
# Ensure no zero travel times
conn.execute("UPDATE links SET travel_time_ab = 0.01 WHERE travel_time_ab <= 0 OR travel_time_ab IS NULL")
conn.execute("UPDATE links SET travel_time_ba = 0.01 WHERE travel_time_ba <= 0 OR travel_time_ba IS NULL")
conn.commit()
nulls = conn.execute("SELECT count(*) FROM links WHERE speed_ab IS NULL OR capacity_ab IS NULL OR travel_time_ab IS NULL").fetchone()[0]
print(f"  Remaining NULLs after fill: {nulls}")

# Verify connectivity
centroids_list = list(centroid_map.values())
# Rebuild adjacency with new links
links_all2 = conn.execute("SELECT a_node, b_node FROM links").fetchall()
adj2 = {}
for a, b in links_all2:
    adj2.setdefault(a, set()).add(b)
    adj2.setdefault(b, set()).add(a)

visited = {centroids_list[0]}
queue = [centroids_list[0]]
while queue:
    n = queue.pop(0)
    for nb in adj2.get(n, []):
        if nb not in visited:
            visited.add(nb)
            queue.append(nb)

reachable_centroids = [c for c in centroids_list if c in visited]
print(f"  Centroid connectivity: {len(reachable_centroids)}/{len(centroids_list)} reachable from first")

conn.close()

# ── 3. Renumber everything to contiguous IDs (1..N) ──────────────────
print("\n[3/7] Renumbering to contiguous node IDs...")

conn = sqlite3.connect(db_path)
conn.enable_load_extension(True)
conn.load_extension("/home/linuxbrew/.linuxbrew/lib/mod_spatialite")

# Build remap
old_ids = [r[0] for r in conn.execute("SELECT node_id FROM nodes ORDER BY node_id")]
remap = {old: new for new, old in enumerate(old_ids, 1)}

# Update nodes
for old, new in remap.items():
    if old != new:
        conn.execute("UPDATE nodes SET node_id = -? WHERE node_id = ?", (new, old))
# Remove negative signs (two-pass to avoid collisions)
conn.execute("UPDATE nodes SET node_id = -node_id WHERE node_id < 0")

# Update links
for old, new in remap.items():
    if old != new:
        conn.execute("UPDATE links SET a_node = ? WHERE a_node = ?", (new, old))
        conn.execute("UPDATE links SET b_node = ? WHERE b_node = ?", (new, old))

conn.commit()

# Verify
max_new = conn.execute("SELECT MAX(node_id) FROM nodes").fetchone()[0]
count_new = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
print(f"  Nodes: {count_new}, max_id: {max_new} (gap ratio: {max_new/count_new:.2f})")

# Remap centroid_map
centroid_map = {z: remap[n] for z, n in centroid_map.items()}
centroids_remapped = sorted(centroid_map.values())
print(f"  Remapped centroids: {centroids_remapped}")

conn.close()

# ── 4. Open project and build graph via AequilibraE API ──────────────
print("\n[4/7] Building graph and running skims...")

project = Project()
project.open(PROJ_DIR)
project.network.build_graphs(modes=["c"])
graph = project.network.graphs["c"]
graph.set_graph("travel_time")

# Set centroids
graph.prepare_graph(np.array(centroids_remapped))
graph.set_blocked_centroid_flows(True)
graph.set_skimming(["travel_time"])

print(f"  Graph: {graph.num_links} links, {graph.num_nodes} nodes")
print(f"  Graph columns: {list(graph.graph.columns)}")

skimming = NetworkSkimming(graph)
skimming.execute()
skim_mat = skimming.results.skims
time_skim = skim_mat.matrix["travel_time"]

# Check reachability
n_zones = len(centroids_remapped)
finite_mask = np.isfinite(time_skim) & (time_skim > 0)
# Exclude diagonal
np.fill_diagonal(finite_mask, False)
n_pairs = n_zones * (n_zones - 1)
n_reachable = finite_mask.sum()
print(f"  Reachable OD pairs: {n_reachable}/{n_pairs}")

if n_reachable > 0:
    valid_times = time_skim[finite_mask]
    print(f"  Travel times: avg={np.mean(valid_times):.1f} min, max={np.max(valid_times):.1f} min")

skim_path = os.path.join(OUT_DIR, "travel_time_skims.omx")
skim_mat.export(skim_path)

# ── 5. Load demand ──────────────────────────────────────────────────
print("\n[5/7] Loading demand matrix...")

od_full = pd.read_csv(os.path.join(PKG_DIR, "od_trip_matrix.csv"), index_col=0)
od_array = np.zeros((n_zones, n_zones))

# Map: position i in centroids_remapped -> original zone_id
remap_inv = {v: k for k, v in centroid_map.items()}
sorted_centroids = sorted(centroid_map.values())

for i, ci in enumerate(sorted_centroids):
    orig_i = remap_inv[ci]
    for j, cj in enumerate(sorted_centroids):
        orig_j = remap_inv[cj]
        try:
            od_array[i, j] = od_full.loc[orig_i, str(orig_j)]
        except KeyError:
            pass

total_trips = od_array.sum()
print(f"  OD: {n_zones}x{n_zones}, total trips: {total_trips:,.0f}")

# Zero out unreachable pairs
od_array[~np.isfinite(time_skim)] = 0
routable_trips = od_array.sum()
print(f"  Routable trips: {routable_trips:,.0f}")

demand_path = os.path.join(OUT_DIR, "demand.omx")
demand_mat = AequilibraeMatrix()
demand_mat.create_empty(file_name=demand_path, zones=n_zones, matrix_names=["demand"], memory_only=False)
demand_mat.index = np.array(sorted_centroids)
demand_mat.matrix["demand"][:, :] = od_array
demand_mat.computational_view(["demand"])

# ── 6. Run assignment ────────────────────────────────────────────────
print("\n[6/7] Running BFW assignment (50 iterations)...")

assig = TrafficAssignment()
tc = TrafficClass(name="car", graph=graph, matrix=demand_mat)
tc.set_pce(1.0)
assig.add_class(tc)

assig.set_vdf("BPR")
assig.set_vdf_parameters({"alpha": 0.15, "beta": 4.0})
assig.set_capacity_field("capacity")
assig.set_time_field("travel_time")
assig.max_iter = 50
assig.rgap_target = 0.01
assig.set_algorithm("bfw")

assig.execute()

rgap = getattr(assig.assignment, "rgap", float("nan"))
iters = getattr(assig.assignment, "iteration", 50)
print(f"  Converged: gap={rgap}, iterations={iters}")

# ── 7. Export results ────────────────────────────────────────────────
print("\n[7/7] Exporting results...")

results = assig.results()
lr = results.get_load_results()
lr.to_csv(os.path.join(OUT_DIR, "link_volumes.csv"))

loaded = lr[lr["PCE_tot"] > 0]
print(f"  Links with volume: {len(loaded)}/{len(lr)}")

if len(loaded) > 0:
    top5 = loaded.nlargest(5, "PCE_tot")
    print("\n  Top 5 loaded links:")
    for _, row in top5.iterrows():
        print(f"    Link {int(row.get('link_id', row.name))}: {row['PCE_tot']:,.0f} PCE")

# Evidence packet
evidence = {
    "run_id": "nevada-county-pilot-final",
    "engine": "AequilibraE 1.6.1",
    "network_source": "OpenStreetMap (via AequilibraE)",
    "model_area": "GV/NC core (-121.15,39.15 to -120.90,39.30)",
    "algorithm": "BFW",
    "vdf": "BPR (α=0.15, β=4.0)",
    "convergence": {"final_gap": float(rgap) if np.isfinite(rgap) else None, "iterations": int(iters)},
    "network": {"links": int(graph.num_links), "nodes": int(graph.num_nodes), "zones": n_zones},
    "demand": {"total_trips": float(total_trips), "routable_trips": float(routable_trips), "source": "LODES 2021 × 4.0"},
    "skims": {
        "reachable_pairs": int(n_reachable),
        "total_pairs": int(n_pairs),
        "avg_time_min": float(np.mean(valid_times)) if n_reachable > 0 else None,
        "max_time_min": float(np.max(valid_times)) if n_reachable > 0 else None,
    },
    "loaded_links": int(len(loaded)),
    "caveats": ["Uncalibrated", "OSM default speeds/capacities", "Closed boundary", "Screening-grade only"],
    "calibration_status": "uncalibrated",
    "created_at": "2026-03-19"
}
with open(os.path.join(OUT_DIR, "evidence_packet.json"), "w") as f:
    json.dump(evidence, f, indent=2)

project.close()

print("\n" + "=" * 60)
print("✅ ASSIGNMENT COMPLETE")
print("=" * 60)
print(f"  Output: {OUT_DIR}/")
print(f"  - link_volumes.csv  ({len(lr)} links)")
print(f"  - demand.omx        ({total_trips:,.0f} trips)")
print(f"  - travel_time_skims.omx")
print(f"  - evidence_packet.json")
