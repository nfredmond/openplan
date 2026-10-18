"""Publish small evidence after consistency and configured-value custody checks."""
from collections import Counter
import ast
import hashlib
import json
import os
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

HERE = Path(__file__).resolve().parent
IMPL = HERE.parent / '2026-10-15-final-preview-rest-uri-recovery'
ROOT = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
OUT = Path('/home/nathaniel/.local/state/openplan/rest-uri-recovery-independent-20261015')


def read(path): return json.loads(path.read_text())


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def functions(path):
    source = path.read_text()
    return {n.name: ast.get_source_segment(source, n) for n in ast.parse(source).body if isinstance(n, ast.FunctionDef)}


def main():
    os.umask(0o077)
    old = functions(ROOT / 'launcher.py')
    new = functions(ROOT / 'rest_uri_recovery_01_launcher.py')
    unchanged = sorted(k for k in old if k in new and old[k] == new[k])
    for name in ['db_check', 'sql', 'snapshot', 'source_check', 'unchanged_inputs', 'target_identity', 'target_check',
                 'observed_service', 'expected_service', 'health', 'app_check', 'clean_env', 'cgroup']:
        assert name in unchanged
    old_policy = functions(ROOT / 'policy.py')
    new_policy = functions(ROOT / 'rest_uri_recovery_01_policy.py')
    assert all(new_policy[k] == value for k, value in old_policy.items())
    original = read(IMPL / 'evidence/controls-05.json')
    actual = read(OUT / 'supplied-controls/result-private.json')
    assert original == actual
    assert read(ROOT / 'target-identity.json')['oid'] == '6118831'
    assert read(ROOT / 'source-binding-private.json')['sha256'] == '82fda3004c8dd5d3f1e26eb179e11d1da159eb79a33253a636de37ef68213547'
    preservation = read(OUT / 'preservation.json')
    assert not preservation['changed'] and not preservation['added'] and not preservation['removed']

    # The current finalizer's redirected log is still growing. Exclude all
    # finalizer logs from this frozen artifact index rather than hash a prefix.
    private_hashes = {str(path.relative_to(OUT)): sha(path) for path in OUT.rglob('*')
                      if path.is_file() and not path.name.startswith('final-checks')}
    replay = read(OUT / 'replay-summary.json')
    probes = read(OUT / 'independent-probes.json')
    resources = {}
    for path in sorted(OUT.glob('*.log')):
        lines = path.read_text().splitlines()
        resources[path.name] = [line.strip() for line in lines if any(word in line for word in
            ['Memory peak:', 'CPU time consumed:', 'Service runtime:', 'status=', 'Finished with result:'])]
    report = {'reviewedCommit': 'd71e0aa7aa1b2c3c945ee87a54ea49d6a5772378',
              'verdict': 'No bounded REST transition source blocker; F1 P2 blocks unchanged build/start recipe.',
              'bindings': read(OUT / 'bindings.json'), 'preservation': preservation,
              'configParity': read(OUT / 'config-parity.json'), 'live': read(OUT / 'live-summary.json'),
              'hostDependencyBoundary': read(OUT / 'host-dependency-boundary.json'),
              'suppliedReplayEqualsFrozenRecord': True, 'baselineCount': replay['baselineCount'],
              'baselineOutcomes': replay['baselineOutcomes'], 'allRecoveryObservations': replay['allObservations'],
              'historicalCount': replay['historicalCount'], 'historicalOutcomes': replay['historicalOutcomes'],
              'newMutationOutcomes': dict(Counter(x['outcome'] for x in replay['mutations'] if ':exact-restoration' not in x['mutation'])),
              'historicalMutationOutcomes': dict(Counter(x['outcome'] for x in replay['historicalMutations'] if ':restored' not in x['mutation'])),
              'independentProbes': probes, 'nativeReplay': read(OUT / 'native-02/native-run-02/native-summary.json'),
              'unchangedLauncherFunctions': unchanged, 'originalPolicyFunctionsUnchanged': True,
              'resources': resources, 'privateArtifactHashes': private_hashes,
              'liveHttpRun': False, 'operationalTransitionRun': False, 'buildOrWebRun': False}

    protected = []
    for path in [ROOT / 'envs-private.json', ROOT / 'rest-uri-recovery-01/envs-v1-private.json']:
        envs = read(path)
        for values in [*envs.values(), read(ROOT / 'app-env-private.json')]:
            for key, value in values.items():
                if any(part in key for part in ['KEY', 'SECRET', 'PASSWORD', 'TOKEN']) and len(value) >= 16:
                    protected.append(value.encode())
        for kind, key in [('rest', 'PGRST_DB_URI'), ('auth', 'GOTRUE_DB_DATABASE_URL'), ('storage', 'DATABASE_URL')]:
            value = envs[kind][key]
            protected.append(value.encode())
            password = unquote(urlsplit(value).password).encode()
            if len(password) >= 16: protected.append(password)
    protected = sorted(set(protected))
    def scan(data):
        if any(value in data for value in protected): raise ValueError('configured-private-value')
        if re.search(rb'postgres(?:ql)?://[^\s\x27\x22<>]*@[^\s\x27\x22<>]+', data): raise ValueError('complete-dsn')
    body = b'\n'.join(p.read_bytes() for p in HERE.rglob('*') if p.is_file()) + json.dumps(report).encode()
    scan(body)
    scan(body + b'\n# Harmless review note.\n')
    for value in protected:
        try: scan(body + b'\n' + value)
        except ValueError as error: assert str(error) == 'configured-private-value'
        else: raise AssertionError('configured-value-injection-survived')
    report['publicCustody'] = {'configuredValuesAndFullUrisInjected': len(protected), 'allRefused': True,
                              'harmlessNoteSurvived': True,
                              'blindCategory': 'Unknown secrets and short common identifiers are not classified.'}
    assert all('\u2014' not in p.read_text() for p in HERE.rglob('*.md'))
    assert not any(p.suffix == '.pyc' or p.name == '__pycache__' for p in HERE.rglob('*'))
    assert not any(p.suffix == '.pyc' or p.name == '__pycache__' for p in OUT.rglob('*'))
    target = OUT / 'final-evidence-02.json'
    with target.open('x') as stream: json.dump(report, stream, indent=2)
    # The caller copies this reviewed output into the new public review directory.
    print(json.dumps({'fullReplayMatches': True, 'preservedPacketFiles': preservation['beforeCount'],
                      'independentProbeOutcomes': dict(Counter(x['outcome'] for x in probes['rows'])),
                      'publicCustody': report['publicCustody']}))


if __name__ == '__main__': main()
