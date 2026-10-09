"""Reproduce daemon-container survival after this runtime and its client exit.

Only disposable labelled containers are touched. A proof-only engine wrapper
adds a CPU restriction and retains the ID outside the container's mounted runtime.
"""
import hashlib,json,os,shlex,signal,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
WORKER=ROOT/'workers/activitysim_worker'
sys.path.insert(0,str(WORKER/'tests'))
from test_runtime import build_bundle


def wait_for(check,timeout=15):
 end=time.monotonic()+timeout
 while not check():
  if time.monotonic()>end:raise AssertionError('Owned container readiness timed out')
  time.sleep(.02)


def inspect(container,token):
 result=subprocess.run(['docker','inspect',container],capture_output=True,text=True)
 if result.returncode:
  if ('no such object: '+container) in result.stderr.lower():return None
  raise RuntimeError('Owned container inspection failed')
 value=json.loads(result.stdout)[0]
 assert value['Id']==container and value['Config']['Labels'].get('openplan.custody-proof')==token
 return value


def one(root,image,kill_owner):
 root.mkdir(mode=0o700)
 bundle=build_bundle(root)
 (bundle/'configs/settings.yaml').write_text('models: []\n')
 token=uuid.uuid4().hex
 cidfile=root/'owned-container.cid'
 wrapper=root/'engine.py'
 # Retain the cidfile outside the only read/write bind mount.
 wrapper.write_text("import os,sys\nassert sys.argv[1]=='run'\nos.execvp('docker', ['docker','run','--pull=never','--cpus=1','--cap-drop=ALL','--security-opt=no-new-privileges','--label',"+repr('openplan.custody-proof='+token)+",'--cidfile',"+repr(str(cidfile))+"]+sys.argv[2:])\n")
 child="from pathlib import Path;import time;Path('ready').touch();end=time.monotonic()+25\nwhile not Path('release').exists() and time.monotonic()<end:time.sleep(.02)\nPath('container-completed').touch()"
 template=shlex.join(['python','-u','-c',child])
 runtime=root/'runtime'
 command=[sys.executable,'-B',str(WORKER/'main.py'),'--bundle-path',str(bundle),'--runtime-dir',str(runtime),
  '--activitysim-container-image',image,'--container-engine-cli',shlex.join([sys.executable,str(wrapper)]),
  '--activitysim-container-cli-template',template,'--container-memory-bytes','67108864','--container-tasks','16']
 container=None;client_fd=None
 with (root/'owner.log').open('wb') as log:
  owner=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT)
  try:
   wait_for(lambda:cidfile.exists() and len(cidfile.read_text().strip())==64 and (runtime/'workdir/ready').exists())
   container=cidfile.read_text().strip();state=inspect(container,token)
   assert state['State']['Running'] is True
   assert state['HostConfig']['Memory']==67108864 and state['HostConfig']['MemorySwap']==67108864
   assert state['HostConfig']['PidsLimit']==16 and state['HostConfig']['NetworkMode']=='none'
   children=Path(f'/proc/{owner.pid}/task/{owner.pid}/children').read_text().split()
   assert len(children)==1,'Expected one runtime-owned container client'
   client_fd=os.pidfd_open(int(children[0]))
   if kill_owner:
    owner.kill();owner.wait(timeout=5)
    signal.pidfd_send_signal(client_fd,signal.SIGKILL)
    assert inspect(container,token)['State']['Running'] is True,'Container did not survive client loss'
   (runtime/'workdir/release').touch()
   wait_for(lambda:(runtime/'workdir/container-completed').exists())
   wait_for(lambda:inspect(container,token) is None)
   if not kill_owner:
    assert owner.wait(timeout=10)==0
    assert json.loads((runtime/'runtime_summary.json').read_text())['status']=='succeeded'
   else:
    assert not (runtime/'runtime_summary.json').exists()
   return {'case':'owner-and-client-killed' if kill_owner else 'owner-alive',
    'container_completed':True,'runtime_completion_present':(runtime/'runtime_summary.json').exists(),
    'container_survived_owner_and_client':kill_owner,'container_removed':True,'image':image,
    'memory_bytes':67108864,'memory_plus_swap_bytes':67108864,'pids_limit':16,'network':'none'}
  finally:
   if container is None and cidfile.exists():
    candidate=cidfile.read_text().strip()
    if len(candidate)==64:container=candidate
   if container is not None and inspect(container,token) is not None:
    subprocess.run(['docker','rm','--force',container],check=True,capture_output=True)
   if owner.poll() is None:owner.kill()
   owner.wait(timeout=5)
   if client_fd is not None:
    try:signal.pidfd_send_signal(client_fd,signal.SIGKILL)
    except ProcessLookupError:pass
    os.close(client_fd)


if __name__=='__main__':
 root=Path(os.environ['OPENPLAN_CONTAINER_CUSTODY_OUTPUT']);root.mkdir(mode=0o700,parents=True,exist_ok=False)
 image=os.environ['OPENPLAN_CONTAINER_CUSTODY_IMAGE']
 results=[one(root/'owner-alive',image,False),one(root/'owner-loss',image,True)]
 report={'cases':results,'runtime_sha256':hashlib.sha256((WORKER/'runtime.py').read_bytes()).hexdigest(),
  'limits':['Synthetic Python workload through actual ActivitySim container path',
    'Production CLI supplies memory and task limits; proof wrapper adds external ID retention and CPU restriction',
    'Demonstrates current lifecycle gap, not a passing supervised-container implementation',
    'No native ActivitySim, database, scientific or human acceptance']}
 text=json.dumps(report,indent=2)+'\n';(root/'result.json').write_text(text);print(text)
