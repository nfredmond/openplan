#!/usr/bin/env python3
"""How much traffic actually crosses the study-area boundary, where it is measured.

============================================================== WHY THIS EXISTS

Trips entering and leaving a study area are a third of everything a screening
run assigns — 216,000 of 578,000 on the county this was written against. Their
magnitude came from five numbers:

    motorway 15000 · trunk 9000 · primary 6000 · secondary 3000 · tertiary 1500

multiplied by lane count, capped at 20,000, and applied in BOTH directions. They
are not measurements of anything. Nobody surveyed a road to get them.

Checked against the state DOT's own published counts near each crossing, on one
county: the freeway and major-primary gateways came out at 0.8-1.2 times the
measured volume, and the trunk-road gateways at 2.7-5.7 times. The same run
validates trunk roads at 3.3 times observed and freeways at 1.1. A road class
whose gateway injects three to six times too much traffic is a road class that
then carries three times too much traffic.

State DOTs publish what crosses those roads. When a published count sits on the
same road within a short distance of the crossing point, it is a measurement and
the table is a guess, so the measurement wins.

======================================================== TWO THINGS IT GETS RIGHT
                                                          THAT THE TABLE DID NOT

**An AADT is two-way, and a gateway has two directions.** The table's value was
applied as `daily_in` AND `daily_out`, so a gateway pushed twice its number
across the boundary. Seeding from a two-way count therefore splits it: half in,
half out, so total crossings equal the measured volume rather than double it.
The even split is an assumption — daily traffic balances over 24 hours — and it
is stated rather than hidden.

**A count only speaks for the place it was taken.** A station ten miles inside
the county measures local traffic that never crosses the boundary at all, so the
match has a tight distance limit and a road-identity check. A gateway with no
count near it keeps the class default and says so; it does not borrow a number
from a different road.

========================================= AND ONE IT MUST NEVER BE ALLOWED TO DO

A count used to SET the demand cannot also be used to GRADE the model. That is
fitting and marking the same exam, which this repository already refuses for
calibration. Every station consumed here is returned in `stations_consumed` so
the validation split can exclude it, and a guard asserts the two sets do not
overlap.
"""
from __future__ import annotations

import math
import re
from typing import Any, Iterable, Mapping, MutableMapping, Sequence

#: How close a published count must be to the boundary crossing to describe it.
#: Deliberately tight. Traffic on a highway changes at every junction, and a
#: count taken past one is measuring a different road's worth of vehicles.
DEFAULT_MAX_MATCH_MILES = 2.0

#: A gateway record's daily figure is applied in both directions, so a two-way
#: published count is halved to make total crossings equal the measurement.
DIRECTION_SPLIT = 0.5

EARTH_RADIUS_MILES = 3958.8

# HPMS functional systems translated only as far as the retained OSM network
# can support them. This is matching evidence, not a new model geography type.
FACILITY_CLASS_TO_LINK_TYPES = {
    "interstate": {"motorway"},
    "principal_arterial_freeway_expressway": {"motorway", "trunk"},
    "principal_arterial_other": {"trunk", "primary"},
    "minor_arterial": {"primary", "secondary"},
    "major_collector": {"secondary", "tertiary"},
    "minor_collector": {"tertiary"},
}


class GatewayCountsError(ValueError):
    """The gateway seeding cannot be trusted, with the reason to show."""


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radians = math.radians
    return 2 * EARTH_RADIUS_MILES * math.asin(
        math.sqrt(
            math.sin(radians(lat2 - lat1) / 2) ** 2
            + math.cos(radians(lat1)) * math.cos(radians(lat2)) * math.sin(radians(lon2 - lon1) / 2) ** 2
        )
    )


def normalize_road_name(value: Any) -> str:
    """Road names for comparison, punctuation and case removed.

    "Alan S. Hart Freeway" and "alan s hart freeway" are the same road. Nothing
    cleverer than that is attempted: a fuzzy match between two different roads
    would seed a gateway from a count taken somewhere else entirely, which is
    the failure this whole module is correcting.
    """
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def count_road_names(count: Mapping[str, Any]) -> set[str]:
    """Every road name a published count says it belongs to.

    `candidate_model_names` is the crosswalk the count builder already writes —
    the network road names this station was matched against. It is what makes a
    count identifiable as belonging to a road rather than merely being near one.
    """
    names: set[str] = set()
    for field in ("candidate_model_names", "facility_name"):
        raw = count.get(field)
        if not raw:
            continue
        for part in str(raw).split("|"):
            for piece in part.split(","):
                normalized = normalize_road_name(piece)
                if normalized:
                    names.add(normalized)
    return names


