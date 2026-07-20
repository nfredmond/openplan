#!/usr/bin/env python3
"""Screening-grade validation of assigned link volumes against observed counts.

Ports the county lane's observed-count validation
(`scripts/modeling/validate_screening_observed_counts.py` +
`screening_metrics.py`) so the AequilibraE worker can report "how wrong is this"
numbers — median/mean absolute percent error, %RMSE, GEH, Spearman rank
correlation — against real published traffic counts, plus a screening gate.

This is a DIAGNOSTIC sanity check, NOT a calibration or a validated forecast: a
"bounded screening-ready" gate means the model reproduces a handful of observed
counts within loose screening tolerances, nothing more. GEH here is on an
average-hourly (daily/24) basis, not peak-hour. Stdlib-only so it is
unit-testable without the geo/modeling stack. Keep in step with the county lane.
"""
from __future__ import annotations

import math
from typing import Any, Iterable, Sequence

from time_of_day import DEFAULT_PEAK_HOUR_FACTOR, PEAK_HOUR_FACTOR_NOTE, peak_hour_volume

# Screening gate thresholds (mirror the county lane defaults).
DEFAULT_READY_MEDIAN_APE = 30.0
DEFAULT_READY_CRITICAL_APE = 50.0
DEFAULT_REQUIRED_MATCHES = 3

GEH_BASIS_NOTE = (
    "GEH computed on average-hourly equivalents (daily volume / 24); peak-hour "
    "GEH, the customary basis for the <5 acceptance rule, will differ."
)


# ── stdlib parsing helpers (ported verbatim) ───────────────────────────────
def parse_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def normalize_text(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().replace("_", " ").split())


def parse_pipe_list(value: Any) -> list[str]:
    text = str(value or "").strip()
    return [piece.strip() for piece in text.split("|") if piece.strip()] if text else []


def bbox_contains(station: dict[str, Any], lon: float | None, lat: float | None) -> bool:
    if lon is None or lat is None:
        return False
    mn_lon = parse_float(station.get("bbox_min_lon"))
    mn_lat = parse_float(station.get("bbox_min_lat"))
    mx_lon = parse_float(station.get("bbox_max_lon"))
    mx_lat = parse_float(station.get("bbox_max_lat"))
    if None in {mn_lon, mn_lat, mx_lon, mx_lat}:
        return True
    return mn_lon <= lon <= mx_lon and mn_lat <= lat <= mx_lat


# ── metrics (parity with screening_metrics.py) ─────────────────────────────
def percent_rmse(observed: Sequence[float], modeled: Sequence[float]) -> float | None:
    pairs = [(float(o), float(m)) for o, m in zip(observed, modeled)]
    if not pairs:
        return None
    mean_observed = sum(o for o, _ in pairs) / len(pairs)
    if mean_observed <= 0:
        return None
    rmse = math.sqrt(sum((m - o) ** 2 for o, m in pairs) / len(pairs))
    return 100.0 * rmse / mean_observed


def geh_statistic(observed_hourly: float, modeled_hourly: float) -> float | None:
    total = observed_hourly + modeled_hourly
    if total <= 0:
        return None
    return math.sqrt(2.0 * (modeled_hourly - observed_hourly) ** 2 / total)


def geh_summary(observed_daily: Sequence[float], modeled_daily: Sequence[float], hourly_divisor: float = 24.0) -> dict[str, Any]:
    values = []
    for obs, mod in zip(observed_daily, modeled_daily):
        geh = geh_statistic(float(obs) / hourly_divisor, float(mod) / hourly_divisor)
        if geh is not None:
            values.append(geh)
    if not values:
        return {"mean": None, "max": None, "stations": 0, "basis": GEH_BASIS_NOTE}
    return {"mean": sum(values) / len(values), "max": max(values), "stations": len(values), "basis": GEH_BASIS_NOTE}


def peak_hour_geh_summary(
    observed_daily: Sequence[float],
    modeled_daily: Sequence[float],
    peak_hour_factor: float = DEFAULT_PEAK_HOUR_FACTOR,
) -> dict[str, Any]:
    """GEH on PEAK-HOUR equivalents (daily x K-factor) — the customary basis for
    the GEH < 5 acceptance rule, so the screening figure is comparable to the
    convention. Still screening-grade (generic K, not calibrated)."""
    values = []
    for obs, mod in zip(observed_daily, modeled_daily):
        geh = geh_statistic(peak_hour_volume(float(obs), peak_hour_factor), peak_hour_volume(float(mod), peak_hour_factor))
        if geh is not None:
            values.append(geh)
    if not values:
        return {"mean": None, "max": None, "stations": 0, "factor": peak_hour_factor, "basis": PEAK_HOUR_FACTOR_NOTE}
    return {
        "mean": sum(values) / len(values),
        "max": max(values),
        "stations": len(values),
        "factor": peak_hour_factor,
        "basis": PEAK_HOUR_FACTOR_NOTE,
    }


