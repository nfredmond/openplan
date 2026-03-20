#!/usr/bin/env python3
"""
AequilibraE Worker — polls Supabase for queued model_run_stages and executes
real traffic assignment using the proven OSM + AequilibraE pipeline.

Stage pipeline:
  1. AequilibraE Setup     — download OSM network, add centroids, renumber nodes
  2. Network Assignment    — build graph, run skims, load demand, run BFW
  3. Artifact Extraction   — export evidence packet, link volumes, skim matrix
"""
import os
import sys
import time
import json
import shutil
import sqlite3
import string
import hashlib
import re
import tempfile
from datetime import datetime, timezone
from typing import Tuple

import requests
import numpy as np
import pandas as pd
from shapely.geometry import box
from dotenv import load_dotenv

# Load Supabase creds from the Next.js env
load_dotenv("../../openplan/.env.local")

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise ValueError("Missing Supabase credentials in environment.")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation",
}

SPATIALITE_PATH = "/home/linuxbrew/.linuxbrew/lib/mod_spatialite"
os.environ["SPATIALITE_LIBRARY_PATH"] = SPATIALITE_PATH

# ─── OSM Builder patch (link-type ID collision fix for AequilibraE 1.6.x) ──
from aequilibrae.project.network.osm.osm_builder import OSMBuilder

def _patched_define_link_type(self, link_type: str) -> Tuple[str, str]:
    proj_link_types = self.project.network.link_types
    original = link_type
    link_type = "".join([x for x in link_type if x in string.ascii_letters + "_"]).lower()
    split = link_type.split("_")
    for i, piece in enumerate(split[1:]):
        if piece in ["link", "segment", "stretch"]:
            link_type = "_".join(split[: i + 1])
    if self._OSMBuilder__all_ltp.shape[0] >= 51:
        link_type = "aggregate_link_type"
    if len(link_type) == 0:
        link_type = "empty"
    if link_type in self._OSMBuilder__all_ltp.link_type.values:
        lt = proj_link_types.get_by_name(link_type)
        if lt is not None:
            if original not in lt.description:
                lt.description += f", {original}"
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
        lt.description = f"OSM: {original}"
        lt.save()
    except Exception:
        lt = proj_link_types.get(letter)
        if lt is not None:
            lt.link_type = link_type
            lt.description = f"OSM: {original}"
            lt.save()
    return [letter, link_type]

OSMBuilder._OSMBuilder__define_link_type = _patched_define_link_type

# ─── Default speed/capacity by link type ────────────────────────────────
LINK_DEFAULTS = {
    "motorway": (65, 2000, 2),
    "trunk": (55, 1800, 2),
    "primary": (45, 1200, 1),
    "secondary": (35, 900, 1),
    "tertiary": (30, 600, 1),
    "residential": (25, 400, 1),
    "unclassified": (25, 400, 1),
    "service": (15, 200, 1),
    "pedestrian": (5, 100, 1),
    "services": (15, 200, 1),
    "centroid_connector": (50, 99999, 1),
}


def _parse_speed(val):
    if val is None:
        return None
    m = re.search(r"(\d+)", str(val))
    return int(m.group(1)) if m else None


# ─── Supabase helpers ───────────────────────────────────────────────────
def sb_patch_stage(stage_id: str, payload: dict):
    url = f"{SUPABASE_URL}/rest/v1/model_run_stages?id=eq.{stage_id}"
    requests.patch(url, headers=HEADERS, json=payload)


def sb_patch_run(run_id: str, payload: dict):
    url = f"{SUPABASE_URL}/rest/v1/model_runs?id=eq.{run_id}"
    requests.patch(url, headers=HEADERS, json=payload)


def sb_post_artifact(payload: dict):
    url = f"{SUPABASE_URL}/rest/v1/model_run_artifacts"
    requests.post(url, headers=HEADERS, json=payload)


def sb_post_kpi(payload: dict):
    url = f"{SUPABASE_URL}/rest/v1/model_run_kpis"
    requests.post(url, headers=HEADERS, json=payload)


