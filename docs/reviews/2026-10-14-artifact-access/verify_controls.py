"""Challenge original artifact access and restore source bytes in finally."""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys


def swap(text, before, after):
    if text.count(before) != 1:
        raise ValueError('Artifact access mutation anchor must be unique: '+before)
    return text.replace(before, after, 1)


def disable(text, message):
    tree=ast.parse(text)
    found=[n for n in ast.walk(tree) if isinstance(n,ast.If) and any(
        isinstance(s,ast.Raise) and isinstance(s.exc,ast.Call) and s.exc.args
        and isinstance(s.exc.args[0],ast.Constant) and s.exc.args[0].value==message for s in n.body)]
    if len(found)!=1:raise ValueError('Artifact access guard anchor must be unique: '+message)
    found[0].test=ast.Constant(False)
    return ast.unparse(tree)+'\n'


def challenge_oracle(oracle,code,log,target,reason):
    import re
    positive=[('baseline',code,log,target,reason),('harmless-prefix',code,'# Harmless note\n'+log,target,reason),('restored',code,log,target,reason)]
    faults=[('success-exit',0,log,target,reason),('boolean-exit',True,log,target,reason),('other-exit',2,log,target,reason),
        ('wrong-test',code,log.replace(target,'test_other'),target,reason),('missing-reason',code,log.replace(reason,'different'),target,reason),
        ('wrong-count',code,log.replace('Ran 1 test','Ran 2 tests'),target,reason),('missing-summary',code,re.sub(r'(?m)^FAILED .*$', '',log),target,reason),
        ('extra-test',code,log+'\nFAIL: test_other (other.Checks.test_other)\n',target,reason),
        ('earlier-decoy',code,reason+'\n'+log.replace(reason,'different'),target,reason),
        ('later-unrelated-error',code,re.sub(r'(?m)^FAILED .*$',lambda m:'KeyError: unrelated\n'+m.group(),log),target,reason)]
    results=[]
    for name,c,o,test,r in positive:
        assert oracle.intended_failure(c,o,test,r),'Oracle positive must survive: '+name
        results.append({'control':name,'outcome':'survived'})
    for name,c,o,test,r in faults:
        assert not oracle.intended_failure(c,o,test,r),'Oracle fault must refuse: '+name
        results.append({'control':name,'outcome':'intended_refusal'})
    return results


