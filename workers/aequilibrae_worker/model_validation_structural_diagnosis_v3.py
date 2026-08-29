#!/usr/bin/env python3
"""Post-output structural diagnosis joined to the frozen v0.41 instrument."""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
from collections import Counter
from pathlib import Path
from typing import Any, Mapping, Sequence

import model_structural_input_audit as input_audit


DIAGNOSIS_SCHEMA = "openplan.model-validation-structural-diagnosis.v3"
METHODS = ("aequilibrae", "activitysim")
UNKNOWN = "unknown"


class StructuralDiagnosisRefused(ValueError):
    """A v3 diagnosis cannot preserve the exact frozen evidence boundary."""


def read_json(path: str | Path) -> dict[str, Any]:
    candidate = Path(path)
    payload = gzip.decompress(candidate.read_bytes()) if candidate.suffix == ".gz" else candidate.read_bytes()
    value = json.loads(payload)
    if not isinstance(value, dict):
        raise StructuralDiagnosisRefused(f"Required JSON is not an object: {candidate}")
    return value


def read_output(path: str | Path) -> tuple[dict[str, float], str]:
    payload = Path(path).read_bytes()
    reader = csv.DictReader(io.StringIO(payload.decode("utf-8")))
    fields = reader.fieldnames or []
    value_field = next((field for field in ("PCE_tot", "demand_tot", "volume", "loaded_volume") if field in fields), None)
    if value_field is None or "link_id" not in fields:
        raise StructuralDiagnosisRefused("Model output omitted link_id or a supported volume field")
    values: dict[str, float] = {}
    for row in reader:
        identifier = str(row.get("link_id") or "")
        if not identifier or identifier in values:
            raise StructuralDiagnosisRefused("Model output contains a blank or duplicate link id")
        values[identifier] = float(row[value_field])
    return values, hashlib.sha256(payload).hexdigest()


def _classification(match: Mapping[str, Any], volumes: Mapping[str, float]) -> tuple[str, float | str]:
    status = str(match.get("status") or "unsupported")
    if status == "matched":
        identifiers = [str(value) for value in match.get("selected_link_ids") or []]
        if not identifiers or any(identifier not in volumes for identifier in identifiers):
            return "missing_output", UNKNOWN
        value = sum(volumes[identifier] for identifier in identifiers)
        return ("unloaded" if value == 0 else "loaded"), value
    if status == "excluded":
        return "excluded", UNKNOWN
    if status == "ambiguous":
        return "ambiguous", UNKNOWN
    if status == "genuine_network_absence":
        return "unreachable", UNKNOWN
    return "unsupported", UNKNOWN


def _group(rows: Sequence[Mapping[str, Any]], field: str) -> dict[str, dict[str, int]]:
    grouped: dict[str, Counter[str]] = {}
    for row in rows:
        key = str(row.get(field) or UNKNOWN)
        grouped.setdefault(key, Counter())[str(row["classification"])] += 1
    return {key: dict(sorted(counts.items())) for key, counts in sorted(grouped.items())}


