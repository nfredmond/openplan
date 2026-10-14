"""Challenge the cleanup helper at a simulated Docker boundary; restore in finally."""
import argparse,hashlib,json,os,re,subprocess,sys
from pathlib import Path

def run(repo,out):
 os.umask(0o077);out.mkdir(mode=0o700,parents=True);folder=Path(__file__).parent;source=folder/'verify_upgrade_controls.py';tests=folder/'test_controller_cleanup.py';original=source.read_bytes();rows=[]
 def execute(label,case=None):
  cmd=[sys.executable,'-B',str(tests)]+(['Checks.'+case] if case else [])
  r=subprocess.run(cmd,capture_output=True,text=True,timeout=10);text=r.stdout+r.stderr;(out/(label+'-private.log')).write_text(text);return r.returncode,text
 def positive(label):
  code,text=execute(label);assert code==0 and 'Ran 4 tests' in text and text.rstrip().endswith('OK');rows.append({'case':label,'outcome':'survived','tests':4})
 def change(old,new):
  text=original.decode();assert old in text;return text.replace(old,new,1)
 try:
  positive('baseline');source.write_bytes(original+b'\n# Harmless owned cleanup comment.\n');positive('harmless-comment');source.write_bytes(original);positive('restored-after-harmless')
  image="state['Image']=='sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f'"
  memory="state['HostConfig']['Memory']==state['HostConfig']['MemorySwap']==1073741824"
  fence='Cleanup refuses a changed ownership/resource fence'
  cases=[('identity-ignored',change("state['Id']==identity","True"),fence),('image-ignored',change(image,'True'),fence),('purpose-ignored',change("state['Config']['Labels']['openplan.purpose']=='odm-private-dispatch-rpc-cli-20261012'",'True'),fence),('memory-ignored',change(memory,"state['HostConfig']['MemorySwap']==1073741824"),fence),('swap-ignored',change(memory,"state['HostConfig']['Memory']==1073741824"),fence),('ports-ignored',change("not state['HostConfig']['PortBindings']",'True'),fence),('stopped-still-stopped',change("if state['State']['Running']:",'if True:'),'Stopped owned cluster needs no stop'),('graceful-stop-shortened',change("['docker','stop','--time','120',identity]","['docker','stop','--time','10',identity]"),'Owned cleanup keeps its exact target and graceful deadline'),('timeout-cleanup-skipped',change('   cleanup_owned_cluster()\n','   pass\n'),'Outer timeout requests owned cluster cleanup')]
  for label,text,reason in cases:
   try:
    source.write_text(text)
    case={'stopped-still-stopped':'test_stopped_cluster_is_left_untouched','graceful-stop-shortened':'test_owned_running_cluster_uses_graceful_stop','timeout-cleanup-skipped':'test_outer_timeout_requests_fenced_cleanup'}.get(label,'test_foreign_or_unbounded_surface_refuses_before_stop')
    code,output=execute(label,case)
    assert code==1 and 'FAILED (failures=1)' in output and re.search(r'^AssertionError:.*'+re.escape(reason),output,re.MULTILINE),label+' reaches intended assertion'
    rows.append({'case':label,'outcome':'intended_failure','diagnostic':reason})
   finally:source.write_bytes(original)
  positive('restored')
  (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n');(out/'bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [source,tests]},indent=2)+'\n');print({'positives':4,'faults':len(cases)})
 finally:source.write_bytes(original);assert source.read_bytes()==original
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
