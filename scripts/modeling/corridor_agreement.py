#!/usr/bin/env python3
"""Where two demand models agree about a corridor, and where they do not.

============================================================ WHAT THIS IS FOR

Two demand models — a trip-based gravity model and an activity-based
microsimulation — are assigned on the SAME network with the SAME assignment
settings. Holding those inputs constant isolates methodological sensitivity far
better than comparing unrelated runs. The recorded convergence limits still
decide whether that sensitivity can be attributed at corridor or link scale.

This file computes what that difference is, link by link and corridor by
corridor. The product is an **agreement map**: corridors where both methods land
in the same place are less sensitive to the demand-method choice; corridors
where they diverge are flagged and quantified. Agreement does not predict count
accuracy, confer confidence, or establish that either method is correct.

============================================================== NEVER AVERAGE

There is no blended number here and there must never be one. Averaging two
methods produces a figure with no defensible provenance and destroys the only
thing the exercise generates — the knowledge of WHERE the two methods agree. A
single number "for simplicity" is a regression, not a convenience.

================================================= WHY AGREEMENT ON AN EMPTY ROAD IS NOT EVIDENCE

Most links in any network carry almost nothing, and two models both saying
"almost nothing" agree perfectly. Counting those makes any pair of models look
like they agree about 90% of the network, which is true and worthless.

So agreement is reported three ways and the headline is the third: over all
links, over links carrying meaningful traffic, and weighted by volume. A reader
who sees only the first learns nothing about the corridors they care about.
"""
from __future__ import annotations

import hashlib
import json
import math
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Iterable, Mapping, Sequence

# GEH is the traffic-engineering standard for comparing two traffic volumes. It
# tolerates a larger absolute difference on a big flow than on a small one,
# which is why it is used instead of percent difference: 100 vehicles different
# on a 200-vehicle road and on a 50,000-vehicle road are not comparable errors.
#
#   GEH = sqrt( 2 * (a - b)^2 / (a + b) )
#
# THE THRESHOLDS BELOW ARE BORROWED, AND THAT MATTERS. GEH < 5 as "acceptable"
# comes from validating a model against OBSERVED COUNTS, where one side is
# ground truth. Here neither side is. The thresholds are still the most
# recognisable yardstick a reviewer will know, so they are used — and labelled
# as an adaptation everywhere they are reported, rather than presented as a
# validation standard being met.
GEH_CLOSE = 5.0
GEH_MARGINAL = 10.0

# Links below this carry too little traffic for a difference between them to
# mean anything, and including them inflates every agreement figure. Reported,
# never silently applied.
DEFAULT_MINIMUM_VOLUME = 100.0

# The loosest assignment convergence at which a per-corridor difference can be
# attributed to the demand model at all. NOT a preference — measured on
# 2026-08-16 by assigning one model's own demand twice over the same
# 28,670-link network, so the demand differed only by whole-trip rounding:
#
#   relative gap 0.0092  ->  13.0% of busy links diverged, median GEH 2.05
#   relative gap 0.00046 ->   0.0% of busy links diverged, median GEH 0.141
#
# At the loose gap the assignment is still choosing between near-equal-cost
# parallel routes, and it produces on its own exactly the kind of divergence the
# comparison exists to attribute to demand.
#
# BUT NOT AT EVERY UNIT, and the difference decides how this is used. Assigning
# IDENTICAL demand at both settings on one county:
#
#   named corridor totals moved ..............  0.5-1.4%
#   median individual link moved .............  2.7%
#   the worst tenth of links moved ...........  28.9%
#   busy links moving more than 10% ..........  21%
#
# A corridor total averages over dozens of links and survives; a single link is
# exactly where the unfinished route choice lands. So a loosely converged pair
# is restricted to corridor-level attribution rather than refused outright —
# which is what makes the tool usable at the settings a planner's run actually
# uses, instead of a check everyone learns to ignore.
COMPARISON_MAX_RELATIVE_GAP = 0.001

AGREEMENT_SCHEMA_VERSION = "openplan.corridor_agreement.v2"
ASSIGNMENT_PROFILE_SCHEMA_VERSION = "openplan.assignment-profile.v1"
NETWORK_SETTINGS_SCHEMA_VERSION = "openplan.network-calibration.v1"
NETWORK_STATE_SCHEMA_VERSION = "openplan.assignment-network-state.v1"
RETAINED_NETWORK_MANIFEST_SCHEMA_VERSION = "openplan.retained-network-manifest.v1"

_NETWORK_SETTINGS_APPLICATION = {
    "capacity": "baseline_capacity * factor",
    "travel_time": "baseline_travel_time / factor",
}
_NETWORK_SETTINGS_EXCLUDES = ["trip_based_od_adjustments"]
_NETWORK_STATE_FIELDS = frozenset(
    {
        "schema_version",
        "network_settings_digest",
        "assignment_centroid_count",
        "assignment_centroid_order_digest",
        "block_centroid_flows",
        "penalty_through_centroids",
        "cost_field",
        "capacity_field",
        "graph_row_count",
        "graph_rows_digest",
        "graph_float_dtype",
        "graph_cost_digest",
        "graph_cost_dtype",
        "compact_cost_digest",
        "compact_cost_dtype",
        "solver_free_flow_tt_digest",
        "solver_free_flow_tt_dtype",
        "solver_capacity_digest",
        "solver_capacity_dtype",
        "retained_network_digest",
        "retained_network_manifest",
    }
)
_RETAINED_NETWORK_MANIFEST_FIELDS = frozenset(
    {
        "schema_version",
        "all_link_count",
        "all_link_ids_digest",
        "roadway_link_count",
        "roadway_link_ids_digest",
        "modeling_connector_link_count",
        "modeling_connector_link_ids_digest",
        "excluded_roles",
        "role_definition",
    }
)


class CorridorAgreementError(ValueError):
    """The two runs cannot be compared, with the reason to show."""


_ASSIGNMENT_PROFILE_FIELDS = frozenset(
    {
        "schema_version",
        "profile_id",
        "engine",
        "engine_version",
        "algorithm",
        "vdf",
        "vdf_parameters",
        "capacity_field",
        "time_field",
        "class_pce",
        "cores",
        "target_gap",
        "max_iterations",
    }
)

_LOWERCASE_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_FIXED_ASSIGNMENT_PROFILE_VALUES = {
    "schema_version": "openplan.assignment-profile.v1",
    "profile_id": "aequilibrae-bfw-bpr-tight-v1",
    "engine": "aequilibrae",
    "algorithm": "bfw",
    "vdf": "BPR",
    "class_pce": 1,
}