# ─── Stage 1: AequilibraE Setup ────────────────────────────────────────
def stage_setup(run_id: str, stage_id: str, work_dir: str, bbox: tuple) -> dict:
    """Download OSM, add centroids + connectors, renumber, populate attrs."""
    from aequilibrae import Project

    proj_dir = os.path.join(work_dir, "aeq_project")
    pkg_dir = os.path.join(work_dir, "package")

    log = "Creating AequilibraE project from OSM...\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    if os.path.exists(proj_dir):
        shutil.rmtree(proj_dir)

    project = Project()
    project.new(proj_dir)
    model_area = box(*bbox)
    project.network.create_from_osm(model_area=model_area, modes=["car"], clean=True)
    project.close()

    log += "OSM download complete.\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    # --- Add centroids and connectors ---
    db_path = os.path.join(proj_dir, "project_database.sqlite")
    conn = sqlite3.connect(db_path)
    conn.enable_load_extension(True)
    conn.load_extension(SPATIALITE_PATH)

    # Connectivity analysis
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

    log += f"Network: {len(nodes_all)} nodes, {len(links_raw)} links, {len(components)} components\n"
    log += f"Largest component: {len(largest)} nodes ({100*len(largest)/len(nodes_all):.1f}%)\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    # Ensure centroid_connector link type
    if not conn.execute("SELECT 1 FROM link_types WHERE link_type='centroid_connector'").fetchone():
        conn.execute(
            "INSERT INTO link_types (link_type, link_type_id, description, lanes, lane_capacity) "
            "VALUES ('centroid_connector', 'z', 'Virtual centroid connectors', 10, 10000)"
        )
        conn.commit()

    zones = pd.read_csv(os.path.join(pkg_dir, "zone_attributes.csv"))
    active_zones = zones[
        (zones["centroid_lon"] >= bbox[0]) & (zones["centroid_lon"] <= bbox[2]) &
        (zones["centroid_lat"] >= bbox[1]) & (zones["centroid_lat"] <= bbox[3])
    ].reset_index(drop=True)

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

        conn.execute(
            "INSERT INTO nodes (node_id, is_centroid, geometry) VALUES (?, 1, MakePoint(?, ?, 4326))",
            (centroid_nid, clon, clat),
        )

        nearest = conn.execute(
            "SELECT node_id, (X(geometry)-?)*(X(geometry)-?)+(Y(geometry)-?)*(Y(geometry)-?) as d2 "
            "FROM nodes WHERE is_centroid=0 AND node_id!=? ORDER BY d2 ASC LIMIT 50",
            (clon, clon, clat, clat, centroid_nid),
        ).fetchall()

        nearest_in_comp = [(nid, d) for nid, d in nearest if nid in largest][:3]
        for near_nid, dist2 in nearest_in_comp:
            nx, ny = conn.execute("SELECT X(geometry),Y(geometry) FROM nodes WHERE node_id=?", (near_nid,)).fetchone()
            line_wkt = f"LINESTRING({clon} {clat}, {nx} {ny})"
            length_m = max((dist2**0.5) * 111000, 10)
            conn.execute(
                "INSERT INTO links (link_id,a_node,b_node,direction,distance,modes,link_type,name,"
                "speed_ab,speed_ba,capacity_ab,capacity_ba,geometry) "
                "VALUES (?,?,?,0,?,'c','centroid_connector','connector',50,50,99999,99999,GeomFromText(?,4326))",
                (next_link, centroid_nid, near_nid, length_m, line_wkt),
            )
            next_link += 1
        centroid_map[zid] = centroid_nid
    conn.commit()

    log += f"Added {len(centroid_map)} centroids with connectors.\n"

    # --- Renumber to contiguous 1..N ---
    old_ids = [r[0] for r in conn.execute("SELECT node_id FROM nodes ORDER BY node_id")]
    remap = {old: new for new, old in enumerate(old_ids, 1)}
    for old, new in remap.items():
        if old != new:
            conn.execute("UPDATE nodes SET node_id=? WHERE node_id=?", (-new, old))
    conn.execute("UPDATE nodes SET node_id=-node_id WHERE node_id<0")
    for old, new in remap.items():
        if old != new:
            conn.execute("UPDATE links SET a_node=? WHERE a_node=?", (new, old))
            conn.execute("UPDATE links SET b_node=? WHERE b_node=?", (new, old))
    conn.commit()

    centroid_map = {z: remap[n] for z, n in centroid_map.items()}
    log += f"Renumbered to contiguous IDs (max={max(remap.values())})\n"

    # --- Populate speed/capacity from link types ---
    links_data = conn.execute(
        "SELECT link_id, link_type, speed_ab, speed_ba, distance, lanes_ab, lanes_ba FROM links"
    ).fetchall()
    updates = []
    for lid, lt, sp_ab, sp_ba, dist, ln_ab, ln_ba in links_data:
        def_speed, cap_per_lane, def_lanes = LINK_DEFAULTS.get(lt, (25, 400, 1))
        speed_ab = _parse_speed(sp_ab) or def_speed
        speed_ba = _parse_speed(sp_ba) or speed_ab
        tt_ab = (dist / (speed_ab * 1609.34 / 60)) if dist > 0 else 0.01
        tt_ba = (dist / (speed_ba * 1609.34 / 60)) if dist > 0 else 0.01
        cap_ab = cap_per_lane * (ln_ab or def_lanes)
        cap_ba = cap_per_lane * (ln_ba or def_lanes)
        updates.append((speed_ab, speed_ba, tt_ab, tt_ba, cap_ab, cap_ba, lid))
    conn.executemany(
        "UPDATE links SET speed_ab=?,speed_ba=?,travel_time_ab=?,travel_time_ba=?,capacity_ab=?,capacity_ba=? WHERE link_id=?",
        updates,
    )
    conn.commit()
    conn.close()

    log += f"Populated speed/capacity for {len(updates)} links.\nSetup complete.\n"

    return {
        "centroid_map": centroid_map,
        "bbox": bbox,
        "n_zones": len(centroid_map),
        "n_nodes": len(old_ids),
        "n_links": len(links_data),
        "largest_component_pct": round(100 * len(largest) / len(nodes_all), 1),
        "log": log,
    }


