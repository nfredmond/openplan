"""Challenge explicit operator configuration binding and restore source/test bytes."""
import argparse,ast,hashlib,importlib.util,json,os,subprocess,sys
from pathlib import Path


def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m


def run(repo,out):
    os.umask(0o077);out.mkdir(parents=True,mode=0o700)
    folder=repo/'workers/odm_worker';source=folder/'runtime_bundle.py';tests=folder/'test_runtime_bundle.py'
    originals={p:p.read_bytes() for p in (source,tests)}
    helper=load(repo/'docs/reviews/2026-10-14-artifact-access/verify_controls.py','execution_helpers')
    local=load(repo/'docs/reviews/2026-10-14-outcome-recovery/verify_controls.py','execution_oracle')
    base=load(repo/'docs/reviews/2026-10-13-odm-task-observation-retention/verify_controls.py','execution_base')
    def swap(a,b):return lambda text:helper.swap(text,a,b)
    cases=[]
    def add(label,test,change,reason):cases.append((label,'test_'+test,change,reason))
    add('real-graph','real_graph_is_registered_without_credentials_or_network',swap('        self.download=CheckedDownload(self,self.access,timeout=timeout)','        self.download=CheckedDownload(self,self.access,timeout=timeout)\n        self.download.access=None'),'HTTP download uses original artifact access')
    add('idle-state','owned_empty_graph_is_idle_without_external_effects',swap('self.execution.step();self._check();return result','self.execution.step();self._check();return {**result,"state":"changed"}'),'Empty assembled graph remains idle')
    add('original-admission','admission_follows_configuration_seal',swap('result=self.runtime.submit(request);','result=self.runtime.submit({**request,"requestId":"changed-admission"});'),'Assembly retains exact admitted request')
    add('unowned-admission','unowned_admission_refuses_before_journal_write',swap('        self._check();result=self.runtime.submit(request);','        result=self.runtime.submit(request);'),'Unowned assembly cannot admit original request')
    add('changed-seal','changed_seal_refuses_before_execution',swap('        self.binding.check();self.execution._check()','        self.execution._check()'),'Changed assembly configuration cannot execute stage')
    add('component-reference','replaced_components_refuse_before_private_reads',lambda text:helper.disable(text,'Original assembly components changed'),'Changed assembly component cannot read configuration')
    add('native-profile','unsupported_engine_refuses_before_operator_seal',swap("        self.native_attest=Attestor(value['engine'],value['daemonSocket'],value['daemonUid'])","        self.native_attest=None"),'ValueError not raised')
    add('typed-adapters','noncallable_adapter_refuses_before_root_construction',lambda text:helper.disable(text,'Explicit worker assembly needs credential and option adapters'),'Invalid adapter cannot construct runtime')
    add('boolean-cancel','cancellation_requires_exact_boolean',lambda text:helper.disable(text,'Original assembly cancellation must be boolean'),'ValueError not raised')
    add('forward-cancel','true_cancellation_is_forwarded',swap('        return decision\n','        return False\n'),'Assembly forwards cancellation')
    add('photo-extensions','original_photo_extensions_survive_settings_projection',swap("names.append('image-'+str(index).zfill(5)+extension)","names.append('image-'+str(index).zfill(5)+'.jpg')"),'Assembly retains declared photo types')
    add('unknown-extension','unknown_photo_extension_refuses_before_preparation',lambda text:helper.disable(text,'Original assembly photo extension is unsupported'),'ValueError not raised')
    add('zip-scope','zip_settings_keep_original_scope_engine_and_bounds',swap("'targetId':value['targetId'],'maxBytes':bounds['sourceMaxBytes']","'targetId':'another-target','maxBytes':bounds['sourceMaxBytes']"),'Assembly retains original target')
    add('native-attestor-reference','replaced_attestor_refuses_before_original_commands',lambda text:helper.disable(text,'Original assembly components changed'),'Changed native attestor cannot read configuration')
    add('native-daemon-settings','changed_native_daemon_refuses_before_execution',lambda text:helper.disable(text,'Original assembly native attestation settings changed'),'Changed native daemon cannot execute stage')
    add('invalid-output-seal','invalid_output_range_refuses_before_configuration_seal',lambda text:helper.swap(helper.swap(text,'        self.binding.establish()\n',''),'        self.cancelled=cancelled;self.options=options','        self.binding.establish()\n        self.cancelled=cancelled;self.options=options'),'Invalid output range cannot seal unusable operator settings')
    add('direct-download-join','direct_download_refuses_changed_access_before_headers',lambda text:helper.disable(text,'Original assembly download joins changed'),'Changed download access cannot serve original bytes')
    add('native-cancellation','native_attestation_receives_cancellation_aware_ownership',swap('return decision and not self._cancelled()','return decision'),'Native observation stops when cancellation arrives')
    add('direct-download-runtime','direct_download_refuses_changed_runtime_before_headers',lambda text:helper.disable(text,'Original assembly download joins changed'),'Changed download runtime cannot serve original bytes')
    add('artifact-authority-wrapper','access_refuses_replaced_authority_before_base_read',swap('        self.bundle._check();super()._check(request_id,deadline)','        super()._check(request_id,deadline)'),'Changed download authority cannot read original bytes')
    add('refusal-socket-bound','early_download_refusal_bounds_write_and_restores_timeout',swap('                handler.connection.settimeout(.25)','                pass'),'Early refusal installs actual socket bound before output')
    add('refusal-io-contained','early_download_refusal_contains_io_failure',swap('            except OSError:pass\n            finally:', '            except OSError:raise\n            finally:'),'Simulated closed refusal socket')
    add('application-endpoint','changed_application_endpoint_refuses_before_credential_resolution',lambda text:helper.disable(text,'Original assembly application transport settings changed'),'Changed application endpoint cannot resolve original credentials')
    add('source-policy','changed_source_policy_refuses_before_fetch',lambda text:helper.disable(text,'Original assembly source transport settings changed'),'Changed source policy cannot enter source transport')
    add('application-transport-reference','replaced_application_transport_refuses_before_credentials',lambda text:helper.disable(text,'Original assembly components changed'),'Changed application transport cannot read configuration')
    add('draft-credential-resolver','changed_draft_resolver_refuses_before_original_transport',lambda text:helper.disable(text,'Original assembly draft transport settings changed'),'ValueError not raised')
    add('processing-authority-role','replaced_commit_authority_refuses_before_transport',lambda text:helper.disable(text,'Original assembly components changed'),'Changed processing authority cannot read configuration')
    add('draft-authority-role','replaced_draft_authority_refuses_before_transport',lambda text:helper.disable(text,'Original assembly components changed'),'Changed draft authority cannot read configuration')
    add('persistent-lease','changed_lease_bound_refuses_before_stage',lambda text:helper.disable(text,'Original assembly persistent settings changed'),'Changed lease bound cannot execute stage')
    add('persistent-output-budget','changed_output_budget_refuses_before_stage',lambda text:helper.disable(text,'Original assembly persistent settings changed'),'Changed output budget cannot execute stage')
    add('persistent-source-root','changed_source_root_refuses_before_stage',lambda text:helper.disable(text,'Original assembly persistent settings changed'),'Changed source root cannot execute stage')
    add('rejected-refusal-budget','rejected_write_timeout_uses_fixed_refusal_bound',swap('                handler.connection.settimeout(.25)','                handler.connection.settimeout(self.write_timeout)'),'Rejected timeout cannot widen early refusal bound')
    add('active-native-child-cancellation','active_native_observer_child_stops_after_bundle_cancellation',swap('return decision and not self._cancelled()','return decision'),'Original draft HTTP deadline exceeded')
    census={n.name for n in ast.walk(ast.parse(originals[tests])) if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')}
    if {c[1] for c in cases}!=census:raise ValueError('Every assembly case needs its own fault')
    controls=[]
    def restore():
        for p,raw in originals.items():p.write_bytes(raw)
    def execute(label,target=None):
        r=subprocess.run([sys.executable,'-B','-m','unittest','test_runtime_bundle'+('.Checks.'+target if target else '')],cwd=folder,capture_output=True,timeout=120,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'})
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
