"""Bounded actual runtime-admission controls with exact source restoration."""
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def replace(value, before, after):
    if value.count(before) != 1: raise ValueError('Draft control anchor must be unique')
    return value.replace(before, after, 1)


def guard(value, message):
    lines = value.splitlines(keepends=True)
    hits = [i for i, line in enumerate(lines) if "raise ValueError('"+message+"')" in line]
    if len(hits) != 1: raise ValueError('Draft guard anchor must be unique')
    index = hits[0]-1;lines[index] = lines[index][:len(lines[index])-len(lines[index].lstrip())]+'if False:\n'
    return ''.join(lines)


def run(repo, out):
    os.umask(0o077);out.mkdir(mode=0o700)
    paths = {'library': repo/'workers/odm_worker/runtime_admission.py', 'main': repo/'workers/odm_worker/main.py', 'journal': repo/'workers/odm_worker/admission_journal.py'}
    originals = {key: path.read_bytes() for key, path in paths.items()}
    tests = repo/'workers/odm_worker/test_runtime_admission.py';test_bytes = tests.read_bytes()
    census = {node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    cases = []
    def add(label, test, transform, reason, source='library', kind='broken_behavior'):
        cases.append((label, test, transform, reason, source, kind))
    def swap(before, after): return lambda value: replace(value, before, after)
    def disable(message): return lambda value: guard(value, message)
    replay = swap('        return self.journal.admit(request, factory, max_queued=self.max_queued)', '        entry, first = self.journal.admit(request, factory, max_queued=self.max_queued)\n        if not first: entry = __import__("dataclasses").replace(entry, admission={**entry.admission, "callbackId": "changed"})\n        return entry, first')
    add('changed-original-receipt','test_original_receipt_replays_before_capacity_and_payload_conflicts',replay,'original receipt and reference must survive exact replay')
    add('request-order-replaces-admission-order','test_fifo_starts_once_and_terminal_records_stay_unassessed',swap('ORDER BY rowid LIMIT 1','ORDER BY request_id LIMIT 1'),'original admission insertion order must survive')
    for key in ('callbackDeliveryVerification','sourceCustodyVerification','engineCustodyVerification'):
        add('terminal-promotes-'+key,'test_fifo_starts_once_and_terminal_records_stay_unassessed',lambda value,key=key:value.replace("'"+key+"': 'unassessed'","'"+key+"': 'verified'"),'local terminal state cannot promote custody')
    add('uncertain-start-not-held','test_missing_terminal_and_local_failure_hold_accepted_queue',swap("            if any(row is None or row['reportedEngineTerminal'] is None for row in outcomes): return False",'            pass # uncertain start hold removed'),'uncertain engine start must hold later accepted work')
    add('local-failure-releases-queue','test_missing_terminal_and_local_failure_hold_accepted_queue',swap("row is None or row['reportedEngineTerminal'] is None for row in outcomes): return False","row is None for row in outcomes): return False"),'uncertain engine start must hold later accepted work')
    add('pipeline-before-start','test_pipeline_exception_keeps_original_start_and_queue_hold',swap("            entry, first = self.journal.start(pending.request['requestId'], pending.job_reference, self.context)", '            entry, first = pending, True'),'start must precede uncertain pipeline entry')
    add('missing-owner-guard','test_execution_requires_lifetime_owner_and_competing_owner_refuses',disable('ODM runtime execution requires its lifetime owner'),'ValueError not raised')
    add('no-lifetime-root-lock','test_second_runtime_cannot_take_owned_root',swap('        with writer(self.root, time.monotonic()+self.timeout):\n            self._check();self._owned = True','        with __import__("contextlib").nullcontext():\n            self._check();self._owned = True'),'TimeoutError not raised')
    add('concurrent-call-reaches-journal','test_concurrent_pipeline_calls_cannot_overlap',swap('        if not self._execution.acquire(blocking=False): return False','        self._execution.acquire(blocking=False)'),'Concurrent execution reached journal before exclusion')
    add('public-root-before-journal','test_installation_seal_and_private_root_refuse_changed_identity',swap('self.root = absolute(root);private(self.root, True)','self.root = absolute(root)'),'Public runtime root reached journal')
    add('saved-installation-check-ignored','test_saved_installation_change_refuses_before_admission_or_pipeline',disable('Saved ODM installation identity differs'),'ValueError not raised')
    add('invalid-terminal-observation','test_invalid_reported_terminal_types_and_states_refuse',disable('ODM reported terminal observation differs'),'ValueError not raised')
    add('changed-terminal-record-accepted','test_changed_terminal_binding_and_grade_refuse',disable('Original ODM local terminal record differs'),'ValueError not raised')
    add('terminal-write-skipped','test_terminal_publication_interruption_does_not_repeat_pipeline',swap('                publish(self.root, self._name(entry), json_bytes(result))','                pass # terminal publication skipped'),'OSError not raised')
    add('copied-receipt-replaced','test_copied_root_replays_original_receipt_and_holds_uncertain_start',replay,'copied root must preserve original accepted receipt')
    add('durable-handler-skipped','test_http_both_shapes_original_receipt_conflict_and_queue_full',swap("        if admissions is not None:\n            from admission_journal", "        if False:\n            from admission_journal"),'changed HTTP payload must refuse the original ID',source='main')
    add('http-replay-answered-new','test_http_both_shapes_original_receipt_conflict_and_queue_full',swap('202 if first else 200','202'),'actual HTTP replay must preserve original receipt',source='main')
    add('http-conflict-answered-accepted','test_http_both_shapes_original_receipt_conflict_and_queue_full',swap("self._send_json(409, {'error': 'request_identity_conflict'", "self._send_json(202, {'error': 'request_identity_conflict'"),'changed HTTP payload must refuse the original ID',source='main')
    add('http-capacity-answered-accepted','test_http_both_shapes_original_receipt_conflict_and_queue_full',swap("self._send_json(503, {'error': 'queue_full', 'detail': 'The durable pending queue is full.'})", "self._send_json(202, {'error': 'queue_full', 'detail': 'The durable pending queue is full.'})"),'202 != 503',source='main')
    add('http-auth-after-journal','test_http_authentication_and_contract_checks_precede_durable_admission',swap('        if not self._authorized():','        if False:'),'authentication must precede durable admission',source='main')
    add('http-validation-after-journal','test_http_authentication_and_contract_checks_precede_durable_admission',swap('        if errors:\n','        if False:\n'),'contract validation must precede durable admission',source='main')
    add('journal-failure-answered-accepted','test_http_journal_failure_does_not_fall_back_to_memory',swap("self._send_json(503, {'error': 'admission_unavailable'", "self._send_json(202, {'error': 'admission_unavailable'"),'journal failure cannot answer an accepted receipt',source='main')
    add('health-ignores-durable-queue','test_http_health_reads_durable_queue_and_preserves_unavailable',swap("queued = admission_status['accepted']",'queued = 0'),'health must count durable accepted work',source='main')
    add('unavailable-count-becomes-zero','test_http_health_reads_durable_queue_and_preserves_unavailable',swap('                    queued = None','                    queued = 0'),'unavailable journal count cannot become zero',source='main')
    add('implicit-managed-config','test_managed_configuration_requires_explicit_mode',disable('ODM_WORKER_MANAGED_ADMISSION must be 0 or 1'),'ValueError not raised',source='main')
    add('pipeline-replaces-request','test_pipeline_cannot_replace_original_request_or_reference',disable('Pipeline changed original ODM identity'),'ValueError not raised')
    add('pipeline-request-alias','test_pipeline_cannot_replace_original_request_or_reference',swap("'request': json.loads(encoded(entry.request)), 'job_reference'", "'request': entry.request, 'job_reference'"),'ValueError not raised')
    add('install-check-after-journal','test_changed_installation_refuses_before_journal_reads',swap("        with writer(self.root, time.monotonic()+timeout):", "        initial.accepted()\n        with writer(self.root, time.monotonic()+timeout):"),'Changed installation accessed journal',kind='diagnostic_refusal')
    for label,message in [('installation-id','Explicit ODM installation identity is required'),('pending-capacity','ODM runtime pending capacity is invalid'),('pipeline-callable','ODM runtime pipeline is required')]:
        add('invalid-'+label,'test_invalid_configuration_refuses_before_root_access',disable(message),'Invalid runtime configuration reached root')
    add('runtime-not-attached-before-server','test_actual_main_attaches_runtime_and_owns_root_before_serving',swap("        ADMISSIONS = Runtime(state_dir, CONFIG['installation_id'], max_queued=CONFIG['max_queued'], pipeline=PIPELINE)",'        ADMISSIONS = None'),'main must attach durable runtime before serving',source='main')
    add('server-loses-runtime','test_actual_main_attaches_runtime_and_owns_root_before_serving',swap('server.admissions = resolved_admissions','server.admissions = None'),'server must use the actual durable runtime',source='main')
    add('managed-loop-uses-memory','test_actual_main_attaches_runtime_and_owns_root_before_serving',swap('    if ADMISSIONS is not None:\n        while True:','    if False:\n        while True:'),'Managed loop reached memory queue',source='main')
    add('main-releases-owner-before-server','test_actual_main_attaches_runtime_and_owns_root_before_serving',swap('with ADMISSIONS.owner() if ADMISSIONS is not None else nullcontext():','with nullcontext():'),'main must hold durable runtime owner while serving',source='main')
    add('reported-terminal-lost','test_existing_pipeline_retains_reported_terminal_before_local_result',swap("                job['reportedEngineTerminal'] = {'taskUuid': task_uuid, 'statusCode': status_code}", '                pass # terminal observation lost'),'pipeline must retain original task and terminal report',source='main')
    add('missing-original-db-recreated','test_missing_original_database_refuses_without_recreating_registry',swap('timeout=timeout, require_existing=True','timeout=timeout, require_existing=False'),'OSError not raised')
    add('missing-journal-directory-recreated','test_missing_original_journal_directory_is_not_recreated',swap('        if not self.require_existing:\n            try:\n                self.root.mkdir', '        if True:\n            try:\n                self.root.mkdir'),'existing installation cannot recreate its missing journal directory',source='journal')
    add('database-open-allows-create','test_database_disappearing_at_open_is_not_recreated',swap("target = database.as_uri()+'?mode=rw' if self.require_existing else database",'target = database'),'existing journal connection must not recreate a disappeared file',source='journal')
    add('populated-journal-resealed','test_missing_original_seal_refuses_populated_journal',disable('ODM admissions require their original installation seal'),'ValueError not raised')
    add('unsealed-retained-records-ignored','test_missing_seal_with_retained_records_refuses_before_journal_read',disable('ODM runtime records require their original installation seal'),'Unsealed retained records accessed journal')
    add('empty-original-journal-initialized','test_empty_original_database_is_not_initialized_as_new',disable('Original ODM admission journal is not initialized'),'ValueError not raised',source='journal')
    add('nonboolean-existing-mode','test_existing_journal_mode_requires_exact_boolean',disable('ODM existing journal mode must be boolean'),'ValueError not raised',source='journal')
    if {row[1] for row in cases} != census: raise ValueError('New draft tests lack controls')
    outcomes = []
    def restore():
        for key, path in paths.items(): path.write_bytes(originals[key])
    def execute(label, test=None):
        cwd = out/(label+'-cwd');cwd.mkdir(mode=0o700)
        result = subprocess.run([sys.executable,'-B',str(tests)]+(['Checks.'+test] if test else []), cwd=cwd,
            env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'}, capture_output=True, timeout=15)
        output = (result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output)
        return result.returncode, output
    def positive(label, harmless=False):
        restore()
        if harmless:
            for key, path in paths.items(): path.write_bytes(originals[key]+b'\n# Harmless draft inspection control.\n')
        code, output = execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in output: raise AssertionError(label+': baseline failed')
        outcomes.append({'control':label,'outcome':'survived'})
    try:
        positive('baseline');positive('harmless-comments', True);positive('restored-after-harmless')
        for label, test, transform, reason, source, kind in cases:
            try:
                changed = transform(originals[source].decode());ast.parse(changed);paths[source].write_text(changed)
                code, output = execute(label, test)
                if code == 0 or ('FAIL: '+test not in output and 'ERROR: '+test not in output): raise AssertionError(label+': target did not fail')
                lines = output.splitlines();starts = [i for i, line in enumerate(lines) if re.match(r'^[A-Za-z_][\w.]*Error:', line)]
                diagnostic = ''
                if starts:
                    end = next((i for i in range(starts[-1]+1,len(lines)) if lines[i].startswith('-----')),len(lines))
                    diagnostic = '\n'.join(lines[starts[-1]:end])
                if reason not in diagnostic: raise AssertionError(label+': wrong diagnostic '+repr(diagnostic))
                outcomes.append({'control':label,'test':test,'source':source,'kind':kind,'outcome':'intended_failure','reason':reason})
            finally: restore()
        positive('restored-final')
        if tests.read_bytes() != test_bytes or any(path.read_bytes() != originals[key] for key, path in paths.items()): raise AssertionError('Draft source or tests changed')
        (out/'controls.json').write_text(json.dumps(outcomes,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [*paths.values(),tests]},indent=2)+'\n')
        print(json.dumps({'controls':len(outcomes),'positive':4,'broken':len(cases),'testsCovered':len(census)}))
    finally:
        restore()
        for path in paths.values():
            with path.open('rb') as stream: os.fsync(stream.fileno())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True);args = parser.parse_args();run(args.repo.resolve(),args.out.absolute())
