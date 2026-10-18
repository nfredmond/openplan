"""Independent copied-function checks. Never invoke operating transports."""
import ast
import copy
import difflib
import hashlib
import json
import os
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
SUBJECT = HERE.parent / '2026-10-15-portfolio-skip-preview-v5-corrections'
PACKET = Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5')
PRIVATE = Path('/home/nathaniel/.local/state/openplan/portfolio-skip-preview-v5-independent-round2-20261015-78ca8e4a')
V4 = PACKET.with_name('project-portfolio-skip-preview-20261015-v4')
rows = []


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def js(path):
    return json.loads(path.read_text())


def require(value, reason):
    if not value:
        raise AssertionError(reason)


def denied(*args, **kwargs):
    raise AssertionError('REAL-TRANSPORT-FORBIDDEN')


def function(path, name, namespace):
    node = next(n for n in ast.parse(path.read_text()).body
                if isinstance(n, ast.FunctionDef) and n.name == name)
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<independent:' + name + '>', 'exec'), namespace)
    return namespace[name]


def accepted(name, callback, hazard=False):
    callback()
    rows.append({'case': name, 'outcome': 'SURVIVED', 'hazard': hazard})


def refused(name, callback, reason):
    try:
        callback()
    except (ValueError, AssertionError) as error:
        require(str(error).startswith(reason), 'wrong-refusal:' + name)
        rows.append({'case': name, 'outcome': 'REFUSED', 'reason': str(error)})
        return
    raise AssertionError('missing-refusal:' + name)


