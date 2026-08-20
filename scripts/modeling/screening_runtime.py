#!/usr/bin/env python3
from __future__ import annotations

import csv
import hashlib
import json
import math
import os
import re
import shutil
import sqlite3
import string
import sys
import time
from datetime import datetime, timezone
import warnings
from importlib import metadata as importlib_metadata
from pathlib import Path
from typing import Any, Sequence

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
from shapely import wkt
from shapely.geometry import box, shape

from demand_package import expand_matrix_for_cordons, read_demand_package, read_zone_package
from screening_boundary import (
    download_if_needed,
    intersecting_state_fips,
    resolve_boundary,
    zip_uri,
)
from screening_bundle import build_run_summary, ensure_dir, slugify, write_boundary_artifact, write_bundle_outputs
from screening_metrics import (
    VMT_NETWORK_CIRCUITY,
    compute_internal_resident_vmt,
    compute_network_daily_vmt,
    haversine_miles,
)

ACS_5_URL = os.getenv("CENSUS_ACS5_URL", "https://api.census.gov/data/2022/acs/acs5")
CENSUS_API_KEY = os.getenv("CENSUS_API_KEY", "")
TIGER_TRACT_ZIP_TEMPLATE = "https://www2.census.gov/geo/tiger/TIGER2023/TRACT/tl_2023_{state_fips}_tract.zip"
TIGER_BLOCK_GROUP_ZIP_TEMPLATE = "https://www2.census.gov/geo/tiger/TIGER2023/BG/tl_2023_{state_fips}_bg.zip"

#: The published geographies OpenPlan can build zones from, and the TIGER layer
#: each one comes from. Block groups are roughly three times finer than tracts
#: and cost proportionally more runtime, which OpenPlan is willing to spend:
#: zone size IS the model's spatial resolution, and a trip inside one zone
#: carries VMT but no link volume at all.
ZONE_GEOGRAPHIES = {
    "tract": (TIGER_TRACT_ZIP_TEMPLATE, "tract"),
    "block_group": (TIGER_BLOCK_GROUP_ZIP_TEMPLATE, "bg"),
}
DEFAULT_ZONE_GEOGRAPHY = os.getenv("OPENPLAN_ZONE_GEOGRAPHY", "tract") or "tract"

DEFAULT_SPATIALITE_PATHS = [
    os.getenv("SPATIALITE_LIBRARY_PATH", ""),
    "/home/linuxbrew/.linuxbrew/lib/mod_spatialite.so",
    "/usr/lib/x86_64-linux-gnu/mod_spatialite.so",
]

LINK_DEFAULTS = {
    "motorway": (65, 2000, 2),
    "trunk": (55, 1800, 2),
    "primary": (45, 1200, 1),
    "secondary": (35, 900, 1),
    "tertiary": (30, 600, 1),
    "residential": (25, 400, 1),
    "unclassified": (25, 400, 1),
    "service": (15, 200, 1),
    "services": (15, 200, 1),
    "living_street": (15, 200, 1),
    "pedestrian": (5, 100, 1),
    "centroid_connector": (50, 99999, 1),
}

# OSM `maxspeed` units expressed as a multiplier into the runtime's internal mph (see _parse_speed).
# The empty key is the load-bearing one: https://wiki.openstreetmap.org/wiki/Key:maxspeed specifies
# km/h as the implicit unit, so an unqualified tag is metric even in an imperial-signing country.
KMH_TO_MPH = 1.0 / 1.609344
KNOTS_TO_MPH = 1.150779
SPEED_UNIT_TO_MPH = {
    "": KMH_TO_MPH,
    "kmh": KMH_TO_MPH,
    "km/h": KMH_TO_MPH,
    "kph": KMH_TO_MPH,
    "kmph": KMH_TO_MPH,
    "mph": 1.0,
    "knots": KNOTS_TO_MPH,
    "knot": KNOTS_TO_MPH,
}
# Whole-token match only: "50", "50 mph", "30 km/h" are speeds; "DE:zone30" and "maxspeed=walk" are
# not, and must not be mined for a digit that happens to sit inside a scheme name.
SPEED_TAG_RE = re.compile(r"^(?P<magnitude>\d+(?:\.\d+)?)\s*(?P<unit>[a-z/]*)$")

LINK_CLASS_PRIORITY = {
    "motorway": 8,
    "trunk": 7,
    "primary": 6,
    "secondary": 5,
    "tertiary": 4,
    "unclassified": 3,
    "residential": 2,
    "service": 1,
    "services": 1,
    "living_street": 0,
    "pedestrian": 0,
}

# The zone table's columns, in order, for `package/zone_attributes.csv`.
#
# `zone_kind` is the last one and is the load-bearing addition: a zone is either
# a PLACE ("internal" — a census tract with residents and jobs) or a CORDON
# POINT ("external" — where a highway crosses the study-area boundary). Several
# calculations must treat those differently, and every one of them used to infer
# the difference from a list of zone ids computed elsewhere. Naming the kind on
# the row is what stops a real tract from ever being mistaken for a gateway.
ZONE_ATTRIBUTE_COLUMNS = (
    "GEOID",
    "NAMELSAD",
    "zone_id",
    "centroid_lon",
    "centroid_lat",
    "area_sq_mi",
    "total_jobs",
    "retail_jobs",
    "health_jobs",
    "education_jobs",
    "accommodation_jobs",
    "govt_jobs",
    "est_population",
    "households",
    "worker_residents",
    "area_share",
    "zone_kind",
)
EXTERNAL_ZONE_COLUMNS = ZONE_ATTRIBUTE_COLUMNS

GATEWAY_DAILY_TRIPS = {
    "motorway": 15000,
    "trunk": 9000,
    "primary": 6000,
    "secondary": 3000,
    "tertiary": 1500,
}

#: Gravity deterrence exponents: trips decay as ``impedance ** -gamma``, so a
#: HIGHER gamma means shorter trips. OpenPlan's own screening defaults — not
#: drawn from a published trip-distribution manual, and never fitted.
HBW_GAMMA = 1.8
HBO_GAMMA = 1.5
NHB_GAMMA = 1.2

#: One multiplier over all three, so the RELATIVE ordering between purposes is
#: preserved while total trip length can be fitted.
#:
#: Measured 2026-08-17 across 24 counties: the model produces 2.16x the
#: published VMT per capita, and miles-per-trip correlates +0.93 with that
#: overshoot — so trip length is the defect and this is its lever. Overridable
#: so the fit can be MEASURED rather than argued about; 1.0 is the shipped
#: behaviour until a pre-registered experiment moves it
#: (docs/modeling/TRIP_LENGTH_CALIBRATION_2026-08-17.md).
# The worker owns the boundary-crossing rules. Imported rather than restated:
# this lane had no pass-through at all until 2026-08-18 while the worker had
# paired same-route cordons since it was written, and two lanes disagreeing
# about whether a vehicle can cross a county is not a difference anyone would
# spot in a number. Set up at module level so the import does not depend on
# whichever caller happens to have arranged sys.path.
_WORKER_DIR = Path(__file__).resolve().parents[2] / "workers" / "aequilibrae_worker"
if str(_WORKER_DIR) not in sys.path:
    sys.path.insert(0, str(_WORKER_DIR))

from gateway_counts import attach_passthrough_ceilings  # noqa: E402
from gateways import (  # noqa: E402
    GATEWAY_PASSTHROUGH_SHARE,
    build_external_gateway_matrix as worker_build_external_gateway_matrix,
)
from centroid_geometry import candidates_on_routable_component, insert_distinct_centroid  # noqa: E402

GAMMA_MULTIPLIER = float(os.getenv("OPENPLAN_GAMMA_MULTIPLIER", "1.0") or 1.0)

#: Seed each boundary crossing's traffic from a published count where one sits
#: on that road. Default OFF until the change is measured on the development
#: counties — the flat per-class figure it replaces is known to be wrong, but
#: "replace a guess with real data" is exactly the change that feels safe and
#: introduces a worse error, which is why `gateway_counts.py` is mostly
#: refusals. Flip the default in the commit that carries the measurement.
SEED_GATEWAYS_FROM_COUNTS = os.getenv("OPENPLAN_SEED_GATEWAYS_FROM_COUNTS", "0") in ("1", "true", "True")

#: Route a share of a two-crossing route's volume from one cordon to the other
#: rather than into the study area and back out. Default ON because the worker
#: lane — the one the app and the funder report read — has always done it, and
#: this lane never did. Off only to reproduce a pre-2026-08-18 measurement.
EXTERNAL_PASSTHROUGH = os.getenv("OPENPLAN_EXTERNAL_PASSTHROUGH", "1") not in ("0", "false", "False")

#: Bound each paired crossing's through-share from its route's own count profile
#: instead of applying one flat figure to every road. Default OFF: the bound is
#: a CEILING, and adopting a ceiling as an estimate assumes all the through
#: travel a road permits actually happens. Measured before any default changes.
PASSTHROUGH_FROM_COUNTS = os.getenv("OPENPLAN_PASSTHROUGH_FROM_COUNTS", "0") in ("1", "true", "True")
#: Average vehicle occupancy by trip purpose — persons carried per vehicle.
#:
#: PERSON TRIPS ARE NOT VEHICLE TRIPS. Three people sharing a car make three
#: person-trips and put ONE vehicle on the road. This lane generated person
#: trips (its own provenance says "trips per person per day") and assigned them
#: straight to the network as though each were a car, so every link carried
#: roughly 1.6 times too many vehicles.
#:
#: The ActivitySim lane has always divided by occupancy and says why in
#: `activitysim_demand_package.py`: "the comparison would report the demand
#: models disagreeing when what actually differed was the unit." The two lanes
#: were being compared in different units.
#:
#: Source: 2022 NHTS Summary of Travel Trends, Table 5-2 (average vehicle
#: occupancy by trip purpose, person-miles per vehicle-mile), with the non-work
#: figure weighted by that report's own Table 4-5 daily trip rates:
#:   shopping+errands  rate 0.80, occupancy 1.56 (mean of 1.53 and 1.60)
#:   social/recreation rate 0.67, occupancy 1.99
#:   school/church     rate 0.26, occupancy 1.52 (the report's all-purpose figure)
#:   => (0.80*1.56 + 0.67*1.99 + 0.26*1.52) / 1.73 = 1.72
#: 2022 is the most recent published year and its occupancies are LOWER than
#: 2017's (1.52 against 1.67 all-purpose), so using it applies the SMALLER
#: correction of the two.
VEHICLE_OCCUPANCY = {
    "hbw": 1.08,   # NHTS 2022 Table 5-2, "To/From Work"
    "hbo": 1.72,   # trip-rate-weighted non-work, derived above
    "nhb": 1.52,   # NHTS 2022 Table 5-2, "All"
}

#: Divide generated person trips by occupancy before assignment. Default ON:
#: assigning a person trip as a vehicle is a unit error, not a modelling choice.
#: Off only to reproduce a measurement taken before 2026-08-18.
CONVERT_PERSON_TRIPS_TO_VEHICLES = os.getenv(
    "OPENPLAN_PERSON_TRIPS_TO_VEHICLES", "1"
) not in ("0", "false", "False")

#: Remove walk and cycle trips before assigning. Default ON for the same reason
#: as the occupancy division: putting a pedestrian on a road link is a unit
#: error. Off only to reproduce a measurement taken before 2026-08-18.
SPLIT_NON_AUTO_MODES = os.getenv("OPENPLAN_SPLIT_NON_AUTO_MODES", "1") not in ("0", "false", "False")

HBO_PROD_RATE = 2.2
NHB_PROD_RATE = 0.9
HBO_ATTR_RETAIL_RATE = 12.0
HBO_ATTR_SERVICE_RATE = 5.0
HBO_ATTR_POP_RATE = 0.5
NHB_ATTR_EMP_RATE = 2.5
#: Metres per mile. The AequilibraE link and skim `distance` fields are metres.
METERS_PER_MILE = 1609.344

PEAK_HOUR_FACTOR = 0.10


def model_assumptions() -> dict[str, Any]:
    """The model's own defaults, and an honest statement of where they came from.

    WHY A RUN HAS TO CARRY THIS. A figure in a funding application can be
    questioned years later: "where does 2.2 trips per person per day come from?"
    Until now the answer was nowhere — these constants sit in this file with no
    source, no comment and no way for a planner to see them at all. The paper
    trail could say where the DATA came from and not where the ASSUMPTIONS came
    from, and the assumptions are doing most of the work.

    THE PROVENANCE STATEMENT IS DELIBERATELY UNFLATTERING. These are OpenPlan's
    own screening defaults. Saying they are "standard" or naming a manual they
    were not actually taken from would be a citation nobody could check and the
    exact kind of borrowed authority a reviewer is entitled to catch.
    """
    return {
        "provenance": (
            "These are OpenPlan's own screening defaults. They are not drawn from a published "
            "trip-rate manual, an adopted regional model, or a local household travel survey, and "
            "none of them was fitted to this study area unless this run also records a calibration. "
            "They are the reason its output is screening-grade rather than a forecast."
        ),
        "road_defaults_by_class": {
            road_class: {"free_flow_mph": speed, "capacity_veh_per_hour_per_lane": capacity, "lanes": lanes}
            for road_class, (speed, capacity, lanes) in LINK_DEFAULTS.items()
        },
        "boundary_crossing_daily_trips_by_class": dict(GATEWAY_DAILY_TRIPS),
        "trip_generation": {
            "home_based_other_trips_per_person_per_day": HBO_PROD_RATE,
            "non_home_based_trips_per_person_per_day": NHB_PROD_RATE,
            "home_based_work_production_floor_per_household": 0.35,
        },
        "trip_distribution_deterrence": {
            # The gammas AS APPLIED, so a run's own record says what shaped
            # its trip lengths rather than what the file's constants happen to
            # be when somebody reads it later.
            "home_based_work_gamma": HBW_GAMMA * GAMMA_MULTIPLIER,
            "home_based_other_gamma": HBO_GAMMA * GAMMA_MULTIPLIER,
            "non_home_based_gamma": NHB_GAMMA * GAMMA_MULTIPLIER,
            "gamma_multiplier": GAMMA_MULTIPLIER,
        },
        "other": {
            "network_circuity_factor": VMT_NETWORK_CIRCUITY,
            "peak_hour_factor": PEAK_HOUR_FACTOR,
            # How far a zone's demand will travel to enter the network on a
            # bigger road. It decides whether trips are injected onto the
            # nearest arterial or the nearest road of any kind, which shows up
            # directly in which roads the assignment over-loads.
            "connector_class_weight_m": CONNECTOR_CLASS_WEIGHT_M,
        },
    }


def find_spatialite_path() -> str:
    for candidate in DEFAULT_SPATIALITE_PATHS:
        if candidate and os.path.exists(candidate):
            return candidate
    raise RuntimeError("Could not locate mod_spatialite shared library")


def connect_spatialite(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path)
    conn.enable_load_extension(True)
    conn.load_extension(find_spatialite_path())
    return conn


def buffered_bbox(bounds: tuple[float, float, float, float], miles: float) -> tuple[float, float, float, float]:
    min_lon, min_lat, max_lon, max_lat = bounds
    mid_lat = (min_lat + max_lat) / 2.0
    lat_pad = miles / 69.0
    lon_pad = miles / max(69.0 * math.cos(math.radians(mid_lat)), 10.0)
    return (min_lon - lon_pad, min_lat - lat_pad, max_lon + lon_pad, max_lat + lat_pad)


class ConfigurationError(RuntimeError):
    """
    Something about how this install is SET UP, not something that went wrong mid-run.

    Separated so the CLI can print it as a sentence and exit, instead of burying it
    under a traceback the reader has to scroll past. Deliberately narrow: only errors
    this file authors are raised as one, so a genuine crash still prints in full rather
    than being reduced to a friendly line that hides it.
    """


CENSUS_KEY_SIGNUP_URL = "https://api.census.gov/data/key_signup.html"

CENSUS_KEY_MISSING_MESSAGE = (
    "OpenPlan needs a Census API key to build a model.\n"
    "\n"
    "Every travel model starts from the population, households and workers living in\n"
    "each area, and that comes from the US Census Bureau's ACS. The Census Bureau now\n"
    "refuses requests that do not carry a key.\n"
    "\n"
    "A key is free and arrives by email in a minute or two:\n"
    f"  {CENSUS_KEY_SIGNUP_URL}\n"
    "\n"
    "Then set CENSUS_API_KEY in openplan/.env.local (or in the environment of whatever\n"
    "runs the modelling worker) and start the run again."
)


def census_key_failure(response: "requests.Response | None", body: str) -> str | None:
    """
    Whether the Census Bureau refused this for want of a usable key, and how to say so.

    WHY THIS IS NOT `raise_for_status()`. A keyless request is not answered with an
    error status. The API 302-redirects to `missing_key.html` and serves that page
    with **HTTP 200**, so `raise_for_status()` passes, `response.json()` is handed a
    page of HTML, and the run dies with `JSONDecodeError: Expecting value: line 1
    column 1` — after minutes of boundary downloads, naming neither the cause nor the
    remedy. Measured against the live API on 2026-08-15, including the smallest
    possible query: keyless access is refused outright, not merely rate-limited.

    The code this replaced was written when a key was optional (`if CENSUS_API_KEY`),
    which was true of the Census API once and is true nowhere now.

    Returns the sentence to raise, or None when the answer looks like real data.
    """
    if response is not None and "missing_key" in response.url:
        return CENSUS_KEY_MISSING_MESSAGE
    stripped = body.lstrip()
    if stripped.startswith("<"):
        # HTML where JSON was promised. An invalid or unactivated key lands here too,
        # so the message names both rather than guessing which one it is.
        #
        # WHO DID WHAT MATTERS. An earlier draft read "because OpenPlan rejected the
        # key it was given", which says the opposite of what happened and would send
        # somebody looking for a bug in OpenPlan. The Census Bureau refused; OpenPlan
        # is reporting the refusal.
        detail = (
            "OpenPlan did not send a key"
            if not CENSUS_API_KEY
            else "it did not accept the key OpenPlan sent"
        )
        return (
            f"The Census Bureau answered with a web page instead of data: {detail}.\n"
            "\n"
            "If CENSUS_API_KEY is unset, get a free one and set it:\n"
            f"  {CENSUS_KEY_SIGNUP_URL}\n"
            "If it is set, check that the activation link in the sign-up email was clicked,\n"
            "and that the key was copied whole.\n"
            "\n"
            f"Asked: {ACS_5_URL}"
        )
    return None


def preflight_census_access() -> None:
    """
    Ask the Census API one tiny question before the run does any real work.

    WHY IT IS A SEPARATE CALL. The ACS fetch happens inside the zone stage, behind the
    boundary downloads — on a cold cache that is over two minutes of work before the
    first thing that can fail on a misconfiguration every fresh install has. This
    costs one request and moves that discovery to the first second.
    """
    if not CENSUS_API_KEY:
        raise ConfigurationError(CENSUS_KEY_MISSING_MESSAGE)
    try:
        response = requests.get(
            ACS_5_URL, params={"get": "NAME", "for": "state:06", "key": CENSUS_API_KEY}, timeout=30
        )
    except requests.RequestException as exc:
        # Not a key problem. Say what actually happened rather than blaming the key —
        # a wrong cause is worse than no cause.
        raise ConfigurationError(f"Could not reach the Census API to check the key: {exc}") from exc
    failure = census_key_failure(response, response.text)
    if failure:
        raise ConfigurationError(failure)


