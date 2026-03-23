#!/usr/bin/env python3
"""
Generate deterministic proof/data-bundle support artifacts for the Nevada County
pilot package.

This script is intentionally low-collision:
- it does not modify worker runtime code
- it only reads committed pilot package/run artifacts already in the repo
- it emits JSON support artifacts for proof, QA, and future handoff wiring

Outputs:
  data/pilot-nevada-county/proof/
    - activitysim_input_bundle.json
    - input_provenance.json
    - runtime_qc.json
    - study_area_qc.json

Optional:
  --write-fixtures
    Also refreshes matching sample fixtures under data/pilot-nevada-county/fixtures/
"""
from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
PACKAGE_DIR = BASE_DIR / "package"
RUN_OUTPUT_DIR = BASE_DIR / "run_output"
SYNTHETIC_DIR = BASE_DIR / "synthetic_population"
PROOF_DIR = BASE_DIR / "proof"
FIXTURES_DIR = BASE_DIR / "fixtures"


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as fh:
        return list(csv.DictReader(fh))


def rel(path: Path) -> str:
    return path.relative_to(BASE_DIR.parents[1]).as_posix()


def bbox_list_from_manifest(package_manifest: dict[str, Any]) -> list[float] | None:
    bbox = ((package_manifest.get("geography") or {}).get("bbox")) or {}
    required = [bbox.get("west"), bbox.get("south"), bbox.get("east"), bbox.get("north")]
    if any(value is None for value in required):
        return None
    return [float(value) for value in required]


def load_zone_summary() -> dict[str, Any]:
    zone_rows = read_csv_rows(PACKAGE_DIR / "zone_attributes.csv")
    geoids = [row["GEOID"] for row in zone_rows]
    zone_ids = [int(float(row["zone_id"])) for row in zone_rows]
    total_population = int(round(sum(float(row.get("est_population") or 0) for row in zone_rows)))
    total_jobs = int(round(sum(float(row.get("total_jobs") or 0) for row in zone_rows)))
    centroid_missing = [
        row["GEOID"]
        for row in zone_rows
        if not (row.get("centroid_lon") and row.get("centroid_lat"))
    ]
    non_positive_population = [
        row["GEOID"]
        for row in zone_rows
        if float(row.get("est_population") or 0) <= 0
    ]
    return {
        "rows": zone_rows,
        "geoids": geoids,
        "zone_ids": zone_ids,
        "zone_count": len(zone_rows),
        "total_population": total_population,
        "total_jobs": total_jobs,
        "centroid_missing": centroid_missing,
        "non_positive_population": non_positive_population,
        "has_households": "households" in (zone_rows[0].keys() if zone_rows else []),
    }


def load_od_summary() -> dict[str, Any]:
    od_rows = read_csv_rows(PACKAGE_DIR / "od_trip_matrix.csv")
    if not od_rows:
        return {
            "shape": [0, 0],
            "total_trips": 0.0,
            "positive_cells": 0,
            "intrazonal_trips": 0.0,
            "intrazonal_share": 0.0,
            "zero_cells": 0,
        }

    zone_headers = [key for key in od_rows[0].keys() if key != "origin_zone"]
    total_trips = 0.0
    positive_cells = 0
    intrazonal = 0.0

    for row in od_rows:
        origin = str(int(float(row["origin_zone"])))
        for destination in zone_headers:
            value = float(row.get(destination) or 0)
            total_trips += value
            if value > 0:
                positive_cells += 1
            if origin == destination:
                intrazonal += value

    n = len(zone_headers)
    zero_cells = n * n - positive_cells
    intrazonal_share = intrazonal / total_trips if total_trips > 0 else 0.0
    return {
        "shape": [n, n],
        "total_trips": total_trips,
        "positive_cells": positive_cells,
        "intrazonal_trips": intrazonal,
        "intrazonal_share": intrazonal_share,
        "zero_cells": zero_cells,
    }


def load_marginals_summary() -> dict[str, Any]:
    path = SYNTHETIC_DIR / "tract_marginals.csv"
    if not path.exists():
        return {"rows": [], "geoids": [], "total_households": 0}
    rows = read_csv_rows(path)
    return {
        "rows": rows,
        "geoids": [row["geoid"] for row in rows],
        "total_households": int(round(sum(float(row.get("total_hh") or 0) for row in rows))),
    }


