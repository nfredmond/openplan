#!/usr/bin/env python3
"""
Run the first AequilibraE network assignment for the Nevada County pilot.
This is the P1 exit criterion: end-to-end run through the real engine.

Steps:
1. Create an AequilibraE project from TIGER network data
2. Load the OD trip matrix
3. Run shortest-path skims (travel time)
4. Run traffic assignment (BPR + All-or-Nothing as starter)
5. Extract link volumes and corridor KPIs
6. Output evidence packet artifacts
"""
import os
import sys
import json
import shutil
import tempfile
import numpy as np
import pandas as pd
import geopandas as gpd

# AequilibraE imports
from aequilibrae import Project
from aequilibrae.matrix import AequilibraeMatrix
from aequilibrae.paths import Graph, TrafficAssignment, TrafficClass

DATA_DIR = os.path.dirname(os.path.abspath(__file__))
PKG_DIR = os.path.join(DATA_DIR, "package")
OUT_DIR = os.path.join(DATA_DIR, "run_output")
os.makedirs(OUT_DIR, exist_ok=True)

PROJECT_DIR = os.path.join(DATA_DIR, "aeq_project")

print("=" * 60)
print("AEQUILIBRAE ASSIGNMENT — NEVADA COUNTY PILOT")
print("=" * 60)

# ── 1. Create AequilibraE project ────────────────────────────────────────
print("\n[1/6] Creating AequilibraE project...")

# Clean previous run
if os.path.exists(PROJECT_DIR):
    shutil.rmtree(PROJECT_DIR)

project = Project()
project.new(PROJECT_DIR)

# ── 2. Build network from TIGER data ─────────────────────────────────────
print("[2/6] Loading and building network...")

roads = gpd.read_file(os.path.join(PKG_DIR, "network_links.geojson"))
zones = pd.read_csv(os.path.join(PKG_DIR, "zone_attributes.csv"))

# AequilibraE needs a network in its own format
# We'll add links directly to the project network
network = project.network

# Get the links layer
links = network.links
link_types = network.link_types

# First, add a custom link type
lt = link_types.new("r")
lt.link_type = "road"
lt.description = "General road"
lt.lanes_ab = 1
lt.lanes_ba = 1
lt.speed_ab = 25.0
lt.speed_ba = 25.0
lt.save()

# Add zone centroids as nodes first
print("  Adding zone centroids...")
nodes = network.nodes

# We need to add centroids and connect them
# AequilibraE uses node IDs; zones get IDs 1-26
zone_node_map = {}
for _, z in zones.iterrows():
    zone_id = int(z["zone_id"])
    node = nodes.new()
    node.geometry = f"POINT ({z['centroid_lon']} {z['centroid_lat']})"
    node.is_centroid = 1
    node.save()
    zone_node_map[zone_id] = node.node_id

print(f"  Added {len(zone_node_map)} zone centroids")

# Add road links
print("  Adding road links (this may take a moment)...")
link_count = 0
skipped = 0

for idx, road in roads.iterrows():
    try:
        geom = road.geometry
        if geom is None or geom.is_empty:
            skipped += 1
            continue

        link = links.new()
        link.geometry = geom.wkt
        link.direction = 0  # bidirectional
        link.link_type = "r"
        link.speed_ab = float(road.get("speed_mph", 25))
        link.speed_ba = float(road.get("speed_mph", 25))
        link.capacity_ab = float(road.get("capacity_vph", 400))
        link.capacity_ba = float(road.get("capacity_vph", 400))
        link.lanes_ab = int(road.get("lanes", 1))
        link.lanes_ba = int(road.get("lanes", 1))
        link.save()
        link_count += 1
    except Exception as e:
        skipped += 1
        if skipped <= 5:
            print(f"  Warning: skipped link {idx}: {e}")

print(f"  Added {link_count} links (skipped {skipped})")

# Build the graph
print("  Building graph...")
project.network.build_graphs()
graph = project.network.graphs["c"]  # car graph

# Set centroids
graph.set_graph("free_flow_time")
graph.set_blocked_centroid_flows(True)

# Set centroid mapping
centroid_ids = list(zone_node_map.values())
graph.prepare_graph(np.array(centroid_ids))

print(f"  Graph ready: {graph.num_links} links, {graph.num_nodes} nodes")
print(f"  Centroids: {len(centroid_ids)}")

# ── 3. Run skims ─────────────────────────────────────────────────────────
print("\n[3/6] Computing travel time skims...")

from aequilibrae.paths import NetworkSkimming

skimming = NetworkSkimming(graph)
skimming.execute()

skims = skimming.results
skim_matrix = skims.skims

# Extract time skim
time_skim = skim_matrix.matrix["free_flow_time"]
print(f"  Skim matrix shape: {time_skim.shape}")
print(f"  Average zone-to-zone time: {np.nanmean(time_skim[time_skim > 0]):.1f} min")
print(f"  Max zone-to-zone time: {np.nanmax(time_skim[time_skim > 0]):.1f} min")

# Save skim to OMX
skim_path = os.path.join(OUT_DIR, "travel_time_skims.omx")
skim_matrix.export(skim_path)
print(f"  Exported: travel_time_skims.omx")

# ── 4. Load demand matrix ────────────────────────────────────────────────
print("\n[4/6] Loading demand matrix...")