def fetch_acs_tract_attributes(
    county_pairs: set[tuple[str, str]], zone_geography: str = "tract"
) -> pd.DataFrame:
    """Population, households and workers for every zone, at the chosen geography.

    Block groups are queried the same way tracts are, with the county's tracts
    wildcarded — the ACS publishes all three of these cells at block-group
    level, unlike the workers-per-household table the population synthesiser
    has to drop there.
    """
    is_block_group = zone_geography == "block_group"
    rows: list[pd.DataFrame] = []
    for state_fips, county_fips in sorted(county_pairs):
        params = {
            "get": "NAME,B01003_001E,B11001_001E,B23025_004E",
            "for": "block group:*" if is_block_group else "tract:*",
            "in": (
                f"state:{state_fips} county:{county_fips} tract:*"
                if is_block_group
                else f"state:{state_fips} county:{county_fips}"
            ),
        }
        if CENSUS_API_KEY:
            params["key"] = CENSUS_API_KEY
        response = requests.get(ACS_5_URL, params=params, timeout=60)
        response.raise_for_status()
        failure = census_key_failure(response, response.text)
        if failure:
            raise ConfigurationError(failure)
        data = response.json()
        if len(data) < 2:
            continue
        header = data[0]
        df = pd.DataFrame(data[1:], columns=header)
        for col in ["B01003_001E", "B11001_001E", "B23025_004E"]:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
        # A block-group GEOID is the tract's plus the group digit, which is how
        # every other part of this lane recognises the geography (11 digits vs
        # 12) rather than being told.
        df["geoid"] = df["state"] + df["county"] + df["tract"] + (
            df["block group"] if is_block_group else ""
        )
        df["est_population"] = df["B01003_001E"].astype(float)
        df["households"] = df["B11001_001E"].astype(float)
        df["worker_residents"] = df["B23025_004E"].astype(float)
        rows.append(df[["geoid", "NAME", "est_population", "households", "worker_residents"]])
    if not rows:
        raise RuntimeError("No ACS tract attributes were returned for intersecting counties")
    return pd.concat(rows, ignore_index=True).drop_duplicates(subset=["geoid"])


def estimate_jobs(df: pd.DataFrame) -> pd.DataFrame:
    jobs_seed = np.maximum(df["worker_residents"].to_numpy() * 0.9, df["est_population"].to_numpy() * 0.47)
    total_jobs = np.maximum(np.round(jobs_seed), 25).astype(int)
    df["total_jobs"] = total_jobs
    df["retail_jobs"] = np.round(total_jobs * 0.15).astype(int)
    df["health_jobs"] = np.round(total_jobs * 0.09).astype(int)
    df["education_jobs"] = np.round(total_jobs * 0.10).astype(int)
    df["accommodation_jobs"] = np.round(total_jobs * 0.04).astype(int)
    df["govt_jobs"] = np.round(total_jobs * 0.07).astype(int)
    return df