def load_runtime_summary() -> dict[str, Any]:
    evidence = read_json(RUN_OUTPUT_DIR / "evidence_packet.json")
    link_rows = read_csv_rows(RUN_OUTPUT_DIR / "link_volumes.csv") if (RUN_OUTPUT_DIR / "link_volumes.csv").exists() else []
    links_voc_gt_1 = 0
    loaded_links_csv = 0
    for row in link_rows:
        pce_tot = float(row.get("PCE_tot") or 0)
        voc_max = float(row.get("VOC_max") or 0)
        if pce_tot > 0:
            loaded_links_csv += 1
        if pce_tot > 0 and voc_max > 1.0:
            links_voc_gt_1 += 1

    total_trips = float(((evidence.get("demand") or {}).get("total_trips")) or 0)
    routable_trips = float(((evidence.get("demand") or {}).get("routable_trips")) or 0)
    unroutable_trips = total_trips - routable_trips
    routable_share = (routable_trips / total_trips) if total_trips > 0 else 0.0

    return {
        "evidence": evidence,
        "links_voc_gt_1": links_voc_gt_1,
        "loaded_links_csv": loaded_links_csv,
        "unroutable_trips": unroutable_trips,
        "routable_share": routable_share,
    }


def build_input_provenance(package_manifest: dict[str, Any], zone_summary: dict[str, Any]) -> dict[str, Any]:
    bbox = bbox_list_from_manifest(package_manifest)
    return {
        "schemaVersion": "openplan_input_provenance_v1",
        "studyArea": {
            "name": "Nevada County pilot",
            "selectionMode": "county_package_static",
            "bbox": bbox,
            "zoneSystem": "census_tract_centroid",
            "zoneCount": zone_summary["zone_count"],
            "tractGeoids": sorted(zone_summary["geoids"]),
            "countyFips": sorted({geoid[:5] for geoid in zone_summary["geoids"]}),
        },
        "datasets": [
            {
                "datasetKey": "tiger_roads_2023",
                "role": "screening_network_package",
                "source": ((package_manifest.get("network") or {}).get("source")),
                "repoArtifact": rel(PACKAGE_DIR / "network_links.geojson"),
            },
            {
                "datasetKey": "tiger_tracts_2023",
                "role": "zone_boundaries_and_centroids",
                "source": ((package_manifest.get("zones") or {}).get("source")),
                "repoArtifacts": [
                    rel(PACKAGE_DIR / "zones.geojson"),
                    rel(PACKAGE_DIR / "zone_centroids.geojson"),
                ],
            },
            {
                "datasetKey": "lodes_wac_2021",
                "role": "tract_employment_aggregation",
                "source": "ca_wac_S000_JT00_2021.csv.gz",
                "builder": rel(BASE_DIR / "build_trip_tables.py"),
            },
            {
                "datasetKey": "lodes_od_2021",
                "role": "internal_commute_seed_flows",
                "source": "ca_od_main_JT00_2021.csv.gz",
                "builder": rel(BASE_DIR / "build_trip_tables.py"),
            },
            {
                "datasetKey": "acs_2022_5yr",
                "role": "synthetic_population_controls",
                "source": f"Census API via {rel(SYNTHETIC_DIR / 'run_synthesis.py')}",
                "repoArtifact": rel(SYNTHETIC_DIR / "tract_marginals.csv"),
            },
        ],
        "derivations": {
            "populationEstimateMethod": "LODES workplace jobs scaled to ~102,000 county population in build_trip_tables.py",
            "screeningDemandMethod": "Internal LODES work trips expanded by factor 4.0 to approximate all-purpose daily trips",
            "currentStaticPackageLimitation": "Static zone_attributes.csv has jobs and estimated population but no households field",
        },
        "knownLimits": [
            "The current run evidence in-repo uses an OSM-derived AequilibraE network, not the TIGER screening network written to package/network_links.geojson.",
            "The package is tract-based and does not yet represent custom TAZ splits, external stations, or mode-specific connectors.",
            "All outputs remain screening-grade and uncalibrated until observed-count validation is completed.",
        ],
    }


