#!/usr/bin/env python3
"""The nationwide gateway study cannot silently change after registration."""
from __future__ import annotations

import copy
import hashlib
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

import gateway_volume_study_registry as registry  # noqa: E402


def rucc_snapshot() -> bytes:
    lines = ["FIPS,State,County_Name,Attribute,Value"]
    state_by_region = {"Northeast": "36", "Midwest": "39", "South": "37", "West": "32"}
    county_number = 1
    for region, state_fips in state_by_region.items():
        for _, _, population_band in registry.POPULATION_BANDS:
            for urbanicity, rucc in (("metro", 2), ("nonmetro", 6)):
                for index in range(4):
                    county_fips = f"{state_fips}{county_number:03d}"
                    population = 50_000 if population_band == "25k_to_99k" else 150_000
                    name = f"{region} {population_band} {urbanicity} {index}"
                    lines.extend(
                        [
                            f"{county_fips},XX,{name},Population_2020,{population + index}",
                            f"{county_fips},XX,{name},RUCC_2023,{rucc}",
                            f"{county_fips},XX,{name},Description,fixture",
                        ]
                    )
                    county_number += 1
    return ("\n".join(lines) + "\n").encode()


def built_registry():
    return registry.build_registry(rucc_snapshot(), code_commit="a" * 40)


class SelectionTests(unittest.TestCase):
    def test_official_windows_1252_county_names_are_decoded_without_replacement(self):
        raw = (
            "FIPS,State,County_Name,Attribute,Value\n"
            "35013,NM,Doña Ana County,Population_2020,219561\n"
            "35013,NM,Doña Ana County,RUCC_2023,2\n"
        ).encode("cp1252")
        rows = registry.parse_rucc_snapshot(raw)
        self.assertEqual(rows[0]["county_name"], "Doña Ana County")

    def test_exactly_32_unexamined_counties_are_split_16_and_16(self):
        payload = built_registry()
        self.assertEqual(payload["counts"], {"total": 32, "development": 16, "holdout": 16})
        selected = [
            row["county_fips"]
            for half in ("development", "holdout")
            for row in payload["counties"][half]
        ]
        self.assertEqual(len(selected), len(set(selected)))
        self.assertTrue(set(selected).isdisjoint(registry.PREVIOUSLY_EXAMINED_COUNTIES))

    def test_each_half_has_every_region_population_and_urbanicity_cell_once(self):
        payload = built_registry()
        for half in ("development", "holdout"):
            cells = {
                (row["census_region"], row["population_band"], row["urbanicity"])
                for row in payload["counties"][half]
            }
            self.assertEqual(len(cells), 16)

    def test_selection_is_deterministic_and_the_seed_is_real(self):
        candidates = registry.parse_rucc_snapshot(rucc_snapshot())
        first = registry.select_counties(candidates)
        second = registry.select_counties(candidates)
        changed = registry.select_counties(candidates, seed=registry.SELECTION_SEED + 1)
        self.assertEqual(first, second)
        selected_ids = lambda halves: {
            row["county_fips"] for rows in halves.values() for row in rows
        }
        self.assertNotEqual(selected_ids(first), selected_ids(changed))

    def test_an_underfilled_cell_is_refused_not_backfilled(self):
        candidates = registry.parse_rucc_snapshot(rucc_snapshot())
        target = ("Northeast", "25k_to_99k", "metro")
        reduced = [
            row
            for row in candidates
            if (row["census_region"], row["population_band"], row["urbanicity"]) != target
        ]
        with self.assertRaisesRegex(registry.GatewayVolumeStudyRegistryError, "refusing to shrink"):
            registry.select_counties(reduced)


