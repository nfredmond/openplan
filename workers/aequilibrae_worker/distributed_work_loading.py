#!/usr/bin/env python3
"""Source-bound work-trip endpoint distribution for controlled model studies.

This module contains no jurisdiction literals. A registry selects a country
adapter and supplies the geography, source records, and source-state vocabulary.
LODES is used only for home-to-work evidence. Non-work demand never enters this
module as if LODES described it.
"""
from __future__ import annotations

import hashlib
import json
import math
from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence
from typing import Any


INPUT_SCHEMA = "openplan.distributed-work-loading-input.v1"
AUDIT_SCHEMA = "openplan.pre-output-audit.v1"
COMPARISON_SCHEMA = "openplan.development-comparison.v1"
METHODS = ("aequilibrae", "activitysim")
SOURCE_STATES = (
    "covered",
    "explicit_zero",
    "suppressed",
    "unavailable_source",
    "unmapped",
    "unroutable",
    "inconclusive_missing_pair",
)


class DistributedWorkLoadingRefused(ValueError):
    """The candidate would weaken source custody or demand accounting."""


def canonical_bytes(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n").encode()


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def assignment_profile_sha256(profile: Mapping[str, Any]) -> str:
    """Hash the exact pre-output assignment method contract."""
    payload = json.dumps(
        dict(profile), sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode()
    return sha256_bytes(payload)


def require_assignment_profile_sha(
    expected_sha256: str, profile: Mapping[str, Any], label: str
) -> None:
    actual_sha256 = assignment_profile_sha256(profile)
    if actual_sha256 != expected_sha256:
        raise DistributedWorkLoadingRefused(
            f"Assignment runtime profile changed for {label}: "
            f"expected {expected_sha256}, found {actual_sha256}"
        )


def require_assignment_summary_profile(
    summary: Mapping[str, Any], expected_sha256: str, label: str
) -> Mapping[str, Any]:
    convergence = summary.get("convergence") or (summary.get("assignment") or {}).get("convergence")
    if not isinstance(convergence, Mapping):
        raise DistributedWorkLoadingRefused(
            f"Assignment summary omitted convergence custody for {label}"
        )
    if convergence.get("assignment_profile_digest") != expected_sha256:
        raise DistributedWorkLoadingRefused(
            f"Assignment output used an unbound runtime profile for {label}"
        )
    return convergence


def _finite_nonnegative(value: Any, label: str) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise DistributedWorkLoadingRefused(f"{label} is not numeric") from exc
    if not math.isfinite(number) or number < 0:
        raise DistributedWorkLoadingRefused(f"{label} is negative or non-finite")
    return number


def aggregate_access_points(blocks: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Aggregate source blocks only when they resolve to one routable node.

    Unmapped and unroutable records remain one record per block. Combining them
    would hide which source endpoint and demand could not reach assignment.
    """
    routable: dict[int, dict[str, Any]] = {}
    retained: list[dict[str, Any]] = []
    for raw in sorted(blocks, key=lambda item: str(item.get("block_id") or "")):
        block_id = str(raw.get("block_id") or "")
        if not block_id:
            raise DistributedWorkLoadingRefused("Access-point record omitted block_id")
        state = str(raw.get("resolution_state") or "")
        weight = _finite_nonnegative(raw.get("source_weight", 0), f"source weight for {block_id}")
        node_id = raw.get("network_node_id")
        record = {
            "access_point_id": f"block:{block_id}",
            "block_ids": [block_id],
            "resolution_state": state,
            "network_node_id": int(node_id) if node_id is not None else None,
            "source_weight": weight,
            "longitude": raw.get("longitude"),
            "latitude": raw.get("latitude"),
            "distance_to_node_meters": raw.get("distance_to_node_meters"),
            "component_id": raw.get("component_id"),
        }
        if state != "routable":
            if state not in {"unmapped", "unroutable", "unavailable_source"}:
                raise DistributedWorkLoadingRefused(f"Unknown access-point resolution state: {state}")
            retained.append(record)
            continue
        if node_id is None:
            raise DistributedWorkLoadingRefused(f"Routable block {block_id} omitted its network node")
        key = int(node_id)
        if key not in routable:
            record["access_point_id"] = f"node:{key}"
            routable[key] = record
        else:
            existing = routable[key]
            existing["block_ids"].append(block_id)
            existing["source_weight"] = float(existing["source_weight"]) + weight
            existing["distance_to_node_meters"] = max(
                float(existing.get("distance_to_node_meters") or 0),
                float(record.get("distance_to_node_meters") or 0),
            )
    return [routable[key] for key in sorted(routable)] + retained


def distribute_work_matrix(
    *,
    base_matrix: Sequence[Sequence[float]],
    work_matrix: Sequence[Sequence[float]],
    zone_ids: Sequence[int],
    access_point_ids: Sequence[str],
    access_point_index: Mapping[str, int],
    source_pairs: Mapping[tuple[int, int], Sequence[Mapping[str, Any]]],
) -> dict[str, Any]:
    """Replace supported work cells while preserving every other trip exactly.

    Each source-pair record carries home/work access point ids, a nonnegative
    source weight, and a source state. Only covered records with two loadable
    endpoints enter the expanded matrix. Every other share is retained with its
    state rather than moved, dropped, or relabelled zero.
    """
    n = len(zone_ids)
    if len(base_matrix) != n or len(work_matrix) != n:
        raise DistributedWorkLoadingRefused("Base and work matrices must match the ordered zone list")
    if len(set(zone_ids)) != n or len(set(access_point_ids)) != len(access_point_ids):
        raise DistributedWorkLoadingRefused("Zone and access-point ids must be unique")
    if set(access_point_index) != set(access_point_ids):
        raise DistributedWorkLoadingRefused("Access-point index does not cover the exact ordered ids")
    expanded_n = n + len(access_point_ids)
    candidate = [[0.0] * expanded_n for _ in range(expanded_n)]
    original_total = 0.0
    original_work_total = 0.0
    non_work_total = 0.0
    for i in range(n):
        if len(base_matrix[i]) != n or len(work_matrix[i]) != n:
            raise DistributedWorkLoadingRefused("Base and work matrices must be square")
        for j in range(n):
            base = _finite_nonnegative(base_matrix[i][j], "base demand")
            work = _finite_nonnegative(work_matrix[i][j], "work demand")
            if work > base + 1e-6:
                raise DistributedWorkLoadingRefused("Work demand exceeds the frozen total in an OD cell")
            non_work = max(0.0, base - work)
            candidate[i][j] += non_work
            original_total += base
            original_work_total += work
            non_work_total += non_work

    state_demand: Counter[str] = Counter()
    retained_records: list[dict[str, Any]] = []
    loaded_work_total = 0.0
    zone_position = {int(zone_id): index for index, zone_id in enumerate(zone_ids)}
    for origin in zone_ids:
        for destination in zone_ids:
            i, j = zone_position[int(origin)], zone_position[int(destination)]
            work = float(work_matrix[i][j])
            if work == 0:
                state_demand["explicit_zero"] += 0.0
                continue
            records = list(source_pairs.get((int(origin), int(destination)), ()))
            if not records:
                candidate[i][j] += work
                state_demand["inconclusive_missing_pair"] += work
                retained_records.append({
                    "origin_zone_id": int(origin), "destination_zone_id": int(destination),
                    "demand": work, "state": "inconclusive_missing_pair",
                    "reason": "No exact source pair was present; absence was not treated as zero or suppression.",
                })
                continue
            weights = [_finite_nonnegative(item.get("source_weight", 0), "source pair weight") for item in records]
            total_weight = sum(weights)
            if total_weight == 0:
                candidate[i][j] += work
                state_demand["explicit_zero"] += work
                retained_records.append({
                    "origin_zone_id": int(origin), "destination_zone_id": int(destination),
                    "demand": work, "state": "explicit_zero",
                    "reason": "The source pair was present with an explicit zero total.",
                })
                continue
            for item, weight in zip(records, weights):
                share = work * weight / total_weight
                state = str(item.get("source_state") or "covered")
                if state not in SOURCE_STATES:
                    raise DistributedWorkLoadingRefused(f"Unknown source state: {state}")
                home = str(item.get("home_access_point_id") or "")
                workplace = str(item.get("work_access_point_id") or "")
                origin_access = str(item.get("origin_access_point_id") or home)
                destination_access = str(item.get("destination_access_point_id") or workplace)
                if state == "covered" and origin_access in access_point_index and destination_access in access_point_index:
                    oi = n + int(access_point_index[origin_access])
                    dj = n + int(access_point_index[destination_access])
                    candidate[oi][dj] += share
                    loaded_work_total += share
                    state_demand["covered"] += share
                else:
                    candidate[i][j] += share
                    retained_state = state if state != "covered" else "unmapped"
                    state_demand[retained_state] += share
                    retained_records.append({
                        "origin_zone_id": int(origin), "destination_zone_id": int(destination),
                        "home_access_point_id": home or None, "work_access_point_id": workplace or None,
                        "origin_access_point_id": origin_access or None, "destination_access_point_id": destination_access or None,
                        "demand": share, "state": retained_state,
                        "reason": str(item.get("reason") or "Source-supported demand could not reach two routable access points."),
                    })
    candidate_total = sum(sum(row) for row in candidate)
    retained_total = sum(float(item["demand"]) for item in retained_records)
    accounting = {
        "original_total": original_total,
        "original_work_total": original_work_total,
        "non_work_total_unchanged": non_work_total,
        "work_loaded_at_access_points": loaded_work_total,
        "work_retained_at_original_centroids": retained_total,
        "candidate_total": candidate_total,
        "conservation_difference": candidate_total - original_total,
        "source_state_demand": {state: float(state_demand.get(state, 0.0)) for state in SOURCE_STATES},
    }
    if abs(candidate_total - original_total) > max(1e-6, original_total * 1e-10):
        raise DistributedWorkLoadingRefused("Distributed loading did not conserve exact demand")
    if abs(loaded_work_total + retained_total - original_work_total) > max(1e-6, original_work_total * 1e-10):
        raise DistributedWorkLoadingRefused("Work demand was lost between load points and retained records")
    return {"matrix": candidate, "accounting": accounting, "retained_work_demand": retained_records}


def validate_loading_input(value: Mapping[str, Any]) -> None:
    if value.get("schema") != INPUT_SCHEMA or value.get("method") not in METHODS:
        raise DistributedWorkLoadingRefused("Distributed loading input changed its schema or method")
    if value.get("method_aggregation") != "separate" or value.get("non_work_treatment") != "unchanged_not_supported_by_lodes":
        raise DistributedWorkLoadingRefused("LODES was broadened beyond separate work-trip loading")
    if value.get("arbitrary_point_cap") is not None or value.get("arbitrary_gateway_cap") is not None:
        raise DistributedWorkLoadingRefused("Distributed work loading cannot impose an arbitrary cap")
    source_states = value.get("source_states") or {}
    if set(source_states) != set(SOURCE_STATES):
        raise DistributedWorkLoadingRefused("Source states were combined or omitted")
    access_points = value.get("access_points") or []
    retained_points = value.get("retained_unroutable_access_points") or []
    all_blocks: list[str] = []
    for item in [*access_points, *retained_points]:
        all_blocks.extend(str(block) for block in item.get("block_ids") or [])
    if len(all_blocks) != len(set(all_blocks)):
        raise DistributedWorkLoadingRefused("A source block was duplicated across access points")
    accounting = value.get("demand_accounting") or {}
    original = _finite_nonnegative(accounting.get("original_total"), "original total")
    candidate = _finite_nonnegative(accounting.get("candidate_total"), "candidate total")
    loaded = _finite_nonnegative(accounting.get("work_loaded_at_access_points"), "loaded work")
    retained = _finite_nonnegative(accounting.get("work_retained_at_original_centroids"), "retained work")
    work = _finite_nonnegative(accounting.get("original_work_total"), "original work")
    retained_rows = value.get("retained_work_demand") or []
    retained_rows_total = sum(_finite_nonnegative(row.get("demand"), "retained row demand") for row in retained_rows)
    if abs(original - candidate) > max(1e-6, original * 1e-10):
        raise DistributedWorkLoadingRefused("Input artifact does not conserve total demand")
    if abs(loaded + retained - work) > max(1e-6, work * 1e-10):
        raise DistributedWorkLoadingRefused("Input artifact swallowed load-point or retained work demand")
    if abs(retained_rows_total - retained) > max(1e-6, retained * 1e-10):
        raise DistributedWorkLoadingRefused("Input artifact swallowed retained unroutable or unavailable demand")


def validate_pre_output_audit(value: Mapping[str, Any]) -> None:
    if value.get("schema") != AUDIT_SCHEMA or value.get("method") not in METHODS:
        raise DistributedWorkLoadingRefused("Pre-output audit changed its schema or method")
    if value.get("frozen_before_assignment_output") is not True or value.get("assignment_output_bytes_read") is not False:
        raise DistributedWorkLoadingRefused("Assignment output was accessed before exact custody froze")
    if value.get("holdout_accessed") is not False:
        raise DistributedWorkLoadingRefused("Pre-output audit crossed the forbidden holdout_accessed boundary")
    if value.get("methods_averaged") is not False:
        raise DistributedWorkLoadingRefused("Pre-output audit crossed the forbidden methods_averaged boundary")
    if value.get("defaults_changed") is not False:
        raise DistributedWorkLoadingRefused("Pre-output audit crossed the forbidden defaults_changed boundary")
    if value.get("candidate_promoted") is not False:
        raise DistributedWorkLoadingRefused("Pre-output audit crossed the forbidden candidate_promoted boundary")
    bindings = value.get("bindings") or {}
    required = {
        "registry", "source_release", "source_od", "source_rac", "source_wac", "source_crosswalk",
        "source_documentation", "source_work_layer", "zone_attributes", "loading_algorithm",
        "frozen_total_matrix", "loading_input", "candidate_matrix", "candidate_network",
        "frozen_network", "observation_package", "match_audit", "assignment_profile",
    }
    if set(bindings) != required:
        raise DistributedWorkLoadingRefused("Pre-output audit omitted or added an exact custody binding")
    for label, record in bindings.items():
        if not isinstance(record, Mapping) or not isinstance(record.get("sha256"), str) or len(str(record["sha256"])) != 64:
            raise DistributedWorkLoadingRefused(f"Pre-output binding {label} omitted an exact SHA-256")


def validate_development_comparison(value: Mapping[str, Any]) -> None:
    if value.get("schema") != COMPARISON_SCHEMA or value.get("method") not in METHODS:
        raise DistributedWorkLoadingRefused("Development comparison changed its schema or method")
    if value.get("scientific_outcome") != "inconclusive" or value.get("method_aggregation") != "separate":
        raise DistributedWorkLoadingRefused("Development comparison averaged methods or claimed validation")
    if value.get("holdout_accessed") is not False or value.get("defaults_changed") is not False:
        raise DistributedWorkLoadingRefused("Development comparison opened a holdout or changed defaults")
    records = value.get("records") or []
    coverage = value.get("coverage") or {}
    required = {"loaded", "unloaded", "unreachable", "excluded", "ambiguous", "unsupported", "missing_output"}
    if set(coverage.get("candidate") or {}) != required or sum(int(v) for v in coverage["candidate"].values()) != len(records):
        raise DistributedWorkLoadingRefused("Development comparison discarded an observed-link state")
    gate = value.get("development_gate") or {}
    county = value.get("county_stratum") or {}
    if not isinstance(county.get("geography_id"), str) or not isinstance(county.get("worsened"), bool):
        raise DistributedWorkLoadingRefused("Development comparison omitted its preregistered county stratum")
    if gate.get("advanced") is True and (
        gate.get("demand_conserved") is not True
        or gate.get("observed_link_reach_improved") is not True
        or gate.get("no_county_stratum_worsened") is not True
        or gate.get("no_road_class_worsened") is not True
        or gate.get("same_source_network_custody") is not True
    ):
        raise DistributedWorkLoadingRefused("A candidate advanced without every preregistered county gate")


def same_custody_by_method(audits: Sequence[Mapping[str, Any]]) -> bool:
    if {audit.get("method") for audit in audits} != set(METHODS):
        return False
    comparable = ("registry", "source_release", "source_od", "source_rac", "source_wac", "source_crosswalk", "source_documentation", "loading_algorithm", "candidate_network", "frozen_network", "observation_package", "match_audit", "assignment_profile")
    left, right = audits
    def exact(record: Any) -> tuple[Any, Any]:
        return (
            record.get("sha256") if isinstance(record, Mapping) else None,
            record.get("bytes") if isinstance(record, Mapping) else None,
        )
    return all(
        exact((left.get("bindings") or {}).get(key))
        == exact((right.get("bindings") or {}).get(key))
        for key in comparable
    )
