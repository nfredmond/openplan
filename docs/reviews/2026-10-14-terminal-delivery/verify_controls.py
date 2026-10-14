"""Challenge original terminal journals, then restore exact source bytes."""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True)
    helper=load('artifact_tools',repo/'docs/reviews/2026-10-14-artifact-access/verify_controls.py')
    oracle=load('retention_oracle',repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py')
    folder=repo/'workers/odm_worker'
    sources={'terminal':folder/'runtime_terminal_delivery.py','journal':folder/'runtime_progress_delivery.py','http':folder/'progress_http.py'}
    original={p:p.read_bytes() for p in sources.values()};cases=[]
    tests={'terminal':folder/'test_runtime_terminal_delivery.py','http':folder/'test_terminal_http.py'}
    def add(kind,name,test,transform,reason='ValueError not raised',suite='terminal'):
        cases.append((kind,name,'test_'+test,transform,reason,suite))
    def change(a,b):return lambda t:helper.swap(t,a,b)
    def omit(message):return lambda t:helper.disable(t,message)
    add('terminal','command-format-progress','exact_terminal_body_scope_and_separate_records',change("return {'format':FORMAT,'binding':", "return {'format':'openplan.odm-progress-delivery.v1','binding':"),'Terminal command has its separate format')
    add('terminal','new-replay-identity','restart_keeps_original_identity_time_urls_and_body',change("if (root/'command.json').exists() or (root/'command.json').is_symlink():","if False:"),'Replay cannot invent terminal identity')
    add('journal','unknown-body-reencoded','uncertain_send_retries_same_bytes',change("command['bodyText'].encode('utf-8'), deadline,","(command['bodyText'].encode('utf-8')+b' ' if index else command['bodyText'].encode('utf-8')), deadline,"),'Uncertain replay cannot change terminal bytes')
    add('journal','ack-posted-again','acknowledged_replay_does_not_post_again',change("if state != 'retry_pending':",'if False:'),'Saved terminal acknowledgement prevents another POST')
    add('terminal','expired-replay-blocked','expired_lease_keeps_saved_command_and_ack_replay',change('if live:self.access._live(lease)','self.access._live(lease)'),'original lease expired')
    add('terminal','expired-first-accepted','expired_lease_refuses_first_preparation',change('if live:self.access._live(lease)','if False:self.access._live(lease)'),'PermissionError not raised')
    for status,code in [('failed',30),('canceled',50)]:
        add('terminal',status+'-misreported',status+'_observation_needs_no_success_lease',change("'"+status+"':("+str(code)+",'"+('failed' if code==30 else 'canceled')+"')", "'"+status+"':(20,'running')"),'no reported terminal observation')
    add('terminal','running-accepted','running_observation_refuses_terminal_preparation',change("if status is None:raise ValueError('Terminal delivery has no reported terminal observation')","if status is None:status='failed'"),'differs from original reported engine state')
    add('terminal','status-substituted','wrong_reported_status_refuses',omit('Terminal delivery differs from original reported engine state'))
    add('terminal','url-substituted','changed_artifact_url_refuses',omit('Terminal delivery artifact projection differs from original lease'))
    add('terminal','command-replaced','changed_callback_identity_cannot_replace_saved_command',change("            publish(root,'command.json',json_bytes(command))","            (root/'command.json').unlink(missing_ok=True)\n            publish(root,'command.json',json_bytes(command))"))
    add('terminal','revoked-prepare-accepted','revoked_actor_refuses_before_preparation',omit('Terminal delivery current original actor refused'),'PermissionError not raised')
    add('terminal','ignored-acknowledged','ignored_receiver_is_not_applied_completion',change("return 'receiver_ignored' if body['ignored'] in ('terminal','superseded') else 'retry_pending'","return 'acknowledged'"),'Ignored callback is not completion acknowledgement')
    add('terminal','wrong-status-acknowledged','wrong_receiver_status_remains_retry_pending',change("if command is not None and body.get('status')==command['status']:","if command is not None:"),'Other receiver status cannot acknowledge terminal completion')
    add('terminal','event-substituted','another_event_key_refuses',omit('Terminal delivery has one original event key'))
    add('terminal','lost-command-recreated','lost_command_with_attempt_refuses_recreation',omit('Terminal delivery records require their original command'))
    for name in ('lost_context_refuses_saved_replay','changed_context_refuses_observation_substitution'):
        add('terminal',name,name,change("observation_hash=context['observationSha256']","observation_hash=next(iter((self.observer.reader.dispatch.runtime.root/'task-observations').glob('*.json')))).stem"),'PLACEHOLDER')
    add('terminal','malformed-ignored-permanent','malformed_ignored_reply_remains_retry_pending',change("return 'receiver_ignored' if body['ignored'] in ('terminal','superseded') else 'retry_pending'","return 'receiver_ignored'"),'Malformed ignored reply cannot stop original replay')
    add('terminal','transport-bound-ignored','first_preparation_refuses_transport_too_small',omit('Terminal delivery body exceeds its actual transport allowance'))
    add('terminal','partial-not-recovered','known_partial_metadata_recovers_before_first_command',change('            clear_unpublished(root)','            pass'),'records require their original command')
    add('terminal','lease-receipt-ignored','lease_change_refuses_saved_terminal_replay',omit('Terminal delivery original artifact lease receipt differs'),'artifact projection differs from original lease')
    add('journal','reply-format-ignored','saved_reply_from_progress_namespace_refuses',change("reply['format'] != cls.record_format",'False'))
    add('journal','intent-format-progress','saved_intent_from_progress_namespace_refuses',change("if json_bytes(intent) != json_bytes({'format': self.record_format", "if json_bytes(intent) != json_bytes({'format': 'openplan.odm-progress-delivery.v1'"),'ValueError not raised')
    add('journal','post-intent-access-omitted','revocation_after_intent_prevents_post',change('            self._access(request_id, deadline)\n            status, body =','            status, body ='),'Current access after intent precedes terminal POST')
    add('journal','post-reply-access-omitted','revocation_after_reply_keeps_receiver_fact',change('            self._access(request_id, deadline)\n            return {\'state\': self._result(reply, command)',"            return {'state': self._result(reply, command)"),'PermissionError not raised')
    add('terminal','interrupted-command-recreated','interrupted_command_recovers_exact_body',change("if (root/'command.json').exists() or (root/'command.json').is_symlink():",'if False:'),'Recovery cannot create callback identity')
    add('terminal','history-asks-current-permission','ignored_receipt_remains_historical_after_current_authority_refuses',change('            command_hash=checksum(json_bytes(command))','            self._authorize(command,deadline)\n            command_hash=checksum(json_bytes(command))'),'current original actor refused')
    add('terminal','history-owner-bypassed','historical_receipt_requires_original_ownership',change('        self._check(request_id,deadline)\n        root=self.folder(request_id,EVENT)','        self.reader.dispatch.runtime._owned=True\n        self._check(request_id,deadline)\n        root=self.folder(request_id,EVENT)'),'ValueError not raised')
    add('terminal','history-intent-ignored','historical_receipt_refuses_changed_intent',omit('Terminal historical attempt binding differs'))
    add('terminal','history-orphan-ignored','historical_receipt_refuses_orphan_reply',omit('Terminal historical reply requires its original attempt'))
    add('terminal','history-gap-ignored','historical_receipt_refuses_attempt_gap',omit('Terminal historical attempt sequence differs'))
    add('terminal','history-current-expiry-applied','historical_receipt_does_not_publish_attempt_or_apply_current_lease_expiry',change('if live:self.access._live(lease)','self.access._live(lease)'),'original lease expired')
    add('http','large-body-child-lowered','explicit_large_body_reaches_original_endpoint_exactly',change("'maxBodyBytes': self.max_body","'maxBodyBytes': BODY_LIMIT"),'Progress HTTP child did not complete',suite='http')
    add('http','default-bound-raised','default_body_bound_remains_progress_limit',change('max_body_bytes=BODY_LIMIT','max_body_bytes=MAX_BODY_LIMIT'),suite='http')
    add('http','constructor-bound-ignored','invalid_body_allowance_refuses_constructor',change('        if type(max_body_bytes) is not int or not 1 <= max_body_bytes <= MAX_BODY_LIMIT:','        if False:'),suite='http')
    add('http','child-body-unbounded','child_body_bound_refuses_before_dns',omit('Progress HTTP child body exceeds its allowance'),'Invalid child body must precede DNS',suite='http')
    add('http','child-bound-ignored','child_allowance_refuses_before_dns',change('    if type(bound) is not int or not 1 <= bound <= MAX_BODY_LIMIT:','    if False:'),'Invalid child body must precede DNS',suite='http')
    add('terminal','history-current-allowance-applied','historical_and_cached_ack_survive_smaller_current_transport',change('        value=parse(raw,BODY_LIMIT)','        self._transport_bound(raw)\n        value=parse(raw,BODY_LIMIT)'),'actual transport allowance')
    add('journal','new-post-bound-omitted','new_post_refuses_smaller_current_transport_before_intent',change('            self._before_transport(command, deadline)','            pass'))
    add('terminal','large-history-current-allowance-applied','large_original_body_remains_readable_with_progress_size_transport',change('        value=parse(raw,BODY_LIMIT)','        self._transport_bound(raw)\n        value=parse(raw,BODY_LIMIT)'),'actual transport allowance')
    # Resolve the original observation through the validated original engine plan.
    for index,case in enumerate(cases):
        if case[4]=='PLACEHOLDER':
            kind,name,test,_transform,_reason,suite=case
            before="context=read_json(root,'context.json')"
            after="context={'observationSha256':next(p.stem for p in (self.observer._original(request_id,deadline)[0]/'task-observations').glob('*.json') if p.name!='plan.json')}"
            cases[index]=(kind,name,test,change(before,after),'FileNotFoundError not raised',suite)
    for suite,path in tests.items():
        census={n.name for n in ast.walk(ast.parse(path.read_bytes())) if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')}
        if {c[2] for c in cases if c[5]==suite}!=census:raise ValueError('Every terminal test requires targeted fault: '+suite+' missing='+str(census-{c[2] for c in cases if c[5]==suite})+' extra='+str({c[2] for c in cases if c[5]==suite}-census))
    results=[];oracles=None
    def restore():
        for p,raw in original.items():p.write_bytes(raw)
    def execute(label,suite=None,target=None):
        selected=[tests[suite]] if suite else list(tests.values());output='';code=0
        for p in selected:
            proc=subprocess.run([sys.executable,'-B',str(p)]+(['Checks.'+target] if target else []),cwd=folder,capture_output=True,text=True,timeout=90,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
            code=max(code,proc.returncode);output+=proc.stdout+proc.stderr
        (out/(label+'.log')).write_text(output);return code,output
    def positive(label):
        code,log=execute(label)
        assert code==0 and 'Ran 37 tests' in log and 'Ran 5 tests' in log,'Complete terminal cohort: '+label+'\n'+log
        results.append({'control':label,'outcome':'survived','cases':42});print(label+' survived',flush=True)
    try:
        positive('baseline')
        for p in sources.values():p.write_bytes(original[p]+b'\n# Harmless original terminal journal note.\n')
        positive('harmless');restore();positive('restored-after-harmless')
        for kind,label,target,transform,reason,suite in cases:
            try:
                p=sources[kind];t=transform(original[p].decode());ast.parse(t);p.write_text(t)
                code,log=execute(label,suite,target)
                assert oracle.intended_failure(code,log,target,reason),'Terminal fault diagnostic must match: '+label+'\n'+log
                if oracles is None:oracles=helper.challenge_oracle(oracle,code,log,target,reason)
                results.append({'control':label,'test':target,'outcome':'intended_failure','reason':reason});print(label+' intended failure',flush=True)
            finally:restore()
        positive('restored-final')
        (out/'controls.json').write_text(json.dumps(results,indent=2)+'\n');(out/'oracle-controls.json').write_text(json.dumps(oracles,indent=2)+'\n');(out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(raw).hexdigest() for p,raw in original.items()},indent=2)+'\n')
    finally:restore()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
