#!/usr/bin/env python3
"""Step 2: Build centroids/connectors in memory, skim, and assign demand.

Requires a clean `step1_osm.py` project build first.
This version avoids in-place SQLite node renumbering because repeated retries were
corrupting the AequilibraE project database. Instead, it loads the raw network from
SQLite, adds synthetic centroids/connectors in memory, remaps nodes to contiguous
indices in memory, and runs skims/assignment from that derived graph.
"""

import json
import os
import sqlite3
from collections import deque

import numpy as np
import pandas as pd

os.environ["SPATIALITE_LIBRARY_PATH"] = "/home/linuxbrew/.linuxbrew/lib/mod_spatialite"

from aequilibrae.matrix import AequilibraeMatrix
from aequilibrae.paths import Graph, NetworkSkimming, TrafficAssignment, TrafficClass

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
PKG_DIR = os.path.join(DATA_DIR, "package")
OUT_DIR = os.path.join(DATA_DIR, "run_output")
PROJ_DIR = os.path.join(DATA_DIR, "aeq_project")
DB_PATH = os.path.join(PROJ_DIR, "project_database.sqlite")
os.makedirs(OUT_DIR, exist_ok=True)

for fname in ["travel_time_skims.omx", "demand.omx", "link_volumes.csv", "evidence_packet.json"]:
    path = os.path.join(OUT_DIR, fname)
    if os.path.exists(path):
        os.remove(path)

print("=" * 60)
print("STEP 2: CENTROIDS + ASSIGNMENT")
print("=" * 60)

if not os.path.exists(DB_PATH):
    raise FileNotFoundError(f"Project database not found: {DB_PATH}. Run step1_osm.py first.")

# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def coerce_numeric(series: pd.Series) -> pd.Series:
    if pd.api.types.is_numeric_dtype(series):
        return pd.to_numeric(series, errors="coerce")
    extracted = series.astype(str).str.extract(r"(-?\d+(?:\.\d+)?)", expand=False)
    return pd.to_numeric(extracted, errors="coerce")


def travel_time_minutes(distance_m: pd.Series | np.ndarray | float, speed_mph: pd.Series | np.ndarray | float):
    speed_mph = np.maximum(np.asarray(speed_mph, dtype=float), 1.0)
    distance_m = np.asarray(distance_m, dtype=float)
    return distance_m / (speed_mph * 1609.34) * 60.0


def build_components(nodes_all: np.ndarray, links_df: pd.DataFrame):
    adj: dict[int, set[int]] = {}
    for a, b in links_df[["a_node", "b_node"]].itertuples(index=False):
        a = int(a)
        b = int(b)
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)

    visited_global: set[int] = set()
    components: list[set[int]] = []
    for node in nodes_all:
        node = int(node)
        if node in visited_global:
            continue
        comp = {node}
        queue: deque[int] = deque([node])
        while queue:
            n = queue.popleft()
            for nb in adj.get(n, ()):
                if nb not in comp:
                    comp.add(nb)
                    queue.append(nb)
        visited_global |= comp
        components.append(comp)
    components.sort(key=len, reverse=True)
    return components


print("\n[2a] Loading raw OSM network...")
conn = sqlite3.connect(DB_PATH)
conn.enable_load_extension(True)
conn.load_extension("/home/linuxbrew/.linuxbrew/lib/mod_spatialite")

node_sql = """
    SELECT node_id, X(geometry) AS lon, Y(geometry) AS lat
    FROM nodes
    WHERE COALESCE(is_centroid, 0) = 0
    ORDER BY node_id
"""
raw_nodes = pd.read_sql_query(node_sql, conn)
if raw_nodes.empty:
    raise RuntimeError("No non-centroid nodes found in project database. Rebuild with step1_osm.py.")

link_sql = """
    SELECT
        link_id,
        a_node,
        b_node,
        direction,
        distance,
        modes,
        link_type,
        name,
        speed_ab,
        speed_ba,
        travel_time_ab,
        travel_time_ba,
        capacity_ab,
        capacity_ba,
        osm_id,
        cycleway,
        cycleway_right,
        cycleway_left,
        busway,
        busway_right,
        busway_left,
        lanes_ab,
        lanes_ba
    FROM links
    WHERE link_type != 'centroid_connector'
"""
raw_links = pd.read_sql_query(link_sql, conn)
conn.close()

nodes_all = raw_nodes["node_id"].to_numpy(dtype=np.int64)
components = build_components(nodes_all, raw_links)
largest = components[0]
print(f"  {len(raw_nodes)} nodes, {len(raw_links)} links, {len(components)} components")
print(f"  Largest component: {len(largest)} nodes ({100 * len(largest) / len(raw_nodes):.1f}%)")

