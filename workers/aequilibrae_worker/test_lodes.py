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
