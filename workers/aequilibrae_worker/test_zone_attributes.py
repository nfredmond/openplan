#!/usr/bin/env python3
"""A worker-backed run can be built from the LAUNCHING WORKSPACE's Census key.

The worker used to read `CENSUS_API_KEY` off its own host, so a self-serve
workspace that had added its own key in the integrations wizard still could not
build a model — and the failure told the reader to edit `openplan/.env.local`.
These checks pin the replacement: the app hands over a measure table, the worker
consumes it, and every path that yields no table yields a REASON with it.

Run: python3 workers/aequilibrae_worker/test_zone_attributes.py
"""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _stub_missing_dependency(name: str, build) -> None:
    """Install a minimal stand-in ONLY when the real package is absent.

    `data_pipeline` and `main` import the scientific stack at module scope, but
    everything exercised below is pure. In the worker venv these stubs never
    install and the real modules are used; on a bare checkout they keep this
    suite runnable instead of joining the four suites that cannot import at all.
    """
    try:
        __import__(name)
        return
    except ImportError:
        pass
    for module_name, module in build().items():
        sys.modules.setdefault(module_name, module)


def _pandas_stub():
    module = types.ModuleType("pandas")
    module.DataFrame = object
    module.concat = lambda *a, **k: None
    module.to_numeric = lambda *a, **k: None
    module.read_csv = lambda *a, **k: None
    return {"pandas": module}


def _shapely_stub():
    geometry = types.ModuleType("shapely.geometry")
    geometry.Point = object
    geometry.shape = lambda *a, **k: None
    geometry.box = lambda *a, **k: None
    wkt = types.ModuleType("shapely.wkt")
    wkt.loads = lambda *a, **k: None
    root = types.ModuleType("shapely")
    root.geometry = geometry
    root.wkt = wkt
    return {"shapely": root, "shapely.geometry": geometry, "shapely.wkt": wkt}


def _dotenv_stub():
    module = types.ModuleType("dotenv")
    module.load_dotenv = lambda *a, **k: False
    return {"dotenv": module}


def _aequilibrae_stub():
    # main.py monkey-patches OSMBuilder.__define_link_type at import time; an
    # empty class is enough to take that assignment. Every real AequilibraE use
    # is behind a function-local import in the assignment stages.
    class OSMBuilder:  # noqa: D401 - stand-in
        pass

    osm_builder = types.ModuleType("aequilibrae.project.network.osm.osm_builder")
    osm_builder.OSMBuilder = OSMBuilder
    names = [
        "aequilibrae",
        "aequilibrae.project",
        "aequilibrae.project.network",
        "aequilibrae.project.network.osm",
    ]
    modules = {name: types.ModuleType(name) for name in names}
    modules["aequilibrae.project.network.osm.osm_builder"] = osm_builder
    return modules


_stub_missing_dependency("pandas", _pandas_stub)
_stub_missing_dependency("shapely", _shapely_stub)
_stub_missing_dependency("dotenv", _dotenv_stub)
_stub_missing_dependency("aequilibrae", _aequilibrae_stub)

# main.py refuses to import without Supabase credentials. Nothing below makes a
# network call; these only get past the module-level guard.
os.environ.setdefault("SUPABASE_URL", "http://localhost:54321")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")

import data_pipeline as dp  # noqa: E402
import main  # noqa: E402

RUN_ID = "11111111-1111-4111-8111-111111111111"

SUPPLIED_PAYLOAD = {
    "version": dp.ZONE_ATTRIBUTE_PAYLOAD_VERSION,
    "source": {
        "id": "us_census_acs5",
        "label": "American Community Survey 2023 5-year (US Census Bureau)",
        "vintage": "2023",
        "key_origin": "workspace",
        "geography_index_truncated": False,
    },
    "tables": {
        "demographics": {
            "status": "supplied",
            "level": "tract",
            "measures": ["population", "households"],
            "measureProvenance": {"population": "B01003_001E", "households": "B11001_001E"},
            "rows": {"06057000100": [3200, 1250], "06057000200": [2100, 830]},
        },
        "equity": {
            "status": "supplied",
            "level": "tract",
            "measures": [
                "population",
                "lowIncomeUniverse",
                "lowIncomeCount",
                "minorityUniverse",
                "minorityCount",
                "zeroVehicleHouseholdUniverse",
                "zeroVehicleHouseholdCount",
            ],
            "measureProvenance": {},
            "rows": {"06057000100": [1000, 900, 180, 1000, 400, 400, 40]},
        },
    },
}


