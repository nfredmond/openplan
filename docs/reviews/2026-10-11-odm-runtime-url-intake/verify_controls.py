"""Original intake guard controls, with exact restoration and failure diagnostics."""
import argparse,ast,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700)
    helper_path=repo/'docs/reviews/2026-10-11-odm-url-transport/verify_controls.py'
    spec=importlib.util.spec_from_file_location('intake_control_helper',helper_path)
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    paths={'intake':repo/'workers/odm_worker/runtime_url_intake.py','preparation':repo/'workers/odm_worker/runtime_preparation.py'}
    originals={key:path.read_bytes() for key,path in paths.items()};tests=paths['intake'].with_name('test_runtime_url_intake.py');test_bytes=tests.read_bytes()
    census={node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    cases=[]
    def add(label,test,transform,reason,source='intake',kind='broken_behavior'):cases.append((label,'test_'+test,transform,reason,source,kind))
    swap=lambda before,after:lambda text:helper.replace(text,before,after)
    guard=lambda message:lambda text:helper.disable(text,message)
    def resupply(text):
        return helper.disable(helper.replace(text,'            if original_plan:','            if False:'),'Runtime URL intake records require their original plan')
    add('authority-promoted','actual_owned_queue_freezes_original_settings_and_holds_next_job',swap("'preparation':prepared,'authorityVerification':'unassessed'","'preparation':prepared,'authorityVerification':'accepted'"),'URL intake cannot promote authority')
    add('permission-promoted','actual_owned_queue_freezes_original_settings_and_holds_next_job',swap("                'engineTransportPermission':False}","                'engineTransportPermission':True}"),'URL intake cannot permit engine transport')
    add('plan-after-fetch','settings_and_context_saved_before_first_fetch',swap("self._check(request_id,deadline);publish(root,'plan.json',json_bytes(plan));self._check(request_id,deadline)","self._check(request_id,deadline) # original plan omitted"),'Original settings must be durable before the first fetch')
    add('supplier-entry-alias','supplier_input_is_detached_from_original_admission',swap('self.supply(copy.deepcopy(entry))','self.supply(entry)'),'Original mapped URL source plan differs',kind='diagnostic_refusal')
    def aliased_settings(text):
        return helper.replace(helper.replace(text,'value=copy.deepcopy(value)','value=value'),
            'return {key:spec[key] for key in SETTINGS},context','return {key:value[key] for key in SETTINGS},context')
    add('supplier-settings-alias','settings_alias_mutation_during_fetch_cannot_change_preparation',aliased_settings,'Original mapped URL source plan differs',kind='diagnostic_refusal')
    add('complete-recovery-resupplied','completed_replay_never_supplies_or_fetches_and_keeps_task',resupply,'Completed intake called changed supplier')
    add('partial-recovery-resupplied','partial_intake_uses_saved_settings_and_only_missing_original_slot',resupply,'Partial recovery called changed supplier')
    add('restored-recovery-resupplied','relocated_two_roots_keep_original_settings_and_no_refetch',resupply,'Restored intake resupplied')
    add('invalid-adapters','invalid_constructor_adapters_target_timeout_or_roots',guard('Original runtime URL intake adapters are required'),('ValueError not raised',"AttributeError: 'object' object has no attribute 'root'"))
    add('invalid-target','invalid_constructor_adapters_target_timeout_or_roots',guard('Original runtime URL intake target is required'),'ValueError not raised')
    add('invalid-timeout','invalid_constructor_adapters_target_timeout_or_roots',guard('Runtime URL intake timeout must be positive and finite'),'ValueError not raised')
    add('overlapping-roots','invalid_constructor_adapters_target_timeout_or_roots',guard('Runtime URL intake roots must not overlap'),'ValueError not raised')
    add('unowned-intake','owner_required_before_supplier_or_fetch',swap('entry=self.validation._entry(request_id)','entry=self.runtime.journal.get(request_id)'),'Unowned intake reached supplier')
    add('unstarted-intake','original_started_admission_required',swap('entry=self.validation._entry(request_id)','entry=self.runtime.journal.get(request_id)'),'Unstarted intake reached supplier')
    add('unknown-settings','settings_shape_and_original_target_refuse_before_fetch',guard('Exact original URL preparation settings are required'),'Invalid intake settings reached validator')
    add('changed-target','settings_shape_and_original_target_refuse_before_fetch',guard('Original runtime URL intake target differs'),'Invalid intake settings reached validator')
    add('missing-complete-plan','missing_saved_plan_with_prepared_record_cannot_resupply',guard('Runtime URL intake records require their original plan'),'Missing plan resupplied')
    add('saved-plan-extra-fields','saved_plan_format_and_fields_refuse_before_publication',swap(" or set(saved)!={'format','binding','settings'}",''),'Malformed saved settings reached publication')
    add('saved-plan-format','saved_plan_format_and_fields_refuse_before_publication',swap(" or saved['format']!=FORMAT",''),'Malformed saved settings reached publication')
    add('saved-plan-binding-replaced','saved_plan_original_binding_refuses_before_mapping',swap("publish(root,'plan.json',json_bytes(plan))","publish(root,'plan.json',json_bytes(plan)) if not path.exists() else None"),'Changed original binding reached mapping')
    add('cancellation-ignored','pre_cancelled_and_implicit_cancellation_refuse',guard('Original runtime URL intake cancelled'),'InterruptedError not raised')
    add('implicit-cancellation-accepted','pre_cancelled_and_implicit_cancellation_refuse',guard('Runtime URL intake cancellation must be a boolean'),"InterruptedError: Original runtime URL intake cancelled",kind='diagnostic_refusal')
    add('fetch-deadline-extended','shared_deadline_clamps_nested_fetch_deadline',swap('min(deadline,given_deadline)','given_deadline'),'Nested fetch cannot extend the original intake deadline')
    add('expired-settings-accepted','expired_plan_publication_refuses_before_source_creation',guard('Original runtime URL intake deadline exceeded'),'Expired settings reached source intake')
    add('late-fetch-cancellation-ignored','late_fetch_and_cancellation_keep_plan_without_preparation',guard('Original runtime URL intake cancelled'),'InterruptedError not raised')
    add('late-preparation-cancellation-ignored','cancellation_after_preparation_refuses_intake_completion',guard('Original runtime URL intake cancelled'),'InterruptedError not raised')
    add('pipeline-identity-ignored','pipeline_identity_rejects_changed_reference_request_or_admission',guard('Pipeline URL intake identity differs from original admission'),'ValueError not raised')
    add('zip-derivation-omitted','zip_source_and_derived_slots_keep_original_settings',swap("            if spec['zipLimits'] is not None:",'            if False:'),'ZIP source requires original derived-image custody','preparation','diagnostic_refusal')
    add('partial-record-plan-loss','partial_source_records_require_original_settings_plan',guard('Runtime URL intake records require their original plan'),'Partial source records resupplied missing settings')
    add('started-installation-loss','missing_started_source_installation_never_refetches',guard('Started URL intake requires its original source installation'),'Missing started installation recreated')
    add('mapping-after-preparation','original_mapping_precedes_preparation',swap("manifest=self._mapping(mapping,plan_hash,entry,settings,context);publish(root,map_path.name,json_bytes(mapping))","manifest=self._mapping(mapping,plan_hash,entry,settings,context) # source mapping omitted"),'Original URL source mapping must precede preparation')
    add('completed-source-hash-ignored','completed_source_manifest_hash_checked_before_mapping',guard('Completed URL source manifest hash differs'),'Changed completed source hash reached mapping')
    add('mapped-recovery-resupplied','mapped_recovery_uses_original_bytes_without_supplier_or_fetch',resupply,'Mapped recovery resupplied')
    add('complete-root-recreated','completed_retained_bytes_replay_without_download_root',swap("            if mapped:mapping=read_json(root,map_path.name)","            if mapped:\n                UrlSources(self.runtime,self.source_root,self.target,fetch,max_bytes=settings['maxBytes'])\n                mapping=read_json(root,map_path.name)"),'Completed replay recreated source installation')
    add('prepared-mapping-loss','missing_mapping_after_preparation_refuses_before_source',guard('Prepared URL intake requires its original source mapping'),'Missing prepared mapping accessed source')
    add('unavailable-byte-check-skipped','mapped_bytes_unavailable_never_refetch',swap("actual=digest(container,relative,row['bytes'],deadline)","actual={key:row[key] for key in ('bytes','sha256')}"),'Unavailable mapped bytes reached preparation')
    add('mapping-extra-fields','mapping_wrapper_shape_version_and_settings_hash',swap(" or set(value)!={'format','intakePlanSha256','manifest'}",''),'ValueError not raised')
    add('mapping-version','mapping_wrapper_shape_version_and_settings_hash',swap(" or value['format']!=MAPPING",''),'ValueError not raised')
    add('mapping-settings-hash','mapping_wrapper_shape_version_and_settings_hash',swap(" or value['intakePlanSha256']!=plan_hash",''),'ValueError not raised')
    add('mapping-complete-flag','mapping_manifest_shape_flags_count_and_whole_byte_limit',swap(" or manifest['localSourceBytesComplete'] is not True",''),'ValueError not raised')
    add('mapping-authority-flag','mapping_manifest_shape_flags_count_and_whole_byte_limit',swap(" or manifest['authorityVerification']!='unassessed'",''),'ValueError not raised')
    add('mapping-permission-flag','mapping_manifest_shape_flags_count_and_whole_byte_limit',swap(" or manifest['engineTransportPermission'] is not False",''),'ValueError not raised')
    add('mapping-total-type','mapping_manifest_shape_flags_count_and_whole_byte_limit',swap(" or type(manifest['totalBytes']) is not int",''),'does not match',kind='diagnostic_refusal')
    add('mapping-plan-hash','mapping_source_plan_hash_binds_original_context_and_metadata',guard('Original mapped URL source plan differs'),'ValueError not raised')
    add('mapping-slot-path','mapping_slot_shape_paths_hashes_and_order',swap(" or not re.fullmatch(rf'objects/source-{slot:05d}-[0-9a-f]{{32}}\\.bin',row['objectRelativePath'])",''),'ValueError not raised')
    add('mapping-slot-order','mapping_slot_shape_paths_hashes_and_order',swap(" or row['slot']!=slot",''),'ValueError not raised')
    add('original-declarations-skipped','mapping_slot_original_declarations_stay_required',swap("            UrlSources._declared({'declaredBytes':metadata[slot].get('sizeBytes'),'declaredSha256':metadata[slot].get('checksumSha256')},row)",'            pass # original declarations omitted'),'ValueError not raised')
    add('mapping-sum','mapping_total_must_equal_actual_slot_sum',guard('Original runtime URL source total differs'),'ValueError not raised')
    add('changed-bytes-accepted','changed_mapped_bytes_refuse_before_preparation',guard('Original mapped URL source bytes differ'),'Changed mapped bytes reached preparation')
    add('unknown-declaration-bytes-accepted','mapping_without_original_declarations_still_checks_saved_byte_hash',guard('Original mapped URL source bytes differ'),'Undeclared changed bytes reached preparation')
    add('map-cancellation-ignored','cancellation_after_mapping_refuses_before_preparation',guard('Original runtime URL intake cancelled'),'Cancelled mapping reached preparation')
    add('completion-cancellation-ignored','late_intake_publication_cannot_report_success',guard('Original runtime URL intake cancelled'),'InterruptedError not raised')
    if {row[1] for row in cases}!=census:raise ValueError('Intake tests lack controls: '+repr(census-{row[1] for row in cases}))
    rows=[];oracle=[]
    def restore():
        for key,path in paths.items():path.write_bytes(originals[key])
    def execute(label,test=None):
        result=subprocess.run([sys.executable,'-B',str(tests)]+(['Checks.'+test] if test else []),cwd=repo,
            env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,timeout=15)
        output=(result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output);return result.returncode,output
    def positive(label,harmless=False):
        restore()
        if harmless:
            for path in paths.values():path.write_bytes(path.read_bytes()+b'\n# Harmless original intake comment.\n')
        code,output=execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in output:raise AssertionError(label+': positive intake control failed\n'+output)
        rows.append({'control':label,'outcome':'survived'})
    try:
        positive('baseline');positive('harmless-comments',True);positive('restored-after-harmless')
        for label,test,transform,reason,key,kind in cases:
            try:
                changed=transform(originals[key].decode());ast.parse(changed);paths[key].write_text(changed)
                code,output=execute(label,test)
                try:helper.verify_failure(test,code,output,reason)
                except ValueError:raise AssertionError(label+': wrong intake failure\n'+output) from None
                if not oracle and kind=='broken_behavior' and isinstance(reason,str):oracle=helper.oracle_controls(test,code,output,reason)
                rows.append({'control':label,'test':test,'source':key,'kind':kind,'outcome':'intended_failure','reason':reason})
            finally:restore()
        positive('restored-final')
        if tests.read_bytes()!=test_bytes or any(path.read_bytes()!=originals[key] for key,path in paths.items()):raise AssertionError('Intake source or test restoration differs')
        (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n');(out/'oracle-controls.json').write_text(json.dumps(oracle,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in [*paths.values(),tests,helper_path]},indent=2)+'\n')
        print(json.dumps({'controls':len(rows),'positive':4,'broken':len(cases),'testsCovered':len(census),'oracleControls':len(oracle)}))
    finally:
        restore()
        for path in paths.values():
            with path.open('rb') as stream:os.fsync(stream.fileno())


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.absolute())