def run(repo,out):
    os.umask(0o077);out.mkdir(mode=0o700,parents=True)
    source=repo/'workers/odm_worker/runtime_artifact_access.py'
    helper=repo/'workers/odm_worker/retained_source.py'
    tests=source.with_name('test_runtime_artifact_access.py')
    original={p:p.read_bytes() for p in (source,helper,tests)}
    spec=importlib.util.spec_from_file_location('retention_oracles',repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py')
    oracle=importlib.util.module_from_spec(spec);spec.loader.exec_module(oracle)
    census={n.name for n in ast.walk(ast.parse(original[tests])) if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')}
    cases=[]
    def add(label,test,transform,reason,file=source):cases.append((label,test,transform,reason,file))
    def changed(before,after):return lambda t:swap(t,before,after)
    def omitted(message):return lambda t:disable(t,message)
    def test(name):return 'test_'+name
    add('scope-not-original',test('original_scope_roster_urls_and_private_records'),changed("'targetId': self.dispatch.target, 'requestId': request_id,","'targetId': 'other-target', 'requestId': request_id,"),'original descriptor binding differs')
    add('replay-regenerates-token',test('replay_keeps_token_expiry_and_inode'),changed("lease = self._load(root, manifest)\n                if", "lease = self._load(root, manifest)\n                secrets.token_urlsafe(32)\n                if"),'Replay cannot replace token')
    add('interrupted-token-replaced',test('interrupted_lease_recovers_original'),changed("lease = self._load(root, manifest)\n                if", "lease = self._load(root, manifest)\n                secrets.token_urlsafe(32)\n                if"),'Recovery cannot replace token')
    for suffix in ('changed_base_refuses_redirect','changed_expiry_refuses_renewal'):
        add(suffix,test(suffix),omitted('Artifact access cannot renew or redirect an original lease'),'ValueError not raised')
    add('expiry-ignored',test('expiry_refuses_prepare_and_serve'),omitted('Artifact access original lease expired'),'PermissionError not raised')
    for suffix in ('revocation_precedes_preparation','revocation_after_lease_prevents_completion'):
        add(suffix,test(suffix),omitted('Artifact access current original actor refused'),'PermissionError not raised')
    add('nonboolean-authority',test('nonboolean_authority_refuses'),omitted('Artifact access authority must return a boolean'),'ValueError not raised')
    add('stream-discards-final-byte',test('original_bytes_and_descriptor'),changed('self._write(output, final, lambda:', 'self._write(output, final[:-1], lambda:'),'Download serves exact original bytes')
    add('serve-reenters-processing',test('completed_processing_does_not_reenter_stages'),changed("root, engine = self.plan.inspection.products.intake.observer._original(request_id, deadline)","self.plan.advance(request_id, observation_hash)\n        root, engine = self.plan.inspection.products.intake.observer._original(request_id, deadline)"),'Serving cannot reenter processing')
    for suffix in ('wrong_token_refuses_before_output','wrong_job_refuses'):
        add(suffix,test(suffix),omitted('Artifact access original URL identity differs'),'PermissionError not raised')
    add('absent-file-granted',test('unavailable_file_refuses'),changed("row = next((r for r in lease['artifacts'] if r['filename'] == filename), None)","row = lease['artifacts'][0]"),'FileNotFoundError not raised')
    add('unknown-file-granted',test('traversal_file_refuses'),changed("row = next((r for r in lease['artifacts'] if r['filename'] == filename), None)","row = lease['artifacts'][0]"),'FileNotFoundError not raised')
    add('size-precheck-omitted',test('size_refuses_before_output'),omitted('Artifact access original file size differs'),'original file checksum differs')
    add('checksum-ignored',test('checksum_refuses_complete_body'),omitted('Artifact access original file checksum differs'),'ValueError not raised')
    add('final-actor-access-omitted',test('revocation_during_stream_withholds_final_chunk'),changed("        self._check(request_id, deadline)\n        self._authority(lease['binding'], deadline)\n        self._live(lease)","        self._check(request_id, deadline)\n        self._live(lease)"),'PermissionError not raised')
    add('stream-expiry-ignored',test('expiry_during_stream_withholds_final_chunk'),omitted('Artifact access original lease expired'),'PermissionError not raised')
    # Keep the local check but suppress only the reported owner loss for this target.
    add('owner-loss-ignored',test('owner_loss_during_stream_withholds_final_chunk'),changed("        self.dispatch._check(request_id, deadline)\n        check_time(deadline)","        self.dispatch.runtime._owned = True\n        self.dispatch._check(request_id, deadline)\n        check_time(deadline)"),'ValueError not raised')
    add('lease-binding-ignored',test('saved_lease_alteration_refuses'),omitted('Artifact access saved original lease differs'),'original completion differs')
    add('completion-ignored',test('saved_completion_alteration_refuses'),omitted('Artifact access original completion differs'),'ValueError not raised')
    add('lost-lease-inferred',test('missing_lease_cannot_be_replaced'),omitted('Artifact access completion has no original lease'),'Existing source custody record differs')
    add('observation-substituted',test('changed_observation_refuses'),changed("'originalTaskUuid': engine['taskUuid'], 'observationSha256': observation_hash", "'originalTaskUuid': engine['taskUuid'], 'observationSha256': manifest['binding']['observationSha256']"),'ValueError not raised')
    add('symlink-followed',test('symlink_product_refuses'),changed("file = os.open(parts[-1], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folder)","file = os.open(parts[-1], os.O_RDONLY | os.O_NONBLOCK, dir_fd=folder)"),'Source file changed during custody',helper)
    add('hardlink-allowed',test('hardlink_product_refuses'),changed(' or info.st_nlink != 1',''),'ValueError not raised',helper)
    add('deadline-extended',test('expired_deadline_refuses'),changed('deadline = min(time.monotonic()+self.timeout, deadline) if deadline is not None else time.monotonic()+self.timeout','deadline = time.monotonic()+self.timeout'),'TimeoutError not raised')
    add('owner-invented',test('no_owner_refuses'),changed("        deadline = time.monotonic()+self.timeout\n        root, manifest", "        self.dispatch.runtime._owned = True\n        deadline = time.monotonic()+self.timeout\n        root, manifest"),'ValueError not raised')
    add('short-write-dropped',test('partial_writes_keep_every_byte'),changed('view = view[count:]','view = view[len(view):]'),'Partial writes keep every original byte')
    add('stalled-output-accepted',test('no_progress_output_refuses'),changed("                raise OSError('Artifact access output made no progress')","                return"),'OSError not raised')
    add('unserved-prefix-accepted',test('path_prefix_refuses_before_lease_publication'),changed("or parsed.path not in ('', '/')","or False"),'ValueError not raised')
    add('credential-base-accepted',test('invalid_base_refuses'),lambda t:t.replace(' or parsed.username','').replace('or parsed.password or','or'),'ValueError not raised')
    add('empty-query-base-accepted',test('invalid_base_refuses'),changed("or '?' in value or '#' in value","or '#' in value"),'ValueError not raised')
    add('empty-fragment-base-accepted',test('invalid_base_refuses'),changed("or '?' in value or '#' in value","or '?' in value"),'ValueError not raised')
    add('infinite-expiry-accepted',test('nonfinite_expiry_refuses'),changed("            raise ValueError('Artifact access expiry must be finite and positive')", "            expires_at = 1100"),'ValueError not raised')
    add('constructor-accepts-no-authority',test('invalid_constructor_refuses'),omitted('Artifact access needs original descriptors and scoped authority'),'ValueError not raised')
    add('constructor-accepts-zero-timeout',test('invalid_constructor_refuses'),omitted('Artifact access needs a finite positive deadline'),'ValueError not raised')
    add('partial-loop-owner-unchecked',test('owner_loss_during_final_partial_write_refuses'),lambda t:t.replace('            check()\n','').replace('        check()\n',''),'ValueError not raised')
    add('resume-renews-original',test('resume_uses_saved_settings_after_interruption'),changed('return self.prepare(request_id, observation_hash)','return self.prepare(request_id, observation_hash, public_base_url="https://other.example", expires_at=self.clock()+1000)'),'cannot renew or redirect')
    add('resume-invents-lease',test('resume_without_original_refuses'),changed("            raise ValueError('Artifact access resume requires its original lease')", "            with self.dispatch.runtime.owner():\n                return self.prepare(request_id, observation_hash, public_base_url='https://worker.example', expires_at=1100)"),'ValueError not raised')
    add('duplicate-filename-accepted',test('duplicate_filename_refuses'),changed(" or row.get('filename') in filenames",''),'original upstream descriptors differ')
    add('upstream-hashes-ignored',test('upstream_receipt_change_refuses'),omitted('Artifact access original upstream receipts differ'),'original upstream descriptors differ')
    add('upstream-descriptors-ignored',test('self_consistent_changed_descriptor_refuses'),omitted('Artifact access original upstream descriptors differ'),'ValueError not raised')
    add('stream-lease-change-ignored',test('lease_change_during_stream_refuses_complete_body'),omitted('Artifact access lease changed during download'),'ValueError not raised')
    add('partial-loop-deadline-unchecked',test('deadline_during_final_partial_write_refuses'),lambda t:t.replace('            check()\n','').replace('        check()\n',''),'TimeoutError not raised')
    add('numeric-plan-permission-accepted',test('numeric_plan_permission_refuses'),changed("json_bytes(receipt) != json_bytes({'format': PLAN_FORMAT,\n                    'scope': 'private_original_artifact_preparation', 'manifestSha256': checksum(manifest), **LIMITS})", "receipt != {'format': PLAN_FORMAT,\n                    'scope': 'private_original_artifact_preparation', 'manifestSha256': checksum(manifest), **LIMITS}"),'ValueError not raised')
    add('numeric-lease-permission-accepted',test('numeric_lease_permission_refuses'),changed("json_bytes(lease) != json_bytes(self._lease(manifest,\n                lease.get('publicBaseUrl'), lease.get('expiresAt'), lease.get('token')))","lease != self._lease(manifest,\n                lease.get('publicBaseUrl'), lease.get('expiresAt'), lease.get('token'))"),'original completion differs')
    add('numeric-completion-permission-accepted',test('numeric_completion_permission_refuses'),changed("json_bytes(receipt) != json_bytes({'format': FORMAT, 'scope': SCOPE, 'leaseSha256': checksum(lease), 'terminalCallbackPermission': False})", "receipt != {'format': FORMAT, 'scope': SCOPE, 'leaseSha256': checksum(lease), 'terminalCallbackPermission': False}"),'ValueError not raised')
    add('contract-coverage-omitted',test('changed_contract_coverage_refuses'),omitted('Artifact access original contract coverage differs'),'ValueError not raised')
    add('manifest-object-omitted',test('nonobject_original_manifest_refuses'),omitted('Artifact access original manifest must be an object'),"has no attribute 'get'")
    add('stream-receipt-type-change-ignored',test('receipt_type_change_during_stream_refuses_complete_body'),changed("json_bytes(read_json(root/'private-artifact-access', 'receipt.json')) != json_bytes(receipt)","read_json(root/'private-artifact-access', 'receipt.json') != receipt"),'ValueError not raised')
    if {c[1] for c in cases}!=census:raise ValueError('Every artifact-access test needs a targeted fault')
    outcomes=[];oracles=None
    def restore():
        for p,raw in original.items():p.write_bytes(raw)
    def execute(label,target=None):
        r=subprocess.run([sys.executable,'-B',str(tests)]+(['Checks.'+target] if target else []),cwd=source.parent,capture_output=True,timeout=90,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        log=(r.stdout+r.stderr).decode(errors='replace');(out/(label+'.log')).write_text(log);return r.returncode,log
    def positive(label):
        code,log=execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in log:raise AssertionError(label+' positive failed\n'+log)
        outcomes.append({'control':label,'outcome':'survived'});print(label+' survived',flush=True)
    try:
        positive('baseline');source.write_bytes(original[source]+b'\n# Harmless original artifact access note.\n');positive('harmless');restore();positive('restored-after-harmless')
        for label,target,transform,reason,file in cases:
            try:
                changed_text=transform(original[file].decode());ast.parse(changed_text);file.write_text(changed_text)
                code,log=execute(label,target)
                if not oracle.intended_failure(code,log,target,reason):raise AssertionError(label+' target/diagnostic differs\n'+log)
                if oracles is None:oracles=challenge_oracle(oracle,code,log,target,reason)
                outcomes.append({'control':label,'test':target,'outcome':'intended_failure','reason':reason});print(label+' intended failure',flush=True)
            finally:restore()
        positive('restored-final')
        assert all(p.read_bytes()==raw for p,raw in original.items()),'Every artifact source restores exactly'
        (out/'controls.json').write_text(json.dumps(outcomes,indent=2)+'\n');(out/'oracle-controls.json').write_text(json.dumps(oracles,indent=2)+'\n');(out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in original},indent=2)+'\n');print({'tests':len(census),'faults':len(cases),'positive':4})
    finally:restore()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
