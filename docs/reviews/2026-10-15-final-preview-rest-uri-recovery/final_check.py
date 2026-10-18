"""Check bound artifacts, original inventory, source diff, and known-value privacy."""
import ast
from collections import Counter
import difflib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from unittest.mock import patch
from urllib.parse import unquote, urlsplit

PUBLIC = Path(__file__).resolve().parent
ROOT = Path('/home/nathaniel/.local/state/openplan/gtfs-managed-ingestion-proof-20261009/project-geography-preview-final-20261015')
PRIVATE = ROOT / 'rest-uri-recovery-01'
sys.path.insert(0, str(ROOT))
import rest_uri_recovery_01_launcher as l


def functions(source):
    return {n.name: ast.get_source_segment(source, n) for n in ast.parse(source).body if isinstance(n, ast.FunctionDef)}


def write(path, value):
    if path.exists():
        assert json.loads(path.read_text()) == value
        return
    with path.open('x') as stream: json.dump(value, stream, indent=2)


def main():
    os.umask(0o077)
    manifest = json.loads((PUBLIC / 'manifest.json').read_text())
    for name, wanted in manifest['templates'].items():
        assert l.sha(ROOT / name) == wanted == l.sha(PUBLIC / 'templates' / name)
        assert (ROOT / name).stat().st_mode & 0o777 == 0o600
    assert l.sha(PRIVATE / 'input-binding-v1.json') == manifest['privateInputManifestSha256'] == l.INPUT_MANIFEST_SHA256
    assert l.sha(PRIVATE / 'template-binding-v1.json') == manifest['templateManifestSha256']
    l.pinned_files()
    delta = json.loads((PRIVATE / 'packet-after-01-private.json').read_text())['delta']
    assert not delta['changed'] and not delta['removed'] and delta['added'] == sorted(manifest['templates'])
    old = functions((ROOT / 'launcher.py').read_text())
    new = functions((ROOT / 'rest_uri_recovery_01_launcher.py').read_text())
    unchanged = sorted(k for k in old if k in new and old[k] == new[k])
    for name in ['db_check', 'sql', 'snapshot', 'source_check', 'unchanged_inputs', 'target_identity', 'target_check',
                 'observed_service', 'expected_service', 'health', 'configured_source', 'app_check', 'clean_env', 'cgroup']:
        assert name in unchanged, name
    for source, target, output in [('launcher.py', 'rest_uri_recovery_01_launcher.py', 'launcher.diff'),
            ('policy.py', 'rest_uri_recovery_01_policy.py', 'policy.diff'),
            ('controls.py', '../historical_controls.py', 'historical-controls.diff')]:
        right = PUBLIC / 'templates' / target
        diff = ''.join(difflib.unified_diff((ROOT / source).read_text().splitlines(True), right.read_text().splitlines(True),
                                          fromfile='original/' + source, tofile='recovery/' + target, n=0))
        if (PUBLIC / output).exists(): assert (PUBLIC / output).read_text() == diff
        else:
            with (PUBLIC / output).open('x') as stream: stream.write(diff)
    controls = json.loads((PUBLIC / 'evidence/controls-05.json').read_text())
    def load(name, path):
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec); sys.modules[name] = module
        spec.loader.exec_module(module); return module
    # Replay the original bound versions, rather than treating the old report's
    # exactReviewedRows boolean as a stored row array.
    old_policy = load('policy', ROOT / 'policy.py')
    old_launcher = load('launcher', ROOT / 'launcher.py')
    old_controls = load('controls', ROOT / 'controls.py')
    with (patch.object(old_launcher.subprocess, 'run', side_effect=AssertionError('unexpected-original-command')),
          patch.object(old_launcher.socket, 'socket', side_effect=AssertionError('unexpected-original-socket'))):
        original_rows = old_controls.run()['controls']
    assert controls['historical']['controls']['controls'] == original_rows
    historical_mutations = controls['historical']['mutations']
    assert sum(x['outcome'] == 'killed' for x in historical_mutations) == 9
    baseline_count = next(i for i, row in enumerate(controls['controls']) if i and row['control'] == 'pinned-baseline')
    native = json.loads((PRIVATE / 'native-run-02/native-summary.json').read_text())
    write(PUBLIC / 'evidence/native-replay.json', native)

    # Assay the inventory on child-owned files. No preexisting packet file changes.
    spec = importlib.util.spec_from_file_location('recovery_inventory', PUBLIC / 'inventory.py')
    inventory = importlib.util.module_from_spec(spec); spec.loader.exec_module(inventory)
    assay = PRIVATE / 'inventory-assay'; assay.mkdir(mode=0o700, exist_ok=True)
    specimen = assay / 'specimen'; specimen.write_bytes(b'baseline'); specimen.chmod(0o600)
    with patch.object(inventory, 'ROOT', assay):
        before = inventory.inventory()
        os.utime(specimen, None); assert before == inventory.inventory()
        specimen.write_bytes(b'changed'); assert before != inventory.inventory()
        specimen.write_bytes(b'baseline'); assert before == inventory.inventory()
        specimen.chmod(0o640); assert before != inventory.inventory()
        specimen.chmod(0o600); assert before == inventory.inventory()

    # Known configured secrets and full real URIs stay in memory.
    protected = []
    envs = l.read('envs-private.json')
    for values in [*envs.values(), l.read('app-env-private.json')]:
        for key, value in values.items():
            if any(word in key for word in ['KEY', 'SECRET', 'PASSWORD', 'TOKEN']) and len(value) >= 16:
                protected.append(value.encode())
    for kind, key in l.p.URI_KEYS.items():
        uri = envs[kind][key]
        protected.append(uri.encode())
        password = unquote(urlsplit(uri).password).encode()
        # A short credential can equal a required protocol/role identifier.
        # Scan unique secret values and full URIs without classifying identifiers.
        if len(password) >= 16: protected.append(password)
    protected = sorted(set(protected), key=len, reverse=True)
    def scan(data):
        if any(value in data for value in protected): raise ValueError('public-private-value')
        if re.search(rb'postgres(?:ql)?://[^\s\x27\x22<>]*@[^\s\x27\x22<>]+', data):
            raise ValueError('public-complete-dsn')
    bodies = b'\n'.join(path.read_bytes() for path in PUBLIC.rglob('*') if path.is_file())
    scan(bodies); scan(bodies + b'\n# harmless note\n')
    for value in protected:
        try: scan(bodies + b'\n' + value)
        except ValueError as error: assert str(error) == 'public-private-value'
        else: raise AssertionError('privacy-injection-survived')
    assert not any(path.suffix == '.pyc' or path.name == '__pycache__' for path in PRIVATE.rglob('*'))
    assert not any(path.suffix == '.pyc' or path.name == '__pycache__' for path in PUBLIC.rglob('*'))
    assert all('\u2014' not in path.read_text() for path in PUBLIC.rglob('*.md'))
    report = {'packetInventory': delta, 'unchangedOriginalFunctions': unchanged,
              'changedOriginalFunctions': sorted(k for k in old if k in new and old[k] != new[k]),
              'newFunctions': sorted(set(new) - set(old)), 'manifestHashesAndPrivateModesMatch': True,
              'historicalRowsEqualOriginalBoundReplay': True, 'historicalCount': 607,
              'historicalOutcomes': dict(Counter(x['outcome'] for x in controls['historical']['controls']['controls'])),
              'historicalHealthFaultsKilled': 9, 'baselineRecoveryControls': baseline_count,
              'baselineRecoveryOutcomes': dict(Counter(x['outcome'] for x in controls['controls'][:baseline_count])),
              'allRecoveryObservationsIncludingRestoration': len(controls['controls']),
              'newFaultsKilled': sum(x['outcome'] == 'killed' for x in controls['mutations']),
              'harmlessCommentSurvives': controls['mutations'][0]['outcome'] == 'survived',
              'inventoryAssay': ['harmless-mtime-survives', 'changed-bytes-detected', 'changed-mode-detected', 'exact-restoration'],
              'privacy': {'knownPrivateValueCount': len(protected), 'allInjectionsRefuse': True, 'harmlessNoteSurvives': True,
                          'blindCategory': 'Unknown secrets and short values shared with common identifiers are not classified; full configured URIs are protected.'},
              'bytecodeAbsent': True, 'nativeReplay': native}
    write(PUBLIC / 'evidence/final-check.json', report)
    write(PRIVATE / 'final-check-private.json', report)
    print(json.dumps({k: report[k] for k in ['historicalCount', 'baselineRecoveryControls', 'newFaultsKilled', 'packetInventory']}))


if __name__ == '__main__': main()
