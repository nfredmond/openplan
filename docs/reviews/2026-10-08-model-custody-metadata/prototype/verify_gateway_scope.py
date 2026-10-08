"""Mutate proof-target guards in copies without contacting Docker or databases."""
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parent
source = (root / 'isolated_postgrest.py').read_text()
controls = [('baseline', source, None), ('harmless', source + '\n# Harmless scope control.\n', None)]
for label, fragment in [('database', "if database is not None and not re.fullmatch"), ('schema', "if not (schema == 'public'")]:
    line = next(line for line in source.splitlines() if line.strip().startswith(fragment))
    controls.append((label, source.replace(line, '    if False:'), 'Docker reached for unowned ' + label))
controls.append(('restored', source, None))
for name, candidate, expected in controls:
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory)
        (target / 'isolated_postgrest.py').write_text(candidate)
        for file in ('verify_journal_recovery.py', 'request_journal.py', 'test_gateway_scope.py'):
            (target / file).write_bytes((root / file).read_bytes())
        result = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'test_gateway_scope'], cwd=target, capture_output=True, text=True, timeout=10)
        if expected is None and result.returncode:
            raise RuntimeError(name + ': ' + result.stderr)
        if expected is not None and (result.returncode == 0 or expected not in result.stderr or 'ERROR:' in result.stderr):
            raise RuntimeError(name + ': wrong failure: ' + result.stderr)
        print(name + ': ' + ('passed' if expected is None else 'scope bypass detected before Docker'))
