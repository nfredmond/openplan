"""Native ActivitySim container lifecycle on a copied development bundle."""
import csv,hashlib,json,os,shlex,shutil,signal,subprocess,sys,time
from pathlib import Path
from verify_container_controller import docker
from verify_created_container_identity import ROOT
WORKER=ROOT/'workers/activitysim_worker'
sys.path.insert(0,str(WORKER/'tests'))
from test_runtime import build_bundle


def one(root, source, mode):
 lose_owner=mode!='owner-alive'
 root.mkdir(mode=0o700);bundle=root/'bundle';shutil.copytree(source,bundle)
 settings=bundle/'configs/settings.yaml';text=settings.read_text()
 assert text.count('households_sample_size: 0')==1
 settings.write_text(text.replace('households_sample_size: 0','households_sample_size: 100'))
 runtime=root/'runtime';custody=root/'runtime.container-custody/creation'
 command=[sys.executable,'-B',str(WORKER/'main.py'),'--bundle-path',str(bundle),'--runtime-dir',str(runtime),
  '--activitysim-container-image',os.environ['OPENPLAN_CONTAINER_CUSTODY_IMAGE'],
  '--activitysim-container-cli-template','env OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 NUMBA_NUM_THREADS=1 activitysim run -c {config_dir} -c /openplan/stock_configs -d {data_dir} -o {output_dir} -w {working_dir}',
  '--container-memory-bytes','1610612736','--container-tasks','32','--container-supervision-socket','/run/docker.sock']
 if mode=='harmless':command.extend(['--run-label','harmless-native-container'])
 with (root/'owner.log').open('wb') as log:owner=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
 descriptor=os.pidfd_open(owner.pid);container=None
 try:
  log_path=runtime/'stages/030-run-activitysim/activitysim_stdout.log'
  deadline=time.monotonic()+180
  while not (log_path.exists() and '#run_model running step school_location' in log_path.read_text(errors='replace')):
   if owner.poll() is not None or time.monotonic()>deadline:raise AssertionError('Runtime did not reach supervised work: '+(root/'owner.log').read_text())
   time.sleep(.03)
  identity=json.loads((custody/'created.json').read_text())['identity'];container=identity['container_id']
  assert not (custody/'observed-exit.json').exists()
  logs=list(runtime.rglob('activitysim_stdout.log'));assert len(logs)==1 and '#run_model running step school_location' in logs[0].read_text()
  if lose_owner:
   signal.pidfd_send_signal(descriptor,signal.SIGKILL);owner.wait(timeout=5)
   deadline=time.monotonic()+8
   while True:
    observed=json.loads(docker('--host','unix:///run/docker.sock','inspect',container))[0]
    if not observed['State']['Running'] or time.monotonic()>deadline:break
    time.sleep(.05)
   assert observed['State']['Status']=='exited' and observed['State']['ExitCode']==125,'Runtime owner loss did not stop container'
   assert not (runtime/'output/final_trips.csv').exists() and not (runtime/'runtime_summary.json').exists()
  else:
   assert owner.wait(timeout=180)==0,(root/'owner.log').read_text()
   assert json.loads((runtime/'runtime_summary.json').read_text())['status']=='succeeded'
   manifest=json.loads((runtime/'runtime_manifest.json').read_text())
   assert manifest['execution']['container_supervision']=='owned_linux_pid_namespace'
   assert manifest['execution']['resolved_container_image']==identity['image_id']
   assert (custody/'removed.json').exists()
   with (runtime/'output/final_trips.csv').open() as stream: rows=sum(1 for _ in csv.DictReader(stream))
   assert rows>0
   container=None
  return {'case':mode,'owner_lost':lose_owner,'native_step_observed':'school_location','trips':None if lose_owner else rows,'runtime_cli_supervised':True,'command_log_retained':True,
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
 root=Path(os.environ['OPENPLAN_NATIVE_CONTAINER_PROOF']);root.mkdir(mode=0o700,parents=True,exist_ok=False)
 source=Path(os.environ['OPENPLAN_ACTIVITYSIM_DEVELOPMENT_BUNDLE'])
 def hashes():return {str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest() for p in source.rglob('*') if p.is_file()}
 before=hashes()
 results=[one(root/mode,source,mode) for mode in ('baseline','harmless','owner-alive','restored')]
 assert hashes()==before,'Development source changed'
 report={'cases':results,'development_source_unchanged':True,
  'source_bundle_sha256':hashlib.sha256(json.dumps(before,sort_keys=True).encode()).hexdigest(),
  'image_id':os.environ['OPENPLAN_CONTAINER_CUSTODY_IMAGE'],
  'sources':{name:hashlib.sha256((WORKER/name).read_bytes()).hexdigest() for name in ('runtime.py','main.py','container_execution.py')},
  'limits':['100-household copy of development bundle, coefficients unchanged','Native step logged before interruption, exact instruction not identified','No holdout exposure, accuracy validation, database dispatch or restart acceptance']}
 text=json.dumps(report,indent=2)+'\n';(root/'result.json').write_text(text);print(text)
