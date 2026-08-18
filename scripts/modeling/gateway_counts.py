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
from typing import Any, Iterable, Mapping, Sequence

#: How close a published count must be to the boundary crossing to describe it.
#: Deliberately tight. Traffic on a highway changes at every junction, and a
#: count taken past one is measuring a different road's worth of vehicles.
DEFAULT_MAX_MATCH_MILES = 2.0

#: A gateway record's daily figure is applied in both directions, so a two-way
#: published count is halved to make total crossings equal the measurement.
DIRECTION_SPLIT = 0.5

EARTH_RADIUS_MILES = 3958.8


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


def match_count_to_gateway(
    gateway: Mapping[str, Any],
    counts: Sequence[Mapping[str, Any]],
    *,
    max_match_miles: float = DEFAULT_MAX_MATCH_MILES,
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
        if gateway_name not in count_road_names(count):
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
            }
    return best


def seed_gateways_from_counts(
    gateways: Sequence[Mapping[str, Any]],
    counts: Sequence[Mapping[str, Any]],
    *,
    max_match_miles: float = DEFAULT_MAX_MATCH_MILES,
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
        match = match_count_to_gateway(gateway, counts, max_match_miles=max_match_miles)
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
