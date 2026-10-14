"""Challenge original outcome repair and restore every source and test byte."""
import argparse,ast,hashlib,importlib.util,json,os,re,subprocess,sys
from pathlib import Path


def module(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def intended_failure(code,log,target,reason,base):
    if not base(code,log,target,reason):return False
    runs=re.findall(r'(?m)^Ran (\d+) tests? in [^\n]+$',log)
    summaries=re.findall(r'(?m)^FAILED \(([^\n]*)\)$',log)
    if runs!=['1'] or len(summaries)!=1:return False
    counts={}
    for part in summaries[0].split(', '):
        match=re.fullmatch(r'(failures|errors)=(\d+)',part)
        if match is None or match[1] in counts:return False
        counts[match[1]]=int(match[2])
    headers=re.findall(r'(?m)^(FAIL|ERROR): ',log)
    return (sum(counts.values())>0 and counts.get('failures',0)==headers.count('FAIL')
            and counts.get('errors',0)==headers.count('ERROR'))


def run(repo,out,fault_probes_only=False):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True);folder=repo/'workers/odm_worker'
    files={name:folder/name for name in ('runtime_outcome_recovery.py','runtime_admission.py','runtime_progress_delivery.py','runtime_terminal_delivery.py')}
    tests=folder/'test_runtime_outcome_recovery.py';original={p:p.read_bytes() for p in [*files.values(),tests]}
    helper=module(repo/'docs/reviews/2026-10-14-artifact-access/verify_controls.py','repair_helpers')
    oracle=module(repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py','repair_oracle')
    failure=lambda c,l,t,r:intended_failure(c,l,t,r,oracle.intended_failure)
    census={n.name for n in ast.walk(ast.parse(original[tests])) if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')};cases=[]
    def add(label,test,transform,reason,file='runtime_outcome_recovery.py'):cases.append((label,'test_'+test,files[file],transform,reason))
    def swap(a,b):return lambda text:helper.swap(text,a,b)
    def omit(message):return lambda text:helper.disable(text,message)
    add('recovery-not-published','acknowledged_repair_preserves_original_and_releases_hold',swap("publish(root,'record.json',json_bytes(expected))","pass"),'record.json')
    add('missing-terminal-guard-omitted','missing_terminal_command_refuses_before_effects',omit('Outcome recovery requires its saved original terminal command'),'Missing original terminal command cannot reach reader')
    add('pending-facts-discarded','pending_original_delivery_retains_hold_without_recovery_record',swap("'outcome_recovery',error,before['reportedEngine']","'outcome_recovery',error,None"),'Recovery failure must preserve all known original engine facts')
    add('historical-ack-requires-current-send','historical_acknowledgement_repairs_after_actor_revocation_without_transport',swap("if before['historicalReceiverOutcome']!='acknowledged':","if True:"),'Historical acknowledgement must publish private outcome repair')
    add('revoked-recovery-facts-discarded','pending_delivery_requires_current_actor_and_keeps_hold',swap("'outcome_recovery',error,before['reportedEngine']","'outcome_recovery',error,None"),'Recovery failure must preserve all known original engine facts')
    add('missing-command-falls-back-to-pipeline','missing_command_after_evidence_cannot_fall_back_to_inputs',swap("delivered=self.pipeline.coordinator.delivery.advance(entry.request['requestId'],\n                        expected_command_sha256=before['terminalCommandSha256'])","delivered=self.pipeline.advance(entry.request['requestId'])"),'Missing original command cannot enter general pipeline')
    add('changed-command-pin-omitted','changed_command_after_evidence_refuses_before_new_attempt',omit('Progress delivery original command changed before attempt'),'does not match','runtime_progress_delivery.py')
    add('invalid-pin-read-access','invalid_expected_command_hash_refuses_before_current_access',omit('Progress delivery expected original command hash differs'),'Invalid command pin cannot read current access','runtime_progress_delivery.py')
    add('old-bytes-binding-omitted','legacy_bytes_change_invalidates_recovery',swap('if not same(saved,expected):',"if not same({k:v for k,v in saved.items() if k!='originalOutcomeSha256'},{k:v for k,v in expected.items() if k!='originalOutcomeSha256'}):"),'ValueError not raised')
    add('changed-recovery-record-ignored','changed_recovery_outcome_refuses',omit('Outcome recovery receipt differs from original evidence'),'ValueError not raised')
    add('reported-states-collapsed','reported_failure_and_cancellation_remain_distinct',swap("'state':STATES[code]","'state':'succeeded'"),'Recovery cannot relabel reported failure or cancellation')
    add('registration-ignored','recovery_without_registered_adapter_refuses',omit('Outcome recovery needs its registered original adapter'),'NoneType')
    add('existing-repair-ignored','interrupted_recovery_publication_resumes_without_reissue',swap('return self.recovery.load(entry,original)','return original'),'Published recovery needs no further attempt')
    add('owner-guard-omitted','unowned_recovery_refuses_before_effects',omit('Outcome recovery requires its lifetime owner'),'ValueError not raised')
    add('unowned-status-reads-db','unowned_status_refuses_before_database_reads',omit('Outcome recovery status requires its lifetime owner'),'Unowned status cannot read admissions')
    add('unowned-outcome-reads-record','unowned_outcome_refuses_before_private_record',omit('Outcome recovery reads require its lifetime owner'),'Unowned recovery cannot read original outcome')
    add('constructor-graph-guard-omitted','constructor_requires_typed_original_pipeline',omit('Outcome recovery needs one original runtime and pipeline'),"has no attribute 'runtime'")
    add('nonfinite-timeout-accepted','nonfinite_timeout_refuses',omit('Outcome recovery needs a finite positive deadline'),'ValueError not raised')
    add('known-outcome-reclassified','known_original_outcome_cannot_be_reclassified',omit('Outcome recovery requires its unresolved original local outcome'),'ValueError not raised')
    add('stale-original-snapshot-accepted','stale_original_snapshot_refuses_before_binding',omit('Original outcome changes during recovery'),'ValueError not raised')
    add('unacknowledged-receipt-accepted','unacknowledged_evidence_cannot_supply_recovery_receipt',omit('Outcome recovery requires acknowledged original delivery'),'ValueError not raised')
    add('oversized-original-read','oversized_original_outcome_refuses_before_stream_read',omit('Original outcome exceeds recovery bound'),'Oversized original outcome cannot allocate stream bytes')
    add('oversized-recovery-read','oversized_recovery_receipt_refuses_before_stream_read',omit('Outcome recovery receipt exceeds bound'),'Oversized recovery receipt cannot allocate stream bytes')
    add('short-original-accepted','short_original_read_cannot_bind_recovery',swap('if len(raw)!=info.st_size or not same(parse(raw,BOUND),original):','if not same(parse(raw,BOUND),original):'),'ValueError not raised')
    add('short-recovery-accepted','short_recovery_receipt_cannot_release_hold',omit('Outcome recovery receipt length differs'),'ValueError not raised')
    add('busy-recovery-reports-attempt','busy_execution_refuses_before_recovery_effects',swap('if not self.runtime._execution.acquire(blocking=False):return False','if not self.runtime._execution.acquire(blocking=False):return True'),'Busy original execution prevents outcome repair')
    add('replaced-pipeline-reads-starts','replaced_pipeline_refuses_before_original_journal_read',omit('Outcome recovery requires its registered original pipeline'),'Replaced pipeline cannot read original starts')
    add('missing-old-outcome-starts-repair','original_without_local_failure_stays_with_original_pipeline',swap('if original is None:return False','if False:return False'),'Outcome recovery requires its unresolved original local outcome')
    add('unknown-namespace-published','unknown_recovery_records_refuse_before_publication',omit('Outcome recovery has unknown pre-receipt records'),'ValueError not raised')
    add('first-byte-fence-omitted','original_bytes_change_between_evidence_reads_refuses_publication',omit('Original outcome changes before recovery publication'),'does not match')
    add('publication-byte-fence-omitted','original_bytes_change_at_publication_refuses_saved_recovery',omit('Original outcome changes at recovery publication'),'does not match')
    add('status-keeps-write-transaction','acknowledged_repair_preserves_original_and_releases_hold',swap("        outcomes = [self._outcome(row) for row in entries if row.phase == 'started']\n        return", "            outcomes = [self._outcome(row) for row in entries if row.phase == 'started']\n        return"),'database is locked','runtime_admission.py')
    add('terminal-drops-command-pin','changed_command_after_evidence_refuses_before_new_attempt',swap('expected_command_sha256=expected_command_sha256','expected_command_sha256=None'),'does not match','runtime_terminal_delivery.py')
    if {row[1] for row in cases}!=census:raise ValueError('Every outcome-recovery case needs a targeted fault')
    controls=[];oracles=[]
    def oracle_controls(code,log,target,reason):
        import re
        rows=[]
        trials=[('baseline',code,log,target,reason,True),('harmless',code,'# Harmless oracle note.\n'+log,target,reason,True),('restored',code,log,target,reason,True),
            ('success',0,log,target,reason,False),('boolean',True,log,target,reason,False),('wrong-exit',2,log,target,reason,False),
            ('missing-log',code,None,target,reason,False),('wrong-test',code,log.replace(target,'test_unrelated'),target,reason,False),
            ('missing-reason',code,log.replace(reason,'unrelated'),target,reason,False),('earlier-decoy',code,reason+'\n'+log.replace(reason,'unrelated'),target,reason,False),
            ('extra-test',code,log+'\nFAIL: test_unrelated (other.Checks.test_unrelated)\n',target,reason,False),
            ('missing-count',code,re.sub(r'(?m)^Ran 1 test.*$','',log),target,reason,False),
            ('missing-summary',code,re.sub(r'(?m)^FAILED.*$','',log),target,reason,False),
            ('zero-summary',code,re.sub(r'(?m)^FAILED.*$','FAILED (failures=0, errors=0)',log),target,reason,False),
            ('mismatched-summary',code,re.sub(r'(?m)^FAILED.*$',lambda m:re.sub(r'=\d+', '=99',m[0]),log),target,reason,False),
            ('duplicate-summary',code,log+'\n'+re.search(r'(?m)^FAILED.*$',log)[0]+'\n',target,reason,False),
            ('duplicate-count',code,log+'\nRan 1 test in 0.001s\n',target,reason,False),
            ('later-error' ,code,re.sub(r'(?m)^FAILED',lambda _: 'KeyError: unrelated\nFAILED',log),target,reason,False),
            ('missing-target',code,log,None,reason,False),('missing-reason-value',code,log,target,None,False)]
        for label,c,l,t,r,expected in trials:
            if failure(c,l,t,r) is not expected:raise AssertionError('Recovery failure oracle differs: '+label)
            rows.append({'control':label,'outcome':'survived' if expected else 'intended_refusal'})
        return rows
    def restore():
        for path,raw in original.items():path.write_bytes(raw)
    def execute(label,target=None):
        result=subprocess.run([sys.executable,'-B','-m','unittest','test_runtime_outcome_recovery'+('.Checks.'+target if target else '')],cwd=folder,capture_output=True,timeout=120,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        log=(result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(log);return result.returncode,log
    def positive(label):
        code,log=execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in log:raise AssertionError(label+' positive differs\n'+log)
        controls.append({'control':label,'outcome':'survived'});print(label+' survived',flush=True)
    try:
        if not fault_probes_only:
            positive('baseline')
            for path in files.values():path.write_bytes(original[path]+b'\n# Harmless original recovery note.\n')
            positive('harmless');restore();positive('restored-after-harmless')
        for label,target,path,transform,reason in cases:
            restore();path.write_text(transform(original[path].decode()))
            code,log=execute(label,target)
            if not failure(code,log,target,reason):raise AssertionError(label+' intended diagnostic differs\n'+log)
            controls.append({'control':label,'test':target,'outcome':'intended_failure','reason':reason})
            oracles.extend(oracle_controls(code,log,target,reason))
            print(label+' intended failure',flush=True)
        restore()
        if not fault_probes_only:positive('restored-final')
        (out/'controls.json').write_text(json.dumps(controls,indent=2)+'\n')
        (out/'oracle-controls.json').write_text(json.dumps(oracles,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(raw).hexdigest() for p,raw in original.items()},indent=2)+'\n')
        print({'cases':len(census),'faults':len(cases),'positive':0 if fault_probes_only else 4,'faultProbesOnly':fault_probes_only},flush=True)
    finally:restore()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);parser.add_argument('--fault-probes-only',action='store_true');a=parser.parse_args();run(a.repo.resolve(),a.out.resolve(),a.fault_probes_only)
