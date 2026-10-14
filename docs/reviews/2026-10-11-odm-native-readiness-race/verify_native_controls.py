"""Verify actual native worker readiness, including a paused partial writer."""
import argparse,ast,hashlib,json,os,subprocess,sys
from pathlib import Path

def run(repo,out):
 os.umask(0o077);out.mkdir(mode=0o700);source=repo/'docs/reviews/2026-10-11-odm-native-readiness-race/readiness.py';driver=repo/'docs/reviews/2026-10-11-odm-runtime-admission/native_recovery.py';original=source.read_bytes();rows=[]
 slow=original.decode().replace('        json.dump(payload, stream)','        __import__("time").sleep(0.15)\n        json.dump(payload, stream)',1)
 broken=slow.replace("    temporary = path.with_name('.'+path.name+'.pending')",'    temporary = path',1).replace('    os.link(temporary, path)','    pass # partial direct publication',1).replace('    temporary.unlink()','    pass # direct listener retained',1)
 try:
  for label,payload,expected in [('baseline',original,0),('harmless-paused-writer',slow.encode(),0),('partial-direct-writer',broken.encode(),1),('restored-final',original,0)]:
   ast.parse(payload);source.write_bytes(payload);trial=out/label
   r=subprocess.run([sys.executable,'-B',str(driver),'--repo',str(repo),'--out',str(trial)],cwd=repo,capture_output=True,timeout=45,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'});(out/(label+'.log')).write_bytes(r.stdout+r.stderr)
   if expected==0:
    if r.returncode:raise AssertionError('Valid native readiness refused '+label+'\n'+(r.stdout+r.stderr).decode())
    summary=json.loads((trial/'summary.json').read_text());assert summary['nativeAdmissionRecovery'] is True and summary['sourceBodyBytesSent']==0 and summary['nodeodmRequests']==0
    rows.append({'control':label,'outcome':'survived','observations':summary['observations'],'observationControls':summary['controls']})
   else:
    if r.returncode!=1 or 'json.decoder.JSONDecodeError: Expecting value:' not in r.stderr.decode():raise AssertionError('Partial native listener did not fail at JSON read')
    rows.append({'control':label,'outcome':'intended_failure','reason':'JSONDecodeError reading partial listener','exit':r.returncode})
   cleanup=json.loads((trial/'cleanup-private.json').read_text())
   if not cleanup['listenerClosed'] or any(row['exit'] is None for row in cleanup['ownedChildren']):raise AssertionError('Native owned listener/child did not stop')
  source.write_bytes(original)
  (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n');(out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [source,driver,Path(__file__)]},indent=2)+'\n');print(json.dumps({'controls':len(rows),'allPassed':True}),flush=True)
 finally:
  source.write_bytes(original)
  with source.open('rb') as f:os.fsync(f.fileno())

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.absolute())
