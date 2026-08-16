#!/usr/bin/env python3
"""Opt-in calibration of a screening run toward observed traffic counts.

======================================================== WHAT THIS IS, AND IS NOT

OpenPlan ships an UNCALIBRATED screening model on purpose. Its numbers rest on
generic trip rates and OSM defaults, and it says so. This module is the OPT-IN
path to a different, disclosed claim — `calibrated_to_counts` — for study areas
where a DOT publishes real traffic counts. It is never a default, never silent,
and never promotes a run on its own.

Measured 2026-08-16, before any calibration existed: against 57 published
Caltrans stations in one county the model scored a 62.8% median absolute percent
error against a 30% screening threshold, over-assigning by about 1.4x. That is
the gap this exists to close, honestly.

=========================================================== THE HONESTY MACHINERY

**A 30% holdout is split off first and never fitted.** The number this reports
as the run's accuracy is the HELD-OUT one. A model that matches the counts it
was fitted to has learned nothing and claims everything, and reporting the fit
error as accuracy is the single easiest way to lie with a calibration.

**A step must IMPROVE the holdout or it is rejected.** Improving the fit set
while the holdout worsens is the definition of overfitting. An unknown holdout
objective rejects too — a step that cannot be validated out-of-sample is not
accepted on trust.

**Calibrating does not grant a passing gate.** If the held-out error still fails
the screening threshold, the run still fails it, and says so. Calibration
changes the model, not the standard.

========================================== NOT REACHABLE FROM THE APP YET (2026-08-16)

Stated here rather than discovered later. This runs from the command line only:
`run_screening_model.py --calibrate-to-counts <csv>`. The county on-ramp does not
pass it, the worker payload has no field for it, and `/county-runs` offers no way
to ask for it. A planner cannot get a calibrated run today.

That is this repository's most-repeated defect — complete, tested capability
nobody can reach — so it is declared instead of left to be found.

Closing it needs a product decision, not just plumbing, because calibration
needs a COUNT SET and the app has no way to produce or hold one. The natural
shape: a county run already knows its boundary, and
`build_expanded_aadt_counts.py --fetch-bbox --boundary-geojson` can fetch and
clip a DOT count set for any registered state (CA, CO, OR, WA today) without a
key. That would make calibration a single opt-in choice at launch for planners
in those states, and an honest "no published counts for your state yet"
everywhere else.

============================================================ WHY THE LOOP IS HERE

The decisions — which per-class factor, how to split the holdout, whether to
accept a step, what the objective is — all come from
`workers/aequilibrae_worker/calibration.py`, which is pure, stdlib-only and
already unit-tested. That engine is NOT reimplemented here.

What is here is a driver: the part that knows how THIS lane runs an assignment.
The worker lane has its own driver around the same engine, because the two lanes
hold their networks differently. One engine, two drivers, and the seam is
deliberate — if the calibration LOGIC ever needs changing, it changes in one
place and both lanes follow.

The loop takes its assignment and its matching as injected callables, so the
decisions can be tested exhaustively without running a four-minute model.
"""
from __future__ import annotations

import csv
import sys
from pathlib import Path
from typing import Any, Callable

SCRIPT_DIR = Path(__file__).resolve().parent
WORKER_DIR = SCRIPT_DIR.parents[1] / "workers" / "aequilibrae_worker"
for candidate in (SCRIPT_DIR, WORKER_DIR):
    if str(candidate) not in sys.path:
        sys.path.insert(0, str(candidate))

import calibration  # noqa: E402  (the shared pure engine)

#: How many accepted class-factor steps to attempt. Each one costs a full
#: equilibrium assignment, which is seconds — the ceiling exists so a study area
#: that never converges cannot loop forever.
DEFAULT_MAX_ITERATIONS = 8

#: A step must beat the held-out objective by at least this much. The objective
#: is rounded to 1e-4, so requiring strictly more than one unit of that stops an
#: identical-objective no-op step from promoting a run to the calibrated tier.
DEFAULT_MIN_IMPROVEMENT = 0.0001


class CalibrationUnavailable(RuntimeError):
    """Calibration cannot run here, with the reason a planner should be told."""