# ─── Stage 2: Network Assignment ───────────────────────────────────────
def stage_assignment(run_id: str, stage_id: str, work_dir: str, setup_result: dict) -> dict:
    from aequilibrae import Project
    from aequilibrae.matrix import AequilibraeMatrix
    from aequilibrae.paths import TrafficAssignment, TrafficClass, NetworkSkimming

    proj_dir = os.path.join(work_dir, "aeq_project")
    pkg_dir = os.path.join(work_dir, "package")
    out_dir = os.path.join(work_dir, "run_output")
    os.makedirs(out_dir, exist_ok=True)

    centroid_map = setup_result["centroid_map"]
    # Keys might be strings after JSON round-trip
    centroid_map = {int(k): int(v) for k, v in centroid_map.items()}
    centroids_sorted = sorted(centroid_map.values())
    n_zones = len(centroids_sorted)

    log = "Building graph...\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    project = Project()
    project.open(proj_dir)
    project.network.build_graphs(modes=["c"])
    graph = project.network.graphs["c"]
    graph.set_graph("travel_time")
    graph.prepare_graph(np.array(centroids_sorted))
    graph.set_blocked_centroid_flows(True)
    graph.set_skimming(["travel_time"])

    log += f"Graph: {graph.num_links} links, {graph.num_nodes} nodes\n"
    log += "Running skims...\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    skimming = NetworkSkimming(graph)
    skimming.execute()
    skim_mat = skimming.results.skims
    time_skim = skim_mat.matrix["travel_time"]

    finite = np.isfinite(time_skim) & (time_skim > 0)
    np.fill_diagonal(finite, False)
    n_reachable = int(finite.sum())
    n_pairs = n_zones * (n_zones - 1)

    avg_time = float(np.mean(time_skim[finite])) if n_reachable > 0 else None
    max_time = float(np.max(time_skim[finite])) if n_reachable > 0 else None

    skim_mat.export(os.path.join(out_dir, "travel_time_skims.omx"))
    log += f"Reachable OD pairs: {n_reachable}/{n_pairs}\n"

    # Load demand
    log += "Loading demand...\n"
    sb_patch_stage(stage_id, {"log_tail": log})

    od_full = pd.read_csv(os.path.join(pkg_dir, "od_trip_matrix.csv"), index_col=0)
    remap_inv = {v: k for k, v in centroid_map.items()}
    od_array = np.zeros((n_zones, n_zones))
    for i, ci in enumerate(centroids_sorted):
        for j, cj in enumerate(centroids_sorted):
            try:
                od_array[i, j] = od_full.loc[remap_inv[ci], str(remap_inv[cj])]
            except KeyError:
                pass

    total_trips = float(od_array.sum())
    od_array[~np.isfinite(time_skim)] = 0
    routable_trips = float(od_array.sum())

    demand_mat = AequilibraeMatrix()
    demand_mat.create_empty(
        file_name=os.path.join(out_dir, "demand.omx"),
        zones=n_zones, matrix_names=["demand"], memory_only=False,
    )
    demand_mat.index = np.array(centroids_sorted)
    demand_mat.matrix["demand"][:, :] = od_array
    demand_mat.computational_view(["demand"])

    log += f"Demand: {total_trips:,.0f} total, {routable_trips:,.0f} routable\n"
    log += "Running BFW assignment...\n"
    sb_patch_stage(stage_id, {"log_tail": log})

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

    results_df = assig.results()
    results_df.to_csv(os.path.join(out_dir, "link_volumes.csv"))
    loaded_links = int((results_df["PCE_tot"] > 0).sum()) if "PCE_tot" in results_df.columns else 0

    project.close()

    log += f"Converged: gap={rgap:.6f}, iterations={iters}\n"
    log += f"Links with volume: {loaded_links}/{len(results_df)}\n"

    return {
        "convergence": {"final_gap": float(rgap) if np.isfinite(rgap) else None, "iterations": int(iters)},
        "network": {"links": int(graph.num_links), "nodes": int(graph.num_nodes), "zones": n_zones},
        "demand": {"total_trips": total_trips, "routable_trips": routable_trips},
        "skims": {"reachable_pairs": n_reachable, "total_pairs": n_pairs,
                  "avg_time_min": avg_time, "max_time_min": max_time},
        "loaded_links": loaded_links,
        "log": log,
    }


