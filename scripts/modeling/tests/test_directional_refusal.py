"""Synthetic directional refusal; never consumes a study or holdout."""
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parent))
import test_validation_instrument_v2 as fixture
import validation_instrument_v2 as matcher
import model_validation_core_v5 as core


class DirectionalRefusalTests(unittest.TestCase):
    def test_directional_counts_on_bidirectional_links_remain_ambiguous(self):
        for direction in ("east", "west"):
            for coordinates in ([[-121.01, 39], [-120.99, 39]], [[-120.99, 39], [-121.01, 39]], [[-121,38.99],[-121,39.01]]):
                with self.subTest(direction=direction, coordinates=coordinates):
                    item = fixture.observation()
                    item["direction_lane_carriageway"]["direction"] = direction
                    result = matcher.match_observation(item, [fixture.link("a", coordinates, direction=0)], search_distance_meters=200)
                    self.assertEqual(result["status"], "ambiguous")
                    self.assertEqual(result["selected_link_ids"], [])

    def test_combined_and_proven_one_way_controls_remain_supported(self):
        for basis, network_direction in (("combined_directions", 0), ("one_direction", 1)):
            item = fixture.observation(direction=basis)
            match = matcher.match_observation(item, [fixture.link("a", [[-121.01,39],[-120.99,39]], direction=network_direction)], search_distance_meters=200)
            self.assertEqual(match["status"], "matched")
            result = core.assess_validation([item], fixture.audit(item, match), fixture.basis(item), {"a":100}, assessment_id="synthetic", input_bundle_sha256=fixture.HASH)
            self.assertEqual(result["observation_results"][0]["modeled_value"],100)
            self.assertEqual(result["scientific_outcome"],"inconclusive")

    def test_legacy_directional_total_audit_is_refused_before_scoring(self):
        item = fixture.observation()
        for candidates in ([], [{"link_id":"a","link_direction":0}], [{"link_id":"wrong","link_direction":1}]):
            with self.subTest(candidates=candidates):
                match={"observation_id":item["observation_id"],"status":"matched","selected_link_ids":["a"],"direction_aggregation":"one_direction","candidate_links":candidates}
                with self.assertRaisesRegex(core.ContractError,"Directional assessment requires proven one-way links"):
                    core.assess_validation([item],fixture.audit(item,match),fixture.basis(item),{"a":1000},assessment_id="synthetic",input_bundle_sha256=fixture.HASH)

if __name__ == "__main__": unittest.main()
