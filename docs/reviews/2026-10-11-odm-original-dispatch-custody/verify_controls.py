"""Original dispatch controls with exact restoration and a checked failure oracle."""
import argparse,ast,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700)
    helper_path=repo/'docs/reviews/2026-10-11-odm-url-transport/verify_controls.py'
    spec=importlib.util.spec_from_file_location('dispatch_fault_helper',helper_path);helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    source=repo/'workers/odm_worker/runtime_dispatch_custody.py';tests=source.with_name('test_runtime_dispatch_custody.py')
    original=source.read_bytes();test_bytes=tests.read_bytes();text=original.decode()
    census={node.name for node in ast.walk(ast.parse(test_bytes)) if isinstance(node,ast.FunctionDef) and node.name.startswith('test_')}
    cases=[]
    def add(label,test,transform,reason,kind='broken_behavior'):cases.append((label,'test_'+test,transform,reason,kind))
    guard=lambda message,function=None:lambda source:helper.disable(source,message,function)
    swap=lambda before,after:lambda source:helper.replace(source,before,after)
    add('dispatch-whitespace-lost','actual_queue_preserves_exact_bytes_actor_project_and_admission',swap("'payloadText': text,","'payloadText': text.strip(),"),'Original dispatch receipt differs','diagnostic_refusal')
    add('capture-permits-engine','actual_queue_preserves_exact_bytes_actor_project_and_admission',swap("'engineTransportPermission': False}","'engineTransportPermission': True}"),'Dispatch capture cannot permit engine transport')
    add('capture-promotes-authority','actual_queue_preserves_exact_bytes_actor_project_and_admission',swap("'authorityVerification': 'unassessed'","'authorityVerification': 'verified'"),'Supplied dispatch cannot promote live authority')
    add('capture-not-published','receipt_precedes_source_fetch_and_detaches_supplied_aliases',swap("            publish(root, 'receipt.json', json_bytes(value), json_limit=6*MAX_BYTES+1024*1024)","            pass # original receipt not published"),'No such file or directory','diagnostic_refusal')
    add('expanded-original-bound-omitted','original_publication_uses_its_expanded_receipt_bound',swap("publish(root, 'receipt.json', json_bytes(value), json_limit=6*MAX_BYTES+1024*1024)","publish(root, 'receipt.json', json_bytes(value))"),'Source custody metadata exceeds the supported size','diagnostic_refusal')
    add('network-capture-deadline-omitted','network_capture_receives_the_actual_shared_deadline',swap('captured = self.capture(copy.deepcopy(entry), deadline=deadline) if self.capture_with_deadline else self.capture(copy.deepcopy(entry))','captured = self.capture(copy.deepcopy(entry))'),'Network capture must receive the actual shared pipeline deadline')
    add('capture-deadline-selection-unchecked','capture_deadline_selection_requires_a_boolean',guard('Original dispatch capture deadline selection must be boolean'),'ValueError not raised')
    add('completed-dispatch-recaptured','original_capture_never_requeries_on_complete_or_uncertain_replay',swap("if path.exists() or path.is_symlink(): receipt =","if False: receipt ="),'Started input work requires its original dispatch receipt','diagnostic_refusal')
    add('constructor-adapters-unchecked','constructor_and_pipeline_require_matching_runtime_target_adapters',guard('Original dispatch runtime and target are required'),'ValueError not raised')
    add('constructor-timeout-unchecked','constructor_and_pipeline_require_matching_runtime_target_adapters',guard('Original dispatch deadline must be positive and finite'),'does not match','diagnostic_refusal')
    add('pipeline-adapters-unchecked','constructor_and_pipeline_require_matching_runtime_target_adapters',guard('Original dispatch pipeline adapters differ'),'ValueError not raised')
    add('owner-start-check-omitted','unowned_or_unstarted_capture_refuses_before_record_reads',swap('entry = self.validation._entry(request_id)','entry = self.runtime.journal.get(request_id)'),'Unowned dispatch read')
    add('deadline-type-unchecked','expired_or_nonfinite_deadline_refuses_before_capture_io',guard('Original dispatch deadline must be finite'),'Invalid deadline reached dispatch validation')
    add('expired-dispatch-continues','expired_or_nonfinite_deadline_refuses_before_capture_io',guard('Original dispatch deadline exceeded'),'Invalid deadline reached dispatch validation')
    add('byte-bound-unchecked','payload_requires_bounded_actual_bytes',guard('Original dispatch byte count differs'),'ValueError not raised')
    add('duplicate-properties-accepted','ambiguous_nonfinite_and_invalid_utf8_json_refuse',guard('Original dispatch JSON has duplicate properties'),'does not match','diagnostic_refusal')
    add('nonfinite-json-accepted','ambiguous_nonfinite_and_invalid_utf8_json_refuse',swap("parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite dispatch JSON'))","parse_constant=lambda value: value"),'does not match','diagnostic_refusal')
    add('contract-validation-omitted','contract_invalid_even_when_admission_matches_refuses',guard('Original dispatch contract differs'),'ValueError not raised')
    add('admitted-payload-binding-omitted','changed_title_callback_notes_and_imagery_cannot_rebind_admission',guard('Original dispatch differs from admitted request'),'ValueError not raised')
    add('project-projection-unchecked','project_projection_required_and_matches_full_original_request',guard('Original dispatch project projection is required'),('KeyError:', 'ValueError not raised'),'diagnostic_refusal')
    add('project-scope-unchecked','project_projection_required_and_matches_full_original_request',guard('Original dispatch project scope differs'),'ValueError not raised')
    add('other-system-accepted','non_openplan_system_refuses_even_with_matching_admission',guard('Original dispatch project scope differs'),'ValueError not raised')
    add('actor-scope-unchecked','original_actor_and_workspace_must_match_supplied_scope',swap("context = application_context(entry, self.runtime.installation['installationId'], self.target, projection)","context = {}"),'ValueError not raised')
    add('existing-receipt-not-compared','existing_receipt_cannot_change_actor_or_exact_encoding',swap("            publish(root, 'receipt.json', json_bytes(value), json_limit=6*MAX_BYTES+1024*1024)","            if not (root/'receipt.json').exists(): publish(root, 'receipt.json', json_bytes(value), json_limit=6*MAX_BYTES+1024*1024)"),'ValueError not raised')
    add('lost-dispatch-recaptured','missing_receipt_after_intake_refuses_before_recapture',guard('Started input work requires its original dispatch receipt','capture_original'),'Lost dispatch was recaptured')
    add('lost-dispatch-directly-recreated','missing_receipt_after_intake_refuses_before_recapture',guard('Started input work requires its original dispatch receipt','save'),'ValueError not raised')
    add('receipt-binding-unchecked','corrupt_receipt_hash_scope_binding_and_flags_refuse',swap("        if encoded(value, canonical=True) != encoded(expected, canonical=True):","        if False:"),'ValueError not raised')
    add('receipt-bound-unchecked','receipt_bound_checked_before_open_descriptor_read',guard('Original dispatch receipt exceeds its bound'),'Oversized receipt must refuse before allocating its bytes')
    add('receipt-length-unchecked','receipt_length_change_refuses_after_same_descriptor_read',guard('Original dispatch receipt changed during read'),'ValueError not raised')
    add('receipt-json-static-diagnostic-lost','invalid_saved_json_refuses_with_static_diagnostic',swap("raise ValueError('Original dispatch receipt JSON differs') from None","raise ValueError('Incorrect saved JSON diagnostic') from None"),'does not match','diagnostic_refusal')
    add('receipt-text-shape-unchecked','nonobject_or_missing_text_receipts_refuse',swap("        if not isinstance(value, dict) or not isinstance(value.get('payloadText'), str):","        if False:"),'TypeError:','diagnostic_refusal')
    add('aliased-receipt-read-bypassed','aliased_receipt_refuses_without_recapture',swap("        with reader(root, 'receipt.json') as (stream, info):","        from contextlib import contextmanager\n        @contextmanager\n        def raw_reader(root, name):\n            with (root/name).open('rb') as stream: yield stream, (root/name).stat()\n        with raw_reader(root, 'receipt.json') as (stream, info):"),'ValueError not raised')
    add('settings-projection-unchecked','changed_fresh_or_saved_input_actor_refuses_before_fetch_or_command',guard('Original dispatch and input settings differ'),'Changed settings reached source')
    add('capture-shape-unchecked','capture_shape_and_late_deadline_refuse_before_input_work',guard('Exact original dispatch capture is required'),'ValueError not raised')
    add('engine-context-unchecked','engine_plan_binding_checked_before_permission',guard('Original dispatch engine binding differs'),'Changed engine context reached permission')
    add('copied-runtime-recaptured','copied_runtime_preserves_dispatch_without_capture_or_source_root',swap("if path.exists() or path.is_symlink(): receipt =","if False: receipt ="),'Started input work requires its original dispatch receipt','diagnostic_refusal')
    add('linked-project-output-cleared','linked_project_is_explicit_and_original',swap('        return value\n\n    def save',"        return {**value,'applicationJob':{**value['applicationJob'],'project_id':None}}\n\n    def save"),'Linked project must remain explicit')
    add('zip-original-url-output-replaced','zip_dispatch_preserves_v1_exact_original_archive_request',swap('        return value\n\n    def save',"        return {**value,'payloadText':value['payloadText'].replace('original.zip','changed.zip')}\n\n    def save"),'ZIP dispatch must retain its original archive metadata')
    add('late-final-dispatch-check-omitted','late_return_cannot_report_success_after_dispatch_check',swap('        self.dispatch.load(request_id, deadline=deadline)\n        result', '        result'),'TimeoutError not raised')
    add('pre-cancel-check-omitted','pre_cancelled_pipeline_refuses_before_capture',lambda source: helper.replace(helper.replace(source, 'entry = self.pipeline.intake._check(request_id, deadline)\n        path =', 'entry = self.dispatch._check(request_id, deadline)\n        path ='), 'entry = self.pipeline.intake._check(request_id, deadline)\n        receipt =', 'entry = self.dispatch._check(request_id, deadline)\n        receipt ='),'Cancelled pipeline reached dispatch capture')
    add('cancellation-callback-frozen','dispatch_clone_observes_replaced_cancellation_callback',swap('cancelled=lambda: intake.cancelled()','cancelled=intake.cancelled'),'InterruptedError not raised')
    add('current-authorization-deadline-omitted','selected_current_authorization_deadline_survives_dispatch_clone',swap("forwarded = {'deadline': min(deadline, options['deadline'])} if self.pipeline.authorize_with_deadline else {}","forwarded = {}"),'Original dispatch must forward the actual authorization deadline')
    add('current-authorization-selection-dropped','selected_current_authorization_deadline_survives_dispatch_clone',swap('authorize_with_deadline=self.pipeline.authorize_with_deadline','authorize_with_deadline=False'),"KeyError: 'deadline'",'diagnostic_refusal')
    add('outer-transport-deadline-extended','selected_current_authorization_deadline_survives_dispatch_clone',swap('self.pipeline.transport(engine, command, stream, min(deadline, given_deadline))','self.pipeline.transport(engine, command, stream, given_deadline)'),'Original dispatch must forward the actual authorization deadline')
    if {row[1] for row in cases}!=census:raise ValueError('Dispatch tests lack controls: '+repr(census-{row[1] for row in cases}))
    rows=[];oracle=[]
    def execute(label,test=None):
        result=subprocess.run([sys.executable,'-B',str(tests)]+(['Checks.'+test] if test else []),cwd=repo,capture_output=True,timeout=15,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        output=(result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(output);return result.returncode,output
    def positive(label,payload):
        source.write_bytes(payload);code,output=execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in output:raise AssertionError(label+': positive dispatch control failed\n'+output)
        rows.append({'control':label,'outcome':'survived'})
    try:
        positive('baseline',original);positive('harmless-comment',original+b'\n# Harmless original dispatch comment.\n');positive('restored-after-harmless',original)
        for label,test,transform,reason,kind in cases:
            try:
                changed=transform(text);ast.parse(changed);source.write_text(changed);code,output=execute(label,test)
                try:helper.verify_failure(test,code,output,reason)
                except ValueError:raise AssertionError(label+': wrong dispatch failure\n'+output) from None
                if not oracle and kind=='broken_behavior' and isinstance(reason,str):oracle=helper.oracle_controls(test,code,output,reason)
                rows.append({'control':label,'test':test,'outcome':'intended_failure','reason':reason,'kind':kind})
            finally:source.write_bytes(original)
        positive('restored-final',original)
        if source.read_bytes()!=original or tests.read_bytes()!=test_bytes:raise AssertionError('Original dispatch restoration differs')
        paths=[source,tests,helper_path,Path(__file__)]
        for name,value in [('controls',rows),('oracle-controls',oracle),('source-bindings',{str(path.relative_to(repo)):hashlib.sha256(path.read_bytes()).hexdigest() for path in paths})]:
            (out/(name+'.json')).write_text(json.dumps(value,indent=2)+'\n')
        print(json.dumps({'tests':len(census),'controls':len(rows),'targeted':len(cases),'oracleControls':len(oracle)}))
    finally:
        source.write_bytes(original)
        with source.open('rb') as stream:os.fsync(stream.fileno())


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args();run(args.repo.resolve(),args.out.absolute())