def build_study_area_qc(
    package_manifest: dict[str, Any],
    zone_summary: dict[str, Any],
    od_summary: dict[str, Any],
    marginals_summary: dict[str, Any],
) -> dict[str, Any]:
    zone_geoids = set(zone_summary["geoids"])
    marginal_geoids = set(marginals_summary["geoids"])
    missing_in_marginals = sorted(zone_geoids - marginal_geoids)
    checks: list[dict[str, str]] = [
        {
            "name": "zone_ids_unique",
            "status": "pass" if len(set(zone_summary["zone_ids"])) == zone_summary["zone_count"] else "fail",
            "message": f"{len(set(zone_summary['zone_ids']))} unique zone_id values detected in zone_attributes.csv.",
        },
        {
            "name": "tract_geoids_unique",
            "status": "pass" if len(zone_geoids) == zone_summary["zone_count"] and not missing_in_marginals else "warn",
            "message": (
                f"{len(zone_geoids)} unique tract GEOIDs detected across zone artifacts and tract marginals."
                if not missing_in_marginals
                else f"{len(zone_geoids)} zone GEOIDs found, but {len(missing_in_marginals)} are missing from tract_marginals.csv."
            ),
        },
        {
            "name": "centroids_present",
            "status": "pass" if not zone_summary["centroid_missing"] else "fail",
            "message": (
                f"All {zone_summary['zone_count']} zones have centroid coordinates in the static package."
                if not zone_summary["centroid_missing"]
                else f"{len(zone_summary['centroid_missing'])} zones are missing centroid coordinates."
            ),
        },
        {
            "name": "positive_population",
            "status": "pass" if not zone_summary["non_positive_population"] else "fail",
            "message": (
                f"All {zone_summary['zone_count']} zones have positive estimated population in zone_attributes.csv."
                if not zone_summary["non_positive_population"]
                else f"{len(zone_summary['non_positive_population'])} zones have zero/non-positive estimated population."
            ),
        },
        {
            "name": "internal_od_coverage",
            "status": "warn" if od_summary["zero_cells"] > 0 else "pass",
            "message": (
                f"{od_summary['zero_cells']} of {od_summary['shape'][0] * od_summary['shape'][1]} OD cells are zero in the screening demand matrix; "
                "this reflects tract-level internal LODES flows plus expansion, not a behavioral all-purpose demand model."
            ),
        },
    ]

    return {
        "schemaVersion": "openplan_study_area_qc_v1",
        "studyAreaKey": "nevada-county-pilot",
        "bbox": bbox_list_from_manifest(package_manifest),
        "summary": {
            "zoneCount": zone_summary["zone_count"],
            "totalPopulation": zone_summary["total_population"],
            "totalJobsEstimate": zone_summary["total_jobs"],
            "totalTrips": int(round(od_summary["total_trips"])),
            "intrazonalTrips": int(round(od_summary["intrazonal_trips"])),
            "intrazonalShare": round(od_summary["intrazonal_share"], 4),
            "positiveOdCells": od_summary["positive_cells"],
            "zeroOdCells": od_summary["zero_cells"],
        },
        "checks": checks,
        "warnings": [
            "Pilot package uses Census tracts rather than custom TAZs or explicit external stations.",
            "Static zone_attributes.csv omits households, so ActivitySim land-use packaging must join tract_marginals.csv or refresh ACS household totals.",
            "Current run evidence is on an OSM-derived network, not a one-to-one replay of the TIGER screening network package.",
        ],
    }


def build_runtime_qc(runtime_summary: dict[str, Any]) -> dict[str, Any]:
    evidence = runtime_summary["evidence"]
    network = evidence.get("network") or {}
    skims = evidence.get("skims") or {}
    demand = evidence.get("demand") or {}
    convergence = evidence.get("convergence") or {}
    return {
        "schemaVersion": "openplan_runtime_qc_v0.1",
        "runId": evidence.get("run_id"),
        "stageKey": "run_assignment",
        "engine": {
            "name": "AequilibraE",
            "version": str(evidence.get("engine") or "").replace("AequilibraE ", "") or None,
            "algorithm": evidence.get("algorithm"),
            "vdf": str(evidence.get("vdf") or "").replace("α", "alpha").replace("β", "beta"),
        },
        "network": {
            "source": evidence.get("network_source"),
            "links": network.get("links"),
            "nodes": network.get("nodes"),
            "zones": network.get("zones"),
            "largestComponentPct": evidence.get("largest_component_pct"),
        },
        "demand": {
            "totalTrips": demand.get("total_trips"),
            "routableTrips": demand.get("routable_trips"),
            "unroutableTrips": round(runtime_summary["unroutable_trips"], 1),
            "routableShare": round(runtime_summary["routable_share"], 4),
        },
        "skims": {
            "reachablePairs": skims.get("reachable_pairs"),
            "totalPairs": skims.get("total_pairs"),
            "avgTimeMin": round(float(skims.get("avg_time_min") or 0), 4) if skims.get("avg_time_min") is not None else None,
            "maxTimeMin": round(float(skims.get("max_time_min") or 0), 4) if skims.get("max_time_min") is not None else None,
        },
        "assignment": {
            "loadedLinks": evidence.get("loaded_links") or runtime_summary["loaded_links_csv"],
            "linksVocGt1": runtime_summary["links_voc_gt_1"],
            "finalGap": convergence.get("final_gap"),
            "iterations": convergence.get("iterations"),
        },
        "flags": [
            {
                "severity": "warn",
                "message": (
                    f"Only {round(runtime_summary['routable_share'] * 100, 1)}% of requested trips were routable in the current pilot run; "
                    "preserve requested-versus-routed demand in downstream artifact contracts."
                ),
            },
            {
                "severity": "warn",
                "message": (
                    f"Largest connected component is {evidence.get('largest_component_pct')}% of nodes, so disconnected demand remains material and should be surfaced in QA."
                ),
            },
            {
                "severity": "warn",
                "message": (
                    f"{runtime_summary['links_voc_gt_1']} loaded links exceed VOC 1.0 under default OSM capacities; this is acceptable for screening but not for calibrated reporting."
                ),
            },
            {
                "severity": "warn",
                "message": "This run is explicitly uncalibrated, closed-boundary, and screening-grade.",
            },
        ],
        "repoArtifacts": [
            rel(RUN_OUTPUT_DIR / "evidence_packet.json"),
            rel(RUN_OUTPUT_DIR / "link_volumes.csv"),
            rel(RUN_OUTPUT_DIR / "top_loaded_links.geojson"),
        ],
    }


