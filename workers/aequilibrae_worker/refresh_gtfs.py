#!/usr/bin/env python3
"""Maintainer-only: refresh the bundled GTFS snapshot + PROVENANCE.json.

NOT on the worker run path. Run manually to update the frozen feed:

    python3 workers/aequilibrae_worker/refresh_gtfs.py [--url URL] [--date YYYY-MM-DD]

Downloads the feed, rewrites data/gtfs/nevada_county_gtfs.zip, and updates
data/gtfs/PROVENANCE.json (sha256, retrieved date, feed version, service span,
route/stop counts). A staler snapshot only *shrinks* transit share (the safe
direction), so refresh is low-urgency.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import zipfile

DEFAULT_URL = "https://data.trilliumtransit.com/gtfs/goldcountrystage-ca-us/goldcountrystage-ca-us.zip"
HERE = os.path.dirname(os.path.abspath(__file__))
GTFS_DIR = os.path.join(HERE, "data", "gtfs")
ZIP_PATH = os.path.join(GTFS_DIR, "nevada_county_gtfs.zip")
PROV_PATH = os.path.join(GTFS_DIR, "PROVENANCE.json")


def _count_rows(zf: zipfile.ZipFile, name: str) -> int:
    if name not in zf.namelist():
        return 0
    with zf.open(name) as fh:
        return max(sum(1 for _ in io.TextIOWrapper(fh, "utf-8-sig")) - 1, 0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--date", default=None, help="retrieved date YYYY-MM-DD (default: today)")
    args = ap.parse_args()

    import datetime
    import requests

    retrieved = args.date or datetime.date.today().isoformat()
    print(f"Downloading {args.url} ...")
    res = requests.get(args.url, timeout=120)
    res.raise_for_status()
    raw = res.content

    zf = zipfile.ZipFile(io.BytesIO(raw))
    routes = _count_rows(zf, "routes.txt")
    stops = _count_rows(zf, "stops.txt")
    feed_version = ""
    if "feed_info.txt" in zf.namelist():
        import csv
        with zf.open("feed_info.txt") as fh:
            rows = list(csv.DictReader(io.TextIOWrapper(fh, "utf-8-sig")))
            if rows:
                feed_version = rows[0].get("feed_version", "")
    zf.close()

    os.makedirs(GTFS_DIR, exist_ok=True)
    with open(ZIP_PATH, "wb") as fh:
        fh.write(raw)
    sha = hashlib.sha256(raw).hexdigest()

    prov = json.load(open(PROV_PATH)) if os.path.exists(PROV_PATH) else {}
    prov.update({
        "source_url": args.url,
        "retrieved_date": retrieved,
        "feed_version": feed_version or prov.get("feed_version", ""),
        "sha256": sha,
        "routes": routes,
        "stops": stops,
    })
    with open(PROV_PATH, "w") as fh:
        json.dump(prov, fh, indent=2)
        fh.write("\n")
    print(f"Wrote {ZIP_PATH} ({len(raw)} bytes, sha256 {sha[:16]}…), {routes} routes, {stops} stops.")
    print(f"Updated {PROV_PATH}.")


if __name__ == "__main__":
    main()
