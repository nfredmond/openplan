#!/usr/bin/env python3
"""The demand/assignment contract refuses rather than repairs.

WHY EVERY CHECK HERE IS A REFUSAL
=================================
A zone table whose rows do not line up with the matrix beside it produces a
complete run: the network downloads, the assignment converges, a map draws, and
every number describes nothing. There is no exception to catch and no stage that
reports failure — the run looks exactly like a good one.

That is the whole reason this contract exists as code rather than as a
convention. Once a second demand producer exists, "the matrix and the zone table
came from the same place" stops being obviously true, and it must be asserted at
the moment of reading.
"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np
import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from demand_package import (  # noqa: E402
    DemandPackageError,
    expand_matrix_for_cordons,
    read_demand_package,
    read_zone_package,
)


def write_package(
    directory: Path,
    *,
    zone_ids: list[int] | None = None,
    matrix: np.ndarray | None = None,
    matrix_labels: list[int] | None = None,
    drop_columns: tuple[str, ...] = (),
    extra_columns: dict | None = None,
    manifest: dict | None = None,
) -> Path:
    zone_ids = zone_ids or [1, 2, 3]
    zones = pd.DataFrame(
        {
            "GEOID": [f"0605700{z:04d}" for z in zone_ids],
            "NAMELSAD": [f"Census Tract {z}" for z in zone_ids],
            "zone_id": zone_ids,
            "centroid_lon": [-121.0 - 0.01 * z for z in zone_ids],
            "centroid_lat": [39.1 + 0.01 * z for z in zone_ids],
            "area_sq_mi": [7.5 for _ in zone_ids],
            "est_population": [1000.0 * z for z in zone_ids],
            "households": [400.0 * z for z in zone_ids],
            "total_jobs": [500.0 * z for z in zone_ids],
            "worker_residents": [450.0 * z for z in zone_ids],
        }
    )
    for column, values in (extra_columns or {}).items():
        zones[column] = values
    zones = zones.drop(columns=[c for c in drop_columns if c in zones.columns])
    zones.to_csv(directory / "zone_attributes.csv", index=False)

    if matrix is None:
        matrix = np.full((len(zone_ids), len(zone_ids)), 100.0)
    labels = matrix_labels if matrix_labels is not None else zone_ids
    od = pd.DataFrame(matrix, index=labels, columns=[str(z) for z in labels])
    od.index.name = "origin_zone"
    od.to_csv(directory / "od_trip_matrix.csv")

    if manifest is not None:
        (directory / "manifest.json").write_text(json.dumps(manifest))
    return directory


class PackageRoundTripTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_a_well_formed_package_loads(self) -> None:
        write_package(self.dir)
        package = read_demand_package(self.dir)

        self.assertEqual(list(package["zones"]["zone_id"]), [1, 2, 3])
        self.assertEqual(package["matrix"].shape, (3, 3))
        self.assertEqual(package["provenance"]["demand_source"], "supplied_package")
        self.assertEqual(package["provenance"]["zone_count"], 3)
        self.assertAlmostEqual(package["provenance"]["total_trips"], 900.0)

    def test_optional_columns_are_filled_with_honest_defaults(self) -> None:
        """A producer that replaces the gravity model has no reason to supply
        that model's inputs. Requiring them would refuse a perfectly good trip
        table for lacking things it makes unnecessary."""
        write_package(self.dir, drop_columns=("worker_residents", "households", "total_jobs"))
        zones = read_demand_package(self.dir)["zones"]

        self.assertEqual(list(zones["worker_residents"]), [0.0, 0.0, 0.0])
        self.assertEqual(list(zones["households"]), [0.0, 0.0, 0.0])
        # And the default zone kind is "a place", which is what a demand
        # producer can actually speak about.
        self.assertEqual(list(zones["zone_kind"]), ["internal"] * 3)

    def test_a_producer_manifest_travels_with_the_package(self) -> None:
        # How a reader learns the zone geography actually achieved and the
        # demand method — neither of which the assignment can work out itself.
        write_package(self.dir, manifest={"zone_geography": "block_group", "demand_method": "lodes_seeded_gravity_v1"})
        provenance = read_demand_package(self.dir)["provenance"]
        self.assertEqual(provenance["producer_manifest"]["zone_geography"], "block_group")

    def test_an_absent_manifest_is_none_not_an_empty_one(self) -> None:
        # "The producer said nothing" and "the producer said nothing useful"
        # are different facts, and a downstream caveat depends on which.
        write_package(self.dir)
        self.assertIsNone(read_demand_package(self.dir)["provenance"]["producer_manifest"])


class PackageRefusalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_a_matrix_that_does_not_match_the_zone_table_is_refused(self) -> None:
        """THE CHECK THIS MODULE EXISTS FOR. Three zones, a four-zone matrix:
        without this the run completes and every number is meaningless."""
        write_package(self.dir, zone_ids=[1, 2, 3], matrix=np.full((4, 4), 10.0), matrix_labels=[1, 2, 3, 4])
        with self.assertRaises(DemandPackageError) as caught:
            read_demand_package(self.dir)
        self.assertIn("does not line up", str(caught.exception))

    def test_a_matrix_in_a_different_zone_order_is_refused(self) -> None:
        # Same zones, same size, shuffled labels — the subtlest version, and the
        # one a size check alone would wave through.
        write_package(self.dir, zone_ids=[1, 2, 3], matrix_labels=[3, 1, 2])
        with self.assertRaises(DemandPackageError):
            read_demand_package(self.dir)

    def test_a_missing_required_column_names_itself(self) -> None:
        write_package(self.dir, drop_columns=("est_population",))
        with self.assertRaises(DemandPackageError) as caught:
            read_demand_package(self.dir)
        self.assertIn("est_population", str(caught.exception))

    def test_a_package_may_not_declare_cordon_zones(self) -> None:
        """A gateway depends on the road network and the study-area boundary.
        No demand producer knows where a highway crosses a county line, and an
        activity-based model has no concept of one. Refusing beats dropping:
        a silently discarded zone shifts every matrix row after it."""
        write_package(self.dir, extra_columns={"zone_kind": ["internal", "external", "internal"]})
        with self.assertRaises(DemandPackageError) as caught:
            read_demand_package(self.dir)
        self.assertIn("cordon", str(caught.exception))

    def test_repeated_zone_ids_are_refused(self) -> None:
        write_package(self.dir, zone_ids=[1, 2, 2], matrix_labels=[1, 2, 2])
        with self.assertRaises(DemandPackageError) as caught:
            read_demand_package(self.dir)
        self.assertIn("repeats zone_id", str(caught.exception))

    def test_negative_trips_are_refused(self) -> None:
        matrix = np.full((3, 3), 100.0)
        matrix[1][2] = -5.0
        write_package(self.dir, matrix=matrix)
        with self.assertRaises(DemandPackageError) as caught:
            read_demand_package(self.dir)
        self.assertIn("negative", str(caught.exception))

    def test_a_blank_population_is_refused_rather_than_read_as_zero(self) -> None:
        # Zero population is a real answer; a blank cell is a missing one, and
        # reading it as zero would silently shrink the VMT denominator.
        write_package(self.dir)
        zones = pd.read_csv(self.dir / "zone_attributes.csv")
        zones.loc[1, "est_population"] = None
        zones.to_csv(self.dir / "zone_attributes.csv", index=False)
        with self.assertRaises(DemandPackageError) as caught:
            read_demand_package(self.dir)
        self.assertIn("est_population", str(caught.exception))

    def test_missing_files_say_which_one(self) -> None:
        write_package(self.dir)
        (self.dir / "od_trip_matrix.csv").unlink()
        with self.assertRaises(DemandPackageError) as caught:
            read_demand_package(self.dir)
        self.assertIn("od_trip_matrix.csv", str(caught.exception))

    def test_a_directory_that_does_not_exist_says_so(self) -> None:
        with self.assertRaises(DemandPackageError) as caught:
            read_demand_package(self.dir / "nowhere")
        self.assertIn("does not exist", str(caught.exception))


class ZonePackageTests(unittest.TestCase):
    """Reading zones WITHOUT the demand — the reader that isolates a variable."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_zones_load_and_the_demand_source_says_whose_trips_these_are(self) -> None:
        write_package(self.dir)
        package = read_zone_package(self.dir)

        self.assertEqual(list(package["zones"]["zone_id"]), [1, 2, 3])
        self.assertNotIn("matrix", package)
        # A run whose ZONES came from elsewhere must be distinguishable from one
        # whose DEMAND did — they answer different questions about a result.
        self.assertEqual(
            package["provenance"]["demand_source"], "built_in_gravity_on_supplied_zones"
        )

    def test_a_matrix_is_ignored_rather_than_refused(self) -> None:
        """The same directory is a valid input to both readers. Which half of it
        you want is the caller's decision, made by choosing the function."""
        write_package(self.dir, matrix=np.full((3, 3), 999.0))
        package = read_zone_package(self.dir)
        self.assertEqual(len(package["zones"]), 3)

    def test_a_broken_zone_table_is_still_refused(self) -> None:
        # Skipping the matrix must not mean skipping the zone checks.
        write_package(self.dir, drop_columns=("est_population",))
        with self.assertRaises(DemandPackageError) as caught:
            read_zone_package(self.dir)
        self.assertIn("est_population", str(caught.exception))

    def test_cordon_zones_are_refused_here_too(self) -> None:
        write_package(self.dir, extra_columns={"zone_kind": ["internal", "external", "internal"]})
        with self.assertRaises(DemandPackageError):
            read_zone_package(self.dir)

    def test_a_zone_table_with_no_matrix_beside_it_still_loads(self) -> None:
        # The whole point: a producer may publish a zone system alone.
        write_package(self.dir)
        (self.dir / "od_trip_matrix.csv").unlink()
        self.assertEqual(len(read_zone_package(self.dir)["zones"]), 3)


