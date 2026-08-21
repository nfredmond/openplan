#!/usr/bin/env python3
"""Published vehicle-miles for a county, so an accuracy ratio has a real denominator.

================================================== WHY THIS EXISTS AT ALL

`gamma_fit_analysis.grade_run` scores a model run by dividing its network
vehicle-miles by the county's POPULATION times a STATE per-capita rate. That
asks "do these residents drive the state average?" of a numerator counting every
vehicle on the county's roads, through traffic included. The two are different
quantities, and measured 2026-08-20 the same runs read a median 0.912 built one
way and 2.223 built the other
(`docs/modeling/THE_VMT_RATIO_IS_A_BRACKET_2026-08-20.md`).

A county's roads carry what its geography brings. Scoring that against its
residents scores geography as model error — hardest on small counties astride a
highway, which is much of who OpenPlan is for.

The denominator this module supplies is the county's OWN published travel.

=================================================== WHAT IT IS, EXACTLY

**A derivation, not a published figure**, and it must be labelled as one
wherever it surfaces. FHWA publishes section-level AADT; the county total is
Σ AADT × section length, computed here. FHWA's own Public Release page warns
that "national summaries created by aggregating this data may render different
results from the information presented in FHWA's Highway Statistics tables".

**Federal-aid scope.** HPMS Full Extent is the National Highway System plus all
other roads EXCEPT those functionally classified local or rural minor collector;
travel on those is published only in aggregate by urbanized area, never by
county. So a numerator compared against this must drop its local-road
vehicle-miles too, or the comparison is not scope-matched. OpenPlan's screening
model puts 2.4% of its network vehicle-miles on local streets, so the correction
is small but it is not zero.

**Vintage 2018.** Verified 2026-08-20 as the newest per-state release published
as a queryable service.

============================== WHY THE SERVICE NAMES ARE A TABLE, NOT A RULE

Because the rule does not hold. The names are CamelCase without separators —
`NewMexico_2018_PR`, `NorthCarolina_2018_PR` — and then:

  * the District of Columbia is `District_2018_PR`, not `DistrictOfColumbia`;
  * Alaska is `Alaska_2018_PR_test`, still carrying a `_test` suffix.

A derived name works for 50 of 52 and fails silently for two, which is the
failure this repository keeps paying for. So every name is written down, and an
unregistered state raises instead of guessing.

There is a service called `HPMS_FULL_PR_2022`, and its name is a trap: it holds
**43,860 sections, all of them Puerto Rico**, and returns zero rows for
California, Colorado and Oregon. It is not used here, and a future session that
finds it should not adopt it on the strength of "FULL" and a better year.
"""
from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any, Iterable

#: Every published 2018 HPMS per-state service, verified against the live
#: directory on 2026-08-20. Keyed by state FIPS so callers never handle a name.
HPMS_2018_SERVICE_BY_STATE_FIPS: dict[str, str] = {
    "01": "Alabama_2018_PR", "02": "Alaska_2018_PR_test", "04": "Arizona_2018_PR",
    "05": "Arkansas_2018_PR", "06": "California_2018_PR", "08": "Colorado_2018_PR",
    "09": "Connecticut_2018_PR", "10": "Delaware_2018_PR", "11": "District_2018_PR",
    "12": "Florida_2018_PR", "13": "Georgia_2018_PR", "15": "Hawaii_2018_PR",
    "16": "Idaho_2018_PR", "17": "Illinois_2018_PR", "18": "Indiana_2018_PR",
    "19": "Iowa_2018_PR", "20": "Kansas_2018_PR", "21": "Kentucky_2018_PR",
    "22": "Louisiana_2018_PR", "23": "Maine_2018_PR", "24": "Maryland_2018_PR",
    "25": "Massachusetts_2018_PR", "26": "Michigan_2018_PR", "27": "Minnesota_2018_PR",
    "28": "Mississippi_2018_PR", "29": "Missouri_2018_PR", "30": "Montana_2018_PR",
    "31": "Nebraska_2018_PR", "32": "Nevada_2018_PR", "33": "NewHampshire_2018_PR",
    "34": "NewJersey_2018_PR", "35": "NewMexico_2018_PR", "36": "NewYork_2018_PR",
    "37": "NorthCarolina_2018_PR", "38": "NorthDakota_2018_PR", "39": "Ohio_2018_PR",
    "40": "Oklahoma_2018_PR", "41": "Oregon_2018_PR", "42": "Pennsylvania_2018_PR",
    "44": "RhodeIsland_2018_PR", "45": "SouthCarolina_2018_PR", "46": "SouthDakota_2018_PR",
    "47": "Tennessee_2018_PR", "48": "Texas_2018_PR", "49": "Utah_2018_PR",
    "50": "Vermont_2018_PR", "51": "Virginia_2018_PR", "53": "Washington_2018_PR",
    "54": "WestVirginia_2018_PR", "55": "Wisconsin_2018_PR", "56": "Wyoming_2018_PR",
    "72": "PuertoRico_2018_PR",
}

