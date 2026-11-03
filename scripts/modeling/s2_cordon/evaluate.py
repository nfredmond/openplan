"""Execute the frozen development comparison. No discovery or holdout access."""
from __future__ import annotations

import csv
import gc
import hashlib
from importlib import metadata
import json
import os
from pathlib import Path
import statistics
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[3]
sys.path[:0] = [str(ROOT / "scripts/modeling"), str(ROOT / "workers/aequilibrae_worker")]
import numpy as np
import pandas as pd
from aequilibrae.matrix import AequilibraeMatrix
import count_validation
import external_distribution as distribution
import screening_runtime as runtime
from validate_screening_observed_counts import load_project_db_features

STUDY = "s2-cordon-impedance-development-20261023"
SCHEMA = "openplan.s2-cordon-development-result.v1"


def digest(path):
    with Path(path).open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def write(path, value):
    Path(path).write_text(json.dumps(value, sort_keys=True, indent=2, allow_nan=False) + "\n")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def prepare(registry, scratch):
    """Bind all input-only matches and matrices before assignment outputs exist."""
    archive = registry["archive"]
    require(digest(archive["path"]) == archive["sha256"], "Source archive changed")
    with zipfile.ZipFile(archive["path"]) as source:
        require(set(source.namelist()) == {r["member"] for r in registry["members"]}, "Archive membership changed")
        for record in registry["members"]:
            member = record["member"]
            require(not Path(member).is_absolute() and ".." not in Path(member).parts
                    and "holdout" not in member.lower(), "Forbidden source member")
            target = scratch / "inputs" / member
            target.parent.mkdir(parents=True, exist_ok=True)
            payload = source.read(member)
            require(len(payload) == record["bytes"] and hashlib.sha256(payload).hexdigest() == record["sha256"],
                    "Source member changed")
            target.write_bytes(payload)
    cases = []
    for geography in registry["geographies"]:
        county = geography["id"]
        directory = scratch / "inputs" / county
        setup = json.loads((directory / "work/network_setup_summary.json").read_text())
        zones = pd.read_csv(directory / "package/zone_attributes.csv")
        total_frame = pd.read_csv(directory / "package/od_trip_matrix.csv", index_col=0)
        ids = [int(x) for x in total_frame.index]
        require(ids == [int(x) for x in total_frame.columns], "OD ordering changed")
        zones = zones.set_index("zone_id", drop=False).loc[ids].reset_index(drop=True)
        centroid_map = {int(k): int(v) for k, v in setup["centroid_map"].items()}
        require(set(ids) == set(centroid_map), "Centroid coverage changed")
        skim = AequilibraeMatrix()
        skim.load(str(directory / "run_output/travel_time_skims.omx"))
        require("travel_time" in skim.names, "Skim does not supply minutes")
        positions = {int(node): i for i, node in enumerate(skim.index)}
        order = [positions[centroid_map[zone]] for zone in ids]
        times = np.array(skim.matrix["travel_time"], dtype=float)[np.ix_(order, order)]
        skim.close()
        base = np.array(total_frame, dtype=float)
        external = runtime.build_external_gateway_matrix(setup["gateways"], zones)
        reachable = np.isfinite(times) & (times > 0)
        np.fill_diagonal(reachable, True)
        external *= reachable
        require(np.isfinite(base).all() and (base >= 0).all(), "Invalid retained demand")
        require(float((base - external).min()) >= -0.011, "Reconstructed external layer exceeds baseline")
        mask = np.array([zone in set(runtime.external_zone_ids(zones)) for zone in ids])
        corrected, custody = distribution.condition_external_demand(external, times, mask, setting=distribution.CANDIDATE)
        candidate = base.copy()
        cross = mask[:, None] != mask[None, :]
        candidate[cross] = (base + corrected - external)[cross]
        require(float(candidate.min()) >= -0.011, "Candidate total demand became negative")
        # Preserve the recorded two-decimal baseline. Tiny subtraction noise alone is zeroed.
        candidate = np.maximum(candidate, 0.0)
        distribution.validate_candidate(base, candidate, mask[:, None] != mask[None, :])
        default, default_record = distribution.condition_external_demand(external, times, mask, setting="default")
        require(default is external and default.tobytes() == external.tobytes() and default_record is None,
                "Default changed")
        project = directory / "work/aeq_project"
        features = load_project_db_features(project / "project_database.sqlite", {}, "volume")
        with (directory / "counts/published_counts.csv").open() as handle:
            stations = list(csv.DictReader(handle))
        # Geometry-only matching. Volumes are zeros until every case has frozen its audit.
        matches = [count_validation.match_station(s, features) for s in stations]
        match_ids = [None if item is None else item["link_id"] for item in matches]
        audit = {"geography": county, "split": geography["split"], "method": "aequilibrae",
                 "ordered_zone_ids": ids, "ordered_centroid_nodes": [centroid_map[z] for z in ids],
                 "source_network_sha256": digest(project / "project_database.sqlite"),
                 "network_source": setup.get("network_source", "unknown"),
                 "network_downloaded_at": setup.get("network_downloaded_at", "unknown"),
                 "baseline_matrix_sha256": distribution.array_sha256(base),
                 "candidate_matrix_sha256": distribution.array_sha256(candidate),
                 "match_ids_sha256": hashlib.sha256(json.dumps(match_ids).encode()).hexdigest(),
                 "station_count": len(stations), "external_distribution": custody,
                 "external_unreachable_trips": float((runtime.build_external_gateway_matrix(setup["gateways"], zones) * ~reachable).sum()),
                 "assignment_output_opened": False, "model_day": "unknown", "model_year": "unknown",
                 "uncertainty": "unavailable: no documented intervals or comparable model day/year"}
        write(scratch / f"{county}-pre-output-audit.json", audit)
        cases.append({"geography": county, "split": geography["split"], "project": project,
                      "base": base, "candidate": candidate, "centroid_map": centroid_map,
                      "ids": ids, "stations": stations, "features": features, "match_ids": match_ids,
                      "audit": audit})
    return cases