def build_structural_diagnosis(
    *,
    diagnosis_id: str,
    audit: Mapping[str, Any],
    observation_package_path: str | Path,
    match_audit_path: str | Path,
    v041_diagnosis_path: str | Path,
    model_output_path: str | Path,
    expected_output_sha256: str,
    registry_sha256: str,
    audit_sha256: str,
    created_at: str,
    release: Mapping[str, Any],
) -> dict[str, Any]:
    input_audit.validate_structural_input_audit(audit)
    method = str(audit["method"])
    if method not in METHODS:
        raise StructuralDiagnosisRefused("Diagnosis combined or renamed demand methods")
    package = read_json(observation_package_path)
    match_document = read_json(match_audit_path)
    predecessor = read_json(v041_diagnosis_path)
    observations = package.get("observations") or []
    matches = match_document.get("matches") or []
    if [str(item.get("observation_id")) for item in observations] != [str(item.get("observation_id")) for item in matches]:
        raise StructuralDiagnosisRefused("v3 diagnosis cannot drop, reorder, or invent frozen observation ids")

    # This is the first output read in the diagnosis. The caller must already
    # have frozen every input audit in the study.
    volumes, output_sha256 = read_output(model_output_path)
    if output_sha256 != expected_output_sha256:
        raise StructuralDiagnosisRefused("Model output changed after the v4 registry freeze")

    rows = []
    for observation, match in zip(observations, matches):
        classification, modeled_value = _classification(match, volumes)
        rows.append({
            "observation_id": str(observation["observation_id"]),
            "classification": classification,
            "frozen_match_status": str(match.get("status") or UNKNOWN),
            "selected_link_ids": list(match.get("selected_link_ids") or []),
            "modeled_value": modeled_value,
            "facility_class": str((observation.get("facility") or {}).get("class") or UNKNOWN),
            "direction_treatment": str(match.get("direction_aggregation") or UNKNOWN),
            "demand_component": "combined_assignment",
        })
    counts = Counter(str(row["classification"]) for row in rows)
    required = {"loaded", "unloaded", "unreachable", "excluded", "ambiguous", "unsupported", "missing_output"}
    coverage = {key: counts.get(key, 0) for key in sorted(required)}
    audit_demand = audit["external_and_through_travel"]["demand_totals"]
    diagnosis = {
        "schema": DIAGNOSIS_SCHEMA,
        "diagnosis_id": diagnosis_id,
        "created_at": created_at,
        "geography": dict(audit["geography"]),
        "method": method,
        "scientific_outcome": "inconclusive",
        "release": dict(release),
        "bindings": {
            "release_sha": str(release["sha"]),
            "app_version": str(release["version"]),
            "v4_registry_sha256": registry_sha256,
            "v041_custody_sha256": input_audit.sha256_file(v041_diagnosis_path),
            "demand_package_sha256": audit["source_hashes"]["od_matrix"]["sha256"],
            "network_sha256": audit["source_hashes"]["network"]["sha256"],
            "input_audit_sha256": audit_sha256,
            "model_output_sha256": output_sha256,
            "comparison_basis_sha256": predecessor["bindings"]["comparison_basis_sha256"],
            "predecessor_diagnosis_sha256": input_audit.sha256_file(v041_diagnosis_path),
        },
        "record_coverage": coverage,
        "records": rows,
        "grouped_counts": {
            "method": {method: coverage},
            "facility_class": _group(rows, "facility_class"),
            "direction_treatment": _group(rows, "direction_treatment"),
            "demand_component": _group(rows, "demand_component"),
        },
        "demand_components": {
            "II": audit_demand.get("II", 0.0), "IE": audit_demand.get("IE", 0.0),
            "EI": audit_demand.get("EI", 0.0), "EE": audit_demand.get("EE", 0.0),
            "link_attribution": "unavailable: the frozen combined assignment output does not retain component-specific link flows",
        },
        "network_loading": {
            "output_link_records": len(volumes),
            "loaded_links": sum(value != 0 for value in volumes.values()),
            "unloaded_links": sum(value == 0 for value in volumes.values()),
            "loadable_roadway_links": audit["network_loading_readiness"]["loadable_roadway_links"],
            "structurally_unreachable_roadway_links": audit["network_loading_readiness"]["structurally_unreachable_roadway_links"],
            "minor_road_skeleton": {
                key: audit["network_loading_readiness"]["facility_coverage"].get(key, 0)
                for key in ("residential", "service", "unclassified", "tertiary")
            },
            "assignment_readiness": dict(audit["network_loading_readiness"]["assignment_readiness"]),
        },
        "limitations": [
            "This diagnoses structural coverage and limitations. It does not claim improved accuracy.",
            "Residuals did not change any input, match, classification rule, or model default.",
            "The frozen output combines internal, external, and through flow on each link, so component-specific link loading is unavailable.",
            "Non-work through-travel evidence is unsupported and the applied through share is an assumption.",
            "No method is ranked or selected and method values are never averaged.",
        ],
    }
    if len(rows) != len(observations) or sum(coverage.values()) != len(rows):
        raise StructuralDiagnosisRefused("Diagnosis discarded a frozen zero, unloaded, or unsupported record")
    validate_structural_diagnosis(diagnosis)
    return diagnosis


def validate_structural_diagnosis(value: Mapping[str, Any]) -> None:
    """Reject a post-output document that hides coverage or combines methods."""
    if value.get("schema") != DIAGNOSIS_SCHEMA or value.get("scientific_outcome") != "inconclusive":
        raise StructuralDiagnosisRefused("Structural diagnosis changed its scientific contract")
    if value.get("method") not in METHODS:
        raise StructuralDiagnosisRefused("Structural diagnosis combined demand methods")
    rows = value.get("records") or []
    coverage = value.get("record_coverage") or {}
    required = {"loaded", "unloaded", "unreachable", "excluded", "ambiguous", "unsupported", "missing_output"}
    if set(coverage) != required or sum(int(coverage[key]) for key in required) != len(rows):
        raise StructuralDiagnosisRefused("Diagnosis discarded a frozen zero, unloaded, or unsupported record")
    actual = Counter(str(row.get("classification")) for row in rows)
    if any(actual.get(key, 0) != int(coverage[key]) for key in required):
        raise StructuralDiagnosisRefused("Diagnosis coverage does not match retained records")
    loading = value.get("network_loading") or {}
    if int(loading.get("loaded_links", -1)) + int(loading.get("unloaded_links", -1)) != int(loading.get("output_link_records", -2)):
        raise StructuralDiagnosisRefused("Diagnosis discarded unloaded output links")


def compare_methods(left: Mapping[str, Any], right: Mapping[str, Any]) -> list[dict[str, Any]]:
    if {left.get("method"), right.get("method")} != set(METHODS):
        raise StructuralDiagnosisRefused("Method comparison requires one exact record per method")
    by_method = {str(left["method"]): left, str(right["method"]): right}
    first = {row["observation_id"]: row for row in by_method["aequilibrae"]["records"]}
    second = {row["observation_id"]: row for row in by_method["activitysim"]["records"]}
    if set(first) != set(second):
        raise StructuralDiagnosisRefused("Method comparison changed frozen observation membership")
    result = []
    for identifier in sorted(first):
        a = first[identifier]["modeled_value"]
        b = second[identifier]["modeled_value"]
        numeric = isinstance(a, (int, float)) and isinstance(b, (int, float))
        result.append({
            "observation_id": identifier,
            "aequilibrae": a, "activitysim": b,
            "difference_activitysim_minus_aequilibrae": b - a if numeric else UNKNOWN,
            "ratio_activitysim_to_aequilibrae": b / a if numeric and a != 0 else UNKNOWN,
        })
    return result
