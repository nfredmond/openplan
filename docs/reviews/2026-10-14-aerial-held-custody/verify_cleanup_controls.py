"""Challenge the cleanup helper at a simulated Docker boundary; restore in finally."""
import argparse,hashlib,json,os,re,subprocess,sys
from pathlib import Path

def run(repo,out):
 os.umask(0o077);out.mkdir(mode=0o700,parents=True);folder=Path(__file__).parent;source=folder/'verify_upgrade_controls.py';tests=folder/'test_controller_cleanup.py';original=source.read_bytes();rows=[]
 originals={path:path.read_bytes() for path in [source,folder/'verify_native_controls.py',folder/'verify_aftermath_controls.py']}
 def execute(label,case=None):
  cmd=[sys.executable,'-B',str(tests)]+(['Checks.'+case] if case else [])
  r=subprocess.run(cmd,capture_output=True,text=True,timeout=10);text=r.stdout+r.stderr;(out/(label+'-private.log')).write_text(text);return r.returncode,text
 def positive(label):
  code,text=execute(label);assert code==0 and 'Ran 5 tests' in text and text.rstrip().endswith('OK');rows.append({'case':label,'outcome':'survived','tests':5})
 def change(old,new):
  text=original.decode();assert old in text;return text.replace(old,new,1)
 try:
  positive('baseline');source.write_bytes(original+b'\n# Harmless owned cleanup comment.\n');positive('harmless-comment');source.write_bytes(original);positive('restored-after-harmless')
  image="state['Image']=='sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f'"
  memory="state['HostConfig']['Memory']==state['HostConfig']['MemorySwap']==1073741824"
  fence='Cleanup refuses a changed ownership/resource fence'
  cases=[('identity-ignored',change("state['Id']==identity","True"),fence),('image-ignored',change(image,'True'),fence),('purpose-ignored',change("state['Config']['Labels']['openplan.purpose']=='odm-private-dispatch-rpc-cli-20261012'",'True'),fence),('memory-ignored',change(memory,"state['HostConfig']['MemorySwap']==1073741824"),fence),('swap-ignored',change(memory,"state['HostConfig']['Memory']==1073741824"),fence),('ports-ignored',change("not state['HostConfig']['PortBindings']",'True'),fence),('stopped-still-stopped',change("if state['State']['Running']:",'if True:'),'Stopped owned cluster needs no stop'),('graceful-stop-shortened',change("['docker','stop','--time','120',identity]","['docker','stop','--time','10',identity]"),'Owned cleanup keeps its exact target and graceful deadline'),('timeout-cleanup-skipped',change('   cleanup_owned_cluster()\n','   pass\n'),'Outer timeout requests owned cluster cleanup')]
  cases=[(label,source,text,reason) for label,text,reason in cases]
  for filename,indent in [('verify_native_controls.py','            '),('verify_aftermath_controls.py','   ')]:
   path=folder/filename;text=originals[path].decode();old=indent+'cleanup_owned_cluster()\n';assert text.count(old)==1
   cases.append(('timeout-'+filename+'-cleanup-skipped',path,text.replace(old,indent+'pass\n',1),'Native controller timeout requests owned cluster cleanup'))
  for label,path,text,reason in cases:
   try:
    path.write_text(text)
    case={'stopped-still-stopped':'test_stopped_cluster_is_left_untouched','graceful-stop-shortened':'test_owned_running_cluster_uses_graceful_stop','timeout-cleanup-skipped':'test_outer_timeout_requests_fenced_cleanup'}.get(label,'test_native_controller_timeouts_request_fenced_cleanup' if label.startswith('timeout-verify_') else 'test_foreign_or_unbounded_surface_refuses_before_stop')
    code,output=execute(label,case)
    assert code==1 and 'FAILED (failures=1)' in output and re.search(r'^AssertionError:.*'+re.escape(reason),output,re.MULTILINE),label+' reaches intended assertion'
    rows.append({'case':label,'outcome':'intended_failure','diagnostic':reason})
   finally:
    for p,raw in originals.items():p.write_bytes(raw)
  positive('restored')
  (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n');(out/'bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in list(originals)+[tests]},indent=2)+'\n');print({'positives':4,'faults':len(cases)})
 finally:
  for p,raw in originals.items():p.write_bytes(raw);assert p.read_bytes()==raw
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
