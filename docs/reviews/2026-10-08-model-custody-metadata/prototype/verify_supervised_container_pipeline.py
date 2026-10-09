"""Behavioral pipeline CLI with a supervised synthetic container and retained outputs."""
import hashlib,json,os,shlex,signal,subprocess,sys,time
from pathlib import Path
from verify_container_controller import docker
from verify_created_container_identity import ROOT
WORKER=ROOT/'workers/activitysim_worker'
sys.path.insert(0,str(ROOT/'scripts/modeling/tests'))
from test_run_behavioral_demand_prototype import build_screening_run


def one(root, lose_owner):
 root.mkdir(mode=0o700);bundle=build_screening_run(root);config=root/'config';config.mkdir();(config/'settings.yaml').write_text('models: []\n')
 child="import time;from pathlib import Path;Path('child-ready').touch()\nwhile not Path('release').exists():time.sleep(.03)\nPath('../output/final_trips.csv').write_text('trip_id,person_id,household_id,purpose,trip_mode\\n1,1,1,work,walk\\n');Path('child-completed').touch()"
 work="import subprocess,sys;from pathlib import Path;print('runtime command entered',flush=True);subprocess.Popen([sys.executable,'-c',"+repr(child)+"],start_new_session=True);Path('parent-completed').touch()"
 output=root/'pipeline';runtime=output/'runtime';custody=output/'runtime.container-custody/creation'
 command=[sys.executable,'-B',str(ROOT/'scripts/modeling/run_behavioral_demand_prototype.py'),'--screening-run-dir',str(bundle),'--output-root',str(output),'--config-dir',str(config),
  '--activitysim-container-image',os.environ['OPENPLAN_CONTAINER_CUSTODY_IMAGE'],
  '--activitysim-container-cli-template',shlex.join(['python','-u','-c',work]),
  '--container-memory-bytes','67108864','--container-tasks','16','--container-supervision-socket','/run/docker.sock']
 with (root/'owner.log').open('wb') as log:owner=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
 descriptor=os.pidfd_open(owner.pid);container=None
 try:
  deadline=time.monotonic()+20
  while not (runtime/'workdir/child-ready').exists():
   if owner.poll() is not None or time.monotonic()>deadline:raise AssertionError('Runtime did not reach supervised work: '+(root/'owner.log').read_text())
   time.sleep(.03)
  assert (custody/'created.json').exists(), 'Pipeline did not retain supervised creation'
  identity=json.loads((custody/'created.json').read_text())['identity'];container=identity['container_id']
  assert (runtime/'workdir/parent-completed').exists()
  assert not (custody/'observed-exit.json').exists()
  logs=list(runtime.rglob('activitysim_stdout.log'));assert len(logs)==1 and 'runtime command entered' in logs[0].read_text()
  if lose_owner:
   signal.pidfd_send_signal(descriptor,signal.SIGKILL);owner.wait(timeout=5)
   deadline=time.monotonic()+8
   while True:
    observed=json.loads(docker('--host','unix:///run/docker.sock','inspect',container))[0]
    if not observed['State']['Running'] or time.monotonic()>deadline:break
    time.sleep(.05)
   assert observed['State']['Status']=='exited' and observed['State']['ExitCode']==125,'Runtime owner loss did not stop container'
   assert not (runtime/'workdir/child-completed').exists() and not (runtime/'runtime_summary.json').exists()
  else:
   (runtime/'workdir/release').touch()
   assert owner.wait(timeout=15)==0,(root/'owner.log').read_text()
   assert json.loads((runtime/'runtime_summary.json').read_text())['status']=='succeeded'
   pipeline=json.loads((output/'behavioral_demand_prototype_manifest.json').read_text())
   assert pipeline['pipeline_status']=='behavioral_runtime_succeeded'
   assert pipeline['steps']['ingest_activitysim_runtime_outputs']['status']=='succeeded'
   ingestion=json.loads(Path(pipeline['artifacts']['ingestion_summary_path']).read_text())
   assert ingestion['common_tables']['trips']['row_count']==1, 'Synthetic trip output was not ingested'
   manifest=json.loads((runtime/'runtime_manifest.json').read_text())
   assert manifest['execution']['container_supervision']=='owned_linux_pid_namespace'
   assert manifest['execution']['resolved_container_image']==identity['image_id']
   assert (runtime/'workdir/child-completed').exists() and (custody/'removed.json').exists()
   container=None
  return {'owner_lost':lose_owner,'pipeline_cli_supervised':True,'command_log_retained':True,
   'normal_completion_observed':not lose_owner,'owned_container_removed':True,'scientific_acceptance':'unassessed'}
 finally:
  if owner.poll() is None:signal.pidfd_send_signal(descriptor,signal.SIGKILL);owner.wait(timeout=5)
  os.close(descriptor)
  receipt=custody/'created.json'
  if container is None and receipt.exists() and not (custody/'removed.json').exists():container=json.loads(receipt.read_text())['identity']['container_id']
  if container:
   identity=json.loads(receipt.read_text())['identity'];observed=json.loads(docker('--host','unix:///run/docker.sock','inspect',container))[0]
   assert observed['Id']==container and observed['Config']['Labels']['openplan.execution-request']==identity['request_id']
   if observed['State']['Running']:
    killed=subprocess.run(['docker','--host','unix:///run/docker.sock','kill',container],capture_output=True,text=True)
    if killed.returncode:
     state=json.loads(docker('--host','unix:///run/docker.sock','inspect',container))[0]['State'];assert state['Running'] is False and state['Status']=='exited'
   docker('--host','unix:///run/docker.sock','rm',container)


if __name__=='__main__':
 root=Path(os.environ['OPENPLAN_SUPERVISED_PIPELINE_PROOF']);root.mkdir(mode=0o700,parents=True,exist_ok=False)
 results=[one(root/'normal',False),one(root/'owner-loss',True)]
 report={'cases':results,'sources':{name:hashlib.sha256((ROOT/name).read_bytes()).hexdigest() for name in ('scripts/modeling/run_behavioral_demand_prototype.py','workers/activitysim_worker/runtime.py','workers/activitysim_worker/container_execution.py')},
 'limits':['Actual behavioral pipeline CLI and controller with synthetic workload','Explicit local socket opt-in; legacy container path remains available','No native ActivitySim, database dispatch, scientific or human acceptance']}
 text=json.dumps(report,indent=2)+'\n';(root/'result.json').write_text(text);print(text)
