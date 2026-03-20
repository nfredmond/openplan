#!/usr/bin/env python3
"""Step 2: Add centroids, renumber nodes, run skims+assignment. Requires step1_osm.py first."""
import os, json, sqlite3, time
import numpy as np
import pandas as pd

os.environ["SPATIALITE_LIBRARY_PATH"] = "/home/linuxbrew/.linuxbrew/lib/mod_spatialite"

from aequilibrae import Project
from aequilibrae.matrix import AequilibraeMatrix
from aequilibrae.paths import TrafficAssignment, TrafficClass, NetworkSkimming

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
PKG_DIR  = os.path.join(DATA_DIR, "package")
OUT_DIR  = os.path.join(DATA_DIR, "run_output")
PROJ_DIR = os.path.join(DATA_DIR, "aeq_project")
DB_PATH  = os.path.join(PROJ_DIR, "project_database.sqlite")
os.makedirs(OUT_DIR, exist_ok=True)

print("=" * 60)
print("STEP 2: CENTROIDS + ASSIGNMENT")
print("=" * 60)

# ── 2a. Check OSM connectivity ──────────────────────────────────────
print("\n[2a] Checking OSM network connectivity...")

conn = sqlite3.connect(DB_PATH)
conn.enable_load_extension(True)
conn.load_extension("/home/linuxbrew/.linuxbrew/lib/mod_spatialite")

nodes_all = [r[0] for r in conn.execute("SELECT node_id FROM nodes ORDER BY node_id")]
links_raw = conn.execute("SELECT a_node, b_node FROM links").fetchall()
adj = {}
for a, b in links_raw:
    adj.setdefault(a, set()).add(b)
    adj.setdefault(b, set()).add(a)

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
print(f"  {len(nodes_all)} nodes, {len(links_raw)} links, {len(components)} components")
print(f"  Largest component: {len(largest)} nodes ({100*len(largest)/len(nodes_all):.1f}%)")

# ── 2b. Add centroids + connectors ──────────────────────────────────
print("\n[2b] Adding centroids and connectors...")

# Ensure centroid_connector link type exists
existing = conn.execute("SELECT link_type FROM link_types WHERE link_type='centroid_connector'").fetchone()
if not existing:
    conn.execute("""
        INSERT INTO link_types (link_type, link_type_id, description, lanes, lane_capacity)
        VALUES ('centroid_connector', 'z', 'Virtual centroid connectors', 10, 10000)
    """)
    conn.commit()

zones = pd.read_csv(os.path.join(PKG_DIR, "zone_attributes.csv"))
active_zones = zones[
    (zones["centroid_lon"] >= -121.30) & (zones["centroid_lon"] <= -120.00) &
    (zones["centroid_lat"] >= 39.00) & (zones["centroid_lat"] <= 39.50)
].copy().reset_index(drop=True)

max_node = max(nodes_all)
max_link = conn.execute("SELECT MAX(link_id) FROM links").fetchone()[0]
next_node = max_node + 1
next_link = max_link + 1
centroid_map = {}

for _, z in active_zones.iterrows():
    zid = int(z["zone_id"])
    clon, clat = z["centroid_lon"], z["centroid_lat"]
    centroid_nid = next_node
    next_node += 1

    conn.execute("""
        INSERT INTO nodes (node_id, is_centroid, geometry)
        VALUES (?, 1, MakePoint(?, ?, 4326))
    """, (centroid_nid, clon, clat))

    # Find 3 nearest nodes in largest component
    nearest = conn.execute("""
        SELECT node_id,
               (X(geometry) - ?) * (X(geometry) - ?) + (Y(geometry) - ?) * (Y(geometry) - ?) as dist2
        FROM nodes WHERE is_centroid = 0 AND node_id != ?
        ORDER BY dist2 ASC LIMIT 50
    """, (clon, clon, clat, clat, centroid_nid)).fetchall()

    nearest_in_comp = [(nid, d) for nid, d in nearest if nid in largest][:3]
    if not nearest_in_comp:
        print(f"  WARNING: Zone {zid} has no reachable nearest nodes!")
        continue

    for near_nid, dist2 in nearest_in_comp:
        nx, ny = conn.execute("SELECT X(geometry), Y(geometry) FROM nodes WHERE node_id=?", (near_nid,)).fetchone()
        line_wkt = f"LINESTRING({clon} {clat}, {nx} {ny})"
        length_m = max((dist2 ** 0.5) * 111000, 10)

        conn.execute("""
            INSERT INTO links (link_id, a_node, b_node, direction, distance, modes,
                              link_type, name, speed_ab, speed_ba, capacity_ab, capacity_ba, geometry)
            VALUES (?, ?, ?, 0, ?, 'c', 'centroid_connector', 'connector',
                    50, 50, 99999, 99999, GeomFromText(?, 4326))
        """, (next_link, centroid_nid, near_nid, length_m, line_wkt))
        next_link += 1

    centroid_map[zid] = centroid_nid

