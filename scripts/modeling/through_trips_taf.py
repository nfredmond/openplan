#!/usr/bin/env python3
"""How much travel passes THROUGH a study area, from data that watched it happen.

============================================================== WHY THIS EXISTS

OpenPlan routes a flat 35% of every boundary-crossing route straight across the
study area. That figure is fitted to nothing and applies equally to an
interstate and a farm road. Traffic counts can only ever BOUND it — a count says
how many vehicles are at a place, never whether they are the same vehicles — so
bounding it from counts leaves an upper limit and no estimate.

I concluded that settling it needed origin-destination data nobody can get for
free. That was wrong, and it was wrong because I reasoned from memory instead of
looking.

======================================================== WHAT THIS DATA IS

**FHWA's Traveler Analysis Framework** publishes county-to-county person-trip
tables for long-distance travel, free, as plain CSV of
`origin FIPS, destination FIPS, annual person trips`. It is built from observed
travel rather than from counts, so a trip that starts in one county and ends in
another is a trip that passed through everything between them.

A county's through travel is then the sum of every flow whose two endpoints lie
outside it and whose path crosses it.

============================================== WHAT IT DOES AND DOES NOT SETTLE

Stated plainly, because each of these changes what the number means:

1. **Long distance only** — FHWA's threshold is 100 miles. Short crossings, the
   kind that dominate a small county inside a metro, are absent. So this is the
   through share OF LONG-DISTANCE TRAVEL, never of everything at a cordon.
2. **2008 base year.** Volumes have moved since; the share of a corridor's
   travel that is passing through is more stable than its volume, but this is
   not a current-year measurement.
3. **Straight lines, not routes.** A flow is counted as crossing when the line
   between the two county centroids crosses the study area. Real roads bend into
   counties this misses and around ones it wrongly includes.
4. **Person trips, not vehicles.** Converting needs an occupancy assumption,
   which this module deliberately does not make — it reports person trips and
   leaves the conversion to whoever states the assumption.
5. **FHWA labels it "beta-version" and asks that it be treated as a starting
   point.** Treat it as corroboration, not as ground truth.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path
from typing import Any, Iterable, Mapping

#: Where FHWA actually serves the files. The links printed on the landing page
#: point at highways.dot.gov/docs/, which answers 403 — a reader following the
#: documented URL gets an access-denied page rather than data.
TAF_BASE_URL = "https://www.fhwa.dot.gov/policyinformation/analysisframework/docs"
TAF_AUTO_TABLES = ("2008Autobiz", "2008Autononbiz")

#: FHWA's own definition of long distance for this product.
TAF_LONG_DISTANCE_MILES = 100


class ThroughTripsError(RuntimeError):
    """The estimate cannot be made, with the reason to show."""


def read_county_centroids(gazetteer_path: Path) -> dict[str, tuple[float, float]]:
    """County interior points from the Census Gazetteer, keyed by 5-digit GEOID.

    The Gazetteer's last column name carries trailing spaces, which silently
    yields a KeyError on every row if the header is not stripped.
    """
    centroids: dict[str, tuple[float, float]] = {}
    with Path(gazetteer_path).open(encoding="latin-1") as handle:
        reader = csv.DictReader(handle, delimiter="\t")
        reader.fieldnames = [name.strip() for name in (reader.fieldnames or [])]
        for row in reader:
            geoid = (row.get("GEOID") or "").strip()
            try:
                centroids[geoid] = (float((row["INTPTLONG"]).strip()), float((row["INTPTLAT"]).strip()))
            except (KeyError, ValueError, AttributeError):
                continue
    return centroids


def normalize_fips(value: str) -> str:
    """TAF writes county FIPS without leading zeros — 1001, not 01001.

    Left unpadded, every county in a state numbered below 10 fails to match and
    the run reports zero trips ending in the study area, which reads as a county
    nobody travels to.
    """
    return str(value).strip().zfill(5)


def through_and_local_trips(
    rows: Iterable[tuple[str, str, float]],
    study_fips: str,
    study_area,
    centroids: Mapping[str, tuple[float, float]],
    routes: Mapping[tuple[str, str], Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Split long-distance flows into those crossing the study area and those ending in it.

    `study_area` is a shapely geometry. A flow counts as through when neither
    endpoint is the study county AND the line between the endpoint centroids
    crosses it.
    """
    from shapely.geometry import LineString

    min_x, min_y, max_x, max_y = study_area.bounds
    through = ends_here = 0.0
    unknown_counties = 0
    unrouted_flows = 0
    for origin, destination, trips in rows:
        if trips <= 0:
            continue
        origin, destination = normalize_fips(origin), normalize_fips(destination)
        if origin == destination:
            continue
        if origin == study_fips or destination == study_fips:
            ends_here += trips
            continue
        start, end = centroids.get(origin), centroids.get(destination)
        if start is None or end is None:
            unknown_counties += 1
            continue
        if routes is None:
            if max(start[0], end[0]) < min_x or min(start[0], end[0]) > max_x:
                continue
            if max(start[1], end[1]) < min_y or min(start[1], end[1]) > max_y:
                continue
            path = LineString([start, end])
        else:
            route = routes.get((origin, destination))
            if route is None or route.get("status") != "routed":
                unrouted_flows += 1
                continue
            coordinates = route.get("coordinates") or []
            if len(coordinates) < 2:
                unrouted_flows += 1
                continue
            path = LineString(coordinates)
        if path.intersects(study_area):
            through += trips
    total = through + ends_here
    return {
        "county_fips": study_fips,
        "annual_person_trips_through": round(through, 1),
        "annual_person_trips_ending_here": round(ends_here, 1),
        "daily_person_trips_through": round(through / 365.0, 1),
        "daily_person_trips_ending_here": round(ends_here / 365.0, 1),
        "through_share_of_long_distance_travel": round(through / total, 4) if total else None,
        "flows_with_an_unknown_county": unknown_counties,
        "positive_external_flows_without_a_route": unrouted_flows,
        "path_method": "FHWA FAF5 free-flow shortest path" if routes is not None else "straight county-centroid line",
        "what_this_is_not": (
            f"The share of LONG-DISTANCE travel (FHWA's threshold is {TAF_LONG_DISTANCE_MILES} "
            "miles) that passes through, from 2008 person trips, with each flow's path "
            + (
                "routed on FHWA's strategic FAF5 highway network. "
                if routes is not None
                else "approximated by the straight line between county centroids. "
            )
            + "It is not the share of "
            "traffic at a boundary crossing, which also carries short trips this product does not "
            "cover."
        ),
    }


