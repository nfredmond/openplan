#!/usr/bin/env python3
"""
LEHD LODES employment sourcing for the AequilibraE worker.

Downloads LODES8 Workplace Area Characteristics (WAC), total jobs (segment
S000, job type JT00) per state and aggregates to 11-digit census-tract GEOIDs
so the demand pipeline can use real jobs counts instead of a population proxy.

URL pattern (public, no API key, verified against
https://lehd.ces.census.gov/data/lodes/LODES8/ca/wac/):

    https://lehd.ces.census.gov/data/lodes/LODES8/<st>/wac/<st>_wac_S000_JT00_<year>.csv.gz

where <st> is the lowercase two-letter state abbreviation. WAC rows are keyed
by `w_geocode` (a 15-digit census-block GEOID = state[2] + county[3] +
tract[6] + block[4]); the first 11 characters are the tract GEOID. `C000` is
total jobs.

Only the standard library is imported at module load so
`aggregate_wac_jobs_by_tract` is unit-testable with `python3` alone; the network
download imports `requests` lazily.
"""
from __future__ import annotations

import csv
import gzip
import io
import os
from typing import Iterable

DEFAULT_LODES_YEAR = os.getenv("LODES_YEAR", "2022")

# FIPS state code -> lowercase LODES state abbreviation.
STATE_FIPS_TO_ABBR: dict[str, str] = {
    "01": "al", "02": "ak", "04": "az", "05": "ar", "06": "ca", "08": "co",
    "09": "ct", "10": "de", "11": "dc", "12": "fl", "13": "ga", "15": "hi",
    "16": "id", "17": "il", "18": "in", "19": "ia", "20": "ks", "21": "ky",
    "22": "la", "23": "me", "24": "md", "25": "ma", "26": "mi", "27": "mn",
    "28": "ms", "29": "mo", "30": "mt", "31": "ne", "32": "nv", "33": "nh",
    "34": "nj", "35": "nm", "36": "ny", "37": "nc", "38": "nd", "39": "oh",
    "40": "ok", "41": "or", "42": "pa", "44": "ri", "45": "sc", "46": "sd",
    "47": "tn", "48": "tx", "49": "ut", "50": "vt", "51": "va", "53": "wa",
    "54": "wv", "55": "wi", "56": "wy", "72": "pr",
}


class LodesDownloadError(RuntimeError):
    pass


def lodes_wac_url(state_abbr: str, year: str | int = DEFAULT_LODES_YEAR) -> str:
    return (
        f"https://lehd.ces.census.gov/data/lodes/LODES8/{state_abbr}/wac/"
        f"{state_abbr}_wac_S000_JT00_{year}.csv.gz"
    )


def aggregate_wac_jobs_by_tract(wac_csv_text: str) -> dict[str, int]:
    """Sum WAC total jobs (C000) to 11-digit tract GEOIDs.

    Pure/stdlib-only so it is unit-testable without network or heavy deps.
    Accepts the decoded CSV text of a WAC file (header row includes
    `w_geocode` and `C000`). Returns {tract_geoid: total_jobs}.
    """
    reader = csv.DictReader(io.StringIO(wac_csv_text))
    jobs_by_tract: dict[str, int] = {}
    for row in reader:
        geocode = (row.get("w_geocode") or "").strip()
        if len(geocode) < 11:
            continue
        tract = geocode[:11]
        raw = row.get("C000")
        try:
            c000 = int(float(raw)) if raw not in (None, "") else 0
        except (TypeError, ValueError):
            continue
        jobs_by_tract[tract] = jobs_by_tract.get(tract, 0) + c000
    return jobs_by_tract


def download_lodes_wac(
    state_abbr: str,
    year: str | int = DEFAULT_LODES_YEAR,
    cache_dir: str | None = None,
) -> str:
    """Download (or read from cache) a WAC .csv.gz and return decoded CSV text.

    The compressed file is cached to disk beside the worker so repeat runs do
    not re-download. Raises LodesDownloadError on any HTTP failure.
    """
    import requests  # lazy so the module imports with the stdlib alone

    fname = f"{state_abbr}_wac_S000_JT00_{year}.csv.gz"
    cache_path = os.path.join(cache_dir, fname) if cache_dir else None

    raw: bytes | None = None
    if cache_path and os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
        with open(cache_path, "rb") as fh:
            raw = fh.read()
    else:
        url = lodes_wac_url(state_abbr, year)
        try:
            res = requests.get(url, timeout=180)
        except Exception as exc:  # network error
            raise LodesDownloadError(f"LODES WAC request failed for {state_abbr} {year}: {exc}") from exc
        if res.status_code != 200:
            raise LodesDownloadError(
                f"LODES WAC download failed for {state_abbr} {year}: HTTP {res.status_code}"
            )
        raw = res.content
        if cache_path:
            os.makedirs(cache_dir, exist_ok=True)
            with open(cache_path, "wb") as fh:
                fh.write(raw)

    try:
        return gzip.decompress(raw).decode("utf-8")
    except (OSError, EOFError) as exc:
        # Corrupt cache — remove so the next run re-downloads.
        if cache_path and os.path.exists(cache_path):
            try:
                os.remove(cache_path)
            except OSError:
                pass
        raise LodesDownloadError(f"LODES WAC decompress failed for {state_abbr} {year}: {exc}") from exc


def fetch_lodes_jobs_by_tract(
    state_fips: Iterable[str],
    year: str | int = DEFAULT_LODES_YEAR,
    cache_dir: str | None = None,
) -> tuple[dict[str, int], list[str], list[str]]:
    """Fetch + aggregate WAC total jobs for the given state FIPS codes.

    Returns (jobs_by_tract_geoid, used_state_fips, failed_state_fips). Tract
    GEOIDs are unique per state so results merge cleanly. A state that fails to
    download is recorded in failed_state_fips and simply omitted, letting the
    caller fall back to a synthetic estimate for those tracts.
    """
    jobs: dict[str, int] = {}
    used: list[str] = []
    failed: list[str] = []
    for fips in sorted({str(f).zfill(2) for f in state_fips}):
        abbr = STATE_FIPS_TO_ABBR.get(fips)
        if not abbr:
            failed.append(fips)
            continue
        try:
            text = download_lodes_wac(abbr, year, cache_dir)
        except LodesDownloadError:
            failed.append(fips)
            continue
        part = aggregate_wac_jobs_by_tract(text)
        for tract, count in part.items():
            jobs[tract] = jobs.get(tract, 0) + count
        used.append(fips)
    return jobs, used, failed
