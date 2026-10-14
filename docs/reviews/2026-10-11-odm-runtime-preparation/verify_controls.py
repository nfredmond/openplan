"""Bounded actual runtime-preparation controls with exact source restoration."""
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
    paths = {'library': repo/'workers/odm_worker/runtime_preparation.py', 'source': repo/'workers/odm_worker/retained_source.py'}
    originals = {key: path.read_bytes() for key, path in paths.items()}
    tests = repo/'workers/odm_worker/test_runtime_preparation.py';test_bytes = tests.read_bytes()
    census = {node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    cases = []
    def add(label, test, transform, reason, source='library', kind='broken_behavior'):
        cases.append((label, test, transform, reason, source, kind))
    def swap(before, after): return lambda value: replace(value, before, after)
    def disable(message): return lambda value: guard(value, message)
    add('unowned-journal-read','test_owner_required_before_journal_or_source_access',disable('Runtime preparation requires its lifetime owner'),'Unowned preparation accessed journal')
    add('unstarted-preparation','test_accepted_or_other_installation_start_cannot_prepare',disable('Original owned start is required before preparation'),'Unstarted preparation accessed supplier')
    add('missing-original-actor','test_missing_actor_or_incomplete_original_row_refuses_before_source',disable('Original application job and actor are required'),'Missing actor accessed source')
    add('changed-application-scope','test_original_application_scope_refuses_before_source',disable('Original application job scope differs'),'Changed scope accessed source')
    add('unknown-supplier-fields','test_exact_supplier_shape_and_detached_entry',disable('Exact original runtime preparation inputs are required'),'ValueError not raised')
    add('supplier-request-alias','test_exact_supplier_shape_and_detached_entry',swap('self.supply(copy.deepcopy(entry))','self.supply(entry)'),'supplier must not replace original entry through alias')
    add('invalid-runtime-supplier','test_invalid_constructor_refuses_without_source',disable('Original admission runtime and input supplier are required'),'ValueError not raised')
    add('invalid-timeout','test_invalid_constructor_refuses_without_source',disable('Runtime preparation timeout must be positive and finite'),'ValueError not raised')
    add('invalid-mapping-reaches-source','test_source_mapping_and_count_refuse_before_retention',disable('Original runtime source mapping differs'),'Invalid source mapping accessed retention')
    add('invalid-count-reaches-source','test_source_mapping_and_count_refuse_before_retention',disable('Original runtime source count differs'),'Invalid source mapping accessed retention')
    add('invalid-byte-limit','test_limits_options_and_photo_filenames_refuse_before_retention',swap("        finite_limit(spec['maxBytes'])",'        pass # ceiling skipped'),'Invalid settings accessed retention')
    add('invalid-options','test_limits_options_and_photo_filenames_refuse_before_retention',disable('Original runtime engine options differ'),'Invalid settings accessed retention')
    add('invalid-photo-names','test_limits_options_and_photo_filenames_refuse_before_retention',disable('Original runtime photo filenames differ'),'Invalid settings accessed retention')
    add('overlap-reaches-source','test_input_root_overlap_refuses_before_retention',disable('Runtime input and retained roots must not overlap'),'Overlapping input accessed retention')
    add('saved-uuid-regenerated','test_original_uuid_and_identity_survive_repeat_preparation',swap("task = original.get('taskUuid') if isinstance(original, dict) else None",'task = str(uuid.uuid4())'),'Original task UUID regenerated')
    add('saved-plan-check-omitted','test_actor_target_engine_options_and_limits_cannot_rebind_saved_plan',swap("            publish(root, saved.name, json_bytes(plan))","            if not saved.exists(): publish(root, saved.name, json_bytes(plan))"),'Changed original plan accessed source')
    add('pipeline-original-identity-ignored','test_pipeline_job_identity_refuses_before_supplier',disable('Pipeline preparation identity differs from original admission'),'Changed pipeline job accessed supplier')
    add('missing-plan-regenerates-uuid','test_missing_preparation_plan_cannot_adopt_retained_records',disable('Runtime preparation records require their original plan'),'Missing plan regenerated task identity')
    add('invalid-saved-task-reaches-source','test_invalid_saved_task_refuses_before_retention_and_restores',disable('Original runtime preparation task identity differs'),'Invalid saved task accessed retention')
    add('restored-start-rebound','test_complete_copy_replays_with_missing_original_input',swap("        spec['engine'] = engine_identity(spec['engine'])","        context['originalStartContext'] = copy.deepcopy(self.runtime.context)\n        spec['engine'] = engine_identity(spec['engine'])"),'Existing source custody record differs')
    add('source-before-original-plan','test_interrupted_slot_resumes_from_original_plan_and_bytes',swap("            publish(root, saved.name, json_bytes(plan))",'            pass # preparation plan omitted'),'Original preparation plan must precede source retention')
    add('zip-derivation-skipped','test_zip_pipeline_derives_original_slots_before_engine_plan',swap("            if spec['zipLimits'] is not None:",'            if False:'),'ZIP source requires original derived-image custody')
    add('zip-shape-ignored','test_zip_limits_refuse_before_source',disable('Original runtime ZIP derivation limits are required'),'ValueError not raised')
    add('zip-ceilings-ignored','test_zip_limits_refuse_before_source',swap('            for limit in limits.values(): finite_limit(limit)','            pass # ZIP ceilings skipped'),'ValueError not raised')
    add('changed-installation-reaches-supplier','test_changed_installation_refuses_before_supplier',swap('        self.runtime._check()','        pass # installation seal skipped'),'Changed installation accessed supplier')
    add('engine-identity-check-skipped','test_invalid_engine_identity_refuses_before_retention',swap("        spec['engine'] = engine_identity(spec['engine'])",'        pass # engine identity skipped'),'Invalid engine accessed retention')
    add('expiry-before-source-skipped','test_timeout_before_source_retention_refuses',swap("            if remaining <= 0: raise TimeoutError('Runtime preparation deadline exceeded')",'            pass # source deadline skipped'),'Expired preparation accessed retention')
    add('expiry-before-record-skipped','test_timeout_before_prepared_record_refuses_publication',swap("            if time.monotonic() >= deadline: raise TimeoutError('Runtime preparation deadline exceeded')\n            publish(root, 'prepared.json', json_bytes(result))","            publish(root, 'prepared.json', json_bytes(result))"),'expired preparation cannot publish a completed local record')
    add('expiry-after-record-skipped','test_late_prepared_publication_never_reports_success',swap("            publish(root, 'prepared.json', json_bytes(result))\n            if time.monotonic() >= deadline: raise TimeoutError('Runtime preparation deadline exceeded')","            publish(root, 'prepared.json', json_bytes(result))"),'TimeoutError not raised')
    add('actor-from-reference','test_actual_owned_runtime_prepares_once_and_holds_next_job',swap("'originalActorId': row['created_by']","'originalActorId': row['workspace_id']"),'actor must come from supplied application record')
    add('transport-permission-promoted','test_actual_owned_runtime_prepares_once_and_holds_next_job',swap("'callbackDeliveryVerification': 'unassessed', 'engineTransportPermission': False","'callbackDeliveryVerification': 'unassessed', 'engineTransportPermission': True"),'local preparation cannot permit engine transport')
    add('preparation-issues-init','test_actual_owned_runtime_prepares_once_and_holds_next_job',swap("            result = {'format': FORMAT","            effects.issue('init')\n            result = {'format': FORMAT"),'preparation cannot issue engine commands')
    add("promoted-authorityVerification","test_actual_owned_runtime_prepares_once_and_holds_next_job",swap("                      'authorityVerification': 'unassessed', 'engineCustodyVerification'", "                      'authorityVerification': 'accepted', 'engineCustodyVerification'"),"preparation cannot promote authorityVerification")
    add('promoted-engineCustodyVerification',"test_actual_owned_runtime_prepares_once_and_holds_next_job",swap("'engineCustodyVerification': 'unassessed'","'engineCustodyVerification': 'accepted'"),'preparation cannot promote engineCustodyVerification')
    add('promoted-callbackDeliveryVerification',"test_actual_owned_runtime_prepares_once_and_holds_next_job",swap("'callbackDeliveryVerification': 'unassessed'","'callbackDeliveryVerification': 'accepted'"),'preparation cannot promote callbackDeliveryVerification')
    add("changed-retained-slot-backstop","test_changed_retained_bytes_refuse_and_restore",disable("Retained source slot differs"),"Existing source custody record differs",source="source",kind="diagnostic_refusal")
    if {row[1] for row in cases} != census: raise ValueError('New preparation tests lack controls')
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
            for key, path in paths.items(): path.write_bytes(originals[key]+b'\n# Harmless preparation control.\n')
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
