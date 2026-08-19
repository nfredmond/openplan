#!/usr/bin/env python3
"""Build native ActivitySim auto-ownership EDBs from weighted NHTS diaries.

This script prepares estimation inputs; it does not label zero starting values
as estimated coefficients. Each requested holdout is a whole geographic fold.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable


BUNDLE_SCHEMA_VERSION = "openplan.activitysim-estimation-bundle.v1"
COMPONENT = "auto_ownership"
ALTERNATIVES = ("cars0", "cars1", "cars2", "cars3", "cars4")

PREDICTORS = (
    ("drivers_1", "num_drivers == 1"),
    ("drivers_2", "num_drivers == 2"),
    ("drivers_3", "num_drivers == 3"),
    ("drivers_4_up", "num_drivers >= 4"),
    ("hhsize_clip_5", "@df.hhsize.clip(upper=5)"),
    ("workers_clip_3", "@df.num_workers.clip(upper=3)"),
    ("income_ge_35k", "income_ge_35k"),
    ("income_ge_75k", "income_ge_75k"),
    ("income_ge_150k", "income_ge_150k"),
    ("constant", "1"),
)


class AutoOwnershipEstimationError(RuntimeError):
    pass


def _read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as handle:
        return list(csv.DictReader(handle))


def _write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def _integer(value: Any) -> int | None:
    try:
        result = int(float(value))
    except (TypeError, ValueError):
        return None
    return result if result >= 0 else None


def _positive_weight(value: Any) -> float | None:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if result > 0 else None


def estimation_chooser(row: dict[str, str]) -> tuple[dict[str, Any] | None, str | None]:
    values = {
        "choice": _integer(row.get("vehicles")),
        "hhsize": _integer(row.get("household_size")),
        "num_workers": _integer(row.get("workers")),
        "num_drivers": _integer(row.get("drivers")),
        "income_category": _integer(row.get("income_category_code")),
        "holdout_fold": _integer(row.get("holdout_fold")),
        "survey_weight": _positive_weight(row.get("survey_weight")),
    }
    missing = [name for name, value in values.items() if value is None]
    if missing:
        return None, "missing_" + "_and_".join(sorted(missing))
    if not 1 <= values["income_category"] <= 11:
        return None, "income_category_out_of_contract"
    return {
        "household_id": row["household_id"],
        "override_choice": min(values["choice"], 4),
        "survey_weight": values["survey_weight"],
        "holdout_fold": values["holdout_fold"],
        "num_drivers": values["num_drivers"],
        "hhsize": values["hhsize"],
        "num_workers": values["num_workers"],
        # The official categories have boundaries at $35k, $75k and $150k.
        # Indicators preserve what is known without inventing bracket midpoints.
        "income_ge_35k": int(values["income_category"] >= 5),
        "income_ge_75k": int(values["income_category"] >= 7),
        "income_ge_150k": int(values["income_category"] >= 10),
    }, None


def _spec_rows() -> list[dict[str, Any]]:
    rows = []
    for label, expression in PREDICTORS:
        row: dict[str, Any] = {
            "Label": f"util_{label}",
            "Description": label.replace("_", " "),
            "Expression": expression,
            "cars0": "",
        }
        for alternative in ALTERNATIVES[1:]:
            row[alternative] = f"coef_{alternative}_{label}"
        rows.append(row)
    return rows


def _coefficient_rows() -> list[dict[str, Any]]:
    return [
        {"coefficient_name": f"coef_{alternative}_{label}", "value": 0, "constrain": "F"}
        for label, _expression in PREDICTORS
        for alternative in ALTERNATIVES[1:]
    ]


def _write_edb(directory: Path, choosers: list[dict[str, Any]]) -> None:
    component = directory / COMPONENT
    _write_csv(
        component / f"{COMPONENT}_values_combined.csv",
        choosers,
        list(choosers[0]),
    )
    _write_csv(
        component / f"{COMPONENT}_SPEC.csv",
        _spec_rows(),
        ["Label", "Description", "Expression", *ALTERNATIVES],
    )
    _write_csv(
        component / f"{COMPONENT}_coefficients.csv",
        _coefficient_rows(),
        ["coefficient_name", "value", "constrain"],
    )
    (component / f"{COMPONENT}_model_settings.yaml").write_text(
        "SPEC: auto_ownership_SPEC.csv\n"
        "COEFFICIENTS: auto_ownership_coefficients.csv\n"
        "LOGIT_TYPE: MNL\n"
    )


def _partition_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    choices = {str(choice): {"records": 0, "survey_weight": 0.0} for choice in range(5)}
    for row in rows:
        item = choices[str(row["override_choice"])]
        item["records"] += 1
        item["survey_weight"] += row["survey_weight"]
    for item in choices.values():
        item["survey_weight"] = round(item["survey_weight"], 6)
    return {
        "records": len(rows),
        "survey_weight": round(sum(row["survey_weight"] for row in rows), 6),
        "choices": choices,
    }


def build_bundles(diaries_dir: str | Path, output_dir: str | Path) -> dict[str, Any]:
    diaries = Path(diaries_dir)
    source_manifest_path = diaries / "manifest.json"
    source_manifest = json.loads(source_manifest_path.read_text())
    if source_manifest.get("schema_version") != "openplan.behavioral-survey-diaries.v3":
        raise AutoOwnershipEstimationError(
            "Auto-ownership estimation requires behavioral diary schema v3 with observed drivers"
        )
    households = _read_csv(diaries / "observed_households.csv")
    choosers: list[dict[str, Any]] = []
    exclusions: dict[str, int] = {}
    for household in households:
        chooser, reason = estimation_chooser(household)
        if reason:
            exclusions[reason] = exclusions.get(reason, 0) + 1
        else:
            choosers.append(chooser)
    if not choosers:
        raise AutoOwnershipEstimationError("No households satisfy the auto-ownership contract")

    folds = sorted({row["holdout_fold"] for row in choosers})
    if len(folds) < 2:
        raise AutoOwnershipEstimationError("Auto-ownership estimation needs at least two geographic folds")
    output = Path(output_dir)
    _write_edb(output / "all", choosers)
    fold_manifest = []
    for fold in folds:
        train = [row for row in choosers if row["holdout_fold"] != fold]
        validation = [row for row in choosers if row["holdout_fold"] == fold]
        if not train or not validation:
            raise AutoOwnershipEstimationError(f"Geographic holdout fold {fold} is empty")
        _write_edb(output / f"fold_{fold}" / "train", train)
        _write_edb(output / f"fold_{fold}" / "validation", validation)
        fold_manifest.append({
            "holdout_fold": fold,
            "train": _partition_summary(train),
            "validation": _partition_summary(validation),
        })

    manifest = {
        "schema_version": BUNDLE_SCHEMA_VERSION,
        "component": COMPONENT,
        "status": "estimation_input_not_coefficients",
        "estimator_contract": "ActivitySim simple_simulate EDB; Larch case weight variable survey_weight",
        "source_diary_schema_version": source_manifest["schema_version"],
        "source_manifest_sha256": hashlib.sha256(source_manifest_path.read_bytes()).hexdigest(),
        "records_received": len(households),
        "records_eligible": len(choosers),
        "exclusions": dict(sorted(exclusions.items())),
        "all": _partition_summary(choosers),
        "holdouts": fold_manifest,
        "predictor_scope": {
            "included": [label for label, _expression in PREDICTORS],
            "excluded": {
                "Bay_Area_county_constants": "not nationally transferable",
                "network_accessibility": "public-use NHTS has no matching local LOS",
                "local_density_index": "not consistently defined between NHTS and runtime land use",
            },
        },
        "caveat": "This bundle contains observations and zero starting values, not estimated or validated coefficients.",
    }
    output.mkdir(parents=True, exist_ok=True)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("diaries_dir")
    parser.add_argument("output_dir")
    args = parser.parse_args(argv)
    print(json.dumps(build_bundles(args.diaries_dir, args.output_dir), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