def _sha256_text(payload: str) -> str:
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
        ensure_ascii=False,
    )


def _parse_exact_json_payload(payload: Any, context: str) -> tuple[dict[str, Any] | None, str | None]:
    """Parse the producer's exact compact/sorted JSON without re-hashing JS floats.

    The payload string is the cross-runtime contract. Consumers hash those exact
    UTF-8 bytes; they do not parse and serialize a float again in another
    language, where 0.00001 can become either ``1e-05`` or ``0.00001``.
    """
    if not isinstance(payload, str) or not payload:
        return None, f"{context} payload is missing"
    try:
        parsed = json.loads(
            payload,
            parse_constant=lambda token: (_ for _ in ()).throw(
                ValueError(f"non-finite JSON token {token}")
            ),
        )
    except (TypeError, ValueError, json.JSONDecodeError) as error:
        return None, f"{context} payload is not valid JSON ({error})"
    if not isinstance(parsed, dict):
        return None, f"{context} payload must be a JSON object"
    try:
        canonical = _canonical_json(parsed)
    except (TypeError, ValueError) as error:
        return None, f"{context} payload is not canonical JSON ({error})"
    if payload != canonical:
        return None, f"{context} payload is not exact compact sorted JSON"
    return parsed, None


def _invalid_evidence(reason: str) -> dict[str, Any]:
    return {
        "state": "invalid",
        "profile": None,
        "payload_json": None,
        "digest": None,
        "reason": reason,
    }


def _recorded_assignment_profile(
    record: Mapping[str, Any],
    *,
    expected_payload_json: str | None = None,
    expected_digest: str | None = None,
) -> dict[str, Any]:
    """Verify the complete method and its exact producer-owned hash payload."""
    profile = record.get("assignment_profile")
    payload_json = record.get("assignment_profile_payload_json")
    recorded_digest = record.get("assignment_profile_digest")
    if profile is None and payload_json is None and recorded_digest is None:
        return {
            "state": "legacy",
            "profile": None,
            "payload_json": None,
            "digest": None,
            "reason": None,
        }
    if not isinstance(profile, Mapping):
        return _invalid_evidence("the assignment profile object is missing")
    if expected_payload_json is not None and payload_json != expected_payload_json:
        return _invalid_evidence("the convergence record and supplied profile payload differ")
    if expected_digest is not None and recorded_digest != expected_digest:
        return _invalid_evidence("the convergence record and supplied profile digest differ")

    parsed, payload_error = _parse_exact_json_payload(
        payload_json, "assignment profile"
    )
    if payload_error:
        return _invalid_evidence(payload_error)
    if dict(profile) != parsed:
        return _invalid_evidence("the profile object does not equal its exact payload")
    if frozenset(parsed) != _ASSIGNMENT_PROFILE_FIELDS:
        missing = sorted(_ASSIGNMENT_PROFILE_FIELDS - frozenset(parsed))
        extra = sorted(frozenset(parsed) - _ASSIGNMENT_PROFILE_FIELDS)
        return _invalid_evidence(
            f"the profile fields are not exact; missing={missing}, extra={extra}"
        )
    for field, expected in _FIXED_ASSIGNMENT_PROFILE_VALUES.items():
        actual = parsed.get(field)
        if isinstance(actual, bool) or actual != expected:
            return _invalid_evidence(f"the profile {field} must be {expected!r}")
    engine_version = parsed.get("engine_version")
    if (
        not isinstance(engine_version, str)
        or not engine_version.strip()
        or engine_version.strip().lower() == "unknown"
    ):
        return _invalid_evidence("the profile engine_version must name the exact installed version")
    for field in ("capacity_field", "time_field"):
        value = parsed.get(field)
        if not isinstance(value, str) or not value.strip():
            return _invalid_evidence(f"the profile {field} must be a nonempty string")
    vdf_parameters = parsed.get("vdf_parameters")
    if not isinstance(vdf_parameters, Mapping) or frozenset(vdf_parameters) != {"alpha", "beta"}:
        return _invalid_evidence("the profile vdf_parameters must contain exactly alpha and beta")
    if (
        isinstance(vdf_parameters.get("alpha"), bool)
        or vdf_parameters.get("alpha") != 0.15
        or isinstance(vdf_parameters.get("beta"), bool)
        or vdf_parameters.get("beta") != 4
    ):
        return _invalid_evidence("the profile vdf_parameters must be alpha=0.15 and beta=4")
    target_gap = parsed.get("target_gap")
    if (
        isinstance(target_gap, bool)
        or not isinstance(target_gap, (int, float))
        or not math.isfinite(float(target_gap))
        or float(target_gap) <= 0
        or float(target_gap) > 0.0005
    ):
        return _invalid_evidence(
            "the profile target_gap must be finite, positive, and no greater than 0.0005"
        )
    max_iterations = parsed.get("max_iterations")
    if isinstance(max_iterations, bool) or not isinstance(max_iterations, int) or max_iterations < 3000:
        return _invalid_evidence("the profile max_iterations must be an integer of at least 3000")
    cores = parsed.get("cores")
    if isinstance(cores, bool) or not isinstance(cores, int) or cores < 1:
        return _invalid_evidence("the profile cores must be an integer of at least one")
    for field in ("algorithm", "target_gap", "max_iterations"):
        if record.get(field) != parsed.get(field):
            return _invalid_evidence(f"the recorded {field} does not match the profile")
    if not isinstance(recorded_digest, str) or not _LOWERCASE_SHA256.fullmatch(recorded_digest):
        return _invalid_evidence("the recorded profile digest is not a lowercase SHA-256")
    actual_digest = _sha256_text(payload_json)
    if recorded_digest != actual_digest:
        return _invalid_evidence("the recorded profile digest does not match its exact payload")
    return {
        "state": "verified",
        "profile": parsed,
        "payload_json": payload_json,
        "digest": actual_digest,
        "reason": None,
    }


def link_id_set_digest(link_ids: Iterable[int]) -> str:
    """SHA-256 of the exact compact sorted JSON integer array."""
    return _sha256_text(json.dumps(sorted(link_ids), separators=(",", ":")))


def _valid_digest(value: Any) -> bool:
    return isinstance(value, str) and bool(_LOWERCASE_SHA256.fullmatch(value))


