"""Challenge durable HTTP lookup, refusal and streaming boundaries serially."""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result)
    return result


def run(repo,out,*,fault_probes_only=False):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True)
    folder=repo/'workers/odm_worker'
    helper=load(repo/'docs/reviews/2026-10-14-artifact-access/verify_controls.py','access_controls')
    oracle=load(repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py','retention_oracle')
    http=folder/'runtime_artifact_http.py';journal=folder/'admission_journal.py'
    access=folder/'runtime_artifact_access.py';main=folder/'main.py'
    tests=[folder/'test_reference_lookup.py',folder/'test_runtime_artifact_http.py',folder/'test_artifact_socket_backpressure.py']
    original={p:p.read_bytes() for p in [http,journal,access,main,*tests]}
    census={(p.stem,n.name) for p in tests for n in ast.walk(ast.parse(original[p]))
            if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')}
    cases=[]
    def add(label,module,test,file,transform,reason):cases.append((label,module,'test_'+test,file,transform,reason))
    def changed(before,after):return lambda t:helper.swap(t,before,after)
    def omitted(message):return lambda t:helper.disable(t,message)
    def h(label,test,file,transform,reason):add(label,'test_runtime_artifact_http',test,file,transform,reason)
    def j(label,test,transform,reason):add(label,'test_reference_lookup',test,journal,transform,reason)
    j('lookup-drops-context','original_reference_reloads_complete_row',changed('            return found\n','            return None\n'),'Reference lookup preserves every original admission field')
    j('lookup-selects-unrelated','missing_reference_returns_no_admission',changed("            return found\n","            return self.read(connection, connection.execute('SELECT request_id FROM admissions LIMIT 1').fetchone()[0]) if found is None else found\n"),'Unknown reference cannot select another admission')
    j('lookup-input-unguarded','invalid_reference_refuses_before_connection',changed('if not isinstance(reference, str) or not 1 <= len(reference) <= 256:', 'if False:'),'ValueError not raised')
    j('lookup-corruption-inferred','corrupted_original_admission_refuses',changed('            found = self.read(connection, row[0]) if row is not None else None','            try:found = self.read(connection, row[0]) if row is not None else None\n            except ValueError:return None'),'ValueError not raised')
    j('lookup-started-context-dropped','started_reference_keeps_original_context_after_reopen',changed('            return found\n','            return None\n'),'Reference lookup keeps the original started context after restart')
    j('lookup-foreign-row-allowed','foreign_reloaded_reference_refuses',changed('if found is not None and found.job_reference != reference:','if False:'),'ValueError not raised')
    h('http-drops-original-bytes','original_bytes_headers_and_no_memory_token_registry',http,changed('handler.wfile.write(body)','handler.wfile.write(body[:-1])'),'Durable original bytes reach actual HTTP')
    h('http-token-preflight-omitted','wrong_token_refuses_before_product_bytes',http,changed("if lease['binding']['jobReference']!=reference or not hmac.compare_digest(token,lease['token']):",'if False:'),'FileNotFoundError not raised')
    h('http-falls-back-to-legacy','missing_reference_cannot_fall_back_to_legacy_registry',main,changed('            if download is not None:', '            if download is not None and self.path.split("/")[2] not in ARTIFACTS:'),'Explicit durable route never falls back to legacy tokens')
    h('http-expiry-status-collapsed','expired_original_is_not_renewed',http,changed('status=410','status=403'),'Original expiry reaches HTTP')
    h('http-authority-refusal-collapsed','revoked_actor_receives_no_product',http,changed('else 403 if isinstance(error,PermissionError) else 503','else 503'),'Current original actor refusal reaches HTTP')
    h('http-query-allowed','noncanonical_or_traversal_paths_refuse',http,lambda t:helper.swap(helper.swap(t," or '?' in value or '#' in value",''),"parts=value.split('/')","parts=value.split('?',1)[0].split('/')"),'Noncanonical URL cannot reach a retained file')
    h('http-absent-product-status','absent_and_unselected_products_refuse',http,changed('status=404 if isinstance(error,FileNotFoundError)','status=503 if isinstance(error,FileNotFoundError)'),'Unavailable product remains unavailable')
    h('http-owner-preflight-ignored','unowned_runtime_refuses_before_bytes',http,changed("if not self.runtime._owned:raise InterruptedError('Artifact HTTP original ownership ended')","self.runtime._owned=True"),'Unowned runtime cannot release retained bytes')
    h('http-checksum-ignored','checksum_refusal_withholds_complete_http_body',access,omitted('Artifact access original file checksum differs'),'Checksum refusal closes incomplete HTTP body')
    h('http-size-preflight-omitted','size_refusal_precedes_headers',http,omitted('Artifact HTTP original file size differs'),'ValueError not raised')
    h('http-missing-receipt-inferred','missing_receipt_cannot_serve',http,changed('status=404 if isinstance(error,FileNotFoundError)','status=503 if isinstance(error,FileNotFoundError)'),'Missing original completion cannot serve bytes')
    h('http-receipt-types-ignored','changed_receipt_refuses',http,omitted('Artifact HTTP original lease receipt differs'),'ValueError not raised')
    h('http-reenters-processing','current_processing_reader_is_not_reentered',http,changed('self.access.serve(request,observation,reference,token,filename,Output(),deadline=deadline,','self.access.plan.inspection.products.intake.observer.reader.observe(request)\n            self.access.serve(request,observation,reference,token,filename,Output(),deadline=deadline,'),'Download cannot reenter active processing')
    h('http-request-log-leaks-token','logs_never_include_original_token_or_request_url',main,changed("print(f'[odm-worker] HTTP {method} status {status}.')","print(f'[odm-worker] HTTP {method} status {status}. '+self.path)"),'HTTP logs cannot contain original token')
    h('http-error-log-leaks-token','logs_never_include_original_token_or_request_url',main,changed("print('[odm-worker] HTTP request.')","print(fmt % args)"),'HTTP logs cannot contain original token')
    h('http-runtime-mismatch-allowed','handler_requires_same_original_runtime',main,omitted('Artifact HTTP server needs the same original admission runtime'),'ValueError not raised')
    h('http-unbounded-constructor','constructor_refuses_unbounded_socket_deadlines',http,omitted('Artifact HTTP needs original access and bounded socket writes'),'ValueError not raised')
    h('http-copy-uses-lost-memory','whole_copied_root_recovers_lookup_token_and_bytes',journal,changed("row = connection.execute('SELECT request_id FROM admissions WHERE job_reference=?',","row = connection.execute('SELECT request_id FROM admissions WHERE job_reference=? AND 0=1',"),'Copied original root recovers durable HTTP bytes')
    h('http-journal-failure-unhandled','database_read_failure_returns_bounded_refusal',http,changed(',sqlite3.Error)',')'),'Unavailable journal must return bounded HTTP refusal, not an abandoned response')
    h('http-midstream-actor-ignored','actor_revocation_after_first_chunk_withholds_complete_body',access,omitted('Artifact access current original actor refused'),'Midstream actor refusal closes incomplete HTTP')
    h('http-midstream-owner-ignored','original_ownership_loss_after_first_chunk_closes_http',access,changed('        self.dispatch._check(request_id, deadline)\n','        self.dispatch.runtime._owned=True\n        self.dispatch._check(request_id, deadline)\n'),'Lost original ownership closes incomplete HTTP')
    h('http-socket-timeout-omitted','stream_write_deadline_is_applied_to_actual_socket',http,lambda t:t.replace('handler.connection.settimeout(min(self.write_timeout,max(.001,deadline-time.monotonic())))','handler.connection.settimeout(None)'),'Every actual artifact socket has a finite write bound')
    for label,test,reason in (
            ('http-selected-lease-unbound','selected_lease_hash_binds_stream_before_headers','Stream refuses a different selected HTTP lease before headers'),
            ('http-invalid-lease-digest-allowed','invalid_selected_lease_digest_refuses','ValueError not raised')):
        h(label,test,access,omitted('Artifact access selected HTTP lease differs'),reason)
    # Remove the adapter checks only. The retained reader still checks before
    # Output.write and after it, isolating the header-to-first-body-byte gap.
    def header_gap(t):
        t=helper.swap(t,"                    self.access._authority(lease['binding'],deadline)","                    pass")
        return helper.swap(t,'                check();self.access._live(lease)','                pass')
    for label,test,reason in (
            ('http-header-owner-gap','ownership_ending_during_headers_prevents_first_body_byte','Ownership loss during headers releases no product bytes'),
            ('http-header-actor-gap','actor_revocation_during_headers_prevents_first_body_byte','Actor revocation during headers releases no product bytes'),
            ('http-header-expiry-gap','expiry_during_headers_prevents_first_body_byte','Expiry during headers releases no product bytes'),
            ('http-header-deadline-gap','deadline_expiring_during_headers_prevents_first_body_byte','Deadline during headers releases no product bytes')):
        h(label,test,http,header_gap,reason)
    add('http-real-stalled-client-unbounded','test_artifact_socket_backpressure','nonreading_client_releases_owned_handler',http,lambda t:t.replace('handler.connection.settimeout(min(self.write_timeout,max(.001,deadline-time.monotonic())))','handler.connection.settimeout(None)'),'Nonreading client must release the owned HTTP handler before its whole-stage deadline')
    if {(m,t) for _,m,t,_,_,_ in cases}!=census:raise ValueError('Every HTTP/reference test needs a fault')
    results=[];oracles=None
    def restore():
        for path,raw in original.items():path.write_bytes(raw)
    def execute(label,module=None,target=None):
        names=[module+'.Checks.'+target] if target else [p.stem for p in tests]
        result=subprocess.run([sys.executable,'-B','-m','unittest',*names,'-v'],cwd=folder,
            env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'},capture_output=True,timeout=120)
        log=(result.stdout+result.stderr).decode(errors='replace');(out/(label+'.log')).write_text(log)
        return result.returncode,log
    def positive(label):
        code,log=execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in log:raise AssertionError(label+' positive failed\n'+log)
        results.append({'control':label,'outcome':'survived'});print(label+' survived',flush=True)
    try:
        if not fault_probes_only:
            positive('baseline');http.write_bytes(original[http]+b'\n# Harmless HTTP adapter note.\n');positive('harmless');restore();positive('restored-after-harmless')
        for label,module,test,path,transform,reason in cases:
            try:
                text=transform(original[path].decode());ast.parse(text);path.write_text(text)
                code,log=execute(label,module,test)
                if not oracle.intended_failure(code,log,test,reason):raise AssertionError(label+' diagnostic differs\n'+log)
                if oracles is None:oracles=helper.challenge_oracle(oracle,code,log,test,reason)
                results.append({'control':label,'test':test,'outcome':'intended_failure','reason':reason});print(label+' intended failure',flush=True)
            finally:restore()
        if not fault_probes_only:positive('restored-final')
        assert all(p.read_bytes()==raw for p,raw in original.items()),'HTTP sources restore exactly'
        (out/'controls.json').write_text(json.dumps(results,indent=2)+'\n')
        (out/'oracle-controls.json').write_text(json.dumps(oracles,indent=2)+'\n')
        (out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(raw).hexdigest() for p,raw in original.items()},indent=2)+'\n')
        print({'tests':len(census),'faults':len(cases),'positive':0 if fault_probes_only else 4,'diagnosticOnly':fault_probes_only},flush=True)
    finally:restore()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--repo',type=Path,required=True);parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--fault-probes-only',action='store_true',help='Diagnostic only; omits full positive cohorts and establishes no acceptance')
    args=parser.parse_args();run(args.repo.resolve(),args.out.resolve(),fault_probes_only=args.fault_probes_only)
