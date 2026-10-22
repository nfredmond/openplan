"""Challenge original worker coordination, restoring source bytes in finally."""
import argparse,ast,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True)
    folder=repo/'workers/odm_worker';source=folder/'runtime_worker_coordinator.py';tests=folder/'test_runtime_worker_coordinator.py'
    original={p:p.read_bytes() for p in (source,tests)}
    helper=load(repo/'docs/reviews/2026-10-14-artifact-access/verify_controls.py','access_controls')
    oracle=load(repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py','retention_oracle')
    census={n.name for n in ast.walk(ast.parse(original[tests])) if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')}
    cases=[]
    def add(label,test,transform,reason):cases.append((label,'test_'+test,transform,reason))
    def changed(a,b):return lambda t:helper.swap(t,a,b)
    def omitted(message):return lambda t:helper.disable(t,message)
    add('terminal-ack-dropped','completed_original_keeps_engine_facts_and_exact_delivery',changed("'state':delivered['state']","'state':'processing_pending'"),'Original completed task reaches its exact terminal delivery')
    add('saved-terminal-rebuilds','saved_terminal_replay_never_reobserves_or_rebuilds',changed("original_hash=command['binding']['observationSha256']","original_hash=command['binding']['observationSha256']\n                self.plan.advance(request,original_hash)"),'Saved terminal cannot rebuild products')
    add('local-error-relabels-engine','local_product_failure_does_not_invent_engine_failure',changed("'reportedStatusCode':observed['reportedStatusCode']","'reportedStatusCode':30"),'Product failure cannot turn reported40 into30')
    add('local-error-leaks-message','local_product_failure_does_not_invent_engine_failure',changed("'errorType':type(error).__name__","'errorType':str(error)"),'Private error messages never enter durable stage records')
    add('failure-replay-replaces-record','local_failure_replay_keeps_original_record_inode',changed('self.dispatch._check(request,deadline);publish(root,name,raw)',"self.dispatch._check(request,deadline)\n            if (root/name).exists():(root/name).rename(root/(name+'.superseded'))\n            publish(root,name,raw)"),'Local failure replay cannot replace its original record')
    add('original-lease-renewed','existing_lease_is_not_renewed_from_new_clock',changed('self.access.resume(request,observation_hash)',"self.access.prepare(request,observation_hash,public_base_url=self.base,expires_at=self.clock()+self.lease_seconds)"),'Changing clock cannot prevent original lease recovery')
    add('failed-task-prepares-products','reported_engine_failure_skips_product_and_lease_stages',changed("if status=='succeeded':","if status in ('succeeded','failed'):"),'Reported failure cannot prepare products')
    add('different-terminal-observation-accepted','changed_terminal_observation_refuses_new_delivery',omitted('Worker coordination cannot replace terminal observation'),'Changed terminal observation remains a local refusal')
    add('coordinator-unbounded','constructor_refuses_foreign_graph_and_invalid_bounds',omitted('Worker coordination needs finite positive bounds'),'ValueError not raised')
    add('failure-engine-projection-unchecked','failure_record_cannot_substitute_reported_engine_facts',omitted('Worker coordination local failure must retain original reported facts'),'ValueError not raised')
    add('uncertain-terminal-reobserves','interrupted_terminal_delivery_replays_original_body',changed("original_hash=command['binding']['observationSha256']","original_hash=command['binding']['observationSha256']\n                self.observer.observe(request)"),'Uncertain terminal cannot reobserve engine')
    add('running-task-invents-terminal','processing_observation_stays_pending_without_products_or_callback',changed("'state':'processing_pending'","'state':'acknowledged'"),'Running original task remains pending')
    add('current-refusal-invents-ack','revoked_current_terminal_actor_preserves_original_completed_fact',changed("'state':'local_stage_failed'","'state':'acknowledged'"),'Current authority refusal stays local')
    add('old-failure-blocks-recovery','product_failure_can_recover_without_replacing_its_record',changed("self.dispatch._check(request,deadline)\n        stage=", "self.dispatch._check(request,deadline)\n        if list(self.dispatch.runtime.root.glob('local-stage-failures-*/*.json')):return {'state':'local_stage_failed'}\n        stage="),'Local product recovery can finish original terminal delivery')
    add('foreign-adapter-graph-accepted','foreign_observer_graph_refuses_before_coordinator_use',omitted('Worker coordination needs one original adapter graph'),'ValueError not raised')
    for label,test,reason in (
        ('precommand-reobserves','precommand_context_recovers_original_selection_without_engine_get','Precommand context cannot reobserve engine'),
        ('intake-reobserves','earliest_intake_plan_recovers_without_reobserving','Saved intake cannot reobserve engine'),
        ('partial-manifest-reobserves','partial_manifest_completes_original_receipt_without_new_observation','Partial manifest cannot reobserve engine'),
        ('partial-lease-reobserves','partial_lease_completes_original_receipt_without_renewal','Partial lease cannot reobserve engine')):
        add(label,test,changed('selected=self._selection(request,deadline)','selected=None'),reason)
    add('initial-task-not-observed','initial_completed_observation_prepares_new_lease_and_delivery',changed("if observation_hash is None:observation_hash=self.observer.observe(request)['task']['bodySha256']","if observation_hash is None:observation_hash='a'*64"),'Unselected original task uses one actual supplied engine observation')
    add('selection-conflict-ignored','conflicting_saved_selections_refuse_before_new_observation',omitted('Worker coordination saved observation selections conflict'),'ValueError not raised')
    add('intake-limits-unchecked','changed_intake_limits_refuse_selection',omitted('Worker coordination original intake selection limits differ'),'ValueError not raised')
    add('terminal-selection-shape-unchecked','noncanonical_terminal_selection_shape_refuses',omitted('Worker coordination terminal selection differs'),'ValueError not raised')
    add('saved-selection-hash-unchecked','invalid_saved_selection_hash_refuses',omitted('Worker coordination saved observation hash differs'),'saved observation selections conflict')
    add('output-selection-scope-unchecked','foreign_output_engine_plan_refuses_selection',omitted('Worker coordination saved output selection identity differs'),'original intake selection limits differ')
    add('artifact-selection-scope-unchecked','foreign_artifact_binding_refuses_selection',omitted('Worker coordination saved artifact selection identity differs'),'ValueError not raised')
    add('saved-selection-replaced','explicit_new_hash_cannot_replace_saved_stage_selection',omitted('Worker coordination cannot replace saved observation'),'Explicit changed hash cannot replace saved original selection')
    add('nonfinite-clock-forwarded','nonfinite_clock_refuses_before_new_lease_preparation',omitted('Worker coordination clock must be finite'),'Nonfinite clock cannot reach lease preparation')
    for label,test in [('output-selection-failure-allowed','output_selection_cannot_bind_reported_failure'),('output-selection-running-allowed','output_selection_cannot_bind_running_task')]:
        add(label,test,omitted('Worker coordination output selection requires reported completion'),'ValueError not raised')
    add('terminal-selection-running-allowed','terminal_context_cannot_bind_running_task',omitted('Worker coordination terminal selection requires reported terminal state'),'ValueError not raised')
    add('orphan-selector-ignored','orphan_intake_receipt_refuses_before_engine_get',omitted('Worker coordination stage records require their original selection'),'Orphan stage cannot reobserve engine')
    add('harmless-publication-marker-refused','harmless_partial_and_lock_without_plan_allow_initial_observation',changed("p.name!='writer.lock' and not re.fullmatch(r'\\.partial-[0-9a-f]{32}',p.name)","p.name!='writer.lock'"),'Harmless interrupted publication can finish its initial task')
    add('isolated-derived-plan-accepted','isolated_inspection_plan_needs_upstream_selection',omitted('Worker coordination derived records require original observation selection'),'ValueError not raised')
    add('unknown-partial-ignored','unknown_partial_marker_refuses_before_engine_get',omitted('Worker coordination stage records require their original selection'),'ValueError not raised')
    if {test for _,test,_,_ in cases}!=census:raise ValueError('Every coordinator test needs a targeted fault')
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
        positive('baseline');source.write_bytes(original[source]+b'\n# Harmless original coordination note.\n');positive('harmless');restore();positive('restored-after-harmless')
        for label,target,transform,reason in cases:
            try:
                text=transform(original[source].decode());ast.parse(text);source.write_text(text)
                code,log=execute(label,target)
                assert oracle.intended_failure(code,log,target,reason),label+' target/diagnostic differs\n'+log
                if oracles is None:oracles=helper.challenge_oracle(oracle,code,log,target,reason)
                results.append({'control':label,'test':target,'outcome':'intended_failure','reason':reason});print(label+' intended failure',flush=True)
            finally:restore()
        positive('restored-final');assert all(p.read_bytes()==raw for p,raw in original.items()),'Coordinator sources restore exactly'
        (out/'controls.json').write_text(json.dumps(results,indent=2)+'\n');(out/'oracle-controls.json').write_text(json.dumps(oracles,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(raw).hexdigest() for p,raw in original.items()},indent=2)+'\n')
        print({'tests':len(census),'faults':len(cases),'positive':4},flush=True)
    finally:restore()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);args=parser.parse_args();run(args.repo.resolve(),args.out.resolve())