# ------------------------------------------------------------------
# Build synthetic centroids/connectors in memory
# ------------------------------------------------------------------
print("\n[2b] Adding centroids and connectors in memory...")

zones = pd.read_csv(os.path.join(PKG_DIR, "zone_attributes.csv"))
active_zones = zones[
    (zones["centroid_lon"] >= -121.50) & (zones["centroid_lon"] <= -119.90) &
    (zones["centroid_lat"] >= 38.70) & (zones["centroid_lat"] <= 39.40)
].copy().reset_index(drop=True)

valid_nodes = raw_nodes[raw_nodes["node_id"].isin(largest)].copy().reset_index(drop=True)
valid_ids = valid_nodes["node_id"].to_numpy(dtype=np.int64)
valid_lon = valid_nodes["lon"].to_numpy(dtype=float)
valid_lat = valid_nodes["lat"].to_numpy(dtype=float)
print(f"  Drivable candidate nodes for connectors (largest component): {len(valid_nodes)}")

max_node = int(raw_nodes["node_id"].max())
max_link = int(raw_links["link_id"].max())
next_node = max_node + 1
next_link = max_link + 1
centroid_map: dict[int, int] = {}
centroid_rows: list[dict] = []
connector_rows: list[dict] = []

for _, z in active_zones.iterrows():
    zid = int(z["zone_id"])
    clon = float(z["centroid_lon"])
    clat = float(z["centroid_lat"])
    centroid_nid = next_node
    next_node += 1

    centroid_rows.append({"node_id": centroid_nid, "lon": clon, "lat": clat})

    dist2 = (valid_lon - clon) ** 2 + (valid_lat - clat) ** 2
    take = min(3, len(valid_ids))
    nearest_idx = np.argpartition(dist2, take - 1)[:take]
    nearest_idx = nearest_idx[np.argsort(dist2[nearest_idx])]

    for idx in nearest_idx:
        near_nid = int(valid_ids[idx])
        length_m = max((float(dist2[idx]) ** 0.5) * 111000, 10.0)
        tt = float(travel_time_minutes(length_m, 50.0))
        connector_rows.append(
            {
                "link_id": next_link,
                "a_node": centroid_nid,
                "b_node": near_nid,
                "direction": 0,
                "distance": length_m,
                "modes": "c",
                "link_type": "centroid_connector",
                "name": "connector",
                "speed_ab": 50.0,
                "speed_ba": 50.0,
                "travel_time_ab": tt,
                "travel_time_ba": tt,
                "capacity_ab": 99999.0,
                "capacity_ba": 99999.0,
                "osm_id": np.nan,
                "cycleway": np.nan,
                "cycleway_right": np.nan,
                "cycleway_left": np.nan,
                "busway": np.nan,
                "busway_right": np.nan,
                "busway_left": np.nan,
                "lanes_ab": 1.0,
                "lanes_ba": 1.0,
            }
        )
        next_link += 1

    centroid_map[zid] = centroid_nid

if not centroid_map:
    raise RuntimeError("No active zones produced centroids. Check zone_attributes.csv / model bounds.")

centroid_nodes = pd.DataFrame(centroid_rows)
connector_links = pd.DataFrame(connector_rows)
all_nodes = pd.concat([raw_nodes, centroid_nodes], ignore_index=True)
all_links = pd.concat([raw_links, connector_links], ignore_index=True)
print(f"  Added {len(centroid_map)} centroids")

for col in ["distance", "speed_ab", "speed_ba", "travel_time_ab", "travel_time_ba", "capacity_ab", "capacity_ba", "lanes_ab", "lanes_ba"]:
    all_links[col] = coerce_numeric(all_links[col])

# ------------------------------------------------------------------
# Screening-grade defaults in memory
# ------------------------------------------------------------------
print("  Normalizing drivable modes/speeds/capacities in memory...")
road_defaults = {
    "motorway": (65, 4000, "tc"),
    "trunk": (55, 2500, "tc"),
    "primary": (45, 1500, "tcwb"),
    "secondary": (40, 1200, "tcwb"),
    "tertiary": (35, 900, "tcwb"),
    "residential": (25, 400, "tcwb"),
    "service": (20, 300, "tcwb"),
    "unclassified": (25, 400, "tcwb"),
    "living_street": (15, 200, "tcwb"),
    "road": (25, 400, "tcwb"),
    "construction": (15, 150, "tcwb"),
    "planned": (25, 400, "tcwb"),
    "rest_area": (15, 200, "tcwb"),
    "services": (15, 200, "tcwb"),
    "escape": (25, 400, "tcwb"),
    "centroid_connector": (50, 99999, "c"),
}

