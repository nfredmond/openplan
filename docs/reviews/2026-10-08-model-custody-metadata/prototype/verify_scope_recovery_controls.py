"""Test read-only scope recovery against isolated mutations and owned processes."""
import hashlib,json,os,subprocess,sys,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parent;WORKER=ROOT.parents[3]/'workers/aequilibrae_worker'
modules=('model_engine_recovery.py','model_engine_supervision.py','model_engine_process.py','model_engine_bootstrap.py')
sources={name:(WORKER/name).read_text() for name in modules};records=[]
cases=[('baseline',None,None),('harmless',None,None),
('ignore-boot','test_other_boot_is_unassessed_without_manager_query','Foreign boot queried manager'),
('ignore-deployment','test_foreign_deployment_is_refused','ValueError not raised'),
('ignore-claim','test_foreign_claim_record_is_refused','ValueError not raised'),
('allow-hardlink','test_hardlinked_scope_record_is_refused','ValueError not raised'),
('follow-symlink','test_symlinked_scope_record_is_refused','OSError not raised'),
('false-signal','test_false_signal_receipt_is_refused','ValueError not raised'),
('false-empty','test_false_empty_scope_observation_is_refused','ValueError not raised'),
('nonobject-startup','test_nonobject_startup_scope_is_refused','AttributeError'),
('nonobject-cancellation','test_nonobject_cancellation_scope_is_refused','AttributeError'),
('ignore-current-identity','test_current_scope_replacement_is_refused','ValueError not raised'),
('ignore-directory','test_saved_directory_identity_change_is_refused','ValueError not raised'),
('missing-startup-as-absent','test_missing_startup_record_does_not_infer_execution','scope_startup_unconfirmed'),
('attempt-signal','test_fresh_process_observes_live_scope_without_signaling','Recovery attempted a side effect'),
('attempt-launch','test_fresh_process_observes_live_scope_without_signaling','Recovery attempted model launch'),
('attempt-manager-mutation','test_fresh_process_observes_live_scope_without_signaling','Recovery attempted manager mutation'),
('restored',None,None)]
for case,test,expected in cases:
    with tempfile.TemporaryDirectory(prefix='openplan-recovery-control-') as temporary:
        directory=Path(temporary);candidate=dict(sources)
        if case=='harmless':candidate['model_engine_recovery.py']+='\n# Harmless inspection comment.\n'
        changes={
          'ignore-deployment':('model_engine_recovery.py',"    records=commands._checked_records(","    deployment_id='synthetic'\n    records=commands._checked_records("),
          'ignore-claim':('model_engine_recovery.py',"if launch.get(key)!=getattr(context,key):","if False:"),
          'allow-hardlink':('model_engine_recovery.py'," or before.st_nlink!=1",''),
          'follow-symlink':('model_engine_recovery.py','os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK','os.O_RDONLY|os.O_NONBLOCK'),
          'false-signal':('model_engine_recovery.py'," or record.get('signal_written') is not True",''),
          'missing-startup-as-absent':('model_engine_recovery.py',"'outcome':'scope_startup_unconfirmed'","'outcome':'scope_absent_observed'"),
          'false-empty':('model_engine_recovery.py',"            if name=='cancellation-observed.json' and saved.get('observed_scope_empty') is not True:raise ValueError('Invalid empty scope observation')\n",''),
          'nonobject-startup':('model_engine_recovery.py',"        if not isinstance(scope,dict):raise ValueError('Invalid startup scope record')\n",''),
          'nonobject-cancellation':('model_engine_recovery.py',"            if not isinstance(saved,dict):raise ValueError('Invalid cancellation scope record')\n",''),
          'ignore-boot':('model_engine_supervision.py',"if boot!=current_boot_id():","if False:"),
          'ignore-current-identity':('model_engine_supervision.py',"if state.get('InvocationID')!=identity['invocation_id'] or state.get('ControlGroup')!=group:","if False:"),
          'ignore-directory':('model_engine_supervision.py',"if (info.st_dev,info.st_ino)!=(identity['cgroup_device'],identity['cgroup_inode']):","if False:"),
          'attempt-signal':('model_engine_supervision.py',"    controller=shutil.which('systemctl')","    os.kill(os.getpid(),0)\n    controller=shutil.which('systemctl')"),
          'attempt-manager-mutation':('model_engine_supervision.py',"[controller,'--user','show',unit","[controller,'--user','stop',unit"),
          'attempt-launch':('model_engine_supervision.py',"    controller=shutil.which('systemctl')","    subprocess.run([sys.executable,'-c','pass'],check=True)\n    controller=shutil.which('systemctl')")}
        if case in changes:
            name,old,new=changes[case];assert candidate[name].count(old)==1,(case,'Mutation anchor differs');candidate[name]=candidate[name].replace(old,new)
        for name,content in candidate.items():(directory/name).write_text(content)
        target='test_engine_scope_recovery'+('.ScopeRecoveryTests.'+test if test else '')
        result=subprocess.run([sys.executable,'-B','-m','unittest',target,'-v'],cwd=directory,
            env=dict(os.environ,PYTHONPATH=str(directory)+os.pathsep+str(WORKER),OPENPLAN_LIVE_ENGINE_SCOPE='1'),capture_output=True,text=True,timeout=60)
        if expected:
            assert result.returncode!=0 and expected in result.stderr,case+' failed to detect mutation: '+result.stderr
            records.append({'control':case,'detected':expected})
        else:
            assert result.returncode==0,case+': '+result.stderr
            records.append({'control':case,'passed':True,'summary':result.stderr.strip().splitlines()[-3:]})
report={'sources_sha256':{name:hashlib.sha256(text.encode()).hexdigest() for name,text in sources.items()},'controls':records,
        'limits':'Real owned scopes and records, fresh-process read-only CLI and audit controls. Mocked database claim history; no live ownership check, persistent reconciliation write, model resume, parent-loss recovery workflow or UI integration.'}
content=json.dumps(report,indent=2)+'\n';(ROOT/'scope-recovery-controls.json').write_text(content);print(content)
