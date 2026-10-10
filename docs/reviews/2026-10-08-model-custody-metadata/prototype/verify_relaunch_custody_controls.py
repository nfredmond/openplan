"""Exercise relaunch custody presentation with reversible faults in an unserved checkout."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
APP = ROOT.parents[3] / 'openplan'
helper = APP / 'src/lib/models/recovery-status.ts'
panel = APP / 'src/components/models/model-run-evidence-panel.tsx'
loader = APP / 'src/lib/models/recovery-status-server.ts'
originals = {p: p.read_text() for p in (helper, panel, loader)}
output = Path(os.environ['OPENPLAN_RELAUNCH_CONTROLS_OUTPUT']).absolute()
output.mkdir(mode=0o700, parents=True, exist_ok=False)
controls = [
    ('baseline', helper, None, None, None),
    ('harmless', helper, originals[helper] + '\n// Harmless relaunch documentation control.\n', None, None),
    ('offer-retained', helper, originals[helper].replace('recovery.relaunchCustody === "unstarted"', '(recovery.relaunchCustody === "unstarted" || recovery.relaunchCustody === "retained")'), 'withholds relaunch for retained custody', 'to be null'),
    ('ignore-custody', loader, originals[loader].replace('await inspectRelaunchCustody(workspaceId, run.id)', '"unstarted"'), 'preserves retained custody', 'expected'),
    ('hide-eligible-reset', panel, originals[panel].replace('relaunchNotice === null &&', 'false &&'), 'names the worker that accepted', 'Unable to find'),
    ('wrong-custody-scope', loader, originals[loader].replace('inspectRelaunchCustody(workspaceId, run.id)', 'inspectRelaunchCustody(run.id, workspaceId)'), 'carries scoped historical status', 'expected'),
    ('restored', helper, None, None, None),
]
records = []
try:
    for name, path, changed, test_name, marker in controls:
        for file, original in originals.items():
            file.write_text(original)
        if changed is not None:
            assert changed != originals[path], name
            path.write_text(changed)
        command = ['npm', 'test', '--', '--maxWorkers=1', 'src/test/model-recovery-status.test.ts', 'src/test/model-recovery-status-controls.test.tsx', 'src/test/a-relaunched-run-says-whether-it-will-fare-better.test.tsx', 'src/test/model-recovery-page.test.tsx']
        if test_name:
            command += ['-t', test_name]
        result = subprocess.run(command, cwd=APP, capture_output=True, text=True, timeout=60)
        log = result.stdout + result.stderr
        (output / (name + '.log')).write_text(log)
        if test_name:
            assert result.returncode != 0 and test_name in log and marker in log, name + ': ' + log
        else:
            assert result.returncode == 0, log
        records.append({'control': name, 'returncode': result.returncode, 'targeted_test': test_name, 'failure_marker': marker})
finally:
    for path, original in originals.items():
        path.write_text(original)
for path, original in originals.items():
    assert path.read_text() == original
files = [*originals, APP / 'src/test/model-recovery-status.test.ts', APP / 'src/test/model-recovery-status-controls.test.tsx', APP / 'src/test/a-relaunched-run-says-whether-it-will-fare-better.test.tsx', APP / 'src/test/model-recovery-page.test.tsx']
report = {'controls': records, 'sha256': {str(p.relative_to(APP)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}, 'evidence_directory': str(output), 'limits': 'DOM component and mocked HTTP tests. These do not prove rendered desktop or mobile layout, real cookies, database behavior, physical worker termination, restart or practitioner acceptance.'}
content = json.dumps(report, indent=2) + '\n'
(output / 'result.json').write_text(content)
(ROOT / 'relaunch-custody-controls.json').write_text(content)
print(content)
