"""Exercise native cell spacing faults and restore the parser in finally."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def intended(code, output, test, diagnostic):
    names = re.findall(r'^FAIL: ([^ ]+) \(test_rotated_georef.Checks\.', output, re.MULTILINE)
    return (code == 1 and names and set(names) == {test} and diagnostic in output
        and not re.search(r'^ERROR:', output, re.MULTILINE)
        and re.search(r'FAILED \(failures=\d+\)\s*$', output) is not None)


def run(repo, out):
    os.umask(0o077)
    out.mkdir(mode=0o700)
    source = repo/'workers/odm_worker/georef.py'
    original = source.read_bytes()
    text = original.decode()
    before = 'pixel_size = (math.hypot(a, e), math.hypot(b, f))'
    assert text.count(before) == 1
    cases = [
        ('diagonal-only', '(abs(a), abs(f))', 'test_rotated_vectors_have_their_full_native_lengths', 'Rotated cells require both model-axis components'),
        ('quarter-turn-zero', '(abs(a), abs(f))', 'test_quarter_turn_cannot_report_zero_spacing', 'Quarter-turn cells retain positive declared spacing'),
        ('row-shear-ignored', '(math.hypot(a, e), abs(f))', 'test_sheared_row_keeps_its_own_vector_length', 'Sheared row spacing includes its horizontal component'),
        ('reflected-length-negative', '(a+e, b+f)', 'test_reflected_vectors_do_not_change_positive_lengths', 'Reflection preserves native cell vector lengths'),
        ('original-scale-doubled', '(2*math.hypot(a, e), 2*math.hypot(b, f))', 'test_axis_aligned_transform_keeps_declared_spacing', 'Axis-aligned spacing remains the original declared scale'),
        ('matrix-rows-used', '(math.hypot(a, b), math.hypot(e, f))', 'test_asymmetric_vectors_use_columns_instead_of_matrix_rows', 'Raster steps use matrix columns rather than horizontal matrix rows'),
    ]
    controls, oracles = [], []

    def execute(label, test=None):
        p = subprocess.run([sys.executable, '-B', '-m', 'unittest', '-v',
            'test_rotated_georef'+('.Checks.'+test if test else '')], cwd=source.parent,
            capture_output=True, text=True, timeout=30,
            env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = p.stdout+p.stderr
        (out/(label+'-private.log')).write_text(output)
        return p.returncode, output

    def positive(label):
        code, output = execute(label)
        assert code == 0 and 'Ran 6 tests' in output and output.rstrip().endswith('OK'), label
        controls.append({'case': label, 'outcome': 'survived', 'tests': 6})

    try:
        positive('baseline')
        source.write_bytes(original+b'\n# Harmless native cell vector comment.\n')
        positive('harmless-comment')
        source.write_bytes(original)
        positive('restored-after-harmless')
        for label, replacement, test, diagnostic in cases:
            try:
                changed = text.replace(before, 'pixel_size = '+replacement)
                ast.parse(changed)
                source.write_text(changed)
                code, output = execute(label, test)
                assert intended(code, output, test, diagnostic), label+' misses intended assertion'
                for name, c, o, t, d, wanted in [
                    ('exact', code, output, test, diagnostic, True),
                    ('success', 0, output, test, diagnostic, False),
                    ('wrong-exit', 2, output, test, diagnostic, False),
                    ('wrong-test', code, output, 'unrelated_test', diagnostic, False),
                    ('wrong-diagnostic', code, output, test, 'Absent diagnostic', False),
                    ('syntax', code, 'SyntaxError', test, diagnostic, False),
                    ('no-failure', code, 'Ran 1 test\nOK', test, diagnostic, False),
                    ('unrelated-error', code, output+'\nERROR: unrelated\n', test, diagnostic, False),
                ]:
                    actual = bool(intended(c, o, t, d))
                    assert actual == wanted, label+' oracle '+name
                    oracles.append({'case': label, 'oracle': name, 'accepted': actual})
                controls.append({'case': label, 'outcome': 'intended_failure', 'test': test, 'diagnostic': diagnostic})
            finally:
                source.write_bytes(original)
        positive('restored')
        (out/'controls.json').write_text(json.dumps(controls, indent=2)+'\n')
        (out/'oracles.json').write_text(json.dumps(oracles, indent=2)+'\n')
        (out/'source-binding.json').write_text(json.dumps({'path': str(source.relative_to(repo)),
            'sha256': hashlib.sha256(original).hexdigest(),
            'blindCategory': 'Synthetic tag arithmetic cannot prove complete TIFF decoding, CRS fidelity, ground accuracy or a rendered map.'}, indent=2)+'\n')
        print(json.dumps({'positive': 4, 'faults': len(cases), 'oracles': len(oracles)}), flush=True)
    finally:
        source.write_bytes(original)
        assert source.read_bytes() == original


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    run(args.repo.resolve(), args.out.resolve())
