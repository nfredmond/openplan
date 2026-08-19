#!/usr/bin/env python3
"""Package an estimated ActivitySim component as a provenance-locked overlay."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path
from typing import Iterable


PACKAGE_SCHEMA_VERSION = "openplan.activitysim-coefficient-package.v1"


class CoefficientPackageError(RuntimeError):
    pass


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def package_auto_ownership(
    bundle_dir: str | Path, fit_dir: str | Path, output_dir: str | Path
) -> dict:
    bundle = Path(bundle_dir)
    fit = Path(fit_dir)
    output = Path(output_dir)
    bundle_manifest_path = bundle / "manifest.json"
    fit_manifest_path = fit / "fit_manifest.json"
    bundle_manifest = json.loads(bundle_manifest_path.read_text())
    fit_manifest = json.loads(fit_manifest_path.read_text())
    if bundle_manifest.get("schema_version") != "openplan.activitysim-estimation-bundle.v1":
        raise CoefficientPackageError("Unsupported estimation bundle schema")
    if fit_manifest.get("schema_version") != "openplan.activitysim-estimation-fit.v1":
        raise CoefficientPackageError("Unsupported estimation fit schema")
    if fit_manifest.get("status") != "estimated_not_accepted_for_production":
        raise CoefficientPackageError("Only measured, geographically validated fits may be packaged")
    if not fit_manifest.get("survey_weight_applied"):
        raise CoefficientPackageError("Refusing an unweighted national coefficient package")

    source_spec = bundle / "all" / "auto_ownership" / "auto_ownership_SPEC.csv"
    source_coefficients = fit / "auto_ownership_coefficients_estimated.csv"
    required = [source_spec, source_coefficients]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise CoefficientPackageError("Missing coefficient-package inputs: " + ", ".join(missing))

    output.mkdir(parents=True, exist_ok=True)
    spec = output / "auto_ownership.csv"
    coefficients = output / "auto_ownership_coefficients.csv"
    settings = output / "auto_ownership.yaml"
    shutil.copyfile(source_spec, spec)
    shutil.copyfile(source_coefficients, coefficients)
    settings.write_text(
        "SPEC: auto_ownership.csv\n"
        "COEFFICIENTS: auto_ownership_coefficients.csv\n"
        "LOGIT_TYPE: MNL\n"
    )
    manifest = {
        "schema_version": PACKAGE_SCHEMA_VERSION,
        "component": "auto_ownership",
        "status": "candidate_not_accepted_for_production",
        "activitysim_overlay_files": [
            "auto_ownership.yaml", "auto_ownership.csv", "auto_ownership_coefficients.csv"
        ],
        "source_bundle_manifest_sha256": _sha256(bundle_manifest_path),
        "source_fit_manifest_sha256": _sha256(fit_manifest_path),
        "files_sha256": {
            path.name: _sha256(path) for path in (settings, spec, coefficients)
        },
        "holdout_metrics": fit_manifest["aggregate_holdout_metrics"],
        "all_data_convergence": fit_manifest["all_data_convergence"],
        "coefficient_scope": ["auto_ownership"],
        "caveat": (
            "This overlay replaces only auto ownership. Every other ActivitySim component "
            "continues to use its separately named coefficient source. Candidate status does "
            "not authorize production selection."
        ),
    }
    (output / "coefficient_package.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    )
    return manifest


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle_dir")
    parser.add_argument("fit_dir")
    parser.add_argument("output_dir")
    args = parser.parse_args(argv)
    print(json.dumps(
        package_auto_ownership(args.bundle_dir, args.fit_dir, args.output_dir),
        indent=2,
        sort_keys=True,
    ))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