# ── The app's table is read, and its provenance travels with it ──────────────

def test_supplied_demographics_are_read_with_their_provenance():
    rows, note = dp.supplied_measure_table(SUPPLIED_PAYLOAD, "demographics")
    assert rows is not None, note
    assert rows["06057000100"] == {"population": 3200.0, "households": 1250.0}, rows
    assert note["status"] == "supplied"
    assert note["geographies"] == 2
    assert note["level"] == "tract"
    # Which key paid for the read is provenance the run must be able to state.
    assert note["key_origin"] == "workspace", note
    assert note["vintage"] == "2023", note


def test_manifest_names_the_source_that_actually_answered():
    _, note = dp.supplied_measure_table(SUPPLIED_PAYLOAD, "demographics")
    label = dp._demographics_source_label(note)
    assert "2023" in label, label
    assert "workspace" in label, label

    # And when nothing was supplied it must NOT claim the app's vintage.
    _, absent = dp.supplied_measure_table(None, "demographics")
    fallback = dp._demographics_source_label(absent)
    assert "workspace" not in fallback, fallback
    assert dp.ACS_5_URL in fallback, fallback


# ── Every non-supplied outcome carries a reason ──────────────────────────────

def test_absent_payload_reports_a_reason_not_just_none():
    rows, note = dp.supplied_measure_table(None, "demographics")
    assert rows is None
    assert note["status"] == "not_supplied"
    assert note["reason"], "an absent table must still explain itself"


def test_unrecognized_version_is_refused_rather_than_guessed_at():
    rows, note = dp.supplied_measure_table({**SUPPLIED_PAYLOAD, "version": "zone-attributes-v99"}, "demographics")
    assert rows is None
    assert note["status"] == "unrecognized_version"
    assert "zone-attributes-v99" in note["reason"], note


def test_app_stated_reason_is_passed_through_verbatim():
    # The app is the only place that knows WHY (no key, source down, outside
    # coverage), so its wording must survive to the run's evidence.
    reason = "No US Census API key is available. A workspace owner or admin can add a free key."
    payload = {
        "version": dp.ZONE_ATTRIBUTE_PAYLOAD_VERSION,
        "tables": {"equity": {"status": "unavailable", "reason": reason}},
    }
    rows, note = dp.supplied_measure_table(payload, "equity")
    assert rows is None
    assert note["reason"] == reason, note


def test_rows_with_the_wrong_arity_are_skipped_not_misread():
    payload = {
        "version": dp.ZONE_ATTRIBUTE_PAYLOAD_VERSION,
        "tables": {
            "demographics": {
                "status": "supplied",
                "level": "tract",
                "measures": ["population", "households"],
                "rows": {"06057000100": [3200, 1250], "06057000200": [2100]},
            }
        },
    }
    rows, note = dp.supplied_measure_table(payload, "demographics")
    # A short row would otherwise zip to a partial dict and silently zero a
    # zone's households, which rescales its trip productions.
    assert set(rows) == {"06057000100"}, rows
    assert note["rows_skipped"] == 1, note


# ── The pointer on the run row ───────────────────────────────────────────────

def test_stamp_missing_means_the_worker_falls_back_and_says_so():
    ref, note = main.parse_zone_attribute_stamp({"input_snapshot_json": {}})
    assert ref is None
    assert note["status"] == "not_stamped"
    assert "own configured data source" in note["reason"], note


def test_unavailable_stamp_surfaces_the_app_reason():
    ref, note = main.parse_zone_attribute_stamp({
        "input_snapshot_json": {
            "zoneAttributes": {
                "status": "unavailable",
                "reason": "No US Census API key is available.",
                "demographics": {"reason": "No US Census API key is available."},
            }
        }
    })
    assert ref is None
    assert "Census API key" in note["reason"], note