class IntegrityTests(unittest.TestCase):
    def test_registry_locks_counties_protocol_source_and_output_contract(self):
        payload = built_registry()
        self.assertEqual(
            payload["integrity"]["county_list_sha256"],
            registry.sha256_payload(payload["counties"]),
        )
        self.assertEqual(
            payload["integrity"]["protocol_sha256"],
            registry.sha256_payload(payload["protocol"]),
        )
        self.assertEqual(payload["source_snapshot"]["sha256"], hashlib.sha256(rucc_snapshot()).hexdigest())
        self.assertEqual(payload["protocol"]["observed_count_source"]["dataset_id"], "42um-tgh5")

    def test_missing_added_or_substituted_county_is_refused(self):
        for mutation in ("missing", "added", "substituted"):
            payload = built_registry()
            if mutation == "missing":
                payload["counties"]["holdout"].pop()
            elif mutation == "added":
                payload["counties"]["holdout"].append(copy.deepcopy(payload["counties"]["development"][0]))
            else:
                payload["counties"]["holdout"][0]["county_fips"] = "99999"
            with self.subTest(mutation=mutation), self.assertRaises(registry.GatewayVolumeStudyRegistryError):
                registry.validate_registry(payload)

    def test_changed_threshold_fails_the_payload_hash(self):
        payload = built_registry()
        payload["protocol"]["acceptance_thresholds"]["counties_improved_minimum"] = 11
        with self.assertRaisesRegex(registry.GatewayVolumeStudyRegistryError, "payload hash"):
            registry.validate_registry(payload)

    def test_sidecar_detects_file_tampering_and_rewrite_is_refused(self):
        payload = built_registry()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "registry.json"
            registry.write_registry(payload, path)
            registry.load_registry(path)
            altered = built_registry()
            altered["source_snapshot"]["vintage"] = "different"
            with self.assertRaises(registry.GatewayVolumeStudyRegistryError):
                registry.write_registry(altered, path)
            path.write_text(path.read_text().replace("nationwide", "changed", 1))
            with self.assertRaisesRegex(registry.GatewayVolumeStudyRegistryError, "sidecar"):
                registry.load_registry(path)


class HoldoutSealTests(unittest.TestCase):
    def setUp(self):
        self.registry = built_registry()
        self.candidate = registry.freeze_candidate(
            self.registry,
            candidate_commit="b" * 40,
            implementation_hashes={"gateways.py": "c" * 64},
        )

    def outputs(self):
        required = self.registry["protocol"]["required_outputs"]["per_county"]
        return {
            row["county_fips"]: {name: "d" * 64 for name in required}
            for row in self.registry["counties"]["development"]
        }

    def test_holdout_is_sealed_until_candidate_and_all_development_outputs_are_frozen(self):
        with self.assertRaisesRegex(registry.GatewayVolumeStudyRegistryError, "sealed"):
            registry.authorize_holdout(self.registry, None, None)
        outputs = self.outputs()
        outputs.pop(next(iter(outputs)))
        with self.assertRaisesRegex(registry.GatewayVolumeStudyRegistryError, "missing"):
            registry.freeze_development(self.registry, self.candidate, outputs)

    def test_complete_frozen_development_opens_the_exact_holdout_once(self):
        development = registry.freeze_development(self.registry, self.candidate, self.outputs())
        opened = registry.authorize_holdout(self.registry, self.candidate, development)
        self.assertEqual(
            opened["holdout_counties"],
            [row["county_fips"] for row in self.registry["counties"]["holdout"]],
        )
        self.assertRegex(opened["open_record_sha256"], r"^[0-9a-f]{64}$")

    def test_altering_a_frozen_candidate_or_development_result_is_refused(self):
        altered_candidate = copy.deepcopy(self.candidate)
        altered_candidate["candidate_commit"] = "e" * 40
        with self.assertRaises(registry.GatewayVolumeStudyRegistryError):
            registry.freeze_development(self.registry, altered_candidate, self.outputs())

        development = registry.freeze_development(self.registry, self.candidate, self.outputs())
        first_county = next(iter(development["county_outputs"]))
        first_output = next(iter(development["county_outputs"][first_county]))
        development["county_outputs"][first_county][first_output] = "f" * 64
        with self.assertRaisesRegex(registry.GatewayVolumeStudyRegistryError, "altered"):
            registry.authorize_holdout(self.registry, self.candidate, development)

    def test_a_versioned_successor_is_selected_without_rewriting_the_first_freeze(self):
        with tempfile.TemporaryDirectory() as raw_dir:
            root = Path(raw_dir)
            first = root / "candidate-freeze.json"
            second = root / "candidate-freeze-v2.json"
            first.write_text("{}")
            second.write_text("{}")
            self.assertEqual(registry.latest_candidate_freeze_path(root), second)


if __name__ == "__main__":
    unittest.main()
