"""Bounded actual runtime-draft controls with exact source restoration."""
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
    paths = {'library':repo/'workers/odm_worker/runtime_draft.py', 'effects':repo/'workers/odm_worker/engine_effects.py', 'preparation':repo/'workers/odm_worker/runtime_preparation.py'}
    originals = {key:path.read_bytes() for key,path in paths.items()}
    tests=repo/'workers/odm_worker/test_runtime_draft.py';test_bytes=tests.read_bytes()
    census={node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    cases=[]
    def add(label,test,transform,reason,source='library',kind='broken_behavior'):cases.append((label,test,transform,reason,source,kind))
    def swap(before,after):return lambda value:replace(value,before,after)
    def disable(message):return lambda value:guard(value,message)
    add('pipeline-skips-draft','test_actual_runtime_initializes_one_original_task_and_holds_next_job',swap("        result=self.advance(job['request']['requestId'])","        result={}"),'owned pipeline must send exactly one initial command',source='library',kind='broken_behavior')
    add('image-not-rewound','test_original_order_upload_bytes_and_exact_replies_before_commit_hold',swap('                    stream.seek(0)','                    pass # original stream not rewound'),'transport must read exact original image slots',source='library',kind='broken_behavior')
    add('commit-guard-removed','test_original_order_upload_bytes_and_exact_replies_before_commit_hold',swap("            if pending is None or pending=='commit':return self._result(effects,'draft_complete_commit_held')","            if pending is None:return self._result(effects,'draft_complete_commit_held')"),'Unexpected commit reached transport',source='library',kind='broken_behavior')
    add('implicit-permission','test_permission_requires_exact_true_before_intent_or_transport',swap('            if self.authorize(copy.deepcopy(effects.plan),pending,copy.deepcopy(command),**options) is not True:','            if False:'),'denied permission cannot issue original intent',source='library',kind='broken_behavior')
    add('gate-plan-alias','test_adapters_receive_detached_original_plan_and_command',swap('self.authorize(copy.deepcopy(effects.plan),pending,copy.deepcopy(command),**options)','self.authorize(effects.plan,pending,copy.deepcopy(command),**options)'),'Saved engine plan differs from original identity',source='library',kind='broken_behavior')
    add('gate-command-alias','test_adapters_receive_detached_original_plan_and_command',swap('self.authorize(copy.deepcopy(effects.plan),pending,copy.deepcopy(command),**options)','self.authorize(copy.deepcopy(effects.plan),pending,command,**options)'),'adapter cannot replace original durable command',source='library',kind='broken_behavior')
    add('unresolved-prefix-skipped','test_lost_acknowledgment_holds_without_second_transport_or_later_issue',swap("            if any(row['state']=='unresolved' for row in snapshot['commands']):",'            if False:'),'Uncertain effect attempted another transport',source='library',kind='broken_behavior')
    add('response-shape-ignored','test_invalid_response_preserves_unresolved_intent',disable('Exact draft transport status and body are required'),'Invalid transport response reached reply journal',source='library',kind='broken_behavior')
    add('reply-acknowledgment-check-omitted','test_invalid_engine_reply_is_not_an_acknowledgment',disable('Engine reply does not establish original command acknowledgment'),'ValueError not raised',source='effects',kind='broken_behavior')
    add('out-of-order-prefix-ignored','test_out_of_order_acknowledged_upload_refuses_transport',swap("                elif pending_seen:raise ValueError('Original draft command order differs')",'                elif pending_seen:pass'),'Out-of-order journal reached transport',source='library',kind='broken_behavior')
    add('prior-commit-scope-lost','test_existing_commit_intent_holds_without_draft_transport',swap("            if snapshot['commands'][-1]['state']!='unissued':",'            if False:'),'prior commit requires separate processing reconciliation',source='library',kind='state_distinction')
    add('implicit-adapters','test_constructor_requires_explicit_adapters_and_finite_timeout',disable('Original preparation and explicit draft adapters are required'),'ValueError not raised',source='library',kind='broken_behavior')
    add('invalid-timeout','test_constructor_requires_explicit_adapters_and_finite_timeout',disable('Runtime draft timeout must be positive and finite'),'ValueError not raised',source='library',kind='broken_behavior')
    add('installation-check-skipped','test_changed_seal_refuses_before_permission_adapter',swap('        self.runtime._check()','        pass # installation check skipped'),'Changed installation reached permission adapter',source='preparation',kind='broken_behavior')
    add('existing-first-flag-ignored','test_existing_issue_flag_never_reaches_transport',swap("            if first is not True:return self._result(effects,'held_uncertain',pending)",'            if False:return {}'),'Existing issue flag reached transport',source='library',kind='broken_behavior')
    add('intent-not-durable-before-transport','test_durable_intent_precedes_transport_and_reply_precedes_next_command',swap('            intent,first=effects.issue(pending)',"            intent,first=effects._intent(pending,effects.command_map[pending]),True"),'original intent must precede transport',source='library',kind='broken_behavior')
    add('checked-reply-not-saved','test_durable_intent_precedes_transport_and_reply_precedes_next_command',swap('            effects.save_reply(pending,*response)','            pass # checked reply discarded'),'original checked reply must be saved before advancing',source='library',kind='broken_behavior')
    add('partial-image-acknowledged','test_partial_image_consumption_refuses_acknowledgment',disable('Draft transport did not consume the original image'),'ValueError not raised',source='library',kind='broken_behavior')
    add('changed-image-hash-ignored','test_changed_image_at_transport_boundary_refuses_before_send',disable('Original draft upload hash differs'),'Changed image reached transport',source='library',kind='broken_behavior')
    add('changed-image-size-ignored','test_changed_image_size_at_transport_boundary_refuses_before_send',disable('Original draft upload size differs'),'Changed image size reached source reading',source='library',kind='broken_behavior')
    add('late-response-acknowledged','test_late_transport_reply_remains_unresolved',swap("            if time.monotonic()>=deadline:raise TimeoutError('Runtime draft deadline exceeded')\n            if type(response)","            pass # transport deadline skipped\n            if type(response)"),'TimeoutError not raised',source='library',kind='broken_behavior')
    add('expired-permission-issues','test_expired_permission_does_not_issue_or_send',swap("            if time.monotonic() >= deadline:raise TimeoutError('Runtime draft deadline exceeded')",'            pass # gate deadline skipped'),'Expired permission reached transport',source='library',kind='broken_behavior')
    add('expired-preparation-reaches-engine','test_expired_preparation_does_not_reach_permission',swap("        if remaining <= 0:raise TimeoutError('Runtime draft deadline exceeded')",'        pass # preparation deadline skipped'),'Expired preparation reached engine journal',source='library',kind='broken_behavior')
    add('expired-image-read-sent','test_deadline_during_original_image_read_stops_before_transport',swap("                        if time.monotonic()>=deadline:raise TimeoutError('Runtime draft deadline exceeded')",'                        pass # image deadline skipped'),'Expired image read reached transport',source='library',kind='broken_behavior')
    add('promoted-engineCustodyVerification',"test_original_order_upload_bytes_and_exact_replies_before_commit_hold",swap("'engineCustodyVerification':'unassessed'","'engineCustodyVerification':'accepted'"),'draft cannot promote engineCustodyVerification')
    add('promoted-callbackDeliveryVerification',"test_original_order_upload_bytes_and_exact_replies_before_commit_hold",swap("'callbackDeliveryVerification':'unassessed'","'callbackDeliveryVerification':'accepted'"),'draft cannot promote callbackDeliveryVerification')
    add("commit-permission-promoted","test_original_order_upload_bytes_and_exact_replies_before_commit_hold",swap("'callbackDeliveryVerification':'unassessed','commitPermission':False","'callbackDeliveryVerification':'unassessed','commitPermission':True"),"draft does not permit commit")
    add('selected-authorization-deadline-omitted','test_authorization_receives_actual_shared_deadline_when_selected',swap("options = {'deadline': deadline} if self.authorize_with_deadline else {}","options = {}"),'Authorization must receive the exact draft deadline')
    add('authorization-selection-unchecked','test_authorization_deadline_selection_requires_boolean',disable('Draft authorization deadline selection must be boolean'),'ValueError not raised')
    if {row[1] for row in cases} != census: raise ValueError('New runtime draft tests lack controls')
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