def build_zone_package(
    boundary_geom, package_dir: Path, cache_dir: Path, zone_geography: str = DEFAULT_ZONE_GEOGRAPHY
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """The study area's zones, at tract or block-group resolution.

    Zone size is the model's spatial resolution: a trip between two points in
    one zone carries VMT and no link volume, so a coarse zone system cannot
    place local traffic on local roads at all. Block groups are roughly three
    times finer and cost proportionally more runtime — which OpenPlan spends,
    because a defensible number matters more than a fast one.
    """
    if zone_geography not in ZONE_GEOGRAPHIES:
        raise ConfigurationError(
            f"Unknown zone geography {zone_geography!r}; OpenPlan builds zones from "
            f"{sorted(ZONE_GEOGRAPHIES)}."
        )
    ensure_dir(package_dir)
    states = intersecting_state_fips(boundary_geom, cache_dir)
    template, layer_tag = ZONE_GEOGRAPHIES[zone_geography]

    tract_frames = []
    for state_fips in states:
        zip_path = download_if_needed(
            template.format(state_fips=state_fips),
            cache_dir / "tiger" / f"tl_2023_{state_fips}_{layer_tag}.zip",
        )
        gdf = gpd.read_file(zip_uri(zip_path))
        tract_frames.append(gdf.copy())

    tracts = pd.concat(tract_frames, ignore_index=True)
    tract_gdf = gpd.GeoDataFrame(tracts, geometry="geometry", crs="EPSG:4269").to_crs(4326)
    tract_gdf = tract_gdf[tract_gdf.geometry.intersects(boundary_geom)].copy()
    if tract_gdf.empty:
        raise RuntimeError("Boundary does not intersect any Census tracts")

    boundary_series = gpd.GeoSeries([boundary_geom], crs="EPSG:4326")
    boundary_geom_4326 = boundary_series.iloc[0]
    tract_gdf["orig_geometry"] = tract_gdf.geometry
    tract_gdf["geometry"] = tract_gdf.geometry.intersection(boundary_geom_4326)
    tract_gdf = tract_gdf[~tract_gdf.geometry.is_empty].copy()

    if tract_gdf.empty:
        raise RuntimeError("No tract fragments remained after clipping to boundary")

    original_proj = gpd.GeoSeries(tract_gdf["orig_geometry"], crs="EPSG:4326").to_crs(6933)
    clipped_proj = gpd.GeoSeries(tract_gdf.geometry, crs="EPSG:4326").to_crs(6933)
    tract_gdf["orig_area_sq_mi"] = original_proj.area / 2_589_988.110336
    tract_gdf["area_sq_mi"] = clipped_proj.area / 2_589_988.110336
    tract_gdf["area_share"] = np.where(
        tract_gdf["orig_area_sq_mi"] > 0,
        tract_gdf["area_sq_mi"] / tract_gdf["orig_area_sq_mi"],
        0,
    )
    tract_gdf = tract_gdf[(tract_gdf["area_sq_mi"] >= 0.01) | (tract_gdf.geometry.representative_point().within(boundary_geom))].copy()
    if tract_gdf.empty:
        raise RuntimeError("All clipped tract fragments were tiny slivers; no usable zones remain")

    acs = fetch_acs_tract_attributes(
        {(g[:2], g[2:5]) for g in tract_gdf["GEOID"].tolist()}, zone_geography
    )
    tract_gdf = tract_gdf.merge(acs, left_on="GEOID", right_on="geoid", how="left")
    for col in ["est_population", "households", "worker_residents"]:
        tract_gdf[col] = tract_gdf[col].fillna(0).astype(float) * tract_gdf["area_share"].clip(lower=0, upper=1)

    name_fallback = None
    for candidate in ["NAME_y", "NAME", "NAME_x"]:
        if candidate in tract_gdf.columns:
            name_fallback = tract_gdf[candidate]
            break
    if name_fallback is None:
        name_fallback = tract_gdf["GEOID"]
    tract_gdf["NAMELSAD"] = tract_gdf["NAMELSAD"].fillna(name_fallback).fillna(tract_gdf["GEOID"])
    tract_gdf["centroid"] = tract_gdf.geometry.representative_point()
    tract_gdf["centroid_lon"] = tract_gdf["centroid"].x
    tract_gdf["centroid_lat"] = tract_gdf["centroid"].y
    # GEOID last and always present: a block-group layer carries BLKGRPCE that a
    # tract layer does not, so sorting on a column that may not exist would work
    # for one geography and fail for the other.
    sort_columns = [c for c in ("STATEFP", "COUNTYFP", "TRACTCE", "BLKGRPCE") if c in tract_gdf.columns]
    tract_gdf = tract_gdf.sort_values([*sort_columns, "GEOID"]).reset_index(drop=True)
    tract_gdf["zone_id"] = np.arange(1, len(tract_gdf) + 1)
    tract_gdf = estimate_jobs(tract_gdf)

    zone_cols = list(ZONE_ATTRIBUTE_COLUMNS)
    tract_gdf["zone_kind"] = "internal"
    zones_df = tract_gdf[zone_cols].copy()
    zones_df.to_csv(package_dir / "zone_attributes.csv", index=False)

    # zones.geojson is POLYGONS, and only internal zones have an area — an
    # external zone is a point on the cordon. It is therefore written once,
    # here, and deliberately not rewritten when external zones are added:
    # a mapping surface asking "which tract is this?" wants tracts. The row
    # counts differ on purpose, and `package_manifest.json` records both.
    zones_export = tract_gdf[zone_cols + ["geometry"]].copy()
    zones_export = gpd.GeoDataFrame(zones_export, geometry="geometry", crs="EPSG:4326")
    zones_export.to_file(package_dir / "zones.geojson", driver="GeoJSON")

    centroids_export = gpd.GeoDataFrame(
        tract_gdf[["GEOID", "NAMELSAD", "zone_id"]].copy(),
        geometry=gpd.GeoSeries(tract_gdf["centroid"], crs="EPSG:4326"),
        crs="EPSG:4326",
    )
    centroids_export.to_file(package_dir / "zone_centroids.geojson", driver="GeoJSON")

    manifest = {
        "zones": int(len(zones_df)),
        "tract_states": states,
        "zone_type": "census-tract-fragments",
        "total_population": float(zones_df["est_population"].sum()),
        "total_households": float(zones_df["households"].sum()),
        "total_worker_residents": float(zones_df["worker_residents"].sum()),
        "total_jobs_est": float(zones_df["total_jobs"].sum()),
        "files": {
            "zone_attributes": "package/zone_attributes.csv",
            "zones_geojson": "package/zones.geojson",
            "zone_centroids_geojson": "package/zone_centroids.geojson",
        },
    }
    (package_dir / "package_manifest.json").write_text(json.dumps(manifest, indent=2))
    return zones_df, manifest


def write_zone_package_files(zones_df: pd.DataFrame, package_dir: Path, zone_meta: dict[str, Any]) -> dict[str, Any]:
    """Re-publish the zone table once the network stage has added cordon zones.

    `build_zone_package` writes these files before the network exists, so it can
    only know about tracts. External zones are created later, and everything
    downstream — the ActivitySim bundle, the OD matrix's own column headings,
    anyone reading the run off disk — has to see the SAME zone system the
    connectors and skims were built for. A zone table that disagrees with the
    matrix beside it is the kind of mismatch nothing detects and everything
    misreads.

    `zones.geojson` is not rewritten: see the note where it is created.
    """
    zones_df.to_csv(package_dir / "zone_attributes.csv", index=False)

    centroids_export = gpd.GeoDataFrame(
        zones_df[["GEOID", "NAMELSAD", "zone_id", "zone_kind"]].copy(),
        geometry=gpd.points_from_xy(zones_df["centroid_lon"], zones_df["centroid_lat"]),
        crs="EPSG:4326",
    )
    centroids_export.to_file(package_dir / "zone_centroids.geojson", driver="GeoJSON")

    zone_meta = dict(zone_meta)
    # `zones` STAYS THE COUNT OF PLACES, and this is not bookkeeping. It becomes
    # `zone_count` in the run summary, which the app turns into a sentence a
    # planner reads: "N% of trips begin and end in the same zone across 26
    # zones". That sentence is about how finely the study area is divided into
    # PLACES; counting cordon points in it would inflate the number and quietly
    # weaken a caveat about the model's resolution. The cordon count is reported
    # beside it, named for what it is.
    zone_meta["zones"] = int((zones_df["zone_kind"] == "internal").sum())
    zone_meta["internal_zones"] = int((zones_df["zone_kind"] == "internal").sum())
    zone_meta["external_zones"] = int((zones_df["zone_kind"] == "external").sum())
    zone_meta["zones_including_external_cordons"] = int(len(zones_df))
    # Built FROM whatever the zone system already said it was, never asserted.
    # A run fed a supplied demand package did not build tract fragments, and a
    # manifest claiming it did would be a provenance lie in the one field a
    # reader consults to find out which model produced the numbers.
    base_zone_type = str(zone_meta.get("zone_type") or "census-tract-fragments")
    zone_meta["zone_type"] = (
        f"{base_zone_type}-plus-external-cordons" if zone_meta["external_zones"] else base_zone_type
    )
    zone_meta["zones_geojson_covers"] = "internal zones only (external zones are cordon points, not areas)"
    (package_dir / "package_manifest.json").write_text(json.dumps(zone_meta, indent=2))
    return zone_meta


def patch_osm_builder() -> None:
    from aequilibrae.project.network.osm.osm_builder import OSMBuilder

    def _patched_define_link_type(self, link_type: str):
        proj_link_types = self.project.network.link_types
        original = link_type
        link_type = "".join([x for x in link_type if x in string.ascii_letters + "_"]).lower()
        split = link_type.split("_")
        for i, piece in enumerate(split[1:]):
            if piece in ["link", "segment", "stretch"]:
                link_type = "_".join(split[: i + 1])
        if self._OSMBuilder__all_ltp.shape[0] >= 51:
            link_type = "aggregate_link_type"
        if len(link_type) == 0:
            link_type = "empty"
        if link_type in self._OSMBuilder__all_ltp.link_type.values:
            lt = proj_link_types.get_by_name(link_type)
            if lt is not None:
                if original not in lt.description:
                    lt.description += f", {original}"
                    lt.save()
                return [lt.link_type_id, link_type]
        letter = link_type[0]
        if letter in self._OSMBuilder__all_ltp.link_type_id.values:
            letter = letter.upper()
            if letter in self._OSMBuilder__all_ltp.link_type_id.values:
                for next_letter in string.ascii_letters:
                    if next_letter not in self._OSMBuilder__all_ltp.link_type_id.values:
                        letter = next_letter
                        break
        try:
            lt = proj_link_types.new(letter)
            lt.link_type = link_type
            lt.description = f"OSM: {original}"
            lt.save()
        except Exception:
            lt = proj_link_types.get(letter)
            if lt is not None:
                lt.link_type = link_type
                lt.description = f"OSM: {original}"
                lt.save()
        return [letter, link_type]

    OSMBuilder._OSMBuilder__define_link_type = _patched_define_link_type


def _parse_speed(value: Any) -> int | None:
    """Normalise a raw OSM ``maxspeed`` tag to the runtime's internal miles per hour.

    Speed convention: this runtime carries speeds in mph everywhere downstream — LINK_DEFAULTS,
    the ``links.speed_ab``/``speed_ba`` columns once ``build_network`` has normalised them, and the
    ``speed * 1609.34 / 60`` metres-per-minute travel-time formula. OSM is the opposite: ``maxspeed``
    defaults to km/h and only marks imperial explicitly ("55 mph"), so a bare "80" means 80 km/h,
    not 80 mph. Consuming the tag verbatim over-states such a link by ~1.6x, which propagates through
    assignment into VMT — hence the conversion here rather than at the (mph-only) call sites.

    Tags we cannot interpret ("walk", "none", "DE:urban", "signals") return None so the caller falls
    back to a documented link-type default instead of to a number invented from stray digits.
    """
    if value is None:
        return None
    # SQLite's NUMERIC column affinity silently coerces a bare tag like "80" into a number on its way
    # into links.speed_ab, so an int/float here is still an unconverted OSM value, not an mph one.
    text = str(value).strip().lower()
    # Lane- or conditionally-qualified tags ("50|30", "60; 40"): the first segment governs the link.
    head = re.split(r"[|;,]", text)[0].strip()
    match = SPEED_TAG_RE.match(head)
    if match is None:
        return None
    to_mph = SPEED_UNIT_TO_MPH.get(match.group("unit"))
    if to_mph is None:
        return None
    mph = int(round(float(match.group("magnitude")) * to_mph))
    return mph if mph > 0 else None


def extract_missing_centroids_from_warnings(caught_warnings: list[warnings.WarningMessage]) -> list[int]:
    missing: set[int] = set()
    for caught in caught_warnings:
        message = str(caught.message)
        if "Found centroids not present in the graph" not in message:
            continue
        for block in re.findall(r"\[([^\]]+)\]", message, flags=re.MULTILINE):
            for token in re.split(r"[\s,]+", block.strip()):
                if token.isdigit():
                    missing.add(int(token))
    return sorted(missing)


#: How many metres of extra walk-equivalent distance one road-class step is
#: worth when choosing where a zone's centroid connector attaches.
#:
#: MEASURED CONSEQUENCE, 2026-08-17. At the shipped 250 a motorway node beats a
#: residential one 1,500 m farther away, and trunk beats tertiary by 750 m, so a
#: zone's whole demand is injected directly onto the biggest road nearby and
#: never traverses the local network. Across 24 counties with published counts
#: the assignment over-loads exactly those roads and starves the small ones:
#: trunk 3.39x observed, primary 2.32x, secondary 2.10x, tertiary 0.01x.
#:
#: Overridable so the effect can be MEASURED rather than argued about; the
#: default is the shipped behaviour until an experiment justifies moving it.
#: 0 makes connector choice purely nearest-node.
CONNECTOR_CLASS_WEIGHT_M = float(os.getenv("OPENPLAN_CONNECTOR_CLASS_WEIGHT_M", "250") or 250)


def rank_connector_candidate(conn: sqlite3.Connection, node_id: int, d2: float) -> tuple[float, float, float, float]:
    rows = conn.execute(
        "SELECT DISTINCT COALESCE(link_type, '') FROM links WHERE a_node=? OR b_node=?",
        (node_id, node_id),
    ).fetchall()
    best_priority = max((LINK_CLASS_PRIORITY.get(str(link_type or '').strip().lower(), -1) for (link_type,) in rows), default=-1)
    distance_m = max((float(d2) ** 0.5) * 111000, 10)
    # Conservative scoring: a one-class road upgrade is only worth a few hundred meters,
    # so very close local collectors can still beat farther arterials.
    score = best_priority * CONNECTOR_CLASS_WEIGHT_M - distance_m
    return (score, float(best_priority), -distance_m, -float(node_id))


#: How many nearby network nodes a zone's connectors are chosen from. Widened
#: from 50 once the connectors were measured and found to be clustered: in a
#: dense block group the 50 nearest nodes can all lie on one street, so no
#: amount of care in choosing between them can spread the zone's load.
CONNECTOR_CANDIDATE_POOL = 200

#: A zone's connectors must be at least this fraction of its own equivalent
#: radius apart. Scaled to the zone rather than fixed, because zones differ by
#: three orders of magnitude in area — a separation sensible for a city block
#: group is meaningless for a 513-square-mile rural tract.
CONNECTOR_SEPARATION_RADIUS_FRACTION = 0.5

SQ_METRES_PER_SQ_MILE = 2_589_988.0


#: Equilibrium assignment settings, measured rather than chosen for runtime.
#:
#: On 2026-08-16 two assignments whose demand differed only by whole-trip
#: rounding reached a relative gap near 0.009 and still moved 21% of busy links
#: by more than 10%. At 0.00046, no busy link crossed GEH 10. Ordinary runs
#: publish those same link volumes, so the tight setting applies to every run,
#: not only to a run that happens to be compared later.
#:
#: An operator may spend more compute on a tighter target or a higher ceiling.
#: Loosening either one would knowingly restore the measured link instability,
#: so invalid or looser environment values fail at import instead of quietly
#: changing the method.
ASSIGNMENT_PROFILE_SCHEMA_VERSION = "openplan.assignment-profile.v1"
ASSIGNMENT_PROFILE_ID = "aequilibrae-bfw-bpr-tight-v1"
ASSIGNMENT_ENGINE = "aequilibrae"
DEFENSIBLE_ASSIGNMENT_RGAP_TARGET = 0.0005
DEFENSIBLE_ASSIGNMENT_MAX_ITERATIONS = 3000


def installed_assignment_engine_version() -> str | None:
    try:
        version = importlib_metadata.version(ASSIGNMENT_ENGINE).strip()
    except importlib_metadata.PackageNotFoundError:
        return None
    return version or None


def require_local_assignment_engine(profile: dict[str, Any]) -> None:
    local_version = installed_assignment_engine_version()
    if local_version is None:
        raise RuntimeError(
            "Cannot construct an assignment because the installed AequilibraE version is unknown"
        )
    if (
        profile.get("engine") != ASSIGNMENT_ENGINE
        or profile.get("engine_version") != local_version
    ):
        raise RuntimeError(
            "Refusing assignment profile for "
            f"{profile.get('engine')} {profile.get('engine_version')}; this runtime has "
            f"{ASSIGNMENT_ENGINE} {local_version}"
        )


def require_effective_assignment_cores(assignment: Any, requested_cores: int) -> None:
    effective_cores = getattr(assignment, "cores", None)
    if effective_cores != requested_cores:
        raise RuntimeError(
            "AequilibraE did not retain the requested core count: "
            f"requested {requested_cores}, effective {effective_cores!r}"
        )


def _assignment_target_from_env() -> float:
    raw = (os.getenv("OPENPLAN_ASSIGNMENT_RGAP_TARGET") or "").strip()
    if not raw:
        return DEFENSIBLE_ASSIGNMENT_RGAP_TARGET
    try:
        value = float(raw)
    except ValueError as error:
        raise ValueError("OPENPLAN_ASSIGNMENT_RGAP_TARGET must be a number") from error
    if not math.isfinite(value) or value <= 0:
        raise ValueError("OPENPLAN_ASSIGNMENT_RGAP_TARGET must be finite and greater than zero")
    if value > DEFENSIBLE_ASSIGNMENT_RGAP_TARGET:
        raise ValueError(
            f"Refusing OPENPLAN_ASSIGNMENT_RGAP_TARGET={value}: assignments may tighten the "
            f"measured {DEFENSIBLE_ASSIGNMENT_RGAP_TARGET} target, not loosen it"
        )
    return value


def _assignment_ceiling_from_env() -> int:
    raw = (os.getenv("OPENPLAN_ASSIGNMENT_MAX_ITERATIONS") or "").strip()
    if not raw:
        return DEFENSIBLE_ASSIGNMENT_MAX_ITERATIONS
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError("OPENPLAN_ASSIGNMENT_MAX_ITERATIONS must be an integer") from error
    if value < DEFENSIBLE_ASSIGNMENT_MAX_ITERATIONS:
        raise ValueError(
            f"Refusing OPENPLAN_ASSIGNMENT_MAX_ITERATIONS={value}: assignments may raise the "
            f"measured {DEFENSIBLE_ASSIGNMENT_MAX_ITERATIONS}-iteration ceiling, not lower it"
        )
    return value


def _assignment_cores_from_env() -> int:
    raw = (os.getenv("AEQ_CORES") or "").strip()
    if not raw:
        return 1
    try:
        value = int(raw)
    except ValueError as error:
        raise ValueError("AEQ_CORES must be an integer") from error
    if value < 1:
        raise ValueError("AEQ_CORES must be at least one")
    return value


ASSIGNMENT_RGAP_TARGET = _assignment_target_from_env()
ASSIGNMENT_MAX_ITERATIONS = _assignment_ceiling_from_env()
ASSIGNMENT_CORES = _assignment_cores_from_env()


def assignment_profile(
    *,
    capacity_field: str = "capacity",
    time_field: str = "travel_time",
    max_iterations: int = ASSIGNMENT_MAX_ITERATIONS,
) -> dict[str, Any]:
    """The complete CLI assignment method, with its actual graph field names."""
    if isinstance(max_iterations, bool) or not isinstance(max_iterations, int):
        raise ValueError("Assignment max_iterations must be an integer")
    if max_iterations < DEFENSIBLE_ASSIGNMENT_MAX_ITERATIONS:
        raise ValueError("Assignment max_iterations lowers the measured ceiling")
    if not isinstance(capacity_field, str) or not capacity_field:
        raise ValueError("Assignment capacity field must be named")
    if not isinstance(time_field, str) or not time_field:
        raise ValueError("Assignment time field must be named")
    engine_version = installed_assignment_engine_version()
    if engine_version is None:
        raise RuntimeError(
            "Cannot resolve an assignment profile because the installed AequilibraE version is unknown"
        )
    return {
        "schema_version": ASSIGNMENT_PROFILE_SCHEMA_VERSION,
        "profile_id": ASSIGNMENT_PROFILE_ID,
        "engine": ASSIGNMENT_ENGINE,
        "engine_version": engine_version,
        "algorithm": "bfw",
        "vdf": "BPR",
        "vdf_parameters": {"alpha": 0.15, "beta": 4},
        "capacity_field": str(capacity_field),
        "time_field": str(time_field),
        "class_pce": 1,
        "cores": ASSIGNMENT_CORES,
        "target_gap": ASSIGNMENT_RGAP_TARGET,
        "max_iterations": max_iterations,
    }


def assignment_profile_payload_json(profile: dict[str, Any]) -> str:
    return json.dumps(
        profile,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def assignment_profile_digest(
    profile: dict[str, Any], payload_json: str | None = None
) -> str:
    expected_payload = assignment_profile_payload_json(profile)
    payload = expected_payload if payload_json is None else payload_json
    if payload != expected_payload:
        raise ValueError("Assignment-profile payload is not canonical")
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def assignment_iteration_count(assignment_state: Any) -> int | None:
    """Read AequilibraE's actual counter, preferring the current `.iter` name."""
    for attribute in ("iter", "iteration"):
        value = getattr(assignment_state, attribute, None)
        if isinstance(value, bool) or value is None:
            continue
        try:
            count = int(value)
        except (TypeError, ValueError, OverflowError):
            continue
        if count >= 0:
            return count
    return None


def assignment_network_settings(
    road_class_factors: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Build the versioned network-settings identity used by both model lanes."""
    factors: dict[str, float] = {}
    for road_class, raw_factor in (road_class_factors or {}).items():
        if isinstance(raw_factor, bool):
            raise ValueError("Network calibration factors cannot be boolean")
        try:
            factor = float(raw_factor)
        except (TypeError, ValueError, OverflowError) as error:
            raise ValueError("Network calibration factors must be numeric") from error
        if (
            not isinstance(road_class, str)
            or not road_class
            or not math.isfinite(factor)
            or factor <= 0
        ):
            raise ValueError("Network calibration factors must be named, finite, and positive")
        factors[road_class] = factor
    return {
        "schema_version": "openplan.network-calibration.v1",
        "road_class_factors": dict(sorted(factors.items())),
        "application": {
            "travel_time": "baseline_travel_time / factor",
            "capacity": "baseline_capacity * factor",
        },
        "excludes": ["trip_based_od_adjustments"],
    }


def network_settings_payload_json(settings: dict[str, Any]) -> str:
    canonical = assignment_network_settings(settings.get("road_class_factors"))
    if settings != canonical:
        raise ValueError("Network settings do not match the v1 schema")
    return json.dumps(
        settings,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def network_settings_digest(
    settings: dict[str, Any], payload_json: str | None = None
) -> str:
    expected_payload = network_settings_payload_json(settings)
    payload = expected_payload if payload_json is None else payload_json
    if payload != expected_payload:
        raise ValueError("Network-settings payload is not canonical")
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _compact_json(value: Any) -> str:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def _payload_digest(value: Any) -> str:
    return hashlib.sha256(_compact_json(value).encode("utf-8")).hexdigest()


def _strict_integer(value: Any, context: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, np.integer)):
        raise RuntimeError(f"{context} contains a noninteger identifier")
    return int(value)


def retained_network_manifest(project_dir: Path) -> dict[str, Any]:
    connection = sqlite3.connect(project_dir / "project_database.sqlite")
    try:
        rows = connection.execute(
            "SELECT link_id, COALESCE(link_type, '') FROM links"
        ).fetchall()
    finally:
        connection.close()
    roles: dict[int, str] = {}
    for raw_link_id, raw_link_type in rows:
        link_id = _strict_integer(raw_link_id, "Retained network")
        if link_id in roles:
            raise RuntimeError(f"Retained network contains duplicate link id {link_id}")
        roles[link_id] = (
            "modeling_connector"
            if str(raw_link_type or "").strip().lower() == "centroid_connector"
            else "roadway"
        )
    all_ids = sorted(roles)
    roadway_ids = sorted(link_id for link_id, role in roles.items() if role == "roadway")
    connector_ids = sorted(
        link_id for link_id, role in roles.items() if role == "modeling_connector"
    )
    if not all_ids or not roadway_ids:
        raise RuntimeError("Retained network must contain at least one link and roadway link")
    return {
        "schema_version": "openplan.retained-network-manifest.v1",
        "all_link_count": len(all_ids),
        "all_link_ids_digest": _payload_digest(all_ids),
        "roadway_link_count": len(roadway_ids),
        "roadway_link_ids_digest": _payload_digest(roadway_ids),
        "modeling_connector_link_count": len(connector_ids),
        "modeling_connector_link_ids_digest": _payload_digest(connector_ids),
        "excluded_roles": ["modeling_connector"],
        "role_definition": {
            "roadway": "link_type != centroid_connector",
            "modeling_connector": "link_type = centroid_connector",
        },
    }


def _finite_float_hex(value: Any, context: str) -> str:
    if isinstance(value, bool):
        raise RuntimeError(f"{context} contains a boolean where a float belongs")
    try:
        number = float(value)
    except (TypeError, ValueError, OverflowError) as error:
        raise RuntimeError(f"{context} contains a nonnumeric value") from error
    if not math.isfinite(number):
        raise RuntimeError(f"{context} contains a nonfinite value")
    return number.hex()


def _float_array_identity(values: Any, context: str) -> tuple[str, str, list[str]]:
    array = np.asarray(values)
    encoded = [_finite_float_hex(value, context) for value in array.reshape(-1)]
    return array.dtype.str, _payload_digest(encoded), encoded


def assignment_network_state_digest(record: dict[str, Any]) -> str:
    if record.get("schema_version") != "openplan.assignment-network-state.v1":
        raise ValueError("Unsupported assignment network-state schema")
    return hashlib.sha256(_compact_json(record).encode("utf-8")).hexdigest()


def assignment_network_state(
    assignment: Any,
    graph: Any,
    assignment_centroids: Sequence[int],
    project_dir: Path,
    *,
    network_settings_digest_value: str,
) -> tuple[dict[str, Any], str]:
    """Fingerprint the actual prepared CLI graph and configured solver arrays."""
    manifest = retained_network_manifest(project_dir)
    frame = graph.graph
    required_columns = {
        "link_id",
        "a_node",
        "b_node",
        "direction",
        "id",
        "distance",
        "modes",
        assignment.time_field,
        assignment.capacity_field,
        "__supernet_id__",
        "__compressed_id__",
    }
    missing = sorted(required_columns - set(frame.columns))
    if missing:
        raise RuntimeError(f"Prepared assignment graph is missing identity fields: {missing}")
    columns = {name: frame[name].to_numpy() for name in required_columns}
    all_nodes = np.asarray(graph.all_nodes)
    rows: list[list[Any]] = []
    graph_link_ids: set[int] = set()
    for ordinal in range(len(frame)):
        link_id = _strict_integer(columns["link_id"][ordinal], "Prepared graph")
        graph_link_ids.add(link_id)
        internal_a = _strict_integer(columns["a_node"][ordinal], "Prepared graph a-node map")
        internal_b = _strict_integer(columns["b_node"][ordinal], "Prepared graph b-node map")
        if not (0 <= internal_a < len(all_nodes) and 0 <= internal_b < len(all_nodes)):
            raise RuntimeError("Prepared graph contains a node index outside its node map")
        rows.append(
            [
                ordinal,
                link_id,
                _strict_integer(all_nodes[internal_a], "Prepared graph original a-node"),
                _strict_integer(all_nodes[internal_b], "Prepared graph original b-node"),
                internal_a,
                internal_b,
                _strict_integer(columns["direction"][ordinal], "Prepared graph direction"),
                _strict_integer(columns["id"][ordinal], "Prepared graph row id"),
                _strict_integer(
                    columns["__supernet_id__"][ordinal], "Prepared graph supernet map"
                ),
                _strict_integer(
                    columns["__compressed_id__"][ordinal], "Prepared graph compressed map"
                ),
                _finite_float_hex(columns[assignment.time_field][ordinal], "Prepared travel time"),
                _finite_float_hex(columns[assignment.capacity_field][ordinal], "Prepared capacity"),
                _finite_float_hex(columns["distance"][ordinal], "Prepared distance"),
                str(columns["modes"][ordinal]),
            ]
        )
    graph_link_ids_payload = sorted(graph_link_ids)
    if (
        not rows
        or len(graph_link_ids_payload) != manifest["all_link_count"]
        or _payload_digest(graph_link_ids_payload) != manifest["all_link_ids_digest"]
    ):
        raise RuntimeError("Prepared assignment graph does not contain the retained all-link set")
    centroids = [_strict_integer(value, "Assignment centroids") for value in assignment_centroids]
    if not centroids or len(set(centroids)) != len(centroids):
        raise RuntimeError("Assignment centroid order is empty or contains duplicates")
    graph_cost_dtype, graph_cost_digest, graph_cost = _float_array_identity(
        graph.cost, "Prepared graph cost"
    )
    compact_cost_dtype, compact_cost_digest, compact_cost = _float_array_identity(
        graph.compact_cost, "Prepared compact graph cost"
    )
    solver = getattr(assignment, "assignment", None)
    if solver is None:
        raise RuntimeError("TrafficAssignment has no configured solver")
    free_flow_dtype, free_flow_digest, free_flow = _float_array_identity(
        solver.free_flow_tt, "Solver free-flow time"
    )
    capacity_dtype, capacity_digest, capacity = _float_array_identity(
        solver.capacity, "Solver capacity"
    )
    if len(free_flow) != len(rows) or len(capacity) != len(rows):
        raise RuntimeError("Solver arrays do not cover every prepared graph row")
    penalty = getattr(graph, "penalty_through_centroids", float("inf"))
    if not np.isposinf(float(penalty)) and float(penalty) < 0:
        raise RuntimeError("Centroid-through penalty cannot be negative")
    penalty_identity = (
        "positive_infinity"
        if np.isposinf(float(penalty))
        else _finite_float_hex(penalty, "Centroid-through penalty")
    )
    graph_float_dtype = np.dtype(graph.default_types("float")).str
    detailed_payload = {
        "assignment_centroids": centroids,
        "block_centroid_flows": bool(getattr(graph, "block_centroid_flows", False)),
        "penalty_through_centroids": penalty_identity,
        "cost_field": str(graph.cost_field),
        "capacity_field": str(assignment.capacity_field),
        "graph_rows": rows,
        "graph_float_dtype": graph_float_dtype,
        "graph_cost": graph_cost,
        "compact_cost": compact_cost,
        "solver_free_flow_tt": free_flow,
        "solver_capacity": capacity,
        "retained_network_manifest": manifest,
        "network_settings_digest": network_settings_digest_value,
    }
    record = {
        "schema_version": "openplan.assignment-network-state.v1",
        "network_settings_digest": network_settings_digest_value,
        "assignment_centroid_count": len(centroids),
        "assignment_centroid_order_digest": _payload_digest(centroids),
        "block_centroid_flows": bool(getattr(graph, "block_centroid_flows", False)),
        "penalty_through_centroids": penalty_identity,
        "cost_field": str(graph.cost_field),
        "capacity_field": str(assignment.capacity_field),
        "graph_row_count": len(rows),
        "graph_rows_digest": _payload_digest(rows),
        "graph_float_dtype": graph_float_dtype,
        "graph_cost_digest": graph_cost_digest,
        "graph_cost_dtype": graph_cost_dtype,
        "compact_cost_digest": compact_cost_digest,
        "compact_cost_dtype": compact_cost_dtype,
        "solver_free_flow_tt_digest": free_flow_digest,
        "solver_free_flow_tt_dtype": free_flow_dtype,
        "solver_capacity_digest": capacity_digest,
        "solver_capacity_dtype": capacity_dtype,
        "retained_network_digest": _payload_digest(detailed_payload),
        "retained_network_manifest": manifest,
    }
    return record, assignment_network_state_digest(record)


def study_area_state_fips(county_fips: str | None, zone_meta: dict[str, Any]) -> set[str]:
    """Which state's DOT publishes counts for this study area.

    THE COUNTY FIPS WINS WHEN THERE IS ONE, and this is not a preference — it is
    a correctness fix found by running it. `tract_states` records every state
    the boundary INTERSECTS, and a county whose edge is a state line touches its
    neighbour: Nevada County, California came back as {CA, NV} and was refused
    as multi-state. Its first two FIPS digits say California, exactly, with no
    geometry involved.

    The tract set is still the answer for a run driven by an arbitrary boundary,
    where there is no county code and a genuinely multi-state area must be
    refused rather than guessed.
    """
    if county_fips and len(str(county_fips).strip()) >= 2:
        return {str(county_fips).strip()[:2]}
    return {str(code) for code in (zone_meta.get("tract_states") or [])}


def fetch_study_area_counts(
    *,
    county_fips: str | None,
    zone_meta: dict[str, Any],
    boundary_path: Path,
    project_dir: Path,
    run_dir: Path,
    boundary_geom,
    calibrate: bool,
) -> dict[str, Any]:
    """Get published counts for this study area, and say plainly when there are none.

    NEVER RAISES. A study area with no registered count feed is most of the
    country, and it is not a failed run — it is a run without an accuracy
    figure, which has to be recorded as such. The three outcomes a reader must
    be able to tell apart are: checked and did well, checked and did badly, and
    never checked. Returning a reason rather than throwing is what keeps the
    third one visible instead of turning it into a crash or a silence.
    """
    from auto_counts import CountsUnavailable, fetch_counts_for_study_area, split_counts_for_calibration

    counts_dir = ensure_dir(run_dir / "counts")
    try:
        fetched = fetch_counts_for_study_area(
            state_fips_codes=study_area_state_fips(county_fips, zone_meta),
            boundary_geojson_path=boundary_path,
            project_db=project_dir / "project_database.sqlite",
            output_csv=counts_dir / "published_counts.csv",
            bbox=tuple(float(v) for v in boundary_geom.bounds),
        )
    except CountsUnavailable as exc:
        return {"available": False, "reason": str(exc), "calibration_requested": calibrate}

    result: dict[str, Any] = {
        "available": True,
        "calibration_requested": calibrate,
        **fetched,
        "validation_counts_csv": fetched["counts_csv"],
    }

    if not calibrate:
        return result

    # Calibrating and grading on the same stations reports the accuracy of the
    # data the model was fitted to. Split first, so the gate is decided by
    # stations the model never saw.
    try:
        split = split_counts_for_calibration(
            Path(fetched["counts_csv"]),
            counts_dir / "counts_fit.csv",
            counts_dir / "counts_holdout.csv",
        )
    except CountsUnavailable as exc:
        result["calibration_skipped_reason"] = str(exc)
        return result

    result.update(split)
    result["calibration_counts_csv"] = split["fit_csv"]
    result["validation_counts_csv"] = split["holdout_csv"]
    return result


def calibrate_run_to_counts(
    *,
    counts_csv: Path,
    project_dir: Path,
    run_output_dir: Path,
    centroid_map: dict[int, int],
    demand_matrix: np.ndarray,
    internal_matrix: np.ndarray,
    external_matrix: np.ndarray,
    skim_meta: dict[str, Any],
    baseline_assignment: dict[str, Any],
) -> dict[str, Any]:
    """Drive the shared calibration engine over THIS lane's assignment.

    The decisions all belong to `workers/aequilibrae_worker/calibration.py` —
    the holdout split, the per-class factors, the objective, and whether a step
    is accepted. This supplies only the thing that engine cannot know: how to
    re-run an assignment here and what volumes came out.

    Trials write nothing. A rejected trial's link volumes on disk would be the
    numbers a planner reads, so the loop runs against in-memory volumes and the
    accepted state is re-run ONCE at the end with outputs written.
    """
    from calibrate_to_counts import (
        CalibrationUnavailable,
        calibrate,
        load_count_stations,
        match_stations_to_links,
    )

    stations = load_count_stations(counts_csv)
    matched = match_stations_to_links(stations, run_output_dir, project_dir / "project_database.sqlite")

    def reassign(
        class_factors: dict[str, float],
        demand_scalar: float = 1.0,
        external_scalar: float = 1.0,
    ) -> dict[int, float]:
        trial = run_assignment(
            project_dir,
            centroid_map,
            internal_matrix * float(demand_scalar) + external_matrix * float(external_scalar),
            run_output_dir,
            skim_meta,
            class_factors=class_factors,
            write_outputs=False,
        )
        return trial["volumes_by_link"]

    try:
        result = calibrate(
            matched_stations=matched,
            reassign=reassign,
            baseline_volumes=baseline_assignment.get("volumes_by_link") or {},
        )
    except CalibrationUnavailable as exc:
        # A study area without enough usable counts is a normal outcome, not a
        # failure — it is most of the country. The run continues UNCALIBRATED
        # and says why, rather than silently producing a screening number that
        # a reader might take for a calibrated one.
        return {
            "requested": True,
            "performed": False,
            "counts_csv": str(counts_csv),
            "matched_station_count": len(matched),
            "reason": str(exc),
            "claim_tier": "screening_grade",
        }

    factors = result.get("class_factors") or {}
    scalar = float(result.get("demand_scalar") or 1.0)
    external_scalar = float(result.get("external_demand_scalar") or 1.0)
    changed = bool(factors) or abs(scalar - 1.0) > 1e-9 or abs(external_scalar - 1.0) > 1e-9
    final_assignment = None
    if changed:
        final_assignment = run_assignment(
            project_dir, centroid_map,
            internal_matrix * scalar + external_matrix * external_scalar,
            run_output_dir, skim_meta, class_factors=factors, write_outputs=True,
        )

    result.pop("volumes", None)
    return {
        "requested": True,
        # ONLY TRUE WHEN A STEP WAS ACCEPTED. A loop that ran and rejected
        # everything has not calibrated anything, and must not read as though it
        # had — the run is still the screening model.
        "performed": changed,
        "counts_csv": str(counts_csv),
        "count_source_agencies": sorted(
            {str(s.get("source_agency")).strip() for s in stations if s.get("source_agency")}
        ),
        "matched_station_count": len(matched),
        "claim_tier": "calibrated_to_counts" if changed else "screening_grade",
        # THE SCREENING VMT IS NOT RESCALED BY THIS, deliberately. A demand
        # scalar fitted to traffic counts is a link-level correction, and the
        # per-capita VMT figure feeds a CEQA-adjacent screen whose claim tier is
        # a separate decision. Calibrated outputs carry distinct names so they
        # can never silently become the screening number — the worker lane's
        # calibration follows the same rule. The scalar is reported here so a
        # reader can see what the assignment actually ran on.
        "screening_vmt_rescaled": False,
        **result,
        **({"assignment": final_assignment} if final_assignment else {}),
    }


def resident_travel_leaving_share(demand_meta: dict[str, Any], cordon_zone_ids: list[int]) -> dict[str, Any]:
    """What share of resident trip ends leave the study area, with a caveat when it is high.

    The per-capita VMT figure counts only travel that begins AND ends inside the
    boundary — correct, because travel through an area is not its residents'
    driving. But a resident's own trip out of the area terminates at a cordon
    and is excluded too, while that resident stays in the population the total
    is divided by. So the figure understates, and it understates MORE the
    smaller the area.

    Returning the share rather than adjusting the number is deliberate. The
    honest per-capita figure for a small area needs travel data this model does
    not have; what it can say is how much it is missing, and that is enough for
    a reader to know whether the number is usable.
    """
    zone_ids = demand_meta.get("zone_ids") or []
    external = demand_meta.get("external_matrix")
    internal = demand_meta.get("internal_matrix")
    if external is None or internal is None or not zone_ids:
        return {}

    cordons = {int(z) for z in cordon_zone_ids}
    cordon_index = [i for i, z in enumerate(zone_ids) if int(z) in cordons]
    resident_index = [i for i, z in enumerate(zone_ids) if int(z) not in cordons]
    if not cordon_index or not resident_index:
        return {}

    leaving = float(external[np.ix_(resident_index, cordon_index)].sum())
    staying = float(internal[np.ix_(resident_index, resident_index)].sum())
    total = leaving + staying
    if total <= 0:
        return {}

    share = leaving / total
    block: dict[str, Any] = {"resident_trips_leaving_study_area_share": round(share, 4)}
    # A third is the point at which the exclusion stops being a rounding
    # consideration and starts driving the number. Banded, not computed to a
    # threshold anyone has adopted — OpenPlan's own judgement, said so.
    if share >= 0.33:
        block["per_capita_understatement_caveat"] = (
            f"{share * 100:.0f}% of residents' trips leave this study area, and travel that ends "
            "outside the boundary is not counted in the vehicle-miles-per-person figure while the "
            "residents making it are still counted in the population. The figure therefore "
            "understates how much these residents drive, and understates it more the smaller the "
            "area. Use it to compare scenarios for the SAME area, not as a per-person driving rate."
        )
    return block


def apply_class_factors(links_df: pd.DataFrame, class_factors: dict[str, float] | None) -> pd.DataFrame:
    """Make a road class more or less attractive to equilibrium flow.

    A factor above 1 means the model UNDER-assigns that class against observed
    counts, so its links are made faster and given more capacity, and the
    equilibrium moves flow onto them. Below 1 does the reverse. Same semantics
    as the worker lane's calibration, deliberately — they share the engine that
    produces the factors, so they must share what a factor MEANS.

    ALWAYS APPLIED FROM THE BASELINE, never compounded onto an
    already-adjusted network: the loop composes its factors itself and hands the
    cumulative value here, so applying to a modified network would square them.
    That is why this takes the freshly-read links table each time.

    No factors is the identity. The baseline run and a calibrated run with an
    empty factor set must produce byte-identical networks, or the "what did
    calibration change?" comparison measures the plumbing.
    """
    canonical_factors = assignment_network_settings(class_factors)["road_class_factors"]
    if not canonical_factors:
        return links_df

    adjusted = links_df.copy()
    # Cast before scaling: a capacity column read back as int64 rejects a float
    # assignment outright under pandas 3, and rounding a factor into an integer
    # capacity would quietly discard most of the adjustment on small roads.
    for column in ("travel_time", "capacity_ab", "capacity_ba"):
        adjusted[column] = adjusted[column].astype(float)
    link_class = adjusted["link_type"].astype(str).str.strip().str.lower()
    for road_class, factor in canonical_factors.items():
        matches = link_class == str(road_class).strip().lower()
        if not matches.any() or factor <= 0:
            continue
        adjusted.loc[matches, "travel_time"] = adjusted.loc[matches, "travel_time"] / factor
        adjusted.loc[matches, "capacity_ab"] = adjusted.loc[matches, "capacity_ab"] * factor
        adjusted.loc[matches, "capacity_ba"] = adjusted.loc[matches, "capacity_ba"] * factor
    return adjusted


def assignment_convergence(
    rgap: float,
    iterations: int | None,
    max_iterations: int,
    *,
    profile: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Did the equilibrium assignment actually reach equilibrium — stated, not implied.

    A traffic assignment redistributes trips until no driver can find a faster
    route; the relative gap measures how far from that it still is. Stopping at
    the iteration ceiling with the gap above target means traffic had not
    finished moving off over-capacity links, and every link volume is therefore
    a figure from part-way through a calculation rather than a result.

    The record carries the full assignment profile and its digest. A final gap
    without the method that produced it cannot prove that two assignments held
    the assignment constant.
    """
    applied_profile = dict(profile or assignment_profile(max_iterations=max_iterations))
    if isinstance(applied_profile.get("class_pce"), bool):
        raise ValueError("Assignment class PCE must be numeric, not boolean")
    applied_profile["max_iterations"] = int(max_iterations)
    target_gap = float(applied_profile["target_gap"])
    # bool() wraps the WHOLE expression: `rgap` arrives as a numpy float, so
    # `rgap <= target` is a numpy bool_ and `A and B` returns B — which json
    # cannot serialise, failing the run at the very end after four minutes.
    try:
        numeric_gap = float(rgap) if not isinstance(rgap, bool) else float("nan")
    except (TypeError, ValueError, OverflowError):
        numeric_gap = float("nan")
    valid_gap = bool(math.isfinite(numeric_gap) and numeric_gap >= 0)
    if isinstance(iterations, bool):
        iterations = None
    converged = bool(valid_gap and numeric_gap <= target_gap)
    profile_payload = assignment_profile_payload_json(applied_profile)
    record: dict[str, Any] = {
        "final_gap": numeric_gap if valid_gap else None,
        "iterations": int(iterations) if iterations is not None else None,
        "target_gap": target_gap,
        "max_iterations": int(max_iterations),
        "algorithm": applied_profile["algorithm"],
        "converged": converged,
        "assignment_profile": applied_profile,
        "assignment_profile_payload_json": profile_payload,
        "assignment_profile_digest": assignment_profile_digest(
            applied_profile, profile_payload
        ),
    }
    if not converged:
        iteration_text = str(iterations) if iterations is not None else "an unreported number of"
        record["caveat"] = (
            f"The traffic assignment did NOT converge: it stopped after {iteration_text} iterations "
            f"with a relative gap of "
            f"{'unmeasured' if not valid_gap else format(numeric_gap, '.4f')}, against a target "
            f"of {target_gap}. Link volumes from an unconverged assignment are not "
            "equilibrium volumes — traffic has not finished redistributing away from over-capacity "
            "roads — and must not be compared to observed counts or used to rank corridors."
        )
    return record


def connector_separation_m(area_sq_mi: float) -> float:
    """How far apart a zone's connectors should be, from the zone's own size.

    Zero for a zone with no area — which is exactly right for an external
    cordon, whose whole purpose is to attach at ONE point, the place its highway
    crosses the boundary. Spreading a cordon's connectors would undo the
    gateway fix.
    """
    if not math.isfinite(area_sq_mi) or area_sq_mi <= 0:
        return 0.0
    equivalent_radius_m = math.sqrt(area_sq_mi * SQ_METRES_PER_SQ_MILE / math.pi)
    return CONNECTOR_SEPARATION_RADIUS_FRACTION * equivalent_radius_m


def select_spread_connectors(
    ranked_candidates: list[tuple[int, float, float]],
    min_separation_m: float,
    count: int = 3,
) -> list[tuple[int, float, float]]:
    """Pick connectors that are actually in different parts of the zone.

    WHY THIS EXISTS (measured 2026-08-16). Every zone already got three
    connectors, and it looked like enough. Measuring them showed the three sit a
    median of 138–166 m apart, sometimes 3 m — three adjacent nodes on one
    street, which loads exactly like a single connector. A whole block group's
    demand entered the network on one residential road, which is why finer zones
    pushed local streets into the busiest-links list even though they cut the
    share of unassigned travel four-fold.

    Greedy and best-first: take the highest-ranked candidate, then each next one
    only if it is far enough from everything already taken. `ranked_candidates`
    must already be in preference order — road class and proximity are decided
    by the caller's scoring, and this only enforces spread on top of it.

    RELAXES RATHER THAN REFUSES. If the separation cannot be met — a small dense
    zone, a rural zone with one road through it — the best remaining candidates
    fill the gap. A zone with too few connectors is disconnected from the
    network entirely, which is a far worse failure than a clustered one.
    """
    chosen: list[tuple[int, float, float]] = []
    for candidate in ranked_candidates:
        if len(chosen) >= count:
            break
        if min_separation_m <= 0 or all(
            haversine_miles(candidate[1], candidate[2], taken[1], taken[2]) * 1609.34 >= min_separation_m
            for taken in chosen
        ):
            chosen.append(candidate)

    if len(chosen) < count:
        taken_ids = {node_id for node_id, _, _ in chosen}
        for candidate in ranked_candidates:
            if len(chosen) >= count:
                break
            if candidate[0] not in taken_ids:
                chosen.append(candidate)
    return chosen


def boundary_fingerprint(boundary_geom) -> str:
    """A stable digest of the analysis boundary's geometry.

    Hashes the well-known binary rather than the GeoJSON text: the same polygon
    written by two code paths differs in coordinate formatting and key order,
    and a fingerprint that changes for those reasons would refuse every legitimate
    network reuse. Coordinates are rounded first — a boundary that survived a
    GeoJSON round trip is the same boundary, and full float precision would say
    otherwise.
    """
    from shapely import set_precision, wkb

    return hashlib.sha256(wkb.dumps(set_precision(boundary_geom, 1e-9))).hexdigest()


def backfill_gateway_names_from_project(summary: dict[str, Any], project_dir: Path) -> int:
    """Recover each reused gateway's road name from the network it came from.

    A run whose network is reused adopts the SOURCE run's gateway records, and
    every run made before 2026-08-18 recorded no `name` on them. Without it the
    route-pairing that decides pass-through matches nothing, so a reused network
    silently produces a model in which no vehicle can cross the study area —
    while reporting the same gateway count and the same volumes as a fresh run.

    That is not hypothetical: it made the first pass-through measurement come
    back as +0.3%, which read as "pass-through barely matters" rather than
    "pass-through never ran". The name is in the project database's links table
    under the gateway's own `link_id`, so it is recovered rather than the run
    being rebuilt.
    """
    gateways = summary.get("gateways") or []
    missing = [g for g in gateways if not str(g.get("name") or "").strip()]
    if not missing:
        return 0
    database = project_dir / "project_database.sqlite"
    if not database.exists():
        return 0
    connection = sqlite3.connect(str(database))
    try:
        names = {
            int(link_id): str(name or "").strip()
            for link_id, name in connection.execute("SELECT link_id, name FROM links")
        }
    except sqlite3.DatabaseError:
        return 0
    finally:
        connection.close()
    filled = 0
    for gateway in missing:
        name = names.get(int(gateway.get("link_id", -1)), "")
        # ALWAYS set the key, even to "". A crossing whose road genuinely has no
        # name in OSM is a real thing and must be distinguishable from a caller
        # that forgot to pass the field — `match_count_to_gateway` refuses the
        # second and tolerates the first, and after the first version of this
        # backfill they were indistinguishable, which crashed four of five runs.
        gateway["name"] = name
        if name:
            filled += 1
    return filled


def reuse_network_from_run(
    bundle_dir: Path, boundary_geom, zones_df: pd.DataFrame, source_run_dir: Path
) -> tuple[dict[str, Any], pd.DataFrame]:
    """Adopt another run's network, zone system and gateways wholesale.

    THE POINT IS CORRECTNESS, NOT SPEED. Comparing two demand models only means
    anything if the network underneath them is the same one; OSM changes
    continuously, so two runs that each download it are two different networks
    and any divergence in link volumes is unattributable. Copying the retained
    project makes "the same network" a fact rather than an assumption.

    Everything that could make the adopted network the wrong one is refused
    rather than caveated: a different study area, a missing project, or a zone
    system whose internal zones do not match the ones this run was handed.
    """
    source_run_dir = Path(source_run_dir).expanduser().resolve()
    source_project = source_run_dir / "work" / "aeq_project"
    source_summary_path = source_run_dir / "work" / "network_setup_summary.json"
    source_zones_path = source_run_dir / "package" / "zone_attributes.csv"
    source_boundary = source_run_dir / "boundary" / "analysis_boundary.geojson"

    if not source_project.is_dir():
        raise RuntimeError(
            f"No retained AequilibraE project at {source_project}. Only a run made with "
            "--keep-project can lend its network; re-run the source with that flag."
        )
    for path, what in (
        (source_summary_path, "network setup summary"),
        (source_zones_path, "zone table"),
        (source_boundary, "analysis boundary"),
    ):
        if not path.exists():
            raise RuntimeError(f"The source run is missing its {what} ({path}); its network cannot be reused.")

    source_geom = shape(json.loads(source_boundary.read_text())["features"][0]["geometry"])
    if boundary_fingerprint(source_geom) != boundary_fingerprint(boundary_geom):
        raise RuntimeError(
            f"The source run {source_run_dir.name} covers a different study area than this run. "
            "Reusing its network would assign this run's demand over someone else's roads."
        )

    source_zones = pd.read_csv(source_zones_path, dtype={"GEOID": str})
    source_internal = source_zones[source_zones["zone_kind"] != "external"]
    incoming_ids = sorted(int(z) for z in zones_df["zone_id"])
    source_ids = sorted(int(z) for z in source_internal["zone_id"])
    if incoming_ids != source_ids:
        raise RuntimeError(
            "This run's internal zones do not match the source run's "
            f"({len(incoming_ids)} vs {len(source_ids)} zones). The adopted network's centroids "
            "were built for the source's zone system, so the demand would be loaded at the wrong "
            "points."
        )

    work_dir = ensure_dir(bundle_dir / "work")
    proj_dir = work_dir / "aeq_project"
    if proj_dir.exists():
        shutil.rmtree(proj_dir)
    shutil.copytree(source_project, proj_dir)

    summary = json.loads(source_summary_path.read_text())
    summary["project_dir"] = str(proj_dir)
    # Recorded so a reader of this run's manifest can tell that its roads were
    # not downloaded for it, and which run they came from.
    summary["network_reused_from"] = {
        "run_dir": str(source_run_dir),
        "run_name": source_run_dir.name,
        "boundary_sha256": boundary_fingerprint(boundary_geom),
        "note": (
            "The road network, zone centroids and external gateways were copied from this run "
            "rather than downloaded, so both runs are assigned over exactly the same network."
        ),
    }
    backfilled = backfill_gateway_names_from_project(summary, proj_dir)
    if backfilled:
        summary["network_reused_from"]["gateway_names_recovered"] = backfilled
    (work_dir / "network_setup_summary.json").write_text(json.dumps(summary, indent=2))

    # The external gateway zones belong to the network, so they come across with
    # it. Rebuilt from the source zone table rather than re-detected: detection
    # reads the network, and re-running it could only ever agree or introduce a
    # discrepancy.
    external_rows = source_zones[source_zones["zone_kind"] == "external"]
    combined = pd.concat([zones_df, external_rows[list(EXTERNAL_ZONE_COLUMNS)]], ignore_index=True)
    return summary, combined


def build_network(
    bundle_dir: Path,
    boundary_geom,
    zones_df: pd.DataFrame,
    network_buffer_miles: float,
    reuse_network_from: str | None = None,
) -> dict[str, Any]:
    from aequilibrae import Project

    if reuse_network_from:
        return reuse_network_from_run(bundle_dir, boundary_geom, zones_df, Path(reuse_network_from))

    patch_osm_builder()

    work_dir = ensure_dir(bundle_dir / "work")
    proj_dir = work_dir / "aeq_project"
    if proj_dir.exists():
        shutil.rmtree(proj_dir)

    network_bbox = buffered_bbox(boundary_geom.bounds, network_buffer_miles)
    project = Project()
    project.new(str(proj_dir))
    # WHEN the network was downloaded, not just that it was. A grant appendix
    # has to be able to say which extract the figures rest on, and OSM changes
    # continuously — a run from last year and a run from today describe
    # different roads. Recorded as the moment the download completed, which is
    # the only timestamp this lane can honestly claim.
    network_downloaded_at = datetime.now(timezone.utc).isoformat()
    project.network.create_from_osm(model_area=box(*network_bbox), modes=["car"], clean=True)
    project.close()

    # Gateways are detected HERE, between the network import and the centroid
    # pass, because that is the only moment both facts are available: the links
    # exist (so a boundary crossing can be found) and no centroid has been
    # attached yet (so the gateway can be given a zone of its own and picked up
    # by the same pass as every other zone). Detecting them later — which is
    # where this used to live, inside demand synthesis — left no way to give a
    # gateway a centroid, which is why it borrowed the nearest tract's.
    gateways, gateway_notes = detect_external_gateways(proj_dir, boundary_geom)
    zones_df = pd.concat(
        [zones_df, build_external_zone_rows(gateways, int(zones_df["zone_id"].max()) + 1)],
        ignore_index=True,
    )
    for gateway, zone_id in zip(gateways, external_zone_ids(zones_df)):
        gateway["zone_id"] = zone_id

    conn = connect_spatialite(proj_dir / "project_database.sqlite")
    nodes_all = [row[0] for row in conn.execute("SELECT node_id FROM nodes ORDER BY node_id")]
    links_raw = conn.execute("SELECT a_node, b_node FROM links").fetchall()
    adjacency: dict[int, set[int]] = {}
    for a_node, b_node in links_raw:
        adjacency.setdefault(a_node, set()).add(b_node)
        adjacency.setdefault(b_node, set()).add(a_node)

    components = []
    visited: set[int] = set()
    for node in nodes_all:
        if node in visited:
            continue
        comp: set[int] = set([node])
        queue = [node]
        while queue:
            current = queue.pop(0)
            for neighbor in adjacency.get(current, set()):
                if neighbor not in comp:
                    comp.add(neighbor)
                    queue.append(neighbor)
        visited |= comp
        components.append(comp)
    components.sort(key=len, reverse=True)
    largest_component = components[0] if components else set()

    conn.execute("CREATE TEMP TABLE openplan_routable_connector_nodes (node_id INTEGER PRIMARY KEY)")
    conn.executemany(
        "INSERT INTO openplan_routable_connector_nodes (node_id) VALUES (?)",
        ((int(node_id),) for node_id in largest_component),
    )

    if not conn.execute("SELECT 1 FROM link_types WHERE link_type='centroid_connector'").fetchone():
        conn.execute(
            "INSERT INTO link_types (link_type, link_type_id, description, lanes, lane_capacity) VALUES "
            "('centroid_connector', 'z', 'Virtual centroid connectors', 10, 10000)"
        )
        conn.commit()

    max_node = int(conn.execute("SELECT COALESCE(MAX(node_id), 0) FROM nodes").fetchone()[0] or 0)
    max_link = int(conn.execute("SELECT COALESCE(MAX(link_id), 0) FROM links").fetchone()[0] or 0)
    next_node = max_node + 1
    next_link = max_link + 1
    centroid_map: dict[int, int] = {}
    connector_diagnostics: list[dict[str, Any]] = []

    for _, zone in zones_df.iterrows():
        zone_id = int(zone["zone_id"])
        clon = float(zone["centroid_lon"])
        clat = float(zone["centroid_lat"])
        centroid_node = next_node
        next_node += 1
        connector_lon, connector_lat, centroid_offset_m = insert_distinct_centroid(
            conn, centroid_node, clon, clat
        )

        nearest = conn.execute(
            "SELECT node_id, X(geometry), Y(geometry), "
            "(X(geometry)-?)*(X(geometry)-?)+(Y(geometry)-?)*(Y(geometry)-?) as d2 "
            "FROM nodes WHERE is_centroid=0 AND node_id!=? ORDER BY d2 ASC LIMIT ?",
            (clon, clon, clat, clat, centroid_node, CONNECTOR_CANDIDATE_POOL),
        ).fetchall()
        candidate_pool, searched_largest_component_directly = candidates_on_routable_component(
            nearest,
            largest_component,
            lambda: conn.execute(
                "SELECT node_id, X(geometry), Y(geometry), "
                "(X(geometry)-?)*(X(geometry)-?)+(Y(geometry)-?)*(Y(geometry)-?) as d2 "
                "FROM nodes WHERE is_centroid=0 AND node_id IN "
                "(SELECT node_id FROM openplan_routable_connector_nodes) "
                "ORDER BY d2 ASC LIMIT ?",
                (clon, clon, clat, clat, CONNECTOR_CANDIDATE_POOL),
            ).fetchall(),
        )
        ranked = sorted(
            candidate_pool,
            key=lambda item: rank_connector_candidate(conn, int(item[0]), float(item[3])),
            reverse=True,
        )
        distance_by_node = {int(row[0]): float(row[3]) for row in ranked}
        preferred = select_spread_connectors(
            [(int(row[0]), float(row[1]), float(row[2])) for row in ranked],
            connector_separation_m(float(zone["area_sq_mi"])),
        )
        chosen_connectors = []
        for near_node, nx, ny in preferred:
            d2 = distance_by_node[near_node]
            line_wkt = f"LINESTRING({connector_lon} {connector_lat}, {nx} {ny})"
            length_m = max((d2 ** 0.5) * 111000, 10)
            # speed_ab/speed_ba are left NULL on purpose: until the normalisation pass below they hold
            # raw OSM `maxspeed` tags (metric by default), and a literal here would be indistinguishable
            # from one. LINK_DEFAULTS["centroid_connector"] supplies the mph value in that same pass.
            conn.execute(
                "INSERT INTO links (link_id, a_node, b_node, direction, distance, modes, link_type, name, "
                "capacity_ab, capacity_ba, geometry) "
                "VALUES (?, ?, ?, 0, ?, 'c', 'centroid_connector', 'connector', 99999, 99999, GeomFromText(?, 4326))",
                (next_link, centroid_node, near_node, length_m, line_wkt),
            )
            adjacent_link_types = [
                str(link_type or '').strip().lower()
                for (link_type,) in conn.execute(
                    "SELECT DISTINCT COALESCE(link_type, '') FROM links WHERE a_node=? OR b_node=?",
                    (near_node, near_node),
                ).fetchall()
            ]
            chosen_connectors.append(
                {
                    "link_id": int(next_link),
                    "to_node": int(near_node),
                    "distance_m": round(float(length_m), 1),
                    "in_largest_component": bool(near_node in largest_component),
                    "adjacent_link_types": adjacent_link_types,
                    "best_adjacent_link_priority": max((LINK_CLASS_PRIORITY.get(t, -1) for t in adjacent_link_types), default=-1),
                }
            )
            next_link += 1
        connector_diagnostics.append(
            {
                "zone_id": zone_id,
                "zone_label": str(zone.get("NAMELSAD") or zone.get("GEOID") or zone_id),
                "centroid_node": int(centroid_node),
                "virtual_centroid_offset_m": centroid_offset_m,
                "nearest_candidates_considered": int(len(nearest)),
                "routable_component_candidates_in_nearby_pool": int(
                    sum(1 for row in nearest if row[0] in largest_component)
                ),
                "searched_routable_component_directly": searched_largest_component_directly,
                "used_fallback_non_largest_component": False,
                "chosen_connectors": chosen_connectors,
            }
        )
        centroid_map[zone_id] = centroid_node
    conn.commit()

    # Normalisation pass: speed_ab/speed_ba come out of the OSM import as raw `maxspeed` tags in mixed
    # units and go back in as the mph the rest of the pipeline (and `distance` in metres) assumes.
    links_data = conn.execute(
        "SELECT link_id, link_type, speed_ab, speed_ba, distance, lanes_ab, lanes_ba FROM links"
    ).fetchall()
    updates = []
    for link_id, link_type, speed_ab, speed_ba, distance, lanes_ab, lanes_ba in links_data:
        default_speed, cap_per_lane, default_lanes = LINK_DEFAULTS.get(link_type, (25, 400, 1))
        speed_ab_val = _parse_speed(speed_ab) or default_speed
        speed_ba_val = _parse_speed(speed_ba) or speed_ab_val
        distance_val = float(distance or 0.01)
        tt_ab = distance_val / (speed_ab_val * 1609.34 / 60) if distance_val > 0 else 0.01
        tt_ba = distance_val / (speed_ba_val * 1609.34 / 60) if distance_val > 0 else 0.01
        lanes_ab_val = int(lanes_ab or default_lanes or 1)
        lanes_ba_val = int(lanes_ba or default_lanes or 1)
        cap_ab = cap_per_lane * lanes_ab_val
        cap_ba = cap_per_lane * lanes_ba_val
        updates.append((speed_ab_val, speed_ba_val, tt_ab, tt_ba, cap_ab, cap_ba, link_id))
    conn.executemany(
        "UPDATE links SET speed_ab=?, speed_ba=?, travel_time_ab=?, travel_time_ba=?, capacity_ab=?, capacity_ba=? WHERE link_id=?",
        updates,
    )
    conn.commit()
    conn.close()

    summary = {
        "network_bbox": [float(v) for v in network_bbox],
        "network_source": "OpenStreetMap",
        "network_downloaded_at": network_downloaded_at,
        "zones_connected": int(len(centroid_map)),
        "nodes_before_centroids": int(len(nodes_all)),
        "links_before_centroids": int(len(links_raw)),
        "largest_component_pct": round(100 * len(largest_component) / max(len(nodes_all), 1), 2),
        "project_dir": str(proj_dir),
        "node_id_strategy": "preserve_osm_ids",
        "centroid_map": centroid_map,
        "connector_diagnostics": connector_diagnostics,
        "gateways": gateways,
        # What the corridor grouping and the gateway cap left out. Never an
        # empty list standing in for "nothing was dropped" — a reader has to be
        # able to tell a study area with three boundary highways from one whose
        # extra crossings were quietly trimmed.
        "gateway_notes": gateway_notes,
        "internal_zone_count": int((zones_df["zone_kind"] == "internal").sum()),
        "external_zone_count": int((zones_df["zone_kind"] == "external").sum()),
    }
    (bundle_dir / "work" / "network_setup_summary.json").write_text(json.dumps(summary, indent=2))
    # The zone table now has more rows than it did on the way in, so it is
    # returned rather than mutated in place — every downstream stage must see
    # the same zone system the connectors were built for.
    return summary, zones_df


def compute_freeflow_skims(project_dir: Path, centroid_map: dict[int, int], run_output_dir: Path) -> dict[str, Any]:
    from aequilibrae import Project
    from aequilibrae.paths import NetworkSkimming

    ensure_dir(run_output_dir)
    centroids_sorted = np.array(sorted(int(v) for v in centroid_map.values()))
    project = Project()
    project.open(str(project_dir))
    project.network.build_graphs(modes=["c"])
    graph = project.network.graphs["c"]
    columns = list(graph.graph.columns)
    time_field = "travel_time" if "travel_time" in columns else "distance"
    capacity_field = "capacity" if "capacity" in columns else "capacity_ab"
    graph.set_graph(time_field)
    with warnings.catch_warnings(record=True) as caught_warnings:
        warnings.simplefilter("always")
        graph.prepare_graph(centroids_sorted)
    missing_centroids = extract_missing_centroids_from_warnings(caught_warnings)
    graph.set_blocked_centroid_flows(True)
    # Distance rides along with travel time (worker-lane parity): the
    # ActivitySim bundle needs routed distance for its DIST skims, and a skim
    # file carrying only time cannot say how far anything is.
    skim_fields = [time_field]
    if "distance" in columns and "distance" not in skim_fields:
        skim_fields.append("distance")
    graph.set_skimming(skim_fields)

    skimming = NetworkSkimming(graph)
    skimming.execute()
    skim_mat = skimming.results.skims
    skim_path = run_output_dir / "travel_time_skims.omx"
    skim_mat.export(str(skim_path))
    matrix = np.array(skim_mat.matrix[time_field], dtype=float)
    # Distance is skimmed alongside time and returned, not just written to the
    # file. Mode choice needs how FAR a trip is, not only how long it takes —
    # a two-mile crawl and a twenty-mile freeway run can share a duration and
    # are not remotely the same walking decision.
    distance_matrix = (
        np.array(skim_mat.matrix["distance"], dtype=float)
        if "distance" in skim_fields and time_field != "distance"
        else None
    )
    finite = np.isfinite(matrix) & (matrix > 0)
    np.fill_diagonal(finite, False)
    reachable_pairs = int(finite.sum())
    total_pairs = int(len(centroids_sorted) * max(len(centroids_sorted) - 1, 0))

    result = {
        "matrix": matrix,
        "distance_matrix": distance_matrix,
        "centroids_sorted": centroids_sorted.tolist(),
        "time_field": time_field,
        "capacity_field": capacity_field,
        "missing_centroids_in_graph": missing_centroids,
        "reachable_pairs": reachable_pairs,
        "total_pairs": total_pairs,
        "avg_time_min": float(matrix[finite].mean()) if reachable_pairs else None,
        "max_time_min": float(matrix[finite].max()) if reachable_pairs else None,
        "skim_path": str(skim_path),
        "skim_fields": skim_fields,
    }
    project.close()
    return result


def gravity_distribute(
    productions: np.ndarray,
    attractions: np.ndarray,
    impedance: np.ndarray,
    gamma: float,
    max_iter: int = 60,
    tolerance: float = 0.01,
) -> np.ndarray:
    n = len(productions)
    matrix = np.array(impedance, dtype=float, copy=True)
    positive = matrix[np.isfinite(matrix) & (matrix > 0)]
    intrazonal = max(float(np.nanpercentile(positive, 20)) if positive.size else 2.0, 1.0)
    np.fill_diagonal(matrix, intrazonal)
    valid = np.isfinite(matrix) & (matrix > 0)

    with np.errstate(divide="ignore", invalid="ignore"):
        friction = np.where(valid, np.power(matrix, -gamma), 0.0)
    friction = np.nan_to_num(friction, nan=0.0, posinf=0.0, neginf=0.0)

    if attractions.sum() > 0:
        attractions = attractions * (productions.sum() / attractions.sum())

    a_factors = np.ones(n, dtype=float)
    b_factors = np.ones(n, dtype=float)

    for _ in range(max_iter):
        denom_a = friction @ (b_factors * attractions)
        a_factors = np.divide(1.0, denom_a, out=np.zeros_like(denom_a), where=denom_a > 0)

        denom_b = friction.T @ (a_factors * productions)
        b_factors = np.divide(1.0, denom_b, out=np.zeros_like(denom_b), where=denom_b > 0)

        balanced = np.outer(a_factors * productions, b_factors * attractions) * friction
        row_sums = balanced.sum(axis=1)
        error = np.max(np.abs(row_sums - productions) / np.maximum(productions, 1.0))
        if error < tolerance:
            break

    result = np.outer(a_factors * productions, b_factors * attractions) * friction
    return np.nan_to_num(result, nan=0.0, posinf=0.0, neginf=0.0)


#: How many boundary crossings a study area may model as gateways.
#:
#: OVERRIDABLE, and the reason is a measurement. On the county this was written
#: against, 18 crossings survived corridor grouping and 8 were kept — so ten
#: real ways in and out of the county were discarded. Two of them carry state
#: highways with published counts of 12,200 and 5,100 vehicles a day, and the
#: model puts ZERO traffic on both, because a road whose whole purpose is
#: leaving the study area has no trips at all once its gateway is gone. The
#: traffic that should have entered there is injected at the crossings that were
#: kept instead, which is a candidate explanation for those roads carrying two
#: to three times too much.
MAX_GATEWAYS = int(os.getenv("OPENPLAN_MAX_GATEWAYS", "8"))


def detect_external_gateways(
    project_dir: Path, boundary_geom, max_gateways: int = MAX_GATEWAYS
) -> list[dict[str, Any]]:
    """Find the highways that cross the study-area boundary, and where.

    WHAT CHANGED HERE, AND WHY IT MATTERED (2026-08-15). This function used to
    finish by attaching each gateway to the NEAREST RESIDENT ZONE CENTROID, and
    the demand builder then loaded that gateway's traffic at the centroid. The
    crossing point was computed, stored as `boundary_lon`/`boundary_lat`, and
    then not used for anything.

    In a rural county that is catastrophic for link volumes. The tract touching
    the eastern boundary of the measured county is 513 square miles of national
    forest with 3,765 residents; its centroid sits about 30 km from the
    interstate, and the nearest link to that point is an unpaved forest road.
    Every external trip was therefore injected there: 113,410 vehicles a day on
    Grouse Ridge Road, 84% of everything entering or leaving that zone, at 14x
    its capacity, ranked above every real arterial in the county.

    It also quietly distorted the county's headline number. Because those tracts
    were doing double duty as gateway proxies, the resident-VMT estimator had to
    exclude them to keep pass-through travel out — dropping 17% of the
    population's travel from the numerator while their population stayed in the
    denominator.

    So the gateway now keeps only its crossing point, and the caller gives it a
    zone of its own there. Both problems are the same defect and both end here.
    """
    conn = connect_spatialite(project_dir / "project_database.sqlite")
    rows = conn.execute(
        "SELECT link_id, link_type, COALESCE(name, ''), COALESCE(lanes_ab, 1), COALESCE(lanes_ba, 1), AsText(geometry) "
        "FROM links WHERE link_type IN ('motorway', 'trunk', 'primary', 'secondary', 'tertiary')"
    ).fetchall()
    conn.close()

    tol_deg = 0.005
    cluster_tol_deg = 0.02
    candidates: list[dict[str, Any]] = []
    for link_id, link_type, name, lanes_ab, lanes_ba, geom_wkt in rows:
        if not geom_wkt:
            continue
        line = wkt.loads(geom_wkt)
        if line.is_empty or line.within(boundary_geom):
            continue
        if not line.intersects(boundary_geom.boundary.buffer(tol_deg)):
            continue
        inside_len = line.intersection(boundary_geom).length
        outside_len = line.difference(boundary_geom).length
        if inside_len <= 0 or outside_len <= 0:
            continue
        hit = line.intersection(boundary_geom.boundary)
        point = hit.representative_point() if not hit.is_empty else line.interpolate(0.5, normalized=True)
        base_daily = GATEWAY_DAILY_TRIPS.get(link_type, 0)
        lanes = max(float(lanes_ab or 1), float(lanes_ba or 1), 1.0)
        daily = min(base_daily * lanes, 20000)
        candidates.append(
            {
                "link_id": int(link_id),
                "link_type": str(link_type),
                "name": str(name or ""),
                "point": point,
                "daily": float(daily),
            }
        )

    candidates.sort(key=lambda item: item["daily"], reverse=True)
    clusters: list[dict[str, Any]] = []
    for candidate in candidates:
        matched = None
        for cluster in clusters:
            if candidate["point"].distance(cluster["point"]) <= cluster_tol_deg:
                matched = cluster
                break
        if matched is None:
            clusters.append(candidate.copy())
            continue
        matched["daily"] = max(float(matched["daily"]), float(candidate["daily"]))

    clusters, corridor_notes = keep_corridor_endpoints(clusters)

    ranked = sorted(clusters, key=lambda item: item["daily"], reverse=True)
    if len(ranked) > max_gateways:
        # A second cap, and the same rule applies: say what it dropped. A study
        # area with more boundary highways than this keeps its busiest, and a
        # reader has to be able to tell that from a study area that only had
        # this many.
        corridor_notes.append(gateway_cap_note(len(ranked), max_gateways))
    clusters = ranked[:max_gateways]

    gateways = []
    for idx, gateway in enumerate(clusters, start=1):
        label_bits = [gateway["link_type"], gateway["name"] or f"gateway-{idx:02d}"]
        label = slugify("-".join(label_bits))
        gateways.append(
            {
                "label": label,
                # The ROAD's name, not the slugified label. `gateway_counts`
                # matches a published count to a crossing on road identity plus
                # closeness, and reads this field to do it — without it the
                # match refuses every crossing and the seeding silently does
                # nothing. That is the third time in one day a dict rebuilt
                # field by field dropped the one property a later step needed.
                "name": gateway.get("name") or "",
                "link_type": gateway["link_type"],
                "link_id": gateway["link_id"],
                "daily_in": round(float(gateway["daily"]), 2),
                "daily_out": round(float(gateway["daily"]), 2),
                "boundary_lon": round(float(gateway["point"].x), 6),
                "boundary_lat": round(float(gateway["point"].y), 6),
            }
        )
    return gateways, corridor_notes


def gateway_cap_note(crossings_found: int, max_gateways: int) -> str:
    """What the gateway cap discarded, in the words that made it findable.

    THIS SENTENCE IS THE ONLY REASON THE DEFECT WAS FOUND. It recorded "18
    boundary crossings remained after corridor grouping; kept the 8 busiest and
    dropped 10" on a county where two of the dropped crossings carry state
    highways with published counts of 12,200 and 5,100 vehicles a day — and the
    model assigns zero traffic to both, because a road whose whole purpose is
    leaving the study area has no trips once its gateway is gone.

    So it names the number dropped rather than saying the cap was applied, and
    it says what a dropped crossing costs. A note that only said "capped at 8"
    would have been read as housekeeping.
    """
    dropped = max(0, crossings_found - max_gateways)
    return (
        f"{crossings_found} boundary crossings remained after corridor grouping; kept the "
        f"{max_gateways} busiest and dropped {dropped}. A dropped crossing is a way in and out of "
        "the study area the model cannot use: roads that exist mainly to leave it carry no traffic "
        "at all, and the trips that would have entered there are injected at the crossings that "
        "were kept instead. Raise OPENPLAN_MAX_GATEWAYS to model more of them."
    )


def keep_corridor_endpoints(
    clusters: list[dict[str, Any]], max_per_corridor: int = 2
) -> tuple[list[dict[str, Any]], list[str]]:
    """One highway is one corridor, however many times it crosses the boundary.

    WHY (measured 2026-08-15, and invisible until the gateway-placement fix).
    A study-area boundary is a legal line, not a geographic one, and highways
    wander across it. Interstate 80 crosses the measured county's southern line
    FOUR times — 5.9, 10.4, 16.3 and 54.7 km apart, so the 2.2 km proximity
    clustering above cannot see that they are one road. Each crossing was then
    treated as an independent gateway injecting a full interstate's worth of
    daily traffic: about 160,000 vehicles where roughly 40,000 belongs.

    This was masked before gateways had zones of their own — all four collapsed
    onto the same borrowed tract centroid and were merged there by accident.
    Fixing where gateways attach is what made the double-counting visible.

    THE RULE: for each named road, keep the two crossings FARTHEST APART and
    drop the rest. Those two are where the corridor enters and leaves the study
    area; the ones between are the road stepping outside and coming back, which
    is not a vehicle entering the area. Two is also right for the honest case of
    one route crossing at opposite ends — a state highway entering north and
    leaving south keeps both.

    DELIBERATELY CONSERVATIVE, and stated because it is a modelling choice
    rather than a fact: a road that genuinely enters a study area at three
    unconnected places loses one. That direction is the safe one here — the
    model currently loads far too much external traffic, not too little — but it
    is a cap, so what it drops is returned for the caller to record rather than
    discarded silently.

    UNNAMED ROADS ARE NEVER GROUPED. An empty OSM name is an absence, not an
    identity; grouping on it would merge unrelated lanes into one corridor.
    """
    by_corridor: dict[str, list[dict[str, Any]]] = {}
    kept: list[dict[str, Any]] = []
    for cluster in clusters:
        corridor = str(cluster.get("name") or "").strip().lower()
        if not corridor:
            kept.append(cluster)
            continue
        by_corridor.setdefault(corridor, []).append(cluster)

    notes: list[str] = []
    for corridor, crossings in by_corridor.items():
        if len(crossings) <= max_per_corridor:
            kept.extend(crossings)
            continue

        # The two farthest apart are the corridor's entry and exit. Volume is a
        # poor discriminator here — every crossing of one road shares a link
        # type and lane count, so they all carry the same figure.
        endpoints = max(
            (
                (a, b)
                for index, a in enumerate(crossings)
                for b in crossings[index + 1 :]
            ),
            key=lambda pair: pair[0]["point"].distance(pair[1]["point"]),
        )
        kept.extend(endpoints)
        notes.append(
            f"{crossings[0].get('name')}: {len(crossings)} boundary crossings found, kept the "
            f"{max_per_corridor} farthest apart as the corridor's entry and exit and dropped "
            f"{len(crossings) - max_per_corridor} — one road crossing a boundary repeatedly is "
            "one corridor, not several gateways."
        )

    kept.sort(key=lambda item: item["daily"], reverse=True)
    return kept, notes


def withhold_seeding_stations_from_grading(
    counts_csv: Path, output_csv: Path, stations_consumed: Sequence[str]
) -> dict[str, Any]:
    """Drop the stations that set the boundary traffic from the grading set.

    Seeding a gateway from a count and then reporting how closely the model
    matches that same count is marking your own exam — the same rule the
    calibration split already enforces, applied to demand. The count of what was
    withheld travels with the run, because a validation set that quietly shrank
    reads as a study area with fewer stations.
    """
    from gateway_counts import assert_counts_not_reused_for_grading

    consumed = {str(station) for station in stations_consumed if str(station)}
    if not consumed:
        return {"stations_withheld": 0, "counts_csv": None,
                "note": "No gateway was seeded from a published count, so nothing was withheld."}

    with counts_csv.open(newline="") as handle:
        reader = csv.DictReader(handle)
        fieldnames = reader.fieldnames or []
        rows = list(reader)
    kept = [row for row in rows if str(row.get("station_id") or "") not in consumed]

    ensure_dir(output_csv.parent)
    with output_csv.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(kept)

    # Belt and braces, and it costs nothing: if the filter above ever stops
    # working, this says so instead of publishing a self-graded accuracy figure.
    assert_counts_not_reused_for_grading(consumed, [row.get("station_id", "") for row in kept])
    return {
        "stations_withheld": len(rows) - len(kept),
        "stations_remaining": len(kept),
        "counts_csv": str(output_csv),
        "note": (
            f"{len(rows) - len(kept)} station(s) set how much traffic enters the study area and "
            "are therefore excluded from the accuracy comparison; a model cannot be graded on the "
            "numbers it was built from."
        ),
    }


def seed_boundary_traffic_from_counts(
    gateways: list[dict[str, Any]], counts_csv: Path
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Replace each boundary crossing's guessed volume with a measured one where one exists.

    Wiring, not new logic: `gateway_counts.py` was written, tested and never
    called by anything. It refuses a match that cannot prove BOTH road identity
    and closeness, because matching on proximity alone once paired a motorway
    crossing with a count on a different highway 1.2 miles away reading 3,150
    where the freeway carries 33,000.

    Every gateway comes back saying which basis it used, so a crossing running
    on the class default is visible rather than blended in with the measured
    ones. Stations consumed here are recorded so the accuracy check can exclude
    them: grading the model on the numbers that built it measures nothing.
    """
    from gateway_counts import seed_gateways_from_counts

    with counts_csv.open(newline="") as handle:
        counts = list(csv.DictReader(handle))
    return seed_gateways_from_counts(gateways, counts)


def build_external_zone_rows(gateways: list[dict[str, Any]], first_zone_id: int) -> pd.DataFrame:
    """One zone per gateway, centred on the point its highway crosses the boundary.

    These are ORDINARY ROWS in the zone table, which is the whole trick: the
    centroid-attachment pass that already runs for every zone then builds a
    centroid node at the crossing and connects it to the nearest real node — and
    at a boundary crossing on a highway, the nearest real node is on that
    highway. No new connector machinery, and no way for a gateway's traffic to
    appear anywhere except the road it actually arrives on.

    Every land-use figure is zero, and that is load-bearing rather than tidy.
    Zero population and zero jobs keep these zones out of the internal trip
    purposes (whose shares are population- and employment-weighted), keep them
    out of the resident-VMT numerator, and leave the population denominator
    exactly what it was — the study area's real residents, counted once.
    """
    if not gateways:
        return pd.DataFrame(columns=EXTERNAL_ZONE_COLUMNS)

    rows = []
    for offset, gateway in enumerate(gateways):
        rows.append(
            {
                "GEOID": f"EXT{first_zone_id + offset:04d}",
                "NAMELSAD": f"External gateway: {gateway['label']}",
                "zone_id": int(first_zone_id + offset),
                "centroid_lon": float(gateway["boundary_lon"]),
                "centroid_lat": float(gateway["boundary_lat"]),
                # No land area: an external zone is a point on the cordon, not a
                # place. It also means `intrazonal_miles` can never invent a trip
                # length for one.
                "area_sq_mi": 0.0,
                "total_jobs": 0.0,
                "retail_jobs": 0.0,
                "health_jobs": 0.0,
                "education_jobs": 0.0,
                "accommodation_jobs": 0.0,
                "govt_jobs": 0.0,
                "est_population": 0.0,
                "households": 0.0,
                "worker_residents": 0.0,
                "area_share": 0.0,
                "zone_kind": "external",
            }
        )
    return pd.DataFrame(rows, columns=EXTERNAL_ZONE_COLUMNS)


def external_zone_ids(zones_df: pd.DataFrame) -> list[int]:
    """Zone ids that are cordon points rather than places.

    Reads the `zone_kind` column rather than assuming external zones sort last
    or carry zero population — a real tract with no measured residents would
    otherwise be mistaken for a gateway and dropped from the VMT numerator,
    which is the exact class of error this whole change exists to remove.
    """
    if "zone_kind" not in zones_df.columns:
        return []
    return [int(z) for z in zones_df.loc[zones_df["zone_kind"] == "external", "zone_id"]]


def build_external_gateway_matrix(gateways: list[dict[str, Any]], zones_df: pd.DataFrame) -> np.ndarray:
    """Trips entering and leaving the study area, loaded AT the cordon.

    `gateway["zone_id"]` is the gateway's own external zone — a point on the
    boundary whose connector meets the crossing highway — rather than whichever
    resident tract happened to be nearest. That single index change is what
    moved a county's through traffic off a forest road and onto the interstate
    it actually uses.

    THE RULES LIVE IN THE WORKER and are imported, not restated. There were
    three implementations of this on 2026-08-18: this one, an unused copy in
    `workers/aequilibrae_worker/gateways.py`, and an inline third inside the
    worker's assignment stage. Only the third routed a share of a two-crossing
    route straight across the study area, so the two lanes disagreed about
    whether a car can drive across a county — and the worker module's header
    asked a human to "keep this in step with the county lane", which is the
    convention that failed.

    `EXTERNAL_PASSTHROUGH=0` reproduces a measurement taken before pass-through
    reached this lane.
    """
    return worker_build_external_gateway_matrix(
        gateways,
        zones_df,
        passthrough_share=GATEWAY_PASSTHROUGH_SHARE if EXTERNAL_PASSTHROUGH else 0.0,
        zone_id_field="zone_id",
    )


def write_od_csv(od_matrix: np.ndarray, zone_ids: list[int], output_path: Path) -> None:
    df = pd.DataFrame(np.round(od_matrix, 2), index=zone_ids, columns=[str(zid) for zid in zone_ids])
    df.index.name = "origin_zone"
    df.to_csv(output_path)


def synthesize_demand(
    zones_df: pd.DataFrame,
    skim_matrix: np.ndarray,
    gateways: list[dict[str, Any]],
    package_dir: Path,
    overall_demand_scalar: float = 1.0,
    external_demand_scalar: float = 1.0,
    hbw_scalar: float = 1.0,
    hbo_scalar: float = 1.0,
    nhb_scalar: float = 1.0,
    supplied_internal_matrix: np.ndarray | None = None,
    convert_person_trips_to_vehicles: bool = CONVERT_PERSON_TRIPS_TO_VEHICLES,
    distance_matrix: np.ndarray | None = None,
    split_non_auto_modes: bool = SPLIT_NON_AUTO_MODES,
) -> dict[str, Any]:
    """Assemble the trip matrix this run will assign.

    `supplied_internal_matrix` replaces the built-in gravity model with a matrix
    some other demand model produced — the worker lane's finer block-group
    package, or an activity-based model's trip table. Everything AFTER the
    demand still happens here and happens identically: cordon traffic is added,
    unreachable pairs are masked, scalars apply, and the same file is written.
    That is the point. A comparison between two demand models is only readable
    if every step downstream of the demand is the same step.

    The purpose split (home-based work / other / non-home-based) is a property
    of THIS model, so a supplied matrix reports its trips under `supplied_trips`
    and leaves the three purpose layers at zero rather than inventing a
    breakdown it was never given.
    """
    zone_ids = zones_df["zone_id"].astype(int).tolist()
    # External zones are cordon points, not places: nobody lives or works at
    # one, so no internal trip purpose may produce or attract there. The floors
    # a few lines below (`np.maximum(..., 1)`) exist to stop a zone with no
    # measured jobs from becoming unreachable, and would otherwise hand every
    # gateway a trip end of its own — putting local errands on an interstate
    # cordon and blurring the exact separation this zone kind exists to draw.
    internal = (zones_df["zone_kind"] == "internal").to_numpy(dtype=float)
    pop = zones_df["est_population"].to_numpy(dtype=float)
    households = zones_df["households"].to_numpy(dtype=float)
    workers = zones_df["worker_residents"].to_numpy(dtype=float)
    jobs = zones_df["total_jobs"].to_numpy(dtype=float)
    retail = zones_df["retail_jobs"].to_numpy(dtype=float)
    service = (
        zones_df["health_jobs"].to_numpy(dtype=float)
        + zones_df["education_jobs"].to_numpy(dtype=float)
        + zones_df["accommodation_jobs"].to_numpy(dtype=float)
        + zones_df["govt_jobs"].to_numpy(dtype=float)
    )

    zero = np.zeros((len(zone_ids), len(zone_ids)), dtype=float)
    if supplied_internal_matrix is not None:
        supplied = expand_matrix_for_cordons(supplied_internal_matrix, len(zone_ids))
        hbw = hbo = nhb = zero
    else:
        supplied = zero
        hbw_prod = np.maximum(workers, households * 0.35) * internal
        hbw_attr = np.maximum(jobs, 10) * internal
        hbw = gravity_distribute(hbw_prod, hbw_attr, skim_matrix, HBW_GAMMA * GAMMA_MULTIPLIER) * hbw_scalar

        hbo_prod = np.maximum(pop * HBO_PROD_RATE, 1) * internal
        hbo_attr = np.maximum(retail * HBO_ATTR_RETAIL_RATE + service * HBO_ATTR_SERVICE_RATE + pop * HBO_ATTR_POP_RATE, 1) * internal
        hbo = gravity_distribute(hbo_prod, hbo_attr, skim_matrix, HBO_GAMMA * GAMMA_MULTIPLIER) * hbo_scalar

        nhb_prod = np.maximum(pop * NHB_PROD_RATE, 1) * internal
        nhb_attr = np.maximum(jobs * NHB_ATTR_EMP_RATE, 1) * internal
        nhb = gravity_distribute(nhb_prod, nhb_attr, skim_matrix, NHB_GAMMA * GAMMA_MULTIPLIER) * nhb_scalar

    # WALKING AND CYCLING ARE NOT CARS. This lane assigned every generated
    # person trip to the road network, including the ones nobody drove. The
    # worker has had a mode-choice model since it was written; the rules are
    # imported from it rather than restated, and with no transit skim the split
    # is auto-versus-active only, which is the honest result of having no
    # transit data rather than a fabricated transit share.
    #
    # Needs DISTANCE as well as time: a two-mile crawl and a twenty-mile
    # freeway run can share a duration and are not the same walking decision.
    # Without a distance skim the split is skipped and the run says so, because
    # guessing distance from time would invent the very thing being decided.
    mode_split_applied: dict[str, Any] | None = None
    if split_non_auto_modes and supplied_internal_matrix is None and distance_matrix is not None:
        from mode_choice import mode_share_matrices

        area = zones_df["area_sq_mi"].to_numpy(dtype=float)
        density = np.divide(pop, np.maximum(area, 1e-9) * 2.58999, out=np.zeros_like(pop), where=area > 0)
        # THE SKIM IS IN METRES; the mode model wants miles. Passed unconverted
        # it asks whether anyone would walk thirty-five thousand miles, answers
        # no, and returns a 98.5% auto share that looks like a rural county
        # rather than a unit error. Same shape as the six inert corrections
        # found earlier today, and I made this one.
        distance_miles = np.asarray(distance_matrix, dtype=float) / METERS_PER_MILE
        p_auto, _, p_active = mode_share_matrices(skim_matrix, distance_miles, None, density)
        before = float(hbw.sum() + hbo.sum() + nhb.sum())
        hbw, hbo, nhb = hbw * p_auto, hbo * p_auto, nhb * p_auto
        after = float(hbw.sum() + hbo.sum() + nhb.sum())
        mode_split_applied = {
            "auto_share_of_person_trips": round(after / before, 4) if before else None,
            "transit": "not modelled — no transit skim was supplied, so no transit share is claimed",
            "source": "workers/aequilibrae_worker/mode_choice.py, the worker lane's own model",
            # Routed network distance, where the worker uses straight-line
            # centroid separation. Recorded because the two lanes' splits will
            # differ slightly and a reader should know why.
            "distance_basis": "routed network distance from the skim, converted from metres to miles",
            "median_trip_miles": round(float(np.median(distance_miles[np.isfinite(distance_miles) & (distance_miles > 0)])), 2),
        }

    # PERSON TRIPS BECOME VEHICLE TRIPS HERE, and nowhere else in this lane.
    # Applied after distribution and before anything is assigned, so the trip
    # totals a reader sees in the manifest stay person-scale (which is what the
    # published trip rates are) while the network carries vehicles.
    occupancy_applied: dict[str, float] | None = None
    if convert_person_trips_to_vehicles and supplied_internal_matrix is None:
        hbw = hbw / VEHICLE_OCCUPANCY["hbw"]
        hbo = hbo / VEHICLE_OCCUPANCY["hbo"]
        nhb = nhb / VEHICLE_OCCUPANCY["nhb"]
        occupancy_applied = dict(VEHICLE_OCCUPANCY)

    if external_demand_scalar != 1.0:
        gateways = [
            {
                **gateway,
                "daily_in": float(gateway["daily_in"]) * external_demand_scalar,
                "daily_out": float(gateway["daily_out"]) * external_demand_scalar,
                "daily": float(gateway.get("daily", 0.0)) * external_demand_scalar,
            }
            for gateway in gateways
        ]
    external = build_external_gateway_matrix(gateways, zones_df)

    valid_pairs = np.isfinite(skim_matrix) & (skim_matrix > 0)
    np.fill_diagonal(valid_pairs, True)
    total = (hbw + hbo + nhb + supplied + external) * valid_pairs
    if overall_demand_scalar != 1.0:
        total = total * overall_demand_scalar
        hbw = hbw * overall_demand_scalar
        hbo = hbo * overall_demand_scalar
        nhb = nhb * overall_demand_scalar
        supplied = supplied * overall_demand_scalar
        external = external * overall_demand_scalar

    write_od_csv(total, zone_ids, package_dir / "od_trip_matrix.csv")
    # The two halves, kept apart for calibration. External demand is a third of
    # a rural county's travel and is the most-guessed part of the model — a flat
    # lookup by road class — so being able to scale it WITHOUT touching resident
    # travel is what lets a calibration correct the guess instead of smearing
    # the correction across trips that were never in doubt.
    internal_component = (hbw + hbo + nhb + supplied) * valid_pairs
    external_component = external * valid_pairs
    if overall_demand_scalar != 1.0:
        internal_component = internal_component * overall_demand_scalar
        external_component = external_component * overall_demand_scalar
    layers = {
        # Which demand model produced this, named rather than inferred. A run
        # whose trips came from somewhere else must never read like one this
        # model generated — that distinction is the entire basis on which two
        # demand models can be compared.
        "demand_source": "supplied_package" if supplied_internal_matrix is not None else "gravity_v1",
        "hbw_trips": round(float(hbw.sum()), 2),
        "hbo_trips": round(float(hbo.sum()), 2),
        "nhb_trips": round(float(nhb.sum()), 2),
        "supplied_trips": round(float(supplied.sum()), 2),
        "external_trips": round(float(external.sum()), 2),
        "total_trips": round(float(total.sum()), 2),
        "trip_rates": {
            "hbw_gamma": HBW_GAMMA,
            "hbo_prod_per_person": HBO_PROD_RATE,
            "nhb_prod_per_person": NHB_PROD_RATE,
            "gravity_gamma_hbo": HBO_GAMMA,
            "gravity_gamma_nhb": NHB_GAMMA,
            "overall_demand_scalar": overall_demand_scalar,
            "external_demand_scalar": external_demand_scalar,
            "hbw_scalar": hbw_scalar,
            "hbo_scalar": hbo_scalar,
            "nhb_scalar": nhb_scalar,
            # The single number that scales the whole internal demand. Recorded
            # because a reader comparing two runs, or this model against an
            # activity-based one, is entitled to see the unit conversion rather
            # than have it buried.
            "vehicle_occupancy_applied": occupancy_applied,
            "mode_split_applied": mode_split_applied,
        },
        "external_gateways": gateways,
        "files": {"od_trip_matrix": "package/od_trip_matrix.csv"},
    }
    (package_dir / "demand_layers.json").write_text(json.dumps(layers, indent=2))
    return {
        "matrix": total,
        "internal_matrix": internal_component,
        "external_matrix": external_component,
        "zone_ids": zone_ids,
        "gateways": gateways,
        "summary": layers,
    }


def export_loaded_links_geojson(project_dir: Path, link_results: pd.DataFrame, run_output_dir: Path) -> dict[str, str]:
    conn = connect_spatialite(project_dir / "project_database.sqlite")
    volume_lookup = {
        int(float(row["link_id"])): row
        for _, row in link_results.iterrows()
        if float(row.get("PCE_tot", 0) or 0) > 0
    }
    features = []
    for link_id, row in volume_lookup.items():
        db_row = conn.execute(
            # `direction` rides along because a count station on a divided
            # highway measures BOTH carriageways while OSM maps them as two
            # one-way links — worth a factor of two on 99% of motorway links.
            # See workers/aequilibrae_worker/count_validation.corridor_volume.
            "SELECT link_id, link_type, COALESCE(name, ''), AsGeoJSON(geometry), COALESCE(direction, 0) "
            "FROM links WHERE link_id=?",
            (link_id,),
        ).fetchone()
        if not db_row or not db_row[3]:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "link_id": int(db_row[0]),
                    "link_type": db_row[1],
                    "name": db_row[2],
                    "pce_tot": round(float(row.get("PCE_tot", 0) or 0), 2),
                    "pce_ab": round(float(row.get("PCE_AB", 0) or 0), 2),
                    "pce_ba": round(float(row.get("PCE_BA", 0) or 0), 2),
                    "voc_max": round(float(row.get("VOC_max", 0) or 0), 4),
                    # A divided highway is two one-way links in OSM; a count
                    # station measures both. Consumers need to know which they
                    # are looking at.
                    "is_one_way": bool(int(db_row[4] or 0) != 0),
                },
                "geometry": json.loads(db_row[3]),
            }
        )
    conn.close()

    loaded_geojson_path = run_output_dir / "loaded_links.geojson"
    loaded_geojson_path.write_text(json.dumps({"type": "FeatureCollection", "features": features}, indent=2))

    top_features = sorted(features, key=lambda feat: feat["properties"]["pce_tot"], reverse=True)[:250]
    top_geojson_path = run_output_dir / "top_loaded_links.geojson"
    top_geojson_path.write_text(json.dumps({"type": "FeatureCollection", "features": top_features}, indent=2))
    return {
        "loaded_links_geojson": str(loaded_geojson_path),
        "top_loaded_links_geojson": str(top_geojson_path),
    }


def export_retained_network_geojson(
    project_dir: Path,
    run_output_dir: Path,
    *,
    network_state_record: dict[str, Any],
    network_state_digest: str,
) -> str:
    """Write all and only retained roadway geometry for model comparison."""
    expected_digest = assignment_network_state_digest(network_state_record)
    if network_state_digest != expected_digest:
        raise RuntimeError("Retained-network export received a mismatched state digest")
    selected_manifest = network_state_record.get("retained_network_manifest")
    if selected_manifest != retained_network_manifest(project_dir):
        raise RuntimeError("Retained-network export no longer matches the assignment state")
    connection = connect_spatialite(project_dir / "project_database.sqlite")
    try:
        rows = connection.execute(
            "SELECT link_id, link_type, COALESCE(name, ''), AsGeoJSON(geometry) "
            "FROM links ORDER BY link_id"
        ).fetchall()
    finally:
        connection.close()
    features: list[dict[str, Any]] = []
    roadway_ids: list[int] = []
    seen_ids: set[int] = set()
    for raw_link_id, raw_link_type, raw_name, raw_geometry in rows:
        link_id = _strict_integer(raw_link_id, "Retained-network geometry")
        if link_id in seen_ids:
            raise RuntimeError(f"Retained-network geometry duplicates link id {link_id}")
        seen_ids.add(link_id)
        if str(raw_link_type or "").strip().lower() == "centroid_connector":
            continue
        if not raw_geometry:
            raise RuntimeError(f"Retained roadway link {link_id} has no readable geometry")
        try:
            geometry = json.loads(raw_geometry)
        except (TypeError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Retained roadway link {link_id} has invalid geometry") from error
        if not isinstance(geometry, dict):
            raise RuntimeError(f"Retained roadway link {link_id} has invalid geometry")
        roadway_ids.append(link_id)
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "link_id": link_id,
                    "link_type": raw_link_type or "",
                    "name": raw_name or "",
                },
                "geometry": geometry,
            }
        )
    if (
        len(features) != selected_manifest.get("roadway_link_count")
        or _payload_digest(sorted(roadway_ids))
        != selected_manifest.get("roadway_link_ids_digest")
    ):
        raise RuntimeError("Retained-network geometry does not cover its exact roadway manifest")
    output_path = run_output_dir / "retained_network.geojson"
    output_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "metadata": {
                    "retained_network_manifest": selected_manifest,
                    "network_state_digest": network_state_digest,
                    "source_feature_count": len(features),
                },
                "features": features,
            },
            indent=2,
            allow_nan=False,
        )
    )
    return str(output_path)


def run_assignment(
    project_dir: Path,
    centroid_map: dict[int, int],
    demand_matrix: np.ndarray,
    run_output_dir: Path,
    skim_meta: dict[str, Any],
    class_factors: dict[str, float] | None = None,
    write_outputs: bool = True,
) -> dict[str, Any]:
    from aequilibrae.matrix import AequilibraeMatrix
    from aequilibrae.paths import Graph, TrafficAssignment, TrafficClass

    ensure_dir(run_output_dir)
    centroids_sorted = np.array(sorted(int(v) for v in centroid_map.values()))

    demand_path = run_output_dir / "demand.omx"
    demand_mat = AequilibraeMatrix()
    demand_mat.create_empty(
        file_name=str(demand_path),
        zones=len(centroids_sorted),
        matrix_names=["demand"],
        memory_only=False,
    )
    demand_mat.index = centroids_sorted
    demand_mat.matrix["demand"][:, :] = demand_matrix * PEAK_HOUR_FACTOR
    demand_mat.computational_view(["demand"])

    conn = connect_spatialite(project_dir / "project_database.sqlite")
    links_df = pd.read_sql(
        "SELECT link_id, a_node, b_node, direction, distance, modes, "
        "COALESCE(speed_ab, 25) AS speed_ab, "
        "COALESCE(speed_ba, speed_ab, 25) AS speed_ba, "
        "COALESCE(travel_time_ab, 1.0) AS travel_time, "
        "COALESCE(capacity_ab, 400) AS capacity_ab, "
        "COALESCE(capacity_ba, capacity_ab, 400) AS capacity_ba, "
        # Needed to apply per-road-class calibration factors. Selected always,
        # not only when calibrating, so the baseline and every calibrated trial
        # are built from exactly the same query.
        "COALESCE(link_type, '') AS link_type "
        "FROM links",
        conn,
    )
    conn.close()
    links_df["travel_time"] = pd.to_numeric(links_df["travel_time"], errors="coerce").fillna(1.0).clip(lower=0.01)
    links_df["capacity_ab"] = pd.to_numeric(links_df["capacity_ab"], errors="coerce").fillna(400).clip(lower=1)
    links_df["capacity_ba"] = pd.to_numeric(links_df["capacity_ba"], errors="coerce").fillna(400).clip(lower=1)
    links_df["speed_ab"] = pd.to_numeric(links_df["speed_ab"], errors="coerce").fillna(25).clip(lower=1)
    links_df["speed_ba"] = pd.to_numeric(links_df["speed_ba"], errors="coerce").fillna(25).clip(lower=1)
    links_df["distance"] = pd.to_numeric(links_df["distance"], errors="coerce").fillna(0.01).clip(lower=0.01)
    links_df["direction"] = pd.to_numeric(links_df["direction"], errors="coerce").fillna(0).astype(int)
    links_df = apply_class_factors(links_df, class_factors)

    graph = Graph()
    graph.network = links_df.copy()
    with warnings.catch_warnings(record=True) as caught_warnings:
        warnings.simplefilter("always")
        graph.prepare_graph(centroids_sorted, remove_dead_ends=False)
    prepared_graph_df = getattr(graph, "graph", pd.DataFrame())
    graph_columns = list(prepared_graph_df.columns)
    missing_centroids = extract_missing_centroids_from_warnings(caught_warnings)
    time_field = "travel_time" if "travel_time" in graph_columns else "distance"
    capacity_field = next(
        (field for field in ["capacity_ab", "capacity", "capacity_ba"] if field in graph_columns),
        None,
    )
    if capacity_field is None:
        raise RuntimeError(f"No usable capacity field found in prepared graph columns: {graph_columns}")
    graph.set_graph(time_field)
    graph.set_blocked_centroid_flows(True)

    applied_network_settings = assignment_network_settings(class_factors)
    applied_network_settings_payload = network_settings_payload_json(
        applied_network_settings
    )
    applied_network_settings_digest = network_settings_digest(
        applied_network_settings, applied_network_settings_payload
    )
    traffic_class = TrafficClass(name="car", graph=graph, matrix=demand_mat)
    applied_assignment_profile = assignment_profile(
        capacity_field=capacity_field,
        time_field=time_field,
    )
    require_local_assignment_engine(applied_assignment_profile)
    assignment = TrafficAssignment()
    traffic_class.set_pce(applied_assignment_profile["class_pce"])
    assignment.add_class(traffic_class)
    assignment.set_cores(applied_assignment_profile["cores"])
    require_effective_assignment_cores(assignment, applied_assignment_profile["cores"])
    assignment.set_vdf(applied_assignment_profile["vdf"])
    assignment.set_vdf_parameters(dict(applied_assignment_profile["vdf_parameters"]))
    assignment.set_capacity_field(applied_assignment_profile["capacity_field"])
    assignment.set_time_field(applied_assignment_profile["time_field"])
    assignment.max_iter = applied_assignment_profile["max_iterations"]
    assignment.rgap_target = applied_assignment_profile["target_gap"]
    assignment.set_algorithm(applied_assignment_profile["algorithm"])
    network_state_record, network_state_digest_value = assignment_network_state(
        assignment,
        graph,
        centroids_sorted,
        project_dir,
        network_settings_digest_value=applied_network_settings_digest,
    )
    assignment.execute()

    rgap = getattr(assignment.assignment, "rgap", float("nan"))
    iterations = assignment_iteration_count(assignment.assignment)
    results = assignment.results()
    if hasattr(results, "get_load_results"):
        link_results = results.get_load_results()
    else:
        link_results = results
    if "link_id" not in link_results.columns:
        link_results = link_results.reset_index()
        if "link_id" not in link_results.columns:
            link_results = link_results.rename(columns={link_results.columns[0]: "link_id"})
    if "PCE_tot" in link_results.columns:
        link_results["PCE_tot"] = link_results["PCE_tot"] / PEAK_HOUR_FACTOR
        if "PCE_AB" in link_results.columns:
            link_results["PCE_AB"] = link_results["PCE_AB"] / PEAK_HOUR_FACTOR
        if "PCE_BA" in link_results.columns:
            link_results["PCE_BA"] = link_results["PCE_BA"] / PEAK_HOUR_FACTOR
    # A calibration TRIAL must not overwrite the run's published outputs: it may
    # be rejected, and a rejected trial's link volumes on disk would be the
    # numbers a planner reads. The loop re-runs once more with the accepted
    # factors and writes then.
    geojson_paths: dict[str, str] = {}
    if write_outputs:
        link_results.to_csv(run_output_dir / "link_volumes.csv", index=False)
        geojson_paths = export_loaded_links_geojson(project_dir, link_results, run_output_dir)
        geojson_paths["retained_network_geojson"] = export_retained_network_geojson(
            project_dir,
            run_output_dir,
            network_state_record=network_state_record,
            network_state_digest=network_state_digest_value,
        )

    # Unfiltered network VMT (all loaded links, external/through travel included);
    # links.distance is metres — converted inside compute_network_daily_vmt.
    network_daily_vmt = None
    if "PCE_tot" in link_results.columns:
        volumes_by_link = link_results.set_index("link_id")["PCE_tot"]
        distances = links_df.set_index("link_id")["distance"].reindex(volumes_by_link.index).fillna(0.0)
        network_daily_vmt = round(
            compute_network_daily_vmt(volumes_by_link.to_numpy(), distances.to_numpy()), 1
        )

    return {
        "network_daily_vehicle_miles": network_daily_vmt,
        "network_vmt_basis": (
            "Σ link daily volume × link length over all loaded links, external/through "
            "travel included; not the resident-VMT figure used for CEQA screening."
        ),
        # SAYS WHETHER IT CONVERGED, rather than leaving a reader to compare two
        # numbers. The gap and the target were both recorded before and a run
        # that stopped at 0.0243 against a 0.01 target looked, at a glance,
        # exactly like one that reached 0.008 — the reader had to notice the
        # inequality themselves, and nobody did for as long as this has existed.
        # An unconverged assignment's link volumes are a number taken from the
        # middle of a calculation, so the run has to say so out loud.
        "convergence": assignment_convergence(
            rgap,
            iterations,
            ASSIGNMENT_MAX_ITERATIONS,
            profile=applied_assignment_profile,
        ),
        "network_settings": applied_network_settings,
        "network_settings_payload_json": applied_network_settings_payload,
        "network_settings_digest": applied_network_settings_digest,
        "network_state_record": network_state_record,
        "network_state_digest": network_state_digest_value,
        "network": {
            "links": int(graph.num_links),
            "nodes": int(graph.num_nodes),
            "zones": int(len(centroids_sorted)),
            "missing_centroids_in_graph": missing_centroids,
            "graph_centroid_coverage_pct": round(100 * (len(centroids_sorted) - len(missing_centroids)) / max(len(centroids_sorted), 1), 2),
        },
        "demand": {
            "total_trips": float(np.round(demand_matrix.sum(), 2)),
            "peak_hour_factor": PEAK_HOUR_FACTOR,
        },
        "loaded_links": int((link_results["PCE_tot"] > 0).sum()) if "PCE_tot" in link_results.columns else 0,
        "link_results_path": str(run_output_dir / "link_volumes.csv"),
        # Daily volume per link, so a calibration trial can be scored without
        # reading a file it deliberately did not write.
        "volumes_by_link": (
            {int(k): float(v) for k, v in link_results.set_index("link_id")["PCE_tot"].items()}
            if "PCE_tot" in link_results.columns
            else {}
        ),
        **geojson_paths,
    }


def collect_engine_versions() -> dict[str, str]:
    import sys

    def _pkg_version(package: str) -> str:
        try:
            return importlib_metadata.version(package)
        except importlib_metadata.PackageNotFoundError:
            return "unknown"

    return {
        "aequilibrae": _pkg_version("aequilibrae"),
        "numpy": _pkg_version("numpy"),
        "pandas": _pkg_version("pandas"),
        "python": sys.version.split()[0],
    }


def run_screening_model(
    *,
    name: str,
    boundary_geojson: str | None = None,
    county_fips: str | None = None,
    output_root: str | None = None,
    cache_dir: str | None = None,
    network_buffer_miles: float = 2.0,
    keep_project: bool = False,
    force: bool = False,
    counts_csv: str | None = None,
    ready_median_ape: float = 30.0,
    ready_critical_ape: float = 50.0,
    required_matches: int = 3,
    overall_demand_scalar: float = 1.0,
    external_demand_scalar: float = 1.0,
    hbw_scalar: float = 1.0,
    hbo_scalar: float = 1.0,
    nhb_scalar: float = 1.0,
    demand_package_dir: str | None = None,
    zone_package_dir: str | None = None,
    calibrate_counts_csv: str | None = None,
    seed_gateways_from_published_counts: bool = SEED_GATEWAYS_FROM_COUNTS,
    passthrough_from_counts: bool = PASSTHROUGH_FROM_COUNTS,
    counts_mode: str | None = None,
    calibrate_to_counts: bool = False,
    reuse_network_from: str | None = None,
    zone_geography: str = DEFAULT_ZONE_GEOGRAPHY,
) -> dict[str, Any]:
    # THE ONE COMBINATION THAT IS REFUSED. Calibrating and then validating
    # against the SAME count file grades the model on most of the data it was
    # just fitted to, and produces a flattering number that means nothing. It is
    # the single easiest way to lie with a calibration, it looks like diligence,
    # and nothing downstream could detect it — so it is refused here rather than
    # caveated.
    if (
        calibrate_counts_csv
        and counts_csv
        and Path(calibrate_counts_csv).expanduser().resolve() == Path(counts_csv).expanduser().resolve()
    ):
        raise RuntimeError(
            "Refusing to calibrate and validate against the same count file "
            f"({counts_csv}). Most of those stations are used to FIT the model, so validating on "
            "them reports the accuracy of the data it was fitted to. Either read the calibration's "
            "own held-out figure — it is computed from counts kept back for exactly this purpose "
            "and reported as `holdout_median_ape` — or pass a separate count set to --counts-csv."
        )

    repo_root = Path(__file__).resolve().parents[2]
    output_root_path = Path(output_root).expanduser().resolve() if output_root else repo_root / "data" / "screening-runs"
    cache_path = Path(cache_dir).expanduser().resolve() if cache_dir else repo_root / "data" / "_screening_cache"
    run_dir = output_root_path / slugify(name)
    if run_dir.exists():
        if not force:
            raise RuntimeError(f"Output directory already exists: {run_dir}. Re-run with --force to replace it.")
        shutil.rmtree(run_dir)

    ensure_dir(run_dir)
    boundary_dir = ensure_dir(run_dir / "boundary")
    package_dir = ensure_dir(run_dir / "package")
    run_output_dir = ensure_dir(run_dir / "run_output")
    ensure_dir(run_dir / "work")
    ensure_dir(cache_path)

    stage_seconds: dict[str, float] = {}

    def _timed(stage: str, fn, *args, **kwargs):
        started = time.monotonic()
        result = fn(*args, **kwargs)
        stage_seconds[stage] = round(time.monotonic() - started, 2)
        return result

    # Before any download: the one misconfiguration every fresh install has.
    preflight_census_access()

    boundary_meta = _timed("boundary", resolve_boundary, boundary_geojson, county_fips, cache_path)
    boundary_path = write_boundary_artifact(boundary_meta["geometry"], boundary_dir)
    boundary_meta["artifact_path"] = str(boundary_path)

    # ZONES AND DEMAND COME FROM ONE OF TWO PLACES, and everything after this
    # point is identical either way — that sameness is what lets two demand
    # models be compared on the same corridors.
    if demand_package_dir and zone_package_dir:
        raise RuntimeError(
            "Use --demand-package-dir OR --zone-package-dir, not both: the first supplies zones AND "
            "trips, the second supplies zones and lets this model generate the trips. Passing both "
            "would leave it ambiguous which demand was assigned."
        )
    supplied_package = read_demand_package(Path(demand_package_dir)) if demand_package_dir else None
    if supplied_package is None and zone_package_dir:
        supplied_package = read_zone_package(Path(zone_package_dir))
    if supplied_package is not None:
        zones_df = supplied_package["zones"]
        zone_meta = {
            "zones": int(len(zones_df)),
            "zone_type": (
                "supplied-demand-package" if demand_package_dir else "supplied-zones-built-in-demand"
            ),
            "total_population": float(zones_df["est_population"].sum()),
            "total_households": float(zones_df["households"].sum()),
            "total_worker_residents": float(zones_df["worker_residents"].sum()),
            "total_jobs_est": float(zones_df["total_jobs"].sum()),
            "demand_package": supplied_package["provenance"],
            "files": {
                "zone_attributes": "package/zone_attributes.csv",
                "zone_centroids_geojson": "package/zone_centroids.geojson",
            },
        }
        stage_seconds["zones"] = 0.0
    else:
        zones_df, zone_meta = _timed(
            "zones", build_zone_package, boundary_meta["geometry"], package_dir, cache_path,
            zone_geography,
        )
    # The network stage adds one external zone per boundary-crossing highway, so
    # it hands the zone table back rather than taking it read-only.
    network_meta, zones_df = _timed(
        "network",
        build_network,
        run_dir,
        boundary_meta["geometry"],
        zones_df,
        network_buffer_miles,
        reuse_network_from,
    )
    # Reassigned, not just called: the cordon counts and the zone-system label
    # belong in the run summary too, and a discarded return value would leave
    # `package_manifest.json` and the summary quietly describing different zone
    # systems.
    zone_meta = write_zone_package_files(zones_df, package_dir, zone_meta)
    project_dir = Path(network_meta["project_dir"])

    # PUBLISHED COUNTS ARE FETCHED HERE, BEFORE DEMAND, because they now do two
    # jobs and the second one has to happen first.
    #
    # They grade the finished assignment, which is why this used to sit after
    # it. But they also SEED the boundary traffic: measured 2026-08-18, a median
    # 68% of everything a screening run assigns is traffic injected at the
    # study-area edge on a flat figure by road class — the same number in every
    # county in the country, observed nowhere. A published count on the road
    # where it crosses the boundary is a measurement of exactly that quantity.
    #
    # Fetching needs the network and the boundary, not the assignment, so moving
    # it earlier costs nothing and downloads nothing twice.
    #
    # Nothing is asked of the planner. The study area's own boundary says which
    # state it is in, and state DOTs publish this without a key.
    auto_counts_meta: dict[str, Any] | None = None
    if counts_mode == "auto":
        auto_counts_meta = _timed(
            "counts",
            fetch_study_area_counts,
            county_fips=county_fips,
            zone_meta=zone_meta,
            boundary_path=boundary_path,
            project_dir=project_dir,
            run_dir=run_dir,
            boundary_geom=boundary_meta["geometry"],
            calibrate=bool(calibrate_to_counts),
        )
        if auto_counts_meta.get("counts_csv"):
            counts_csv = auto_counts_meta.get("validation_counts_csv") or auto_counts_meta["counts_csv"]
        if auto_counts_meta.get("calibration_counts_csv"):
            calibrate_counts_csv = auto_counts_meta["calibration_counts_csv"]

    passthrough_bounds: dict[str, Any] | None = None
    if passthrough_from_counts and auto_counts_meta and auto_counts_meta.get("counts_csv"):
        with Path(auto_counts_meta["counts_csv"]).open(newline="") as handle:
            passthrough_bounds = attach_passthrough_ceilings(network_meta["gateways"], list(csv.DictReader(handle)))

    gateway_seeding: dict[str, Any] | None = None
    if seed_gateways_from_published_counts and auto_counts_meta and auto_counts_meta.get("counts_csv"):
        network_meta["gateways"], gateway_seeding = seed_boundary_traffic_from_counts(
            network_meta["gateways"], Path(auto_counts_meta["counts_csv"])
        )
        # A station that set how much traffic ENTERS the study area cannot also
        # grade how well the model reproduces it. Withheld from the validation
        # set rather than refused at the end of the run: the run is fine, it is
        # the exam that needs one fewer question.
        withheld = withhold_seeding_stations_from_grading(
            Path(counts_csv) if counts_csv else Path(auto_counts_meta["counts_csv"]),
            run_dir / "counts" / "counts_for_grading.csv",
            gateway_seeding.get("stations_consumed") or [],
        )
        gateway_seeding["grading"] = withheld
        if withheld["counts_csv"]:
            counts_csv = withheld["counts_csv"]

    skim_meta = _timed("skims", compute_freeflow_skims, project_dir, network_meta["centroid_map"], run_output_dir)
    demand_meta = _timed(
        "demand",
        synthesize_demand,
        zones_df,
        skim_meta["matrix"],
        network_meta["gateways"],
        package_dir,
        overall_demand_scalar=overall_demand_scalar,
        external_demand_scalar=external_demand_scalar,
        hbw_scalar=hbw_scalar,
        hbo_scalar=hbo_scalar,
        nhb_scalar=nhb_scalar,
        supplied_internal_matrix=(supplied_package or {}).get("matrix"),
        distance_matrix=skim_meta.get("distance_matrix"),
    )
    assignment_meta = _timed(
        "assignment", run_assignment, project_dir, network_meta["centroid_map"], demand_meta["matrix"], run_output_dir, skim_meta
    )


    # OPT-IN CALIBRATION. Off unless a count set is named, and it never runs
    # itself: the uncalibrated screening model is what this product ships, and
    # a calibrated run is a different, disclosed claim.
    #
    calibration_meta: dict[str, Any] | None = None
    if calibrate_counts_csv:
        calibration_meta = _timed(
            "calibration",
            calibrate_run_to_counts,
            counts_csv=Path(calibrate_counts_csv),
            project_dir=project_dir,
            run_output_dir=run_output_dir,
            centroid_map=network_meta["centroid_map"],
            demand_matrix=demand_meta["matrix"],
            internal_matrix=demand_meta["internal_matrix"],
            external_matrix=demand_meta["external_matrix"],
            skim_meta=skim_meta,
            baseline_assignment=assignment_meta,
        )
        if calibration_meta.get("assignment"):
            # The final assignment was re-run with the ACCEPTED factors and its
            # outputs written, so downstream reads the calibrated network.
            assignment_meta = calibration_meta.pop("assignment")

    # Internal-resident VMT (the CEQA §15064.3 estimator): internal OD ×
    # centroid distance × circuity, with the cordon zones excluded so travel
    # entering and leaving the study area is not counted as residents' driving.
    #
    # WHAT THE EXTERNAL ZONES FIXED HERE (2026-08-15). This exclusion used to
    # name real census tracts — the ones standing in for gateways — so their
    # residents' own travel was dropped from the numerator while their
    # population stayed in the denominator. On the measured county that was 17%
    # of the population, and it understated vehicle-miles per capita by about a
    # fifth. Now the excluded zones have no residents by construction, so the
    # numerator counts every tract and the denominator is unchanged.
    vmt_inputs = compute_internal_resident_vmt(
        demand_meta["matrix"],
        demand_meta["zone_ids"],
        zones_df["centroid_lon"].to_numpy(dtype=float),
        zones_df["centroid_lat"].to_numpy(dtype=float),
        zones_df["area_sq_mi"].to_numpy(dtype=float),
        zones_df["est_population"].to_numpy(dtype=float),
        # Taken from the zone table's own `zone_kind`, not from the gateway
        # list: the thing being excluded is "zones nobody lives in", and the
        # table is where that is recorded. Deriving it from the gateway list
        # instead is how a real tract came to be excluded in the first place.
        gateway_zone_ids=external_zone_ids(zones_df),
    )
    gateway_id_list = ", ".join(str(z) for z in vmt_inputs["excluded_gateway_zone_ids"])
    vmt_block = {
        "method": "internal_od_centroid_distance",
        "daily_vmt": round(vmt_inputs["daily_vmt"], 1),
        "vmt_per_capita": round(vmt_inputs["vmt_per_capita"], 3),
        "population_total": int(round(vmt_inputs["population"])),
        "internal_trips": round(vmt_inputs["internal_trips"], 1),
        # HOW MUCH OF THIS RUN'S TRAVEL NEVER REACHES A LINK.
        #
        # `compute_internal_resident_vmt` has always counted the OD-matrix
        # diagonal — trips that begin and end in the same zone, which carry VMT
        # and no link volume — and the county lane threw both numbers away. They
        # are what says whether a link-level comparison against observed counts
        # can establish anything at all: OpenPlan's own county validation ran 26
        # zones at 36% intrazonal and the AADT comparison failed for that reason,
        # not because of the demand.
        #
        # A FRACTION, not a percent, matching the `intrazonal_trip_share` KPI the
        # worker emits and the app's panel reads. One name and one unit across
        # both lanes, so a planner comparing two runs never meets two.
        "intrazonal_trips": round(vmt_inputs["intrazonal_trips"], 1),
        "intrazonal_share": round(float(vmt_inputs["intrazonal_share"]), 4),
        "avg_trip_miles": round(vmt_inputs["avg_trip_miles"], 2),
        "circuity": vmt_inputs["circuity"],
        "excluded_gateway_zone_ids": vmt_inputs["excluded_gateway_zone_ids"],
        # HOW MUCH OF RESIDENTS' OWN DRIVING LEAVES THIS AREA — and therefore
        # is NOT in the per-capita figure above, while those residents remain in
        # the population it is divided by.
        #
        # Measured 2026-08-16, and the reason this is reported rather than left
        # implicit: the same county gave 40.5 vehicle-miles per person, and a
        # sub-county area inside it gave 10.8. That is not a quarter of the
        # driving. It is a boundary — half of that smaller area's travel crosses
        # it, against a third of the county's. The smaller the study area, the
        # more the figure understates, and a planner analysing their own town
        # would read 10.8 as a fact about their residents.
        **resident_travel_leaving_share(demand_meta, external_zone_ids(zones_df)),
        "network_daily_vmt_unfiltered": assignment_meta.get("network_daily_vehicle_miles"),
        "provenance": (
            "Internal resident VMT (screening-grade, derived — not measured): "
            f"Σ internal-to-internal OD trips × centroid great-circle distance × {VMT_NETWORK_CIRCUITY} circuity "
            "(intrazonal ≈ 0.5·√(area/π)); the external cordon zones where highways cross the "
            f"study-area boundary [{gateway_id_list}] are excluded so travel entering and leaving "
            "the area is not counted as residents' driving — nobody lives in one, so every "
            "resident zone is counted and the population below is the whole study area; "
            f"divided by resident population {int(round(vmt_inputs['population'])):,}. "
            f"Source artifacts: package/od_trip_matrix.csv + package/zone_attributes.csv ({name})."
        ),
    }
    engine_versions = collect_engine_versions()

    manifest = write_bundle_outputs(
        run_dir=run_dir,
        run_name=name,
        boundary_meta=boundary_meta,
        zone_meta=zone_meta,
        network_meta=network_meta,
        skim_meta=skim_meta,
        demand_meta=demand_meta,
        assignment_meta=assignment_meta,
        keep_project=keep_project,
        vmt=vmt_block,
        engine_versions=engine_versions,
        calibration=calibration_meta,
        assumptions=model_assumptions(),
        published_counts=auto_counts_meta,
        boundary_traffic_seeding=gateway_seeding,
        passthrough_bounds=passthrough_bounds,
    )
    if assignment_meta.get("retained_network_geojson"):
        manifest.setdefault("artifacts", {})["retained_network_geojson"] = (
            "run_output/retained_network.geojson"
        )
        (run_dir / "bundle_manifest.json").write_text(json.dumps(manifest, indent=2))

    validation_summary = None
    if counts_csv:
        from validate_screening_observed_counts import run_validation_bundle

        counts_csv_path = Path(counts_csv).expanduser().resolve()
        validation_dir = run_dir / "validation"
        validation_started = time.monotonic()
        validation_summary = run_validation_bundle(
            run_output_dir=run_output_dir,
            counts_csv=counts_csv_path,
            output_dir=validation_dir,
            project_db=project_dir / "project_database.sqlite",
            ready_median_ape=ready_median_ape,
            ready_critical_ape=ready_critical_ape,
            required_matches=required_matches,
        )
        stage_seconds["validation"] = round(time.monotonic() - validation_started, 2)
        manifest.setdefault("artifacts", {}).update(
            {
                "validation_results": "validation/validation_results.csv",
                "validation_summary": "validation/validation_summary.json",
                "validation_report": "validation/validation_report.md",
                "validation_candidate_audit_json": "validation/validation_candidate_audit.json",
                "validation_candidate_audit_csv": "validation/validation_candidate_audit.csv",
            }
        )
        manifest["validation"] = {
            "counts_csv": str(counts_csv_path),
            "status_label": validation_summary["screening_gate"]["status_label"],
            "matched_stations": validation_summary["stations_matched"],
            "metrics": validation_summary["metrics"],
        }
        (run_dir / "bundle_manifest.json").write_text(json.dumps(manifest, indent=2))

    if not keep_project and project_dir.exists():
        shutil.rmtree(project_dir)

    summary = build_run_summary(name, run_dir, boundary_meta, zone_meta, demand_meta, assignment_meta, manifest)
    summary["vmt"] = vmt_block
    summary["engine_versions"] = engine_versions
    summary["stage_wall_clock_seconds"] = stage_seconds
    if validation_summary is not None:
        summary["validation"] = {
            "status_label": validation_summary["screening_gate"]["status_label"],
            "matched_stations": validation_summary["stations_matched"],
            "metrics": validation_summary["metrics"],
        }
    (run_dir / "run_summary.json").write_text(json.dumps(summary, indent=2))
    return summary
