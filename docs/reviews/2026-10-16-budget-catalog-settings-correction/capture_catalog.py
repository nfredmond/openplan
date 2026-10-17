#!/usr/bin/python3
"""Prepared NEW schema2 catalog capture. No grant is included."""
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time

ROOT = Path('/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/capture-v2')
SUBJECT = Path('/home/nathaniel/.t3/worktrees/openplan/t3-e4106cfb/docs/reviews/2026-10-16-budget-catalog-settings-correction')
RUNTIME_ROOT = Path('/home/nathaniel/.local/state/openplan/budget-catalog-settings-correction-20261016/runtime-v2')
REPO = Path('/home/nathaniel/.t3/worktrees/openplan/t3-fab3cf74')
SEAL = 'b9c0e7c418df4a295f44f1374a539e6e33dbd242a210c2840dd07831a6b1a35c'
RUNTIME = {
    "controller.py": "328b1f84a12925345f95aa6d52996f0b1d980bd7ac84de6571f44d8eb6e6788e",
    "journal.py": "18ea275bf28c931979af1ef774ab5e40ec8aca2277308f77695a6c9883905eb6",
    "policy.py": "87918149e6a20accac0fc5d7be2decbe7a75929c5ca7deb74a1f2caf4b4d2d4c",
    "sql.py": "f9f612ed9f411f4347566b0d0d0d442049e89be0af81882f5014c1e04352df90"
}
UNIT = 'openplan-budget-catalog-settings-v2-20261016'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def reuse():
    for name, expected in RUNTIME.items():
        for path in (SUBJECT/'runtime'/name, RUNTIME_ROOT/name):
            if path.is_symlink() or sha(path) != expected:
                raise ValueError('schema2-runtime-drift')
    if sha(SUBJECT/'source-pins.json') != SEAL:
        raise ValueError('schema2-package-drift')
    pins = json.loads((SUBJECT/'source-pins.json').read_bytes())
    for relative, pin in pins['source'].items():
        path = REPO/relative
        if path.is_symlink() or sha(path) != pin['sha256'] or path.stat().st_size != pin['bytes']:
            raise ValueError('exact-422-source-drift')
    for name, pin in pins['bindings'].items():
        if sha(SUBJECT/name) != pin['sha256'] or sha(RUNTIME_ROOT/name) != pin['sha256']:
            raise ValueError('schema2-private-binding-drift')
    sys.path.insert(0, str(RUNTIME_ROOT))
    import journal as j
    import policy as p
    import sql as s
    for name in RUNTIME:
        j.private(RUNTIME_ROOT/name)
    return j, p, s


def query(s):
    return (s.CATALOG_BEGIN+"SELECT jsonb_build_object('catalogIdentity',("+s.IDENTITY+
            "),'originalScope',("+s.SCOPE+"),'readOnly',"
            "current_setting('transaction_read_only'));\nROLLBACK;\n").encode()


def validate_envelope(p, row):
    p.same({'catalogIdentity', 'originalScope', 'readOnly'}, set(row), 'capture-envelope-fields')
    p.same('on', row['readOnly'], 'actual-read-only')
    p.native(row['catalogIdentity'], {}, 'postgres')
    p.scope(row['originalScope'])


def ready(j, p):
    j.private(ROOT, True)
    request = j.read(ROOT/'catalog-capture-request.json')
    for name, pin in request['inputs'].items():
        path = ROOT/name
        j.private(path)
        p.same(pin['sha256'], sha(path), 'capture-input-sha:'+name)
        p.same(pin['bytes'], path.stat().st_size, 'capture-input-size:'+name)
    p.same(SEAL, request.get('packageSHA256'), 'capture-request-package')
    grant = j.read(ROOT/'capture-grant.json')
    p.same(sha(ROOT/'catalog-capture-request.json'), grant.get('requestSHA256'), 'exact-parent-grant')
    for key, value in {'schema':2, 'stage':'catalog-capture-v2', 'nativeOperationGranted':True,
                       'exclusive':True, 'unitName':UNIT, 'uid':os.getuid(),
                       'packageSHA256':SEAL}.items():
        p.same(value, grant.get(key), 'parent-grant-'+key)
    p.positive(grant.get('uid'), 'parent-local-uid')
    now = int(time.time())
    p.require(type(grant.get('notBefore')) is int and type(grant.get('notAfter')) is int
              and grant['notBefore'] <= now < grant['notAfter']
              and 0 < grant['notAfter']-grant['notBefore'] <= 600, 'parent-window')
    for filename, key in (('capture-review.md','reviewSHA256'), ('capture-window.json','windowSHA256')):
        j.private(ROOT/filename)
        p.require((ROOT/filename).stat().st_size > 0, 'nonempty-root-record')
        p.same(sha(ROOT/filename), grant.get(key), 'actual-parent-record-'+key)
    window = j.read(ROOT/'capture-window.json')
    for key in ('schema','stage','exclusive','nativeOperationGranted','notBefore','notAfter',
                'requestSHA256','packageSHA256','unitName','uid'):
        p.same(grant[key], window.get(key), 'capture-window-'+key)
    return request, grant


