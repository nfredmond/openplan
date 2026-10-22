"""Exercise the existing Tk layout guard with detached candidate source files.

Uses an owned Xvfb display. All application commands and status collection remain
forbidden by the existing fixture. This is no operational or browser acceptance.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / 'openplan/scripts/ops/openplan-control-panel.py'
TEST = ROOT / 'openplan/scripts/ops/tests/test_control_layout.py'


def intended_clipping(code, diagnostic):
    failures = re.findall(r'^[A-Za-z_][\w.]*Error: .*$', diagnostic, flags=re.MULTILINE)
    return code == 1 and len(failures) == 1 and re.fullmatch(
        r'AssertionError: \d+ not greater than or equal to \d+ : label vertically clipped: Updates code and database\. Keeps recovery copies\.',
        failures[0]) is not None and 'FAILED (failures=1)' in diagnostic


def run(out):
    os.umask(0o077);out.mkdir(mode=0o700)
    original = SOURCE.read_bytes();source = original.decode()
    fixed = 'self.demo_summary.pack(fill="x", pady=(8, 8))'
    assert source.count(fixed) == 1
    cases = [('baseline', source, False),
        ('harmless-comment', source + '\n# Harmless layout control.\n', False),
        ('preceding-clipped-gap', source.replace(fixed, 'self.demo_summary.pack(fill="x", pady=(8, 12))'), True),
        ('restored', source, False)]
    rows = []
    for label, candidate, broken in cases:
        path = out / (label + '.py');path.write_text(candidate)
        result = subprocess.run(['xvfb-run', '-a', '/usr/bin/python3', '-B', str(TEST)],
            cwd=TEST.parent, capture_output=True, text=True, timeout=30,
            env={**os.environ, 'CONTROL_PANEL_TEST_SOURCE': str(path), 'PYTHONDONTWRITEBYTECODE': '1',
                 'CONTROL_LAYOUT_CAPTURE_DIR': ''})
        diagnostic = result.stdout + result.stderr
        (out / (label + '-private.log')).write_text(diagnostic)
        if broken:
            assert intended_clipping(result.returncode, diagnostic), 'Layout fault failed for another reason'
            outcome = 'intended_failure'
        else:
            assert result.returncode == 0 and '\nOK\n' in diagnostic, 'Ordinary layout did not pass'
            outcome = 'survived'
        rows.append({'control': label, 'outcome': outcome})
        assert SOURCE.read_bytes() == original, 'Controller changed production source'
    reason = 'AssertionError: 26 not greater than or equal to 28 : label vertically clipped: Updates code and database. Keeps recovery copies.\nFAILED (failures=1)\n'
    oracles = [(1, reason, True), (1, reason + '# harmless\n', True), (1, reason, True), (0, reason, False),
        (1, reason.replace('Updates code', 'Other code'), False), (1, 'ValueError: unrelated\n', False),
        (1, reason + 'AssertionError: second failure\n', False),
        (1, reason + 'ValueError: secondary failure\n', False),
        (1, reason.replace('FAILED (failures=1)', 'FAILED (failures=2)'), False),
        (1, reason.replace('AssertionError:', 'ValueError:'), False)]
    for code, text, expected in oracles:
        assert intended_clipping(code, text) is expected, 'Layout classifier differs'
    (out / 'controls.json').write_text(json.dumps(rows, indent=2) + '\n')
    (out / 'summary.json').write_text(json.dumps({'controls': len(rows), 'classifierControls': len(oracles),
        'sourceSha256': hashlib.sha256(original).hexdigest(), 'testSha256': hashlib.sha256(TEST.read_bytes()).hexdigest(),
        'boundary': 'Synthetic Xvfb geometry and keyboard checks only; no live services or browser.'}, indent=2) + '\n')
    print(json.dumps({'controls': len(rows), 'classifierControls': len(oracles), 'sourceRestored': True}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, required=True)
    run(parser.parse_args().out.resolve())
