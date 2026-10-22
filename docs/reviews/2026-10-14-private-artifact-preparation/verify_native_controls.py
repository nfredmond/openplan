"""Challenge the useful native artifact preparation proof on retained isolated services."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def intended(code, output, diagnostic):
    return (code == 1 and output.rstrip().endswith(diagnostic)
        and re.search(r'^(AssertionError|ValueError): '+re.escape(diagnostic)+r'\s*$', output, re.MULTILINE) is not None
        and 'SyntaxError:' not in output and 'TimeoutError:' not in output)


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    module = repo/'workers/odm_worker/runtime_artifact_plan.py'
    producer = repo/'docs/reviews/2026-10-14-private-artifact-preparation/native_recovery.py'
    originals = {path: path.read_bytes() for path in [module, producer]}
    cases, controls, oracles = [], [], []

    def fault(label, target, before, after, diagnostic):
        source = originals[target].decode()
        assert source.count(before) == 1, label+' requires one source binding'
        cases.append((label, target, source.replace(before, after), diagnostic))

    fault('final-access-read-omitted', module,
        '            intake._access(request_id, deadline)\n            receipt =',
        '            receipt =', 'Saved inspection plus preparation needs nine actual access reads')
    fault('post-manifest-revocation-swallowed', module,
        '            intake._access(request_id, deadline)\n            receipt =',
        '            try:\n                intake._access(request_id, deadline)\n            except PermissionError:\n                pass\n            receipt =',
        'Actual post-read actor revocation must refuse completion')
    fault('saved-native-manifest-altered', producer,
        "        reads.clear()\n        with patch('georef.parse_geotiff'",
        "        (pack/'manifest.json').write_bytes((pack/'manifest.json').read_bytes()+b'Changed native manifest')\n        reads.clear()\n        with patch('georef.parse_geotiff'",
        'Existing source custody record differs')
    fault('native-delivery-promoted', module, "'callbackPermission': False", "'callbackPermission': True",
        'Native preparation cannot permit delivery')
    fault('native-quality-promoted', module, "'processingQualityVerification': 'unassessed'",
        "'processingQualityVerification': 'verified'", 'Native preparation cannot promote processingQualityVerification')
    fault('child-does-not-interrupt', producer, '                        os._exit(44)',
        '                        return', 'Actual preparation child must exit after frozen manifest bytes')
    fault('original-byte-hash-replaced', module, "'checksumSha256': row['sha256']", "'checksumSha256': '0'*64",
        'Native descriptor must bind actual original bytes')
    fault('native-original-scope-dropped', module, "'originalApplicationJob': copy.deepcopy(original['applicationJob'])",
        "'originalApplicationJob': {}", 'Native manifest must preserve original application scope')
    fault('native-absence-becomes-zero', module, "'sizeBytes': row['bytes']", "'sizeBytes': row['bytes'] if row['bytes'] else 0",
        'Native absence cannot become zero or a file')
    for field, value in [('productReceiptSha256', "inspected['receipt']['sourceReceiptSha256']"),
            ('inspectionReceiptSha256', "hashlib.sha256(json_bytes(inspected['receipt'])).hexdigest()"),
            ('inspectionReportSha256', "inspected['receipt']['reportSha256']")]:
        fault(field+'-not-bound', module, "'"+field+"': "+value, "'"+field+"': '0'*64",
            'Native preparation must bind '+field)

    def execute(label):
        result = subprocess.run([sys.executable, '-B', str(producer), '--repo', str(repo),
            '--out', str(out/(label+'-private'))], capture_output=True, text=True, timeout=300,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = result.stdout+result.stderr
        (out/(label+'-private.log')).write_text(output)
        for identity in ['a79d62deecea7fd1d1099b35863ca3de50ef7f44618c3c130c9f5b34b024bed3',
                '3c6255798df56cb37d42b9aa226123919409cbf5d50ce57c97c9000ecb76950f']:
            value = json.loads(subprocess.check_output(['docker', 'inspect', identity]))[0]
            assert not value['State']['Running'] and not value['State']['OOMKilled'], 'Native owned services must stop'
        return result.returncode, output

    def positive(label):
        code, output = execute(label)
        assert code == 0, label+' native cohort failed'
        result = json.loads((out/(label+'-private/result.json')).read_bytes())
        assert result['savedReplayExact'] and result['interruptedReplayExact'] and result['postManifestRevocationRefused']
        assert result['actualChildExit'] == 44 and result['firstOperationActualReads'] == 9 and result['savedOperationActualReads'] == 9
        controls.append({'case': label, 'outcome': 'survived'})

    try:
        positive('baseline')
        module.write_bytes(originals[module]+b'\n# Harmless original native artifact preparation comment.\n')
        positive('harmless-comment')
        module.write_bytes(originals[module])
        positive('restored-after-harmless')
        for label, target, changed, diagnostic in cases:
            try:
                ast.parse(changed)
                target.write_text(changed)
                code, output = execute(label)
                assert intended(code, output, diagnostic), label+' misses its intended native assertion'
                for name, c, o, d, wanted in [
                    ('exact', code, output, diagnostic, True),
                    ('success', 0, output, diagnostic, False),
                    ('wrong-exit', 2, output, diagnostic, False),
                    ('wrong-diagnostic', code, output, 'Unrelated failure', False),
                    ('syntax', code, 'SyntaxError: '+diagnostic, diagnostic, False),
                    ('timeout', code, 'TimeoutError: '+diagnostic, diagnostic, False),
                    ('no-failure', code, diagnostic, diagnostic, False),
                    ('later-error', code, output+'\nValueError: Unrelated error\n', diagnostic, False),
                ]:
                    actual = bool(intended(c, o, d))
                    assert actual == wanted, label+' native oracle '+name
                    oracles.append({'case': label, 'oracle': name, 'accepted': actual})
                controls.append({'case': label, 'outcome': 'intended_failure', 'diagnostic': diagnostic})
            finally:
                for path, payload in originals.items():
                    path.write_bytes(payload)
        positive('restored')
        (out/'controls.json').write_text(json.dumps(controls, indent=2)+'\n')
        (out/'oracles.json').write_text(json.dumps(oracles, indent=2)+'\n')
        (out/'bindings.json').write_text(json.dumps({str(path.relative_to(repo)):
            hashlib.sha256(payload).hexdigest() for path, payload in originals.items()}, indent=2)+'\n')
        group = Path('/sys/fs/cgroup')/Path('/proc/self/cgroup').read_text().split('0::', 1)[1].strip().lstrip('/')
        (out/'resources.json').write_text(json.dumps({key: (group/key).read_text().strip()
            for key in ['memory.max', 'memory.peak', 'memory.swap.max', 'memory.swap.peak', 'memory.events']}, indent=2)+'\n')
        print(json.dumps({'positive': 4, 'faults': len(cases), 'oracles': len(oracles)}), flush=True)
    finally:
        for path, payload in originals.items():
            path.write_bytes(payload)
            assert path.read_bytes() == payload


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
