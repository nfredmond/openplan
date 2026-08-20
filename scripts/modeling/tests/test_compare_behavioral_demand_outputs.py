from __future__ import annotations

import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from compare_behavioral_demand_outputs import (
    compare_behavioral_demand_outputs,
    compare_link_volume_runs,
    geojson_for_agreement,
    read_link_names,
    read_retained_network_geometry,
)
from corridor_agreement import build_agreement_map


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")


NETWORK_DIGEST = "a" * 64
PRODUCER_FIXTURE = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "producer_corridor_agreement_v2.geojson"
)


def convergence_record(gap: float = 0.0003) -> dict:
    profile = {
        "schema_version": "openplan.assignment-profile.v1",
        "profile_id": "aequilibrae-bfw-bpr-tight-v1",
        "engine": "aequilibrae",
        "engine_version": "1.4.2",
        "algorithm": "bfw",
        "vdf": "BPR",
        "vdf_parameters": {"alpha": 0.15, "beta": 4},
        "capacity_field": "capacity",
        "time_field": "travel_time",
        "class_pce": 1,
        "cores": 2,
        "target_gap": 0.0005,
        "max_iterations": 3000,
    }
    profile_payload = json.dumps(
        profile, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    )
    digest = hashlib.sha256(profile_payload.encode()).hexdigest()
    return {
        "final_gap": gap,
        "iterations": 84,
        "target_gap": profile["target_gap"],
        "max_iterations": profile["max_iterations"],
        "algorithm": profile["algorithm"],
        "converged": True,
        "assignment_profile": profile,
        "assignment_profile_payload_json": profile_payload,
        "assignment_profile_digest": digest,
    }


def id_digest(link_ids: list[int]) -> str:
    return hashlib.sha256(
        json.dumps(sorted(link_ids), separators=(",", ":")).encode()
    ).hexdigest()