def compute_spearman_rho(observed: Sequence[float], modeled: Sequence[float]) -> float | None:
    n = len(observed)
    if n <= 1:
        return None
    obs_rank = {idx: r + 1 for r, idx in enumerate(sorted(range(n), key=lambda i: observed[i], reverse=True))}
    mod_rank = {idx: r + 1 for r, idx in enumerate(sorted(range(n), key=lambda i: modeled[i], reverse=True))}
    d_sq = sum((obs_rank[i] - mod_rank[i]) ** 2 for i in range(n))
    return 1.0 - (6.0 * d_sq) / (n * (n * n - 1))


# ── station → modeled-link matching ────────────────────────────────────────
def match_station(station: dict[str, Any], modeled_links: Iterable[dict[str, Any]]) -> dict[str, Any] | None:
    """Best modeled link for a count station: exact name (3) > facility substring
    (2) > allowed-link-type-only (1); ties broken by higher modeled volume. Links
    must fall inside the station bbox and an allowed link type."""
    candidate_names_norm = {normalize_text(n) for n in parse_pipe_list(station.get("candidate_model_names"))}
    excluded_norm = {normalize_text(n) for n in parse_pipe_list(station.get("exclude_model_names"))}
    allowed_types_norm = {normalize_text(t) for t in parse_pipe_list(station.get("candidate_link_types"))}
    facility_norm = normalize_text(station.get("facility_name"))

    best: dict[str, Any] | None = None
    for link in modeled_links:
        lon, lat = link.get("lon"), link.get("lat")
        if not bbox_contains(station, lon, lat):
            continue
        name_norm = normalize_text(link.get("name"))
        type_norm = normalize_text(link.get("link_type"))
        if excluded_norm and name_norm in excluded_norm:
            continue
        if allowed_types_norm and type_norm not in allowed_types_norm:
            continue
        exact = bool(candidate_names_norm and name_norm in candidate_names_norm)
        facility = bool(facility_norm and facility_norm in name_norm)
        type_only = bool(allowed_types_norm)
        if not (exact or facility or type_only):
            continue
        score = 3 if exact else 2 if facility else 1
        volume = float(link.get("volume") or 0.0)
        key = (score, volume)
        if best is None or key > (best["match_score"], best["modeled_daily_pce"]):
            best = {
                "link_id": int(link["link_id"]),
                "matched_name": link.get("name", ""),
                "matched_link_type": link.get("link_type", ""),
                "match_score": score,
                "modeled_daily_pce": round(volume, 1),
            }
    return best


def classify_gate(
    matched_count: int,
    median_ape: float | None,
    max_ape: float | None,
    required_matches: int = DEFAULT_REQUIRED_MATCHES,
    ready_median_ape: float = DEFAULT_READY_MEDIAN_APE,
    ready_critical_ape: float = DEFAULT_READY_CRITICAL_APE,
) -> tuple[str, list[str]]:
    reasons: list[str] = []
    if matched_count < required_matches:
        reasons.append(f"Only {matched_count} matched stations; >= {required_matches} required.")
    if median_ape is None:
        reasons.append("No usable matched stations produced percent-error metrics.")
    elif median_ape > ready_median_ape:
        reasons.append(f"Median APE {median_ape:.2f}% > {ready_median_ape:.2f}% screening threshold.")
    if max_ape is not None and max_ape > ready_critical_ape:
        reasons.append(f"A core facility has {max_ape:.2f}% APE > {ready_critical_ape:.2f}% critical threshold.")
    if reasons:
        return "internal prototype only", reasons
    return "bounded screening-ready", [
        f"Matched >= {required_matches}, median APE <= {ready_median_ape:.2f}%, no facility > {ready_critical_ape:.2f}% APE."
    ]