def _validate_retained_network_manifest(value: Any) -> tuple[dict[str, Any] | None, str | None]:
    if not isinstance(value, Mapping) or frozenset(value) != _RETAINED_NETWORK_MANIFEST_FIELDS:
        return None, "the retained-network manifest fields are not exact"
    manifest = dict(value)
    if manifest.get("schema_version") != RETAINED_NETWORK_MANIFEST_SCHEMA_VERSION:
        return None, "the retained-network manifest schema is unsupported"
    for field in ("all_link_count", "roadway_link_count", "modeling_connector_link_count"):
        count = manifest.get(field)
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            return None, f"the retained-network manifest {field} must be a nonnegative integer"
    if manifest["all_link_count"] < 1 or manifest["roadway_link_count"] < 1:
        return None, "the retained-network manifest must contain at least one roadway link"
    if manifest["all_link_count"] != (
        manifest["roadway_link_count"] + manifest["modeling_connector_link_count"]
    ):
        return None, "the retained-network manifest link counts do not reconcile"
    for field in (
        "all_link_ids_digest",
        "roadway_link_ids_digest",
        "modeling_connector_link_ids_digest",
    ):
        if not _valid_digest(manifest.get(field)):
            return None, f"the retained-network manifest {field} is not a lowercase SHA-256"
    if manifest.get("excluded_roles") != ["modeling_connector"]:
        return None, "the retained-network manifest must disclose the modeling_connector exclusion"
    if manifest.get("role_definition") != {
        "modeling_connector": "link_type = centroid_connector",
        "roadway": "link_type != centroid_connector",
    }:
        return None, "the retained-network manifest role definition is unsupported"
    return manifest, None


def _recorded_network_settings(
    payload_json: Any, recorded_digest: Any
) -> dict[str, Any]:
    parsed, payload_error = _parse_exact_json_payload(payload_json, "network settings")
    if payload_error:
        return {"state": "invalid", "settings": None, "payload_json": None, "digest": None, "reason": payload_error}
    if frozenset(parsed) != {"schema_version", "road_class_factors", "application", "excludes"}:
        return {"state": "invalid", "settings": None, "payload_json": None, "digest": None, "reason": "the network-settings fields are not exact"}
    if parsed.get("schema_version") != NETWORK_SETTINGS_SCHEMA_VERSION:
        return {"state": "invalid", "settings": None, "payload_json": None, "digest": None, "reason": "the network-settings schema is unsupported"}
    if parsed.get("application") != _NETWORK_SETTINGS_APPLICATION or parsed.get("excludes") != _NETWORK_SETTINGS_EXCLUDES:
        return {"state": "invalid", "settings": None, "payload_json": None, "digest": None, "reason": "the network-settings application or exclusions are unsupported"}
    factors = parsed.get("road_class_factors")
    if not isinstance(factors, Mapping):
        return {"state": "invalid", "settings": None, "payload_json": None, "digest": None, "reason": "the network settings have no road-class factors"}
    for road_class, factor in factors.items():
        if (
            not isinstance(road_class, str)
            or not road_class.strip()
            or isinstance(factor, bool)
            or not isinstance(factor, (int, float))
            or not math.isfinite(float(factor))
            or float(factor) <= 0
        ):
            return {"state": "invalid", "settings": None, "payload_json": None, "digest": None, "reason": "the network settings contain an invalid road-class factor"}
    if not _valid_digest(recorded_digest):
        return {"state": "invalid", "settings": None, "payload_json": None, "digest": None, "reason": "the network-settings digest is not a lowercase SHA-256"}
    actual_digest = _sha256_text(payload_json)
    if actual_digest != recorded_digest:
        return {"state": "invalid", "settings": None, "payload_json": None, "digest": None, "reason": "the network-settings digest does not match its exact payload"}
    return {"state": "verified", "settings": parsed, "payload_json": payload_json, "digest": actual_digest, "reason": None}


def _recorded_network_state(
    record: Any,
    recorded_digest: Any,
    *,
    expected_network_settings_digest: str | None,
) -> dict[str, Any]:
    invalid = lambda reason: {"state": "invalid", "record": None, "digest": None, "manifest": None, "reason": reason}
    if not isinstance(record, Mapping) or frozenset(record) != _NETWORK_STATE_FIELDS:
        return invalid("the assignment-network-state fields are not exact")
    state_record = dict(record)
    if state_record.get("schema_version") != NETWORK_STATE_SCHEMA_VERSION:
        return invalid("the assignment-network-state schema is unsupported")
    if not _valid_digest(recorded_digest):
        return invalid("the assignment-network-state digest is not a lowercase SHA-256")
    try:
        actual_digest = _sha256_text(_canonical_json(state_record))
    except (TypeError, ValueError) as error:
        return invalid(f"the assignment-network-state is not canonical JSON ({error})")
    if actual_digest != recorded_digest:
        return invalid("the assignment-network-state digest does not match its record")
    digest_fields = [
        "network_settings_digest",
        "assignment_centroid_order_digest",
        "graph_rows_digest",
        "graph_cost_digest",
        "compact_cost_digest",
        "solver_free_flow_tt_digest",
        "solver_capacity_digest",
        "retained_network_digest",
    ]
    for field in digest_fields:
        if not _valid_digest(state_record.get(field)):
            return invalid(f"the assignment-network-state {field} is not a lowercase SHA-256")
    if state_record.get("network_settings_digest") != expected_network_settings_digest:
        return invalid("the assignment-network-state does not name its verified network settings")
    for field in ("assignment_centroid_count", "graph_row_count"):
        value = state_record.get(field)
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            return invalid(f"the assignment-network-state {field} must be a positive integer")
    for field in ("block_centroid_flows",):
        if not isinstance(state_record.get(field), bool):
            return invalid(f"the assignment-network-state {field} must be boolean")
    penalty = state_record.get("penalty_through_centroids")
    if penalty != "positive_infinity":
        if not isinstance(penalty, str):
            return invalid(
                "the assignment-network-state centroid penalty must be float.hex() or positive_infinity"
            )
        try:
            decoded_penalty = float.fromhex(penalty)
        except ValueError:
            return invalid(
                "the assignment-network-state centroid penalty must be float.hex() or positive_infinity"
            )
        if not math.isfinite(decoded_penalty) or decoded_penalty < 0 or decoded_penalty.hex() != penalty:
            return invalid(
                "the assignment-network-state centroid penalty must be canonical finite float.hex()"
            )
    for field in (
        "cost_field",
        "capacity_field",
        "graph_float_dtype",
        "graph_cost_dtype",
        "compact_cost_dtype",
        "solver_free_flow_tt_dtype",
        "solver_capacity_dtype",
    ):
        value = state_record.get(field)
        if not isinstance(value, str) or not value.strip():
            return invalid(f"the assignment-network-state {field} must be a nonempty string")
    manifest, manifest_error = _validate_retained_network_manifest(
        state_record.get("retained_network_manifest")
    )
    if manifest_error:
        return invalid(manifest_error)
    return {"state": "verified", "record": state_record, "digest": actual_digest, "manifest": manifest, "reason": None}