def read_route_cache(path: Path) -> dict[tuple[str, str], dict[str, Any]]:
    """Read the resumable JSONL emitted by ``faf5_routing.py``.

    Duplicate OD pairs are refused.  Quietly taking the last record could mix
    networks or partial reruns while still producing a plausible total.
    """
    routes: dict[tuple[str, str], dict[str, Any]] = {}
    fingerprints: set[str] = set()
    with Path(path).open() as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            record = json.loads(line)
            key = (normalize_fips(record["origin"]), normalize_fips(record["destination"]))
            if key in routes:
                raise ThroughTripsError(f"Duplicate routed OD pair at {path}:{line_number}: {key}")
            routes[key] = record
            if record.get("network_fingerprint"):
                fingerprints.add(str(record["network_fingerprint"]))
    if len(fingerprints) > 1:
        raise ThroughTripsError(f"Route cache mixes {len(fingerprints)} FAF5 network fingerprints")
    return routes


def read_taf_rows(csv_path: Path) -> Iterable[tuple[str, str, float]]:
    with Path(csv_path).open() as handle:
        for line in handle:
            parts = line.rstrip("\n").split(",")
            if len(parts) != 3:
                continue
            try:
                yield parts[0], parts[1], float(parts[2])
            except ValueError:
                continue


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--boundary", action="append", required=True, metavar="FIPS=PATH",
                        help="Study area, e.g. 06047=data/screening-runs/study-06047-base/boundary/analysis_boundary.geojson")
    parser.add_argument("--taf-csv", action="append", required=True, help="A TAF trip table CSV. Repeat for business and non-business.")
    parser.add_argument("--gazetteer", required=True, help="Census county Gazetteer .txt")
    parser.add_argument("--route-cache", help="JSONL from faf5_routing.py; missing routes are excluded and counted, never replaced by straight lines")
    parser.add_argument("--output")
    args = parser.parse_args()

    from shapely.geometry import shape

    centroids = read_county_centroids(Path(args.gazetteer))
    if not centroids:
        raise ThroughTripsError(f"No county centroids read from {args.gazetteer}")

    areas: dict[str, Any] = {}
    for pair in args.boundary:
        fips, _, path = pair.partition("=")
        payload = json.loads(Path(path).read_text())
        areas[fips] = shape(payload["features"][0]["geometry"])

    rows = [row for path in args.taf_csv for row in read_taf_rows(Path(path))]
    routes = read_route_cache(Path(args.route_cache)) if args.route_cache else None
    results = {
        fips: through_and_local_trips(rows, fips, area, centroids, routes) for fips, area in areas.items()
    }
    payload = {
        "schema_version": "openplan.through_trips_taf.v1",
        "source": "FHWA Traveler Analysis Framework, county-to-county long-distance person trips",
        "source_url": "https://www.fhwa.dot.gov/policyinformation/analysisframework/01.cfm",
        "path_method": "FHWA FAF5 free-flow shortest path" if routes is not None else "straight county-centroid line",
        "counties": results,
    }
    text = json.dumps(payload, indent=2)
    if args.output:
        Path(args.output).write_text(text + "\n")
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
