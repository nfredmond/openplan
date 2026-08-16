#!/usr/bin/env python3
"""Fit real survey households to a zone's published totals — the arithmetic only.

=========================================================== WHAT THIS IS FOR

An activity-based model needs a list of individual households and people to
simulate. Nobody publishes that list: releasing it would identify people. What
is published is two halves that can be put back together —

  * a **seed**: a sample of real, anonymised household records, each one a
    genuine combination of size, income, workers and vehicles, but only
    accurate for a large area (in the United States, a PUMA of 100,000+ people);
  * **marginals**: how many households of each size, each income band and so on
    live in each small zone — totals per category, with the combinations
    stripped out.

Reweighting the seed until it reproduces every zone's marginals recovers a
plausible joint distribution for that zone. That is the whole method, and it is
what every MPO's population synthesiser does.

============================================== WHY THIS FILE TOUCHES NO NETWORK

Everything here is arithmetic over numbers someone else fetched, so it can be
tested for real. Where those numbers come from is a separate, replaceable
concern: the United States adapter lives in ``census_pums.py``, and nothing in
this file knows what a PUMA, an ACS table or a state is. A country that
publishes its microdata differently needs a new adapter, not a new synthesiser.

============================================ THE FAILURE THIS FILE MUST NOT HAVE

Fitting cannot create a household the seed does not contain. If a zone's
marginals say forty households earn over $150,000 and no sampled household in
the whole region does, no amount of reweighting produces one — the fit simply
misses that control, quietly, while every other number looks healthy and the
run completes normally.

So the fit reports what it could not satisfy (``unmet_controls``) and how far
off it finished (``worst_deviation``) rather than returning weights alone. A
caller that ignores those is publishing a population whose accuracy nobody
measured; a caller that reads them can say which zones are trustworthy.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Iterable, Mapping, Sequence

import numpy as np

# Fitting stops when every control is within this relative distance of its
# target, or when the pass limit is reached. 0.1% is far tighter than the
# sampling error in the marginals themselves, so a fit that reaches it is
# limited by the data rather than by the loop.
DEFAULT_TOLERANCE = 0.001
DEFAULT_MAX_ITERATIONS = 200

# A seed household's weight is never driven to exactly zero: a category that
# reaches zero can never be revived by a later pass, so one unlucky ordering
# would permanently delete a household type the next control still needs.
MINIMUM_WEIGHT = 1e-9


class PopulationSynthesisError(ValueError):
    """The inputs cannot produce a population, with the reason a reader needs."""


@dataclass(frozen=True)
class Control:
    """One dimension the fitted population must reproduce.

    ``level`` decides what a household contributes to a category total:
    ``"household"`` counts the household once, ``"person"`` counts how many of
    its people fall in that category. Mixing both in one fit is the difference
    between a population that has the right number of houses and one that also
    has the right number of children in them.
    """

    name: str
    level: str
    categories: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.level not in ("household", "person"):
            raise PopulationSynthesisError(
                f"Control '{self.name}' has level '{self.level}'; expected 'household' or 'person'."
            )
        if not self.categories:
            raise PopulationSynthesisError(f"Control '{self.name}' has no categories.")


@dataclass
class SeedHousehold:
    """One real sampled household, already sorted into each control's categories.

    ``household_category`` holds one category per household-level control.
    ``person_categories`` holds, per person-level control, how many of this
    household's people fall in each category — so a couple with two children
    contributes 2 to 'child' and 2 to 'adult' of an age control.
    """

    household_id: str
    weight: float
    household_category: Mapping[str, str]
    person_categories: Mapping[str, Mapping[str, int]] = field(default_factory=dict)
    persons: int = 1


@dataclass
class ZoneFit:
    """Fitted weights for one zone, and every reason to distrust them."""

    zone_id: Any
    weights: list[float]
    iterations: int
    converged: bool
    worst_deviation: float
    worst_control: str | None
    # Controls whose target is positive but which no seed household can supply.
    # Reweighting cannot invent one, so these are permanently missed and the
    # zone's population misrepresents them however long the fit runs.
    unmet_controls: list[dict[str, Any]]
    # Controls the fit missed by more than the published uncertainty in the
    # target itself. Empty when no margins were supplied — which is different
    # from "none", and `graded_against_margins` is how a reader tells them apart.
    outside_margin: list[dict[str, Any]] = field(default_factory=list)
    graded_against_margins: bool = False


def controls_outside_margin(
    matrix: SeedMatrix,
    weights: Any,
    controls: Sequence[Control],
    targets: Mapping[str, Mapping[str, float]],
    margins: Mapping[str, Mapping[str, float]],
) -> list[dict[str, Any]]:
    """Category totals the fit missed by more than the target's own uncertainty.

    WHY THIS EXISTS AND A FIXED TOLERANCE DOES NOT. A tract-level ACS estimate of
    "4-person family households" is published with a margin of error that is
    routinely half the estimate — measured at a median of 54% across one real
    county, and 92% for the under-5 age cell. Grading a fit at a fixed 0.1%
    against a number that uncertain reports noise as failure, and a run that
    cries failure everywhere teaches a planner to ignore it.

    A miss larger than the published margin is a different thing entirely: the
    fitted population disagrees with the source by more than the source's own
    uncertainty allows, and that is worth a reader's attention.
    """
    findings: list[dict[str, Any]] = []
    for control in controls:
        control_targets = targets.get(control.name, {})
        control_margins = margins.get(control.name, {})
        actuals = matrix.contributions[control.name].T @ weights
        for column, category in enumerate(control.categories):
            target = float(control_targets.get(category, 0.0) or 0.0)
            margin = float(control_margins.get(category, 0.0) or 0.0)
            actual = float(actuals[column])
            miss = abs(actual - target)
            if margin <= 0 or miss <= margin:
                continue
            findings.append(
                {
                    "control": control.name,
                    "category": category,
                    "target": round(target, 1),
                    "fitted": round(actual, 1),
                    "margin_of_error": round(margin, 1),
                    "excess": round(miss - margin, 1),
                }
            )
    return findings


def _contribution(household: SeedHousehold, control: Control, category: str) -> float:
    """How much this household adds to one category total, at the control's level."""
    if control.level == "household":
        return 1.0 if household.household_category.get(control.name) == category else 0.0
    return float(household.person_categories.get(control.name, {}).get(category, 0) or 0)