def geh(first: float, second: float) -> float:
    """The GEH statistic for two volumes. Zero when both are zero."""
    total = float(first) + float(second)
    if total <= 0:
        return 0.0
    return math.sqrt(2.0 * (float(first) - float(second)) ** 2 / total)


def classify_agreement(geh_value: float) -> str:
    if geh_value < GEH_CLOSE:
        return "agree"
    if geh_value < GEH_MARGINAL:
        return "marginal"
    return "diverge"


def _integral_link_id(value: Any, context: str) -> int:
    if isinstance(value, bool) or value is None:
        raise CorridorAgreementError(f"{context} has no integral link_id")
    try:
        parsed = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise CorridorAgreementError(f"{context} has malformed link_id {value!r}") from None
    if not parsed.is_finite() or parsed != parsed.to_integral_value():
        raise CorridorAgreementError(f"{context} has non-integral link_id {value!r}")
    return int(parsed)


def _finite_nonnegative_volume(value: Any, context: str) -> float:
    if isinstance(value, bool) or value is None or (isinstance(value, str) and not value.strip()):
        raise CorridorAgreementError(f"{context} has no numeric volume")
    try:
        parsed = Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        raise CorridorAgreementError(f"{context} has malformed volume {value!r}") from None
    if not parsed.is_finite() or parsed < 0:
        raise CorridorAgreementError(f"{context} volume must be finite and nonnegative")
    converted = float(parsed)
    if not math.isfinite(converted):
        raise CorridorAgreementError(f"{context} volume is outside the finite float range")
    return converted


def _volumes_by_link(
    rows: Iterable[Mapping[str, Any]], volume_column: str, table_label: str
) -> dict[int, float]:
    if not isinstance(volume_column, str) or not volume_column:
        raise CorridorAgreementError("The volume column name must be nonempty")
    volumes: dict[int, float] = {}
    saw_row = False
    for row_number, row in enumerate(rows, start=2):
        saw_row = True
        context = f"{table_label} table row {row_number}"
        if not isinstance(row, Mapping):
            raise CorridorAgreementError(f"{context} is not a row object")
        if "link_id" not in row:
            raise CorridorAgreementError(f"{context} is missing required link_id")
        if volume_column not in row:
            raise CorridorAgreementError(
                f"{context} is missing required volume column {volume_column!r}"
            )
        link_id = _integral_link_id(row["link_id"], context)
        if link_id in volumes:
            raise CorridorAgreementError(
                f"{table_label} table contains duplicate link_id {link_id}"
            )
        volumes[link_id] = _finite_nonnegative_volume(
            row[volume_column], f"{context} column {volume_column!r}"
        )
    if not saw_row:
        raise CorridorAgreementError(f"The {table_label} volume table has no rows")
    return volumes


def compare_link_volumes(
    first_rows: Sequence[Mapping[str, Any]],
    second_rows: Sequence[Mapping[str, Any]],
    *,
    volume_column: str = "PCE_tot",
    minimum_volume: float = DEFAULT_MINIMUM_VOLUME,
    link_names: Mapping[int, Mapping[str, Any]] | None = None,
    analysis_link_ids: Iterable[int] | None = None,
) -> dict[str, Any]:
    """Compare one run's link volumes against another's, link by link.

    Both runs must describe the same network. A link present in one and not the
    other is REPORTED rather than skipped: it means the two runs did not in fact
    hold the network constant, which invalidates the whole premise that a
    difference is attributable to the demand model.
    """
    if (
        isinstance(minimum_volume, bool)
        or not isinstance(minimum_volume, (int, float))
        or not math.isfinite(float(minimum_volume))
        or float(minimum_volume) < 0
    ):
        raise CorridorAgreementError("minimum_volume must be finite and nonnegative")
    first = _volumes_by_link(first_rows, volume_column, "first")
    second = _volumes_by_link(second_rows, volume_column, "second")

    shared = sorted(set(first) & set(second))
    only_first = sorted(set(first) - set(second))
    only_second = sorted(set(second) - set(first))

    if analysis_link_ids is None:
        analyzed = shared
    else:
        analyzed_ids = {
            _integral_link_id(link_id, "analysis link set") for link_id in analysis_link_ids
        }
        analyzed = sorted(set(shared) & analyzed_ids)

    links: list[dict[str, Any]] = []
    for link_id in analyzed:
        # The published values are the inputs to every published derived value.
        # This keeps JSON, Markdown, GeoJSON, and the browser's recomputation in
        # exact agreement at rounding boundaries.
        a = round(first[link_id], 2)
        b = round(second[link_id], 2)
        larger = max(a, b)
        metadata = (link_names or {}).get(link_id, {})
        rounded_geh = round(geh(a, b), 3)
        links.append(
            {
                "link_id": link_id,
                "name": str(metadata.get("name") or "").strip(),
                "link_type": str(metadata.get("link_type") or "").strip(),
                "first_volume": a,
                "second_volume": b,
                "difference": round(b - a, 2),
                "percent_difference": round((b - a) / a * 100.0, 2) if a > 0 else None,
                "geh": rounded_geh,
                "agreement": classify_agreement(rounded_geh),
                "carries_meaningful_traffic": larger >= minimum_volume,
            }
        )

    return {
        "links": links,
        "network_alignment": {
            "first_links": len(first),
            "second_links": len(second),
            "first_link_ids_digest": link_id_set_digest(first),
            "second_link_ids_digest": link_id_set_digest(second),
            # Internal join evidence only. build_agreement_map removes these
            # arrays before publishing; the artifact carries their count and
            # digest rather than tens of thousands of ids.
            "_first_link_ids": sorted(first),
            "_second_link_ids": sorted(second),
            "shared_links": len(shared),
            "only_in_first": len(only_first),
            "only_in_second": len(only_second),
            "exact": not only_first and not only_second,
            "note": _alignment_note(len(shared), len(only_first), len(only_second)),
        },
        "settings": {
            "volume_column": volume_column,
            "minimum_volume": minimum_volume,
            "geh_close": GEH_CLOSE,
            "geh_marginal": GEH_MARGINAL,
        },
    }


