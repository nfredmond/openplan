"""Harmless and targeted URL custody controls with exact source restoration."""
import argparse,ast,hashlib,json,os,re,subprocess,sys
from pathlib import Path


def replace(text,before,after):
    if text.count(before)!=1:raise ValueError('Source mutation anchor is not unique: '+before[:80])
    return text.replace(before,after,1)


def disable(text,message):
    nodes=[]
    for node in ast.walk(ast.parse(text)):
        if isinstance(node,ast.If) and any(isinstance(row,ast.Raise) and isinstance(row.exc,ast.Call) and row.exc.args and isinstance(row.exc.args[0],ast.Constant) and row.exc.args[0].value==message for row in node.body):nodes.append(node)
    if len(nodes)!=1:raise ValueError('Source guard mutation is not unique: '+message)
    node=nodes[0].test;lines=text.splitlines(keepends=True)
    start=sum(map(len,lines[:node.lineno-1]))+node.col_offset
    end=sum(map(len,lines[:node.end_lineno-1]))+node.end_col_offset
    return text[:start]+'False'+text[end:]


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700)
    source=repo/'workers/odm_worker/url_source_custody.py';tests=source.with_name('test_url_source_custody.py')
    original=source.read_bytes();before_tests=tests.read_bytes();text=original.decode()
    census={node.name for node in ast.walk(ast.parse(before_tests)) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    cases=[]
    def add(label,test,transform,reason,kind='broken_behavior'):cases.append((label,'test_'+test,transform,reason,kind))
    guard=lambda message:lambda source:disable(source,message)
    swap=lambda before,after:lambda source:replace(source,before,after)
    no_cancel=guard('Original URL source intake cancelled')
    no_deadline=guard('Original URL source deadline exceeded')
    no_plan=swap("            publish(pack,'plan.json',json_bytes(plan));plan_hash=", "            plan_hash=")
    no_receipt=guard('Original complete URL source receipt differs')
    refetch=swap("                if receipts[index] is None:","                if True:")
    add('complete-hash-replaced','original_complete_receipts_bind_context_and_exact_bytes',swap("'objectRelativePath':name,**actual}","'objectRelativePath':name,'bytes':actual['bytes'],'sha256':'a'*64}"),'!=' )
    add('source-permits-engine','original_complete_receipts_bind_context_and_exact_bytes',lambda source:source.replace("'engineTransportPermission':False","'engineTransportPermission':True"),'Source receipt cannot permit engine transport')
    add('complete-source-refetched','complete_replay_never_fetches_changed_remote_bytes',refetch,'URL source bytes differ from original declarations','diagnostic_refusal')
    add('runtime-owner-ignored','runtime_owner_required_before_request_records_or_fetch',guard('URL source intake requires its lifetime runtime owner'),'ValueError not raised')
    add('original-start-ignored','original_started_context_required_before_fetch',guard('Original owned URL source start is required'),'ValueError not raised')
    add('application-scope-ignored','original_application_actor_and_scope_required_before_fetch',swap('context=application_context(entry,self.seal[\'installationId\'],self.target,job)',"context={'authorityVerification':'unassessed'}"),'Invalid application context reached fetch')
    for label,message in [('adapters','Original runtime and explicit URL source adapters are required'),('target','Original URL source target is required'),('timeout','URL source timeout must be positive and finite')]:
        add('constructor-'+label+'-ignored','constructor_requires_explicit_adapters_and_finite_configuration',guard(message),'ValueError not raised')
    add('roots-overlap','source_runtime_overlap_refuses_before_root_or_fetch',guard('URL source and runtime roots must not overlap'),'does not match','diagnostic_refusal')
    add('root-seal-not-published','source_seal_cannot_rebind_target_or_installation',swap('            publish(self.root,saved.name,json_bytes(self.seal))','            pass # installation seal not published'),'ValueError not raised')
    add('missing-seal-adopted','missing_source_seal_cannot_adopt_existing_records',guard('URL source records require their original installation seal'),'ValueError not raised')
    add('missing-plan-adopted','missing_request_plan_cannot_adopt_existing_bytes',guard('URL source records require their original plan'),'ValueError not raised')
    add('changed-plan-publication-ignored','actor_budget_and_original_request_cannot_rebind_plan',no_plan,'does not match','diagnostic_refusal')
    add('declared-total-ignored','declared_whole_job_limit_precedes_fetch',guard('Declared URL sources exceed the whole-job limit'),'Oversized declared set fetched')
    add('declarations-ignored','invalid_source_declarations_refuse_before_fetch',guard('Original URL source declarations differ'),'Invalid source declaration reached fetch')
    add('downloaded-declaration-mismatch-ignored','downloaded_size_and_hash_must_match_original_declarations',guard('URL source bytes differ from original declarations'),'ValueError not raised')
    add('whole-budget-writes-excess','actual_whole_job_limit_refuses_before_excess_write',guard('URL source bytes exceed the remaining whole-job limit'),'Budget must refuse before writing excess bytes')
    add('nonbytes-accepted','nonbyte_chunks_cannot_become_complete',guard('URL source write requires bytes'),'ValueError not raised')
    add('fetch-count-ignored','fetch_count_requires_exact_delivered_integer',guard('URL source fetch count differs from delivered bytes'),'ValueError not raised')
    add('partial-write-accepted','partial_local_write_cannot_report_complete',guard('URL source object write did not finish'),'OSError not raised')
    add('expired-source-continues','expired_operation_refuses_before_writer_or_fetch',no_deadline,'Expired source operation acquired a writer')
    add('pre-cancel-ignored','pre_cancelled_operation_refuses_before_fetch',no_cancel,'Precancelled URL source fetched')
    add('delivery-cancel-ignored','cancellation_during_delivery_refuses_before_source_write',no_cancel,'InterruptedError not raised')
    add('implicit-cancellation-type','cancellation_adapter_requires_boolean',guard('URL source cancellation must return a boolean'),'ValueError not raised')
    add('complete-prefix-refetched','interrupted_second_source_reuses_first_complete_bytes',refetch,'URL source bytes differ from original declarations','diagnostic_refusal')
    orphan_before="        self._check(deadline);slot=source['slot']\n"
    orphan_after="""        self._check(deadline);slot=source['slot']
        matches=list((pack/'objects').glob(f'source-{slot:05d}-*.bin'))
        if matches:
            name=str(matches[0].relative_to(pack));actual=digest(pack,name,remaining,deadline)
            receipt={'format':RECEIPT,'planSha256':plan_hash,'slot':slot,'objectRelativePath':name,**actual}
            publish(pack,f'source-{slot:05d}.complete.json',json_bytes(receipt));return receipt
"""
    add('orphan-file-adopted','orphan_object_is_not_a_complete_receipt',swap(orphan_before,orphan_after),'An orphan filename cannot skip original source fetching')
    add('complete-hash-verification-ignored','missing_or_corrupt_complete_bytes_refuse_without_refetch',guard('Retained complete URL source bytes differ'),'ValueError not raised')
    add('missing-complete-receipt-refetched','missing_completed_receipt_cannot_fetch_again',guard('Completed URL sources require every original receipt'),'Completed source data cannot refetch')
    add('complete-set-not-published','complete_set_rebuild_uses_only_retained_receipts',swap("            publish(pack,'completed.json',json_bytes(manifest))","            pass # complete set not published"),'Completed source set must be durably published')
    add('receipt-shape-ignored','receipt_shape_mapping_and_plan_hash_refuse',no_receipt,'ValueError not raised')
    add('installation-identity-ignored','changed_installation_seal_refuses_before_fetch',guard('Original URL source installation differs'),'ValueError not raised')
    add('plan-not-frozen-before-fetch','original_plan_predates_fetch_and_detaches_supplied_alias',no_plan,'Original source plan must predate fetching')
    add('preparation-slot-mapping-omitted','actual_runtime_preparation_receives_exact_complete_sources',swap("'sources':[row['objectRelativePath'] for row in receipts]","'sources':[]"),'Original runtime source mapping differs','diagnostic_refusal')
    add('relocated-complete-source-refetched','relocated_source_and_runtime_copies_replay_without_fetch',refetch,'Copied complete URL bytes refetched')
    add('late-return-deadline-ignored','late_fetch_return_cannot_publish_completion',no_deadline,'does not match','diagnostic_refusal')
    add('parent-entry-sync-omitted','new_source_root_synchronizes_parent_entry',swap('        else:synchronize(self.root.parent)','        else:pass # parent entry not synchronized'),'Private URL source root entry must synchronize its parent')
    add('stored-count-ignored','bypassed_writer_cannot_hide_stored_byte_count',guard('URL source stored byte count differs'),'ValueError not raised')
    add('retained-aggregate-budget-ignored','retained_receipt_set_cannot_exceed_original_aggregate_budget',guard('Retained URL source set exceeds the whole-job limit'),'ValueError not raised')
    add('zip-archive-slot-omitted','zip_request_retains_one_exact_archive_before_preparation',swap("else [imagery]","else []"),'ZIP custody must retain exactly one original archive')
    add('byte-limit-validation-omitted','constructor_requires_explicit_adapters_and_finite_configuration',swap('        finite_limit(max_bytes)','        pass # byte limit not validated'),'ValueError not raised')
    add('orphan-storage-bound-ignored','orphan_storage_bytes_refuse_without_fetch_or_removal',guard('URL source attempt storage exceeds its original limit'),'ValueError not raised')
    add('attempt-count-bound-ignored','exhausted_attempt_count_cannot_start_another_object',guard('URL source attempt count limit reached'),'Exhausted attempt count fetched')
    add('mutable-budget-used','fetch_adapter_cannot_expand_original_whole_job_budget',swap("remaining=min(limit-total,plan['maxAttemptStorageBytes']-used)","remaining=min(self.max_bytes-total,plan['maxAttemptStorageBytes']-used)"),'ValueError not raised')
    if {row[1] for row in cases}!=census:raise AssertionError('Source tests lack controls: '+repr(sorted(census-{row[1] for row in cases})))
    rows=[]
    def execute(label,test=None):
        result=subprocess.run([sys.executable,'-B',str(tests)]+(['Checks.'+test] if test else []),cwd=repo,capture_output=True,timeout=12,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        output=(result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output);return result.returncode,output
    def positive(label,payload):
        source.write_bytes(payload);code,output=execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in output:raise AssertionError(label+': positive source control failed\n'+output)
        rows.append({'control':label,'outcome':'survived'})
    try:
        positive('baseline',original);positive('harmless-comment',original+b'\n# Harmless original URL source control.\n');positive('restored-after-harmless',original)
        for label,test,transform,reason,kind in cases:
            try:
                changed=transform(text);ast.parse(changed);source.write_text(changed);code,output=execute(label,test)
                lines=output.splitlines();starts=[i for i,line in enumerate(lines) if re.match(r'^[A-Za-z_][\w.]*Error:',line)];blocks=[]
                for start in starts:
                    end=next((i for i in range(start+1,len(lines)) if lines[i].startswith('-----') or lines[i].startswith('=====')),len(lines));blocks.append('\n'.join(lines[start:end]))
                diagnostic='\n'.join(blocks)
                if code==0 or ('FAIL: '+test not in output and 'ERROR: '+test not in output) or not starts or reason not in diagnostic:raise AssertionError(label+': wrong source failure '+repr(diagnostic)+'\n'+output)
                rows.append({'control':label,'test':test,'kind':kind,'outcome':'intended_failure','reason':reason})
            finally:source.write_bytes(original)
        positive('restored-final',original)
        if source.read_bytes()!=original or tests.read_bytes()!=before_tests:raise AssertionError('URL custody source or tests were not restored')
        (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in (source,tests,Path(__file__))},indent=2)+'\n')
        print(json.dumps({'tests':len(census),'controls':len(rows),'positive':4,'targeted':len(cases),'allPassed':True}),flush=True)
    finally:
        source.write_bytes(original)
        with source.open('rb') as f:os.fsync(f.fileno())


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True);args=parser.parse_args();run(args.repo.resolve(),args.out.absolute())