@dataclass(frozen=True)
class SeedMatrix:
    """The seed's contributions to every control category, as arrays.

    Built once and reused for every zone, because it depends only on the seed and
    the controls — not on any zone's targets. That is the difference between a
    county fitting in seconds and not finishing: a real seed is thousands of
    households and a real study area is dozens of zones, and rebuilding this per
    zone multiplies the whole job by the zone count for no new information.
    """

    controls: tuple[Control, ...]
    # control name -> (households, categories) contributions, in category order.
    contributions: Mapping[str, Any]
    household_count: int


def build_seed_matrix(households: Sequence[SeedHousehold], controls: Sequence[Control]) -> SeedMatrix:
    contributions: dict[str, Any] = {}
    for control in controls:
        matrix = np.zeros((len(households), len(control.categories)), dtype=float)
        for row, household in enumerate(households):
            for column, category in enumerate(control.categories):
                matrix[row, column] = _contribution(household, control, category)
        contributions[control.name] = matrix
    return SeedMatrix(
        controls=tuple(controls),
        contributions=contributions,
        household_count=len(households),
    )


def _resolve_seed_matrix(
    households: Sequence[SeedHousehold],
    controls: Sequence[Control],
    seed_matrix: SeedMatrix | None,
) -> SeedMatrix:
    if seed_matrix is None:
        return build_seed_matrix(households, controls)
    if seed_matrix.household_count != len(households):
        raise PopulationSynthesisError(
            f"The prepared seed describes {seed_matrix.household_count} households but "
            f"{len(households)} were supplied. Fitting one against the other would assign every "
            "household the wrong weight while completing normally."
        )
    missing = [c.name for c in controls if c.name not in seed_matrix.contributions]
    if missing:
        raise PopulationSynthesisError(
            f"The prepared seed has no contributions for {', '.join(missing)}, so those controls "
            "would be silently unfitted."
        )
    return seed_matrix