def build_activitysim_input_bundle(
    package_manifest: dict[str, Any],
    zone_summary: dict[str, Any],
    od_summary: dict[str, Any],
) -> dict[str, Any]:
    synthetic_households = SYNTHETIC_DIR / "seed_households.csv"
    synthetic_persons = SYNTHETIC_DIR / "seed_persons.csv"
    skims_omx = RUN_OUTPUT_DIR / "travel_time_skims.omx"
    return {
        "schemaVersion": "activitysim_input_bundle_v0.1",
        "studyAreaKey": "nevada-county-pilot",
        "packageName": package_manifest.get("package_name"),
        "packageVersion": package_manifest.get("version"),
        "zoneSystem": {
            "zoneType": "census_tract",
            "zoneCount": zone_summary["zone_count"],
            "zoneIdField": "zone_id",
            "externalZoneIdField": "GEOID",
        },
        "inputFiles": {
            "landUsePrecursor": rel(PACKAGE_DIR / "zone_attributes.csv"),
            "zoneBoundaries": rel(PACKAGE_DIR / "zones.geojson"),
            "zoneCentroids": rel(PACKAGE_DIR / "zone_centroids.geojson"),
            "tractMarginals": rel(SYNTHETIC_DIR / "tract_marginals.csv"),
            "screeningDemandMatrix": rel(PACKAGE_DIR / "od_trip_matrix.csv"),
            "syntheticHouseholds": rel(synthetic_households) if synthetic_households.exists() else None,
            "syntheticPersons": rel(synthetic_persons) if synthetic_persons.exists() else None,
            "skimsOmx": rel(skims_omx) if skims_omx.exists() else None,
        },
        "observedCurrentState": {
            "populationEstimate": zone_summary["total_population"],
            "jobEstimate": zone_summary["total_jobs"],
            "tripMatrixShape": od_summary["shape"],
            "dailyTripTotal": od_summary["total_trips"],
            "positiveOdCells": od_summary["positive_cells"],
        },
        "handoffNotes": [
            "zone_attributes.csv is a land-use-style precursor and not yet a final ActivitySim land_use.csv contract.",
            "Static pilot zone_attributes.csv does not include households; tract_marginals.csv or fresh ACS pulls must be joined by GEOID for household controls.",
            "synthetic_households.csv and synthetic_persons.csv are not yet materialized in-repo; run_synthesis.py is the intended builder.",
            "No skim OMX artifact is currently stored in the repo, so downstream ActivitySim packaging must not assume skims already exist.",
        ],
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2)
        fh.write("\n")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-fixtures", action="store_true", help="also write .sample.json fixtures")
    args = parser.parse_args()

    package_manifest = read_json(PACKAGE_DIR / "manifest.json")
    zone_summary = load_zone_summary()
    od_summary = load_od_summary()
    marginals_summary = load_marginals_summary()
    runtime_summary = load_runtime_summary()

    payloads = {
        "activitysim_input_bundle": build_activitysim_input_bundle(package_manifest, zone_summary, od_summary),
        "input_provenance": build_input_provenance(package_manifest, zone_summary),
        "runtime_qc": build_runtime_qc(runtime_summary),
        "study_area_qc": build_study_area_qc(package_manifest, zone_summary, od_summary, marginals_summary),
    }

    for key, payload in payloads.items():
        write_json(PROOF_DIR / f"{key}.json", payload)

    if args.write_fixtures:
        for key, payload in payloads.items():
            write_json(FIXTURES_DIR / f"{key}.sample.json", payload)

    print("Generated proof bundle artifacts:")
    for key in payloads:
        print(f"- {rel(PROOF_DIR / f'{key}.json')}")
    if args.write_fixtures:
        print("Refreshed fixtures:")
        for key in payloads:
            print(f"- {rel(FIXTURES_DIR / f'{key}.sample.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
