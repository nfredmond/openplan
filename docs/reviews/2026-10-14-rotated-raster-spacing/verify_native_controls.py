"""Challenge each GDAL comparison and restore the parser after every fault."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def intended(code, output, label):
    diagnostic = 'AssertionError: Parser must match independent GDAL native vector lengths: '+label
    return code == 1 and output.rstrip().endswith(diagnostic) and output.count('Traceback (most recent call last):') == 1


def run(repo, out, epsg):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    source = repo/'workers/odm_worker/georef.py'
    original = source.read_bytes()
    text = original.decode()
    before = 'pixel_size = (math.hypot(a, e), math.hypot(b, f))'
    assert text.count(before) == 1
    scale_before = 'pixel_size = (abs(sx), abs(sy))'
    assert text.count(scale_before) == 1
    driver = Path(__file__).with_name('native_gdal.py')
    cases = [
        ('rotated', (3, 4, 4, -3), '(abs(a), abs(f))'),
        ('quarter-turn', (0, -2, 3, 0), '(abs(a), abs(f))'),
        ('sheared', (2, 1, 0, 3), '(math.hypot(a, e), abs(f))'),
        ('reflected', (-3, -4, -4, 3), '(a+e, b+f)'),
        ('axis-aligned', (.05, 0, 0, -.1), '(2*math.hypot(a, e), 2*math.hypot(b, f))'),
        ('asymmetric', (3, 4, 12, -5), '(math.hypot(a, b), math.hypot(e, f))'),
    ]
    controls, oracles = [], []

    def execute(label):
        target = out/label
        p = subprocess.run([sys.executable, '-B', str(driver), '--repo', str(repo),
            '--out', str(target), '--epsg', str(epsg)], capture_output=True,
            text=True, timeout=90, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = p.stdout+p.stderr
        (out/(label+'.log')).write_text(output)
        return p.returncode, output, target

    def positive(label):
        code, output, target = execute(label)
        assert code == 0, label+': '+output
        result = json.loads((target/'result.json').read_text())
        assert [x['case'] for x in result['cases']] == [x[0] for x in cases]
        assert result['scientificAcceptance'] is False
        controls.append({'case': label, 'outcome': 'survived', 'nativeCases': 6})

    try:
        positive('baseline')
        source.write_bytes(original+b'\n# Harmless native comparison comment.\n')
        positive('harmless-comment')
        source.write_bytes(original)
        positive('restored-after-harmless')
        for label, matrix, replacement in cases:
            try:
                expression = replacement+' if (a, b, e, f) == '+repr(matrix)+' else (math.hypot(a, e), math.hypot(b, f))'
                changed = text.replace(before, 'pixel_size = '+expression)
                if label == 'axis-aligned':
                    # GDAL writes this fixture as scale/tiepoint tags, not a matrix.
                    changed = text.replace(scale_before, 'pixel_size = (2*abs(sx), 2*abs(sy))')
                ast.parse(changed)
                source.write_text(changed)
                code, output, target = execute('fault-'+label)
                assert intended(code, output, label), label+' missed its intended GDAL assertion'
                assert not (target/'result.json').exists(), 'A failed comparison cannot emit acceptance'
                for name, c, o, expected_label, wanted in [
                    ('exact', code, output, label, True),
                    ('success', 0, output, label, False),
                    ('wrong-exit', 2, output, label, False),
                    ('wrong-case', code, output, 'unrelated', False),
                    ('syntax', code, 'SyntaxError', label, False),
                    ('no-assertion', code, 'OK', label, False),
                    ('additional-error', code, output+'\nUnrelated error', label, False),
                    ('multiple-errors', code, 'Traceback (most recent call last):\n'+output, label, False),
                ]:
                    actual = intended(c, o, expected_label)
                    assert actual == wanted, label+' oracle '+name
                    oracles.append({'case': label, 'oracle': name, 'accepted': actual})
                controls.append({'case': label, 'outcome': 'intended_failure'})
            finally:
                source.write_bytes(original)
        positive('restored')
        (out/'controls.json').write_text(json.dumps(controls, indent=2)+'\n')
        (out/'oracles.json').write_text(json.dumps(oracles, indent=2)+'\n')
        (out/'source-binding.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(original).hexdigest(),
            'driverSha256': hashlib.sha256(driver.read_bytes()).hexdigest(), 'epsg': epsg}, indent=2)+'\n')
        print(json.dumps({'positiveControls': 4, 'nativeFaults': 6, 'oracles': len(oracles)}), flush=True)
    finally:
        source.write_bytes(original)


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--repo', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--epsg', type=int, required=True)
    a = p.parse_args()
    run(a.repo.resolve(), a.out.resolve(), a.epsg)