def find_unmet_controls(
    households: Sequence[SeedHousehold],
    controls: Sequence[Control],
    targets: Mapping[str, Mapping[str, float]],
    seed_matrix: SeedMatrix | None = None,
) -> list[dict[str, Any]]:
    """Categories a zone needs that the seed cannot supply at any weight.

    Checked BEFORE fitting and reported alongside the result, because the fit
    itself gives no sign: a category with no seed support is skipped by every
    pass, so the loop converges happily on the controls it can reach and the
    missing one leaves no trace in the weights.
    """
    matrix = _resolve_seed_matrix(households, controls, seed_matrix)
    unmet: list[dict[str, Any]] = []
    for control in controls:
        control_targets = targets.get(control.name, {})
        supplies = matrix.contributions[control.name].sum(axis=0)
        for column, category in enumerate(control.categories):
            target = float(control_targets.get(category, 0.0) or 0.0)
            if target <= 0:
                continue
            supply = float(supplies[column])
            if supply <= 0:
                unmet.append(
                    {
                        "control": control.name,
                        "category": category,
                        "target": target,
                        "reason": (
                            f"No sampled household in the seed falls in '{category}', so reweighting "
                            f"cannot produce the {target:.0f} this zone reports. The fitted population "
                            "understates this category by that amount."
                        ),
                    }
                )
    return unmet


def fit_zone_weights(
    households: Sequence[SeedHousehold],
    controls: Sequence[Control],
    targets: Mapping[str, Mapping[str, float]],
    *,
    zone_id: Any = None,
    seed_matrix: SeedMatrix | None = None,
    margins: Mapping[str, Mapping[str, float]] | None = None,
    tolerance: float = DEFAULT_TOLERANCE,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
) -> ZoneFit:
    """Reweight the seed until it reproduces one zone's published totals.

    Iterative proportional updating (Ye et al., 2009): each pass walks every
    control, and scales the weight of every household touching a category by the
    ratio of the category's target to what the current weights produce.
    Household-level and person-level controls are balanced in the same loop,
    which is the only reason a fitted zone can have both the right number of
    households and the right number of workers in them.
    """
    if not households:
        raise PopulationSynthesisError(
            "The seed contains no households, so there is nothing to fit to this zone's totals."
        )
    if not controls:
        raise PopulationSynthesisError("No controls were supplied, so a fit would assert nothing.")

    matrix = _resolve_seed_matrix(households, controls, seed_matrix)
    weights = np.maximum(
        np.array([float(h.weight) for h in households], dtype=float), MINIMUM_WEIGHT
    )
    unmet = find_unmet_controls(households, controls, targets, matrix)
    # A category the seed cannot supply is excluded from the CONVERGENCE TEST.
    # Its deviation is permanently 1.0 — no weights can move a total no household
    # contributes to — so leaving it in would report every such zone as
    # non-converged and bury which zones have a second, fixable problem. It is
    # reported through `unmet_controls` instead, which says the same thing
    # without destroying the signal.
    #
    # It needs no exclusion inside the fitting loop itself: a category with no
    # supply always computes an actual of 0 and is skipped there already. A
    # mutation proved that guard redundant, so it is not written twice.
    unmet_keys = {(entry["control"], entry["category"]) for entry in unmet}

    worst_deviation = math.inf
    worst_control: str | None = None
    iterations = 0
    converged = False

    for iterations in range(1, max_iterations + 1):
        for control in controls:
            control_targets = targets.get(control.name, {})
            contributions = matrix.contributions[control.name]
            for column, category in enumerate(control.categories):
                column_values = contributions[:, column]
                target = float(control_targets.get(category, 0.0) or 0.0)
                actual = float(column_values @ weights)
                if actual <= 0:
                    # Nothing in the seed reaches this category, so no ratio can
                    # move it. Covers the unmet-control case without a second test.
                    continue
                if target <= 0:
                    # A category the zone reports nobody in. Its households are
                    # pushed toward zero rather than to it, so a household that
                    # also serves a category still being fitted survives.
                    factor = MINIMUM_WEIGHT
                else:
                    factor = target / actual
                touching = column_values > 0
                weights[touching] = np.maximum(weights[touching] * factor, MINIMUM_WEIGHT)

        worst_deviation, worst_control = _worst_relative_deviation(
            matrix, weights, controls, targets, unmet_keys
        )
        if worst_deviation <= tolerance:
            converged = True
            break

    return ZoneFit(
        zone_id=zone_id,
        weights=[float(w) for w in weights],
        iterations=iterations,
        converged=converged,
        worst_deviation=worst_deviation,
        worst_control=worst_control,
        unmet_controls=unmet,
        outside_margin=(
            controls_outside_margin(matrix, weights, controls, targets, margins) if margins else []
        ),
        graded_against_margins=margins is not None,
    )


