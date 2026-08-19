#!/usr/bin/env python3
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import package_activitysim_coefficients as package  # noqa: E402


def fixture(root: Path, *, weighted=True):
    bundle = root / "bundle"
    component = bundle / "all/auto_ownership"
    component.mkdir(parents=True)
    (bundle / "manifest.json").write_text(json.dumps({
        "schema_version": "openplan.activitysim-estimation-bundle.v1"
    }) + "\n")
    (component / "auto_ownership_SPEC.csv").write_text(
        "Label,Description,Expression,cars0,cars1,cars2,cars3,cars4\n"
        "util_constant,constant,1,,coef_1,coef_2,coef_3,coef_4\n"
    )
    fit = root / "fit"
    fit.mkdir()
    (fit / "fit_manifest.json").write_text(json.dumps({
        "schema_version": "openplan.activitysim-estimation-fit.v1",
        "status": "estimated_not_accepted_for_production",
        "survey_weight_applied": weighted,
        "aggregate_holdout_metrics": {"folds": 5},
        "all_data_convergence": {"converged": True},
    }) + "\n")
    (fit / "auto_ownership_coefficients_estimated.csv").write_text(
        "coefficient_name,value,constrain\ncoef_1,1.25,F\n"
    )
    return bundle, fit


class CoefficientPackageTests(unittest.TestCase):
    def test_package_is_a_hash_locked_single_component_overlay(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bundle, fit = fixture(root)
            manifest = package.package_auto_ownership(bundle, fit, root / "overlay")
            self.assertEqual(manifest["status"], "candidate_not_accepted_for_production")
            self.assertEqual(manifest["coefficient_scope"], ["auto_ownership"])
            self.assertEqual(len(manifest["files_sha256"]), 3)
            self.assertIn("SPEC: auto_ownership.csv", (root / "overlay/auto_ownership.yaml").read_text())
            self.assertEqual(
                (root / "overlay/auto_ownership_coefficients.csv").read_text(),
                (fit / "auto_ownership_coefficients_estimated.csv").read_text(),
            )

    def test_unweighted_fit_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            bundle, fit = fixture(root, weighted=False)
            with self.assertRaisesRegex(package.CoefficientPackageError, "unweighted"):
                package.package_auto_ownership(bundle, fit, root / "overlay")


if __name__ == "__main__":
    unittest.main()
