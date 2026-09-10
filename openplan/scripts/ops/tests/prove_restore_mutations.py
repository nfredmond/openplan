"""Run restoration guard mutations in private copies, never in a served checkout."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


def prove(destination):
    ops = Path(__file__).resolve().parents[1]
    cases = json.loads((ops/'tests/fixtures/restore-mutations.json').read_text())
    results = []
    with tempfile.TemporaryDirectory(prefix='openplan-restore-mutations-') as directory:
        scratch = Path(directory)
        (scratch/'tests/fixtures').mkdir(parents=True)
        for relative in ['full_restore.py', 'reconstruct_owp_restore.py',
                         'disposable-restore-drill.sh', 'restore_ports.py',
                         'tests/test_full_restore.py', 'tests/test_reconstruct_owp_restore.py',
                         'tests/test_restore_drill_ownership.py', 'tests/fixtures/owp-recovery.json']:
            shutil.copyfile(ops/relative, scratch/relative)
        for case in cases:
            original = (ops/case['module']).read_text()
            if case['before'] not in original:
                raise RuntimeError('Mutation target disappeared: '+case['name'])
            (scratch/case['module']).write_text(original.replace(case['before'], case['after'], 1))
            result = subprocess.run([sys.executable, '-B', '-m', 'unittest', 'discover',
                                     '-s', 'tests', '-p', case['test']], cwd=scratch,
                                    env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            (scratch/case['module']).write_text(original)
            survived = result.returncode == 0
            if survived != case['survive'] or (not survived and 'FAIL:' not in result.stdout):
                raise RuntimeError(case['name']+' did not produce its intended result:\n'+result.stdout)
            results.append({'name': case['name'], 'module': case['module'],
                            'result': 'survived' if survived else 'targeted failure'})
    Path(destination).write_text(json.dumps(results, indent=2)+'\n')
    print(f'{len(results)} restoration mutations behaved as declared, including harmless controls')


if __name__ == '__main__':
    prove(sys.argv[1])
