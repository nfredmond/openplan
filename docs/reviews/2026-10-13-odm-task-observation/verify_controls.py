"""Exercise each task observation test with harmless and restored source controls."""
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
    if value.count(before) != 1:
        raise ValueError('Observation mutation anchor must be unique')
    return value.replace(before, after, 1)


def guard(value, message):
    tree=ast.parse(value);matches=[]
    for node in ast.walk(tree):
        if isinstance(node,ast.If):
            for statement in node.body:
                if isinstance(statement,ast.Raise) and isinstance(statement.exc,ast.Call) and isinstance(statement.exc.func,ast.Name) and statement.exc.func.id=='ValueError' and statement.exc.args and isinstance(statement.exc.args[0],ast.Constant) and statement.exc.args[0].value==message:
                    matches.append(node)
    if len(matches)!=1:raise ValueError('Observation guard anchor must be unique')
    matches[0].test=ast.Constant(False)
    return ast.unparse(tree)+'\n'


def run(repo, out):
    os.umask(0o077);out.mkdir(mode=0o700)
    source = repo/'workers/odm_worker/task_observation.py'
    tests = repo/'workers/odm_worker/test_task_observation.py'
    original = source.read_bytes();test_bytes = tests.read_bytes();text = original.decode()
    census = {node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node, ast.FunctionDef) and node.name.startswith('test_')}
    cases = []
    def add(label, test, transform, reason, kind='broken_behavior'):
        cases.append((label, test, transform, reason, kind))
    def disable(message): return lambda value: guard(value, message)
    def swap(before, after): return lambda value: replace(value, before, after)
    add('original-plan-validation-omitted','test_original_plan_is_required',swap('plan = original_plan(plan)','plan = copy.deepcopy(plan)'),'ValueError not raised')
    add('raw-response-hash-lost','test_raw_bytes_and_plan_hash_are_exact',swap("hashlib.sha256(body).hexdigest()","'0'*64"),'Observation response hash must bind its exact bytes')
    add('plan-hash-lost','test_raw_bytes_and_plan_hash_are_exact',swap("hashlib.sha256(json_bytes(plan)).hexdigest()","'0'*64"),'Observation must bind its complete original plan')
    add('metadata-grants-transport','test_acknowledged_metadata_never_grants_permission',swap("'transportPermission':False","'transportPermission':True"),'transportPermission must remain denied')
    add('metadata-promotes-settings','test_acknowledged_metadata_never_grants_permission',swap("'effectiveExecutionSettingsVerification':'unassessed'","'effectiveExecutionSettingsVerification':'verified'"),'effectiveExecutionSettingsVerification cannot be promoted')
    add('response-status-type-or-bound','test_response_status_types_and_byte_bound',disable('Task metadata response status, type or bound differs'),'ValueError not raised')
    add('empty-error-accepted','test_response_object_and_error_presence',swap(" or 'error' in value",''),'ValueError not raised')
    add('required-fields-omitted','test_required_metadata_is_not_filled_in',disable('Task metadata required fields differ'),"KeyError: 'uuid'",'diagnostic_refusal')
    add('duplicate-json-keys','test_duplicate_and_nonfinite_json_refuse',swap("            if key in result:raise ValueError('Task metadata repeats a JSON key')",'            pass'),'ValueError not raised')
    add('nonfinite-json-accepted','test_duplicate_and_nonfinite_json_refuse',swap("    def constant(value):raise ValueError('Task metadata contains nonfinite JSON')",'    def constant(value):return None'),'ValueError not raised')
    add('original-uuid-name-unchecked','test_original_uuid_and_name_match',disable('Task metadata original UUID or name differs'),'ValueError not raised')
    add('image-count-type-unchecked','test_known_image_count_matches_exactly',swap('type(count) is not int','False'),'ValueError not raised')
    add('unknown-count-becomes-zero','test_unknown_image_count_remains_unassessed',swap("'reportedImageCount':count if count>=0 else None","'reportedImageCount':count if count>=0 else 0"),'Unknown image count cannot become zero')
    add('automatic-flags-lost','test_requested_options_are_separate_from_added_flags',swap("'automaticPostprocessingOptions':copy.deepcopy(additions)","'automaticPostprocessingOptions':[]"),'Lists differ')
    add('option-shape-omitted','test_option_shape_and_duplicate_names_refuse',swap("or type(row['value']) not in (str,int,float,bool) for row in reported):","or type(row['value']) not in (str,int,float,bool) for row in reported) and False:"),"KeyError: 'name'",'diagnostic_refusal')
    add('option-name-duplicates','test_option_shape_and_duplicate_names_refuse',disable('Task metadata reported options repeat a name'),'ValueError not raised')
    add('requested-options-unchecked','test_requested_option_values_names_and_types_match',disable('Task metadata original requested options differ'),'ValueError not raised')
    add('automatic-option-order-unchecked','test_automatic_option_names_values_and_order_match_profile',swap(' or order!=sorted(order)',''),'ValueError not raised')
    add('empty-supported-subset-refused','test_supported_automatic_subsets_and_explicit_false_are_preserved',swap("    additions = reported[len(requested):]","    additions = reported[len(requested):]\n    if not additions:raise ValueError('Synthetic unsupported empty subset')"),'Synthetic unsupported empty subset')
    add('reported-state-type-unchecked','test_reported_state_is_known_exact_integer',swap("type(outcome.get('code')) is not int",'False'),'ValueError not raised')
    add('completed-state-relabeled','test_all_reported_states_stay_reported',swap("40:'completed'","40:'failed'"),"'failed' != 'completed'")
    add('error-detail-unchecked','test_reported_error_detail_is_bounded_or_missing',disable('Task metadata reported error detail differs'),'ValueError not raised')
    add('progress-type-unchecked','test_progress_is_reported_finite_range_not_defaulted',swap('type(progress) not in (int,float)','False'),'ValueError not raised')
    add('huge-progress-converted-before-range','test_huge_finite_progress_refuses_before_float_conversion',swap('not 0<=progress<=100 or not math.isfinite(progress)','not math.isfinite(progress) or not 0<=progress<=100'),'OverflowError: int too large to convert to float','diagnostic_refusal')
    add('time-type-unchecked','test_reported_times_are_exact_integer_ranges',swap('type(duration) is not int','False'),'ValueError not raised')
    add('not-started-time-becomes-zero','test_not_started_processing_time_is_distinct_from_zero',swap("'reportedProcessingTimeMs':duration if duration>=0 else None","'reportedProcessingTimeMs':duration if duration>=0 else 0"),'Not-started time cannot become zero')
    add('returned-views-alias','test_inputs_and_outputs_do_not_alias',swap("'reportedOptions':copy.deepcopy(reported),\n        'automaticPostprocessingOptions':copy.deepcopy(additions)", "'reportedOptions':reported,\n        'automaticPostprocessingOptions':additions"),'Returned option views must not alias')
    add('reported-catalogue-order-refused','test_engine_catalogue_order_preserves_exact_requested_names_and_values',swap("encoded(sorted(prefix,key=lambda row:row['name']),canonical=True) != encoded(sorted(requested,key=lambda row:row['name']),canonical=True)",'encoded(prefix,canonical=True) != encoded(requested,canonical=True)'), 'Task metadata original requested options differ','diagnostic_refusal')
    if {row[1] for row in cases} != census:
        raise ValueError('New observation tests lack targeted controls')
    outcomes = []
    def execute(label, test=None):
        cwd = out/(label+'-cwd');cwd.mkdir(mode=0o700)
        args = [sys.executable, '-B', str(tests)]+(['Checks.'+test] if test else [])
        result = subprocess.run(args, cwd=cwd, capture_output=True, timeout=15, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'})
        output = (result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output)
        return result.returncode, output
    def positive(label, payload):
        source.write_bytes(payload);code, output = execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in output: raise AssertionError(label+': baseline failed\n'+output)
        outcomes.append({'control': label, 'outcome': 'survived'})
    try:
        positive('baseline', original)
        positive('harmless-comment', original+b'\n# Harmless original-observation control.\n')
        positive('restored-after-harmless', original)
        for label, test, transform, reason, kind in cases:
            try:
                changed = transform(text);ast.parse(changed);source.write_text(changed)
                code, output = execute(label, test)
                if code == 0 or ('FAIL: '+test not in output and 'ERROR: '+test not in output): raise AssertionError(label+': target did not fail')
                lines = output.splitlines();starts = [i for i, line in enumerate(lines) if re.match(r'^[A-Za-z_][\w.]*Error:', line)]
                diagnostic = ''
                if starts:
                    end = next((i for i in range(starts[-1]+1, len(lines)) if lines[i].startswith('-----')), len(lines))
                    diagnostic = '\n'.join(lines[starts[-1]:end])
                if reason not in diagnostic: raise AssertionError(label+': wrong diagnostic '+repr(diagnostic))
                outcomes.append({'control': label, 'test': test, 'kind': kind, 'outcome': 'intended_failure', 'reason': reason})
            finally: source.write_bytes(original)
        positive('restored-final', original)
        if source.read_bytes() != original or tests.read_bytes() != test_bytes: raise AssertionError('Observation source and tests changed')
        (out/'controls.json').write_text(json.dumps(outcomes, indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)): hashlib.sha256(path.read_bytes()).hexdigest() for path in (source, tests)}, indent=2)+'\n')
        print(json.dumps({'controls': len(outcomes), 'positive': 4, 'broken': len(cases), 'testsCovered': len(census)}))
    finally:
        source.write_bytes(original)
        with source.open('rb') as stream: os.fsync(stream.fileno())


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True);parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args();run(args.repo.resolve(), args.out.absolute())