def load_count_stations(counts_csv: Path) -> list[dict[str, Any]]:
    """Observed-count stations, as the count builder writes them."""
    with Path(counts_csv).expanduser().open(newline="") as handle:
        return [row for row in csv.DictReader(handle)]


def attach_modelled_volumes(
    matched_stations: list[dict[str, Any]],
    volumes_by_link: dict[int, float],
) -> list[dict[str, Any]]:
    """Refresh each station's modelled volume from a new assignment.

    Stations are matched to links ONCE, before the loop, and only the volume
    changes between iterations. Re-matching every time would let a station drift
    onto a different link as volumes move, which would make the objective
    measure the matching as much as the model.
    """
    refreshed = []
    for station in matched_stations:
        row = dict(station)
        row["modeled_daily_pce"] = float(volumes_by_link.get(int(station["link_id"]), 0.0))
        refreshed.append(row)
    return refreshed


def match_stations_to_links(
    stations: list[dict[str, Any]],
    run_output_dir: Path,
    project_db: Path | None,
) -> list[dict[str, Any]]:
    """Tie each count station to the model link it measures — once, up front.

    Reuses the crosswalk `validate_screening_observed_counts` already applies,
    rather than growing a second matcher: a calibration that matched stations
    differently from the validator would be fitted to one thing and judged on
    another, and the discrepancy would look like model error.

    Only the link identity and its road class are kept. Volumes are attached
    per iteration, because the network does not change during calibration and
    re-matching would let a station drift onto a different link as volumes move.
    """
    import validate_screening_observed_counts as validator

    volume_field, volume_lookup = validator.load_volume_lookup(
        run_output_dir / "link_volumes.csv", None
    )
    features = validator.build_feature_index(
        validator.choose_geometry_path(run_output_dir), volume_lookup, volume_field
    )

    matched: list[dict[str, Any]] = []
    for station in stations:
        observed = validator.parse_float(station.get("observed_volume"))
        if not observed or observed <= 0:
            continue
        best = validator.find_best_model_link(
            station, features, project_db, volume_lookup, volume_field
        )
        if best is None:
            continue
        matched.append(
            {
                "station_id": station.get("station_id"),
                # The stratum the holdout split balances on, so a whole route
                # cannot land entirely in the fit set or entirely in the holdout.
                "facility_name": station.get("facility_name"),
                "observed_volume": float(observed),
                "link_id": int(best["link_id"]),
                "matched_link_type": best.get("link_type") or "",
            }
        )
    return matched


def demand_scalar_step(
    fit_matched: list[dict[str, Any]],
    gamma: float = calibration.DEFAULT_GAMMA,
    lo: float = calibration.DEFAULT_FACTOR_LO,
    hi: float = calibration.DEFAULT_FACTOR_HI,
) -> float | None:
    """One damped correction to an amount of travel, from the fit set.

    Used by both demand stages — stage 2 applies the result to resident travel,
    stage 3 to cordon traffic. The arithmetic is the same; what differs is which
    half of the matrix it lands on, and that is the caller's decision.

    WHY THIS STAGE EXISTS. Per-road-class factors redistribute traffic between
    classes; they cannot change how much of it there is. Measured 2026-08-16
    after stage 1 had converged, the model still over-assigned by a median 1.30x
    across every class — a level error, not a distribution one, and no amount of
    class adjustment reaches it.

    ONE parameter fitted to 40 stations, which is why this is a scalar and not a
    per-zone or per-purpose adjustment: the data supports one number here.
    Damped and clipped exactly like the class factors, because the same
    instability applies — a single noisy count must not move the whole model.

    Returns None when there is nothing usable to fit, which the caller treats as
    "no step", never as 1.0.
    """
    ratios = [
        float(row["observed_volume"]) / float(row["modeled_daily_pce"])
        for row in fit_matched
        if float(row.get("observed_volume") or 0) > 0 and float(row.get("modeled_daily_pce") or 0) > 0
    ]
    if not ratios:
        return None
    from statistics import median

    return max(lo, min(hi, median(ratios) ** gamma))



