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

# ---------------------------------------------------------------------------
# Count-source COVERAGE
#
# A study area either has published counts to validate against or it does not,
# and those are different findings from "the model disagreed with the counts".
#
# What went wrong before: when no count source is registered for a study area's
# state, the worker fell back to the BUNDLED pilot count file — stations in
# Grass Valley, California. An Ohio run then matched that California file
# against its own network, matched nothing, and reported "Only 0 matched
# station(s); >= 3 required for a screening claim." A planner reads that as
# "my model failed validation". The truth was that no count source covers their
# state, which is knowable, actionable, and was never said.
#
# Coverage is derived from the count set's OWN station bboxes, not from a place
# literal, so it holds for the bundled pilot file, an auto-ingested state DOT
# set, or an operator's own CSV, without any of them being named here.
# ---------------------------------------------------------------------------

# Registered observed-count regions -> rough bounds (min_lon, min_lat, max_lon,
# max_lat). Each key MUST exist in scripts/modeling/count_sources.py::
# COUNT_SOURCES; `test_count_coverage.py` fails if the two drift apart. Adding a
# state is a registry entry in both places, never a change to a call site.
#
# Bbox detection is coarse: a study bbox straddling a state line resolves to the
# first registered region it intersects. Where the fetched counts do not match
# the network, calibration finds nothing and the run stays screening-grade.
COUNT_REGION_BOUNDS: dict[str, tuple[float, float, float, float]] = {
    "CA": (-124.6, 32.4, -114.0, 42.1),
    "OR": (-124.57, 41.99, -116.46, 46.29),
    "WA": (-124.85, 45.54, -116.92, 49.0),
    "CO": (-109.06, 36.99, -102.04, 41.0),
}


def bboxes_intersect(a: Sequence[float], b: Sequence[float]) -> bool:
    """True when two (min_lon, min_lat, max_lon, max_lat) boxes overlap."""
    if not a or not b or len(a) != 4 or len(b) != 4:
        return False
    return not (a[0] > b[2] or a[2] < b[0] or a[1] > b[3] or a[3] < b[1])


def region_for_bbox(bbox: Sequence[float] | None) -> str | None:
    """Registered count-source region whose bounds intersect the study bbox."""
    if not bbox or len(bbox) != 4:
        return None
    for region, bounds in COUNT_REGION_BOUNDS.items():
        if bboxes_intersect(bounds, bbox):
            return region
    return None


def station_set_extent(stations: Iterable[dict[str, Any]]) -> tuple[float, float, float, float] | None:
    """Union of every station's declared bbox — where this count set applies.

    Returns None when no station declares a usable bbox, in which case the
    caller cannot conclude anything about coverage and must not pretend to.
    """
    min_lon = min_lat = max_lon = max_lat = None
    for station in stations:
        vals = [
            parse_float(station.get("bbox_min_lon")),
            parse_float(station.get("bbox_min_lat")),
            parse_float(station.get("bbox_max_lon")),
            parse_float(station.get("bbox_max_lat")),
        ]
        if any(v is None for v in vals):
            continue
        s_min_lon, s_min_lat, s_max_lon, s_max_lat = vals  # type: ignore[misc]
        min_lon = s_min_lon if min_lon is None else min(min_lon, s_min_lon)
        min_lat = s_min_lat if min_lat is None else min(min_lat, s_min_lat)
        max_lon = s_max_lon if max_lon is None else max(max_lon, s_max_lon)
        max_lat = s_max_lat if max_lat is None else max(max_lat, s_max_lat)

    if min_lon is None or min_lat is None or max_lon is None or max_lat is None:
        return None
    return (min_lon, min_lat, max_lon, max_lat)


