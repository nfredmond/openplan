"""Challenge explicit operator configuration binding and restore source/test bytes."""
import argparse,ast,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def run(repo,out):
    os.umask(0o077);out.mkdir(parents=True,mode=0o700)
    folder=repo/'workers/odm_worker';source=folder/'runtime_configuration.py';tests=folder/'test_runtime_configuration.py'
    originals={p:p.read_bytes() for p in (source,tests)}
    helper=load(repo/'docs/reviews/2026-10-14-artifact-access/verify_controls.py','execution_helpers')
    local=load(repo/'docs/reviews/2026-10-14-outcome-recovery/verify_controls.py','execution_oracle')
    base=load(repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py','execution_base')
    def swap(a,b):return lambda text:helper.swap(text,a,b)
    cases=[]
    def add(label,test,change,reason):cases.append((label,'test_'+test,change,reason))
    add('exact-replay','exact_seal_replays_and_owned_check_preserves_inode',swap("        return saved", "        return {}"),'Original settings replay without replacement')
    for field in ('target','engine'):
        add('changed-'+field,'changed_'+field+'_cannot_reuse_original_seal',lambda text:helper.disable(text,'Saved operator configuration differs'),'ValueError not raised')
    add('installation','installation_mismatch_refuses_before_publication',lambda text:helper.disable(text,'Operator binding installation differs'),'ValueError not raised')
    add('existing-admission','existing_admission_requires_adoption',lambda text:helper.disable(text,'Original admissions require explicit operator configuration adoption'),'ValueError not raised')
    add('existing-record','existing_private_record_requires_adoption',lambda text:helper.disable(text,'Original retained records require explicit operator configuration adoption'),'ValueError not raised')
    add('owned-establish','owned_establish_refuses_before_writer',lambda text:helper.disable(text,'Operator binding precedes lifetime ownership'),'Owned establish cannot reacquire runtime writer')
    add('unowned-read','unowned_check_refuses_before_record_read',lambda text:helper.disable(text,'Operator configuration reads require lifetime ownership'),'Unowned configuration cannot read private record')
    add('saved-size','oversized_saved_record_refuses_before_read',lambda text:helper.disable(text,'Saved operator configuration exceeds its bound'),'Oversized configuration cannot allocate record bytes')
    add('saved-length','short_saved_read_refuses',lambda text:helper.disable(text,'Saved operator configuration length differs'),'ValueError not raised')
    add('saved-canonical','noncanonical_saved_record_refuses',swap('if raw!=json_bytes(saved) or raw!=json_bytes(self.value):','if json_bytes(saved)!=json_bytes(self.value):'),'ValueError not raised')
    add('exact-fields','unknown_config_field_refuses',swap('set(value)!=FIELDS','not FIELDS.issubset(value)'),'ValueError not raised')
    add('reference-empty','reference_fields_refuse_empty_values',lambda text:helper.disable(text,'Original operator configuration references differ'),'ValueError not raised')
    add('http-opt-in','application_http_requires_explicit_opt_in',swap("endpoint(value['applicationEndpoint'],value['allowApplicationHttp'])","endpoint(value['applicationEndpoint'],True)"),'ValueError not raised')
    add('public-prefix','public_prefix_refuses_before_binding',swap("public=base_url(value['publicBaseUrl'])","public=value['publicBaseUrl']"),'ValueError not raised')
    add('daemon-owner','daemon_uid_refuses_boolean_and_negative',lambda text:helper.disable(text,'Original operator daemon owner differs'),'ValueError not raised')
    add('bounds-fields','bounds_projection_refuses_extra_and_missing_fields',lambda text:helper.disable(text,'Original operator bounds fields differ'),'ValueError not raised')
    add('deadlines','deadlines_refuse_nonfinite_and_boolean',swap('if type(item) not in (int,float) or not math.isfinite(item) or item<=0:', 'if item is not True and (type(item) not in (int,float) or not math.isfinite(item) or item<=0):'),'ValueError not raised')
    add('integer-limits','byte_and_entry_limits_refuse_boolean_and_zero',lambda text:helper.disable(text,'Original operator byte and entry limits must be positive integers'),'ValueError not raised')
    add('runtime-type','runtime_type_refuses_before_configuration_reads',lambda text:helper.disable(text,'Operator binding needs its original runtime'),'Foreign runtime cannot parse operator settings')
    add('binding-timeout','binding_timeout_refuses_nonfinite_before_configuration',lambda text:helper.disable(text,'Operator binding deadline must be finite and positive'),'Invalid binding deadline cannot parse operator settings')
    add('root-overlap','overlapping_roots_refuse_before_publication',lambda text:helper.disable(text,'Operator source and runtime roots must not overlap'),'ValueError not raised')
    add('caller-detachment','canonical_configuration_is_detached_from_caller',swap('self.value=configuration(value)','self.value=value'),'Caller mutations cannot alter the bound configuration')
    add('binding-mutation','mutated_bound_value_refuses_before_private_read',lambda text:helper.disable(text,'Bound operator configuration changed'),'Changed bound settings cannot read private record')
    add('new-size','new_configuration_size_limit_refuses',lambda text:helper.disable(text,'Original operator configuration exceeds its bound'),'Oversized new configuration cannot parse record bytes')
    add('admission-serialization','configuration_publication_holds_admission_writer',swap('                publish(self.runtime.root,NAME,json_bytes(self.value))','                connection.execute("COMMIT")\n                publish(self.runtime.root,NAME,json_bytes(self.value))'),'Configuration publication must retain admission transaction')
    add('interrupted-publication','interrupted_after_publication_replays_exact_settings',swap('if path.exists() or path.is_symlink():return self._read()','if path.exists() or path.is_symlink():raise ValueError("Original seal replay disabled")'),'Original seal replay disabled')
    add('fresh-value-change','mutated_fresh_value_refuses_before_writer_and_publication',swap("        self._value()\n        deadline=time.monotonic()+self.timeout", "        deadline=time.monotonic()+self.timeout"),'Changed fresh settings cannot acquire runtime writer')
    add('locked-value-change','value_change_during_establishment_refuses_before_publication',swap('                self._value()\n                publish(self.runtime.root,NAME,json_bytes(self.value))','                publish(self.runtime.root,NAME,json_bytes(self.value))'),'Changed locked settings cannot publish original seal')
    add('prepublication-recovery','prepublication_interruption_recovers_safe_temporary',swap('                clear_unpublished(self.runtime.root)','                pass'),'Resumed configuration removes unpublished temporary')
    for kind in ('unknown','symlink','hardlink'):
        add(kind+'-temporary',kind+'_temporary_refuses_before_publication',swap('                clear_unpublished(self.runtime.root)','                pass'),'Unsafe temporary cannot publish configuration')
    add('runtime-reference','replaced_runtime_refuses_before_foreign_writer',lambda text:helper.disable(text,'Operator binding original runtime changed'),'Replaced runtime cannot acquire foreign writer')
    add('root-reference','replaced_runtime_root_refuses_before_writer',lambda text:helper.disable(text,'Operator binding original runtime changed'),'Changed runtime root cannot acquire foreign writer')
    add('journal-reference','replaced_runtime_journal_refuses_before_writer',lambda text:helper.disable(text,'Operator binding original runtime changed'),'Changed runtime journal cannot acquire writer')
    add('journal-root-reference','replaced_journal_root_cannot_bypass_original_admission',lambda text:helper.disable(text,'Operator binding original runtime changed'),'Changed admission root cannot acquire writer')
    add('initial-journal-root','constructor_refuses_unjoined_admission_root_before_configuration',lambda text:helper.disable(text,'Operator binding admission root differs'),'Foreign admission root cannot parse operator settings')
    add('policy-projection','network_policy_refuses_extra_fields',lambda text:helper.disable(text,'Original operator network policy fields differ'),'ValueError not raised')
    add('callback-redirects','callback_policy_refuses_redirect_permission',lambda text:helper.disable(text,'Original callback policy cannot permit redirects'),'ValueError not raised')
    add('network-replay','network_policy_replay_refuses_changed_allowlist',lambda text:helper.disable(text,'Saved operator configuration differs'),'ValueError not raised')
    census={n.name for n in ast.walk(ast.parse(originals[tests])) if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')}
    if {c[1] for c in cases}!=census:raise ValueError('Every configuration case needs its own fault')
    controls=[]
    def restore():
        for p,raw in originals.items():p.write_bytes(raw)
    def execute(label,target=None):
        r=subprocess.run([sys.executable,'-B','-m','unittest','test_runtime_configuration'+('.Checks.'+target if target else '')],cwd=folder,capture_output=True,timeout=120,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
        log=(r.stdout+r.stderr).decode(errors='replace');(out/(label+'.log')).write_text(log);return r.returncode,log
    def positive(label):
        code,log=execute(label)
        if code or 'Ran '+str(len(census))+' tests' not in log:raise AssertionError(label+' positive differs\n'+log)
        controls.append({'control':label,'outcome':'survived'});print(label+' survived',flush=True)
    try:
        positive('baseline');source.write_bytes(originals[source]+b'\n# Harmless configuration note.\n');positive('harmless');restore();positive('restored-after-harmless')
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