for link_type, (speed, capacity, modes) in road_defaults.items():
    mask = all_links["link_type"] == link_type
    if not mask.any():
        continue
    all_links.loc[mask, "modes"] = modes
    all_links.loc[mask, "speed_ab"] = speed
    all_links.loc[mask, "speed_ba"] = speed
    all_links.loc[mask, "capacity_ab"] = capacity
    all_links.loc[mask, "capacity_ba"] = capacity
    all_links.loc[mask, "lanes_ab"] = all_links.loc[mask, "lanes_ab"].fillna(1)

    lanes_ba_missing = mask & all_links["lanes_ba"].isna()
    all_links.loc[lanes_ba_missing & (all_links["direction"] == 0), "lanes_ba"] = 1.0
    all_links.loc[lanes_ba_missing & (all_links["direction"] != 0), "lanes_ba"] = 0.0

all_links["speed_ab"] = all_links["speed_ab"].fillna(35.0)
all_links["speed_ba"] = all_links["speed_ba"].fillna(all_links["speed_ab"])
all_links["capacity_ab"] = all_links["capacity_ab"].fillna(400.0)
all_links["capacity_ba"] = all_links["capacity_ba"].fillna(all_links["capacity_ab"])
all_links["lanes_ab"] = all_links["lanes_ab"].fillna(1.0)
all_links.loc[all_links["lanes_ba"].isna() & (all_links["direction"] == 0), "lanes_ba"] = 1.0
all_links.loc[all_links["lanes_ba"].isna() & (all_links["direction"] != 0), "lanes_ba"] = 0.0
tt_ab = pd.Series(travel_time_minutes(all_links["distance"], all_links["speed_ab"]), index=all_links.index)
tt_ba = pd.Series(travel_time_minutes(all_links["distance"], all_links["speed_ba"]), index=all_links.index)
all_links.loc[all_links["travel_time_ab"].isna(), "travel_time_ab"] = tt_ab[all_links["travel_time_ab"].isna()]
all_links.loc[all_links["travel_time_ba"].isna(), "travel_time_ba"] = tt_ba[all_links["travel_time_ba"].isna()]
all_links["modes"] = all_links["modes"].fillna("")

# Connectivity check on the car-usable network only.
car_links = all_links[all_links["modes"].str.contains("c", regex=False)].copy()
adj2: dict[int, set[int]] = {}
for a, b in car_links[["a_node", "b_node"]].itertuples(index=False):
    a = int(a)
    b = int(b)
    adj2.setdefault(a, set()).add(b)
    adj2.setdefault(b, set()).add(a)

c_list = list(centroid_map.values())
visited = {c_list[0]}
queue: deque[int] = deque([c_list[0]])
while queue:
    n = queue.popleft()
    for nb in adj2.get(n, ()):
        if nb not in visited:
            visited.add(nb)
            queue.append(nb)
reachable = [c for c in c_list if c in visited]
print(f"  Connectivity: {len(reachable)}/{len(c_list)} centroids reachable")

# ------------------------------------------------------------------
# In-memory node remap
# ------------------------------------------------------------------
print("\n[2c] Renumbering nodes in memory...")

all_node_ids = np.sort(all_nodes["node_id"].unique())
remap = {int(old): int(new) for new, old in enumerate(all_node_ids)}

all_nodes["node_id"] = all_nodes["node_id"].map(remap)
all_links["a_node"] = all_links["a_node"].map(remap)
all_links["b_node"] = all_links["b_node"].map(remap)
centroid_map = {z: remap[n] for z, n in centroid_map.items()}
centroids_sorted = sorted(centroid_map.values())

count_new = len(all_node_ids)
max_new = int(max(centroids_sorted + [int(all_nodes["node_id"].max())]))
print(f"  Nodes: {count_new}, max_id: {max_new}, gap_ratio: {max_new / count_new:.2f}")
print(f"  Centroids: {centroids_sorted}")

# ------------------------------------------------------------------
# Build graph + skims
# ------------------------------------------------------------------
print("\n[3] Building graph and running skims...")

graph_cols = [
    "link_id",
    "a_node",
    "b_node",
    "direction",
    "distance",
    "speed_ab",
    "speed_ba",
    "travel_time_ab",
    "travel_time_ba",
    "capacity_ab",
    "capacity_ba",
    "osm_id",
    "lanes_ab",
    "lanes_ba",
    "modes",
]
graph_net = all_links[graph_cols].copy()
graph_net["id"] = np.nan