def _alignment_note(shared: int, only_first: int, only_second: int) -> str:
    if not only_first and not only_second:
        return (
            f"Both volume tables contain exactly the same {shared:,} link ids. This establishes "
            "link-set alignment only; the recorded network-settings digests still decide whether "
            "the network settings were held constant."
        )
    return (
        f"{shared:,} links are common to both runs, but {only_first:,} appear only in the first and "
        f"{only_second:,} only in the second. The link sets do not match, so the diagnostic rows "
        "remain visible but no difference is attributable to the demand model."
    )


def network_consistency_verdict(
    alignment: Mapping[str, Any],
    *,
    first_network_settings_payload_json: str | None,
    first_network_settings_digest: str | None,
    second_network_settings_payload_json: str | None,
    second_network_settings_digest: str | None,
    first_network_state_record: Mapping[str, Any] | None,
    first_network_state_digest: str | None,
    second_network_state_record: Mapping[str, Any] | None,
    second_network_state_digest: str | None,
    retained_network_manifest: Mapping[str, Any] | None,
    geometry_network_state_digest: str | None,
    geometry_roadway_link_ids: Iterable[int] | None,
) -> dict[str, Any]:
    """Verify the exact settings, observed state, table coverage, and map join."""
    settings = {
        "first": _recorded_network_settings(
            first_network_settings_payload_json, first_network_settings_digest
        ),
        "second": _recorded_network_settings(
            second_network_settings_payload_json, second_network_settings_digest
        ),
    }
    states = {
        "first": _recorded_network_state(
            first_network_state_record,
            first_network_state_digest,
            expected_network_settings_digest=(
                settings["first"]["digest"] if settings["first"]["state"] == "verified" else None
            ),
        ),
        "second": _recorded_network_state(
            second_network_state_record,
            second_network_state_digest,
            expected_network_settings_digest=(
                settings["second"]["digest"] if settings["second"]["state"] == "verified" else None
            ),
        ),
    }
    # Preserve everything supplied, even when it fails verification. A
    # diagnostic artifact must make a producer defect inspectable.
    for side, payload_json, digest in (
        ("first", first_network_settings_payload_json, first_network_settings_digest),
        ("second", second_network_settings_payload_json, second_network_settings_digest),
    ):
        settings[side]["recorded_payload_json"] = payload_json
        settings[side]["recorded_digest"] = digest
    for side, record, digest in (
        ("first", first_network_state_record, first_network_state_digest),
        ("second", second_network_state_record, second_network_state_digest),
    ):
        states[side]["recorded_record"] = dict(record) if isinstance(record, Mapping) else record
        states[side]["recorded_digest"] = digest

    table_coverage: dict[str, Any] = {}
    for side in ("first", "second"):
        state = states[side]
        manifest = state.get("manifest") or {}
        table_count = alignment.get(f"{side}_links")
        table_digest = alignment.get(f"{side}_link_ids_digest")
        table_coverage[side] = {
            "table_link_count": table_count,
            "table_link_ids_digest": table_digest,
            "retained_all_link_count": manifest.get("all_link_count"),
            "retained_all_link_ids_digest": manifest.get("all_link_ids_digest"),
            "exact": (
                state.get("state") == "verified"
                and table_count == manifest.get("all_link_count")
                and table_digest == manifest.get("all_link_ids_digest")
            ),
        }

    geometry_ids = None
    if geometry_roadway_link_ids is not None:
        geometry_ids = sorted(
            {_integral_link_id(link_id, "geometry roadway link set") for link_id in geometry_roadway_link_ids}
        )
    selected_manifest, selected_manifest_error = _validate_retained_network_manifest(
        retained_network_manifest
    )
    geometry = {
        "retained_network_manifest": selected_manifest,
        "network_state_digest": geometry_network_state_digest,
        "roadway_link_count": None if geometry_ids is None else len(geometry_ids),
        "roadway_link_ids_digest": (
            None if geometry_ids is None else link_id_set_digest(geometry_ids)
        ),
        "exact": False,
        "reason": selected_manifest_error,
    }
    if selected_manifest and geometry_ids is not None:
        first_table_ids = set(alignment.get("_first_link_ids") or [])
        derived_connector_ids = sorted(first_table_ids - set(geometry_ids))
        geometry["derived_modeling_connector_count"] = len(derived_connector_ids)
        geometry["derived_modeling_connector_link_ids_digest"] = link_id_set_digest(
            derived_connector_ids
        )
        geometry["exact"] = (
            len(geometry_ids) == selected_manifest["roadway_link_count"]
            and link_id_set_digest(geometry_ids) == selected_manifest["roadway_link_ids_digest"]
            and len(derived_connector_ids)
            == selected_manifest["modeling_connector_link_count"]
            and link_id_set_digest(derived_connector_ids)
            == selected_manifest["modeling_connector_link_ids_digest"]
            and geometry_network_state_digest == first_network_state_digest
            and geometry_network_state_digest == second_network_state_digest
        )
        if not geometry["exact"]:
            geometry["reason"] = (
                "the selected roadway geometry does not exactly name the verified retained network"
            )

    evidence = {
        "network_settings": settings,
        "network_states": states,
        "table_coverage": table_coverage,
        "geometry": geometry,
    }

    invalid_settings = [side for side, item in settings.items() if item["state"] != "verified"]
    if invalid_settings:
        return {
            "status": "unverified",
            "exact_network_alignment": alignment.get("exact") is True,
            "evidence": evidence,
            "note": "The exact network-settings payload and digest could not be verified on both sides. No difference is attributable to demand.",
        }
    if settings["first"]["payload_json"] != settings["second"]["payload_json"]:
        return {
            "status": "settings_mismatch",
            "exact_network_alignment": alignment.get("exact") is True,
            "evidence": evidence,
            "note": "The verified network-settings payloads differ. Diagnostics remain visible, but no difference is attributable to demand.",
        }
    invalid_states = [side for side, item in states.items() if item["state"] != "verified"]
    if invalid_states:
        return {
            "status": "unverified",
            "exact_network_alignment": alignment.get("exact") is True,
            "evidence": evidence,
            "note": "The observed assignment-network-state record and digest could not be verified on both sides. No difference is attributable to demand.",
        }
    if (
        states["first"]["record"] != states["second"]["record"]
        or states["first"]["digest"] != states["second"]["digest"]
    ):
        return {
            "status": "network_state_mismatch",
            "exact_network_alignment": alignment.get("exact") is True,
            "evidence": evidence,
            "note": "The verified assignments observed different retained network state. Diagnostics remain visible, but no difference is attributable to demand.",
        }
    if alignment.get("exact") is not True:
        return {
            "status": "network_mismatch",
            "exact_network_alignment": False,
            "evidence": evidence,
            "note": "The volume-table link sets differ. Shared-link diagnostics remain visible, but no difference is attributable to demand.",
        }
    if not all(item["exact"] for item in table_coverage.values()):
        return {
            "status": "retained_network_coverage_mismatch",
            "exact_network_alignment": True,
            "evidence": evidence,
            "note": "At least one volume table does not cover the complete retained all-link identity. No difference is attributable to demand.",
        }
    if selected_manifest != states["first"]["manifest"] or not geometry["exact"]:
        return {
            "status": "geometry_mismatch" if retained_network_manifest is not None else "unverified",
            "exact_network_alignment": True,
            "evidence": evidence,
            "note": "Exact roadway geometry for the verified retained network was not established. The tabular diagnostic remains available, but no mapped difference is attributable to demand.",
        }
    return {
        "status": "verified_same",
        "exact_network_alignment": True,
        "evidence": evidence,
        "note": "Both assignments prove the same exact profile, network settings, observed network state, complete all-link volume coverage, and roadway-only geometry.",
    }