SERVICE_ROOT = "https://geo.dot.gov/server/rest/services/Hosted"
HPMS_VINTAGE = 2018
#: ArcGIS refuses more than this per page whatever is asked for.
PAGE_SIZE = 2000

#: What one row of the 2018 per-state services calls its fields. The 2022
#: national service uses `stateid`/`county_id`/`beginpoint` instead, so this is
#: declared per feed rather than assumed — the shape is a property of the
#: publication, not of HPMS.
FIELDS_2018 = {
    "county": "county_code",
    "aadt": "aadt",
    "begin": "begin_point",
    "end": "end_point",
    "functional_system": "f_system",
}


class VmtSourceError(RuntimeError):
    """The denominator cannot be produced, with the reason to show."""


def hpms_service(state_fips: str) -> str:
    """The published service for a state, or a refusal naming what is registered."""
    service = HPMS_2018_SERVICE_BY_STATE_FIPS.get(str(state_fips).zfill(2))
    if not service:
        raise VmtSourceError(
            f"No HPMS service registered for state FIPS {state_fips!r}. Registered: "
            f"{sorted(HPMS_2018_SERVICE_BY_STATE_FIPS)}. Add the state's published service "
            "name rather than deriving one — two of the 52 do not follow the pattern."
        )
    return service


def county_query_url(state_fips: str, county_fips: str) -> str:
    """The exact request, built so a caller can paste it into a browser."""
    county = int(str(county_fips)[-3:])
    params = {
        "where": f"{FIELDS_2018['county']}={county}",
        "outFields": ",".join(
            (FIELDS_2018["aadt"], FIELDS_2018["begin"], FIELDS_2018["end"],
             FIELDS_2018["functional_system"])
        ),
        "returnGeometry": "false",
        "f": "json",
    }
    return f"{SERVICE_ROOT}/{hpms_service(state_fips)}/FeatureServer/0/query?" + urllib.parse.urlencode(params)


