"""Verify a captured engine-root package, then inspect its original aerial draft.

No engine request, repair or retry permission runs. Original quiescence and
engine identity still require their own evidence. This command is read-only.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import math
import time

import worker_root_snapshot

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO/'workers/odm_worker'))
from draft_custody import inspect
from retained_source import absolute, json_bytes, read_json
from admission_journal import private
from retained_source import finite_limit


def verify_draft(snapshot, plan_path, expected_plan_hash, *, max_bytes, timeout=30):
    finite_limit(max_bytes)
    if type(timeout) not in (int, float) or not math.isfinite(timeout) or timeout <= 0:
        raise ValueError('Draft verification timeout must be positive and finite')
    deadline = time.monotonic()+timeout
    if not isinstance(expected_plan_hash, str) or not re.fullmatch('[0-9a-f]{64}', expected_plan_hash):
        raise ValueError('Original engine plan hash is required')
    plan_path = absolute(plan_path)
    private(plan_path.parent, True)
    plan = read_json(plan_path.parent, plan_path.name)
    if hashlib.sha256(json_bytes(plan)).hexdigest() != expected_plan_hash:
        raise ValueError('Original engine plan hash differs')
    # Complete package verification precedes any draft comparison. It cannot
    # establish that the original producer had actually stopped all writers.
    record = worker_root_snapshot.verify(snapshot, timeout=deadline-time.monotonic())
    result = inspect(Path(snapshot)/'root', plan, max_bytes=max_bytes, timeout=deadline-time.monotonic())
    final_record = worker_root_snapshot.verify(snapshot, timeout=deadline-time.monotonic())
    if json_bytes(record) != json_bytes(final_record):
        raise ValueError('Captured engine root manifest changed during inspection')
    result['rootPackageVerification'] = 'verified'
    result['rootPackageAuthenticity'] = 'unassessed'
    result['writerQuiescenceVerification'] = 'unassessed'
    result['rootPackageFormat'] = record['format']
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, required=True)
    parser.add_argument('--engine-plan', type=Path, required=True)
    parser.add_argument('--plan-sha256', required=True)
    parser.add_argument('--max-bytes', type=int, required=True)
    parser.add_argument('--timeout', type=float, default=30)
    args = parser.parse_args()
    try:
        result = verify_draft(args.snapshot, args.engine_plan, args.plan_sha256,
                              max_bytes=args.max_bytes, timeout=args.timeout)
    except (OSError, ValueError, TimeoutError) as error:
        print(str(error), file=sys.stderr);raise SystemExit(1)
    print(json.dumps(result, sort_keys=True, allow_nan=False))