def agreement_summary(comparison: Mapping[str, Any]) -> dict[str, Any]:
    """The headline, phrased so an agreement figure cannot be read too kindly."""
    links = list(comparison["links"])
    meaningful = [link for link in links if link["carries_meaningful_traffic"]]

    def share(subset: Sequence[Mapping[str, Any]], label: str) -> float | None:
        if not subset:
            return None
        return round(sum(1 for link in subset if link["agreement"] == label) / len(subset), 4)

    volume_total = sum(max(link["first_volume"], link["second_volume"]) for link in links)
    volume_agreeing = sum(
        max(link["first_volume"], link["second_volume"]) for link in links if link["agreement"] == "agree"
    )

    return {
        "links_compared": len(links),
        "links_carrying_meaningful_traffic": len(meaningful),
        "minimum_volume": comparison["settings"]["minimum_volume"],
        "agree_share_all_links": share(links, "agree"),
        "agree_share_meaningful_links": share(meaningful, "agree"),
        "diverge_share_meaningful_links": share(meaningful, "diverge"),
        "agree_share_by_volume": round(volume_agreeing / volume_total, 4) if volume_total > 0 else None,
        "median_geh_meaningful_links": _median([link["geh"] for link in meaningful]),
        "note": _summary_note(links, meaningful, comparison),
    }