def county_vmt_from_sections(sections: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Daily vehicle-miles from section rows, with everything it could not use.

    Pure arithmetic so it is testable without a network. A section missing its
    AADT is COUNTED AND REPORTED rather than treated as carrying no traffic:
    "no data" and "no cars" are different facts, and summing the second when the
    first is true is how a denominator quietly becomes too small — which makes a
    model look worse, so nothing about it would look wrong.
    """
    vmt = 0.0
    miles = 0.0
    sections_seen = 0
    without_aadt = 0
    without_length = 0
    by_functional_system: dict[Any, float] = {}
    for row in sections:
        sections_seen += 1
        begin, end = row.get(FIELDS_2018["begin"]), row.get(FIELDS_2018["end"])
        if begin is None or end is None:
            without_length += 1
            continue
        length = float(end) - float(begin)
        if length <= 0:
            without_length += 1
            continue
        miles += length
        aadt = row.get(FIELDS_2018["aadt"])
        if aadt in (None, "", 0):
            without_aadt += 1
            continue
        contribution = float(aadt) * length
        vmt += contribution
        key = row.get(FIELDS_2018["functional_system"])
        by_functional_system[key] = by_functional_system.get(key, 0.0) + contribution
    return {
        "daily_vehicle_miles": round(vmt, 1),
        "centerline_miles": round(miles, 3),
        "sections": sections_seen,
        "sections_without_aadt": without_aadt,
        "sections_without_length": without_length,
        "by_functional_system": {k: round(v, 1) for k, v in sorted(
            by_functional_system.items(), key=lambda kv: (kv[0] is None, kv[0])
        )},
    }


def fetch_county_sections(state_fips: str, county_fips: str, timeout: int = 120) -> list[dict[str, Any]]:
    """Every HPMS section in one county, paged. Network; imports urllib lazily used above."""
    service = hpms_service(state_fips)
    county = int(str(county_fips)[-3:])
    rows: list[dict[str, Any]] = []
    offset = 0
    while True:
        params = {
            "where": f"{FIELDS_2018['county']}={county}",
            "outFields": ",".join(
                (FIELDS_2018["aadt"], FIELDS_2018["begin"], FIELDS_2018["end"],
                 FIELDS_2018["functional_system"])
            ),
            "returnGeometry": "false",
            "f": "json",
            "resultOffset": offset,
            "resultRecordCount": PAGE_SIZE,
        }
        url = f"{SERVICE_ROOT}/{service}/FeatureServer/0/query?" + urllib.parse.urlencode(params)
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                payload = json.load(response)
        except Exception as error:  # noqa: BLE001 - the reason travels to the caller
            raise VmtSourceError(f"HPMS request failed for {service} county {county}: {error}") from error
        if "error" in payload:
            raise VmtSourceError(f"HPMS refused the query for {service} county {county}: {payload['error']}")
        features = payload.get("features", [])
        rows.extend(f.get("attributes", {}) for f in features)
        if len(features) < PAGE_SIZE or not payload.get("exceededTransferLimit"):
            break
        offset += PAGE_SIZE
    return rows


def county_vmt(state_fips: str, county_fips: str, timeout: int = 120) -> dict[str, Any]:
    """The county's published daily vehicle-miles, derived, with its provenance.

    Raises rather than returning zero when the county has no sections. A county
    with no federal-aid roads is possible; a typo in a FIPS code is likelier,
    and both look identical in a number. The caller is told which it must
    resolve.
    """
    sections = fetch_county_sections(state_fips, county_fips, timeout=timeout)
    if not sections:
        raise VmtSourceError(
            f"HPMS returned no sections for state {state_fips} county {county_fips}. Either the "
            "county has no federal-aid roads or the code is wrong; this refuses rather than "
            "reporting zero vehicle-miles, which those two cases are indistinguishable in."
        )
    result = county_vmt_from_sections(sections)
    result.update(
        state_fips=str(state_fips).zfill(2),
        county_fips=str(county_fips),
        source="FHWA Highway Performance Monitoring System, public release",
        source_service=hpms_service(state_fips),
        source_url=county_query_url(state_fips, county_fips),
        vintage=HPMS_VINTAGE,
        derivation="Σ AADT × (end_point − begin_point) over the county's sections",
        scope=(
            "HPMS Full Extent: the National Highway System plus all other roads EXCEPT those "
            "functionally classified local or rural minor collector. A numerator compared "
            "against this must exclude its local-road travel too."
        ),
        is_published_figure=False,
        not_reconciled_note=(
            "FHWA states that summaries aggregated from this release may differ from its "
            "Highway Statistics tables. This is a derivation, not a published county figure."
        ),
    )
    return result


#: The OSM classes HPMS Full Extent does NOT publish by county, and which a
#: numerator compared against it must therefore drop.
#:
#: HPMS excludes roads functionally classified LOCAL or RURAL MINOR COLLECTOR.
#: OpenPlan's network is OSM, whose classes are not FHWA's functional system, so
#: this mapping is a judgement — stated here rather than hidden, and deliberately
#: narrow: only the classes nobody would argue are federal-aid roads.
#:
#: `tertiary` is NOT here. It is the closest OSM class to "major collector",
#: which HPMS DOES publish, and dropping it would take 8.2% of the model's
#: vehicle-miles out of the numerator against a denominator that kept them.
#: Measured 2026-08-20, these classes carry 2.4% of the model's network
#: vehicle-miles (`docs/modeling/VMT_BY_CLASS_2026-08-20.md`).
OSM_CLASSES_OUTSIDE_HPMS_SCOPE = frozenset(
    {"residential", "unclassified", "service", "living_street", "track", "road",
     "bridleway", "footway", "path", "cycleway", "steps", "pedestrian",
     "centroid_connector"}
)


def scoped_vmt_from_links(links: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Model vehicle-miles reduced to what HPMS would have counted.

    `links` are dicts with `link_type`, `vehicle_miles` and `inside_fraction`
    (0..1, the share of the link's length inside the analysis boundary). Pure
    arithmetic, so the geometry work stays with the caller and this stays
    testable without spatialite.

    Both reductions are reported, never merely applied: a reader comparing this
    against `vmt_ratio` is entitled to see how much each one moved.
    """
    total = 0.0
    inside = 0.0
    in_scope = 0.0
    dropped_out_of_scope = 0.0
    dropped_outside_boundary = 0.0
    for link in links:
        miles = float(link.get("vehicle_miles") or 0.0)
        if miles <= 0:
            continue
        total += miles
        fraction = float(link.get("inside_fraction", 1.0))
        fraction = min(max(fraction, 0.0), 1.0)
        inside_miles = miles * fraction
        inside += inside_miles
        dropped_outside_boundary += miles - inside_miles
        if str(link.get("link_type") or "") in OSM_CLASSES_OUTSIDE_HPMS_SCOPE:
            dropped_out_of_scope += inside_miles
            continue
        in_scope += inside_miles
    return {
        "scoped_daily_vehicle_miles": round(in_scope, 1),
        "unclipped_daily_vehicle_miles": round(total, 1),
        "dropped_outside_boundary": round(dropped_outside_boundary, 1),
        "dropped_out_of_hpms_scope": round(dropped_out_of_scope, 1),
    }


if __name__ == "__main__":  # pragma: no cover - a convenience probe, not a product surface
    import sys

    if len(sys.argv) != 3:
        print("usage: vmt_sources.py <state_fips> <county_fips>")
        raise SystemExit(2)
    print(json.dumps(county_vmt(sys.argv[1], sys.argv[2]), indent=2))