def _observed(count: Mapping[str, Any]) -> float | None:
    value = count.get("observed_volume")
    if value in (None, "", "TBD", "null"):
        return None
    try:
        volume = float(value)
    except (TypeError, ValueError):
        return None
    return volume if math.isfinite(volume) and volume > 0 else None


def _count_position(count: Mapping[str, Any]) -> tuple[float, float] | None:
    """A count's location, from whichever pair of fields it carries."""
    for lat_field, lon_field in (("latitude", "longitude"), ("lat", "lon")):
        try:
            return float(count[lat_field]), float(count[lon_field])
        except (KeyError, TypeError, ValueError):
            continue
    try:
        return (
            (float(count["bbox_min_lat"]) + float(count["bbox_max_lat"])) / 2.0,
            (float(count["bbox_min_lon"]) + float(count["bbox_max_lon"])) / 2.0,
        )
    except (KeyError, TypeError, ValueError):
        return None


def _field_values(value: Any) -> set[str]:
    return {
        str(piece).strip().lower()
        for part in str(value or "").split("|")
        for piece in part.split(",")
        if str(piece).strip()
    }


def facility_class_agrees(gateway: Mapping[str, Any], count: Mapping[str, Any]) -> bool:
    """Whether source and retained-network facility classes describe one road."""
    link_type = str(gateway.get("link_type") or "").strip().lower()
    candidate_types = _field_values(count.get("candidate_link_types"))
    if candidate_types:
        return link_type in candidate_types
    facility_class = str(count.get("facility_class") or "").strip().lower()
    return link_type in FACILITY_CLASS_TO_LINK_TYPES.get(facility_class, set())


def directionality_agrees(gateway: Mapping[str, Any], count: Mapping[str, Any]) -> bool:
    """Require the observed section and retained link to agree on one/two-way."""
    count_direction = str(count.get("direction") or count.get("directionality") or "").strip().lower()
    if count_direction not in {"one_way", "two_way"}:
        return False
    if "direction" not in gateway:
        return False
    try:
        link_direction = int(gateway["direction"])
    except (TypeError, ValueError):
        return False
    return (link_direction == 0) == (count_direction == "two_way")


def match_count_to_gateway(
    gateway: Mapping[str, Any],
    counts: Sequence[Mapping[str, Any]],
    *,
    max_match_miles: float = DEFAULT_MAX_MATCH_MILES,
    require_facility_and_direction: bool = False,
) -> dict[str, Any] | None:
    """The published count that describes this crossing, or None.

    Requires BOTH road identity and proximity. Proximity alone matched a
    motorway gateway to a count on a different highway 1.2 miles away that read
    3,150 where the freeway carries 33,000 — a 12-fold error that would have
    been introduced in the name of using real data.
    """
    if "name" not in gateway:
        # A crossing with no name key cannot be matched by road identity, and
        # returning None here looks exactly like "no count is near this road".
        # It is not: it is the caller not passing the field. Said out loud,
        # because that silence cost a whole measured run.
        raise GatewayCountsError(
            "This boundary crossing has no `name`, so no published count can be matched to it by "
            "road identity. Every crossing would fall back to its road-class default and the run "
            "would report that as though no counts were nearby."
        )
    gateway_name = normalize_road_name(gateway.get("name"))
    if not gateway_name:
        return None
    try:
        gateway_lat = float(gateway["boundary_lat"])
        gateway_lon = float(gateway["boundary_lon"])
    except (KeyError, TypeError, ValueError):
        return None

    best: dict[str, Any] | None = None
    for count in counts:
        if str(count.get("exclusion_status") or "eligible") != "eligible":
            continue
        if gateway_name not in count_road_names(count):
            continue
        if require_facility_and_direction and not facility_class_agrees(gateway, count):
            continue
        if require_facility_and_direction and not directionality_agrees(gateway, count):
            continue
        observed = _observed(count)
        position = _count_position(count)
        if observed is None or position is None:
            continue
        distance = haversine_miles(gateway_lat, gateway_lon, position[0], position[1])
        if distance > max_match_miles:
            continue
        if best is None or distance < best["distance_miles"]:
            best = {
                "station_id": str(count.get("station_id") or "").strip() or None,
                "facility_name": str(count.get("facility_name") or "").strip() or None,
                "observed_volume": observed,
                "distance_miles": round(distance, 3),
                "source_dataset_id": str(count.get("source_dataset_id") or "").strip() or None,
                "source_vintage": str(count.get("source_vintage") or "").strip() or None,
                "source_section_id": str(count.get("source_section_id") or "").strip() or None,
                "measurement_date": str(count.get("measurement_date") or "").strip() or None,
                "directionality": str(count.get("direction") or count.get("directionality") or "").strip() or None,
                "facility_class": str(count.get("facility_class") or "").strip() or None,
            }
    return best