def verified_network_evidence(
    all_link_ids: list[int],
    *,
    roadway_link_ids: list[int] | None = None,
    connector_link_ids: list[int] | None = None,
    factors: dict[str, float] | None = None,
) -> dict:
    roadway_ids = sorted(roadway_link_ids if roadway_link_ids is not None else all_link_ids)
    connector_ids = sorted(connector_link_ids or [])
    manifest = {
        "schema_version": "openplan.retained-network-manifest.v1",
        "all_link_count": len(all_link_ids),
        "all_link_ids_digest": id_digest(all_link_ids),
        "roadway_link_count": len(roadway_ids),
        "roadway_link_ids_digest": id_digest(roadway_ids),
        "modeling_connector_link_count": len(connector_ids),
        "modeling_connector_link_ids_digest": id_digest(connector_ids),
        "excluded_roles": ["modeling_connector"],
        "role_definition": {
            "roadway": "link_type != centroid_connector",
            "modeling_connector": "link_type = centroid_connector",
        },
    }
    settings = {
        "schema_version": "openplan.network-calibration.v1",
        "road_class_factors": factors or {},
        "application": {
            "travel_time": "baseline_travel_time / factor",
            "capacity": "baseline_capacity * factor",
        },
        "excludes": ["trip_based_od_adjustments"],
    }
    settings_payload = json.dumps(settings, sort_keys=True, separators=(",", ":"))
    settings_digest = hashlib.sha256(settings_payload.encode()).hexdigest()
    component_digest = hashlib.sha256(b"component").hexdigest()
    state = {
        "schema_version": "openplan.assignment-network-state.v1",
        "network_settings_digest": settings_digest,
        "assignment_centroid_count": 2,
        "assignment_centroid_order_digest": component_digest,
        "block_centroid_flows": True,
        "penalty_through_centroids": "positive_infinity",
        "cost_field": "travel_time",
        "capacity_field": "capacity",
        "graph_row_count": len(all_link_ids),
        "graph_rows_digest": component_digest,
        "graph_float_dtype": "<f8",
        "graph_cost_digest": component_digest,
        "graph_cost_dtype": "<f8",
        "compact_cost_digest": component_digest,
        "compact_cost_dtype": "<f8",
        "solver_free_flow_tt_digest": component_digest,
        "solver_free_flow_tt_dtype": "<f8",
        "solver_capacity_digest": component_digest,
        "solver_capacity_dtype": "<f8",
        "retained_network_digest": component_digest,
        "retained_network_manifest": manifest,
    }
    state_digest = hashlib.sha256(
        json.dumps(state, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    return {
        "first_network_settings_payload_json": settings_payload,
        "first_network_settings_digest": settings_digest,
        "second_network_settings_payload_json": settings_payload,
        "second_network_settings_digest": settings_digest,
        "first_network_state_record": state,
        "first_network_state_digest": state_digest,
        "second_network_state_record": json.loads(json.dumps(state)),
        "second_network_state_digest": state_digest,
        "retained_network_manifest": manifest,
        "geometry_network_state_digest": state_digest,
        "geometry_roadway_link_ids": roadway_ids,
    }


def assignment_evidence_kwargs(evidence: dict) -> dict:
    return {
        key: value
        for key, value in evidence.items()
        if key.startswith("first_") or key.startswith("second_")
    }


def producer_corridor_agreement_v2(root: Path) -> dict:
    """Reconstruct the browser contract through the real Python producer."""
    all_ids = [1, 2, 3, 900]
    roadway_ids = [1, 2, 3]
    evidence = verified_network_evidence(
        all_ids,
        roadway_link_ids=roadway_ids,
        connector_link_ids=[900],
        factors={"motorway": 1.05, "primary": 0.98},
    )
    first_convergence = convergence_record(gap=0.0003)
    second_convergence = convergence_record(gap=0.0003)
    source_path = root / "retained_network.geojson"
    write_json(
        source_path,
        {
            "type": "FeatureCollection",
            "metadata": {
                "retained_network_manifest": evidence["retained_network_manifest"],
                "network_state_digest": evidence["geometry_network_state_digest"],
                "source_feature_count": 3,
            },
            "features": [
                {
                    "type": "Feature",
                    "geometry": {
                        "type": "LineString",
                        "coordinates": [[-121.0 + link_id / 100, 39.0], [-121.0 + link_id / 100, 39.01]],
                    },
                    "properties": {
                        "link_id": link_id,
                        "name": f"Road {link_id}",
                        "link_type": "motorway" if link_id == 1 else "primary",
                    },
                }
                for link_id in roadway_ids
            ],
        },
    )
    agreement = build_agreement_map(
        [
            {"link_id": 1, "PCE_tot": 20_000.004},
            {"link_id": 2, "PCE_tot": 10_000.004},
            {"link_id": 3, "PCE_tot": 10_000},
            {"link_id": 900, "PCE_tot": 999_999},
        ],
        [
            {"link_id": 1, "PCE_tot": 20_100.004},
            {"link_id": 2, "PCE_tot": 10_506.244},
            {"link_id": 3, "PCE_tot": 12_000},
            {"link_id": 900, "PCE_tot": 1},
        ],
        first_label="trip-based",
        second_label="activity-based",
        link_names={
            link_id: {
                "name": f"Road {link_id}",
                "link_type": "motorway" if link_id == 1 else "primary",
            }
            for link_id in roadway_ids
        },
        first_convergence=first_convergence,
        second_convergence=second_convergence,
        first_assignment_profile_payload_json=first_convergence[
            "assignment_profile_payload_json"
        ],
        first_assignment_profile_digest=first_convergence["assignment_profile_digest"],
        second_assignment_profile_payload_json=second_convergence[
            "assignment_profile_payload_json"
        ],
        second_assignment_profile_digest=second_convergence["assignment_profile_digest"],
        **evidence,
    )
    return geojson_for_agreement(
        agreement,
        retained_geometry=read_retained_network_geometry(source_path),
    )


class CompareBehavioralDemandOutputsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_compares_successful_outputs_and_reports_mismatched_coverage(self) -> None:
        current_path = self.root / "current.json"
        baseline_path = self.root / "baseline.json"
        write_json(
            current_path,
            {
                "summary_type": "activitysim_behavioral_kpi_summary",
                "source": {"runtime_mode": "activitysim_cli", "runtime_status": "succeeded"},
                "availability": {"status": "behavioral_kpis_available", "reasons": []},
                "totals": {"trips": 120},
                "trip_volumes_by_purpose": {
                    "values": [
                        {"label": "work", "count": 80, "share": 0.666667},
                        {"label": "school", "count": 40, "share": 0.333333},
                    ]
                },
                "mode_shares": {"values": []},
                "segment_summaries": [],
                "caveats": ["Current prototype only."],
            },
        )
        write_json(
            baseline_path,
            {
                "summary_type": "activitysim_behavioral_kpi_summary",
                "source": {"runtime_mode": "activitysim_cli", "runtime_status": "succeeded"},
                "availability": {"status": "behavioral_kpis_available", "reasons": []},
                "totals": {"trips": 100},
                "trip_volumes_by_purpose": {"values": [{"label": "work", "count": 100, "share": 1.0}]},
                "mode_shares": {"values": []},
                "segment_summaries": [],
                "caveats": [],
            },
        )

        result = compare_behavioral_demand_outputs(current=str(current_path), baseline=str(baseline_path))

        comparison = json.loads(Path(result["json_path"]).read_text())
        self.assertEqual(comparison["support"]["status"], "behavioral_comparison_available")
        self.assertEqual(comparison["coverage"]["comparable_kpi_count"], 3)
        self.assertEqual(comparison["coverage"]["current_only_count"], 2)
        self.assertIn("Current run has 2 behavioral KPI rows", " ".join(comparison["exclusions"]))

    def test_blocks_preflight_only_comparison(self) -> None:
        current_path = self.root / "current-preflight.json"
        baseline_path = self.root / "baseline-preflight.json"
        payload = {
            "summary_type": "activitysim_behavioral_kpi_summary",
            "source": {"runtime_mode": "preflight_only", "runtime_status": "blocked"},
            "availability": {"status": "not_enough_behavioral_outputs", "reasons": ["preflight"]},
            "totals": {},
            "trip_volumes_by_purpose": {"values": []},
            "mode_shares": {"values": []},
            "segment_summaries": [],
            "caveats": ["Preflight only."],
        }
        write_json(current_path, payload)
        write_json(baseline_path, payload)

        result = compare_behavioral_demand_outputs(current=str(current_path), baseline=str(baseline_path))

        comparison = json.loads(Path(result["json_path"]).read_text())
        self.assertFalse(comparison["support"]["supportable"])
        self.assertEqual(comparison["support"]["status"], "behavioral_comparison_blocked")
        self.assertEqual(comparison["comparison"]["rows"], [])

    def test_marks_failed_or_partial_outputs_as_partial_only_comparison(self) -> None:
        current_path = self.root / "current-partial.json"
        baseline_path = self.root / "baseline-packet.json"
        write_json(
            current_path,
            {
                "summary_type": "activitysim_behavioral_kpi_summary",
                "source": {"runtime_mode": "activitysim_cli", "runtime_status": "failed"},
                "availability": {"status": "partial_behavioral_outputs", "reasons": ["partial"]},
                "totals": {"trips": 40},
                "trip_volumes_by_purpose": {"values": [{"label": "work", "count": 40, "share": 1.0}]},
                "mode_shares": {"values": []},
                "segment_summaries": [],
                "caveats": ["Partial only."],
            },
        )
        write_json(
            baseline_path,
            {
                "packet_type": "behavioral_demand_evidence_packet",
                "source": {"behavioral_manifest_path": "/tmp/baseline/behavioral_demand_prototype_manifest.json"},
                "prototype_chain": {
                    "runtime": {"mode": "activitysim_cli", "status": "succeeded"},
                    "behavioral_kpis": {
                        "availability_status": "behavioral_kpis_available",
                        "totals": {"trips": 20},
                        "trip_volumes_by_purpose": {"values": [{"label": "work", "count": 20, "share": 1.0}]},
                        "mode_shares": {"values": []},
                        "segment_summaries": [],
                    },
                },
                "caveats": ["Baseline packet."],
            },
        )

        result = compare_behavioral_demand_outputs(current=str(current_path), baseline=str(baseline_path))

        comparison = json.loads(Path(result["json_path"]).read_text())
        self.assertTrue(comparison["support"]["supportable"])
        self.assertTrue(comparison["support"]["partial"])
        self.assertEqual(comparison["support"]["status"], "behavioral_comparison_partial_only")
        self.assertEqual(len(comparison["comparison"]["rows"]), 3)


class ComparingTwoDemandModelsOnOneNetwork(unittest.TestCase):
    """The method-versus-method mode, added to THIS comparator on purpose.

    A second script comparing two runs is how two ways of answering one question
    drift apart, so the link-volume comparison lives behind the same entry point
    as the KPI comparison rather than beside it.
    """

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _links_csv(self, name: str, volumes: dict[int, float]) -> Path:
        path = self.root / name
        lines = ["link_id,PCE_tot"] + [f"{k},{v}" for k, v in volumes.items()]
        path.write_text("\n".join(lines) + "\n")
        return path

    def _loaded_links(
        self,
        name: str,
        link_ids: list[int],
        *,
        all_link_ids: list[int] | None = None,
        connector_link_ids: list[int] | None = None,
        road_name: str | None = None,
    ) -> Path:
        path = self.root / name
        evidence = verified_network_evidence(
            all_link_ids or link_ids,
            roadway_link_ids=link_ids,
            connector_link_ids=connector_link_ids,
        )
        write_json(
            path,
            {
                "type": "FeatureCollection",
                "metadata": {
                    "retained_network_manifest": evidence["retained_network_manifest"],
                    "network_state_digest": evidence["geometry_network_state_digest"],
                    "source_feature_count": len(link_ids),
                },
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [[link_id, 0], [link_id, 1]],
                        },
                        "properties": {
                            "link_id": link_id,
                            "name": road_name or f"Road {link_id}",
                            "link_type": "road",
                        },
                    }
                    for link_id in link_ids
                ],
            },
        )
        return path

    def test_it_writes_an_agreement_map_for_two_runs(self) -> None:
        first = self._links_csv("a.csv", {1: 20_000, 2: 500})
        second = self._links_csv("b.csv", {1: 20_100, 2: 4_000})

        result = compare_link_volume_runs(
            first_csv=str(first),
            second_csv=str(second),
            first_label="trip-based",
            second_label="activity-based",
            output_dir=str(self.root / "out"),
        )

        payload = json.loads(Path(result["json_path"]).read_text())
        self.assertEqual(payload["methods"]["second"], "activity-based")
        self.assertEqual(result["summary"]["links_carrying_meaningful_traffic"], 2)
        self.assertIn("never averaged", " ".join(payload["what_this_is_not"]))
        self.assertIn("Where the two demand models agree", Path(result["markdown_path"]).read_text())

    def test_road_names_turn_links_into_corridors(self) -> None:
        first = self._links_csv("a.csv", {1: 20_000, 2: 20_000})
        second = self._links_csv("b.csv", {1: 30_000, 2: 30_000})
        geojson = self._loaded_links("loaded.geojson", [1, 2], road_name="SR 49")

        result = compare_link_volume_runs(
            first_csv=str(first), second_csv=str(second),
            first_label="a", second_label="b",
            output_dir=str(self.root / "out"),
            loaded_links_geojson=str(geojson),
        )
        payload = json.loads(Path(result["json_path"]).read_text())
        self.assertEqual(result["corridors"], 1)
        self.assertEqual(payload["corridors"][0]["corridor"], "SR 49")
        self.assertEqual(payload["corridors"][0]["links"], 2)
        map_payload = json.loads(Path(result["geojson_path"]).read_text())
        self.assertEqual(len(map_payload["features"]), 2)
        self.assertEqual(map_payload["features"][0]["properties"]["first_volume"], 20_000)
        self.assertEqual(map_payload["features"][0]["properties"]["agreement"], "diverge")
        self.assertIn("never averaged", " ".join(map_payload["metadata"]["what_this_is_not"]))

    def test_without_road_names_it_still_compares_but_names_no_corridor(self) -> None:
        # Saying "these links could not be grouped" is better than inventing a
        # grouping, which would put every unnamed road into one phantom corridor.
        first = self._links_csv("a.csv", {1: 20_000})
        second = self._links_csv("b.csv", {1: 30_000})
        result = compare_link_volume_runs(
            first_csv=str(first), second_csv=str(second),
            first_label="a", second_label="b", output_dir=str(self.root / "out"),
        )
        self.assertEqual(result["corridors"], 0)
        self.assertEqual(result["summary"]["links_compared"], 1)

    def test_a_link_with_an_unreadable_id_is_refused(self) -> None:
        for index, invalid_id in enumerate((None, "3", 3.0)):
            with self.subTest(link_id=invalid_id):
                geojson = self._loaded_links(f"invalid-{index}.geojson", [3])
                payload = json.loads(geojson.read_text())
                payload["features"][0]["properties"]["link_id"] = invalid_id
                write_json(geojson, payload)
                with self.assertRaisesRegex(RuntimeError, "integer link_id"):
                    read_link_names(geojson)

    def test_a_missing_link_table_says_which_one(self) -> None:
        first = self._links_csv("a.csv", {1: 20_000})
        with self.assertRaises(RuntimeError) as caught:
            compare_link_volume_runs(
                first_csv=str(first), second_csv=str(self.root / "absent.csv"),
                first_label="a", second_label="b", output_dir=str(self.root / "out"),
            )
        self.assertIn("absent.csv", str(caught.exception))

    def test_json_markdown_and_geojson_carry_one_verified_provenance_record(self) -> None:
        first = self._links_csv("a.csv", {1: 20_000, 2: 500})
        second = self._links_csv("b.csv", {1: 20_100, 2: 4_000})
        geometry = self._loaded_links("loaded.geojson", [1, 2])
        evidence = verified_network_evidence([1, 2])
        first_convergence = convergence_record()
        second_convergence = convergence_record()
        result = compare_link_volume_runs(
            first_csv=str(first),
            second_csv=str(second),
            first_label="trip-based",
            second_label="activity-based",
            output_dir=str(self.root / "out"),
            loaded_links_geojson=str(geometry),
            first_convergence_record=first_convergence,
            second_convergence_record=second_convergence,
            **assignment_evidence_kwargs(evidence),
        )

        payload = json.loads(Path(result["json_path"]).read_text())
        geojson = json.loads(Path(result["geojson_path"]).read_text())
        metadata = geojson["metadata"]
        markdown = Path(result["markdown_path"]).read_text()

        self.assertEqual(payload["schema_version"], "openplan.corridor_agreement.v2")
        self.assertTrue(payload["attribution_is_supportable"])
        self.assertEqual(payload["attributable_at"], ["corridor", "link"])
        for key in (
            "methods",
            "summary",
            "network_alignment",
            "network_consistency",
            "attribution_is_supportable",
            "attributable_at",
            "assignment_convergence",
        ):
            self.assertEqual(metadata[key], payload[key])
        self.assertEqual(
            metadata["geometry_alignment"],
            {
                "source_roadway_feature_count": 2,
                "manifest_roadway_link_count": 2,
                "rendered_roadway_feature_count": 2,
                "compared_roadway_link_count": 2,
                "roadway_link_ids_digest": id_digest([1, 2]),
                "comparison_complete": True,
                "exact": True,
            },
        )
        profile_digest = first_convergence["assignment_profile_digest"]
        self.assertIn(evidence["first_network_settings_digest"], markdown)
        self.assertIn(evidence["first_network_state_digest"], markdown)
        self.assertIn(profile_digest, markdown)
        self.assertIn("First final relative gap: `0.0003`", markdown)
        self.assertIn("Second final relative gap: `0.0003`", markdown)
        self.assertIn("Links only in first: `0`", markdown)
        self.assertIn("Links only in second: `0`", markdown)
        canonical_profile = json.dumps(
            first_convergence["assignment_profile"],
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=False,
        )
        self.assertEqual(
            markdown.count(canonical_profile),
            4,
            "markdown must carry each verified profile and its network-consistency evidence",
        )

    def test_manifest_evidence_supplies_both_convergence_and_network_identity(self) -> None:
        first = self._links_csv("a.csv", {1: 20_000})
        second = self._links_csv("b.csv", {1: 20_100})
        first_manifest = self.root / "first-manifest.json"
        second_manifest = self.root / "second-manifest.json"
        evidence = verified_network_evidence([1])
        producer_assignment = {
            "convergence": convergence_record(),
            **assignment_evidence_kwargs(evidence),
        }
        producer_assignment = {
            "convergence": producer_assignment["convergence"],
            "network_settings_payload_json": evidence["first_network_settings_payload_json"],
            "network_settings_digest": evidence["first_network_settings_digest"],
            "network_state_record": evidence["first_network_state_record"],
            "network_state_digest": evidence["first_network_state_digest"],
        }
        write_json(first_manifest, {"assignment": producer_assignment})
        write_json(second_manifest, {"assignment": producer_assignment})

        result = compare_link_volume_runs(
            first_csv=str(first),
            second_csv=str(second),
            first_label="trip-based",
            second_label="activity-based",
            output_dir=str(self.root / "out"),
            first_manifest=str(first_manifest),
            second_manifest=str(second_manifest),
            loaded_links_geojson=str(self._loaded_links("loaded.geojson", [1])),
        )

        payload = json.loads(Path(result["json_path"]).read_text())
        self.assertEqual(payload["network_consistency"]["status"], "verified_same")
        self.assertEqual(payload["assignment_convergence"]["status"], "tight_enough")
        self.assertTrue(payload["attribution_is_supportable"])

    def test_partial_link_alignment_stays_visible_but_supports_no_attribution(self) -> None:
        evidence = verified_network_evidence([1, 2])
        result = compare_link_volume_runs(
            first_csv=str(self._links_csv("a.csv", {1: 20_000, 2: 500})),
            second_csv=str(self._links_csv("b.csv", {1: 20_100, 3: 4_000})),
            first_label="trip-based",
            second_label="activity-based",
            output_dir=str(self.root / "out"),
            loaded_links_geojson=str(self._loaded_links("loaded.geojson", [1, 2])),
            first_convergence_record=convergence_record(),
            second_convergence_record=convergence_record(),
            **assignment_evidence_kwargs(evidence),
        )
        payload = json.loads(Path(result["json_path"]).read_text())
        geojson = json.loads(Path(result["geojson_path"]).read_text())
        self.assertEqual(payload["network_consistency"]["status"], "network_mismatch")
        self.assertFalse(payload["attribution_is_supportable"])
        self.assertEqual(payload["attributable_at"], [])
        self.assertEqual(payload["network_alignment"]["shared_links"], 1)
        self.assertEqual(len(payload["links"]), 1)
        self.assertEqual(len(geojson["features"]), 2)
        self.assertFalse(geojson["features"][1]["properties"]["comparison_available"])
        self.assertEqual(geojson["metadata"]["attributable_at"], [])

    def test_retained_geometry_missing_a_manifest_roadway_is_refused(self) -> None:
        geometry = self._loaded_links("loaded.geojson", [1, 2])
        payload = json.loads(geometry.read_text())
        payload["features"].pop()
        payload["metadata"]["source_feature_count"] = 1
        write_json(geometry, payload)
        with self.assertRaisesRegex(RuntimeError, "does not exactly match"):
            compare_link_volume_runs(
                first_csv=str(self._links_csv("a.csv", {1: 20_000, 2: 500})),
                second_csv=str(self._links_csv("b.csv", {1: 20_100, 2: 4_000})),
                first_label="trip-based",
                second_label="activity-based",
                output_dir=str(self.root / "out"),
                loaded_links_geojson=str(geometry),
            )

    def test_retained_geometry_extra_or_duplicate_roadways_are_refused(self) -> None:
        for kind, link_id, message in (
            ("extra", 99, "does not exactly match"),
            ("duplicate", 1, "duplicate roadway link_id 1"),
        ):
            with self.subTest(kind=kind):
                geometry = self._loaded_links(f"{kind}.geojson", [1, 2])
                payload = json.loads(geometry.read_text())
                extra = json.loads(json.dumps(payload["features"][0]))
                extra["properties"]["link_id"] = link_id
                payload["features"].append(extra)
                payload["metadata"]["source_feature_count"] = 3
                write_json(geometry, payload)
                with self.assertRaisesRegex(RuntimeError, message):
                    read_link_names(geometry)

    def test_retained_geometry_must_be_renderable_wgs84_lines(self) -> None:
        geometry = self._loaded_links("bad-coordinates.geojson", [1])
        payload = json.loads(geometry.read_text())
        payload["features"][0]["geometry"]["coordinates"][0] = [999, 39]
        write_json(geometry, payload)
        with self.assertRaisesRegex(RuntimeError, "no line geometry"):
            read_link_names(geometry)

    def test_missing_or_mismatched_network_digests_never_claim_same_settings(self) -> None:
        evidence = verified_network_evidence([1])
        mismatched_settings = {
            "schema_version": "openplan.network-calibration.v1",
            "road_class_factors": {"primary": 1.1},
            "application": {
                "travel_time": "baseline_travel_time / factor",
                "capacity": "baseline_capacity * factor",
            },
            "excludes": ["trip_based_od_adjustments"],
        }
        mismatched_payload = json.dumps(mismatched_settings, sort_keys=True, separators=(",", ":"))
        for suffix, second_payload, second_digest, expected in (
            ("missing", evidence["second_network_settings_payload_json"], None, "unverified"),
            (
                "mismatch",
                mismatched_payload,
                hashlib.sha256(mismatched_payload.encode()).hexdigest(),
                "settings_mismatch",
            ),
        ):
            with self.subTest(expected=expected):
                result = compare_link_volume_runs(
                    first_csv=str(self._links_csv(f"{suffix}-a.csv", {1: 20_000})),
                    second_csv=str(self._links_csv(f"{suffix}-b.csv", {1: 20_100})),
                    first_label="trip-based",
                    second_label="activity-based",
                    output_dir=str(self.root / f"out-{suffix}"),
                    first_convergence_record=convergence_record(),
                    second_convergence_record=convergence_record(),
                    first_network_settings_payload_json=evidence["first_network_settings_payload_json"],
                    first_network_settings_digest=evidence["first_network_settings_digest"],
                    second_network_settings_payload_json=second_payload,
                    second_network_settings_digest=second_digest,
                    first_network_state_record=evidence["first_network_state_record"],
                    first_network_state_digest=evidence["first_network_state_digest"],
                    second_network_state_record=evidence["second_network_state_record"],
                    second_network_state_digest=evidence["second_network_state_digest"],
                )
                payload = json.loads(Path(result["json_path"]).read_text())
                markdown = Path(result["markdown_path"]).read_text()
                self.assertEqual(payload["network_consistency"]["status"], expected)
                self.assertFalse(payload["attribution_is_supportable"])
                self.assertEqual(payload["attributable_at"], [])
                self.assertNotIn(
                    "assigned on the same network with the same assignment settings",
                    markdown,
                )