def score(case, volumes):
    features = [{**feature, "volume": volumes[int(feature["link_id"])]} for feature in case["features"]]
    identities = [count_validation.match_station(s, features) for s in case["stations"]]
    require([None if item is None else item["link_id"] for item in identities] == case["match_ids"],
            "Output changed frozen matching")
    assessed = count_validation.validate_against_counts(case["stations"], features)
    rows = assessed["results"]
    matched = [r for r in rows if r["match_status"] == "matched"]
    def group(records):
        return {"stations": len(records),
                "median_ape": statistics.median(r["absolute_percent_error"] for r in records) if records else None,
                "median_signed_residual": statistics.median(r["modeled_daily_pce"] - r["observed_volume"] for r in records) if records else None,
                "median_absolute_residual": statistics.median(abs(r["modeled_daily_pce"] - r["observed_volume"]) for r in records) if records else None,
                "loaded_stations": sum(r["modeled_daily_pce"] > 0 for r in records),
                "uncertainty_aware_excess_ape": None, "uncertainty_status": "unavailable",
                "uncertainty_unavailable_stations": len(records)}
    groups = {kind: group([r for r in matched if (r.get("matched_link_type") or "unknown") == kind])
              for kind in sorted({r.get("matched_link_type") or "unknown" for r in matched})}
    network = {}
    for feature in features:
        kind = feature["link_type"] or "unknown"
        entry = network.setdefault(kind, {"links": 0, "loaded": 0, "unloaded": 0})
        entry["links"] += 1
        entry["loaded" if feature["volume"] > 0 else "unloaded"] += 1
    return {"county": group(matched), "road_classes": groups,
            "network_coverage": network, "stations_total": len(rows),
            "unmatched_or_excluded": len(rows) - len(matched),
            "matched_identity_sha256": hashlib.sha256(json.dumps([(r["station_id"], r["link_id"], r["carriageways_summed"]) for r in matched]).encode()).hexdigest(),
            "loaded_station_ids": [r["station_id"] for r in matched if r["modeled_daily_pce"] > 0],
            "raw_records": rows}


