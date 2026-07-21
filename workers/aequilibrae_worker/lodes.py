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
import zlib
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


# ─── Block-group aggregations (12-digit GEOID) for finer sub-tract TAZs ─────
# A 15-digit LODES geocode = state[2] + county[3] + tract[6] + block[4]; the
# first 12 characters are the block-group GEOID. These mirror the tract (:11)
# aggregators so the pipeline can build block-group zones without new sources.


def aggregate_wac_jobs_by_block_group(wac_csv_text: str) -> dict[str, int]:
    """Sum WAC total jobs (C000) to 12-digit block-group GEOIDs. Pure/stdlib."""
    reader = csv.DictReader(io.StringIO(wac_csv_text))
    jobs_by_bg: dict[str, int] = {}
    for row in reader:
        geocode = (row.get("w_geocode") or "").strip()
        if len(geocode) < 12:
            continue
        bg = geocode[:12]
        raw = row.get("C000")
        try:
            c000 = int(float(raw)) if raw not in (None, "") else 0
        except (TypeError, ValueError):
            continue
        jobs_by_bg[bg] = jobs_by_bg.get(bg, 0) + c000
    return jobs_by_bg


def lodes_rac_url(state_abbr: str, year: str | int = DEFAULT_LODES_YEAR) -> str:
    """Residence Area Characteristics: total resident-workers (C000) by home
    block. A keyless within-tract population-distribution proxy for disaggregating
    tract population to block groups (no ACS/CENSUS key needed)."""
    return (
        f"https://lehd.ces.census.gov/data/lodes/LODES8/{state_abbr}/rac/"
        f"{state_abbr}_rac_S000_JT00_{year}.csv.gz"
    )


def aggregate_rac_by_block_group(rac_csv_text: str) -> dict[str, int]:
    """Sum RAC total resident-workers (C000) to 12-digit block-group GEOIDs
    (keyed by `h_geocode`). Pure/stdlib-only."""
    reader = csv.DictReader(io.StringIO(rac_csv_text))
    residents_by_bg: dict[str, int] = {}
    for row in reader:
        geocode = (row.get("h_geocode") or "").strip()
        if len(geocode) < 12:
            continue
        bg = geocode[:12]
        raw = row.get("C000")
        try:
            c000 = int(float(raw)) if raw not in (None, "") else 0
        except (TypeError, ValueError):
            continue
        residents_by_bg[bg] = residents_by_bg.get(bg, 0) + c000
    return residents_by_bg


def download_lodes_rac(
    state_abbr: str,
    year: str | int = DEFAULT_LODES_YEAR,
    cache_dir: str | None = None,
) -> str:
    """Download (or read from cache) a RAC .csv.gz and return decoded CSV text.
    Mirrors download_lodes_wac (same host/caching contract)."""
    import requests  # lazy so the module imports with the stdlib alone

    fname = f"{state_abbr}_rac_S000_JT00_{year}.csv.gz"
    cache_path = os.path.join(cache_dir, fname) if cache_dir else None

    raw: bytes | None = None
    if cache_path and os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
        with open(cache_path, "rb") as fh:
            raw = fh.read()
    else:
        url = lodes_rac_url(state_abbr, year)
        try:
            res = requests.get(url, timeout=180)
        except Exception as exc:  # network error
            raise LodesDownloadError(f"LODES RAC request failed for {state_abbr} {year}: {exc}") from exc
        if res.status_code != 200:
            raise LodesDownloadError(
                f"LODES RAC download failed for {state_abbr} {year}: HTTP {res.status_code}"
            )
        raw = res.content
        if cache_path:
            os.makedirs(cache_dir, exist_ok=True)
            with open(cache_path, "wb") as fh:
                fh.write(raw)

    try:
        return gzip.decompress(raw).decode("utf-8")
    except (OSError, EOFError) as exc:
        if cache_path and os.path.exists(cache_path):
            try:
                os.remove(cache_path)
            except OSError:
                pass
        raise LodesDownloadError(f"LODES RAC decompress failed for {state_abbr} {year}: {exc}") from exc


# ─── LODES OD (origin-destination home→work commute flows) ─────────────────
# Same host as WAC; part ∈ {main, aux}: `main` = jobs where home & work are in
# the same state, `aux` = jobs whose home is out of state. Rows are keyed by
# `w_geocode` (workplace block) + `h_geocode` (home block); `S000` is total
# jobs/flows. We aggregate 15-digit blocks to 11-digit tract pairs.


def lodes_od_url(state_abbr: str, part: str, year: str | int = DEFAULT_LODES_YEAR) -> str:
    return (
        f"https://lehd.ces.census.gov/data/lodes/LODES8/{state_abbr}/od/"
        f"{state_abbr}_od_{part}_JT00_{year}.csv.gz"
    )