def _worst_relative_deviation(
    matrix: SeedMatrix,
    weights: Any,
    controls: Sequence[Control],
    targets: Mapping[str, Mapping[str, float]],
    unmet_keys: set[tuple[str, str]],
) -> tuple[float, str | None]:
    worst = 0.0
    worst_control: str | None = None
    for control in controls:
        control_targets = targets.get(control.name, {})
        actuals = matrix.contributions[control.name].T @ weights
        for column, category in enumerate(control.categories):
            if (control.name, category) in unmet_keys:
                continue
            target = float(control_targets.get(category, 0.0) or 0.0)
            if target <= 0:
                continue
            deviation = abs(float(actuals[column]) - target) / target
            if deviation > worst:
                worst = deviation
                worst_control = f"{control.name}:{category}"
    return worst, worst_control


def integerize_weights(weights: Sequence[float]) -> list[int]:
    """Turn fractional weights into whole households, preserving the total.

    Largest-remainder, and deliberately deterministic. Stochastic rounding is
    the more common choice and gives a better expected fit, but it makes two
    runs of the same model produce different populations — and this repository
    already treats a reproducible model run as a property worth having, because
    a number a planner cannot reproduce is a number they cannot defend.

    The total is preserved exactly: rounding each weight independently loses or
    invents households, and a study area's household count is one of the few
    figures in a model a reader will check against the Census directly.
    """
    if not weights:
        return []
    floors = [int(math.floor(max(0.0, w))) for w in weights]
    target_total = int(round(sum(max(0.0, w) for w in weights)))
    shortfall = target_total - sum(floors)
    if shortfall <= 0:
        return floors
    # Ties break on index so the result depends only on the weights, not on the
    # order Python's sort happened to leave equal remainders in.
    remainders = sorted(
        ((max(0.0, w) - math.floor(max(0.0, w)), index) for index, w in enumerate(weights)),
        key=lambda pair: (-pair[0], pair[1]),
    )
    for _, index in remainders[:shortfall]:
        floors[index] += 1
    return floors


def expand_population(
    households: Sequence[SeedHousehold],
    counts: Sequence[int],
    zone_id: Any,
    *,
    first_household_id: int = 1,
) -> list[dict[str, Any]]:
    """Replicate each seed household the number of times its fitted count says.

    Returns one row per synthesised household, each naming the seed record it
    came from. That link is not decoration: it is how a person's attributes are
    attached later, and how anyone auditing the population can go back to the
    real survey record a synthetic household stands for.
    """
    if len(households) != len(counts):
        raise PopulationSynthesisError(
            f"{len(counts)} fitted counts for {len(households)} seed households — the fit and the "
            "seed do not describe the same set, so every household would be assigned the wrong weight."
        )
    rows: list[dict[str, Any]] = []
    household_id = first_household_id
    for household, count in zip(households, counts):
        for replicate in range(int(count)):
            rows.append(
                {
                    "household_id": household_id,
                    "home_zone_id": zone_id,
                    "seed_household_id": household.household_id,
                    "seed_replicate": replicate + 1,
                    "persons": int(household.persons),
                }
            )
            household_id += 1
    return rows


def synthesize_zone(
    households: Sequence[SeedHousehold],
    controls: Sequence[Control],
    targets: Mapping[str, Mapping[str, float]],
    zone_id: Any,
    *,
    first_household_id: int = 1,
    seed_matrix: SeedMatrix | None = None,
    margins: Mapping[str, Mapping[str, float]] | None = None,
    tolerance: float = DEFAULT_TOLERANCE,
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
) -> tuple[list[dict[str, Any]], ZoneFit]:
    """Fit, integerize and expand one zone in a single call.

    Returns the synthesised household rows AND the fit, together, so a caller
    cannot take the population without also being handed what is wrong with it.
    """
    fit = fit_zone_weights(
        households,
        controls,
        targets,
        zone_id=zone_id,
        seed_matrix=seed_matrix,
        margins=margins,
        tolerance=tolerance,
        max_iterations=max_iterations,
    )
    counts = integerize_weights(fit.weights)
    rows = expand_population(households, counts, zone_id, first_household_id=first_household_id)
    return rows, fit


