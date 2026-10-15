"""Prove the pinned upgrade and same-cluster restore can detect missing custody."""
import argparse,hashlib,json,os,re,subprocess,sys
from pathlib import Path

def cleanup_owned_cluster():
 identity='a79d62deecea7fd1d1099b35863ca3de50ef7f44618c3c130c9f5b34b024bed3'
 state=json.loads(subprocess.check_output(['docker','inspect',identity]))[0]
 assert state['Id']==identity and state['Image']=='sha256:ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f'
 assert state['Config']['Labels']['openplan.purpose']=='odm-private-dispatch-rpc-cli-20261012'
 assert state['HostConfig']['Memory']==state['HostConfig']['MemorySwap']==1073741824 and not state['HostConfig']['PortBindings']
 if state['State']['Running']:
  subprocess.run(['docker','stop','--time','120',identity],check=True,capture_output=True,timeout=150)

def intended(code,output,reason):
 return code==1 and re.findall(r'^AssertionError: (.*)$',output,re.MULTILINE)==[reason] and not any(x in output for x in ['TimeoutExpired:','SyntaxError:','TypeError:'])
def run(repo,out):
 os.umask(0o077);out.mkdir(mode=0o700,parents=True);rows=[];oracles=[]
 producer=Path(__file__).with_name('native_delivery_upgrade.py');migration=repo/'openplan/supabase/migrations/20261017000012_aerial_delivery_authority.sql';original=migration.read_bytes()
 def phase(label,variant='baseline',reason=None):
  try:
   r=subprocess.run([sys.executable,'-B',str(producer),'--repo',str(repo),'--out',str(out/label),'--variant',variant],capture_output=True,text=True,timeout=360)
  except subprocess.TimeoutExpired:
   cleanup_owned_cluster()
   raise TimeoutError('Owned upgrade controller deadline; cluster cleanup requested') from None
  output=r.stdout+r.stderr;(out/(label+'-private.log')).write_text(output)
  if reason:
   assert intended(r.returncode,output,reason),label+' reaches intended restore/upgrade assertion'
   for name,c,o,wanted in [('exact',r.returncode,output,True),('success',0,output,False),('wrong-exit',2,output,False),('wrong-reason',r.returncode,output.replace(reason,'unrelated'),False),('source-only',1,'assert False, "'+reason+'"',False),('extra-error',1,output+'\nAssertionError: Unrelated\n',False)]:
    actual=intended(c,o,reason);assert actual==wanted;oracles.append({'case':label,'oracle':name,'accepted':actual})
   rows.append({'case':label,'outcome':'intended_failure','diagnostic':reason})
  else:
   assert r.returncode==0,label+' completes full upgrade/restore'
   report=json.loads((out/label/'result.json').read_text());assert [report[k] for k in ['historyBefore','historyMain','historyPrerequisites','historyBeforeDelivery','historyCandidate']]==[409,411,413,414,415]
   rows.append({'case':label,'outcome':'survived','retainedDatabases':report['retainedDatabases']})
  assert migration.read_bytes()==original,'Upgrade controls never mutate source SQL'
  (out/'partial-controls.json').write_text(json.dumps(rows,indent=2)+'\n')
  print(label+': '+rows[-1]['outcome'],flush=True)
 phase('baseline');phase('harmless-comment','harmless');phase('restored-after-harmless')
 for label,variant,reason in [('delivery-migration-omitted','missing-delivery','Candidate delivery upgrade installs exact415 migration history'),('delivery-function-omitted','missing-delivery-body','Restored delivery authority exists'),('member-delivery-granted','member-delivery-allowed','Restored delivery authority stays service only'),('delivery-definer-restored','delivery-definer','Restored delivery authority stays invoker with pinned search path'),('delivery-path-broadened','delivery-search-path','Restored delivery authority stays invoker with pinned search path')]:phase(label,variant,reason)
 phase('restored','restored')
 for name,value in [('controls',rows),('oracles',oracles),('bindings',{str(migration.relative_to(repo)):hashlib.sha256(original).hexdigest(),str(producer.relative_to(repo)):hashlib.sha256(producer.read_bytes()).hexdigest()})]: (out/(name+'.json')).write_text(json.dumps(value,indent=2)+'\n')
 print({'positives':4,'faults':5,'oracles':len(oracles)})
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
