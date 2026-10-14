"""Challenge original input/commit/delivery composition, restoring source bytes in finally."""
import argparse,ast,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result


def run(repo,out,fault_probes_only=False):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True)
    folder=repo/'workers/odm_worker';source=folder/'runtime_original_pipeline.py';tests=folder/'test_runtime_original_pipeline.py'
    original={p:p.read_bytes() for p in (source,tests)}
    helper=load(repo/'docs/reviews/2026-10-14-artifact-access/verify_controls.py','access_controls')
    oracle=load(repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py','retention_oracle')
    census={n.name for n in ast.walk(ast.parse(original[tests])) if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')}
    cases=[]
    def add(label,test,transform,reason):cases.append((label,'test_'+test,transform,reason))
    def changed(a,b):return lambda t:helper.swap(t,a,b)
    def omitted(message):return lambda t:helper.disable(t,message)
    add('commit-before-drafts','fresh_inputs_commit_products_and_original_callback',changed("if prepared['draft']['state'] not in ('draft_complete_commit_held','held_prior_commit'):","if False:"),'All original uploads precede processing')
    add('uncertain-commit-delivered','uncertain_commit_holds_without_task_read_or_callback',changed("if committed['state']!='commit_reply_retained':","if False:"),'Uncertain commit must stay held')
    add('terminal-replay-inputs','terminal_retry_skips_input_commit_and_engine_reads',changed("stage='commit_replay'","stage='commit_replay';self.inputs.advance(request)"),'Terminal replay cannot reenter inputs')
    add('terminal-replay-recommit','terminal_retry_skips_input_commit_and_engine_reads',changed("stage='commit_replay'","stage='commit_replay';self.commit.advance(request)"),'Terminal replay cannot recommit')
    add('original-commit-scope-unchecked','foreign_commit_journal_root_refuses_before_commit_delegate',omitted('Original pipeline commit and observation plans differ'),'Foreign commit journal root is refused')
    add('missing-commit-ack-ignored','terminal_recovery_requires_saved_acknowledged_commit',omitted('Original terminal recovery requires its acknowledged commit'),'Terminal cannot hide missing original commit acknowledgement')
    add('pending-task-relabeled','running_original_commit_stays_pending',changed("'state':result['state'],'commit':committed","'state':'acknowledged','commit':committed"),'Running engine stays pending')
    add('local-error-relabeled','local_product_error_cannot_set_local_engine_failure',changed("job['state']=result['state']","job['state']='failed'"),'Local product error stays separate')
    add('failed-mapped-success','failed_original_skips_products_and_sets_reported30',changed("30:'failed'","30:'succeeded'"),'Reported30 maps to local failed state')
    add('canceled-mapped-success','canceled_original_sets_reported50',changed("50:'canceled'","50:'succeeded'"),'Reported50 maps to local canceled state')
    add('graph-unchecked','constructor_refuses_different_runtime_or_dispatch',omitted('Original pipeline needs one owned adapter graph'),'ValueError not raised')
    add('job-reference-unchecked','job_identity_is_checked_before_stages',omitted('Original pipeline job identity differs'),'ValueError not raised')
    add('job-request-unchecked','foreign_request_refuses_before_input_transport',omitted('Original pipeline job identity differs'),'ValueError not raised')
    add('owner-unchecked','unowned_pipeline_refuses_before_capture',changed("self._entry(request)\n        stage='inputs'","stage='inputs'\n        return {}"),'ValueError not raised')
    add('queue-start-no-hold','actual_runtime_queue_stays_held_before_completion',changed("job['state']=result['state']","job['state']='succeeded';job['reportedEngineTerminal']={'taskUuid':result['inputs']['draft']['taskUuid'],'statusCode':40}"),'Draft does not release original queue custody')
    add('original-resume-no-outcome','owned_resume_finishes_original_start_without_restarting_admission',changed("if job['state'] in TERMINAL.values():","if False:"),'Completed original is not resumed again')
    add('uncertain-resume-released','uncertain_resume_keeps_queue_held_and_no_terminal_outcome',changed("job['state']=result['state']","job['state']=result['state']\n            if result['state']=='processing_held':job['state']='succeeded';job['reportedEngineTerminal']={'taskUuid':self.coordinator.observer._original(request,__import__('time').monotonic()+4)[1]['taskUuid'],'statusCode':40}"),'Uncertain commit remains an original held start')
    add('resume-unregistered','resume_requires_registered_owned_pipeline',omitted('Original recovery requires the registered pipeline'),'ValueError not raised')
    add('resume-unowned','resume_requires_registered_owned_pipeline',omitted('Original recovery requires its lifetime owner'),'ValueError not raised')
    add('resume-overlap','busy_execution_lock_suppresses_recovery',changed("if not self.runtime._execution.acquire(blocking=False):return False","if False:return False"),'Busy original execution cannot overlap recovery')
    add('unknown-terminal-allowed','unknown_terminal_projection_cannot_release_queue',changed("raise ValueError('Original pipeline acknowledged terminal state differs')",'return'),'ValueError not raised')
    add('job-shape-unchecked','non_job_projection_refuses',changed("raise ValueError('Original pipeline needs its original job request')","return"),'ValueError not raised')
    add('prior-outcome-overwritten','existing_local_outcome_without_engine_facts_holds_before_effects',changed('if self.runtime._outcome(pending) is not None:return False','if False:return False'),'Prior local outcome requires separate bound recovery before effects')
    add('known-terminal-facts-dropped','terminal_recovery_requires_saved_acknowledged_commit',changed('failure=self.coordinator._failure(request,stage,error,reported)','failure=self.coordinator._failure(request,stage,error,None)'),'Missing commit acknowledgement retains known original40')
    results=[];oracles=None
    def restore():
        for p,raw in original.items():p.write_bytes(raw)
    def execute(label,target=None):
        command=[sys.executable,'-B',str(tests)]+(['Checks.'+target] if target else [])
        r=subprocess.run(command,cwd=folder,capture_output=True,timeout=90,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        log=(r.stdout+r.stderr).decode(errors='replace');(out/(label+'.log')).write_text(log);return r.returncode,log
    def positive(label):
        code,log=execute(label)
        assert code==0 and 'Ran '+str(len(census))+' tests' in log,label+' positive succeeds\n'+log
        results.append({'control':label,'outcome':'survived'});print(label+' survived',flush=True)
    try:
        if not fault_probes_only:positive('baseline')
        source.write_bytes(original[source]+b'\n# Harmless original coordination note.\n');
        if not fault_probes_only:positive('harmless')
        restore()
        if not fault_probes_only:positive('restored-after-harmless')
        for label,target,transform,reason in cases:
            try:
                text=transform(original[source].decode());ast.parse(text);source.write_text(text)
                code,log=execute(label,target)
                assert oracle.intended_failure(code,log,target,reason),label+' target/diagnostic differs\n'+log
                if oracles is None:oracles=helper.challenge_oracle(oracle,code,log,target,reason)
                results.append({'control':label,'test':target,'outcome':'intended_failure','reason':reason});print(label+' intended failure',flush=True)
            finally:restore()
        if not fault_probes_only:positive('restored-final')
        assert all(p.read_bytes()==raw for p,raw in original.items()),'Coordinator sources restore exactly'
        (out/'controls.json').write_text(json.dumps(results,indent=2)+'\n');(out/'oracle-controls.json').write_text(json.dumps(oracles,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(raw).hexdigest() for p,raw in original.items()},indent=2)+'\n')
        print({'tests':len(census),'faults':len(cases),'positive':0 if fault_probes_only else 4,'faultProbesOnly':fault_probes_only},flush=True)
    finally:restore()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);parser.add_argument('--fault-probes-only',action='store_true');args=parser.parse_args();run(args.repo.resolve(),args.out.resolve(),args.fault_probes_only)
