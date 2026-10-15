"""Small additional stand-ins for preparation refusal and protected runtime guards."""
import importlib.util
import json
from pathlib import Path
import sys
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
ROOT=Path('/home/nathaniel/.local/state/openplan/project-portfolio-skip-preview-20261015-v4')
rows=[]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
def run(name,fn,reason=None):
 try:fn()
 except (ValueError,AssertionError) as e:
  assert reason and reason in str(e),(name,str(e),reason)
  rows.append({'case':name,'outcome':'REFUSED','reason':reason});return
 assert reason is None,'vacuous:'+name
 rows.append({'case':name,'outcome':'SURVIVED'})
def main():
 prep=load('prep',HERE/'prepare_packet.py')
 with patch.object(prep.subprocess,'check_output',lambda *x,**kw:(prep.HEAD+'\n').encode()):
  run('root-already-reserved',prep.main,'new-root-reserved')
 # Use an absent private specimen name. The occupied ss result must stop before mkdir.
 with patch.object(prep,'ROOT',ROOT/'never-created-occupied-port-specimen'),patch.object(prep.subprocess,'check_output',lambda args:(prep.HEAD+'\n').encode() if 'git' in args[0] else b'LISTEN occupied fixture\n'):
  run('preparation-port-occupied',prep.main,'new-ports-occupied')
 assert not (ROOT/'never-created-occupied-port-specimen').exists()
 sys.path.insert(0,str(ROOT))
 try:h=load('helper_guards',ROOT/'helper.py')
 finally:sys.path.pop(0)
 p=h.p
 live_receipt=json.loads(Path('/home/nathaniel/.local/state/openplan/current-project-preview-host-attestation-v2-20261015/runtime-start-attestation.json').read_text())
 assert live_receipt['app']['head']=='21510042e94bcaf80f262205ad156a7bb639e35c'
 environ=b'PATH=fixture\0'
 receipt={**live_receipt,'listenerPid':'99999','processEnvironmentDigest':p.digest({'PATH':'fixture'})}
 state={'active':'active','invocation':'34615ba06b554482b0f79c90fe999a61','host':'127.74.19.10:3585','cwd':'/home/nathaniel/.local/state/openplan/current-project-preview-app-binding-20261015-v3/candidate/openplan','group':'0::/user.slice/fixture','env':environ}
 class Fake:
  def __init__(self,text):self.text=text
  def __truediv__(self,name):return Fake(self.text+'/'+str(name))
  def read_text(self):
   if self.text.endswith('/runtime-start-attestation.json'):return json.dumps(receipt)
   assert self.text=='/proc/99999/cgroup';return state['group']
  def read_bytes(self):assert self.text=='/proc/99999/environ';return state['env']
  def resolve(self):assert self.text=='/proc/99999/cwd';return state['cwd']
 def path(text):
  return Fake(str(text)) if str(text)=='/proc' or str(text).endswith('/runtime-start-attestation.json') else Path(text)
 def command(args,**kw):
  if args[0]=='/usr/bin/systemctl':return ('ActiveState='+state['active']+'\nInvocationID='+state['invocation']+'\nMainPID=99999\nControlGroup=/user.slice/fixture\nOperatorNote=harmless\n').encode()
  assert args==['/usr/bin/ss','-H','-ltnp','sport = :3585']
  return ('LISTEN 0 511 '+state['host']+' 0.0.0.0:* users:(("node",pid=99999,fd=1))\n').encode()
 with patch.object(h,'Path',path),patch.object(h,'run',command):
  run('protected-web-harmless-note',h.protected_web)
  for key,value,reason in [('active','inactive','protected-web:ActiveState'),('invocation','old-invocation','protected-web:InvocationID'),('host','127.74.19.11:3586','protected-web:socket'),('cwd','/wrong/app','protected-web:cwd'),('group','0::/wrong/group','protected-web:cgroup'),('env',b'PATH=wrong\0','protected-web-env:digest')]:
   saved=state[key]
   try:state[key]=value;run('protected-web-'+key,h.protected_web,reason)
   finally:state[key]=saved
  run('protected-web-restored',h.protected_web)
 result={'scope':'Preparation admission and old runtime identity stand-ins only. No DB, Docker, services, build, start, attest or browser operation.','cases':rows,'restoredInFinally':True,'blindCategories':['Occupied-name/port races require parent last-moment acquisition.','Runtime stand-ins do not prove current old or new web process state.']}
 (ROOT/'new-guard-controls-01.json').write_text(json.dumps(result,indent=2)+'\n');(HERE/'new-guard-controls.json').write_text(json.dumps(result,indent=2)+'\n')
 print(json.dumps({'cases':len(rows),'operationalExecution':False}))
if __name__=='__main__':main()
