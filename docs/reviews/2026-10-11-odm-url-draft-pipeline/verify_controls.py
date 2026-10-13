"""Original URL-to-draft composition controls with exact source restoration."""
import argparse,ast,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700)
    helper_path=repo/'docs/reviews/2026-10-11-odm-url-transport/verify_controls.py'
    spec=importlib.util.spec_from_file_location('url_draft_control_helper',helper_path)
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    names={'pipeline':'runtime_url_draft','draft':'runtime_draft','intake':'runtime_url_intake'}
    paths={key:repo/'workers/odm_worker'/(''+name+'.py') for key,name in names.items()};originals={key:path.read_bytes() for key,path in paths.items()}
    tests=paths['pipeline'].with_name('test_runtime_url_draft.py');test_bytes=tests.read_bytes()
    census={node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    cases=[]
    def add(label,test,transform,reason,source='pipeline',kind='broken_behavior'):cases.append((label,'test_'+test,transform,reason,source,kind))
    swap=lambda before,after:lambda text:helper.replace(text,before,after)
    guard=lambda message:lambda text:helper.disable(text,message)
    def resupply(text):
        return helper.replace(text,"self.intake._settings(original,saved['settings'])","self.intake._settings(original,self.intake.supply(original))")
    add('authority-promoted','owned_queue_advances_one_original_init_and_keeps_start_held',swap("'authorityVerification':'unassessed'","'authorityVerification':'accepted'"),'URL draft cannot promote supplied authority')
    add('commit-permission-promoted','owned_queue_advances_one_original_init_and_keeps_start_held',swap("'commitPermission':False","'commitPermission':True"),'URL draft cannot grant processing commit')
    add('reported-task-changed','owned_queue_advances_one_original_init_and_keeps_start_held',swap("'taskUuid':effects.plan['taskUuid']","'taskUuid':'12345678-1234-4234-8234-123456789abc'"),'Reported draft task must be original','draft')
    add('saved-inputs-resupplied','original_settings_bytes_and_order_survive_changed_supplier',resupply,'Draft preparation called changed supplier')
    add('engine-identity-changed','original_settings_bytes_and_order_survive_changed_supplier',swap('self.transport(engine,command,stream,min(deadline,given_deadline))',"self.transport({**engine,'instanceId':'changed'},command,stream,min(deadline,given_deadline))"),'Original engine settings must reach transport')
    add('command-order-reversed','original_settings_bytes_and_order_survive_changed_supplier',swap("pending=next((row['operation'] for row in snapshot['commands'] if row['state']=='unissued'),None)","pending=next((row['operation'] for row in reversed(snapshot['commands']) if row['state']=='unissued'),None)"),'Original command order must remain','draft')
    add('commit-hold-omitted','original_settings_bytes_and_order_survive_changed_supplier',swap("if pending is None or pending=='commit':","if pending is None:"),'URL pipeline must not send a processing commit','draft')
    add('permission-guard-omitted','denied_permission_cannot_issue_intent_or_send',guard('Explicit draft permission was not confirmed'),('PermissionError not raised','Denied URL draft cannot issue intent'),'draft')
    add('uncertain-hold-omitted','lost_reply_keeps_intent_and_prevents_reissue_or_later_upload',swap("if any(row['state']=='unresolved' for row in snapshot['commands']):",'if False:'),'Uncertain URL draft requested another permission','draft')
    add('restored-inputs-resupplied','relocated_runtime_advances_original_upload_without_download_root',resupply,'Restored draft resupplied')
    add('partial-inputs-resupplied','partial_intake_finishes_only_missing_source_before_first_command',resupply,'Partial draft resupplied settings')
    add('invalid-adapters','invalid_constructor_adapters_and_deadline',guard('Original URL intake and explicit draft adapters are required'),'ValueError not raised')
    add('invalid-deadline','invalid_constructor_adapters_and_deadline',guard('URL draft deadline must be positive and finite'),'ValueError not raised')
    add('owner-marker-spoofed','original_owner_and_pre_cancelled_signal_refuse_before_intake',swap('deadline=time.monotonic()+self.timeout;self.intake._check(request_id,deadline)','deadline=time.monotonic()+self.timeout;self.intake.runtime._owned=True;self.intake._check(request_id,deadline)'),'ValueError not raised')
    add('job-identity-bridge-skipped','pipeline_job_identity_refuses_before_fetch_or_permission',swap("else:intake(job);prepared=job['url_intake']","else:prepared=intake.resume(request_id)"),'ValueError not raised')
    add('input-admission-guard-omitted','saved_input_adapter_requires_original_admission',guard('Original URL draft preparation admission differs'),'Changed admission read saved draft inputs')
    add('saved-plan-extra-fields','saved_settings_shape_and_version_refuse_before_validation',swap(" or set(saved)!={'format','binding','settings'}",''),'Malformed draft settings reached validation')
    add('saved-plan-version','saved_settings_shape_and_version_refuse_before_validation',swap(" or saved['format']!=INTAKE",''),'Malformed draft settings reached validation')
    add('saved-binding-guard-omitted','saved_settings_original_binding_refuses_before_mapping',guard('Original URL draft settings binding differs'),'Changed draft binding reached mapping')
    add('saved-mapping-validation-skipped','saved_mapping_settings_hash_refuses',swap("self.intake._mapping(read_json(root,'sources.json'),hashlib.sha256(json_bytes(saved)).hexdigest(),original,settings,context)","read_json(root,'sources.json')['manifest']"),'ValueError not raised')
    add('post-permission-cancellation-skipped','cancellation_in_permission_refuses_before_intent',swap('result=self.authorize(plan,operation,command,**forwarded)\n            self.intake._check(request_id,deadline);return result','result=self.authorize(plan,operation,command,**forwarded)\n            return result'),'Cancelled permission cannot issue an intent')
    add('post-transport-cancellation-skipped','cancellation_during_transport_leaves_original_intent_unresolved',swap('result=self.transport(engine,command,stream,min(deadline,given_deadline))\n            self.intake._check(request_id,deadline);return result','result=self.transport(engine,command,stream,min(deadline,given_deadline))\n            return result'),'Cancelled transport cannot save a reply')
    add('source-budget-extended','source_stage_shares_total_deadline_without_mutating_original_adapter',swap('min(self.intake.timeout,deadline-time.monotonic())','self.intake.timeout'),'Intake cannot receive more than the whole pipeline deadline')
    add('transport-budget-extended','source_stage_shares_total_deadline_without_mutating_original_adapter',swap('min(deadline,given_deadline)','given_deadline'),'Engine transport cannot extend the pipeline deadline')
    add('permission-expiry-intent-check','expired_permission_cannot_issue_intent',swap('result=self.authorize(plan,operation,command,**forwarded)\n            self.intake._check(request_id,deadline);return result','result=self.authorize(plan,operation,command,**forwarded)\n            return result'),'Expired URL draft cannot issue an intent')
    add('cloned-cancellation-stale','cancellation_changed_during_source_write_reaches_cloned_stage',swap('cancelled=lambda:self.intake.cancelled()','cancelled=self.intake.cancelled'),'Cloned intake must see the current cancellation signal')
    add('late-draft-cancellation-skipped','late_draft_cancellation_cannot_report_success',swap('result=draft.advance(request_id);self.intake._check(request_id,deadline)','result=draft.advance(request_id)'),'InterruptedError not raised')
    add('mapping-cancellation-skipped','saved_mapping_cancellation_cannot_return_inputs',swap("        self.intake._check(original.request['requestId'],deadline)\n        return",'        return'),'InterruptedError not raised')
    add('current-authorization-deadline-omitted','current_authorization_shares_the_outer_deadline',swap("forwarded = {'deadline': min(deadline,options['deadline'])} if self.authorize_with_deadline else {}","forwarded = {}"),'Current authorization must receive the actual shared URL deadline')
    add('current-authorization-selection-dropped','current_authorization_shares_the_outer_deadline',swap('authorize_with_deadline=self.authorize_with_deadline','authorize_with_deadline=False'),"KeyError: 'deadline'",kind='diagnostic_refusal')
    add('authorization-selection-unchecked','authorization_deadline_selection_requires_boolean',guard('URL draft authorization deadline selection must be boolean'),'ValueError not raised')
    if {row[1] for row in cases}!=census:raise ValueError('Pipeline tests lack controls: '+repr(census-{row[1] for row in cases}))
    rows=[];oracle=[]
    def restore():
        for key,path in paths.items():path.write_bytes(originals[key])
    def execute(label,test=None):
        result=subprocess.run([sys.executable,'-B',str(tests)]+(['Checks.'+test] if test else []),cwd=repo,capture_output=True,timeout=15,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        output=(result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output);return result.returncode,output
    def positive(label,harmless=False):
        restore()
        if harmless:
            for path in paths.values():path.write_bytes(path.read_bytes()+b'\n# Harmless original pipeline comment.\n')
        code,output=execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in output:raise AssertionError(label+': positive pipeline control failed\n'+output)
        rows.append({'control':label,'outcome':'survived'})
    try:
        positive('baseline');positive('harmless-comments',True);positive('restored-after-harmless')
        for label,test,transform,reason,key,kind in cases:
            try:
                changed=transform(originals[key].decode());ast.parse(changed);paths[key].write_text(changed)
                code,output=execute(label,test)
                try:helper.verify_failure(test,code,output,reason)
                except ValueError:raise AssertionError(label+': wrong pipeline failure\n'+output) from None
                if not oracle and isinstance(reason,str) and kind=='broken_behavior':oracle=helper.oracle_controls(test,code,output,reason)
                rows.append({'control':label,'test':test,'source':key,'kind':kind,'outcome':'intended_failure','reason':reason})
            finally:restore()
        positive('restored-final')
        if tests.read_bytes()!=test_bytes or any(path.read_bytes()!=originals[key] for key,path in paths.items()):raise AssertionError('Pipeline restoration differs')
        for name,value in [('controls',rows),('oracle-controls',oracle),('source-bindings',{str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [*paths.values(),tests,helper_path,Path(__file__)]})]:
            (out/(name+'.json')).write_text(json.dumps(value,indent=2)+'\n')
        print(json.dumps({'tests':len(census),'controls':len(rows),'positive':4,'targeted':len(cases),'oracleControls':len(oracle)}))
    finally:
        restore()
        for path in paths.values():
            with path.open('rb') as stream:os.fsync(stream.fileno())


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.absolute())
