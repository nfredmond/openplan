"""Record supplied replies, read a saved digest or explicitly fetch an original task.

The native fetch checks the original engine and retains exact reply bytes. No
mode grants processing, publication, actor authority or later freshness.
"""
import argparse
import json
from pathlib import Path
import signal
import sys
import threading
import time

from admission_journal import private
from engine_effects import RESPONSE_LIMIT
from retained_source import absolute, check_time, read_json, reader
from retained_task_observation import Observations, finite_number
from native_engine_attestation import Attestor
from original_task_http import Transport

CREDENTIAL_FORMAT = 'openplan.odm-task-read-credential.v1'
CREDENTIAL_LIMIT = 16384

SUMMARY_FIELDS = ('format', 'scope', 'originalPlanSha256', 'bodySha256', 'bodyBytes',
                  'reportedState', 'reportedStatusCode', 'reportedImageCount',
                  'imageCountVerification', 'reportedProgressPercent',
                  'engineIdentityVerification', 'originalActorAuthorization',
                  'sourceCustodyVerification', 'effectiveExecutionSettingsVerification',
                  'processingQualityVerification', 'freshnessVerification',
                  'transportPermission', 'publicationPermission')


def credential(path, reference, deadline):
    """Read one private reference-bound token without printing or executing it."""
    path = absolute(path)
    private(path.parent, True)
    with reader(path.parent, path.name) as (stream, info):
        if info.st_size > CREDENTIAL_LIMIT:
            raise ValueError('Original task credential file exceeds its byte bound')
        payload = stream.read(CREDENTIAL_LIMIT + 1)
    check_time(deadline)
    def pairs(rows):
        result = {}
        for key, value in rows:
            if key in result:
                raise ValueError('Original task credential repeats a JSON key')
            result[key] = value
        return result
    try:
        value = json.loads(payload, object_pairs_hook=pairs)
    except RecursionError:
        raise ValueError('Original task credential JSON depth differs') from None
    if not isinstance(value, dict) or set(value) != {'format', 'credentialReference', 'token'} or value['format'] != CREDENTIAL_FORMAT or value['credentialReference'] != reference:
        raise ValueError('Original task credential binding differs')
    token = value['token']
    if token is not None and (not isinstance(token, str) or not token or len(token) > 8192):
        raise ValueError('Original task credential value differs')
    return token


def execute(engine_root, records_root, *, record_file=None, response_status=None,
            digest=None, timeout=2, fetch=False, daemon_socket=None, daemon_uid=None,
            credential_file=None, owned=None):
    if type(fetch) is not bool or sum((record_file is not None, digest is not None, fetch)) != 1:
        raise ValueError('Choose exactly one task observation record, read or original fetch')
    if (record_file is not None and type(response_status) is not int) or (digest is not None and response_status is not None):
        raise ValueError('Supply an explicit integer response status for recording only')
    if fetch and (response_status is not None or daemon_socket is None or type(daemon_uid) is not int or daemon_uid < 0 or credential_file is None or not callable(owned)):
        raise ValueError('Original fetch needs explicit native daemon, credentials and ownership')
    if not fetch and any(value is not None for value in (daemon_socket, daemon_uid, credential_file, owned)):
        raise ValueError('Native fetch inputs are permitted for original fetch only')
    if not finite_number(timeout) or timeout <= 0:
        raise ValueError('Task observation command timeout must be positive and finite')
    deadline = time.monotonic() + timeout
    if fetch:
        ownership = owned()
        if type(ownership) is not bool:
            raise ValueError('Original fetch ownership must be a boolean')
        if not ownership:
            raise InterruptedError('Original fetch ownership ended')
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
    elif fetch:
        token = credential(credential_file, plan['engine']['credentialReference'], deadline)
        attestor = Attestor(plan['engine'], str(daemon_socket), daemon_uid)
        def resolve(reference):
            if reference != plan['engine']['credentialReference']:
                raise ValueError('Original fetch credential reference differs')
            return token
        transport = Transport(plan, resolve, lambda engine, end: attestor(engine, end, owned=owned))
        result = transport.retain(store, deadline=deadline, owned=owned)
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
    mode.add_argument('--fetch-original', action='store_true')
    parser.add_argument('--response-status', type=int)
    parser.add_argument('--daemon-socket', type=Path)
    parser.add_argument('--daemon-uid', type=int)
    parser.add_argument('--credential-file', type=Path)
    parser.add_argument('--timeout', type=float, default=2)
    args = parser.parse_args(argv)
    interrupted = threading.Event()
    previous = {}
    if args.fetch_original:
        for name in (signal.SIGINT, signal.SIGTERM):
            previous[name] = signal.getsignal(name)
            signal.signal(name, lambda signum, frame: interrupted.set())
    try:
        try:
            result = execute(args.engine_root, args.records_root, record_file=args.record_file,
                             response_status=args.response_status, digest=args.digest, timeout=args.timeout,
                             fetch=args.fetch_original, daemon_socket=args.daemon_socket,
                             daemon_uid=args.daemon_uid, credential_file=args.credential_file,
                             owned=(lambda: not interrupted.is_set()) if args.fetch_original else None)
        finally:
            for name, handler in previous.items():
                signal.signal(name, handler)
        if args.fetch_original and interrupted.is_set():
            raise InterruptedError('Original fetch interrupted before success reporting')
    except (OSError, ValueError):
        sys.stderr.write('Task observation refused. Check the private roots, original plan, reply bytes and command inputs.\n')
        return 2
    sys.stdout.write(json.dumps(result, sort_keys=True) + '\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