def describe_count_coverage(
    stations: Sequence[dict[str, Any]],
    study_bbox: Sequence[float] | None,
) -> dict[str, Any]:
    """Whether this count set can say anything about this study area.

    `covered` False means the run must NOT be reported as a failed validation:
    nothing relevant was ever compared. `reason` names the specific gap, and
    `registered_regions` tells the operator which states can auto-ingest counts
    today, so "not covered" is actionable rather than a dead end.
    """
    registered = sorted(COUNT_REGION_BOUNDS)
    region = region_for_bbox(study_bbox)
    extent = station_set_extent(stations)

    if not stations:
        return {
            "covered": False,
            "status": "no_count_set",
            "region": region,
            "registered_regions": registered,
            "reason": (
                "No observed-count set was available for this run, so link volumes were not "
                "compared against published counts. This is not a validation failure."
            ),
        }

    if study_bbox is None or len(study_bbox) != 4:
        # No study geometry to test against: proceed and let matching speak.
        return {
            "covered": True,
            "status": "unknown_study_area",
            "region": region,
            "registered_regions": registered,
            "reason": None,
        }

    if extent is None:
        # The count set declares no geography; matching is the only test left.
        return {
            "covered": True,
            "status": "count_set_without_geography",
            "region": region,
            "registered_regions": registered,
            "reason": None,
        }

    if bboxes_intersect(extent, study_bbox):
        return {
            "covered": True,
            "status": "covered",
            "region": region,
            "registered_regions": registered,
            "reason": None,
        }

    detail = (
        f"No observed-count source is registered for this study area. Counts can be "
        f"auto-ingested today for: {', '.join(registered)}. The available count set covers a "
        f"different area entirely, so it was NOT used — validating against another "
        f"jurisdiction's stations would produce a meaningless fit."
    )
    if region:
        detail = (
            f"The available count set does not cover this study area, so it was NOT used — "
            f"validating against another area's stations would produce a meaningless fit. "
            f"{region} is a registered count-source region; enable count auto-ingest to fetch "
            f"local counts for this run."
        )

    return {
        "covered": False,
        "status": "out_of_area",
        "region": region,
        "registered_regions": registered,
        "reason": detail,
    }


def uncovered_validation_summary(coverage: dict[str, Any]) -> dict[str, Any]:
    """A validation summary for a run that had nothing to validate against.

    Deliberately carries `stations_matched: 0` with NO gate and NO error metrics:
    a gate implies a comparison happened, and a median APE of None next to a
    failed gate is exactly what read as "your model failed".
    """
    return {
        "stations_total": 0,
        "stations_matched": 0,
        "median_ape": None,
        "mean_ape": None,
        "max_ape": None,
        "percent_rmse": None,
        "geh": None,
        "peak_hour_geh": None,
        "spearman_rho": None,
        "screening_gate": None,
        "gate_reasons": [],
        "results": [],
        "coverage": coverage,
        "method": (
            "Observed-count validation was not run: no count set covers this study area. "
            "This is a coverage gap, not a validation result."
        ),
    }
DEFAULT_REQUIRED_MATCHES = 3

GEH_BASIS_NOTE = (
    "GEH computed on average-hourly equivalents (daily volume / 24); peak-hour "
    "GEH, the customary basis for the <5 acceptance rule, will differ."
)


# ---------------------------------------------------------------------------
# ZONE-RESOLUTION QUALIFICATION of the gate
#
# A trip that begins and ends in the SAME zone carries VMT and no link volume.
# At a coarse zone system a large share of all travel is invisible to every
# link BY CONSTRUCTION, so comparing modelled link volumes to observed counts
# cannot establish whether the model is right — in either direction.
#
# WHAT WENT WRONG WITHOUT THIS. `classify_gate` never saw the zone system, so
# the same run could carry two contradictory statements: the zone panel saying
# "link comparison cannot settle this", and a gate of "bounded screening-ready"
# — which `write_model_run_modeling_evidence` turns into the `screening_grade`
# CLAIM TIER — awarded on the strength of that very comparison. A claim tier
# handed out by a test that could not test is the honesty firewall failing from
# the inside, without an agent anywhere near it.
#
# THE RULE IS SYMMETRIC, and the withholding half is what makes the explaining
# half safe. A change that only ever explained failures would only ever make
# runs look better, which is the shape this repository is most wary of:
#
#   * gate would PASS + zones cannot support the comparison -> the gate is
#     WITHHELD. Not demoted to a failure (nothing failed), not awarded
#     (nothing was established). `screening_gate` becomes None, exactly as the
#     coverage gap above does, so every consumer that keys on the
#     "bounded screening-ready" string fails CLOSED.
#   * gate FAILS + zones cannot support the comparison -> the gate is
#     UNCHANGED, with the zone system named first among the reasons. A failure
#     is never promoted by this code; it is only explained.
#
# THE THRESHOLD LIVES IN TWO LANGUAGES AND MUST NOT DRIFT. The app owns the
# bands and every planner-facing sentence
# (`openplan/src/lib/models/zone-resolution.ts`); Python needs exactly ONE
# number — the share above which link-level validation establishes nothing.
# `src/test/one-link-validation-threshold.test.ts` reads this constant out of
# this file and fails if it disagrees with the app's band table. One number,
# one seam, one guard — rather than four bands of prose duplicated here.
# ---------------------------------------------------------------------------

