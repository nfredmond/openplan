"""Record supplied private task replies or read one retained reply by digest.

This local command does not contact an engine or establish response provenance,
freshness, live authority, processing quality or permission to publish.
"""
import argparse
import json
from pathlib import Path
import sys
import time

from admission_journal import private
from engine_effects import RESPONSE_LIMIT
from retained_source import absolute, check_time, read_json, reader
from retained_task_observation import Observations, finite_number

SUMMARY_FIELDS = ('format', 'scope', 'originalPlanSha256', 'bodySha256', 'bodyBytes',
                  'reportedState', 'reportedStatusCode', 'reportedImageCount',
                  'imageCountVerification', 'reportedProgressPercent',
                  'engineIdentityVerification', 'originalActorAuthorization',
                  'sourceCustodyVerification', 'effectiveExecutionSettingsVerification',
                  'processingQualityVerification', 'freshnessVerification',
                  'transportPermission', 'publicationPermission')


def execute(engine_root, records_root, *, record_file=None, response_status=None,
            digest=None, timeout=2):
    if (record_file is None) == (digest is None):
        raise ValueError('Choose exactly one task observation record or read')
    if (record_file is not None and type(response_status) is not int) or (digest is not None and response_status is not None):
        raise ValueError('Supply an explicit integer response status for recording only')
    if not finite_number(timeout) or timeout <= 0:
        raise ValueError('Task observation command timeout must be positive and finite')
    deadline = time.monotonic() + timeout
    engine_root = absolute(engine_root)
    private(engine_root, True)
    plan = read_json(engine_root, 'plan.json')
    store = Observations(engine_root, plan, records_root=records_root, timeout=timeout)
    if record_file is not None:
        path = absolute(record_file)
        private(path.parent, True)
        with reader(path.parent, path.name) as (stream, info):
            if info.st_size > RESPONSE_LIMIT:
                raise ValueError('Supplied task reply exceeds its byte bound')
            body = stream.read(RESPONSE_LIMIT + 1)
        check_time(deadline)
        result = store.record(response_status, body, deadline=deadline)
    else:
        result = store.load(digest, deadline=deadline)
    check_time(deadline)
    return {field: result[field] for field in SUMMARY_FIELDS}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine-root', type=Path, required=True)
    parser.add_argument('--records-root', type=Path, required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--record-file', type=Path)
    mode.add_argument('--read-digest', dest='digest')
    parser.add_argument('--response-status', type=int)
    parser.add_argument('--timeout', type=float, default=2)
    args = parser.parse_args(argv)
    try:
        result = execute(args.engine_root, args.records_root, record_file=args.record_file,
                         response_status=args.response_status, digest=args.digest, timeout=args.timeout)
    except (OSError, ValueError):
        sys.stderr.write('Task observation refused. Check the private roots, original plan, reply bytes and command inputs.\n')
        return 2
    sys.stdout.write(json.dumps(result, sort_keys=True) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