# ─── Stage 3: Artifact Extraction ──────────────────────────────────────
def stage_artifacts(run_id: str, stage_id: str, work_dir: str, setup_result: dict, assign_result: dict) -> str:
    out_dir = os.path.join(work_dir, "run_output")

    evidence = {
        "run_id": run_id,
        "engine": "AequilibraE 1.6.1",
        "network_source": "OpenStreetMap",
        "algorithm": "BFW",
        "vdf": "BPR (α=0.15, β=4.0)",
        "convergence": assign_result["convergence"],
        "network": assign_result["network"],
        "demand": assign_result["demand"],
        "skims": assign_result["skims"],
        "loaded_links": assign_result["loaded_links"],
        "largest_component_pct": setup_result.get("largest_component_pct"),
        "caveats": ["Uncalibrated", "OSM default speeds/capacities", "Closed boundary", "Screening-grade"],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    evidence_path = os.path.join(out_dir, "evidence_packet.json")
    with open(evidence_path, "w") as f:
        json.dump(evidence, f, indent=2)

    # Register artifacts in Supabase
    for fname, atype in [
        ("link_volumes.csv", "link_volumes"),
        ("demand.omx", "demand_matrix"),
        ("travel_time_skims.omx", "skim_matrix"),
        ("evidence_packet.json", "evidence_packet"),
    ]:
        fpath = os.path.join(out_dir, fname)
        if os.path.exists(fpath):
            size = os.path.getsize(fpath)
            with open(fpath, "rb") as fh:
                content_hash = hashlib.sha256(fh.read()).hexdigest()[:16]
            sb_post_artifact({
                "run_id": run_id,
                "stage_id": stage_id,
                "artifact_type": atype,
                "file_url": f"local://{fpath}",
                "file_size_bytes": size,
                "content_hash": content_hash,
                "metadata_json": evidence if atype == "evidence_packet" else {"filename": fname},
            })

    # Register KPIs
    kpis = [
        ("network", "total_links", "Total Links", assign_result["network"]["links"], "count"),
        ("network", "total_nodes", "Total Nodes", assign_result["network"]["nodes"], "count"),
        ("network", "zones", "Zones", assign_result["network"]["zones"], "count"),
        ("demand", "total_trips", "Total Trips", assign_result["demand"]["total_trips"], "trips/day"),
        ("demand", "routable_trips", "Routable Trips", assign_result["demand"]["routable_trips"], "trips/day"),
        ("convergence", "rgap", "Relative Gap", assign_result["convergence"]["final_gap"], "ratio"),
        ("convergence", "iterations", "Iterations", assign_result["convergence"]["iterations"], "count"),
        ("results", "loaded_links", "Loaded Links", assign_result["loaded_links"], "count"),
    ]
    if assign_result["skims"]["avg_time_min"] is not None:
        kpis.append(("skims", "avg_travel_time", "Avg Travel Time", round(assign_result["skims"]["avg_time_min"], 1), "min"))
        kpis.append(("skims", "max_travel_time", "Max Travel Time", round(assign_result["skims"]["max_time_min"], 1), "min"))

    for cat, name, label, value, unit in kpis:
        sb_post_kpi({
            "run_id": run_id,
            "kpi_category": cat,
            "kpi_name": name,
            "kpi_label": label,
            "value": value,
            "unit": unit,
        })

    log = "Evidence packet + artifacts + KPIs written.\n"
    return log


# ─── Main poll loop ────────────────────────────────────────────────────
PILOT_WORK_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "pilot-nevada-county")
PILOT_BBOX = (-121.15, 39.15, -120.90, 39.30)


