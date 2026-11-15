"""Use-specific acceptance arithmetic, separate from diagnostic rules-v5.

This module does no file, network, model, or holdout access. A trusted runner
supplies the independently retained freeze record and pre-opening custody
snapshot. It must enforce one-opening access and authenticate source artifacts.
A matching hash proves byte identity, not the authority of a caller's record.
"""
from __future__ import annotations

import hashlib
import json
import math
import statistics
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Mapping, Sequence

METHODS = ("aequilibrae", "activitysim")
LEVELS = ("link", "screenline", "system", "state", "archetype")
METRICS = {
    "max_raw_ape", "raw_percent_rmse", "pearson_correlation",
    "share_within_tolerance", "max_excess_ape", "excess_percent_rmse",
}
BASIS_FIELDS = ("year", "day", "period", "direction", "lanes", "vehicle", "unit", "quantity")
SHARED_FIELDS = ("network", "population", "scenario", "match_audit", "interval_method")


class AcceptanceRefused(ValueError):
    """Custody or protocol failure. No scientific assessment is returned."""


@dataclass(frozen=True)
class FrozenRecord:
    study_id: str
    sha256: str
    frozen_at: str


def _require(condition: bool, reason: str) -> None:
    if not condition:
        raise AcceptanceRefused(reason)


def _hash(value: Any) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)


def _number(value: Any) -> bool:
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def _text(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip()) and value != "unknown"


def _unique(values: Any, label: str) -> list[str]:
    _require(isinstance(values, list) and bool(values) and all(_text(x) for x in values), label)
    _require(len(values) == len(set(values)), label)
    return values


def _object_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        _require(key not in result, "duplicate JSON key")
        result[key] = value
    return result