def county_decision(base, candidate, split, changed):
    reasons = []
    b, c = base["county"], candidate["county"]
    if not b["stations"] or not c["stations"]:
        return ["missing_matched_stations"]
    improvement = b["median_ape"] - c["median_ape"]
    if split == "evaluation" and improvement < 5:
        reasons.append("evaluation_improvement_below_5_points")
    if split == "diagnosis" and improvement < -1:
        reasons.append("diagnosis_worsened_over_1_point")
    for kind, row in base["road_classes"].items():
        other = candidate["road_classes"][kind]
        if row["stations"] >= 5 and other["median_ape"] - row["median_ape"] > 1:
            reasons.append(f"road_class_worsened:{kind}")
    if not set(base["loaded_station_ids"]).issubset(candidate["loaded_station_ids"]):
        reasons.append("lost_loaded_station")
    if changed == 0:
        reasons.append("inert_candidate")
    return reasons


def run(registry_path, scratch, output):
    registry = json.loads(Path(registry_path).read_text())
    expected = registry["runtime_versions"]
    require({name: metadata.version(name) for name in expected} == expected, "Runtime version drift")
    require(os.environ.get("AEQ_CORES") == "1", "Assignment core custody changed")
    cases = prepare(registry, scratch)
    results = []
    for case in cases:
        county = case["geography"]
        assignments, scores = {}, {}
        arms = ("baseline", "candidate", "repeat") if county == registry["repeat_geography"] else ("baseline", "candidate")
        for arm in arms:
            write(scratch / "progress.json", {"geography": county, "arm": arm, "stage": "assignment"})
            out = scratch / county / arm
            out.mkdir(parents=True)
            matrix = case["base"] if arm == "baseline" else case["candidate"]
            # Native assignment sorts centroid node IDs. Explicitly reorder demand to that axis.
            order = sorted(range(len(case["ids"])), key=lambda i: case["centroid_map"][case["ids"][i]])
            assigned = runtime.run_assignment(case["project"], case["centroid_map"],
                matrix[np.ix_(order, order)], out, {}, write_outputs=True)
            volumes = assigned.pop("volumes_by_link")
            write(out / "assignment.json", assigned)
            scores[arm] = score(case, volumes)
            write(out / "diagnostic.json", scores[arm])
            assignments[arm] = {"convergence": assigned["convergence"],
                                "network_state_digest": assigned["network_state_digest"],
                                "output_sha256": digest(out / "link_volumes.csv"),
                                "network_daily_vehicle_miles": assigned["network_daily_vehicle_miles"]}
            del volumes
            gc.collect()
        require(scores["baseline"]["matched_identity_sha256"] == scores["candidate"]["matched_identity_sha256"],
                "Matched station set changed")
        require(assignments["baseline"]["network_state_digest"] == assignments["candidate"]["network_state_digest"],
                "Assignment network changed")
        reasons = county_decision(scores["baseline"], scores["candidate"], case["split"],
                                 case["audit"]["external_distribution"]["changed_cells"])
        repeat_delta = None
        if "repeat" in scores:
            repeat_delta = abs(scores["repeat"]["county"]["median_ape"] - scores["candidate"]["county"]["median_ape"])
            if repeat_delta > 0.1:
                reasons.append("repeat_delta_above_0_1_point")
        for arm, record in assignments.items():
            if not record["convergence"].get("converged"):
                reasons.append(f"nonconverged:{arm}")
        for summary in scores.values():
            summary.pop("raw_records")
            summary.pop("loaded_station_ids")
        results.append({"geography": county, "split": case["split"], "decision": "retire" if reasons else "advance",
                        "reasons": reasons, "scores": scores, "assignments": assignments,
                        "repeat_median_ape_delta": repeat_delta, "audit": case["audit"]})
    rejected = any(row["reasons"] for row in results)
    write(output, {"schema_version": SCHEMA, "study_id": STUDY,
                   "decision": "rejected" if rejected else "accepted",
                   "development_decision": "retire" if rejected else "advance",
                   "scientific_accuracy": "inconclusive", "method": "aequilibrae",
                   "defaults_changed": False, "holdout_accessed": False,
                   "methods_averaged": False, "geographies": results})


if __name__ == "__main__":
    run(sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3]))
