"""Challenge running progress and historical facts, restoring every source byte."""
import argparse,ast,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def run(repo,out,fault_probes_only=False):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True)
    folder=repo/'workers/odm_worker'
    sources={name:folder/name for name in ['runtime_running_pipeline.py','runtime_progress_delivery.py','runtime_dispatch_custody.py']}
    tests=['test_runtime_running_pipeline','test_progress_historical_receipt','test_dispatch_capture_only']
    original={p:p.read_bytes() for p in [*sources.values(),*(folder/(name+'.py') for name in tests)]}
    helper=load(repo/'docs/reviews/2026-10-14-artifact-access/verify_controls.py','access_controls')
    oracle=load(repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py','retention_oracle')
    census={(name,n.name) for name in tests for n in ast.walk(ast.parse(original[folder/(name+'.py')])) if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')}
    cases=[]
    def add(label,source,module,test,transform,reason):cases.append((label,sources[source],module,'test_'+test,transform,reason))
    def changed(a,b):return lambda s:helper.swap(s,a,b)
    def omitted(message):return lambda s:helper.disable(s,message)
    def bridge(label,test,transform,reason):add(label,'runtime_running_pipeline.py','test_runtime_running_pipeline',test,transform,reason)
    add('initial-temporary-cleanup-omitted','runtime_progress_delivery.py','test_runtime_running_pipeline','initial_publisher_temporary_recovers_before_progress',changed('            clear_unpublished(root)\n',''),'Owned publisher temporary must recover initial progress')
    add('unsafe-temporary-cleared','runtime_progress_delivery.py','test_runtime_running_pipeline','unsafe_publisher_temporaries_hold_before_progress',changed('            clear_unpublished(root)','            for pending in root.glob(".partial-*"):pending.unlink()'),'Unsafe progress temporaries cannot begin work')
    bridge('progress-gate-skipped','initial_running_event_precedes_source_fetch_and_engine_commands',changed('self.inputs.capture_original(request)','return super().advance(request)'),'Exact initial event must precede input fetch')
    bridge('pending-event-authorizes-input','pending_progress_holds_before_any_source_or_engine_work',changed("if delivered['state']!='acknowledged':","if False:"),'Unconfirmed running event remains pending')
    bridge('refused-event-retried','refused_progress_stops_retries_and_computation',changed("if state in ('refused','ignored'):","if False:"),'Historical refusal cannot reenter progress delivery')
    bridge('uncertain-body-rebuilt','lost_reply_replays_exact_body_before_input',changed("if (root/'command.json').exists() or (root/'command.json').is_symlink():","if False:"),'Running retry cannot rebuild event')
    bridge('cached-ack-posted-again','saved_acknowledgement_suppresses_second_progress_post',changed("if state=='acknowledged':","if False:"),'Historical acknowledgement cannot reenter progress delivery')
    bridge('cached-ack-authority-skipped','revoked_actor_after_cached_ack_cannot_start_next_input_step',changed('self.progress._access(request,time.monotonic()+self.progress.timeout)','pass'),'Cached progress cannot advance without current access')
    bridge('terminal-reenters-progress','completed_terminal_replay_skips_active_progress_authority',changed("if terminal.exists() or terminal.is_symlink():return super().advance(request)","if False:return super().advance(request)"),'Terminal replay cannot reenter active progress')
    bridge('foreign-reader-accepted','foreign_progress_reader_refuses_at_constructor',omitted('Running pipeline needs its original progress reader'),'ValueError not raised')
    for label,test in [('accepted-event-allowed','reserved_event_refuses_accepted_projection'),('percentage-event-allowed','reserved_event_refuses_invented_percentage'),('changed-message-allowed','reserved_event_refuses_another_message')]:
        bridge(label,test,omitted('Original running event projection differs'),'Reserved event cannot accept another progress projection')
    bridge('ignored-reply-authorizes','ignored_running_reply_holds_and_never_retries',changed("if body.get('ignored') in ('terminal','superseded'):return 'ignored'","if body.get('ignored') in ('terminal','superseded'):return 'acknowledged'"),'Ignored running event cannot authorize work')
    bridge('wrong-status-authorizes','wrong_status_reply_stays_pending_before_input',changed("body.get('status')=='running'","body.get('status') in ('running','accepted')"),'Wrong running acknowledgement stays pending')
    bridge('missing-status-authorizes','missing_status_reply_stays_pending',changed("body.get('status')=='running'","body.get('status','running')=='running'"),'Missing running acknowledgement stays pending')
    bridge('known-facts-dropped','known_completed_fact_survives_later_progress_refusal',changed("failure=self.coordinator._failure(request,'running_progress',error,reported)","failure=self.coordinator._failure(request,'running_progress',error,None)"),'Progress refusal preserves known original completion')
    def history(label,test,transform,reason):add(label,'runtime_progress_delivery.py','test_progress_historical_receipt',test,transform,reason)
    history('history-current-authority','saved_acknowledgement_is_historical_without_access_or_transport',changed('deadline=time.monotonic()+self.timeout\n        self._check(request_id,deadline)','deadline=time.monotonic()+self.timeout\n        self._access(request_id,deadline)'),'Historical receipt cannot request current permission')
    history('history-permission-promoted','saved_acknowledgement_is_historical_without_access_or_transport',changed("'transportPermission':False","'transportPermission':True"),'Historical receipt grants no transport permission')
    history('history-no-reply-promoted','no_saved_reply_is_explicit',changed("'historicalReceiverOutcome':'no_retained_reply'","'historicalReceiverOutcome':'acknowledged'"),'Missing reply remains distinct from acknowledgement')
    history('history-refusal-promoted','refused_reply_remains_historical_refusal',changed("selected={'historicalReceiverOutcome':state","selected={'historicalReceiverOutcome':'acknowledged'"),'Historical explicit refusal stays refused')
    history('history-ack-attempt-substituted','uncertain_reply_then_ack_keeps_original_sequence',changed("selected={'historicalReceiverOutcome':state,'attempt':index","selected={'historicalReceiverOutcome':state,'attempt':0"),'Historical receipt keeps original acknowledged attempt')
    history('history-orphan-reply-allowed','orphan_reply_without_attempt_refuses',omitted('Progress historical reply requires its original attempt'),'ValueError not raised')
    history('history-attempt-gap-allowed','attempt_sequence_gap_refuses',omitted('Progress historical attempt sequence differs'),'ValueError not raised')
    history('history-intent-binding-allowed','changed_attempt_binding_refuses',omitted('Progress historical attempt binding differs'),'ValueError not raised')
    history('history-reply-not-validated','changed_reply_binding_refuses',changed('self._validate_reply(reply,command_hash,index)','pass'),'ValueError not raised')
    history('history-command-not-validated','foreign_command_without_attempts_refuses',changed('command=self._load(request_id,event_key,root,deadline)',"command=read_json(root,'command.json')"),'ValueError not raised')
    def capture(label,test,transform,reason):add(label,'runtime_dispatch_custody.py','test_dispatch_capture_only',test,transform,reason)
    capture('capture-starts-input','capture_has_no_input_or_engine_effect',changed('        return receipt\n\n    def _advance','        self.pipeline.intake.resume(request_id)\n        return receipt\n\n    def _advance'),'Capture cannot start input fetch')
    capture('capture-requeries-original','equal_replay_never_calls_capture_again',changed('if path.exists() or path.is_symlink(): receipt =','if False: receipt ='),'Saved capture cannot requery dispatch')
    capture('capture-loses-parent-deadline','public_deadline_reaches_capture_transport',changed('deadline=end if deadline is None else min(end,deadline)','deadline=end'),'Public capture preserves supplied earlier deadline')
    capture('capture-ignores-invalid-deadline','invalid_deadline_refuses_before_capture_transport',changed('if deadline is not None:self.dispatch._check(request_id,deadline)','deadline=None'),'Invalid capture deadline cannot reach transport')
    add('history-unowned-read','runtime_dispatch_custody.py','test_progress_historical_receipt','unowned_history_refuses',changed('entry = self.validation._entry(request_id)','entry = self.runtime.journal.get(request_id)'),'ValueError not raised')
    results=[];oracles=None
    def restore():
        for p,raw in original.items():p.write_bytes(raw)
    def execute(label,module=None,test=None):
        target=[module+'.Checks.'+test] if module else tests
        r=subprocess.run([sys.executable,'-B','-m','unittest',*target],cwd=folder,capture_output=True,timeout=90,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        log=(r.stdout+r.stderr).decode(errors='replace');(out/(label+'.log')).write_text(log);return r.returncode,log
    def positive(label):
        code,log=execute(label);assert code==0 and 'Ran '+str(len(census))+' tests' in log,label+' positive succeeds\n'+log
        results.append({'control':label,'outcome':'survived'});print(label+' survived',flush=True)
    try:
        if not fault_probes_only:positive('baseline')
        for p in sources.values():p.write_bytes(original[p]+b'\n# Harmless original running receipt note.\n')
        if not fault_probes_only:positive('harmless')
        restore()
        if not fault_probes_only:positive('restored-after-harmless')
        for label,source,module,test,transform,reason in cases:
            try:
                text=transform(original[source].decode());ast.parse(text);source.write_text(text)
                code,log=execute(label,module,test)
                assert oracle.intended_failure(code,log,test,reason),label+' target/diagnostic differs\n'+log
                if oracles is None:oracles=helper.challenge_oracle(oracle,code,log,test,reason)
                results.append({'control':label,'test':module+'.'+test,'outcome':'intended_failure','reason':reason});print(label+' intended failure',flush=True)
            finally:restore()
        if not fault_probes_only:positive('restored-final')
        assert all(p.read_bytes()==raw for p,raw in original.items()),'Running progress sources restore exactly'
        (out/'controls.json').write_text(json.dumps(results,indent=2)+'\n');(out/'oracle-controls.json').write_text(json.dumps(oracles,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(raw).hexdigest() for p,raw in original.items()},indent=2)+'\n')
        print({'tests':len(census),'faults':len(cases),'positive':0 if fault_probes_only else 4,'faultProbesOnly':fault_probes_only},flush=True)
    finally:restore()


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--fault-probes-only',action='store_true');a=p.parse_args();run(a.repo.resolve(),a.out.resolve(),a.fault_probes_only)