def step_improves_the_gate_metric(
    previous: dict[str, Any], trial: dict[str, Any]
) -> bool:
    """A step must not push the run further from the gate it is judged by.

    FOUND BY RUNNING IT, 2026-08-16. The shared engine's objective blends a GEH
    penalty with a median-APE penalty, and the demand stage improved that blend
    — held-out GEH 21.20 to 16.81 — while making held-out median APE WORSE,
    43.29% to 46.25%. The engine accepted it, correctly by its own rule.

    But the screening gate is median absolute percent error. A step that
    improves a blended objective and moves the run away from the standard it is
    actually measured against is not an improvement from the product's point of
    view, and accepting it would mean the calibration optimises something no
    planner is ever shown.

    So this is an ADDITIONAL condition applied here, not a change to the shared
    engine — the worker lane is judged the same way and would want the same
    thing, but that is its decision to make, and silently changing an engine two
    drivers rely on is how one lane's judgement becomes another's surprise.
    """
    previous_ape = previous.get("median_ape")
    trial_ape = trial.get("median_ape")
    if trial_ape is None:
        return False
    if previous_ape is None:
        return True
    return trial_ape <= previous_ape


def rejection_reason(
    previous_objective: float | None,
    trial_objective: float | None,
    previous_holdout: dict[str, Any],
    trial_holdout: dict[str, Any],
) -> str:
    """Why a step was thrown away — the specific reason, not a generic one.

    Two different rules can reject a step and they mean different things. "The
    blend got no better" says the calibration has converged. "The blend improved
    but the gate metric worsened" says the objective and the standard disagree,
    which is a fact about the model worth knowing and was invisible while both
    printed the same sentence.
    """
    if trial_objective is None:
        return "rejected — the held-out counts produced no usable objective"
    if previous_objective is not None and trial_objective > previous_objective:
        return "rejected — no strict improvement on the held-out counts"
    if not step_improves_the_gate_metric(previous_holdout, trial_holdout):
        return (
            "rejected — it improved the blended objective but worsened held-out median "
            "absolute percent error, which is the metric the screening gate is judged on"
        )
    return "rejected — no strict improvement on the held-out counts"