def metric_status_for_gate(
    median_ape: float | None,
    max_ape: float | None,
    matched_count: int,
    ready_median_ape: float = DEFAULT_READY_MEDIAN_APE,
    ready_critical_ape: float = DEFAULT_READY_CRITICAL_APE,
    required_matches: int = DEFAULT_REQUIRED_MATCHES,
) -> tuple[str, str]:
    """Map the observed-count gate to a per-metric ('pass'|'warn'|'fail', detail)
    for the modeling claim spine — same thresholds as classify_gate."""
    if matched_count < required_matches:
        return "fail", f"Only {matched_count} matched station(s); >= {required_matches} required for a screening claim."
    if median_ape is None:
        return "fail", "No usable percent-error metric."
    if median_ape > ready_critical_ape or (max_ape is not None and max_ape > ready_critical_ape):
        return "fail", f"Median APE {median_ape}% (or a facility) exceeds the {ready_critical_ape:.0f}% critical threshold."
    if median_ape > ready_median_ape:
        return "warn", f"Median APE {median_ape}% exceeds the {ready_median_ape:.0f}% screening threshold."
    return "pass", f"Median APE {median_ape}% within the {ready_median_ape:.0f}% screening threshold across {matched_count} stations."


def validate_against_counts(
    stations: Sequence[dict[str, Any]],
    modeled_links: Sequence[dict[str, Any]],
    required_matches: int = DEFAULT_REQUIRED_MATCHES,
    ready_median_ape: float = DEFAULT_READY_MEDIAN_APE,
    ready_critical_ape: float = DEFAULT_READY_CRITICAL_APE,
) -> dict[str, Any]:
    """Match each observed-count station to a modeled link and summarize fit.

    `modeled_links`: dicts with link_id, name, link_type, lon, lat, volume (daily
    PCE). Returns a screening-grade validation summary — NOT a calibration.
    """
    results = []
    for station in stations:
        observed = parse_float(station.get("observed_volume")) or 0.0
        best = match_station(station, modeled_links)
        if best is None or observed <= 0:
            results.append({
                "station_id": station.get("station_id", ""),
                "label": station.get("label", ""),
                "observed_volume": round(observed),
                "match_status": "unmatched",
            })
            continue
        modeled = best["modeled_daily_pce"]
        ape = 100.0 * abs(modeled - observed) / observed
        results.append({
            "station_id": station.get("station_id", ""),
            "label": station.get("label", ""),
            "observed_volume": round(observed),
            "match_status": "matched",
            "absolute_percent_error": round(ape, 2),
            **best,
        })

    matched = [r for r in results if r["match_status"] == "matched"]
    apes = sorted(float(r["absolute_percent_error"]) for r in matched)
    observed_v = [float(r["observed_volume"]) for r in matched]
    modeled_v = [float(r["modeled_daily_pce"]) for r in matched]

    def _median(xs: list[float]) -> float | None:
        if not xs:
            return None
        mid = len(xs) // 2
        return xs[mid] if len(xs) % 2 else (xs[mid - 1] + xs[mid]) / 2.0

    median_ape = _median(apes)
    max_ape = max(apes) if apes else None
    status_label, gate_reasons = classify_gate(len(matched), median_ape, max_ape, required_matches, ready_median_ape, ready_critical_ape)

    return {
        "stations_total": len(stations),
        "stations_matched": len(matched),
        "median_ape": round(median_ape, 2) if median_ape is not None else None,
        "mean_ape": round(sum(apes) / len(apes), 2) if apes else None,
        "max_ape": round(max_ape, 2) if max_ape is not None else None,
        "percent_rmse": round(percent_rmse(observed_v, modeled_v), 2) if percent_rmse(observed_v, modeled_v) is not None else None,
        "geh": geh_summary(observed_v, modeled_v),
        "peak_hour_geh": peak_hour_geh_summary(observed_v, modeled_v),
        "spearman_rho": round(compute_spearman_rho(observed_v, modeled_v), 3) if compute_spearman_rho(observed_v, modeled_v) is not None else None,
        "screening_gate": status_label,
        "gate_reasons": gate_reasons,
        "results": results,
        "method": (
            "Observed traffic counts matched to assigned links by name/link-type/bbox; "
            "modeled daily PCE volume vs observed AADT. Median/mean/max APE, %RMSE, "
            "GEH on both an average-hourly (daily/24) AND a peak-hour (daily x K-factor) "
            "basis, Spearman rank correlation. Screening-grade DIAGNOSTIC (a sanity check "
            "against a few counts) — NOT a calibration or a validated/calibrated forecast."
        ),
    }