def _median(values: Sequence[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return round(ordered[middle], 3)
    return round((ordered[middle - 1] + ordered[middle]) / 2.0, 3)


def _summary_note(
    links: Sequence[Mapping[str, Any]],
    meaningful: Sequence[Mapping[str, Any]],
    comparison: Mapping[str, Any],
) -> str:
    if not meaningful:
        return (
            f"None of the {len(links):,} links compared carries more than "
            f"{comparison['settings']['minimum_volume']:,.0f} vehicles, so there is no corridor here "
            "on which the two methods can meaningfully be said to agree or disagree."
        )
    agreeing = sum(1 for link in meaningful if link["agreement"] == "agree")
    diverging = sum(1 for link in meaningful if link["agreement"] == "diverge")
    return (
        f"Of {len(meaningful):,} links carrying more than "
        f"{comparison['settings']['minimum_volume']:,.0f} vehicles, {agreeing:,} agree closely "
        f"between the two demand models and {diverging:,} diverge. Agreement is judged by GEH, the "
        "traffic-engineering yardstick for comparing two volumes — but its usual thresholds were "
        "written for checking a model against measured counts, where one side is ground truth. "
        "Here neither side is, so agreement means the two methods concur, NOT that either is "
        "correct. The measured holdout study found that agreement does not predict count accuracy; "
        "this map identifies sensitivity to the demand method. The two are never averaged: a "
        "blended figure would have no provenance and would destroy the only thing this comparison "
        "produces."
    )


def corridor_rollup(
    comparison: Mapping[str, Any], *, minimum_links: int = 1
) -> list[dict[str, Any]]:
    """Roll the link comparison up to named corridors, worst agreement first.

    A corridor is the road name the network carries. Links with no name are not
    grouped together into a single anonymous corridor — they are unrelated roads
    that happen to share a missing attribute, and merging them would invent a
    corridor nobody can find on a map.
    """
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for link in comparison["links"]:
        name = str(link.get("name") or "").strip()
        if not name or not link["carries_meaningful_traffic"]:
            continue
        grouped.setdefault(name, []).append(link)

    corridors: list[dict[str, Any]] = []
    for name, corridor_links in grouped.items():
        if len(corridor_links) < minimum_links:
            continue
        first_total = sum(link["first_volume"] for link in corridor_links)
        second_total = sum(link["second_volume"] for link in corridor_links)
        corridor_geh = round(geh(first_total, second_total), 3)
        corridors.append(
            {
                "corridor": name,
                "links": len(corridor_links),
                "first_volume": round(first_total, 2),
                "second_volume": round(second_total, 2),
                "difference": round(second_total - first_total, 2),
                "geh": corridor_geh,
                "agreement": classify_agreement(corridor_geh),
                "worst_link_geh": round(max(link["geh"] for link in corridor_links), 3),
            }
        )
    # Worst first. A reader scanning this list is looking for what NOT to quote,
    # and putting the agreeing corridors on top buries exactly that.
    corridors.sort(key=lambda corridor: (-corridor["geh"], corridor["corridor"]))
    return corridors


def noise_floor_disclosure(noise_floor: Mapping[str, Any] | None) -> str:
    """What the assignment alone does to link volumes, before any demand differs.

    MEASURED, NOT ASSUMED — and it was very nearly reported as a finding. On
    2026-08-16 two runs whose demand differed by 0.001% were compared over the
    same 28,670-link network: total vehicle-miles matched to 0.047%, and 13% of
    the links carrying real traffic still differed by GEH 10 or more, 318 up and
    189 down. Equilibrium assignment moves flow between near-equal-cost parallel
    routes, and at a relative gap of 0.01 it has not finished deciding.

    A comparison that does not state this invites its reader to attribute that
    13% to the demand model, which is the one thing the whole exercise claims to
    be able to do.
    """
    if not noise_floor:
        return (
            "THE LOCAL ASSIGNMENT NOISE FLOOR HAS NOT BEEN MEASURED FOR THIS comparison. Equilibrium "
            "assignment redistributes flow between near-equal-cost parallel routes; measured once "
            "at a loose relative gap of 0.01, 13% of busy links diverged with effectively identical "
            "demand. Exact retained-network evidence and the tight convergence limit remain required "
            "before attribution. A local round-trip measurement would additionally quantify residual "
            "solver sensitivity and should accompany high-stakes interpretation of a single link."
        )
    share = noise_floor.get("diverge_share_meaningful_links")
    gap = noise_floor.get("relative_gap")
    return (
        "The assignment's own contribution was measured for this network by re-assigning one "
        f"model's own demand and comparing it against itself: {share:.1%} of busy links diverged "
        f"with no demand difference at all"
        + (f", at a relative gap of {gap}." if gap is not None else ".")
        + " Divergence at or below that level is the assignment deciding between parallel routes, "
        "not the demand models disagreeing."
    )


def convergence_verdict(
    first: Mapping[str, Any] | None,
    second: Mapping[str, Any] | None,
    *,
    first_assignment_profile_payload_json: str | None = None,
    first_assignment_profile_digest: str | None = None,
    second_assignment_profile_payload_json: str | None = None,
    second_assignment_profile_digest: str | None = None,
) -> dict[str, Any]:
    """Whether these two runs were converged tightly enough to be compared at all.

    THE CHECK THAT MAKES THE MEASUREMENT BINDING. A comparison run at the default
    gap produces corridor divergence from the assignment alone, and a reader has
    no way to tell that from the demand models disagreeing. Stated in a document
    this would be a convention; here it is a field every report carries.

    Absent convergence records are 'unknown', which is deliberately not 'fine'.
    """
    first_record = first or {}
    second_record = second or {}
    first_profile = _recorded_assignment_profile(
        first_record,
        expected_payload_json=first_assignment_profile_payload_json,
        expected_digest=first_assignment_profile_digest,
    )
    second_profile = _recorded_assignment_profile(
        second_record,
        expected_payload_json=second_assignment_profile_payload_json,
        expected_digest=second_assignment_profile_digest,
    )
    profile_states = {
        "first": first_profile["state"],
        "second": second_profile["state"],
    }
    profiles = {
        "first": first_profile["profile"],
        "second": second_profile["profile"],
    }
    profile_digests = {
        "first": first_profile["digest"],
        "second": second_profile["digest"],
    }
    profile_payloads = {
        "first": first_profile["payload_json"],
        "second": second_profile["payload_json"],
    }
    profile_evidence = {
        "first": {
            "verification_state": first_profile["state"],
            "reason": first_profile["reason"],
            "profile": dict(first_record.get("assignment_profile"))
            if isinstance(first_record.get("assignment_profile"), Mapping)
            else first_record.get("assignment_profile"),
            "payload_json": first_record.get("assignment_profile_payload_json"),
            "digest": first_record.get("assignment_profile_digest"),
        },
        "second": {
            "verification_state": second_profile["state"],
            "reason": second_profile["reason"],
            "profile": dict(second_record.get("assignment_profile"))
            if isinstance(second_record.get("assignment_profile"), Mapping)
            else second_record.get("assignment_profile"),
            "payload_json": second_record.get("assignment_profile_payload_json"),
            "digest": second_record.get("assignment_profile_digest"),
        },
    }
    gaps = {
        "first": None if not first else first.get("final_gap"),
        "second": None if not second else second.get("final_gap"),
    }
    base = {
        "attributable_at": [],
        "gaps": gaps,
        "required_gap": COMPARISON_MAX_RELATIVE_GAP,
        "assignment_profiles": profiles,
        "assignment_profile_payloads": profile_payloads,
        "assignment_profile_digests": profile_digests,
        "assignment_profile_evidence": profile_evidence,
    }
    known = {
        side: float(gap)
        for side, gap in gaps.items()
        if not isinstance(gap, bool)
        and isinstance(gap, (int, float))
        and math.isfinite(float(gap))
        and float(gap) >= 0
    }
    if len(known) != 2:
        missing = [side for side in ("first", "second") if side not in known]
        return {
            **base,
            "status": "unknown",
            "note": (
                f"The {', '.join(missing)} assignment did not record a valid nonnegative final "
                "gap, so whether a corridor's difference comes from the demand models or from "
                "the assignment cannot be established. Re-run with both convergence records "
                "present."
            ),
        }
    invalid_profiles = {
        side: profile["reason"]
        for side, profile in (("first", first_profile), ("second", second_profile))
        if profile["state"] == "invalid"
    }
    missing_profiles = [
        side for side, state in profile_states.items() if state == "legacy"
    ]
    if invalid_profiles or missing_profiles:
        detail = "; ".join(
            f"{side}: {reason}" for side, reason in sorted(invalid_profiles.items())
        ) or f"{', '.join(missing_profiles)} did not record an assignment profile"
        return {
            **base,
            "status": "unknown",
            "note": (
                "The comparison cannot establish that both sides used the same assignment "
                f"method ({detail}). No corridor or link difference is attributable to the "
                "demand models until both profiles are recorded and verified."
            ),
        }
    if first_profile["digest"] != second_profile["digest"]:
        return {
            **base,
            "status": "assignment_settings_mismatch",
            "note": (
                "The two assignments used different recorded assignment profiles, so their "
                "difference cannot be attributed to the demand models at corridor or link scale."
            ),
        }
    too_loose = {side: gap for side, gap in known.items() if gap > COMPARISON_MAX_RELATIVE_GAP}
    if too_loose:
        detail = ", ".join(f"{side} at {gap:.5f}" for side, gap in sorted(too_loose.items()))
        return {
            **base,
            "status": "corridors_only",
            "attributable_at": ["corridor"],
            "note": (
                f"Read the corridor table, not the individual links. The assignment converged only "
                f"to {detail}, against the {COMPARISON_MAX_RELATIVE_GAP} needed for a link-level "
                "claim. Measured on one county by assigning IDENTICAL demand at both settings: "
                "named corridor totals moved 0.5-1.4%, while 21% of individual links moved more "
                "than 10% and the worst tenth moved 29%. A corridor total aggregates many "
                "links and survives; a single link is where the assignment is still choosing "
                "between parallel routes. Set OPENPLAN_ASSIGNMENT_RGAP_TARGET and "
                "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS and re-run both sides to attribute anything "
                "link by link. This is only the convergence-unit finding; corridor attribution "
                "still requires exact verified profiles, network settings, observed network "
                "state, complete all-link coverage, and roadway geometry."
            ),
        }
    return {
        **base,
        "status": "tight_enough",
        "attributable_at": ["corridor", "link"],
        "note": (
            "Both runs met the measured link-level convergence limit. This removes the stopping "
            "gap as a known link-scale confounder; attribution still requires exact verified "
            "assignment profiles, network settings, observed network state, complete all-link "
            "table coverage, and roadway geometry."
        ),
    }


def build_agreement_map(
    first_rows: Sequence[Mapping[str, Any]],
    second_rows: Sequence[Mapping[str, Any]],
    *,
    first_label: str,
    second_label: str,
    volume_column: str = "PCE_tot",
    minimum_volume: float = DEFAULT_MINIMUM_VOLUME,
    link_names: Mapping[int, Mapping[str, Any]] | None = None,
    noise_floor: Mapping[str, Any] | None = None,
    first_convergence: Mapping[str, Any] | None = None,
    second_convergence: Mapping[str, Any] | None = None,
    first_assignment_profile_payload_json: str | None = None,
    first_assignment_profile_digest: str | None = None,
    second_assignment_profile_payload_json: str | None = None,
    second_assignment_profile_digest: str | None = None,
    first_network_settings_payload_json: str | None = None,
    first_network_settings_digest: str | None = None,
    second_network_settings_payload_json: str | None = None,
    second_network_settings_digest: str | None = None,
    first_network_state_record: Mapping[str, Any] | None = None,
    first_network_state_digest: str | None = None,
    second_network_state_record: Mapping[str, Any] | None = None,
    second_network_state_digest: str | None = None,
    retained_network_manifest: Mapping[str, Any] | None = None,
    geometry_network_state_digest: str | None = None,
    geometry_roadway_link_ids: Iterable[int] | None = None,
) -> dict[str, Any]:
    """The whole comparison: links, corridors, headline, and what it does not mean."""
    comparison = compare_link_volumes(
        first_rows,
        second_rows,
        volume_column=volume_column,
        minimum_volume=minimum_volume,
        link_names=link_names,
        analysis_link_ids=geometry_roadway_link_ids,
    )
    corridors = corridor_rollup(comparison)
    convergence = convergence_verdict(
        first_convergence,
        second_convergence,
        first_assignment_profile_payload_json=first_assignment_profile_payload_json,
        first_assignment_profile_digest=first_assignment_profile_digest,
        second_assignment_profile_payload_json=second_assignment_profile_payload_json,
        second_assignment_profile_digest=second_assignment_profile_digest,
    )
    network_consistency = network_consistency_verdict(
        comparison["network_alignment"],
        first_network_settings_payload_json=first_network_settings_payload_json,
        first_network_settings_digest=first_network_settings_digest,
        second_network_settings_payload_json=second_network_settings_payload_json,
        second_network_settings_digest=second_network_settings_digest,
        first_network_state_record=first_network_state_record,
        first_network_state_digest=first_network_state_digest,
        second_network_state_record=second_network_state_record,
        second_network_state_digest=second_network_state_digest,
        retained_network_manifest=retained_network_manifest,
        geometry_network_state_digest=geometry_network_state_digest,
        geometry_roadway_link_ids=geometry_roadway_link_ids,
    )
    comparison["network_alignment"].pop("_first_link_ids", None)
    comparison["network_alignment"].pop("_second_link_ids", None)
    network_consistency["evidence"]["assignment_profiles"] = convergence[
        "assignment_profile_evidence"
    ]
    profile_states = {
        side: item["verification_state"]
        for side, item in convergence["assignment_profile_evidence"].items()
    }
    if network_consistency["status"] == "verified_same" and any(
        state != "verified" for state in profile_states.values()
    ):
        network_consistency["status"] = "assignment_profile_unverified"
        network_consistency["note"] = (
            "The retained network evidence is exact, but both exact assignment-profile payloads "
            "were not verified. No difference is attributable to demand."
        )
    elif (
        network_consistency["status"] == "verified_same"
        and convergence["assignment_profile_payloads"]["first"]
        != convergence["assignment_profile_payloads"]["second"]
    ):
        network_consistency["status"] = "assignment_profile_mismatch"
        network_consistency["note"] = (
            "The retained network evidence is exact, but the verified assignment profiles differ. "
            "No difference is attributable to demand."
        )
    attributable_at = (
        list(convergence["attributable_at"])
        if network_consistency["status"] == "verified_same"
        else []
    )
    return {
        "schema_version": AGREEMENT_SCHEMA_VERSION,
        "methods": {"first": first_label, "second": second_label},
        "attribution_is_supportable": (
            convergence["status"] == "tight_enough"
            and network_consistency["status"] == "verified_same"
        ),
        # Which UNIT a difference can be read at. A loosely converged pair still
        # supports the corridor table — that is the number a planner asks for —
        # while its individual links are the assignment still deciding.
        "attributable_at": attributable_at,
        "assignment_convergence": convergence,
        "summary": agreement_summary(comparison),
        "network_alignment": comparison["network_alignment"],
        "network_consistency": network_consistency,
        "settings": comparison["settings"],
        "retained_network": {
            "manifest": dict(retained_network_manifest)
            if isinstance(retained_network_manifest, Mapping)
            else None,
            "network_state_digest": geometry_network_state_digest,
            "excluded_roles": (
                list(retained_network_manifest.get("excluded_roles", []))
                if isinstance(retained_network_manifest, Mapping)
                else []
            ),
            "excluded_modeling_connector_count": (
                retained_network_manifest.get("modeling_connector_link_count")
                if isinstance(retained_network_manifest, Mapping)
                else None
            ),
        },
        "assignment_noise_floor": {
            "measured": bool(noise_floor),
            "measurement": dict(noise_floor) if noise_floor else None,
            "note": noise_floor_disclosure(noise_floor),
        },
        "corridors": corridors,
        "links": comparison["links"],
        "what_this_is_not": [
            "Neither method is ground truth. Agreement means the two concur; it does not mean either "
            "is correct, and both can be wrong in the same direction. The measured holdout study "
            "found that agreement does not predict count accuracy; it identifies methodological "
            "sensitivity.",
            "The two volumes are never averaged. A blended figure has no defensible provenance and "
            "destroys the only signal this comparison produces.",
            "GEH thresholds are borrowed from model-versus-count validation, where one side is "
            "measured. They are used here because they are the yardstick a reviewer recognises, not "
            "because a validation standard has been met.",
            noise_floor_disclosure(noise_floor),
            convergence["note"],
            network_consistency["note"],
        ],
    }
