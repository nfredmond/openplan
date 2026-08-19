#!/usr/bin/env python3
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import auto_ownership_fresh_holdout_registry as registry  # noqa: E402
from us_census_divisions import DIVISION_STATE_FIPS, census_division_for_state_fips  # noqa: E402


class FreshHoldoutRegistryTests(unittest.TestCase):
    def test_checked_in_candidate_package_matches_manifest_and_remains_unaccepted(self):
        package_path = (
            SCRIPT_DIR.parents[1]
            / "data/modeling/activitysim-auto-ownership-national-v1/coefficient_package.json"
        )
        package = json.loads(package_path.read_text())
        self.assertEqual(package["status"], "candidate_not_accepted_for_production")
        for filename, digest in package["files_sha256"].items():
            self.assertEqual(registry._sha256(package_path.parent / filename), digest)

    def test_us_adapter_assigns_every_state_and_no_territory(self):
        assigned = [code for codes in DIVISION_STATE_FIPS.values() for code in codes]
        self.assertEqual(len(assigned), 51)
        self.assertEqual(len(set(assigned)), 51)
        self.assertEqual(census_division_for_state_fips("06"), "pacific")
        self.assertIsNone(census_division_for_state_fips("72"))

    def test_selection_is_one_per_division_stable_and_excludes_spent_places(self):
        counties = []
        excluded = []
        for index, division in enumerate(sorted(DIVISION_STATE_FIPS)):
            state = DIVISION_STATE_FIPS[division][0]
            spent = f"{state}{index:03d}"
            fresh = f"{state}{index + 100:03d}"
            excluded.append(spent)
            counties.extend([
                {"geography_id": spent, "census_division": division, "population": 80_000},
                {"geography_id": fresh, "census_division": division, "population": 90_000},
            ])
        first = registry.select_geographies(counties, excluded_geography_ids=excluded)
        second = registry.select_geographies(reversed(counties), excluded_geography_ids=excluded)
        self.assertEqual(first, second)
        self.assertEqual(len(first), len(DIVISION_STATE_FIPS))
        self.assertTrue(all(row["geography_id"] not in excluded for row in first))
        self.assertEqual(
            {row["census_division"] for row in first}, set(DIVISION_STATE_FIPS)
        )

    def test_registry_locks_candidate_hash_rules_and_selection(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "coefficient_package.json"
            (root / "coefficients.csv").write_text("candidate\n")
            package.write_text(json.dumps({
                "status": "candidate_not_accepted_for_production",
                "component": "auto_ownership",
                "files_sha256": {"coefficients.csv": registry._sha256(root / "coefficients.csv")},
            }))
            counties = []
            for index, division in enumerate(sorted(DIVISION_STATE_FIPS)):
                counties.append({
                    "geography_id": f"{DIVISION_STATE_FIPS[division][0]}{index:03d}",
                    "census_division": division,
                    "population": 75_000,
                })
            result = registry.build_registry(
                counties,
                excluded_geography_ids=[],
                candidate_package_manifest=package,
            )
            self.assertEqual(result["geography_count"], 9)
            self.assertEqual(result["candidate"]["package_manifest_sha256"], registry._sha256(package))
            self.assertEqual(
                result["acceptance_rules"]["primary_metric"],
                "household-weighted vehicle-share total variation distance",
            )
            self.assertEqual(result["status"], "pre_registered_before_candidate_execution")

            (root / "coefficients.csv").write_text("modified\n")
            with self.assertRaisesRegex(registry.FreshHoldoutRegistryError, "does not match"):
                registry.build_registry(
                    counties,
                    excluded_geography_ids=[],
                    candidate_package_manifest=package,
                )


if __name__ == "__main__":
    unittest.main()
