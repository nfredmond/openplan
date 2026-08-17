#!/usr/bin/env python3
"""Where two demand models agree about a corridor, and where they do not.

============================================================ WHAT THIS IS FOR

Two demand models — a trip-based gravity model and an activity-based
microsimulation — are assigned on the SAME network with the SAME assignment
settings. Everything downstream of demand is identical, so any difference in a
link's volume is attributable to the demand model and nothing else.

This file computes what that difference is, link by link and corridor by
corridor. The product is an **agreement map**: corridors where both methods land
in the same place carry higher confidence, and that agreement is itself
reportable; corridors where they diverge are flagged with the divergence
quantified.

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

import math
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


class CorridorAgreementError(ValueError):
    """The two runs cannot be compared, with the reason to show."""


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


def _volumes_by_link(rows: Iterable[Mapping[str, Any]], volume_column: str) -> dict[int, float]:
    volumes: dict[int, float] = {}
    for row in rows:
        try:
            link_id = int(float(row["link_id"]))
            volume = float(row.get(volume_column) or 0.0)
        except (KeyError, TypeError, ValueError):
            continue
        if not math.isfinite(volume):
            continue
        volumes[link_id] = volume
    return volumes


def compare_link_volumes(
    first_rows: Sequence[Mapping[str, Any]],
    second_rows: Sequence[Mapping[str, Any]],
    *,
    volume_column: str = "PCE_tot",
    minimum_volume: float = DEFAULT_MINIMUM_VOLUME,
    link_names: Mapping[int, Mapping[str, Any]] | None = None,
) -> dict[str, Any]:
    """Compare one run's link volumes against another's, link by link.

    Both runs must describe the same network. A link present in one and not the
    other is REPORTED rather than skipped: it means the two runs did not in fact
    hold the network constant, which invalidates the whole premise that a
    difference is attributable to the demand model.
    """
    first = _volumes_by_link(first_rows, volume_column)
    second = _volumes_by_link(second_rows, volume_column)
    if not first or not second:
        raise CorridorAgreementError(
            f"One of the two runs has no usable '{volume_column}' values, so there is nothing to "
            "compare."
        )

    shared = sorted(set(first) & set(second))
    only_first = sorted(set(first) - set(second))
    only_second = sorted(set(second) - set(first))
    if not shared:
        raise CorridorAgreementError(
            "The two runs share no link ids at all, so they were not assigned on the same network "
            "and no difference between them is attributable to the demand model."
        )

    links: list[dict[str, Any]] = []
    for link_id in shared:
        a = first[link_id]
        b = second[link_id]
        larger = max(a, b)
        metadata = (link_names or {}).get(link_id, {})
        links.append(
            {
                "link_id": link_id,
                "name": str(metadata.get("name") or "").strip(),
                "link_type": str(metadata.get("link_type") or "").strip(),
                "first_volume": round(a, 2),
                "second_volume": round(b, 2),
                "difference": round(b - a, 2),
                "percent_difference": round((b - a) / a * 100.0, 2) if a > 0 else None,
                "geh": round(geh(a, b), 3),
                "agreement": classify_agreement(geh(a, b)),
                "carries_meaningful_traffic": larger >= minimum_volume,
            }
        )

    return {
        "links": links,
        "network_alignment": {
            "shared_links": len(shared),
            "only_in_first": len(only_first),
            "only_in_second": len(only_second),
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
            f"Both runs loaded the same {shared:,} links, so the network was genuinely held constant "
            "and a difference in a link's volume is attributable to the demand model."
        )
    return (
        f"{shared:,} links are common to both runs, but {only_first:,} appear only in the first and "
        f"{only_second:,} only in the second. The network was NOT held constant, so differences here "
        "are not attributable to the demand model alone and the comparison should not be reported as "
        "though they were."
    )


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
        "correct. The two are never averaged: a blended figure would have no provenance and would "
        "destroy the only thing this comparison produces."
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
        corridor_geh = geh(first_total, second_total)
        corridors.append(
            {
                "corridor": name,
                "links": len(corridor_links),
                "first_volume": round(first_total, 2),
                "second_volume": round(second_total, 2),
                "difference": round(second_total - first_total, 2),
                "geh": round(corridor_geh, 3),
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
            "THE ASSIGNMENT'S OWN CONTRIBUTION TO THESE DIFFERENCES HAS NOT BEEN MEASURED FOR THIS "
            "comparison. Equilibrium assignment redistributes flow between near-equal-cost parallel "
            "routes, so two runs with effectively identical demand still disagree link by link — "
            "measured once at 13% of busy links at a relative gap of 0.01. Until the same "
            "measurement is made here, divergence on any single corridor cannot be attributed to "
            "the demand model. Measure it by re-assigning one model's own demand and comparing the "
            "result against itself, then read only the divergence that exceeds it."
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
    first: Mapping[str, Any] | None, second: Mapping[str, Any] | None
) -> dict[str, Any]:
    """Whether these two runs were converged tightly enough to be compared at all.

    THE CHECK THAT MAKES THE MEASUREMENT BINDING. A comparison run at the default
    gap produces corridor divergence from the assignment alone, and a reader has
    no way to tell that from the demand models disagreeing. Stated in a document
    this would be a convention; here it is a field every report carries.

    Absent convergence records are 'unknown', which is deliberately not 'fine'.
    """
    gaps = {
        "first": None if not first else first.get("final_gap"),
        "second": None if not second else second.get("final_gap"),
    }
    known = {side: gap for side, gap in gaps.items() if isinstance(gap, (int, float))}
    if not known:
        return {
            "status": "unknown",
            "attributable_at": [],
            "gaps": gaps,
            "required_gap": COMPARISON_MAX_RELATIVE_GAP,
            "note": (
                "Neither run recorded how tightly its assignment converged, so whether a corridor's "
                "difference comes from the demand models or from the assignment cannot be "
                "established. Re-run both with the convergence record present."
            ),
        }
    too_loose = {side: gap for side, gap in known.items() if gap > COMPARISON_MAX_RELATIVE_GAP}
    if too_loose:
        detail = ", ".join(f"{side} at {gap:.5f}" for side, gap in sorted(too_loose.items()))
        return {
            "status": "corridors_only",
            "attributable_at": ["corridor"],
            "gaps": gaps,
            "required_gap": COMPARISON_MAX_RELATIVE_GAP,
            "note": (
                f"Read the corridor table, not the individual links. The assignment converged only "
                f"to {detail}, against the {COMPARISON_MAX_RELATIVE_GAP} needed for a link-level "
                "claim. Measured on one county by assigning IDENTICAL demand at both settings: "
                "named corridor totals moved 0.5-1.4%, while 21% of individual links moved more "
                "than 10% and the worst tenth moved 29%. A corridor total is an average over many "
                "links and survives; a single link is where the assignment is still choosing "
                "between parallel routes. Set OPENPLAN_ASSIGNMENT_RGAP_TARGET and "
                "OPENPLAN_ASSIGNMENT_MAX_ITERATIONS and re-run both sides to attribute anything "
                "link by link."
            ),
        }
    return {
        "status": "tight_enough",
        "attributable_at": ["corridor", "link"],
        "gaps": gaps,
        "required_gap": COMPARISON_MAX_RELATIVE_GAP,
        "note": (
            "Both runs converged tightly enough that the assignment is not itself generating "
            "divergence, so a difference here is attributable to the demand model link by link as "
            "well as corridor by corridor."
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
) -> dict[str, Any]:
    """The whole comparison: links, corridors, headline, and what it does not mean."""
    comparison = compare_link_volumes(
        first_rows,
        second_rows,
        volume_column=volume_column,
        minimum_volume=minimum_volume,
        link_names=link_names,
    )
    corridors = corridor_rollup(comparison)
    convergence = convergence_verdict(first_convergence, second_convergence)
    return {
        "schema_version": "openplan.corridor_agreement.v0",
        "methods": {"first": first_label, "second": second_label},
        "attribution_is_supportable": convergence["status"] == "tight_enough",
        # Which UNIT a difference can be read at. A loosely converged pair still
        # supports the corridor table — that is the number a planner asks for —
        # while its individual links are the assignment still deciding.
        "attributable_at": convergence["attributable_at"],
        "assignment_convergence": convergence,
        "summary": agreement_summary(comparison),
        "network_alignment": comparison["network_alignment"],
        "settings": comparison["settings"],
        "assignment_noise_floor": {
            "measured": bool(noise_floor),
            "measurement": dict(noise_floor) if noise_floor else None,
            "note": noise_floor_disclosure(noise_floor),
        },
        "corridors": corridors,
        "links": comparison["links"],
        "what_this_is_not": [
            "Neither method is ground truth. Agreement means the two concur; it does not mean either "
            "is correct, and both can be wrong in the same direction.",
            "The two volumes are never averaged. A blended figure has no defensible provenance and "
            "destroys the only signal this comparison produces.",
            "GEH thresholds are borrowed from model-versus-count validation, where one side is "
            "measured. They are used here because they are the yardstick a reviewer recognises, not "
            "because a validation standard has been met.",
            noise_floor_disclosure(noise_floor),
            convergence["note"],
        ],
    }
