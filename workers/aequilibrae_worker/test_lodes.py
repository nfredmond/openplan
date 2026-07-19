#!/usr/bin/env python3
"""
Dependency-free unit checks for the LODES aggregation logic.

Runs with the standard library alone (no numpy/pandas/requests/aequilibrae):

    python3 workers/aequilibrae_worker/test_lodes.py

Exits non-zero on failure. The network download path is exercised with a stub
so no HTTP is performed.
"""
import sys

import lodes


def test_aggregate_wac_jobs_by_tract():
    csv_text = (
        "w_geocode,C000,CA01,CNS07\n"
        "060570101001000,120,10,5\n"   # tract 06057010100
        "060570101002001,80,8,3\n"     # tract 06057010100
        "060570102001000,200,20,9\n"   # tract 06057010200
        "0605,15,1,0\n"                # too short -> skipped
        "060570102001999,,0,0\n"       # blank C000 -> counts as 0
    )
    agg = lodes.aggregate_wac_jobs_by_tract(csv_text)
    assert agg == {"06057010100": 200, "06057010200": 200}, agg


def test_lodes_wac_url():
    url = lodes.lodes_wac_url("ca", 2022)
    assert url == (
        "https://lehd.ces.census.gov/data/lodes/LODES8/ca/wac/"
        "ca_wac_S000_JT00_2022.csv.gz"
    ), url


def test_state_fips_mapping():
    assert lodes.STATE_FIPS_TO_ABBR["06"] == "ca"
    assert lodes.STATE_FIPS_TO_ABBR["32"] == "nv"


def test_fetch_merges_states_with_stubbed_download():
    original = lodes.download_lodes_wac
    try:
        payloads = {
            "ca": "w_geocode,C000\n060570101001000,50\n",
            "nv": "w_geocode,C000\n320310001001000,70\n",
        }
        lodes.download_lodes_wac = lambda abbr, year, cache_dir: payloads[abbr]
        jobs, used, failed = lodes.fetch_lodes_jobs_by_tract(["06", "32"], 2022, None)
        assert jobs == {"06057010100": 50, "32031000100": 70}, jobs
        assert used == ["06", "32"], used
        assert failed == [], failed
    finally:
        lodes.download_lodes_wac = original


def test_fetch_records_unknown_state_as_failed():
    jobs, used, failed = lodes.fetch_lodes_jobs_by_tract(["99"], 2022, None)
    assert jobs == {}
    assert used == []
    assert failed == ["99"], failed


# ─── LODES OD (origin-destination) checks ──────────────────────────────────


def test_lodes_od_url():
    assert lodes.lodes_od_url("ca", "main", 2022) == (
        "https://lehd.ces.census.gov/data/lodes/LODES8/ca/od/ca_od_main_JT00_2022.csv.gz"
    )
    assert lodes.lodes_od_url("nv", "aux", 2022).endswith("nv_od_aux_JT00_2022.csv.gz")


def test_aggregate_od_by_tract_pair():
    csv_text = (
        "w_geocode,h_geocode,S000,SA01\n"
        "060570101001000,060570102001000,10,5\n"   # home 102 -> work 101
        "060570101002001,060570102001999,4,2\n"    # same tract pair, sums
        "060570103001000,060570101001000,7,3\n"    # home 101 -> work 103
        "0605,060570101001000,9,1\n"               # short work geocode -> skip
        "060570101001000,060570102001000,,0\n"     # blank S000 -> 0, skipped
        "060570101001000,060570104001000,0,0\n"    # zero flow -> skipped
    )
    agg = lodes.aggregate_od_by_tract_pair_text(csv_text)
    # key is (home_tract, work_tract)
    assert agg == {
        ("06057010200", "06057010100"): 14,
        ("06057010100", "06057010300"): 7,
    }, agg


def test_aggregate_od_keep_tracts_bounds_result():
    csv_text = (
        "w_geocode,h_geocode,S000\n"
        "060570101001000,060570102001000,10\n"    # both in study area
        "060570101001000,320310001001000,20\n"    # home out of area -> dropped
        "329990001001000,060570102001000,30\n"    # work out of area -> dropped
    )
    keep = {"06057010100", "06057010200"}
    agg = lodes.aggregate_od_by_tract_pair_text(csv_text, keep_tracts=keep)
    assert agg == {("06057010200", "06057010100"): 10}, agg


def test_fetch_od_merges_main_and_aux():
    original = lodes.download_lodes_od
    try:
        data = {
            ("ca", "main"): {("06057010200", "06057010100"): 10},
            ("ca", "aux"): {("32031000100", "06057010100"): 3},  # out-of-state home
        }
        lodes.download_lodes_od = lambda abbr, part, year, cache_dir, keep_tracts: data[(abbr, part)]
        flows, used, failed = lodes.fetch_lodes_od_by_tract_pair(["06"], None, 2022, None)
        assert flows == {
            ("06057010200", "06057010100"): 10,
            ("32031000100", "06057010100"): 3,
        }, flows
        assert used == ["06"] and failed == []
    finally:
        lodes.download_lodes_od = original


def test_fetch_od_aux_failure_tolerated():
    original = lodes.download_lodes_od
    try:
        def stub(abbr, part, year, cache_dir, keep_tracts):
            if part == "aux":
                raise lodes.LodesDownloadError("aux 404")
            return {("06057010200", "06057010100"): 5}
        lodes.download_lodes_od = stub
        flows, used, failed = lodes.fetch_lodes_od_by_tract_pair(["06"], None, 2022, None)
        assert flows == {("06057010200", "06057010100"): 5}
        assert used == ["06"] and failed == []  # aux failure does NOT fail the state
    finally:
        lodes.download_lodes_od = original


def test_fetch_od_aux_generic_error_tolerated():
    original = lodes.download_lodes_od
    try:
        def stub(abbr, part, year, cache_dir, keep_tracts):
            if part == "aux":
                raise ValueError("unexpected non-LodesDownloadError")
            return {("06057010200", "06057010100"): 8}
        lodes.download_lodes_od = stub
        flows, used, failed = lodes.fetch_lodes_od_by_tract_pair(["06"], None, 2022, None)
        assert flows == {("06057010200", "06057010100"): 8}  # main kept
        assert used == ["06"] and failed == []
    finally:
        lodes.download_lodes_od = original


def test_download_od_corrupt_cache_is_purged():
    import os as _os
    import tempfile
    d = tempfile.mkdtemp()
    path = _os.path.join(d, "ca_od_main_JT00_2022.csv.gz")
    with open(path, "wb") as fh:
        fh.write(b"this is not a gzip file")  # cache hit -> gzip.open raises
    raised = False
    try:
        lodes.download_lodes_od("ca", "main", 2022, d, None)
    except lodes.LodesDownloadError:
        raised = True
    assert raised, "corrupt cache should raise LodesDownloadError"
    assert not _os.path.exists(path), "corrupt cache should be purged for re-download"


def test_fetch_od_main_failure_marks_state_failed():
    original = lodes.download_lodes_od
    try:
        def stub(abbr, part, year, cache_dir, keep_tracts):
            raise lodes.LodesDownloadError("main 404")
        lodes.download_lodes_od = stub
        flows, used, failed = lodes.fetch_lodes_od_by_tract_pair(["06", "99"], None, 2022, None)
        assert flows == {}
        assert used == [] and failed == ["06", "99"]
    finally:
        lodes.download_lodes_od = original


def main():
    tests = [obj for name, obj in sorted(globals().items()) if name.startswith("test_")]
    for test in tests:
        test()
        print(f"ok  {test.__name__}")
    print(f"\n{len(tests)} LODES stdlib checks passed.")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
