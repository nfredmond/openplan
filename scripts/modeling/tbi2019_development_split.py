#!/usr/bin/env python3
"""Acquire an outcome-free roster and partition whole households before analysis."""
from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import urllib.parse
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
STUDY = ROOT / "docs/modeling/activitysim-tbi2019-2026-10-23"
ROSTER_FIELDS = {"hh_id", "home_county", "survey_year"}


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()


def load_spec() -> dict:
    data = (STUDY / "SPLIT.json").read_bytes()
    expected = (STUDY / "SPLIT.sha256").read_text().split()[0]
    if sha256(data) != expected:
        raise ValueError("split specification hash mismatch")
    return json.loads(data)


def partition(rows: list[dict], spec: dict) -> list[dict]:
    """Keep each respondent household in one county-stratified partition."""
    groups = defaultdict(list)
    seen = set()
    for row in rows:
        if set(row) != ROSTER_FIELDS:
            raise ValueError("roster must contain only the three outcome-free fields")
        hid = row["hh_id"]
        if type(hid) is not int or hid <= 0:
            raise ValueError("household ID must be a positive integer")
        if hid in seen:
            raise ValueError("duplicate household ID")
        seen.add(hid)
        if row["survey_year"] != 2019:
            raise ValueError("only the 2019 wave is admitted")
        county = row["home_county"]
        if county is not None and not isinstance(county, str):
            raise ValueError("county must be a publisher label or null")
        groups[county or "__missing__"].append(hid)
    result = []
    for county, ids in sorted(groups.items()):
        ranked = sorted(ids, key=lambda hid: (sha256(f'{spec["seed"]}\n{hid}'.encode()), hid))
        held_out = set(ranked[:len(ranked) // 5])
        for hid in sorted(ids):
            result.append({"hh_id": hid, "county": county,
                           "partition": "held_out" if hid in held_out else "development",
                           "in_study_region": county in spec["study_counties"]})
    return result


def summary(assigned: list[dict]) -> dict:
    counts = Counter((r["county"], r["partition"], r["in_study_region"]) for r in assigned)
    return {"households": len(assigned), "assignment_sha256": sha256(canonical(assigned)),
            "counts": [{"county": c, "partition": p, "in_study_region": inside, "households": n}
                       for (c, p, inside), n in sorted(counts.items())],
            "outcome_rows_requested": 0, "outcome_rows_read": 0,
            "held_out_outcome_rows_requested": 0, "held_out_outcome_rows_read": 0}


def request_parameters(offset: int | None = None) -> dict:
    """This acquisition path has no parameter for outcome fields or tables."""
    params = {"f": "json", "where": "1=1", "returnGeometry": "false"}
    if offset is None:
        params["returnCountOnly"] = "true"
    else:
        params.update(outFields="hh_id,home_county,survey_year", orderByFields="hh_id ASC",
                      resultOffset=str(offset), resultRecordCount="1000")
    return params


def validate_page(payload: dict, remaining: int) -> list[dict]:
    if "error" in payload:
        raise ValueError("publisher returned an error, not a roster page")
    features = payload.get("features")
    if not isinstance(features, list) or not features or len(features) > min(1000, remaining):
        raise ValueError("roster page is empty, malformed or exceeds the frozen census")
    rows = [f["attributes"] for f in features]
    if any(set(r) != ROSTER_FIELDS for r in rows):
        raise ValueError("publisher returned fields outside the outcome-free projection")
    return rows


def acquire(run: Path) -> None:
    """Preserve exact responses locally; publish counts and hashes, not identifiers."""
    spec = load_spec()
    run.mkdir(parents=True, exist_ok=False)
    receipts = []

    def fetch(name: str, params: dict) -> dict:
        url = spec["source_household_table"] + "?" + urllib.parse.urlencode(params)
        data = urllib.request.urlopen(url, timeout=60).read()
        (run / name).write_bytes(data)
        receipts.append({"file": name, "url": url, "bytes": len(data), "sha256": sha256(data),
                         "accessed_at": datetime.now(timezone.utc).isoformat()})
        (run / "source-manifest.json").write_bytes(canonical(receipts))
        return json.loads(data)

    count = fetch("count-before.json", request_parameters()).get("count")
    if type(count) is not int or count <= 0:
        raise ValueError("publisher household census is not a positive integer")
    rows = []
    while len(rows) < count:
        page = fetch(f"roster-{len(rows):06d}.json", request_parameters(len(rows)))
        rows.extend(validate_page(page, count - len(rows)))
    if fetch("count-after.json", request_parameters()).get("count") != count:
        raise ValueError("publisher household census changed during acquisition")
    assigned = partition(rows, spec)
    (run / "assignments.private.json").write_bytes(canonical(assigned))
    result = summary(assigned)
    result.update(split_spec_sha256=sha256((STUDY / "SPLIT.json").read_bytes()),
                  source_manifest_sha256=sha256((run / "source-manifest.json").read_bytes()))
    (run / "split-summary.json").write_bytes(canonical(result))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", required=True, type=Path)
    acquire(parser.parse_args().run)
