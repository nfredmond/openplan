"""Test only the actual shell bootstrap branch with fixture executables."""
import ast, json, hashlib, os, subprocess, tempfile
from pathlib import Path

OUT = Path(__file__).parent
SOURCE = (OUT / 'run_database.py').read_text()
tree = ast.parse(SOURCE)
node = next(n for n in ast.walk(tree) if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'script' for t in n.targets))
scope = {'preload': 'fixture'}
exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), '<extracted native bootstrap>', 'exec'), scope)
SCRIPT = scope['script']
records = []


def exercise(label, text, existing, expected_error=None):
    with tempfile.TemporaryDirectory(prefix='openplan-bootstrap-control-') as root:
        root = Path(root); data = root / 'data'; data.mkdir()
        sentinel = data / 'retained'; sentinel.write_text('retained bytes')
        if existing: (data / 'PG_VERSION').write_text('17\n')
        fake = root / 'gosu'
        fake.write_text('#!/bin/sh\nprintf "%s\\n" "$2" >> "$CONTROL_LOG"\nif [ "$2" = initdb ]; then printf "17\\n" > "$CONTROL_DATA/PG_VERSION"; fi\n')
        fake.chmod(0o700)
        # Exercise the branch and execution, excluding the unrelated UID setup.
        # Native ownership, mounted key and server readiness are separate checks.
        lines = text.splitlines()
        assert sum(line.startswith('install -d ') for line in lines) == 1
        text = '\n'.join(line for line in lines if not line.startswith('install -d '))
        text = text.replace('/var/lib/postgresql/data/proof', str(data))
        result = subprocess.run(['/bin/sh', '-c', text], env={**os.environ, 'PATH': str(root)+':/usr/bin:/bin', 'CONTROL_LOG': str(root/'calls'), 'CONTROL_DATA': str(data)}, capture_output=True)
        assert result.returncode == 0, 'A shell error cannot count as a killed behavior'
        calls = (root / 'calls').read_text().splitlines() if (root / 'calls').exists() else []
        failure = None
        try:
            assert calls.count('initdb') == (0 if existing else 1), 'bootstrap-init-count'
            assert calls.count('postgres') == 1, 'bootstrap-server-execution'
            assert sentinel.read_text() == 'retained bytes', 'bootstrap-retained-file'
        except AssertionError as error: failure = str(error)
        assert failure == expected_error, (label, failure, expected_error)
        records.append({'case': label, 'existingCluster': existing, 'result': 'intended oracle failure' if failure else 'survived', 'failure': failure, 'calls': calls})


exercise('fresh baseline', SCRIPT, False)
exercise('existing baseline', SCRIPT, True)
exercise('harmless', '# Harmless comment\n' + SCRIPT, True)
exercise('repeat initialization', SCRIPT.replace('if [ ! -f /var/lib/postgresql/data/proof/PG_VERSION ]; then', 'if true; then'), True, 'bootstrap-init-count')
exercise('omit initialization', SCRIPT.replace('if [ ! -f /var/lib/postgresql/data/proof/PG_VERSION ]; then', 'if false; then'), False, 'bootstrap-init-count')
exercise('wrong version path', SCRIPT.replace('/proof/PG_VERSION', '/proof/FOREIGN_VERSION'), True, 'bootstrap-init-count')
exercise('omit server execution', SCRIPT.replace('exec gosu postgres postgres', 'true'), True, 'bootstrap-server-execution')
exercise('restored fresh', SCRIPT, False)
exercise('restored existing', SCRIPT, True)
assert (OUT / 'run_database.py').read_text() == SOURCE
(OUT / 'bootstrap-controls.json').write_text(json.dumps({'sourceSha256': hashlib.sha256(SOURCE.encode()).hexdigest(), 'cases': records, 'limits': 'Extracted actual shell branch with fixture executables and data; no UID, PostgreSQL, key, role or native restart acceptance.'}, indent=2)+'\n')
print(len(records), 'bootstrap cases pass; actual source unchanged')