od_df = pd.read_csv(os.path.join(PKG_DIR, "od_trip_matrix.csv"), index_col=0)
od_array = od_df.values.astype(np.float64)
print(f"  OD matrix: {od_array.shape}, total trips: {od_array.sum():,.0f}")

# Create AequilibraE matrix
demand_path = os.path.join(OUT_DIR, "demand.omx")
args = {
    "file_name": demand_path,
    "zones": len(centroid_ids),
    "matrix_names": ["demand"],
    "memory_only": False,
}
demand_mat = AequilibraeMatrix()
demand_mat.create_empty(**args)
demand_mat.index = np.array(centroid_ids)
demand_mat.matrix["demand"][:, :] = od_array
demand_mat.computational_view(["demand"])

print(f"  Demand matrix loaded: {demand_mat.zones} zones")

# ── 5. Run traffic assignment ─────────────────────────────────────────────
print("\n[5/6] Running traffic assignment...")

assig = TrafficAssignment()

# Create traffic class
tc = TrafficClass(name="car", graph=graph, matrix=demand_mat)
tc.set_pce(1.0)  # passenger car equivalent
assig.add_class(tc)

# Assignment parameters
assig.set_vdf("BPR")  # Bureau of Public Roads volume-delay function
assig.set_vdf_parameters({"alpha": 0.15, "beta": 4.0})
assig.set_capacity_field("capacity_ab")
assig.set_time_field("free_flow_time")
assig.max_iter = 100
assig.rgap_target = 0.01  # 1% relative gap target

assig.set_algorithm("bfw")  # bi-conjugate Frank-Wolfe

print("  Running BFW assignment (max 100 iterations, 1% gap target)...")
assig.execute()

print(f"  Assignment complete!")
print(f"  Final gap: {assig.assignment.rgap:.4f}")
print(f"  Iterations: {assig.assignment.iteration}")

# ── 6. Extract results ────────────────────────────────────────────────────
print("\n[6/6] Extracting results and building evidence packet...")

# Get link volumes
results = assig.results()
results_df = results.get_load_results()

# Save link volumes
results_df.to_csv(os.path.join(OUT_DIR, "link_volumes.csv"))
print(f"  Exported: link_volumes.csv ({len(results_df)} links)")

# Corridor-level summaries
print("\n  Corridor KPI extraction...")
corridors = json.load(open(os.path.join(PKG_DIR, "corridors.json")))
corridor_results = []

for corr in corridors:
    # Match links by name
    corr_name = corr["name"]
    # Simple match — in production this would use spatial join
    mask = roads["FULLNAME"].str.contains(
        "|".join([corr_name.split("(")[0].strip().replace("SR-", "State Rte ").replace("I-80", "I- 80")]),
        case=False, na=False
    )
    if mask.any():
        corr_links = roads[mask].index.tolist()
        # Approximate total volume on corridor
        vol = results_df.loc[results_df.index.isin(corr_links), "tot_vol_ab"].sum() if "tot_vol_ab" in results_df.columns else 0
        corridor_results.append({
            "corridor_id": corr["corridor_id"],
            "name": corr["name"],
            "total_volume": float(vol),
            "segment_count": len(corr_links)
        })

with open(os.path.join(OUT_DIR, "corridor_kpis.json"), "w") as f:
    json.dump(corridor_results, f, indent=2)
print(f"  Exported: corridor_kpis.json")

# Build evidence packet summary
evidence = {
    "run_id": "nevada-county-pilot-001",
    "engine": "AequilibraE 1.6.1",
    "algorithm": "bi-conjugate Frank-Wolfe (BFW)",
    "vdf": "BPR (alpha=0.15, beta=4.0)",
    "convergence": {
        "final_gap": float(assig.assignment.rgap),
        "iterations": int(assig.assignment.iteration),
        "target_gap": 0.01
    },
    "network": {
        "total_links": int(graph.num_links),
        "total_nodes": int(graph.num_nodes),
        "zones": len(centroid_ids)
    },
    "demand": {
        "total_trips": float(od_array.sum()),
        "source": "LODES 2021 OD × 4.0 expansion"
    },
    "skims": {
        "avg_travel_time_min": float(np.nanmean(time_skim[time_skim > 0])),
        "max_travel_time_min": float(np.nanmax(time_skim[time_skim > 0]))
    },
    "artifacts": [
        "travel_time_skims.omx",
        "demand.omx",
        "link_volumes.csv",
        "corridor_kpis.json",
        "evidence_packet.json"
    ],
    "caveats": [
        "Uncalibrated — default speeds/capacities, not field-verified",
        "Closed boundary — no external trips modeled",
        "Synthetic demand — LODES work trips × expansion factor",
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

# ── Summary ──────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("AEQUILIBRAE ASSIGNMENT — RUN COMPLETE")
print("=" * 60)
print(f"  Engine: AequilibraE 1.6.1")
print(f"  Algorithm: BFW")
print(f"  Convergence: gap={assig.assignment.rgap:.4f}, iterations={assig.assignment.iteration}")
print(f"  Network: {graph.num_links} links, {graph.num_nodes} nodes, {len(centroid_ids)} zones")
print(f"  Demand: {od_array.sum():,.0f} daily trips")
print(f"  Artifacts: {OUT_DIR}/")
print(f"  Status: UNCALIBRATED SCREENING RUN")
print("=" * 60)

project.close()