def main():
    os.umask(0o077)
    if sys.argv[1:] != ['--capture-once']:
        raise ValueError('fixed-entry-only')
    j, p, s = reuse()
    request, grant = ready(j, p)
    data = query(s)
    p.same(data, (ROOT/'catalog-capture.sql').read_bytes(), 'fixed-capture-query')
    entry = j.self_identity()
    p.same(grant['uid'], entry['uid'], 'capture-entry-granted-uid')
    p.resource(entry['resources'])
    attempt = j.begin(ROOT, 'capture-attempt', {
        'status':'intent', 'schema':2, 'requestSHA256':sha(ROOT/'catalog-capture-request.json'),
        'grantSHA256':sha(ROOT/'capture-grant.json'), 'invocation':entry['invocation'],
        'unitName':UNIT, 'uid':entry['uid'], 'controllerPID':entry['pid'], 'entry':entry,
        'resources':entry['resources'], 'inputSHA256':p.digest(data), 'retry':'FORBIDDEN'})
    transport = j.Transport(attempt)
    try:
        actual = j.manager_ack(transport, attempt, UNIT, grant['uid'], 90)
        p.same(entry, actual, 'capture-manager-entry')
        template = ('{"Id":{{json .Id}},"Image":{{json .Image}},"Name":{{json .Name}},'
                    '"Project":{{json (index .Config.Labels "com.supabase.cli.project")}},'
                    '"NetworkID":{{json (index .NetworkSettings.Networks "'+p.NETWORK+'" ).NetworkID}},'
                    '"Running":{{json .State.Running}},"Paused":{{json .State.Paused}},'
                    '"Restarting":{{json .State.Restarting}}}')
        inspect_argv = ['/usr/bin/docker','inspect','--format',template,p.CONTAINER]
        container = json.loads(transport.run(inspect_argv, timeout=10, limit=65536))
        p.container(container)
        j.credential_absence(transport)
        raw = transport.run(p.argv('sql','postgres'), data, timeout=30, limit=1048576)
        rows = [json.loads(line) for line in raw.splitlines() if line.strip()]
        p.same(1, len(rows), 'capture-single-envelope')
        row = rows[0]
        validate_envelope(p, row)
        after = json.loads(transport.run(inspect_argv, timeout=10, limit=65536))
        p.container(after)
        p.same(container, after, 'container-before-after')
        j.verify_manager_ack(attempt, UNIT, entry, 90)
        j.record(attempt/'catalog.json', row['catalogIdentity'])
        j.record(attempt/'original-scope.json', row['originalScope'])
        j.record(attempt/'complete.json', {
            'status':'capture-complete', 'schema':2, 'scopeSchema':p.SCOPE_SCHEMA,
            'invocation':entry['invocation'], 'unitName':UNIT, 'entry':entry,
            'requestSHA256':sha(ROOT/'catalog-capture-request.json'),
            'grantSHA256':sha(ROOT/'capture-grant.json'), 'inputSHA256':p.digest(data),
            'managerAckSHA256':sha(attempt/'manager-ack.json'),
            'catalogSHA256':sha(attempt/'catalog.json'), 'scopeSHA256':sha(attempt/'original-scope.json'),
            'claim':'Actual schema2 catalog capture only; no target absence or OBSERVE admission.'})
    except BaseException as error:
        j.record(attempt/'failure.json', {'status':'FENCED_NO_REPLAY',
                 'errorType':type(error).__name__, 'backend':'UNKNOWN'})
        raise


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        print('REFUSED: preserve new attempt and outer custody; no replay', file=sys.stderr)
        raise SystemExit(1)