def fit_quality_summary(fits: Iterable[ZoneFit]) -> dict[str, Any]:
    """One study-area verdict over every zone's fit, phrased for a reader.

    Deliberately leads with the failures. A summary that reports the average
    deviation reads as healthy when a handful of zones are badly wrong, and it
    is those zones a planner needs to know not to quote.
    """
    fit_list = list(fits)
    if not fit_list:
        return {
            "zones_fitted": 0,
            "note": "No zones were fitted, so this run has no synthetic population.",
        }
    not_converged = [f for f in fit_list if not f.converged]
    with_unmet = [f for f in fit_list if f.unmet_controls]
    graded = [f for f in fit_list if f.graded_against_margins]
    outside = [f for f in fit_list if f.outside_margin]
    worst = max(fit_list, key=lambda f: f.worst_deviation if math.isfinite(f.worst_deviation) else 0.0)
    unmet_categories = sorted(
        {f"{entry['control']}:{entry['category']}" for f in fit_list for entry in f.unmet_controls}
    )
    outside_categories = sorted(
        {f"{entry['control']}:{entry['category']}" for f in fit_list for entry in f.outside_margin}
    )
    return {
        "zones_fitted": len(fit_list),
        "zones_graded_against_margins": len(graded),
        "zones_outside_published_margin": len(outside) if graded else None,
        "outside_margin_categories": outside_categories,
        "zones_not_converged": len(not_converged),
        "zones_with_unmet_controls": len(with_unmet),
        "unmet_categories": unmet_categories,
        "worst_zone_id": worst.zone_id,
        "worst_deviation": None if not math.isfinite(worst.worst_deviation) else round(worst.worst_deviation, 6),
        "worst_control": worst.worst_control,
        "note": _fit_quality_note(
            len(fit_list), not_converged, with_unmet, unmet_categories, graded, outside, outside_categories
        ),
    }


def _fit_quality_note(
    zone_count: int,
    not_converged: Sequence[ZoneFit],
    with_unmet: Sequence[ZoneFit],
    unmet_categories: Sequence[str],
    graded: Sequence[ZoneFit] = (),
    outside: Sequence[ZoneFit] = (),
    outside_categories: Sequence[str] = (),
) -> str:
    parts: list[str] = []
    if graded:
        # Leads, because it is the verdict that means something. The published
        # totals this population is fitted to carry margins of error that are
        # routinely half the estimate at this geography, so a fit is judged
        # against that uncertainty rather than against an arbitrary tolerance.
        if outside:
            parts.append(
                f"{len(outside)} of {zone_count} zones differ from a published total by more than "
                f"that total's own margin of error ({', '.join(outside_categories)}); those zones' "
                "household mix should not be quoted."
            )
        else:
            parts.append(
                f"All {zone_count} zones reproduce their published totals to within the margin of "
                "error the Census publishes for those totals."
            )
    elif not_converged:
        parts.append(
            f"{len(not_converged)} of {zone_count} zones did not reach the fitting tolerance, so their "
            "household mix does not reproduce the published totals."
        )
    if with_unmet:
        parts.append(
            f"{len(with_unmet)} of {zone_count} zones report household types the regional survey sample "
            f"does not contain ({', '.join(unmet_categories)}); those types are missing from the "
            "synthetic population entirely, not merely under-weighted."
        )
    if not parts:
        parts.append(
            f"All {zone_count} zones reproduce their published household and person totals within the "
            "fitting tolerance."
        )
    return " ".join(parts)


def margins_summary(fits: Iterable[ZoneFit]) -> str:
    """Why a fit is graded against margins of error rather than a tolerance.

    Kept as text a report can carry, because the reasoning is the part a reader
    needs in order to trust a number that did not land exactly on its target.
    """
    fit_list = list(fits)
    graded = sum(1 for f in fit_list if f.graded_against_margins)
    if not graded:
        return (
            "This population was not graded against the published margins of error, so how closely "
            "it reproduces each zone's totals has not been assessed against the uncertainty in "
            "those totals."
        )
    return (
        "Each zone's fitted totals are compared against the margin of error the Census publishes "
        "for the same figure. At tract level those margins are large — commonly half the estimate "
        "itself for a single household-size or age cell — so a fitted total inside the margin is as "
        "close to the source as the source's own precision can justify, and a fitted total outside "
        "it is a real disagreement worth reading."
    )