# Intrazonal share (PERCENT, 0-100) at or below which a link-level count
# comparison can establish something. Mirrors the top of the app's
# `supportsLinkLevelValidation: true` bands.
LINK_VALIDATION_MAX_INTRAZONAL_SHARE_PCT = 20.0

# The status recorded on `zone_resolution` when the gate is withheld. Distinct
# from a coverage gap ("nothing was compared") and from a failure ("compared,
# and it disagreed"): here a real comparison ran and cannot settle the question.
ZONE_RESOLUTION_GATE_WITHHELD_STATUS = "not_established_at_this_zone_resolution"


def link_validation_is_supported(intrazonal_share_pct: float | None) -> bool | None:
    """Whether link-level count comparison can establish anything at this share.

    None in, None out: an UNMEASURED share is not a fine-grained zone system,
    and must never be read as one.
    """
    if intrazonal_share_pct is None:
        return None
    return float(intrazonal_share_pct) <= LINK_VALIDATION_MAX_INTRAZONAL_SHARE_PCT


def qualify_gate_for_zone_resolution(
    summary: dict[str, Any],
    intrazonal_share_pct: float | None,
    zone_count: int | None = None,
) -> dict[str, Any]:
    """Apply the zone system's verdict to a completed count-validation summary.

    Mutates and returns `summary`. Always attaches a `zone_resolution` block so
    the qualification is auditable even when it changed nothing — a silent
    no-op and a considered pass must be distinguishable after the fact.

    WHEN THE SHARE IS UNMEASURED the gate is left ALONE, deliberately. The share
    is measured on the same matrix as the headline resident VMT, so a run
    missing it is a run whose demand read failed — a plumbing fault, not a
    coarse zone system. Withholding a gate for it would hand a planner a reason
    they cannot act on, and this diagnostic's whole posture is that advice which
    cannot be taken teaches planners to stop reading it. The block still records
    `measured: False`, so the gap is visible rather than absent.
    """
    supported = link_validation_is_supported(intrazonal_share_pct)
    share = None if intrazonal_share_pct is None else round(float(intrazonal_share_pct), 1)
    block: dict[str, Any] = {
        "measured": supported is not None,
        "intrazonal_share_pct": share,
        "zone_count": int(zone_count) if zone_count is not None else None,
        "supports_link_level_validation": supported,
        "max_supported_intrazonal_share_pct": LINK_VALIDATION_MAX_INTRAZONAL_SHARE_PCT,
        "gate_withheld": False,
        "status": None,
        # Named as OpenPlan's own judgement wherever it appears, the same
        # posture the Title VI proxy thresholds take: a number OpenPlan chose is
        # indistinguishable, on a page shown to a board, from one a standards
        # body published.
        "heuristic_note": (
            "The share above which OpenPlan treats link-level count comparison as unable to "
            "settle the question is OpenPlan's own screening heuristic, not an adopted standard."
        ),
    }
    # Attached ONCE, here, before any branch runs. Every branch below only
    # mutates `block`. Assigning it per-branch instead is how the first version
    # of this function shipped the block on two paths and dropped it on the two
    # that mattered — the withheld gate and the explained failure.
    summary["zone_resolution"] = block

    if supported is None:
        block["note"] = (
            "How much of this run's travel reaches the network was not measured, so the count "
            "comparison below could not be qualified either way. This is a missing measurement, "
            "not a finding about the zone system."
        )
        return summary

    if supported:
        block["note"] = (
            f"{share}% of this run's trips begin and end in the same zone, so nearly all travel "
            "reaches the network and the count comparison below is a meaningful test of it."
        )
        return summary

    # Beyond the threshold: the comparison ran, and cannot settle the question.
    zones_clause = f" across {int(zone_count)} zones" if zone_count else ""
    explanation = (
        f"{share}% of this run's trips begin and end in the same zone{zones_clause} and never "
        "reach any link, so a gap between modelled volumes and observed counts is expected from "
        "the zone system alone and is not evidence about this model's demand."
    )

    if summary.get("screening_gate") == "bounded screening-ready":
        block["gate_withheld"] = True
        block["status"] = ZONE_RESOLUTION_GATE_WITHHELD_STATUS
        block["withheld_gate"] = "bounded screening-ready"
        block["note"] = explanation
        # Withheld, NOT failed. The metrics below are real measurements and stay
        # exactly as computed; what is removed is the CLAIM built on top of them.
        summary["screening_gate"] = None
        summary["gate_reasons"] = [
            "Screening gate not awarded: the zone system cannot support a link-level count "
            "comparison, so matching the counts here does not establish screening grade.",
            explanation,
            "Trip totals, mode share and VMT do count intrazonal travel and remain usable. A "
            "finer zone system is what would let link comparison support a screening claim.",
        ]
        return summary

    # The gate already failed. Explain it; never promote it.
    block["status"] = "explains_gate_failure"
    block["note"] = explanation
    summary["gate_reasons"] = [
        explanation,
        "The gate below is reported as computed. At this zone resolution it should not be read "
        "as a finding that the model's demand is wrong.",
        *(summary.get("gate_reasons") or []),
    ]
    return summary


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
    intrazonal_share_pct: float | None = None,
) -> tuple[str, str]:
    """Map the observed-count gate to a per-metric ('pass'|'warn'|'fail', detail)
    for the modeling claim spine — same thresholds as classify_gate.

    A metric row is what a planner reads in the evidence panel, so it has to
    agree with the claim decision beside it. Where the zone system cannot
    support a link-level comparison, a median APE inside the threshold is a real
    number whose MEANING is not established — 'warn', never 'pass'. It is not
    'fail' either: nothing failed, and calling it a failure would restate the
    exact misreading this qualification exists to prevent.
    """
    if link_validation_is_supported(intrazonal_share_pct) is False:
        share = round(float(intrazonal_share_pct), 1)  # type: ignore[arg-type]
        return "warn", (
            f"Median APE {median_ape}% across {matched_count} station(s), but {share}% of trips "
            "never reach a link at this zone resolution, so this comparison does not establish "
            "screening grade in either direction."
        )
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
    intrazonal_share_pct: float | None = None,
    zone_count: int | None = None,
) -> dict[str, Any]:
    """Match each observed-count station to a modeled link and summarize fit.

    `modeled_links`: dicts with link_id, name, link_type, lon, lat, volume (daily
    PCE). Returns a screening-grade validation summary — NOT a calibration.

    `intrazonal_share_pct` (PERCENT, 0-100) qualifies the resulting gate through
    `qualify_gate_for_zone_resolution`. It is applied HERE, inside the only
    function that produces a gate, rather than left to each caller to remember:
    a qualification a caller can forget is a qualification that will be
    forgotten, and the failure mode is a screening claim nobody meant to award.
    Omitting it records `measured: False` rather than silently asserting the
    zone system is fine.
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

    summary = {
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
    return qualify_gate_for_zone_resolution(summary, intrazonal_share_pct, zone_count)