def test_supplied_stamp_yields_its_storage_reference():
    ref, note = main.parse_zone_attribute_stamp({
        "input_snapshot_json": {
            "zoneAttributes": {
                "status": "supplied",
                "storageRef": f"storage://run-artifacts/model-runs/{RUN_ID}/zone-attributes.json",
            }
        }
    })
    assert note["status"] == "supplied"
    assert ref.endswith("zone-attributes.json"), ref


def test_reference_outside_this_runs_prefix_is_refused():
    # input_snapshot_json is member-writable and the worker reads Storage with
    # the service-role key, so an unchecked reference would be a read oracle.
    other = "22222222-2222-4222-8222-222222222222"
    assert main.zone_attribute_object_path(
        RUN_ID, f"storage://run-artifacts/model-runs/{other}/zone-attributes.json"
    ) is None
    assert main.zone_attribute_object_path(
        RUN_ID, f"storage://run-artifacts/model-runs/{RUN_ID}/../{other}/x.json"
    ) is None
    assert main.zone_attribute_object_path(
        RUN_ID, "storage://engagement-photos/anything.json"
    ) is None
    assert main.zone_attribute_object_path(
        RUN_ID, f"storage://run-artifacts/model-runs/{RUN_ID}/zone-attributes.json"
    ) == f"model-runs/{RUN_ID}/zone-attributes.json"


def test_the_reason_survives_from_the_setup_stage_to_the_artifact_stage():
    # The setup stage learns why there is no table; the artifact stage, which
    # runs later and separately, is the one that must state it in the run's
    # evidence. Carrying the reason in the payload's own shape means the equity
    # overlay reports the REAL cause instead of a generic "nothing supplied".
    reason = "No US Census API key is available. Add one under Settings -> Integrations."
    carried = main.unavailable_zone_attributes(reason)

    for table in ("demographics", "equity"):
        rows, note = dp.supplied_measure_table(carried, table)
        assert rows is None
        assert note["reason"] == reason, (table, note)


# ── Which source the equity overlay screens with ─────────────────────────────

def _equity_rows():
    rows, note = dp.supplied_measure_table(SUPPLIED_PAYLOAD, "equity")
    return rows, note


def test_the_apps_table_is_preferred_and_names_itself():
    rows, note = _equity_rows()
    acs, source, reason, refusal = main.resolve_equity_measure_source(
        supplied_equity=rows,
        supplied_note=note,
        zone_level_key="tract",
        zone_level_label="tract",
        worker_census_key="worker-key",
        worker_fetch=lambda: (_ for _ in ()).throw(AssertionError("must not fetch")),
    )
    assert set(acs) == {"06057000100"}, acs
    assert "American Community Survey" in source, source
    assert reason is None and refusal is None, (reason, refusal)


def test_a_table_at_the_wrong_geography_is_refused_but_the_overlay_still_runs():
    # A block-group launch whose refinement legitimately falls back to tracts
    # (a supported fallback in data_pipeline) used to lose its equity overlay
    # entirely — the mismatch nulled the supplied table AND skipped the worker's
    # own fetch, on a worker that had a key and could have answered at the
    # geography the zones really are.
    rows, note = _equity_rows()  # note["level"] == "tract"
    fetched = {"060570001001": {"B01003_001E": 1000.0}}
    acs, source, reason, refusal = main.resolve_equity_measure_source(
        supplied_equity=rows,
        supplied_note=note,
        zone_level_key="block_group",
        zone_level_label="block group",
        worker_census_key="worker-key",
        worker_fetch=lambda: fetched,
    )
    assert acs == fetched, acs
    assert source == "worker-side ACS fetch (block group)", source
    # No absence is reported, because none happened.
    assert reason is None, reason
    # But WHICH source answered, and why the app's was not used, is provenance
    # the run must still be able to state.
    assert refusal and "mis-scale" in refusal, refusal


def test_a_refused_table_and_no_worker_key_states_both_halves():
    rows, note = _equity_rows()
    _, _, reason, refusal = main.resolve_equity_measure_source(
        supplied_equity=rows,
        supplied_note=note,
        zone_level_key="block_group",
        zone_level_label="block group",
        worker_census_key="",
        worker_fetch=lambda: (_ for _ in ()).throw(AssertionError("must not fetch")),
    )
    # Naming only the missing worker key would send the reader to fix the wrong
    # thing; naming only the geography refusal would imply the worker could
    # have covered for it.
    assert "block_group" in reason, reason
    assert "No Census API key is set on the worker" in reason, reason
    assert refusal, refusal


