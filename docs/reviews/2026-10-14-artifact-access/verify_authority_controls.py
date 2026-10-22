"""Challenge separate delivery authority and its fixed supervised RPC."""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True)
    spec=importlib.util.spec_from_file_location('access_control_tools',Path(__file__).with_name('verify_controls.py'))
    helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
    oracle_spec=importlib.util.spec_from_file_location('retention_oracle',repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py')
    oracle=importlib.util.module_from_spec(oracle_spec);oracle_spec.loader.exec_module(oracle)
    folder=repo/'workers/odm_worker'
    sources={'reader':folder/'application_delivery_authority.py','http':folder/'application_dispatch_http.py'}
    tests={'reader':folder/'test_application_delivery_authority.py','http':folder/'test_delivery_authority_http.py'}
    original={p:p.read_bytes() for p in [*sources.values(),*tests.values()]}
    cases=[]
    def add(kind,label,test,transform,reason):cases.append((kind,label,'test_'+test,transform,reason))
    def change(a,b):return lambda t:helper.swap(t,a,b)
    def omit(message):return lambda t:helper.disable(t,message)
    add('reader','scope-changed','original_arguments_and_ownership',change("'p_reference':expected['jobReference']","'p_reference':'changed-reference'"),'Delivery RPC sends exact original scope')
    add('reader','refusal-promoted','revocation_stays_false',change("return value['authorizedNow']",'return True'),'Current refusal cannot become delivery access')
    add('reader','private-processing-flag-required','completed_processing_does_not_control_delivery',change("return value['authorizedNow']","return value['authorizedNow'] and original['engineTransportPermission']"),'Distinct scope permits completed delivery')
    add('reader','terminal-body-changed','terminal_callback_is_original',change("'p_callback':copy.deepcopy(callback)","'p_callback':{**callback,'message':'other'} if callback else None"),'Terminal access observes exact original callback')
    add('reader','supplied-binding-ignored','changed_binding_refuses',omit('Delivery authority supplied original differs'),'ValueError not raised')
    for name in ('processing_operation_refuses','artifact_callback_refuses','missing_terminal_callback_refuses'):
        add('reader',name,name,omit('Delivery authority operation or callback scope differs'),{'processing_operation_refuses':'response original scope differs','artifact_callback_refuses':'ValueError not raised','missing_terminal_callback_refuses':"has no attribute 'get'"}[name])
    add('reader','terminal-original-ignored','changed_terminal_original_refuses',omit('Delivery authority terminal original differs'),'response original scope differs')
    for name in ('wrong_operation_receipt_refuses','wrong_original_receipt_refuses','nonboolean_access_refuses','engine_permission_refuses','extra_receipt_refuses'):
        add('reader',name,name,omit('Delivery authority response original scope differs'),'ValueError not raised')
    add('reader','response-size-ignored','response_size_refuses',omit('Delivery authority response byte count differs'),'response JSON differs')
    add('reader','invalid-json-fallback','invalid_json_refuses',change("raise ValueError('Delivery authority response JSON differs') from None",'value={}'),'response original scope differs')
    add('reader','duplicate-json-accepted','duplicate_json_refuses',change('object_pairs_hook=strict_object','object_pairs_hook=None'),'ValueError not raised')
    add('reader','nonfinite-json-fallback','nonfinite_json_refuses',change("raise ValueError('Delivery authority response JSON differs') from None",'value={}'),'response original scope differs')
    add('reader','timestamp-gates-ignored','bad_observation_time_refuses',lambda t:helper.disable(helper.swap(t,"datetime.fromisoformat(observed.replace('Z','+00:00'))",'None'),'Delivery authority observation time differs'),'ValueError not raised')
    add('reader','calendar-date-ignored','impossible_time_refuses',change("datetime.fromisoformat(observed.replace('Z','+00:00'))",'None'),'ValueError not raised')
    add('reader','owned-loss-ignored','owner_loss_after_transport_refuses',change('owned=owned);check()','owned=owned);self.dispatch.runtime._owned=True;check()'),'InterruptedError not raised')
    add('reader','shared-deadline-extended','expired_deadline_refuses',change('deadline=min(deadline,time.monotonic()+self.timeout)','deadline=time.monotonic()+self.timeout'),'TimeoutError not raised')
    add('reader','constructor-adapter-ignored','invalid_constructor_refuses',omit('Delivery authority needs original custody and explicit transport'),"has no attribute 'timeout'")
    add('reader','constructor-timeout-ignored','invalid_constructor_refuses',omit('Delivery authority deadline must be finite and positive'),'ValueError not raised')
    add('reader','shared-type-ignored','invalid_deadline_refuses',omit('Delivery authority requires shared deadline and ownership'),'ValueError not raised')
    add('reader','binding-shape-ignored','invalid_binding_refuses',omit('Delivery authority requires its original binding'),"not subscriptable")
    add('http','delivery-rpc-path-changed','fixed_delivery_path_and_original_scope',change("parts.path + '/rpc/read_aerial_delivery_authority'","parts.path + '/rpc/read_aerial_original_dispatch'"),'Only explicit delivery RPC receives delivery scope')
    add('http','callback-normalized','terminal_body_and_unicode_identity_remain_exact',change('return dict(value)\n\n\ndef endpoint',"return {**value,'p_callback':{**value['p_callback'],'callbackId':'changed'}} if value['p_callback'] is not None else dict(value)\n\n\ndef endpoint"),'Terminal authority receives exact original callback including Unicode')
    add('http','unicode-metadata-expanded','large_utf8_callback_fits_private_metadata',change('            ensure_ascii=False, allow_nan=False, separators=', '            ensure_ascii=True, allow_nan=False, separators='),'Private dispatch metadata exceeds its bound')
    add('http','default-infers-delivery','default_rpc_cannot_accept_delivery_arguments',change('arguments = parameters(arguments) if self.rpc == DEFAULT_RPC else delivery_parameters(arguments)','arguments = delivery_parameters(arguments) if "p_operation" in arguments else parameters(arguments)'),'Private dispatch RPC read did not complete')
    add('http','constructor-arbitrary-rpc','unknown_rpc_constructor_refuses',omit('Private dispatch RPC selection differs'),'ValueError not raised')
    add('http','child-arbitrary-rpc','unknown_rpc_child_refuses_before_network',omit('Private dispatch RPC selection differs'),'Child independently refuses arbitrary RPC')
    for name in ('missing_original_reference_refuses','blank_original_reference_refuses'):
        add('http',name,name,omit('Private delivery RPC parameters differ'),'ValueError not raised')
    for name in ('unknown_operation_refuses','artifact_scope_cannot_carry_callback','terminal_scope_needs_callback'):
        add('http',name,name,omit('Private delivery RPC operation differs'),'ValueError not raised')
    add('http','nonfinite-callback-accepted','nonfinite_callback_refuses_before_network',change('raw = json.dumps(value[\'p_callback\'], ensure_ascii=False, allow_nan=False','raw = json.dumps(value[\'p_callback\'], ensure_ascii=False, allow_nan=True'),'Out of range float values are not JSON compliant')
    add('http','callback-body-unbounded','oversized_callback_refuses_before_network',omit('Private delivery callback exceeds its bound'),'ValueError not raised')
    for kind,path in tests.items():
        census={n.name for n in ast.walk(ast.parse(original[path])) if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')}
        if {c[2] for c in cases if c[0]==kind}!=census:raise ValueError('Every changed delivery test needs a fault: '+kind)
    outcomes=[];oracles=None
    def restore():
        for p,raw in original.items():p.write_bytes(raw)
    def execute(label,kind=None,target=None):
        files=[tests[kind]] if kind else list(tests.values())
        output='';code=0
        for path in files:
            r=subprocess.run([sys.executable,'-B',str(path)]+(['Checks.'+target] if target else []),cwd=folder,capture_output=True,timeout=30,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
            code=max(code,r.returncode);output+=(r.stdout+r.stderr).decode(errors='replace')
        (out/(label+'.log')).write_text(output);return code,output
    def positive(label):
        code,log=execute(label)
        assert code==0 and 'Ran 25 tests' in log and 'Ran 13 tests' in log,'Complete38-case delivery authority cohort: '+label
        outcomes.append({'control':label,'outcome':'survived'});print(label+' survived',flush=True)
    try:
        positive('baseline')
        for p in sources.values():p.write_bytes(original[p]+b'\n# Harmless current delivery authority note.\n')
        positive('harmless');restore();positive('restored-after-harmless')
        for kind,label,target,transform,reason in cases:
            try:
                p=sources[kind];t=transform(original[p].decode());ast.parse(t);p.write_text(t)
                code,log=execute(label,kind,target)
                assert oracle.intended_failure(code,log,target,reason),'Delivery fault diagnostic must match: '+label+'\n'+log
                if oracles is None:oracles=helper.challenge_oracle(oracle,code,log,target,reason)
                outcomes.append({'control':label,'test':target,'outcome':'intended_failure','reason':reason});print(label+' intended failure',flush=True)
            finally:restore()
        positive('restored-final');assert all(p.read_bytes()==raw for p,raw in original.items()),'All delivery source restores exactly'
        (out/'controls.json').write_text(json.dumps(outcomes,indent=2)+'\n');(out/'oracle-controls.json').write_text(json.dumps(oracles,indent=2)+'\n');(out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in original},indent=2)+'\n');print({'cases':38,'positive':4,'faults':len(cases)})
    finally:restore()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
