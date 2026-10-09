"""Kill only an owned disposable supervisor while keeping its SQL gateway outside it."""
import hashlib,json,os,runpy,signal,subprocess,sys,time
from pathlib import Path
import verify_native_bound_assignment as native
from model_engine_supervision import inspect_saved_scope
from test_engine_scope_recovery import AUDIT
import model_command_journal as journal
ROOT=Path(__file__).resolve().parent
output=Path(os.environ['OPENPLAN_NATIVE_PARENT_OUTPUT']).absolute();output.mkdir(mode=0o700,parents=True,exist_ok=False)
control=os.environ.get('OPENPLAN_NATIVE_PARENT_CONTROL','parent-loss')
if control not in ('parent-loss','parent-loss-harmless','omit-parent-loss','swallow-parent-loss'):raise ValueError('Unknown parent loss control')

def external_native():
    fixture=native.ProjectWorkingCopyTests();config,key=fixture.external_config()
    supervisor_output=output/'supervisor';supervisor_output.mkdir(mode=0o700)
    config.update(output=str(supervisor_output),harmless=control=='parent-loss-harmless',swallow=control=='swallow-parent-loss')
    config_path=output/'supervisor-config.json';config_path.write_text(json.dumps(config))
    ready=None;parent=None
    with (output/'supervisor.log').open('wb') as log:
        try:
            parent=subprocess.Popen([sys.executable,'-B',str(ROOT/'verify_native_parent_supervisor.py'),str(config_path)],
                env=dict(os.environ,OPENPLAN_PARENT_PROOF_SERVICE_KEY=key),stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
            deadline=time.monotonic()+100
            while not (supervisor_output/'parent-ready.json').exists():
                if parent.poll() is not None:raise AssertionError('Supervisor exited before native iteration; inspect supervisor.log')
                if time.monotonic()>deadline:raise RuntimeError('Supervisor readiness deadline exceeded')
                time.sleep(.05)
            ready=json.loads((supervisor_output/'parent-ready.json').read_text())
            assert ready['supervisor_pid']==parent.pid
            before=fixture.native_cancel_state();state=json.loads(before)
            assert state['stage']['status']=='running' and 'Assignment iteration' in state['stage']['log_tail']
            assert len(state['attempts'])==1 and state['starts']==1
            # Use the same destination normalization as the actual command client.
            import model_command_client as client
            destination=client.destination(config['base_url'],config['deployment_id'])
            commands_before=journal.read_existing(Path(config['journal']),destination,include_resolved=True)
            assert not any(not row['resolved'] for row in commands_before)
            if control=='omit-parent-loss':
                (supervisor_output/'release-parent').touch()
                assert parent.wait(timeout=60)==0,'No-loss control failed before completing native assignment'
            else:parent.kill()
            code=parent.wait(timeout=10)
            assert code==-signal.SIGKILL,'Native supervisor loss was not observed'
            deadline=time.monotonic()+15
            while True:
                observation=inspect_saved_scope(ready['scope'])
                if observation['scope_has_live_processes'] is False:break
                if time.monotonic()>deadline:raise AssertionError('Native child survived lost supervisor')
                time.sleep(.05)
            work=Path(ready['work_directory'])
            assert not (work/'assignment-result.json').exists() and not (work/'run_output/link_volumes.csv').exists(),'Native child published outputs after supervisor loss'
            failure=json.loads((work/'assignment-failure.json').read_text())
            assert failure=={'error_type':'WorkerStateWriteUnconfirmed','active_project':False},failure
            assert not (work/'assignment-result.json').exists() and not (work/'run_output/link_volumes.csv').exists()
            engine=work/'engine_process'
            assert not any((engine/name).exists() for name in ('observed-exit.json','cancellation-requested.json','cancellation-signal-written.json','cancellation-observed.json'))
            custody=lambda:{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in engine.glob('*.json')}
            retained=custody();outcomes=[]
            for index in range(2):
                result=subprocess.run([sys.executable,'-B','-c',AUDIT,'--root',ready['root'],'--journal',ready['journal'],
                    '--base-url',config['base_url'],'--deployment-id',config['deployment_id'],'--request-id',ready['claim_request_id']],
                    env=dict(os.environ,PYTHONPATH=str(native.WORKER)),capture_output=True,text=True,timeout=15)
                assert result.returncode==0,'Parent-loss inspection failed: '+result.stderr+result.stdout
                inspected=json.loads(result.stdout)
                assert inspected['scope_has_live_processes'] is False
                assert not any(inspected[name] for name in ('cancellation_requested','cancellation_signal_written','cancellation_observed','signal_sent','model_resumed','continuation_authorized','database_status_changed'))
                outcomes.append(inspected)
            assert outcomes[0]==outcomes[1] and retained==custody()
            assert fixture.native_cancel_state()==before,'Parent loss changed installed database state'
            assert journal.read_existing(Path(config['journal']),destination,include_resolved=True)==commands_before
            proof={'supervisor_exit_code':code,'scope_observation':observation,'native_failure':failure,'fresh_inspections':outcomes,
                   'records_unchanged':True,'command_inventory_unchanged':True,'database_state_unchanged':True,'final_outputs_absent':True}
            report={'control':control,'live_parent_transport':True,'parent_loss':proof,'final_outputs_absent':True,
                    'worker_sha256':hashlib.sha256((native.WORKER/'main.py').read_bytes()).hexdigest()}
            native_output=Path(os.environ['OPENPLAN_NATIVE_ASSIGNMENT_HTTP_OUTPUT'])/'native';native_output.mkdir(mode=0o700)
            (native_output/'result.json').write_text(json.dumps(report,indent=2)+'\n')
        finally:
            (supervisor_output/'release-parent').touch(exist_ok=True)
            if parent is not None:
                if parent.poll() is None:parent.terminate()
                parent.wait(timeout=15)
            if ready is not None:
                deadline=time.monotonic()+15
                while inspect_saved_scope(ready['scope'])['scope_has_live_processes'] is not False:
                    if time.monotonic()>deadline:raise RuntimeError('Owned native scope remains live; do not infer cleanup')
                    time.sleep(.05)

native.main=external_native
native.ROOT=output/'reports';native.ROOT.mkdir()
os.environ['OPENPLAN_NATIVE_ASSIGNMENT_HTTP_OUTPUT']=str(output/'live')
os.environ['OPENPLAN_NATIVE_ASSIGNMENT_HTTP_CONTROL']=control
runpy.run_path(str(ROOT/'verify_native_assignment_http.py'),run_name='__main__')
result=json.loads((output/'live/result.json').read_text())
report={'control':control,'native_http':result,'proof_sha256':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('verify_native_parent_supervisor.py','verify_native_assignment_http.py')},
        'limits':'Actual supervisor SIGKILL at one confirmed native iteration before acknowledgement. Child closes native project after channel loss; gateway remains in outer process. No general parent-loss detection during computation, restart, durable reconciliation, UI decision, publication or scientific acceptance.'}
content=json.dumps(report,indent=2)+'\n';(output/'result.json').write_text(content);(ROOT/('native-parent-loss-'+control+'.json')).write_text(content);print(content)