conn.commit()
print(f"  Added {len(centroid_map)} centroids")

# Verify connectivity
links_all2 = conn.execute("SELECT a_node, b_node FROM links").fetchall()
adj2 = {}
for a, b in links_all2:
    adj2.setdefault(a, set()).add(b)
    adj2.setdefault(b, set()).add(a)

c_list = list(centroid_map.values())
visited = {c_list[0]}
queue = [c_list[0]]
while queue:
    n = queue.pop(0)
    for nb in adj2.get(n, []):
        if nb not in visited:
            visited.add(nb)
            queue.append(nb)

reachable = [c for c in c_list if c in visited]
print(f"  Connectivity: {len(reachable)}/{len(c_list)} centroids reachable")

# ── 2c. Renumber nodes to contiguous 1..N ────────────────────────────
print("\n[2c] Renumbering nodes...")

old_ids = [r[0] for r in conn.execute("SELECT node_id FROM nodes ORDER BY node_id")]
remap = {old: new for new, old in enumerate(old_ids, 1)}

# Two-pass rename to avoid collisions: first to negative, then to positive
for old, new in remap.items():
    if old != new:
        conn.execute("UPDATE nodes SET node_id = ? WHERE node_id = ?", (-new, old))
conn.execute("UPDATE nodes SET node_id = -node_id WHERE node_id < 0")

# Remap link endpoints
for old, new in remap.items():
    if old != new:
        conn.execute("UPDATE links SET a_node = ? WHERE a_node = ?", (new, old))
        conn.execute("UPDATE links SET b_node = ? WHERE b_node = ?", (new, old))

conn.commit()

max_new = conn.execute("SELECT MAX(node_id) FROM nodes").fetchone()[0]
count_new = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
print(f"  Nodes: {count_new}, max_id: {max_new}, gap_ratio: {max_new/count_new:.2f}")

centroid_map = {z: remap[n] for z, n in centroid_map.items()}
centroids_sorted = sorted(centroid_map.values())
print(f"  Centroids: {centroids_sorted}")

conn.close()
time.sleep(0.5)  # Let DB flush

# ── 3. Build graph + skims ───────────────────────────────────────────
print("\n[3] Building graph and running skims...")

project = Project()
project.open(PROJ_DIR)
project.network.build_graphs(modes=["c"])
graph = project.network.graphs["c"]

# Check available fields
print(f"  Graph columns: {list(graph.graph.columns)}")
cost_field = "travel_time" if "travel_time" in graph.graph.columns else "distance"
print(f"  Using cost field: {cost_field}")

graph.set_graph(cost_field)
graph.prepare_graph(np.array(centroids_sorted))
graph.set_blocked_centroid_flows(True)
graph.set_skimming([cost_field])

print(f"  Graph: {graph.num_links} links, {graph.num_nodes} nodes")

skimming = NetworkSkimming(graph)
skimming.execute()
skim_mat = skimming.results.skims
time_skim = skim_mat.matrix[cost_field]

n_zones = len(centroids_sorted)
finite_mask = np.isfinite(time_skim) & (time_skim > 0)
np.fill_diagonal(finite_mask, False)
n_pairs = n_zones * (n_zones - 1)
n_reachable = finite_mask.sum()
print(f"  Reachable OD pairs: {n_reachable}/{n_pairs}")

if n_reachable > 0:
    valid_times = time_skim[finite_mask]
    print(f"  Times: avg={np.mean(valid_times):.1f}, max={np.max(valid_times):.1f}")

skim_mat.export(os.path.join(OUT_DIR, "travel_time_skims.omx"))