class CordonExpansionTests(unittest.TestCase):
    def test_internal_zones_keep_their_positions(self) -> None:
        matrix = np.array([[1.0, 2.0], [3.0, 4.0]])
        expanded = expand_matrix_for_cordons(matrix, 4)

        self.assertEqual(expanded.shape, (4, 4))
        # The supplied block is untouched — if it moved, every trip would be
        # assigned between the wrong pair of zones.
        np.testing.assert_array_equal(expanded[:2, :2], matrix)
        # And the cordon rows and columns start empty: a demand producer said
        # nothing about travel through boundaries it does not know exist.
        self.assertEqual(expanded[2:, :].sum(), 0.0)
        self.assertEqual(expanded[:, 2:].sum(), 0.0)
        self.assertEqual(expanded.sum(), matrix.sum())

    def test_a_study_area_with_no_cordons_is_unchanged(self) -> None:
        matrix = np.array([[1.0, 2.0], [3.0, 4.0]])
        np.testing.assert_array_equal(expand_matrix_for_cordons(matrix, 2), matrix)

    def test_a_matrix_too_big_for_its_zone_system_is_refused(self) -> None:
        with self.assertRaises(DemandPackageError):
            expand_matrix_for_cordons(np.zeros((5, 5)), 3)


if __name__ == "__main__":
    unittest.main()
