"""Challenge the useful native raster inspection proof on retained isolated services."""
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
    module = repo/'workers/odm_worker/runtime_georef.py'
    producer = repo/'docs/reviews/2026-10-14-private-raster-inspection/native_recovery.py'
    geo = repo/'workers/odm_worker/georef.py'
    originals = {path: path.read_bytes() for path in [module, producer, geo]}
    cases, controls, oracles = [], [], []

    def fault(label, target, before, after, diagnostic):
        source = originals[target].decode()
        assert source.count(before) == 1, label+' requires one source binding'
        cases.append((label, target, source.replace(before, after), diagnostic))

    fault('final-access-read-omitted', module,
        '            intake._access(request_id, deadline)\n            self._check(request_id, deadline)\n            publish(pack, \'receipt.json\'',
        '            self._check(request_id, deadline)\n            publish(pack, \'receipt.json\'',
        'First inspection needs eight actual current access reads')
    fault('post-read-revocation-swallowed', module,
        '            intake._access(request_id, deadline)\n            self._check(request_id, deadline)\n            publish(pack, \'receipt.json\'',
        '            try:\n                intake._access(request_id, deadline)\n            except PermissionError:\n                pass\n            self._check(request_id, deadline)\n            publish(pack, \'receipt.json\'',
        'Actual post-read actor revocation must refuse completion')
    fault('saved-native-report-altered', producer,
        "        reads.clear()\n        with patch('georef.parse_geotiff'",
        "        (pack/'report.json').write_bytes((pack/'report.json').read_bytes()+b'Changed native report')\n        reads.clear()\n        with patch('georef.parse_geotiff'",
        'Existing source custody record differs')
    fault('native-delivery-promoted', module, "'callbackPermission': False", "'callbackPermission': True",
        'Native inspection cannot permit delivery')
    fault('native-quality-promoted', module, "'processingQualityVerification': 'unassessed'",
        "'processingQualityVerification': 'verified'", 'Native inspection cannot promote processingQualityVerification')
    fault('child-does-not-interrupt', producer, '                    os._exit(44)',
        '                    return', 'Actual inspection child must exit after frozen report bytes')
    fault('native-scale-doubled', geo, 'pixel_size = (abs(sx), abs(sy))',
        'pixel_size = (2*abs(sx), 2*abs(sy))', 'Useful native spacing must match independent GDAL positions')
    fault('saved-native-report-reparsed', module, "                plan = read_json(pack, 'plan.json')",
        "                self._inspect(root/'private-products/objects', products['products'][0], request_id, deadline)\n                plan = read_json(pack, 'plan.json')",
        'Saved native inspection cannot parse again')

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
        assert result['savedReplayExact'] and result['interruptedReplayExact'] and result['postReadRevocationRefused']
        assert result['actualChildExit'] == 44 and result['firstOperationActualReads'] == 8 and result['savedOperationActualReads'] == 7
        controls.append({'case': label, 'outcome': 'survived'})

    try:
        positive('baseline')
        module.write_bytes(originals[module]+b'\n# Harmless original native raster inspection comment.\n')
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