def process_stage(stage: dict):
    stage_id = stage["id"]
    run_id = stage["run_id"]
    stage_name = stage["stage_name"]
    now_iso = datetime.now(timezone.utc).isoformat()

    print(f"[{time.strftime('%X')}] Processing: {stage_name} (run={run_id[:8]}…)")

    # Claim
    sb_patch_stage(stage_id, {"status": "running", "started_at": now_iso, "log_tail": f"Starting {stage_name}..."})
    sb_patch_run(run_id, {"status": "running"})

    work_dir = PILOT_WORK_DIR  # For now, use the pilot data dir
    state_file = os.path.join(work_dir, "run_output", f"state_{run_id[:8]}.json")

    try:
        if stage_name == "AequilibraE Setup":
            result = stage_setup(run_id, stage_id, work_dir, PILOT_BBOX)
            os.makedirs(os.path.join(work_dir, "run_output"), exist_ok=True)
            with open(state_file, "w") as f:
                json.dump({"setup": result}, f)
            sb_patch_stage(stage_id, {
                "status": "succeeded",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "log_tail": result["log"],
            })

        elif stage_name == "Network Assignment":
            with open(state_file) as f:
                state = json.load(f)
            result = stage_assignment(run_id, stage_id, work_dir, state["setup"])
            state["assignment"] = result
            with open(state_file, "w") as f:
                json.dump(state, f)
            sb_patch_stage(stage_id, {
                "status": "succeeded",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "log_tail": result["log"],
            })

        elif stage_name == "Artifact Extraction":
            with open(state_file) as f:
                state = json.load(f)
            log = stage_artifacts(run_id, stage_id, work_dir, state["setup"], state["assignment"])
            sb_patch_stage(stage_id, {
                "status": "succeeded",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "log_tail": log,
            })

        else:
            sb_patch_stage(stage_id, {
                "status": "failed",
                "error_message": f"Unknown stage: {stage_name}",
                "completed_at": datetime.now(timezone.utc).isoformat(),
            })
            return

        print(f"[{time.strftime('%X')}] ✅ {stage_name} succeeded")

    except Exception as e:
        error_msg = f"{type(e).__name__}: {e}"
        print(f"[{time.strftime('%X')}] ❌ {stage_name} failed: {error_msg}")
        sb_patch_stage(stage_id, {
            "status": "failed",
            "error_message": error_msg[:2000],
            "completed_at": datetime.now(timezone.utc).isoformat(),
        })
        sb_patch_run(run_id, {"status": "failed"})
        return

    # Check if run is complete
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/model_run_stages?run_id=eq.{run_id}&status=neq.succeeded",
        headers=HEADERS,
    )
    if res.status_code == 200 and not res.json():
        print(f"[{time.strftime('%X')}] 🎉 Run {run_id[:8]}… complete!")
        sb_patch_run(run_id, {"status": "succeeded", "completed_at": datetime.now(timezone.utc).isoformat()})


def poll_for_jobs():
    print(f"AequilibraE Worker started at {time.strftime('%c')}")
    print(f"Polling {SUPABASE_URL} for queued stages...")

    while True:
        try:
            url = (
                f"{SUPABASE_URL}/rest/v1/model_run_stages"
                "?status=eq.queued&order=run_id.asc,sort_order.asc&limit=1"
            )
            res = requests.get(url, headers=HEADERS)
            if res.status_code != 200:
                print(f"Poll error: {res.text}")
                time.sleep(5)
                continue

            stages = res.json()
            if not stages:
                time.sleep(5)
                continue

            process_stage(stages[0])

        except Exception as e:
            print(f"Poll loop error: {e}")
            time.sleep(5)


if __name__ == "__main__":
    poll_for_jobs()
