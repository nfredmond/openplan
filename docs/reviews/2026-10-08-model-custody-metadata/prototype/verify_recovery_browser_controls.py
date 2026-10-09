"""Exercise retained browser decisions with reversible faults in an unserved checkout."""
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent
APP = ROOT.parents[3] / 'openplan'
helper = APP / 'src/lib/models/pending-recovery-decision.ts'
panel = APP / 'src/components/models/model-recovery-panel.tsx'
page = APP / 'src/app/(app)/models/[modelId]/page.tsx'
originals = {helper: helper.read_text(), panel: panel.read_text(), page: page.read_text()}
output = Path(os.environ['OPENPLAN_RECOVERY_BROWSER_CONTROLS_OUTPUT']).absolute()
output.mkdir(mode=0o700, parents=True, exist_ok=False)
controls = [
    ('baseline', helper, None, None, None),
    ('harmless', helper, originals[helper] + '\n// Harmless retained-copy comment.\n', None, None),
    ('omit-retention', helper, originals[helper].replace('const retained = retainRecoveryDecision(storage, saved, true);', 'const retained = saved;'), 'does not send when browser storage fails', 'promise resolved'),
    ('omit-copy-comparison', helper, originals[helper].replace('!same(previous.decision, parsed.decision)', 'false'), 'preserves changed copies and never sends their replacement', 'promise resolved'),
    ('omit-account-filter', helper, originals[helper].replace('key.startsWith(prefix(scope))', 'key.startsWith("openplan:model-recovery:")'), "retains unreadable bytes and hides another account's copies", 'expected'),
    ('omit-receipt-checks', helper, originals[helper].replace('!matchesRecoveryReceipt(parsed.receipt, recoveryRpcArguments(parsed.decision, scope.workspaceId, scope.runId, scope.userId))', 'false').replace('matchesRecoveryReceipt(receipt, recoveryRpcArguments(retained.decision, retained.scope.workspaceId, retained.scope.runId, retained.scope.userId))', 'true'), 'keeps an unexpected receipt pending', 'expected'),
    ('omit-acknowledgement', panel, originals[panel].replace(' || !acknowledged', ''), 'requires review and consequence acknowledgement', 'toBeDisabled'),
    ('omit-review-scope', panel, originals[panel].replace('inspectedScope === scopeIdentity ? loadedInspection : null', 'loadedInspection'), 'discards the visible review when account props change', 'not.toBeInTheDocument'),
    ('omit-permission-role', page, originals[page].replace('["owner", "admin"].includes(recoveryMembershipResult.data?.role ?? "")', 'true'), 'binds member membership', 'expected'),
    ('omit-membership-user', page, originals[page].replace('recoveryMembershipResult.data?.user_id === user.id', 'true'), 'refuses a membership with different user_id', 'expected'),
    ('omit-membership-workspace', page, originals[page].replace('recoveryMembershipResult.data?.workspace_id === model.workspace_id', 'true'), 'refuses a membership with different workspace_id', 'expected'),
    ('omit-permission-error', page, originals[page].replace('recoveryMembershipUnreadable ? "unavailable"', 'false ? "unavailable"'), 'keeps failed permission reads unavailable', 'expected'),
    ('omit-permission-projection', page, originals[page].replace('select("workspace_id, user_id, role")', 'select("role")'), 'binds owner membership', 'to deep equally contain'),
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
        command = ['npm', 'test', '--', '--maxWorkers=1', 'src/test/model-recovery-browser-copy.test.ts', 'src/test/model-recovery-panel.test.tsx', 'src/test/model-recovery-page.test.tsx']
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
files = [*originals, APP / 'src/test/model-recovery-browser-copy.test.ts', APP / 'src/test/model-recovery-panel.test.tsx', APP / 'src/test/model-recovery-page.test.tsx']
report = {'controls': records, 'sha256': {str(p.relative_to(APP)): hashlib.sha256(p.read_bytes()).hexdigest() for p in files}, 'evidence_directory': str(output), 'limits': 'DOM component and mocked HTTP tests. These do not prove rendered desktop or mobile layout, real cookies, database behavior, physical worker termination, restart or practitioner acceptance.'}
content = json.dumps(report, indent=2) + '\n'
(output / 'result.json').write_text(content)
(ROOT / 'recovery-browser-controls.json').write_text(content)
print(content)
