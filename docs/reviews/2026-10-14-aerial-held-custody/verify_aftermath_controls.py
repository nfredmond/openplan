"""Challenge the actual HTTP/application aftermath with retained synthetic clones."""
import argparse,hashlib,json,os,re,subprocess,sys
from pathlib import Path

def intended(code,log,reason):
 return code==1 and re.search(r'^'+re.escape(reason)+r'\s*$',log,re.MULTILINE) is not None and not any(x in log for x in ['SyntaxError:','ReferenceError:','TypeError:','TimeoutExpired:'])
def run(repo,out):
 os.umask(0o077);out.mkdir(mode=0o700,parents=True)
 engine=repo/'openplan/src/lib/aerial/artifact-custody-server.ts';retry=repo/'openplan/src/app/api/aerial/processing-callback/custody/route.ts';callback=repo/'openplan/src/app/api/aerial/processing-callback/route.ts';migration=repo/'openplan/supabase/migrations/20261017000011_aerial_preserve_held_custody.sql'
 originals={p:p.read_bytes() for p in [engine,retry,callback,migration]};rows=[];oracles=[]
 def execute(label,sql=None):
  target=out/label;candidate=out/(label+'.sql');candidate.write_bytes(originals[migration] if sql is None else sql.encode())
  try:
   r=subprocess.run([sys.executable,'-B',str(Path(__file__).with_name('native_aftermath.py')),'--repo',str(repo),'--out',str(target),'--migration',str(candidate)],capture_output=True,text=True,timeout=240)
  except subprocess.TimeoutExpired:
   from verify_upgrade_controls import cleanup_owned_cluster
   cleanup_owned_cluster()
   raise TimeoutError('Owned native HTTP control deadline; cleanup requested') from None
  log=r.stdout+r.stderr
  if (target/'application-private.log').exists():log+='\n'+(target/'application-private.log').read_text()
  (out/(label+'-private.log')).write_text(log);return r.returncode,log
 def positive(label,sql=None):
  code,_=execute(label,sql);assert code==0,label+' native application cohort succeeds'
  report=json.loads((out/label/'result.json').read_text());assert len(report['cases'])==7 and report['actual23514']==2
  rows.append({'case':label,'outcome':'survived','cases':7,'retainedDatabase':report['database']})
 def changed(path,old,new):
  text=originals[path].decode();assert old in text;return text.replace(old,new,1)
 try:
  positive('baseline');positive('harmless-comment',originals[migration].decode()+'\n-- Harmless held constraint comment.\n');positive('restored-after-harmless')
  cases=[
   ('serialization-code-loop',migration,changed(migration,"ERRCODE = '23514'","ERRCODE = '40001'"),'Error: Native held constraint returns promptly through PostgREST'),
   ('conflict-recovery-disabled',engine,changed(engine,'if (writeError?.code === "23514" && writeError.message === "Original held aerial custody cannot be replaced")','if (false)'),'Error: Native conflict recovery retains complete original custody'),
   ('missing-roster-ignored',engine,changed(engine,'if (missing.length > 0)','if (false)'),'Error: Native bulk rollback preserves missing roster as outstanding'),
   ('retry-readiness-skipped',retry,changed(retry,'if (result.posture.verificationReadiness === "partial")','if (false)'),'AssertionError: Native retry readiness repairs while human edits remain'),
   ('callback-readiness-skipped',callback,changed(callback,'if (custody.verificationReadiness === "partial")','if (false)'),'AssertionError: Native callback readiness repairs while human edits remain'),
   ('human-readiness-replaced',retry,changed(retry,'.eq("verification_readiness", "pending")','.eq("processing_job_id", job.id)'),'AssertionError: Native human readiness repairs while human edits remain'),
  ]
  for label,path,text,reason in cases:
   try:
    if path==migration:code,log=execute(label,text)
    else:path.write_text(text);code,log=execute(label)
    assert intended(code,log,reason),label+' reaches its intended native diagnostic'
    for name,c,l,r,wanted in [('exact',code,log,reason,True),('success',0,log,reason,False),('wrong-exit',2,log,reason,False),('wrong-diagnostic',code,log,'Unrelated error',False),('source-only',code,'throw Error("'+reason+'");',reason,False),('syntax',code,'SyntaxError: '+reason,reason,False)]:
     actual=intended(c,l,r);assert actual==wanted;oracles.append({'case':label,'oracle':name,'accepted':actual})
    rows.append({'case':label,'outcome':'intended_failure','diagnostic':reason})
   finally:
    for p,raw in originals.items():p.write_bytes(raw)
  positive('restored')
  bindings={str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in list(originals)+[Path(__file__),Path(__file__).with_name('native_aftermath.py'),Path(__file__).with_name('native_aftermath.mjs')]}
  for name,value in [('controls',rows),('oracles',oracles),('bindings',bindings)]: (out/(name+'.json')).write_text(json.dumps(value,indent=2)+'\n')
  print({'positives':4,'faults':len(cases),'oracles':len(oracles)})
 finally:
  for p,raw in originals.items():p.write_bytes(raw);assert p.read_bytes()==raw
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.resolve())
