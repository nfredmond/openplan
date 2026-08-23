#!/usr/bin/env python3
"""Build the observed-count and calibration evidence carried by a model run.

This module does not decide how a U.S. source is queried. Country-specific
fields stay in the registered adapters; the worker receives their normalized
CSV/sidecar output and records what evidence this particular run actually had.
"""
from __future__ import annotations

import csv
import json
import os
from collections import Counter
from typing import Any, Literal, Mapping, Sequence, TypedDict


CountSourceStatus = Literal[
    "available",
    "source_unavailable",
    "geography_unsupported",
    "no_eligible_sections",
    "no_traffic_found",
    "not_recorded",
]


class IndependentValidationEvidence(TypedDict):
    status: Literal["passed", "failed", "not_run"]
    supports_claim_tier: bool
    reason: str
    stations_matched: int
    median_ape: float | None


def _load_json(path: str) -> dict[str, Any] | None:
    try:
        with open(path) as handle:
            value = json.load(handle)
        return value if isinstance(value, dict) else None
    except (OSError, ValueError, TypeError):
        return None


def _string(value: Any) -> str | None:
    text = str(value).strip() if value is not None else ""
    return text or None


def _number(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number


def summarize_count_source(counts_path: str | None, out_dir: str) -> dict[str, Any]:
    """Summarize the actual count set without collapsing a data gap into zero.

    HPMS writes a full normalized sidecar beside its CSV. ``auto_ingest_counts``
    also writes a compact status file for attempts that produced no CSV. Older
    and operator-supplied files remain usable, but are labeled as such rather
    than assigned an invented publisher or vintage.
    """
    status_record = _load_json(os.path.join(out_dir, "count_source_status.json")) or {}
    source_record = _load_json(f"{counts_path}.count-source.json") if counts_path else None
    source = (source_record or {}).get("source") if isinstance(source_record, dict) else None
    source = source if isinstance(source, dict) else {}

    rows: list[dict[str, str]] = []
    if counts_path and os.path.isfile(counts_path):
        try:
            with open(counts_path, newline="") as handle:
                rows = list(csv.DictReader(handle))
        except (OSError, csv.Error):
            rows = []

    status = _string(status_record.get("status"))
    if status not in {
        "available", "source_unavailable", "geography_unsupported",
        "no_eligible_sections", "no_traffic_found",
    }:
        status = _string((source_record or {}).get("status"))
    if status not in {
        "available", "source_unavailable", "geography_unsupported",
        "no_eligible_sections", "no_traffic_found",
    }:
        status = "available" if rows else "not_recorded"

    source_failed = status in {
        "source_unavailable", "geography_unsupported", "no_eligible_sections", "no_traffic_found"
    }
    evidence_rows = [] if source_failed else rows

    excluded_records = [
        record
        for record in ((source_record or {}).get("records") or [])
        if isinstance(record, dict) and record.get("exclusion_status") == "excluded"
    ]
    exclusion_reasons = Counter(
        _string(record.get("exclusion_reason")) or "reason_not_recorded"
        for record in excluded_records
    )
    # The retained CSV normally contains eligible rows only. Preserve any
    # explicitly excluded CSV rows too, without double-counting HPMS sidecar
    # records when that sidecar is present.
    if not source_record:
        csv_excluded = [row for row in evidence_rows if row.get("exclusion_status") == "excluded"]
        exclusion_reasons.update(
            _string(row.get("exclusion_reason")) or "reason_not_recorded"
            for row in csv_excluded
        )

    eligible_rows = [row for row in evidence_rows if row.get("exclusion_status") != "excluded"]
    classes = sorted({
        value
        for row in eligible_rows
        for value in [
            _string(row.get("facility_class")),
            *[part.strip() for part in (row.get("candidate_link_types") or "").split("|")],
        ]
        if value
    })
    dates = sorted({
        value
        for row in eligible_rows
        for value in [_string(row.get("measurement_date")), _string(row.get("count_year"))]
        if value
    })
    dataset_ids = sorted({
        value for row in evidence_rows for value in [_string(row.get("source_dataset_id"))] if value
    })
    vintages = sorted({
        value for row in evidence_rows for value in [_string(row.get("source_vintage"))] if value
    })
    agencies = sorted({
        value for row in evidence_rows for value in [_string(row.get("source_agency"))] if value
    })

    dataset_id = (
        _string(source.get("dataset_id"))
        or _string(status_record.get("dataset_id"))
        or (dataset_ids[0] if len(dataset_ids) == 1 else None)
    )
    vintage = (
        _string(source.get("vintage"))
        or _string(status_record.get("vintage"))
        or (vintages[0] if len(vintages) == 1 else None)
    )
    coverage_statement = (
        _string(source.get("coverage_statement"))
        or _string(status_record.get("coverage_statement"))
        or "Coverage was not recorded by this count file; absence is unknown, never zero traffic."
    )

    return {
        "status": status,
        "source_id": _string(source.get("source_id")) or _string(status_record.get("source_id")),
        "dataset_id": dataset_id,
        "adapter": _string(source.get("adapter")) or _string(status_record.get("adapter")),
        "country": _string(source.get("country")) or _string(status_record.get("country")),
        "vintage": vintage,
        "source_update_timestamp": _string(source.get("source_update_timestamp")),
        "source_agencies": agencies,
        "coverage_statement": coverage_statement,
        "supported_road_classes": classes,
        "eligible_rows": len(eligible_rows),
        "excluded_rows": int((source_record or {}).get("excluded_rows") or sum(exclusion_reasons.values())),
        "exclusion_reasons": dict(sorted(exclusion_reasons.items())),
        "measurement_dates": dates,
        "counts_file": os.path.basename(counts_path) if counts_path else None,
        "fallback_file_present": bool(source_failed and counts_path and os.path.isfile(counts_path)),
        "error": _string(status_record.get("error")) or _string((source_record or {}).get("error")),
        "limitation": (
            "An unsupported or absent road class is not evidence of zero traffic. "
            "Use only the road classes listed for this run."
        ),
    }


def summarize_gateway_volume_basis(gateways: Sequence[Mapping[str, Any]] | None) -> dict[str, Any]:
    """Count measured, inferred, and unsupported gateway volume bases.

    Current default gateways have no explicit basis stamp and are therefore
    inferred from road-class constants. A future accepted measured path must
    stamp each crossing; it will not receive measured credit merely because a
    count source happened to be present elsewhere in the run.
    """
    counts = Counter[str]()
    records: list[dict[str, Any]] = []
    for gateway in gateways or []:
        raw_basis = gateway.get("gateway_volume_basis") or gateway.get("volume_basis")
        if isinstance(raw_basis, Mapping):
            basis = _string(raw_basis.get("status") or raw_basis.get("basis"))
        else:
            basis = _string(raw_basis)
        if basis not in {"measured", "inferred", "unsupported"}:
            basis = "inferred" if _number(gateway.get("daily_in")) is not None else "unsupported"
        counts[basis] += 1
        records.append({
            "label": _string(gateway.get("label")),
            "road_class": _string(gateway.get("link_type")),
            "basis": basis,
        })
    return {
        "measured": counts["measured"],
        "inferred": counts["inferred"],
        "unsupported": counts["unsupported"],
        "total": len(records),
        "records": records,
        "default_method": "flat road-class daily volume times lanes, independently per crossing",
        "candidate_adopted": False,
        "limitation": (
            "The nationwide measured-AADT gateway candidate failed independent holdout validation; "
            "unstamped gateways retain the existing inferred volume basis."
        ),
    }


def summarize_calibration_selection(calibration: Mapping[str, Any] | None) -> dict[str, Any]:
    if not calibration:
        return {
            "status": "not_requested",
            "evidence_role": "candidate_selection_not_accuracy",
            "reason": "This run did not select calibration parameters against a count holdout.",
        }
    baseline = calibration.get("baseline") if isinstance(calibration.get("baseline"), Mapping) else {}
    selected = calibration.get("calibrated") if isinstance(calibration.get("calibrated"), Mapping) else {}
    baseline_holdout = baseline.get("holdout") if isinstance(baseline.get("holdout"), Mapping) else {}
    selected_holdout = selected.get("holdout") if isinstance(selected.get("holdout"), Mapping) else {}
    return {
        "status": "selected" if int(calibration.get("accepted_iterations") or 0) > 0 else "no_step_accepted",
        "evidence_role": "candidate_selection_not_accuracy",
        "fit_station_count": int(calibration.get("fit_station_count") or 0),
        "selection_holdout_station_count": int(calibration.get("holdout_station_count") or 0),
        "accepted_iterations": int(calibration.get("accepted_iterations") or 0),
        "baseline": {
            "objective": _number(baseline_holdout.get("objective")),
            "median_ape": _number(baseline_holdout.get("median_ape")),
        },
        "selected": {
            "objective": _number(selected_holdout.get("objective")),
            "median_ape": _number(selected_holdout.get("median_ape")),
        },
        "reason": (
            "This holdout chose among calibration steps. Because it influenced model selection, "
            "it is candidate-selection evidence and is not an independent accuracy result."
        ),
    }


def summarize_independent_validation(
    validation: Mapping[str, Any] | None,
    calibration: Mapping[str, Any] | None,
    independent_validation: Mapping[str, Any] | None = None,
) -> IndependentValidationEvidence:
    """Return the only evidence block allowed to promote a count-backed tier."""
    if calibration and not independent_validation:
        return {
            "status": "not_run",
            "supports_claim_tier": False,
            "reason": (
                "No untouched count set evaluated the selected calibration. The calibration holdout "
                "was used for candidate selection and cannot also establish accuracy."
            ),
            "stations_matched": 0,
            "median_ape": None,
        }

    result = independent_validation or validation
    if not result:
        return {
            "status": "not_run",
            "supports_claim_tier": False,
            "reason": "No independent observed-count validation result was recorded for this run.",
            "stations_matched": 0,
            "median_ape": None,
        }
    matched = int(result.get("stations_matched") or 0)
    median_ape = _number(result.get("median_ape"))
    zone = result.get("zone_resolution") if isinstance(result.get("zone_resolution"), Mapping) else {}
    zone_supported = zone.get("supports_link_level_validation") is not False
    gate_passed = result.get("screening_gate") == "bounded screening-ready"
    passed = bool(gate_passed and zone_supported and matched > 0 and median_ape is not None)
    if not zone_supported:
        reason = _string(zone.get("note")) or "This zone system cannot support link-level validation."
    elif not gate_passed:
        reason = "The independent observed-count comparison did not meet the screening gate."
    else:
        reason = "The independent observed-count comparison met the screening gate."
    return {
        "status": "passed" if passed else "failed",
        "supports_claim_tier": passed,
        "reason": reason,
        "stations_matched": matched,
        "median_ape": median_ape,
    }


def build_model_credibility_evidence(
    *,
    counts_path: str | None,
    out_dir: str,
    gateways: Sequence[Mapping[str, Any]] | None,
    validation: Mapping[str, Any] | None,
    calibration: Mapping[str, Any] | None,
    independent_validation: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "count_source": summarize_count_source(counts_path, out_dir),
        "gateway_volume_basis": summarize_gateway_volume_basis(gateways),
        "calibration_selection": summarize_calibration_selection(calibration),
        "independent_validation": summarize_independent_validation(
            validation, calibration, independent_validation
        ),
    }