# ── 4. Load demand ──────────────────────────────────────────────────
print("\n[4] Loading demand matrix...")

od_full = pd.read_csv(os.path.join(PKG_DIR, "od_trip_matrix.csv"), index_col=0)
od_array = np.zeros((n_zones, n_zones))

remap_inv = {v: k for k, v in centroid_map.items()}
for i, ci in enumerate(centroids_sorted):
    orig_i = remap_inv[ci]
    for j, cj in enumerate(centroids_sorted):
        orig_j = remap_inv[cj]
        try:
            od_array[i, j] = od_full.loc[orig_i, str(orig_j)]
        except KeyError:
            pass

total_trips = od_array.sum()
print(f"  Total trips: {total_trips:,.0f}")

# Zero out unreachable
od_array[~np.isfinite(time_skim)] = 0
routable = od_array.sum()
print(f"  Routable trips: {routable:,.0f}")

demand_path = os.path.join(OUT_DIR, "demand.omx")
demand_mat = AequilibraeMatrix()
demand_mat.create_empty(file_name=demand_path, zones=n_zones, matrix_names=["demand"], memory_only=False)
demand_mat.index = np.array(centroids_sorted)
demand_mat.matrix["demand"][:, :] = od_array
demand_mat.computational_view(["demand"])

# ── 5. Assignment ────────────────────────────────────────────────────
print("\n[5] Running BFW assignment...")

assig = TrafficAssignment()
tc = TrafficClass(name="car", graph=graph, matrix=demand_mat)
tc.set_pce(1.0)
assig.add_class(tc)

assig.set_vdf("BPR")
assig.set_vdf_parameters({"alpha": 0.15, "beta": 4.0})
assig.set_capacity_field("capacity")
assig.set_time_field(cost_field)
assig.max_iter = 50
assig.rgap_target = 0.01
assig.set_algorithm("bfw")

assig.execute()

rgap = getattr(assig.assignment, "rgap", float("nan"))
iters = getattr(assig.assignment, "iteration", 50)
print(f"  Gap={rgap}, Iterations={iters}")

# ── 6. Export ────────────────────────────────────────────────────────
print("\n[6] Exporting results...")

results = assig.results()
lr = results.get_load_results()
lr.to_csv(os.path.join(OUT_DIR, "link_volumes.csv"))

loaded = lr[lr["PCE_tot"] > 0]
print(f"  Links with volume: {len(loaded)}/{len(lr)}")

if len(loaded) > 0:
    top5 = loaded.nlargest(5, "PCE_tot")
    print("\n  Top 5 loaded links:")
    for _, row in top5.iterrows():
        lid = int(row.get("link_id", row.name))
        print(f"    Link {lid}: {row['PCE_tot']:,.0f} PCE")

evidence = {
    "run_id": "nevada-county-pilot-final",
    "engine": "AequilibraE 1.6.1",
    "network_source": "OpenStreetMap",
    "model_area": "Nevada County (-121.30,39.00 to -120.00,39.50)",
    "algorithm": "BFW",
    "vdf": "BPR (α=0.15, β=4.0)",
    "convergence": {"final_gap": float(rgap) if np.isfinite(rgap) else None, "iterations": int(iters)},
    "network": {"links": int(graph.num_links), "nodes": int(graph.num_nodes), "zones": n_zones},
    "demand": {"total_trips": float(total_trips), "routable_trips": float(routable), "source": "LODES 2021 × 4.0"},
    "skims": {
        "reachable_pairs": int(n_reachable),
        "total_pairs": int(n_pairs),
        "avg_time": float(np.mean(valid_times)) if n_reachable > 0 else None,
        "max_time": float(np.max(valid_times)) if n_reachable > 0 else None,
    },
    "loaded_links": int(len(loaded)),
    "caveats": ["Uncalibrated", "OSM default speeds/capacities", "Closed boundary", "Screening-grade"],
    "created_at": "2026-03-19"
}
with open(os.path.join(OUT_DIR, "evidence_packet.json"), "w") as f:
    json.dump(evidence, f, indent=2)

project.close()

print("\n" + "=" * 60)
print("✅ ASSIGNMENT COMPLETE")
print("=" * 60)
print(f"  Output: {OUT_DIR}/")