class ProducerShapedV2Fixture(unittest.TestCase):
    def test_committed_geojson_is_the_exact_real_python_producer_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            actual = producer_corridor_agreement_v2(Path(temp_dir))
        expected_text = PRODUCER_FIXTURE.read_text()
        self.assertEqual(actual, json.loads(expected_text))
        self.assertEqual(expected_text, json.dumps(actual, indent=2) + "\n")
        self.assertEqual(
            [feature["properties"]["agreement"] for feature in actual["features"]],
            ["agree", "marginal", "diverge"],
        )
        self.assertTrue(actual["metadata"]["attribution_is_supportable"])
        self.assertEqual(
            actual["metadata"]["excluded_modeling_connectors"]["count"], 1
        )


class TheMeasuredNoiseFloor(unittest.TestCase):
    """A comparison that cannot say what the assignment alone does invites its
    reader to attribute that to the demand model."""

    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _links_csv(self, name: str, volumes: dict[int, float]) -> Path:
        path = self.root / name
        path.write_text("\n".join(["link_id,PCE_tot"] + [f"{k},{v}" for k, v in volumes.items()]) + "\n")
        return path

    def _round_trip_floor(self) -> str:
        """A real round-trip comparison: the same demand assigned twice."""
        first = self._links_csv("rt_a.csv", {1: 20_000, 2: 9_000, 3: 4_000})
        second = self._links_csv("rt_b.csv", {1: 20_050, 2: 9_400, 3: 4_010})
        result = compare_link_volume_runs(
            first_csv=str(first),
            second_csv=str(second),
            first_label="same demand, run 1",
            second_label="same demand, run 2",
            output_dir=str(self.root / "floor"),
        )
        return result["json_path"]

    def test_without_the_flag_the_report_says_it_is_unmeasured(self) -> None:
        result = compare_link_volume_runs(
            first_csv=str(self._links_csv("a.csv", {1: 20_000, 2: 9_000})),
            second_csv=str(self._links_csv("b.csv", {1: 12_000, 2: 3_000})),
            first_label="trip-based",
            second_label="activity-based",
            output_dir=str(self.root / "out"),
        )
        self.assertFalse(result["assignment_noise_floor"]["measured"])
        self.assertIn("HAS NOT BEEN MEASURED", result["assignment_noise_floor"]["note"])

    def test_the_measured_floor_reaches_the_report(self) -> None:
        floor_json = self._round_trip_floor()
        result = compare_link_volume_runs(
            first_csv=str(self._links_csv("a.csv", {1: 20_000, 2: 9_000})),
            second_csv=str(self._links_csv("b.csv", {1: 12_000, 2: 3_000})),
            first_label="trip-based",
            second_label="activity-based",
            output_dir=str(self.root / "out"),
            noise_floor_json=floor_json,
        )
        noise = result["assignment_noise_floor"]
        self.assertTrue(noise["measured"])
        self.assertIn("re-assigning one model's own demand", noise["note"])
        self.assertNotIn("HAS NOT BEEN MEASURED", noise["note"])
        # The measurement itself travels, not just the sentence about it.
        self.assertEqual(
            noise["measurement"]["measured_from"], str(Path(floor_json).resolve())
        )
        self.assertIn("diverge_share_meaningful_links", noise["measurement"])

    def test_the_markdown_carries_the_floor_a_reader_will_see(self) -> None:
        result = compare_link_volume_runs(
            first_csv=str(self._links_csv("a.csv", {1: 20_000, 2: 9_000})),
            second_csv=str(self._links_csv("b.csv", {1: 12_000, 2: 3_000})),
            first_label="trip-based",
            second_label="activity-based",
            output_dir=str(self.root / "out"),
            noise_floor_json=self._round_trip_floor(),
        )
        text = Path(result["markdown_path"]).read_text()
        self.assertIn("re-assigning one model's own demand", text)

    def test_a_file_that_is_not_an_agreement_map_is_refused(self) -> None:
        bogus = self.root / "bogus.json"
        bogus.write_text(json.dumps({"summary": {"something_else": 1}}))
        with self.assertRaises(RuntimeError) as ctx:
            compare_link_volume_runs(
                first_csv=str(self._links_csv("a.csv", {1: 20_000})),
                second_csv=str(self._links_csv("b.csv", {1: 12_000})),
                first_label="trip-based",
                second_label="activity-based",
                output_dir=str(self.root / "out"),
                noise_floor_json=str(bogus),
            )
        self.assertIn("not a corridor-agreement comparison", str(ctx.exception))

    def test_a_missing_floor_file_is_named(self) -> None:
        with self.assertRaises(RuntimeError) as ctx:
            compare_link_volume_runs(
                first_csv=str(self._links_csv("a.csv", {1: 20_000})),
                second_csv=str(self._links_csv("b.csv", {1: 12_000})),
                first_label="trip-based",
                second_label="activity-based",
                output_dir=str(self.root / "out"),
                noise_floor_json=str(self.root / "nowhere.json"),
            )
        self.assertIn("nowhere.json", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
