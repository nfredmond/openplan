#!/usr/bin/env python3
"""Supersede one flawed unopened rule and freeze evaluator ambiguities.

The original preregistration applied a separate marginal 95 percent interval
to every ActivitySim seed-by-alternative check.  Requiring all 100 marginal
checks to pass is not a 95 percent familywise test. This module corrects that
mathematical defect before acceptance outcomes are opened. It also records the
previously implicit implementation choices needed to execute the unchanged
rules reproducibly. It preserves the original preregistration and copies every
other acceptance rule unchanged.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
from statistics import NormalDist
from typing import Any, Iterable


SCHEMA_VERSION = (
    "openplan.activitysim-mandatory-tour-frequency-acceptance-protocol.v2"
)
STATUS = "supersedes_unopened_v1_before_acceptance_outcome_derivation"
ORIGINAL_SCHEMA_VERSION = (
    "openplan.activitysim-mandatory-tour-frequency-preregistration.v1"
)
ORIGINAL_STATUS = "pre_registered_before_mandatory_tour_outcome_derivation"
FAMILYWISE_ALPHA = 0.05
TRANSFER_CELL_FAMILY_ALPHA = 0.05
ALTERNATIVE_ORDER = (
    "work1",
    "work2",
    "school1",
    "school2",
    "work_and_school",
)


class MandatoryTourAcceptanceProtocolError(RuntimeError):
    """The superseding protocol cannot be created without changing the study."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_sha256(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def build_protocol(original_path: str | Path) -> dict[str, Any]:
    path = Path(original_path).resolve()
    try:
        original = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise MandatoryTourAcceptanceProtocolError(
            "The original mandatory-tour preregistration is unreadable"
        ) from exc
    if original.get("schema_version") != ORIGINAL_SCHEMA_VERSION:
        raise MandatoryTourAcceptanceProtocolError(
            "The original mandatory-tour preregistration schema is unsupported"
        )
    if original.get("status") != ORIGINAL_STATUS:
        raise MandatoryTourAcceptanceProtocolError(
            "Only the still-unopened mandatory-tour preregistration may be superseded"
        )
    stability = (original.get("acceptance_rules") or {}).get(
        "stochastic_stability"
    ) or {}
    seeds = stability.get("activitysim_seeds") or []
    alternatives = (original.get("study_population") or {}).get("alternatives") or {}
    if (
        len(seeds) != 20
        or len(set(seeds)) != len(seeds)
        or set(alternatives) != set(ALTERNATIVE_ORDER)
    ):
        raise MandatoryTourAcceptanceProtocolError(
            "The original seed-by-alternative family is not the locked 20 by 5 design"
        )
    if stability.get("every_seed_and_alternative_must_be_inside_interval") is not True:
        raise MandatoryTourAcceptanceProtocolError(
            "The original protocol no longer contains the multiplicity defect"
        )
    if "1.96*sqrt" not in str(stability.get("interval") or ""):
        raise MandatoryTourAcceptanceProtocolError(
            "The original stochastic interval is not the locked marginal rule"
        )

    comparison_count = len(seeds) * len(alternatives)
    per_comparison_alpha = FAMILYWISE_ALPHA / comparison_count
    critical = NormalDist().inv_cdf(1 - per_comparison_alpha / 2)
    acceptance_rules = copy.deepcopy(original["acceptance_rules"])
    unchanged_rules = {
        key: value
        for key, value in original["acceptance_rules"].items()
        if key != "stochastic_stability"
    }
    acceptance_rules["stochastic_stability"] = {
        "activitysim_seeds": list(seeds),
        "alternatives": list(ALTERNATIVE_ORDER),
        "every_seed_and_alternative_must_be_inside_interval": True,
        "familywise_confidence": 1 - FAMILYWISE_ALPHA,
        "familywise_method": "Bonferroni union bound",
        "comparison_count": comparison_count,
        "per_comparison_two_sided_alpha": per_comparison_alpha,
        "normal_critical_value": critical,
        "interval": (
            "For each seed and alternative, expected weighted share is "
            "sum(w_i*p_i)/sum(w_i). The simultaneous familywise 95% interval is "
            f"expected share plus or minus {critical:.15g}*"
            "sqrt(sum(w_i^2*p_i*(1-p_i)))/sum(w_i)."
        ),
        "dependence_contract": (
            "The union bound controls familywise error without assuming independence "
            "between alternatives or seeds."
        ),
    }
    implementation_contract = {
        "recorded_before_acceptance_outcomes_were_derived_or_read": True,
        "probability_scoring": {
            "candidate": (
                "Match ActivitySim 1.5.1 with sharrow disabled: cast every executable "
                "offset and learned coefficient to float32, promote the rounded values "
                "to float64 for the expression-value dot product, then compute shifted "
                "multinomial-logit probabilities in float64."
            ),
            "reference": "Use the frozen unrounded status-cell probabilities in float64.",
            "predictor_invalid_rows": "Use the frozen reference probabilities exactly.",
            "rounding_before_grading": False,
        },
        "survey_estimator": {
            "domain_method": (
                "Keep every positive-weekday-weight acceptance person in the survey "
                "design, including zero-contribution PSUs outside an analysis domain."
            ),
            "stratum": "Census division code crossed with NHTS STRATUMID",
            "primary_sampling_unit": "NHTS HOUSEID",
            "variance": (
                "With-replacement Taylor linearization, no finite-population correction, "
                "and refusal of singleton strata."
            ),
            "degrees_of_freedom": "sum over strata of PSU count minus one",
            "confidence_criticals": "Student t, not normal z",
        },
        "outcome_coverage": {
            "threshold_scope": "pooled acceptance partition only",
            "denominator": (
                "supported plus out-of-support mandatory patterns; incomplete diaries, "
                "no mandatory pattern, nonweekday records, and nonpositive weights are excluded"
            ),
        },
        "tour_totals": {
            "interval": "two-sided Taylor interval around the observed weighted mean",
            "division_rule": "each measure independently must pass at least two divisions",
        },
        "transfer_cells": {
            "cell_scope": "pooled acceptance cells, not division-by-cell",
            "holm_family_alpha": TRANSFER_CELL_FAMILY_ALPHA,
            "alternative": "candidate minus reference log loss is greater than zero",
            "p_values": "one-sided Student-t deterioration tests",
            "family": "all eligible pooled cells across all preregistered dimensions",
            "urban_rural_codes": {"01": "urban", "02": "rural"},
        },
        "stochastic_stability": {
            "population": "pooled supported acceptance rows",
            "row_order": "stable NHTS person identifier order mapped to contiguous person_id",
            "random_semantics": (
                "ActivitySim persons channel, mandatory_tour_frequency step, and choice_maker"
            ),
        },
    }
    return {
        "schema_version": SCHEMA_VERSION,
        "status": STATUS,
        "component": original.get("component"),
        "supersedes": {
            "schema_version": original["schema_version"],
            "preregistration_sha256": _sha256(path),
            "status_at_supersession": original["status"],
            "acceptance_outcomes_read": False,
        },
        "reason": {
            "kind": "a_priori_familywise_multiplicity_correction",
            "identified_before_acceptance_outcomes_were_derived_or_read": True,
            "original_independent_check_pass_probability": math.pow(0.95, comparison_count),
            "explanation": (
                "The original rule required 100 marginal 95% checks to pass. Even under "
                "independence, a correctly sampled model would pass all checks only about "
                "0.6% of the time."
            ),
            "development_results_used_to_choose_correction": False,
        },
        "acceptance_rules": acceptance_rules,
        "implementation_contract": implementation_contract,
        "unchanged_contract": {
            "all_non_stochastic_acceptance_rules_canonical_sha256": _canonical_sha256(
                unchanged_rules
            ),
            "candidate_and_reference_unchanged": True,
            "study_population_unchanged": True,
            "development_and_acceptance_divisions_unchanged": True,
            "source_archive_unchanged": True,
        },
        "limits": [
            "The only acceptance rule changed is simultaneous stochastic error control.",
            "The implementation contract resolves previously unstated evaluator choices without changing a threshold, candidate, reference, population, or geography.",
            "It does not use, summarize, or reveal acceptance outcomes.",
            "The original preregistration remains the historical record.",
        ],
    }


def write_protocol(protocol: dict[str, Any], output_path: str | Path) -> None:
    path = Path(output_path).resolve()
    rendered = json.dumps(protocol, indent=2, sort_keys=True) + "\n"
    if path.exists() or path.is_symlink():
        if path.is_file() and path.read_text() == rendered:
            return
        raise MandatoryTourAcceptanceProtocolError(
            "The superseding acceptance protocol exists and rewriting it is forbidden"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(rendered)


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original_preregistration")
    parser.add_argument("output")
    args = parser.parse_args(argv)
    protocol = build_protocol(args.original_preregistration)
    write_protocol(protocol, args.output)
    print(json.dumps(protocol, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