def calibrate(
    *,
    matched_stations: list[dict[str, Any]],
    reassign: Callable[..., dict[int, float]],
    baseline_volumes: dict[int, float],
    max_iterations: int = DEFAULT_MAX_ITERATIONS,
    min_improvement: float = DEFAULT_MIN_IMPROVEMENT,
    holdout_frac: float = calibration.DEFAULT_HOLDOUT_FRAC,
    seed: int = calibration.DEFAULT_SEED,
) -> dict[str, Any]:
    """Run the calibration loop and report what it did, out-of-sample.

    `reassign(class_factors)` re-runs the assignment with per-road-class factors
    applied and returns the resulting link volumes. It is injected so the whole
    decision sequence is testable without an assignment engine.

    Returns a disclosure record. It always names the baseline AND the calibrated
    holdout accuracy, so a reader can see what the calibration actually bought
    rather than only where it ended up.
    """
    if len(matched_stations) < 2:
        raise CalibrationUnavailable(
            f"Calibration needs at least 2 matched count stations to split a holdout; "
            f"this study area matched {len(matched_stations)}."
        )

    fit_stations, holdout_stations = calibration.split_holdout(
        matched_stations, holdout_frac=holdout_frac, seed=seed
    )
    if not holdout_stations:
        raise CalibrationUnavailable(
            "Calibration needs a non-empty holdout: without counts kept back, the reported "
            "accuracy would be the accuracy on the very counts the model was fitted to."
        )

    baseline_fit = calibration.evaluate(attach_modelled_volumes(fit_stations, baseline_volumes))
    baseline_holdout = calibration.evaluate(attach_modelled_volumes(holdout_stations, baseline_volumes))
    if baseline_holdout["objective"] is None:
        raise CalibrationUnavailable(
            "Calibration cannot be validated: the held-out stations produced no usable "
            "observed/modelled pairs, so no step could be checked out-of-sample."
        )

    cumulative: dict[str, float] = {}
    demand_scalar = 1.0
    external_scalar = 1.0
    best_volumes = baseline_volumes
    best_objective = baseline_holdout["objective"]
    best_fit, best_holdout = baseline_fit, baseline_holdout
    accepted = 0
    steps: list[dict[str, Any]] = []

    for iteration in range(1, max_iterations + 1):
        fit_matched = attach_modelled_volumes(fit_stations, best_volumes)
        new_factors = calibration.class_adjustment_factors(fit_matched)
        if not new_factors:
            steps.append({"stage": "class", "iteration": iteration, "outcome": "no adjustable road class remained"})
            break

        trial_cumulative = calibration.compose_factors(cumulative, new_factors)
        if trial_cumulative == cumulative:
            steps.append({"stage": "class", "iteration": iteration, "outcome": "factors stopped moving"})
            break

        trial_volumes = reassign(trial_cumulative, demand_scalar, external_scalar)
        trial_holdout = calibration.evaluate(attach_modelled_volumes(holdout_stations, trial_volumes))
        trial_objective = trial_holdout["objective"]

        # STRICT held-out improvement only. An equal-objective step is a no-op
        # and must never move a run into the calibrated tier.
        if (
            trial_objective is not None
            and calibration.accept_step(best_objective, trial_objective, tol=-min_improvement)
            and step_improves_the_gate_metric(best_holdout, trial_holdout)
        ):
            cumulative = trial_cumulative
            best_volumes = trial_volumes
            best_objective = trial_objective
            best_holdout = trial_holdout
            best_fit = calibration.evaluate(attach_modelled_volumes(fit_stations, trial_volumes))
            accepted += 1
            steps.append(
                {
                    "stage": "class",
                    "iteration": iteration,
                    "outcome": "accepted",
                    "holdout_median_ape": trial_holdout["median_ape"],
                    "factors": {cls: round(value, 3) for cls, value in cumulative.items()},
                }
            )
        else:
            steps.append(
                {
                    "stage": "class",
                    "iteration": iteration,
                    "outcome": rejection_reason(
                        best_objective, trial_objective, best_holdout, trial_holdout
                    ),
                    "holdout_median_ape": trial_holdout["median_ape"],
                }
            )
            break

    # ── STAGE 2: how much RESIDENT travel there is ───────────────────────────
    # Stage 1 moves traffic between road classes; it cannot change how much
    # there is. This fits one number and applies it to the internal trip matrix
    # only — resident and local travel — leaving cordon traffic to stage 3.
    #
    # The split matters: resident travel comes from Census population and
    # employment, and cordon traffic from a flat lookup by road class. They are
    # guesses of very different quality, and one scalar across both would move
    # the better-evidenced half to correct the worse-evidenced one.
    for iteration in range(1, max_iterations + 1):
        step = demand_scalar_step(attach_modelled_volumes(fit_stations, best_volumes))
        if step is None or abs(step - 1.0) < 1e-6:
            steps.append({"stage": "demand", "iteration": iteration, "outcome": "no usable demand step"})
            break

        trial_scalar = max(0.1, min(10.0, demand_scalar * step))
        trial_volumes = reassign(cumulative, trial_scalar, external_scalar)
        trial_holdout = calibration.evaluate(attach_modelled_volumes(holdout_stations, trial_volumes))
        trial_objective = trial_holdout["objective"]

        if (
            trial_objective is not None
            and calibration.accept_step(best_objective, trial_objective, tol=-min_improvement)
            and step_improves_the_gate_metric(best_holdout, trial_holdout)
        ):
            demand_scalar = trial_scalar
            best_volumes = trial_volumes
            best_objective = trial_objective
            best_holdout = trial_holdout
            best_fit = calibration.evaluate(attach_modelled_volumes(fit_stations, trial_volumes))
            accepted += 1
            steps.append({
                "stage": "demand",
                "iteration": iteration,
                "outcome": "accepted",
                "demand_scalar": round(trial_scalar, 4),
                "holdout_median_ape": trial_holdout["median_ape"],
            })
        else:
            steps.append({
                "stage": "demand",
                "iteration": iteration,
                "outcome": rejection_reason(
                    best_objective, trial_objective, best_holdout, trial_holdout
                ),
                "demand_scalar": round(trial_scalar, 4),
                "holdout_median_ape": trial_holdout["median_ape"],
            })
            break


    # ── STAGE 3: how much travel comes from OUTSIDE ──────────────────────────
    # External demand is the most-guessed part of the model — a flat lookup by
    # road class, applied at every boundary crossing — and on a rural county it
    # is a third of all trips. Measured 2026-08-16 after stages 1 and 2: the
    # model was within 11% on the busiest roads and 94% out on the quietest,
    # and the worst stations were beside cordons. External traffic disperses
    # across the whole county by population and job share, so an over-guess
    # lands everywhere, hardest where there is least real traffic to hide it.
    #
    # Fitted separately from resident travel because they are different guesses
    # with different evidence behind them. Smearing one correction across both
    # would move trips that were never in doubt.
    for iteration in range(1, max_iterations + 1):
        step = demand_scalar_step(attach_modelled_volumes(fit_stations, best_volumes))
        if step is None or abs(step - 1.0) < 1e-6:
            steps.append({"stage": "external", "iteration": iteration, "outcome": "no usable external step"})
            break

        trial_external = max(0.1, min(10.0, external_scalar * step))
        trial_volumes = reassign(cumulative, demand_scalar, trial_external)
        trial_holdout = calibration.evaluate(attach_modelled_volumes(holdout_stations, trial_volumes))
        trial_objective = trial_holdout["objective"]

        if (
            trial_objective is not None
            and calibration.accept_step(best_objective, trial_objective, tol=-min_improvement)
            and step_improves_the_gate_metric(best_holdout, trial_holdout)
        ):
            external_scalar = trial_external
            best_volumes = trial_volumes
            best_objective = trial_objective
            best_holdout = trial_holdout
            best_fit = calibration.evaluate(attach_modelled_volumes(fit_stations, trial_volumes))
            accepted += 1
            steps.append({
                "stage": "external",
                "iteration": iteration,
                "outcome": "accepted",
                "external_demand_scalar": round(trial_external, 4),
                "holdout_median_ape": trial_holdout["median_ape"],
            })
        else:
            steps.append({
                "stage": "external",
                "iteration": iteration,
                "outcome": rejection_reason(
                    best_objective, trial_objective, best_holdout, trial_holdout
                ),
                "external_demand_scalar": round(trial_external, 4),
                "holdout_median_ape": trial_holdout["median_ape"],
            })
            break

    return {
        "method": (
            "per-road-class speed/capacity factors, then an overall demand scalar, then a separate "
            "external-demand scalar — each fitted to observed counts and validated out-of-sample"
        ),
        "engine": "workers/aequilibrae_worker/calibration.py",
        "accepted_iterations": accepted,
        "class_factors": {cls: round(value, 4) for cls, value in cumulative.items()},
        # A scalar on the whole trip matrix. 1.0 means stage 2 changed nothing.
        "demand_scalar": round(demand_scalar, 4),
        # Cordon traffic only. Separate from the demand scalar because the two
        # are different guesses with different evidence behind them.
        "external_demand_scalar": round(external_scalar, 4),
        "fit_station_count": len(fit_stations),
        "holdout_station_count": len(holdout_stations),
        "holdout_fraction": holdout_frac,
        "holdout_seed": seed,
        "baseline": {"fit": baseline_fit, "holdout": baseline_holdout},
        "calibrated": {"fit": best_fit, "holdout": best_holdout},
        # THE NUMBER THAT COUNTS, named so it cannot be confused with the other
        # one. The fit-set accuracy is reported beside it for completeness and is
        # not evidence of anything: it is the accuracy on the data the factors
        # were derived from.
        "reported_accuracy_basis": "held-out stations, never used to fit",
        "holdout_median_ape": best_holdout["median_ape"],
        "steps": steps,
        "volumes": best_volumes,
        "caveat": (
            "Calibrated to observed counts: per-road-class speed and capacity factors were fitted "
            f"to {len(fit_stations)} count stations and validated against {len(holdout_stations)} "
            "held back from the fit. The accuracy reported for this run is the held-out figure. "
            "This is a disclosed calibrated tier, not the screening default, and calibration does "
            "not by itself make a run pass the screening gate."
        ),
    }
