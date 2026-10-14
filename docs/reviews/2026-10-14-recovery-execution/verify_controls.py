"""Challenge one-stage original scheduling and restore source/test bytes."""
import argparse,ast,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def run(repo,out):
    os.umask(0o077);out.mkdir(parents=True,mode=0o700)
    folder=repo/'workers/odm_worker';source=folder/'runtime_execution.py';tests=folder/'test_runtime_execution.py'
    originals={p:p.read_bytes() for p in (source,tests)}
    helper=load(repo/'docs/reviews/2026-10-14-artifact-access/verify_controls.py','execution_helpers')
    local=load(repo/'docs/reviews/2026-10-14-outcome-recovery/verify_controls.py','execution_oracle')
    base=load(repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py','execution_base')
    def swap(a,b):return lambda text:helper.swap(text,a,b)
    cases=[]
    def add(label,test,change,reason):cases.append((label,'test_'+test,change,reason))
    add('outcome-priority','outcome_recovery_precedes_every_other_stage',swap('self.recovery.resume_one','self.pipeline.resume_one'),'Outcome repair cannot enter original recovery')
    add('original-priority','original_recovery_precedes_new_admission',swap("('original_recovery_attempted',self.pipeline.resume_one)","('original_recovery_attempted',self.runtime.run_one)"),'Original recovery cannot start another admission')
    add('admission-order','new_admission_follows_both_false_recoveries',swap("('outcome_recovery_attempted',self.recovery.resume_one),\n                ('original_recovery_attempted',self.pipeline.resume_one),\n                ('admission_started',self.runtime.run_one)","('admission_started',self.runtime.run_one),\n                ('outcome_recovery_attempted',self.recovery.resume_one),\n                ('original_recovery_attempted',self.pipeline.resume_one)"),'New admission cannot reorder recovery')
    add('idle-state','idle_requires_three_false_results',swap("'state':'idle'","'state':'admission_started'"),'Idle needs every stage to decline')
    add('nonboolean-result','nonboolean_stage_refuses_before_later_effects',lambda text:helper.disable(text,'Original execution stage must return a boolean'),'Malformed stage cannot advance original recovery')
    add('owner-read','unowned_step_refuses_before_recovery',lambda text:helper.disable(text,'Original execution requires its lifetime owner'),'Unowned step cannot read recovery')
    add('post-stage-owner','owner_loss_after_stage_refuses_before_next_stage',swap('attempted=operation()\n            self._check()','attempted=operation()\n            pass'),'ValueError not raised')
    add('registration','replaced_registration_refuses_before_recovery',lambda text:helper.disable(text,'Original execution requires its registered adapter graph'),'Replaced registration cannot read recovery')
    add('changed-graph','changed_graph_refuses_before_recovery',lambda text:helper.disable(text,'Original execution adapter graph changed'),'Changed graph cannot read recovery')
    add('foreign-components','same_runtime_foreign_components_refuse_before_stages',lambda text:helper.disable(text,'Original execution pinned components changed'),'Foreign same-runtime component cannot read recovery')
    add('initial-joins','constructor_revalidates_already_changed_joins',swap('        Pipeline(p.inputs,p.commit,c,p.progress)','        pass'),'ValueError not raised')
    add('initial-delivery-join','constructor_revalidates_delivery_authority_join',swap('        Terminal(c.observer,c.delivery.authority,c.delivery.transport,\n                 c.delivery.credential_reference,access=c.delivery.access,\n                 timeout=c.delivery.timeout,cancelled=c.delivery.cancelled,\n                 max_attempts=c.delivery.max_attempts)','        pass'),'ValueError not raised')
    add('corrupt-component-refusal','corrupt_nested_component_refuses_before_stage',swap("raise ValueError('Original execution component graph differs') from None",'raise'),"has no attribute 'products'")
    add('existing-reader-join','constructor_refuses_existing_foreign_delivery_reader',lambda text:helper.disable(text,'Original execution existing reader join differs'),'ValueError not raised')
    add('internal-input-pin','compatible_internal_input_replacement_refuses_before_stage',lambda text:helper.disable(text,'Original execution pinned components changed'),'Foreign internal input cannot read recovery')
    add('initial-input-join','constructor_revalidates_internal_input_target',swap('        Inputs(p.inputs.pipeline,p.inputs.dispatch,p.inputs.capture,\n               capture_with_deadline=p.inputs.capture_with_deadline)','        pass'),'ValueError not raised')
    add('typed-constructor','constructor_requires_typed_graph',lambda text:helper.disable(text,'Original execution needs one running pipeline and outcome recovery'),'does not match')
    add('constructor-registration','constructor_requires_current_registration',swap('        self._graph()\n\n    def _validate', '        pass\n\n    def _validate'),'ValueError not raised')
    add('actual-original-recovery','actual_new_job_then_original_recovery_keeps_one_start',swap("('original_recovery_attempted',self.pipeline.resume_one)","('original_recovery_attempted',lambda:self.runtime.run_one() if self.runtime.journal.started() else self.pipeline.resume_one())"),'Started work resumes before another admission')
    add('actual-outcome-recovery','actual_legacy_repair_preserves_original_before_idle',swap("('outcome_recovery_attempted',self.recovery.resume_one)","('outcome_recovery_attempted',lambda:False)"),'Actual old outcome is repaired first')
    add('pending-outcome-priority','pending_legacy_delivery_cannot_start_next_job',swap('if attempted:return','if False:return'),'Pending legacy callback cannot enter original recovery')
    census={n.name for n in ast.walk(ast.parse(originals[tests])) if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')}
    if {c[1] for c in cases}!=census:raise ValueError('Every execution case needs its own fault')
    controls=[]
    def restore():
        for p,raw in originals.items():p.write_bytes(raw)
    def execute(label,target=None):
        r=subprocess.run([sys.executable,'-B','-m','unittest','test_runtime_execution'+('.Checks.'+target if target else '')],cwd=folder,capture_output=True,timeout=120,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        log=(r.stdout+r.stderr).decode(errors='replace');(out/(label+'.log')).write_text(log);return r.returncode,log
    def positive(label):
        code,log=execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in log:raise AssertionError(label+' positive differs\n'+log)
        controls.append({'control':label,'outcome':'survived'});print(label+' survived',flush=True)
    try:
        positive('baseline');source.write_bytes(originals[source]+b'\n# Harmless execution note.\n');positive('harmless');restore();positive('restored-after-harmless')
        for label,target,change,reason in cases:
            restore();source.write_text(change(originals[source].decode()));code,log=execute(label,target)
            if not local.intended_failure(code,log,target,reason,base.intended_failure):raise AssertionError(label+' intended diagnostic differs\n'+log)
            controls.append({'control':label,'test':target,'outcome':'intended_failure','reason':reason});print(label+' intended failure',flush=True)
        restore();positive('restored-final')
        (out/'controls.json').write_text(json.dumps(controls,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(raw).hexdigest() for p,raw in originals.items()},indent=2)+'\n')
    finally:restore()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