lonlat = all_nodes[["node_id", "lon", "lat"]].drop_duplicates("node_id").sort_values("node_id")

graph = Graph()
graph.mode = "c"
graph.network = graph_net

graph.prepare_graph(np.array(centroids_sorted, dtype=np.uint32), remove_dead_ends=False)
graph.set_blocked_centroid_flows(True)
graph.lonlat_index = lonlat.set_index("node_id").loc[graph.all_nodes]

print(f"  Graph columns: {list(graph.graph.columns)}")

# Use a synthetic free-flow time to keep the screening run explicit and stable.
cost_field = "ff_time"
graph.graph["capacity"] = graph.graph["capacity"].fillna(400.0)
graph.graph[cost_field] = graph.graph["travel_time"].fillna(
    graph.graph["distance"] / (35 * 1609.34) * 60.0
)

graph.set_graph(cost_field)
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
n_reachable = int(finite_mask.sum())
print(f"  Reachable OD pairs: {n_reachable}/{n_pairs}")

valid_times = np.array([])
if n_reachable > 0:
    valid_times = time_skim[finite_mask]
    print(f"  Times: avg={np.mean(valid_times):.1f}, max={np.max(valid_times):.1f}")

skim_mat.export(os.path.join(OUT_DIR, "travel_time_skims.omx"))

# ------------------------------------------------------------------
# Demand
# ------------------------------------------------------------------
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

total_trips = float(od_array.sum())
print(f"  Total trips: {total_trips:,.0f}")

od_array[~np.isfinite(time_skim)] = 0
routable = float(od_array.sum())
print(f"  Routable trips: {routable:,.0f}")

demand_path = os.path.join(OUT_DIR, "demand.omx")
demand_mat = AequilibraeMatrix()
demand_mat.create_empty(file_name=demand_path, zones=n_zones, matrix_names=["demand"], memory_only=False)
demand_mat.index = np.array(centroids_sorted)
demand_mat.matrix["demand"][:, :] = od_array
demand_mat.computational_view(["demand"])

# ------------------------------------------------------------------
# Assignment
# ------------------------------------------------------------------
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

# ------------------------------------------------------------------
# Export
# ------------------------------------------------------------------
print("\n[6] Exporting results...")

lr = assig.results()
if "link_id" not in lr.columns:
    lr = lr.reset_index()
lr.to_csv(os.path.join(OUT_DIR, "link_volumes.csv"), index=False)

loaded = lr[lr["PCE_tot"] > 0]
print(f"  Links with volume: {len(loaded)}/{len(lr)}")

if len(loaded) > 0:
    top5 = loaded.nlargest(5, "PCE_tot")
    print("\n  Top 5 loaded links:")
    for _, row in top5.iterrows():
        lid = int(row.get("link_id", row.name))
        print(f"    Link {lid}: {row['PCE_tot']:,.0f} PCE")

evidence = {
    "run_id": "placer-county-pilot-final",
    "engine": "AequilibraE 1.6.1",
    "network_source": "OpenStreetMap",
    "model_area": "Placer County (-121.50,38.70 to -119.90,39.40)",
    "algorithm": "BFW",
    "vdf": "BPR (α=0.15, β=4.0)",
    "convergence": {
        "final_gap": float(rgap) if np.isfinite(rgap) else None,
        "iterations": int(iters),
    },
    "network": {
        "links": int(graph.num_links),
        "nodes": int(graph.num_nodes),
        "zones": n_zones,
    },
    "demand": {
        "total_trips": total_trips,
        "routable_trips": routable,
        "source": "LODES 2021 × 4.0",
    },
    "skims": {
        "reachable_pairs": int(n_reachable),
        "total_pairs": int(n_pairs),
        "avg_time": float(np.mean(valid_times)) if n_reachable > 0 else None,
        "max_time": float(np.max(valid_times)) if n_reachable > 0 else None,
    },
    "loaded_links": int(len(loaded)),
    "caveats": [
        "Uncalibrated",
        "OSM default speeds/capacities",
        "Closed boundary",
        "Screening-grade",
        "In-memory centroid/connectors (DB left unchanged)",
    ],
    "created_at": "2026-03-22",
}
with open(os.path.join(OUT_DIR, "evidence_packet.json"), "w") as f:
    json.dump(evidence, f, indent=2)

print("\n" + "=" * 60)
print("✅ ASSIGNMENT COMPLETE")
print("=" * 60)
print(f"  Output: {OUT_DIR}/")
