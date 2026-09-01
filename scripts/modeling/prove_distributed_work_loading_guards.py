#!/usr/bin/env python3
"""Mutation proof for distributed work-loading custody guards."""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "workers" / "aequilibrae_worker" / "distributed_work_loading.py"
TEST = "scripts/modeling/tests/test_distributed_work_loading.py"

MUTATIONS = {
    "no-op-comment": ("This module contains no jurisdiction literals.", "This module has no jurisdiction literals."),
    "premature-output-access": ('value.get("assignment_output_bytes_read") is not False', 'False'),
    "altered-source-bytes": ('record.get("sha256") if isinstance(record, Mapping) else None', '"ignored" if isinstance(record, Mapping) else None'),
    "missing-load-point-demand": ('loaded + retained - work', 'retained - work'),
    "swallowed-unroutable-demand": ('retained_rows_total - retained', 'retained - retained'),
    "method-averaging": ('value.get("scientific_outcome") != "inconclusive" or value.get("method_aggregation") != "separate"', 'value.get("scientific_outcome") != "inconclusive" or False'),
    "county-stratum-worsening": ('or gate.get("no_county_stratum_worsened") is not True', 'or False'),
    "holdout-access": ('if value.get("holdout_accessed") is not False:\n        raise DistributedWorkLoadingRefused("Pre-output audit crossed', 'if False:\n        raise DistributedWorkLoadingRefused("Pre-output audit crossed'),
    "default-promotion": ('if value.get("defaults_changed") is not False:\n        raise DistributedWorkLoadingRefused("Pre-output audit crossed', 'if False:\n        raise DistributedWorkLoadingRefused("Pre-output audit crossed'),
}


def run(name: str) -> bool:
    original = TARGET.read_text()
    old, new = MUTATIONS[name]
    if original.count(old) != 1:
        raise SystemExit(f"Mutation target {name} matched {original.count(old)} times")
    try:
        TARGET.write_text(original.replace(old, new, 1))
        env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"}
        completed = subprocess.run(
            [sys.executable, "-B", "-m", "pytest", "-q", TEST], cwd=ROOT, env=env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        killed = completed.returncode != 0
        expected = name != "no-op-comment"
        status = "KILLED" if killed else "SURVIVED"
        print(f"{name}: {status}")
        if killed != expected:
            print(completed.stdout)
            return False
        return True
    finally:
        TARGET.write_text(original)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mutation", choices=tuple(MUTATIONS))
    args = parser.parse_args()
    names = [args.mutation] if args.mutation else list(MUTATIONS)
    return 0 if all(run(name) for name in names) else 1


if __name__ == "__main__":
    raise SystemExit(main())