def _timestamp(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except (TypeError, ValueError) as exc:
        raise AcceptanceRefused("invalid freeze time") from exc
    _require(parsed.tzinfo is not None, "freeze time requires a timezone")
    return parsed


def _protocol(payload: bytes, record: FrozenRecord) -> dict[str, Any]:
    _require(_hash(record.sha256) and hashlib.sha256(payload).hexdigest() == record.sha256,
             "preregistration hash differs from frozen record")
    try:
        protocol = json.loads(payload, object_pairs_hook=_object_pairs,
                              parse_constant=lambda _: (_ for _ in ()).throw(AcceptanceRefused("nonfinite JSON")))
        _require(isinstance(protocol, dict), "preregistration must be an object")
        _require(protocol["schema"] == "openplan.acceptance-protocol.v1" and protocol["status"] == "frozen",
                 "unsupported or unfrozen preregistration")
        _require(protocol["study_id"] == record.study_id and _text(record.study_id)
                 and protocol["frozen_at"] == record.frozen_at, "frozen record identity differs")
        _timestamp(record.frozen_at)
        _require(protocol["methods"] == list(METHODS), "both methods must remain separate")
        _require(set(protocol["shared_context"]) == set(SHARED_FIELDS)
                 and all(_hash(v) for v in protocol["shared_context"].values()), "shared input custody missing")
        _require(set(protocol["method_context"]) == set(METHODS)
                 and all(_hash(v) for v in protocol["method_context"].values()), "method code/settings custody missing")
        _require(protocol["interval_aggregation"] == "weighted_envelope", "unsupported interval aggregation")
        jurisdictions = _unique(protocol["jurisdictions"], "required jurisdictions missing or duplicate")
        archetypes = _unique(protocol["archetypes"], "required archetypes missing or duplicate")
        uses = _unique(protocol["uses"], "required uses missing or duplicate")
        cells = protocol["cells"]
        _require(isinstance(cells, list) and bool(cells), "required cells missing")
        cell_ids = _unique([c["id"] for c in cells], "cell identities missing or duplicate")
        _require(len({(c["jurisdiction"], c["archetype"], c["use"]) for c in cells}) == len(cells), "duplicate claim cell")
        _require(all(c["jurisdiction"] in jurisdictions and c["archetype"] in archetypes
                     and c["use"] in uses for c in cells), "cell outside declared scope")
        _require(all(any(c["jurisdiction"] == j and c["use"] == u for c in cells)
                     for j in jurisdictions for u in uses), "jurisdiction/use scope omitted")
        _require(all(any(c["archetype"] == a and c["use"] == u for c in cells)
                     for a in archetypes for u in uses), "archetype/use scope omitted")
        blocks = protocol["blocks"]
        _unique([b["id"] for b in blocks], "geographic blocks missing or duplicate")
        _require(all(b["partition"] in {"development", "selection", "acceptance"} for b in blocks), "invalid partition")
        # Every corridor/source lineage cluster has one partition, even across borders.
        clusters: dict[str, str] = {}
        for block in blocks:
            for cluster in _unique(block["clusters"], "independence clusters missing"):
                _require(cluster not in clusters, "geographic/source cluster overlaps partitions or blocks")
                clusters[cluster] = block["partition"]
        specs = protocol["observations"]
        _unique([s["id"] for s in specs], "observation manifest missing or duplicate")
        _unique([s["lineage"] for s in specs], "duplicate source lineage")
        by_block = {b["id"]: b for b in blocks}
        for spec in specs:
            _require(spec["block"] in by_block and by_block[spec["block"]]["partition"] == "acceptance",
                     "observation is not in an acceptance block")
            _require(spec["cluster"] in by_block[spec["block"]]["clusters"], "observation cluster differs from block")
            _require(spec["jurisdiction"] in jurisdictions and set(_unique(spec["archetypes"], "observation archetypes missing")) <= set(archetypes), "observation outside declared scope")
            _require(_hash(spec["source_sha256"]), "source artifact hash missing")
            _require(set(spec["basis"]) == set(BASIS_FIELDS) and all(_text(v) for v in spec["basis"].values()), "comparison basis missing")
        gates = protocol["gates"]
        _unique([g["id"] for g in gates], "gates missing or duplicate")
        by_spec = {s["id"]: s for s in specs}
        by_cell = {c["id"]: c for c in cells}
        for gate in gates:
            _require(gate["cell"] in cell_ids and gate["level"] in LEVELS and gate["metric"] in METRICS, "unsupported gate")
            _require(gate["operator"] in {"lt", "le", "ge"} and _number(gate["threshold"]), "invalid threshold")
            _require(gate["operator"] == "ge" if gate["metric"] in {"pearson_correlation", "share_within_tolerance"}
                     else gate["operator"] in {"lt", "le"}, "metric operator has wrong direction")
            _require(-1 <= gate["threshold"] <= 1 if gate["metric"] == "pearson_correlation"
                     else 0 <= gate["threshold"] <= 100 if gate["metric"] == "share_within_tolerance"
                     else gate["threshold"] >= 0, "threshold outside metric domain")
            _require(_text(gate["source"]) and _text(gate["source_quote"]) and _text(gate["sample_size_basis"]), "gate evidence missing")
            _require(type(gate["minimum_independent_clusters"]) is int and gate["minimum_independent_clusters"] > 0, "invalid evidence minimum")
            groups = gate["groups"]
            _unique([g["id"] for g in groups], "comparison groups missing or duplicate")
            selected: set[str] = set()
            for group in groups:
                members = group["members"]
                _require(isinstance(members, dict) and bool(members), "empty comparison group")
                _require(all(k in by_spec and _number(v) and v > 0 for k, v in members.items()), "invalid member or weight")
                _require(not selected.intersection(members), "gate double counts a source observation")
                selected.update(members)
                _require(gate["level"] != "link" or (len(members) == 1 and next(iter(members.values())) == 1), "link gate must retain individual observations")
                cell = by_cell[gate["cell"]]
                _require(all(by_spec[k]["jurisdiction"] == cell["jurisdiction"]
                             and cell["archetype"] in by_spec[k]["archetypes"] for k in members), "gate borrows another stratum")
                bases = [by_spec[k]["basis"] for k in members]
                _require(all(b == bases[0] for b in bases), "aggregation mixes comparison bases")
                _require(_text(group["quantity"]) and _text(group["weight_basis"]), "aggregation quantity or weight basis missing")
                if gate["metric"] == "share_within_tolerance":
                    _require(_number(group["tolerance_percent"]) and group["tolerance_percent"] >= 0, "link tolerance missing")
        # No observation can disappear from its cell's link-level accounting.
        for cell in cells:
            expected = {s["id"] for s in specs if s["jurisdiction"] == cell["jurisdiction"] and cell["archetype"] in s["archetypes"]}
            selected = {k for g in gates if g["cell"] == cell["id"] and g["level"] == "link" and g["metric"] in {"max_raw_ape", "raw_percent_rmse", "share_within_tolerance"} for group in g["groups"] for k in group["members"]}
            _require(not selected or expected <= selected, "link gate drops registered observations")
        return protocol
    except (KeyError, TypeError, AttributeError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise AcceptanceRefused("malformed acceptance protocol") from exc


def _join(outcomes: Sequence[str]) -> str:
    # Preserve a measured local failure even when another cell lacks evidence.
    if "fail" in outcomes:
        return "fail"
    if not outcomes or "inconclusive" in outcomes:
        return "inconclusive"
    return "pass"


def _residual(observed: float, modeled: float, lower: float, upper: float) -> dict[str, float | None]:
    signed = modeled - observed
    excess = max(lower - modeled, modeled - upper, 0)
    return {
        "observed": observed, "modeled": modeled, "lower": lower, "upper": upper,
        "raw_signed_residual": signed, "interval_width": upper - lower,
        "raw_ape": abs(signed) / observed * 100 if observed > 0 else None,
        "excess_error": excess,
        "excess_ape": excess / observed * 100 if observed > 0 else None,
    }


def _metric(name: str, rows: list[dict[str, Any]], groups: list[dict[str, Any]]) -> float | None:
    if any(r["raw_ape"] is None for r in rows):
        return None
    if name == "max_raw_ape":
        return max(r["raw_ape"] for r in rows)
    if name == "max_excess_ape":
        return max(r["excess_ape"] for r in rows)
    if name in {"raw_percent_rmse", "excess_percent_rmse"}:
        field = "raw_signed_residual" if name == "raw_percent_rmse" else "excess_error"
        # Population RMSE (N), normalized by the mean observed quantity.
        return math.hypot(*(r[field] for r in rows)) / math.sqrt(len(rows)) / statistics.mean(r["observed"] for r in rows) * 100
    if name == "share_within_tolerance":
        return 100 * sum(r["raw_ape"] <= g["tolerance_percent"] for r, g in zip(rows, groups)) / len(rows)
    observed, modeled = [r["observed"] for r in rows], [r["modeled"] for r in rows]
    if len(rows) < 2 or len(set(observed)) < 2 or len(set(modeled)) < 2:
        return None
    return statistics.correlation(observed, modeled)


def evaluate_acceptance(
    preregistration: bytes,
    frozen_record: FrozenRecord,
    preopening_custody: Mapping[str, Mapping[str, Any]],
    observations: Sequence[Mapping[str, Any]],
    model_outputs: Mapping[str, Mapping[str, Any]],
) -> dict[str, Any]:
    """Evaluate frozen gates on supplied data; never authorize a holdout opening.

    Missing observations, values, intervals or methods remain inconclusive.
    Protocol/custody contradictions refuse the entire call before arithmetic.
    Aggregate intervals are weighted envelopes, not independent-error CIs.
    """
    protocol = _protocol(preregistration, frozen_record)
    for block in protocol["blocks"]:
        if block["partition"] == "acceptance":
            custody = preopening_custody.get(block["id"], {})
            _require(custody.get("status") == "sealed" and custody.get("consumed") is False
                     and custody.get("exposed") is False, "holdout is consumed, exposed, or not proven sealed")
            _require(custody.get("study_id") == frozen_record.study_id
                     and custody.get("preregistration_sha256") == frozen_record.sha256,
                     "holdout custody belongs to another frozen study")
    specs = {s["id"]: s for s in protocol["observations"]}
    rows: dict[str, Mapping[str, Any]] = {}
    for row in observations:
        _require(row.get("id") in specs and row["id"] not in rows, "unexpected or duplicate observation")
        rows[row["id"]] = row
    _require(set(model_outputs) <= set(METHODS), "unknown or averaged method")
    results: dict[str, Any] = {}
    for method in METHODS:
        output = model_outputs.get(method)
        if output is not None:
            _require(output.get("method") == method, "method identity differs")
            _require(output.get("shared_context") == protocol["shared_context"], "method inputs differ from shared boundary")
            _require(output.get("method_context") == protocol["method_context"][method], "method code/settings differ from freeze")
            _require(isinstance(output.get("values"), Mapping) and set(output["values"]) <= set(specs), "unexpected model observation")
        values = output["values"] if output else {}
        evaluated = []
        for gate in protocol["gates"]:
            reasons: list[str] = []
            residuals = []
            clusters: set[str] = set()
            for group in gate["groups"]:
                components = []
                for identifier, weight in group["members"].items():
                    spec, row = specs[identifier], rows.get(identifier)
                    if row is None:
                        reasons.append(f"{identifier}: missing observation")
                        continue
                    modeled = values.get(identifier)
                    if not _number(modeled) or modeled < 0:
                        reasons.append(f"{identifier}: missing or invalid {method} output")
                        continue
                    observed, lower, upper = row.get("observed"), row.get("lower"), row.get("upper")
                    if not all(_number(v) for v in (observed, lower, upper)) or not 0 <= lower <= observed <= upper:
                        reasons.append(f"{identifier}: source-supported interval unavailable or invalid")
                        continue
                    if row.get("source_sha256") != spec["source_sha256"] or not _hash(row.get("interval_evidence_sha256")) or row.get("interval_method") != protocol["shared_context"]["interval_method"]:
                        reasons.append(f"{identifier}: observation or interval provenance unproved")
                        continue
                    if row.get("grade") not in {"A", "B"} or row.get("qa_passed") is not True or row.get("match_status") != "matched":
                        reasons.append(f"{identifier}: nondecisive observation or unresolved match")
                        continue
                    if row.get("basis") != spec["basis"] or output.get("basis", {}).get(identifier) != spec["basis"]:
                        reasons.append(f"{identifier}: comparison basis differs")
                        continue
                    components.append((weight * observed, weight * modeled, weight * lower, weight * upper))
                    clusters.add(spec["cluster"])
                if len(components) == len(group["members"]):
                    try:
                        totals = [math.fsum(part[i] for part in components) for i in range(4)]
                    except OverflowError:
                        totals = [math.inf] * 4
                    if not all(math.isfinite(v) for v in totals):
                        reasons.append(f"{group['id']}: nonfinite aggregate")
                        continue
                    residuals.append({"id": group["id"], "quantity": group["quantity"], **_residual(*totals)})
            if len(clusters) < gate["minimum_independent_clusters"]:
                reasons.append("insufficient independent geographic/source clusters")
            metric = None
            if not reasons:
                try:
                    metric = _metric(gate["metric"], residuals, gate["groups"])
                except (OverflowError, statistics.StatisticsError):
                    metric = None
                if metric is None or not math.isfinite(metric):
                    reasons.append("metric undefined: zero denominator, degenerate series, or numeric overflow")
                    metric = None
            outcome = "inconclusive"
            if not reasons:
                passes = metric < gate["threshold"] if gate["operator"] == "lt" else metric <= gate["threshold"] if gate["operator"] == "le" else metric >= gate["threshold"]
                outcome = "pass" if passes else "fail"
                reasons.append(f"{gate['metric']} {metric:g} {'meets' if passes else 'breaches'} {gate['operator']} {gate['threshold']:g}")
            evaluated.append({"id": gate["id"], "cell": gate["cell"], "level": gate["level"], "metric": gate["metric"],
                              "value": metric, "outcome": outcome, "reasons": reasons, "residuals": residuals,
                              "independent_clusters": len(clusters), "expected_observations": sum(len(g["members"]) for g in gate["groups"])})
        cells = []
        for cell in protocol["cells"]:
            gates = [g for g in evaluated if g["cell"] == cell["id"]]
            missing = [level for level in LEVELS if not any(g["level"] == level for g in gates)]
            # Uncertainty-only gates cannot convert broad intervals into validity.
            raw_missing = [level for level in LEVELS if not any(g["level"] == level and g["metric"] in {"max_raw_ape", "raw_percent_rmse", "share_within_tolerance"} for g in gates)]
            reasons = [f"missing {level} gate" for level in missing] + [f"missing {level} raw-error gate" for level in raw_missing]
            outcome = _join([g["outcome"] for g in gates] + (["inconclusive"] if reasons else []))
            cells.append({**cell, "outcome": outcome, "reasons": reasons or [f"{g['id']}: {g['outcome']}" for g in gates]})
        uses = {use: _join([c["outcome"] for c in cells if c["use"] == use]) for use in protocol["uses"]}
        results[method] = {"gates": evaluated, "cells": cells, "uses": uses, "outcome": _join(list(uses.values()))}
    return {"schema": "openplan.acceptance-assessment.v1", "study_id": frozen_record.study_id,
            "preregistration_sha256": frozen_record.sha256, "methods": results,
            "outcome": _join([results[m]["outcome"] for m in METHODS]),
            "claim_scope": protocol["cells"], "interval_aggregation": "weighted_envelope",
            "claim_limit": "Supplied-input gate results only; no access authorization, default change, or production claim promotion."}