def seed_gateways_from_counts(
    gateways: Sequence[Mapping[str, Any]],
    counts: Sequence[Mapping[str, Any]],
    *,
    max_match_miles: float = DEFAULT_MAX_MATCH_MILES,
    require_facility_and_direction: bool = False,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Replace each gateway's guessed volume with a measured one where there is one.

    Returns the gateways and an account of what happened to each, including the
    stations consumed — which the validation split must exclude, or the model is
    graded on the same numbers it was built from.
    """
    seeded: list[dict[str, Any]] = []
    decisions: list[dict[str, Any]] = []
    consumed: list[str] = []

    for gateway in gateways:
        updated = dict(gateway)
        match = match_count_to_gateway(
            gateway,
            counts,
            max_match_miles=max_match_miles,
            require_facility_and_direction=require_facility_and_direction,
        )
        previous = float(gateway.get("daily_in") or 0.0) + float(gateway.get("daily_out") or 0.0)
        if match is None:
            updated["daily_basis"] = "road_class_default"
            updated["daily_basis_note"] = (
                "No published count sits on this road within "
                f"{max_match_miles} miles of where it crosses the boundary, so the volume is "
                "OpenPlan's screening default for its road class, not a measurement."
            )
            decisions.append(
                {
                    "gateway": gateway.get("label"),
                    "basis": "road_class_default",
                    "crossings_before": round(previous, 1),
                    "crossings_after": round(previous, 1),
                }
            )
        else:
            half = float(match["observed_volume"]) * DIRECTION_SPLIT
            updated["daily_in"] = round(half, 2)
            updated["daily_out"] = round(half, 2)
            updated["daily_basis"] = "published_count"
            updated["daily_basis_note"] = (
                f"{match['facility_name'] or 'A published count'} measured "
                f"{match['observed_volume']:,.0f} vehicles a day "
                f"{match['distance_miles']} miles from where this road crosses the boundary. That "
                "total is split evenly between traffic entering and leaving, which assumes the day "
                "balances."
            )
            updated["daily_basis_station_id"] = match["station_id"]
            updated["gateway_volume_basis"] = "measured"
            updated["daily_basis_source"] = {
                key: match[key]
                for key in (
                    "source_dataset_id",
                    "source_vintage",
                    "source_section_id",
                    "measurement_date",
                    "directionality",
                    "facility_class",
                    "distance_miles",
                )
            }
            if match["station_id"]:
                consumed.append(match["station_id"])
            decisions.append(
                {
                    "gateway": gateway.get("label"),
                    "basis": "published_count",
                    "station_id": match["station_id"],
                    "observed_volume": match["observed_volume"],
                    "distance_miles": match["distance_miles"],
                    "crossings_before": round(previous, 1),
                    "crossings_after": round(float(match["observed_volume"]), 1),
                }
            )
        seeded.append(updated)

    measured = [d for d in decisions if d["basis"] == "published_count"]
    before = sum(d["crossings_before"] for d in decisions)
    after = sum(d["crossings_after"] for d in decisions)
    return seeded, {
        "gateways": len(seeded),
        "gateways_from_published_counts": len(measured),
        "gateways_from_road_class_default": len(decisions) - len(measured),
        "stations_consumed": sorted(set(consumed)),
        "boundary_crossings_before": round(before, 1),
        "boundary_crossings_after": round(after, 1),
        "decisions": decisions,
        "note": _seeding_note(len(seeded), len(measured), before, after),
    }


def select_measured_gateway_candidate(
    gateways: Sequence[Mapping[str, Any]],
    counts: Sequence[Mapping[str, Any]],
    *,
    max_inferred_gateways: int,
    source_status: str = "available",
    apply_measured_volumes: bool = True,
    retain_all_measured: bool = True,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Select the frozen candidate: all measured crossings plus capped inference.

    All gateway/count matches are computed even for the baseline study arm. The
    baseline keeps its old class volumes, but withholds exactly the same source
    sections from validation as the candidate; otherwise a changed exam could
    masquerade as a changed model.
    """
    seeded, seeding = seed_gateways_from_counts(
        gateways,
        counts,
        require_facility_and_direction=True,
    )
    classified: list[dict[str, Any]] = []
    for original, trial in zip(gateways, seeded):
        row = dict(trial if apply_measured_volumes else original)
        if trial.get("daily_basis") == "published_count":
            basis = "measured"
            # Preserve the evidence even in the baseline arm, whose volume is
            # deliberately left at the class default.
            for field in ("daily_basis_station_id", "daily_basis_source"):
                if field in trial:
                    row[field] = trial[field]
        elif source_status != "available" or not str(original.get("name") or "").strip():
            basis = "unsupported"
        else:
            basis = "inferred"
        row["gateway_volume_basis"] = basis
        row["gateway_volume_applied"] = "measured_aadt" if basis == "measured" and apply_measured_volumes else "road_class_default"
        classified.append(row)

    measured = [row for row in classified if row["gateway_volume_basis"] == "measured"]
    not_measured = [row for row in classified if row["gateway_volume_basis"] != "measured"]
    if retain_all_measured:
        retained_fallback = not_measured[:max_inferred_gateways]
        selected = [*measured, *retained_fallback]
    else:
        # The study baseline reproduces the existing eight-crossing rule. It
        # still computes every strict match so both arms exclude the same exam
        # stations, but a measurement does not change which gateways it runs.
        selected = classified[:max_inferred_gateways]
    selected_key_seed = {
        (row.get("link_id"), row.get("boundary_lon"), row.get("boundary_lat"))
        for row in selected
    }
    dropped = [
        row
        for row in classified
        if (row.get("link_id"), row.get("boundary_lon"), row.get("boundary_lat"))
        not in selected_key_seed
    ]
    def gateway_key(row: Mapping[str, Any]) -> tuple[Any, Any, Any]:
        return (row.get("link_id"), row.get("boundary_lon"), row.get("boundary_lat"))

    selected_keys = {gateway_key(row) for row in selected}
    # Preserve deterministic roadway-rank order. The lists above express the
    # cap rule, while model execution should not reorder otherwise identical
    # external zones because a count happened to exist.
    selected = [row for row in classified if gateway_key(row) in selected_keys]
    decisions = [
        {
            "gateway": row.get("label"),
            "basis": row["gateway_volume_basis"],
            "retained": gateway_key(row) in selected_keys,
            "volume_applied": row["gateway_volume_applied"],
            "station_id": row.get("daily_basis_station_id"),
            "source": row.get("daily_basis_source"),
        }
        for row in classified
    ]
    summary = {
        **seeding,
        "candidate_rule": "all measured crossings plus capped inferred or unsupported crossings",
        "apply_measured_volumes": apply_measured_volumes,
        "retain_all_measured": retain_all_measured,
        "candidate_pool_gateways": len(classified),
        "retained_gateways": len(selected),
        "candidate_pool_measured_gateways": len(measured),
        "measured_gateways": sum(row["gateway_volume_basis"] == "measured" for row in selected),
        "inferred_gateways": sum(row["gateway_volume_basis"] == "inferred" for row in selected),
        "unsupported_gateways": sum(row["gateway_volume_basis"] == "unsupported" for row in selected),
        "unmeasured_cap": max_inferred_gateways,
        "dropped_gateways": len(dropped),
        "dropped_unmeasured_gateways": sum(
            row["gateway_volume_basis"] != "measured" for row in dropped
        ),
        "decisions": decisions,
    }
    return selected, summary


def _seeding_note(total: int, measured: int, before: float, after: float) -> str:
    if measured == 0:
        return (
            f"None of this study area's {total} boundary crossings has a published count on the "
            "same road nearby, so every one of them uses OpenPlan's screening default for its road "
            "class. Those defaults are not measurements, and traffic entering the study area is "
            "usually a large share of everything the model assigns."
        )
    change = (after - before) / before * 100.0 if before > 0 else 0.0
    return (
        f"{measured} of {total} boundary crossings are set from a published traffic count taken on "
        f"the same road near the crossing; the rest use OpenPlan's screening default for their road "
        f"class. Traffic crossing the boundary changed from {before:,.0f} to {after:,.0f} vehicles "
        f"a day ({change:+.0f}%)."
    )


def assert_counts_not_reused_for_grading(
    stations_consumed: Iterable[str], grading_station_ids: Iterable[str]
) -> None:
    """Refuse to grade the model on the counts that built it.

    Seeding a gateway from a count and then reporting how well the model matches
    that same count is marking your own exam. `run_screening_model` already
    refuses the equivalent for calibration; this is the same rule for demand.
    """
    overlap = sorted(set(str(s) for s in stations_consumed) & set(str(s) for s in grading_station_ids))
    if overlap:
        raise GatewayCountsError(
            f"{len(overlap)} count station(s) were used to set how much traffic enters the study "
            f"area AND to grade the result ({', '.join(overlap[:4])}). A model cannot be graded on "
            "the numbers it was built from. Hold these stations out of the validation set."
        )


#: How near a published count must sit to a crossing to describe the volume
#: entering there. Same reasoning as DEFAULT_MAX_MATCH_MILES and deliberately
#: tighter: this one is a denominator, so a count from the wrong place scales
#: the whole estimate.
CROSSING_COUNT_MAX_MILES = 3.0

#: A route needs a profile, not two endpoints. Two counts can only ever say the
#: volume at each end; the interior minimum is what bounds through travel.
MINIMUM_PROFILE_COUNTS = 3


def _facility(count: Mapping[str, Any]) -> str:
    return str(count.get("facility_name") or "").strip()


def counts_on_a_route(
    crossings: Sequence[Mapping[str, Any]], counts: Sequence[Mapping[str, Any]]
) -> list[dict[str, Any]]:
    """The published counts that measure the route these crossings sit on.

    Selected by FACILITY, not by candidate road name. The candidate names come
    from each station's location description, and a description like
    "JCT. RTE. 5" puts a 1,400-vehicle state route into the middle of
    Interstate 5's profile — which is exactly how the first version of this
    estimate produced a through share of 0.03 on a rural interstate. The
    facility of the station nearest a crossing identifies the route; every
    station on that facility is its profile.
    """
    named = normalize_road_name(crossings[0].get("name")) if crossings else ""
    pool: list[dict[str, Any]] = []
    for count in counts:
        if named and named not in count_road_names(count):
            continue
        position = _count_position(count)
        observed = _observed(count)
        if position is None or observed is None or observed <= 0:
            continue
        distance = min(
            haversine_miles(float(c["boundary_lat"]), float(c["boundary_lon"]), position[0], position[1])
            for c in crossings
        )
        pool.append({
            "facility": _facility(count), "distance_miles": distance,
            "observed_volume": observed, "position": position,
            "station_id": str(count.get("station_id") or "").strip() or None,
        })
    if not pool:
        return []
    facility = min(pool, key=lambda row: row["distance_miles"])["facility"]
    return [row for row in pool if row["facility"] == facility]


def passthrough_share_ceiling(
    crossing: Mapping[str, Any], route_counts: Sequence[Mapping[str, Any]]
) -> dict[str, Any] | None:
    """The largest share of this crossing's traffic that CAN be passing through.

    Every vehicle that traverses the study area passes the lowest-volume point
    on the route inside it, so through traffic is at most that minimum — and as
    a share of what enters here, at most `minimum / entering`.

    **This is a CEILING, not an estimate.** Counts say how many vehicles are at
    a place, never which of them are the same vehicles, so no arrangement of
    counts can measure through travel directly. A route whose minimum sits at
    its own crossing yields a ceiling of 1.0, which is true and says nothing.

    Returns None when the route has too little profile to bound anything.
    """
    if len(route_counts) < MINIMUM_PROFILE_COUNTS:
        return None
    nearest = min(
        route_counts,
        key=lambda row: haversine_miles(
            float(crossing["boundary_lat"]), float(crossing["boundary_lon"]),
            row["position"][0], row["position"][1],
        ),
    )
    distance = haversine_miles(
        float(crossing["boundary_lat"]), float(crossing["boundary_lon"]),
        nearest["position"][0], nearest["position"][1],
    )
    if distance > CROSSING_COUNT_MAX_MILES or nearest["observed_volume"] <= 0:
        return None
    minimum = min(row["observed_volume"] for row in route_counts)
    ceiling = min(minimum / nearest["observed_volume"], 1.0)
    return {
        "ceiling": round(ceiling, 4),
        "entering_volume": nearest["observed_volume"],
        "route_minimum_volume": minimum,
        "profile_stations": len(route_counts),
        "entering_station_id": nearest["station_id"],
        "entering_station_miles": round(distance, 3),
        "is_informative": ceiling < 1.0,
        "note": (
            "An upper bound, not a measurement. Every vehicle crossing the study area passes the "
            f"lowest-volume point on this route inside it ({minimum:,.0f} a day), so at most that "
            f"many of the {nearest['observed_volume']:,.0f} entering here can be passing through. "
            "Counts cannot say which vehicles are the same vehicles, so the true share is at most "
            "this and cannot be measured from counts alone."
        ),
    }


def attach_passthrough_ceilings(
    gateways: Sequence[MutableMapping[str, Any]], counts: Sequence[Mapping[str, Any]]
) -> dict[str, Any]:
    """Give each paired crossing the largest through-share its route permits.

    Groups crossings by road, bounds each from that road's count profile, and
    writes `passthrough_share` only where the bound is INFORMATIVE — a route
    whose minimum sits at its own crossing bounds at 1.0, and writing that would
    send every vehicle straight across on the strength of a number that means
    "the counts cannot tell". Those keep the flat constant and say so.

    Mutates the gateway records and returns an account of what each got.
    """
    by_road: dict[str, list[MutableMapping[str, Any]]] = {}
    for gateway in gateways:
        road = normalize_road_name(gateway.get("name"))
        if road:
            by_road.setdefault(road, []).append(gateway)

    decisions: list[dict[str, Any]] = []
    measured = 0
    for road, crossings in by_road.items():
        if len(crossings) < 2:
            continue  # a route crossing once has no through movement to bound
        route_counts = counts_on_a_route(crossings, counts)
        for crossing in crossings:
            bound = passthrough_share_ceiling(crossing, route_counts) if route_counts else None
            if bound and bound["is_informative"]:
                crossing["passthrough_share"] = bound["ceiling"]
                crossing["passthrough_basis"] = "count_profile_ceiling"
                crossing["passthrough_basis_note"] = bound["note"]
                measured += 1
                decisions.append({"road": road, "basis": "count_profile_ceiling", **bound})
            else:
                crossing["passthrough_basis"] = "flat_default"
                crossing["passthrough_basis_note"] = (
                    "No count profile on this road bounds its through travel, so this crossing "
                    "uses OpenPlan's flat screening share — the same figure it would apply to any "
                    "road anywhere."
                )
                decisions.append({
                    "road": road, "basis": "flat_default",
                    "reason": "no informative bound" if bound else "not enough count profile",
                })
    return {
        "paired_crossings": sum(len(v) for v in by_road.values() if len(v) >= 2),
        "crossings_bounded_by_counts": measured,
        "decisions": decisions,
        "note": (
            "Each figure is a CEILING on through travel, not a measurement of it: counts say how "
            "many vehicles are at a place, never which of them are the same vehicles. Crossings "
            "without an informative bound keep the flat screening share."
        ),
    }
