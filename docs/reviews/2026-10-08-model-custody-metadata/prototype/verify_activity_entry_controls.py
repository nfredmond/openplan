"""Fault checks for admitted entry using retained journals and injected receipts."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
worker = ROOT / 'workers/activitysim_worker/supabase_poll.py'
writer = ROOT / 'workers/aequilibrae_worker/model_attempt_writer.py'
original = {path: path.read_bytes() for path in (worker, writer)}
mutations = (
    ('legacy-entry', worker, 'if admitted is not None:', 'if False:', 'test_admitted_entry_completes_without_legacy_claim_or_parent_write'),
    ('unknown-handler', worker, '        if handler is None:\n            raise ValueError("Managed dispatch has no owned handler")', '        if False:\n            raise ValueError("Managed dispatch has no owned handler")', 'test_unknown_handler_is_refused_before_run_read'),
    ('cross-scope', worker, "if stage['id'] != writer.context.stage_id or stage['run_id'] != writer.context.run_id:", 'if False:', 'test_cross_scope_entry_stops_without_work'),
    ('wrong-handler', writer, "if expected_stage_name is not None and stage.get('stage_name') != expected_stage_name:", 'if False:', 'test_database_stage_name_must_match_handler'),
    ('continue-after-error', worker, '        writer.stopped = True\n        raise\n    finally:', '        writer.stopped = False\n        raise\n    finally:', 'test_handler_failure_does_not_guess_terminal_state'),
    ('missing-name-projection', writer, "('stage_name,' if expected_stage_name is not None else '')", "''", 'test_admitted_entry_completes_without_legacy_claim_or_parent_write'),
    ('empty-name', writer, "if expected_stage_name is not None and (not isinstance(expected_stage_name, str) or not expected_stage_name.strip()):", 'if False:', 'test_empty_expected_stage_name_is_refused_before_transport'),
    ('parent-completion', worker, "        sb_patch_stage(stage['id'], {'status': 'succeeded', 'log_tail': result['log']})", "        sb_patch_stage(stage['id'], {'status': 'succeeded', 'log_tail': result['log']})\n        maybe_mark_run_succeeded(stage['run_id'])", 'test_admitted_entry_completes_without_legacy_claim_or_parent_write'),
)
cases = []
try:
    variants = [('harmless', {worker: original[worker] + b'\n# Harmless entry control.\n'}, None)]
    for name, path, before, after, test in mutations:
        assert original[path].count(before.encode()) == 1, name
        variants.append((name, {path: original[path].replace(before.encode(), after.encode())}, test))
    variants.append(('restored', {}, None))
    for name, changes, test in variants:
        for path, content in original.items(): path.write_bytes(changes.get(path, content))
        command = [sys.executable, '-B', str(ROOT / 'workers/aequilibrae_worker/test_activity_managed_dispatch.py')]
        if test: command.append('DispatchTests.' + test)
        result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True, timeout=30)
        detail = result.stdout + result.stderr
        if test:
            assert result.returncode != 0 and test in detail and ('AssertionError' in detail or (name in ('empty-name', 'unknown-handler') and 'incomplete or no longer owned' in detail)), detail
        else:
            assert result.returncode == 0, detail
        cases.append({'control': name, 'returncode': result.returncode, 'expected_behavior_observed': True})
finally:
    for path, content in original.items(): path.write_bytes(content)
report = {'cases': cases, 'sources': {str(path.relative_to(ROOT)): hashlib.sha256(content).hexdigest() for path, content in original.items()},
          'limits': ['Real local journals, injected HTTP receipts and synthetic handler', 'Native scaffold entry is a separate campaign',
                     'No automatic poll enrollment, native engine or scientific acceptance']}
Path(__file__).with_name('activity-entry-unit-controls.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
