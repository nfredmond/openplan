"""Prove workflow checks in private copies, without editing an active checkout."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def prove(destination):
    repo = Path(__file__).resolve().parents[4]
    workflow = repo / '.github/workflows/restore-drill.yml'
    original = workflow.read_bytes()
    text = original.decode()
    command = '          python3 -B scripts/ops/tests/prove_key_custody_mutations.py "$RUNNER_TEMP/openplan-restore-evidence/key-custody-mutations.json"\n'
    cases = [('baseline', text, True), ('harmless comment', '# Harmless workflow control\n' + text, True)]
    for path in ['openplan/scripts/ops/database_key_custody.py',
                 'openplan/scripts/ops/tests/test_database_key_custody.py',
                 'openplan/scripts/ops/tests/prove_key_custody_mutations.py']:
        line = '      - "' + path + '"\n'
        assert text.count(line) == 1
        cases.append(('omit ' + path, text.replace(line, ''), False))
    assert text.count(command) == 1
    cases.extend([('omit key proof command', text.replace(command, ''), False),
                  ('comment instead of execution', text.replace(command, '          # ' + command.strip() + '\n'), False),
                  ('representative sample instead of full archive', text.replace(' -- --full-archive', ''), False),
                  ('restored', text, True)])
    records = []
    with tempfile.TemporaryDirectory(prefix='openplan-key-workflow-controls-') as root:
        scratch = Path(root)
        copied = scratch / '.github/workflows/restore-drill.yml'
        copied.parent.mkdir(parents=True)
        tests = scratch / 'openplan/scripts/ops/tests'
        tests.mkdir(parents=True)
        shutil.copyfile(repo / 'openplan/scripts/ops/tests/test_key_restore_workflow.py', tests / 'test_key_restore_workflow.py')
        try:
            for name, content, survives in cases:
                copied.write_text(content)
                result = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover',
                                         '-s', 'openplan/scripts/ops/tests', '-p', 'test_key_restore_workflow.py'],
                                        cwd=scratch, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'},
                                        capture_output=True, text=True)
                output = result.stdout + result.stderr
                if (result.returncode == 0) != survives or (not survives and ('FAIL:' not in output or 'ERROR:' in output)):
                    raise RuntimeError(name + ' did not behave at its intended assertion:\n' + output)
                records.append({'name': name, 'result': 'survived' if survives else 'intended assertion failure', 'output': output})
        finally:
            copied.write_bytes(original)
            assert workflow.read_bytes() == original, 'Original workflow changed'
    Path(destination).write_text(json.dumps({'workflowSha256': hashlib.sha256(original).hexdigest(),
        'controls': records, 'limits': 'Declarative paths and executable command shape. Does not emulate GitHub events, prove runner permissions or establish native restore acceptance.'}, indent=2) + '\n')
    print(str(len(records)) + ' workflow controls behave as declared; original bytes unchanged')


if __name__ == '__main__':
    prove(sys.argv[1])