def aggregate_od_by_tract_pair(
    rows_iter, keep_tracts: Iterable[str] | None = None, geoid_len: int = 11
) -> dict[tuple[str, str], int]:
    """Sum LODES OD `S000` to (home, work) GEOID pairs at `geoid_len` chars.

    `geoid_len=11` (default) aggregates the 15-digit block geocodes to tract
    pairs; `geoid_len=12` to block-group pairs — LODES OD is block-keyed, so
    both are exact roll-ups of the same file. Pure/stdlib — accepts any
    iterable of dict rows (e.g. a streaming `csv.DictReader`), so the full
    decompressed file is never materialized. `keep_tracts`, when given, drops
    any pair with an endpoint outside the set (its GEOIDs must be at
    `geoid_len` chars), bounding the returned dict to |study zones|². Key
    order is (home, work) so the origin axis aligns with `productions`
    (home-based).
    """
    keep = {str(t) for t in keep_tracts} if keep_tracts is not None else None
    flows: dict[tuple[str, str], int] = {}
    for row in rows_iter:
        w = (row.get("w_geocode") or "").strip()
        h = (row.get("h_geocode") or "").strip()
        if len(w) < geoid_len or len(h) < geoid_len:
            continue
        w_tract = w[:geoid_len]
        h_tract = h[:geoid_len]
        if keep is not None and (w_tract not in keep or h_tract not in keep):
            continue
        raw = row.get("S000")
        try:
            s000 = int(float(raw)) if raw not in (None, "") else 0
        except (TypeError, ValueError):
            continue
        if s000 <= 0:
            continue
        key = (h_tract, w_tract)
        flows[key] = flows.get(key, 0) + s000
    return flows


def aggregate_od_by_tract_pair_text(
    od_csv_text: str, keep_tracts: Iterable[str] | None = None, geoid_len: int = 11
) -> dict[tuple[str, str], int]:
    """Text wrapper around `aggregate_od_by_tract_pair` for unit tests."""
    return aggregate_od_by_tract_pair(csv.DictReader(io.StringIO(od_csv_text)), keep_tracts, geoid_len)


def download_lodes_od(
    state_abbr: str,
    part: str,
    year: str | int = DEFAULT_LODES_YEAR,
    cache_dir: str | None = None,
    keep_tracts: Iterable[str] | None = None,
    geoid_len: int = 11,
) -> dict[tuple[str, str], int]:
    """Download (or read from cache) a LODES OD part and aggregate to tract pairs.

    Unlike `download_lodes_wac`, this NEVER decompresses the whole file into a
    single string — an OD `main` part can be ~1 GB decompressed. The `.gz` is
    cached, then read through a streaming `gzip.open(...)` so aggregation runs
    row-by-row and only the bounded (keep_tracts²) result dict is retained.
    """
    import requests  # lazy so the module imports with the stdlib alone

    fname = f"{state_abbr}_od_{part}_JT00_{year}.csv.gz"
    cache_path = os.path.join(cache_dir, fname) if cache_dir else None

    src: str | io.BytesIO
    if cache_path and os.path.exists(cache_path) and os.path.getsize(cache_path) > 0:
        src = cache_path
    else:
        url = lodes_od_url(state_abbr, part, year)
        try:
            res = requests.get(url, timeout=180)
        except Exception as exc:
            raise LodesDownloadError(f"LODES OD request failed for {state_abbr} {part} {year}: {exc}") from exc
        if res.status_code != 200:
            raise LodesDownloadError(
                f"LODES OD download failed for {state_abbr} {part} {year}: HTTP {res.status_code}"
            )
        if cache_path:
            os.makedirs(cache_dir, exist_ok=True)
            with open(cache_path, "wb") as fh:
                fh.write(res.content)
            src = cache_path
        else:
            src = io.BytesIO(res.content)

    try:
        with gzip.open(src, "rt", encoding="utf-8") as fh:
            return aggregate_od_by_tract_pair(csv.DictReader(fh), keep_tracts, geoid_len)
    except (OSError, EOFError, zlib.error) as exc:
        # zlib.error (mid-stream deflate corruption) is NOT an OSError subclass;
        # without it a corrupt cache would never be purged and every re-run would
        # re-fail identically. Purge so the next run re-downloads.
        if cache_path and os.path.exists(cache_path):
            try:
                os.remove(cache_path)
            except OSError:
                pass
        raise LodesDownloadError(f"LODES OD decompress failed for {state_abbr} {part} {year}: {exc}") from exc


def fetch_lodes_od_by_tract_pair(
    state_fips: Iterable[str],
    keep_tracts: Iterable[str] | None = None,
    year: str | int = DEFAULT_LODES_YEAR,
    cache_dir: str | None = None,
    geoid_len: int = 11,
) -> tuple[dict[tuple[str, str], int], list[str], list[str]]:
    """Fetch + aggregate LODES OD (main + aux) for the given state FIPS codes.

    `geoid_len` picks the roll-up: 11 = tract pairs (default), 12 = block-group
    pairs (`keep_tracts` GEOIDs must match that length). Returns
    (flows_by_geoid_pair, used_state_fips, failed_state_fips). A state
    counts as `used` when its `main` part downloads; an `aux` failure is
    tolerated (aux carries out-of-state home tracts that `keep_tracts` usually
    drops anyway) and does not fail the state.
    """
    flows: dict[tuple[str, str], int] = {}
    used: list[str] = []
    failed: list[str] = []
    for fips in sorted({str(f).zfill(2) for f in state_fips}):
        abbr = STATE_FIPS_TO_ABBR.get(fips)
        if not abbr:
            failed.append(fips)
            continue
        try:
            main = download_lodes_od(abbr, "main", year, cache_dir, keep_tracts, geoid_len)
        except LodesDownloadError:
            failed.append(fips)
            continue
        for key, count in main.items():
            flows[key] = flows.get(key, 0) + count
        try:
            aux = download_lodes_od(abbr, "aux", year, cache_dir, keep_tracts, geoid_len)
            for key, count in aux.items():
                flows[key] = flows.get(key, 0) + count
        except Exception:
            # aux is best-effort — never let an aux failure (download, corrupt
            # cache, disk) discard the good main flows already merged.
            pass
        used.append(fips)
    return flows, used, failed


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
