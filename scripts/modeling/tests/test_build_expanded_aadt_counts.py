import unittest
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_expanded_aadt_counts import resolve_adjacent_section_volume


class AdjacentSectionResolutionTest(unittest.TestCase):
    def test_unequal_values_are_ambiguous_without_route_lrs_side_evidence(self):
        self.assertEqual(
            resolve_adjacent_section_volume(8_000, 12_000),
            (None, "ambiguous_adjacent_sections"),
        )

    def test_route_lrs_evidence_selects_the_named_side_not_the_larger_value(self):
        self.assertEqual(
            resolve_adjacent_section_volume(8_000, 12_000, selected_side="back", route_lrs_match=True),
            (8_000, "route_lrs_selected_back"),
        )
        self.assertEqual(
            resolve_adjacent_section_volume(12_000, 8_000, selected_side="ahead", route_lrs_match=True),
            (8_000, "route_lrs_selected_ahead"),
        )

    def test_equal_values_need_no_side_choice(self):
        self.assertEqual(
            resolve_adjacent_section_volume(9_500, 9_500),
            (9_500, "equal_adjacent_sections"),
        )


if __name__ == "__main__":
    unittest.main()
