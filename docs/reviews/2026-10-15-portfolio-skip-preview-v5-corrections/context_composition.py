"""Permitted actual old-web observation through cleared entrypoints and outer bwrap.

Future database/helper/build observations are stand-ins. No operating runner runs.
"""
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch
ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v5')

def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);sys.modules[name]=m;spec.loader.exec_module(m);return m

def main():
 mode=sys.argv[1];assert mode in ['app','attestor']
 attempt=sys.argv[2] if len(sys.argv)==3 else '01'
 assert attempt in ['01','02']
 readonly=[]
 for name in ['/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4/operation-files.sha256','/home/nathaniel/.t3/worktrees/openplan/t3-0f743997/openplan/node_modules/next/package.json']:
  original=hashlib.sha256(Path(name).read_bytes()).hexdigest()
  try:
   fd=os.open(name,os.O_WRONLY);os.close(fd)
  except OSError as error:
   assert error.errno==errno.EROFS;readonly.append({'path':name,'writeOpenErrno':error.errno,'sha256':original})
  else:raise AssertionError('outer-readonly-boundary-missing')
  assert hashlib.sha256(Path(name).read_bytes()).hexdigest()==original
 sys.path.insert(0,str(ROOT))
 try:
  h=load('helper',ROOT/'helper.py');a=load('app_binding_v1',ROOT/'app_binding_v1.py');t=load('v5_context_attestor',ROOT/'attest_start_v1.py')
 finally:sys.path.pop(0)
 observed=[];boundary_environments=[]
 def unchanged():
  boundary_environments.append({'hasXDG':'XDG_RUNTIME_DIR' in os.environ,'hasDBus':'DBUS_SESSION_BUS_ADDRESS' in os.environ})
  observed.append(h.protected_web())
 def future_read(name):
  return {'service-receipts-private.json':{},'clone-ready.json':{'sourceSha256':a.SOURCE_ANCHOR},
   'target-identity.json':{'database':h.TARGET,'owner':'postgres','oid':'future-context-fixture'}}[name]
 r=SimpleNamespace(pinned_files=lambda:None,target_check=lambda:None,upgrade_ready=lambda:None,
  verify_services=lambda:{},source_check=lambda:None,unchanged_inputs=unchanged,read=future_read,TARGET=h.TARGET,p=h.p)
 original_sha=a.sha
 def future_sha(path):
  return '0'*64 if Path(path).name in ['service-receipts-private.json','upgrade-ready.json'] else original_sha(path)
 env=dict(os.environ)
 try:
  with patch.object(a,'load_recovery',lambda:r),patch.object(a,'app_values',lambda r:None),patch.object(a,'sha',future_sha):
   if mode=='app':
    with patch.object(sys,'argv',['context-only','active-check']):a.main()
   else:
    # The real attestor main clears the environment. Its body is bounded to the
    # actual acquire call, because no new preview or build exists to attest.
    with patch.object(t,'attest',lambda:a.acquire(r)):t.main()
 finally:
  os.environ.clear();os.environ.update(env)
 assert len(observed)==1 and boundary_environments==[{'hasXDG':False,'hasDBus':False}]
 value=observed[0]
 caller=os.readlink('/proc/self/ns/user')
 assert caller!=value['observerUserNamespace'],'outer-wrapper-not-exercised'
 assert value['observerUserNamespace']=='user:[4026531837]' and value['listenerPid']=='4104299'
 report={'scope':'Actual old-web read-only host observer through actual cleared main and outer bwrap. Future DB/helper acquisitions are stand-ins; no new-preview runtime is claimed.',
  'entrypoint':mode,'callerUserNamespace':caller,'observerUserNamespace':value['observerUserNamespace'],
  'boundaryEnvironment':boundary_environments[0],'request':value['request'],'oldWebObservation':value,
  'readonlyProtectedPaths':readonly,'scriptSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
 path=ROOT/'context-tests'/('actual-'+mode+'-'+attempt+'.json')
 with path.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
 print(json.dumps({'entrypoint':mode,'callerNamespace':caller,'observerNamespace':value['observerUserNamespace'],'oldInvocation':value['invocation'],'oldListenerPid':value['listenerPid'],'newPreviewRuntimeClaim':False}))
if __name__=='__main__':main()