def main():
    os.umask(0o077)
    run_id = sys.argv[1] if len(sys.argv) == 2 else '02'
    require(run_id == '02', 'run-id')
    # No module main or operating driver executes. Pure policy has no I/O at import.
    pns = {'__name__': 'independent_policy'}
    exec(compile((PACKET / 'policy.py').read_text(), '<pure-policy>', 'exec'), pns)
    from types import SimpleNamespace
    p = SimpleNamespace(**pns)
    before = {str(path.relative_to(PACKET)): {'sha256': sha(path), 'mode': path.stat().st_mode & 0o777}
              for path in PACKET.rglob('*') if path.is_file() and not path.is_symlink()}
    manifest = js(SUBJECT / 'manifest.json')
    require(sha(SUBJECT / 'manifest.json') == '5122add2ac35f95851ca8b6138be6c450ebcb50d6dba48582d5179394965ae9d', 'manifest-pin')
    require(sha(PACKET / 'operation-files.sha256') == '88763144a835d0ef84df3c746ca92708fe39206df0acb7db34f194a8864dd7db', 'list-pin')
    for name, expected in manifest['files'].items():
        require(sha(PACKET / name) == expected, 'sealed-file:' + name)
        require((PACKET / name).stat().st_mode & 0o777 == (0o700 if name == 'run_stage.sh' else 0o600), 'sealed-mode:' + name)
    checksum_rows = {Path(line.split('  ', 1)[1]).name: line.split('  ', 1)[0]
                     for line in (PACKET / 'operation-files.sha256').read_text().splitlines()}
    require(checksum_rows == manifest['files'], 'checksum-file-set')
    for name in ['helper.py', 'policy.py', 'app_binding_v1.py', 'attest_start_v1.py', 'run_stage.sh', 'observer.py', 'observer_transport.py']:
        require((SUBJECT / 'templates' / name).read_bytes() == (PACKET / name).read_bytes(), 'assembled:' + name)
        if (V4 / name).exists():
            diff = ''.join(difflib.unified_diff((V4 / name).read_text().splitlines(True),
                         (PACKET / name).read_text().splitlines(True), fromfile=str(V4 / name), tofile=name, n=0))
            require(diff == (SUBJECT / (name + '.patch')).read_text(), 'diff:' + name)
    for name in ['private-bindings.json', 'template-binding.json']:
        for target, expected in js(PACKET / name).items():
            require(sha(PACKET / target) == expected, 'binding:' + target)
    for target, expected in js(PACKET / 'binding-private.json')['files'].items():
        require(sha(PACKET / target) == expected, 'app-binding:' + target)
    require((PACKET / 'parent_recipe.sh').read_bytes() == (SUBJECT / 'parent_recipe.sh').read_bytes(), 'parent-recipe')
    pure_inputs = {'p': p, 'Path': Path, 'OUT': PACKET, 'sha': sha, 'json': json}
    for name in ['read', 'templates', 'configured_source', 'pinned_files']:
        function(PACKET / 'helper.py', name, pure_inputs)
    accepted('private-input-consumer-without-transport', pure_inputs['pinned_files'])
    for name in ['app-env-private.json', 'app-v1.env', 'dependency-binding.json', 'source-binding-private.json', 'configured-source-private.json', 'migrations.json', 'upgrade-expectations.json', 'candidate17.sql', 'protected-databases.json', 'acl-private.json']:
        require((PACKET / name).read_bytes() == (V4 / name).read_bytes(), 'inherited-input:' + name)
    for name in ['preparation.json', 'final-audit-03.json', 'delta-controls-04.json', 'parent-recipe-controls-01.json']:
        public = {'preparation.json': 'manifest.json', 'final-audit-03.json': 'final-audit.json',
                  'delta-controls-04.json': 'controls.json', 'parent-recipe-controls-01.json': 'parent-recipe-controls.json'}[name]
        require((PACKET / name).read_bytes() == (SUBJECT / public).read_bytes(), 'record:' + name)
    # Validate existing context receipts, not an independently rerun context unit.
    context_pins = {}
    transport_ns = {'Path': Path, 'json': json, 're': __import__('re'), 'OBSERVER_SHA': sha(PACKET / 'observer.py'), 'require': lambda v, r: p.exact({'ok': True}, {'ok': v}, r), 'sha': sha}
    validate = function(PACKET / 'observer_transport.py', 'validate', transport_ns)
    contexts = []
    for path in sorted((PACKET / 'context-tests').glob('actual-*.json')):
        record = js(path); value = record['oldWebObservation']; nonce = record['request']
        validate(value, nonce)
        require(record['boundaryEnvironment'] == {'hasXDG': False, 'hasDBus': False}, 'cleared-context')
        require(record['callerUserNamespace'] != value['observerUserNamespace'], 'context-namespace')
        for prefix in ['caller', 'transport']:
            receipt = PACKET / 'observer-receipts' / (prefix + '-' + nonce + '.json')
            raw = js(receipt)
            require(raw['request'] == nonce and raw['returncode'] == 0 and raw['stderr'] == '', 'raw-context-exit')
            require(json.loads(raw['stdout']) == value, 'raw-context-result')
            context_pins[str(receipt.relative_to(PACKET))] = sha(receipt)
        if path.stem.endswith('-02'):
            require(record['scriptSHA256'] == sha(SUBJECT / 'context_composition.py'), 'context-source')
            require(len(record['readonlyProtectedPaths']) == 2 and all(x['writeOpenErrno'] == 30 for x in record['readonlyProtectedPaths']), 'context-erofs')
        context_pins[str(path.relative_to(PACKET))] = sha(path)
        contexts.append(record)
    require(len(contexts) == 4 and len({x['request'] for x in contexts}) == 4, 'four-fresh-contexts')
    value = contexts[0]['oldWebObservation']; nonce = value['request']
    accepted('R1-valid-saved-observation', lambda: validate(copy.deepcopy(value), nonce))
    for key, bad, reason in [('request', '0' * 64, 'transport-result-freshness'), ('observerSHA256', '0' * 64, 'transport-observer-identity'), ('observerUserNamespace', 'user:[wrong]', 'transport-observer-identity'), ('listenerPid', '999', 'transport-old-pid')]:
        refused('R1-' + key, lambda k=key, b=bad: validate({**value, k: b}, nonce), reason)
    # Exact source-derived strings and real consumer, not a target-derived oracle.
    ns = {'p': p, 'read': lambda n: js(PACKET / n), 'OUT': PACKET,
          'TARGET': manifest['targetProposal'], 'MIG_SHA': manifest['files']['candidate17.sql']}
    upgraded = function(PACKET / 'helper.py', 'upgraded', ns)
    expected = js(PACKET / 'upgrade-expectations.json'); checks = js(PACKET / 'expected-checks.json')['constraints']
    state = {'database': ns['TARGET'], 'historyCount': 420, 'latest': '20261017000017',
             'versions': sorted(expected['versions'] + ['20261017000017']), 'body': expected['newBody'],
             'priorHistoryDigest': expected['history']['digest'], 'historySQL': [(PACKET / 'candidate17.sql').read_text()], **checks}
    accepted('R3-harmless-observation-note', lambda: upgraded({**state, 'note': 'harmless'}))
    for key in checks:
        refused('R3-' + key + '-OR-true', lambda k=key: upgraded({**state, k: "CHECK ((decision <> 'create'::text) OR true)"}), 'upgrade-checks:' + key)
    weak = {**state, 'statusConstraint': "CHECK ((decision <> 'create'::text) OR true)"}
    ready_ns = {**ns, 'upgraded': upgraded, 'upgrade_state': lambda: weak,
                'read': lambda n: {'target': ns['TARGET'], 'migrationSHA256': ns['MIG_SHA'], 'state': weak}}
    ready = function(PACKET / 'helper.py', 'upgrade_ready', ready_ns)
    refused('R3-matching-bad-first-receipt', ready, 'upgrade-checks:statusConstraint')
    # Actual copied preservation chain. Only observations and destinations change.
    fixture = PRIVATE / ('preservation-fixture-' + run_id); fixture.mkdir(mode=0o700)
    baseline = fixture / 'protected-runtime-before.json'
    baseline.write_text('{}\n'); baseline.chmod(0o600)
    descriptor_keys = ['Id', 'Name', 'Image', 'Config', 'HostConfig', 'Mounts']
    old_ids = ['old-rest', 'old-auth', 'old-storage', 'old-gateway']
    observations = {key: {'Id': key, 'Name': '/' + key, 'Image': 'fixture-image', 'Config': {},
                         'HostConfig': {}, 'Mounts': [], 'State': {'Running': True, 'Paused': False, 'Restarting': False}}
                    for key in old_ids}
    helper_hashes = {key: p.digest({k: v[k] for k in descriptor_keys}) for key, v in observations.items()}
    protected = js(PACKET / 'protected-databases.json')
    snapshots = {name: [{'database': name, 'fixture': True}] for name in protected}
    v4_inventory = js(PACKET / 'v4-full-inventory-before.json')
    writes = []; drift = {'source': False, 'database': False}; trace = []
    def read(name):
        values = {'input-bindings-private.json': {}, 'old-helper-bindings-private.json': {},
                  'storage-binding-private.json': {}, 'preservation-files.json': {},
                  'v4-full-inventory-before.json': v4_inventory,
                  'protected-runtime-before.json': {'helpers': helper_hashes, 'databases': snapshots},
                  'protected-databases.json': protected, 'target-identity.json': {'database': ns['TARGET']}}
        return copy.deepcopy(values[name])
    def snapshot(name):
        trace.append('old-db')
        if drift['database']: return [{'database': name, 'fixture': 'changed'}]
        return copy.deepcopy(snapshots[name])
    def source_check():
        trace.append('source')
        if drift['source']: raise ValueError('source-drift')
        return []
    chain = {'p': p, 'Path': Path, 'os': os, 'OUT': fixture, 'read': read, 'sha': sha,
             'OLD_IDS': {}, 'OLD_STORAGE': fixture, 'inventory': lambda root: {},
             'inspect': lambda identity: copy.deepcopy(observations[identity]), 'snapshot': snapshot,
             'packet_inventory': lambda root: v4_inventory[str(root)],
             'protected_web': lambda: {'invocation': 'old-web-still-active'},
             'pinned_files': lambda: None, 'db_check': lambda: None, 'target_check': lambda: None,
             'upgrade_ready': lambda: None, 'verify_services': lambda: {'fixture': 'NEW-helpers-healthy'},
             'source_check': source_check, 'TARGET': ns['TARGET'], '__file__': str(PACKET / 'helper.py'),
             'write': lambda name, result: writes.append((name, copy.deepcopy(result))), 'print': lambda *a: None,
             'sql': denied, 'run': denied}
    function(PACKET / 'helper.py', 'preserve', chain)
    function(PACKET / 'helper.py', 'unchanged_inputs', chain)
    post = function(PACKET / 'helper.py', 'post_journey', chain)
    # sha destinations only. Preserve still digests actual fixture observations.
    chain['sha'] = lambda path: sha(path) if Path(path).is_file() else 'fixture-digest'
    accepted('R2-composed-harmless', post)
    require(writes[-1][0] == 'post-journey-result.json', 'post-result')
    for key, reason in [('source', 'source-drift'), ('database', 'protected-database:snapshot')]:
        try:
            drift[key] = True; count = len(writes)
            refused('R2-' + key + '-drift', post, reason)
            require(len(writes) == count, 'failed-post-published')
        finally:
            drift[key] = False
    for identity in old_ids:
        try:
            observations[identity]['State']['Running'] = False
            accepted('N1-stopped-' + identity + '-publishes', post, hazard=True)
            require(writes[-1][1]['preservation']['helpers'] == helper_hashes, 'stopped-descriptor-change')
        finally:
            observations[identity]['State']['Running'] = True
    try:
        observations['old-rest']['State']['Paused'] = True
        accepted('N1-paused-old-rest-publishes', post, hazard=True)
    finally:
        observations['old-rest']['State']['Paused'] = False
    # Test a proposed detector without changing any subject code.
    original_inspect = chain['inspect']
    def require_running(identity):
        result = original_inspect(identity)
        p.exact({'running': True}, {'running': result['State']['Running']}, 'protected-active')
        return result
    try:
        chain['inspect'] = require_running
        accepted('N1-proposed-running-detector-harmless', post)
        observations['old-rest']['State']['Running'] = False
        refused('N1-proposed-running-detector-stopped', post, 'protected-active:running')
        chain['inspect'] = original_inspect
        accepted('N1-disabled-running-detector-exposes-stopped-helper', post, hazard=True)
    finally:
        observations['old-rest']['State']['Running'] = True
        chain['inspect'] = original_inspect
    # Drift that the existing descriptor guard can see still refuses.
    try:
        observations['old-rest']['Image'] = 'changed-image'
        refused('N1-existing-image-detector', post, 'protected-helper:sha256')
    finally:
        observations['old-rest']['Image'] = 'fixture-image'
    after = {str(path.relative_to(PACKET)): {'sha256': sha(path), 'mode': path.stat().st_mode & 0o777}
             for path in PACKET.rglob('*') if path.is_file() and not path.is_symlink()}
    require(after == before, 'subject-files-changed')
    require(not list((PACKET / 'execution').iterdir()) and not (PACKET / 'candidate').exists(), 'operating-state-present')
    evidence = {'subjectCommit': 'e33ad511e1e98f9ee4cfa59a32d13f23ef1debcc',
                'reviewControlSHA256': sha(Path(__file__)),
                'sealedFiles': len(manifest['files']), 'subjectPrivateFilesUnchanged': len(before),
                'manifestSHA256': sha(SUBJECT / 'manifest.json'), 'operationFilesSHA256': sha(PACKET / 'operation-files.sha256'),
                'existingContextsValidated': 4, 'rawContextReceiptsValidated': 8, 'contextPins': context_pins,
                'cases': rows, 'counts': {outcome: sum(x['outcome'] == outcome for x in rows) for outcome in ['SURVIVED', 'REFUSED']},
                'hazardSurvivorsAreFindings': True, 'operatingTransportsInvoked': 0,
                'blindCategories': ['Synthetic Docker and DB observations do not prove live preservation.',
                                    'Existing context receipts are inspected, not independently rerun.',
                                    'No SQL parse, PostgreSQL normalization, build, runtime or UI acceptance.']}
    (PRIVATE / ('subject-before-' + run_id + '.json')).write_text(json.dumps(before, indent=2) + '\n')
    (PRIVATE / ('controls-' + run_id + '.json')).write_text(json.dumps(evidence, indent=2) + '\n')
    (HERE / 'controls.json').write_text(json.dumps(evidence, indent=2) + '\n')
    print(json.dumps({'counts': evidence['counts'], 'hazardSurvivors': sum(x.get('hazard', False) for x in rows), 'operatingTransportsInvoked': 0}))


if __name__ == '__main__':
    main()