def test_the_recovery_named_is_the_one_that_actually_works():
    # The relaunch route rebuilds the run's zone-attribute payload before
    # re-queueing, so naming relaunch here is a true statement. It was not
    # before, and this suite is what stops the wording drifting back ahead of
    # the capability.
    _, note = dp.supplied_measure_table(None, "equity")
    _, _, reason, _ = main.resolve_equity_measure_source(
        supplied_equity=None,
        supplied_note=note,
        zone_level_key="tract",
        zone_level_label="tract",
        worker_census_key="",
        worker_fetch=lambda: {},
    )
    assert "Settings -> Integrations" in reason, reason
    assert "relaunch this run" in reason, reason
    assert ".env.local" not in reason, reason


def test_an_empty_worker_fetch_is_not_dressed_up_as_an_answer():
    _, note = dp.supplied_measure_table(None, "equity")
    acs, source, reason, _ = main.resolve_equity_measure_source(
        supplied_equity=None,
        supplied_note=note,
        zone_level_key="tract",
        zone_level_label="tract",
        worker_census_key="worker-key",
        worker_fetch=lambda: {},
    )
    # The caller decides the wording for "the fetch ran and covered nothing";
    # what this must not do is return rows it does not have.
    assert acs == {}, acs
    assert source == "worker-side ACS fetch (tract)", source
    assert reason is None, reason


# ── Partial demographic coverage reaches a surface a planner reads ───────────

def test_zones_dropped_for_missing_demographics_are_stated_not_buried():
    # An inner merge drops every zone with no supplied row, which changes
    # population_total and therefore vmt_per_capita — the number a CEQA
    # determination is read off. Counting it in the manifest alone would let a
    # per-capita figure over a shrunken denominator render as a complete model.
    caveat = main.demographic_coverage_caveat(
        {"candidate_tracts": 120, "matched_tracts": 97, "unmatched_tracts": 23}
    )
    assert "23 of 120" in caveat, caveat
    assert "VMT per capita" in caveat, caveat


def test_a_truncated_geography_index_is_a_stated_maybe_not_a_silent_one():
    caveat = main.demographic_coverage_caveat(
        {"candidate_tracts": 400, "unmatched_tracts": 0, "geography_index_truncated": True}
    )
    assert caveat and "truncated" in caveat, caveat


def test_complete_coverage_adds_no_caveat_of_its_own():
    assert main.demographic_coverage_caveat(
        {"candidate_tracts": 42, "matched_tracts": 42, "unmatched_tracts": 0}
    ) is None
    # A worker-fetched run's note carries no coverage counts at all; absent is
    # not the same claim as zero, and neither may invent a caveat.
    assert main.demographic_coverage_caveat(None) is None


# ── The neutral measure vocabulary reaches the one share definition ──────────

def test_neutral_measures_reproduce_the_equity_module_shares():
    import equity

    rows, _ = dp.supplied_measure_table(SUPPLIED_PAYLOAD, "equity")
    acs_row = main.acs_row_from_equity_measures(rows["06057000100"])
    zone = equity.build_equity_zone("06057000100", 1000.0, acs_row)
    # 180/900 low income, 400/1000 minority, 40/400 zero-vehicle.
    assert abs(zone["low_income_share"] - 0.20) < 1e-9, zone
    assert abs(zone["minority_share"] - 0.40) < 1e-9, zone
    assert abs(zone["zero_vehicle_share"] - 0.10) < 1e-9, zone


def test_minority_count_exceeding_its_universe_cannot_invert_the_share():
    # ACS margins can push a component past its universe; a negative reference
    # group would make the share exceed 1 and mis-flag every zone.
    acs_row = main.acs_row_from_equity_measures(
        {"population": 100.0, "minorityUniverse": 100.0, "minorityCount": 140.0}
    )
    assert acs_row["B03002_003E"] == 0.0, acs_row


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    try:
        for t in tests:
            t()
            print(f"ok  {t.__name__}")
        print(f"\n{len(tests)} zone-attribute handoff checks passed.")
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
