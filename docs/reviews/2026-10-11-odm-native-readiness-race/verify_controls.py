"""Prove complete listener publication with restored bounded source variants."""
import argparse,ast,hashlib,json,os,re,subprocess,sys
from pathlib import Path

def run(repo,out):
 os.umask(0o077);out.mkdir(mode=0o700)
 source=repo/'docs/reviews/2026-10-11-odm-native-readiness-race/readiness.py';tests=source.with_name('test_readiness.py');original=source.read_bytes();test_before=tests.read_bytes();census={n.name for n in ast.walk(ast.parse(test_before)) if isinstance(n,ast.FunctionDef) and n.name.startswith('test_')}
 def replace(value,before,after):
  if value.count(before)!=1:raise ValueError('Readiness mutation anchor differs')
  return value.replace(before,after,1)
 no_file_sync=lambda s:replace(s,'        os.fsync(stream.fileno())','        pass # file sync omitted')
 def non_atomic(s):
  for before,after in [("    temporary = path.with_name('.'+path.name+'.pending')",'    temporary = path'),('    os.link(temporary, path)','    pass # direct publication'),('    temporary.unlink()','    pass # direct file retained')]:s=replace(s,before,after)
  return s
 def overwrite(s):
  return replace(replace(s,'    os.link(temporary, path)','    os.replace(temporary, path)'),'    temporary.unlink()','    if temporary.exists():temporary.unlink()')
 cases=[('partial-visible','test_partial_listener_is_not_visible',non_atomic,'Readiness must remain invisible before complete JSON'),('existing-replaced','test_existing_listener_is_never_replaced',overwrite,'FileExistsError not raised'),('file-sync-omitted','test_complete_file_and_parent_are_synchronized',no_file_sync,'Complete listener and parent must synchronize in order'),('directory-sync-omitted','test_complete_file_and_parent_are_synchronized',lambda s:replace(s,'        os.fsync(descriptor)','        pass # parent sync omitted'),'Complete listener and parent must synchronize in order'),('failed-file-sync-publishes','test_failed_file_sync_cannot_publish_readiness',no_file_sync,'Failed synchronization cannot publish readiness')]
 if {c[1] for c in cases}!=census:raise AssertionError('Readiness test lacks a targeted control')
 rows=[]
 def execute(label,test=None):
  r=subprocess.run([sys.executable,'-B',str(tests)]+(['Checks.'+test] if test else []),cwd=repo,capture_output=True,timeout=10,env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'});output=(r.stdout+r.stderr).decode();(out/(label+'.log')).write_text(output);return r.returncode,output
 def positive(label,payload):
  source.write_bytes(payload);code,output=execute(label)
  if code or 'Ran 4 tests' not in output:raise AssertionError(label+': positive readiness control failed\n'+output)
  rows.append({'control':label,'outcome':'survived'})
 try:
  positive('baseline',original);positive('harmless-comment',original+b'\n# Harmless readiness comment.\n');positive('restored-after-harmless',original)
  for label,test,transform,reason in cases:
   try:
    changed=transform(original.decode());ast.parse(changed);source.write_text(changed);code,output=execute(label,test)
    lines=output.splitlines();starts=[i for i,line in enumerate(lines) if re.match(r'^[A-Za-z_][\w.]*Error:',line)]
    diagnostic=''
    if starts:
     end=next((i for i in range(starts[-1]+1,len(lines)) if lines[i].startswith('-----')),len(lines));diagnostic='\n'.join(lines[starts[-1]:end])
    if code==0 or 'FAIL: '+test not in output or not starts or reason not in diagnostic:raise AssertionError(label+': wrong readiness failure\n'+output)
    rows.append({'control':label,'test':test,'outcome':'intended_failure','reason':reason})
   finally:source.write_bytes(original)
  positive('restored-final',original)
  if source.read_bytes()!=original or tests.read_bytes()!=test_before:raise AssertionError('Readiness subjects were not restored')
  (out/'controls.json').write_text(json.dumps(rows,indent=2)+'\n');(out/'source-bindings.json').write_text(json.dumps({str(p.relative_to(repo)):hashlib.sha256(p.read_bytes()).hexdigest() for p in [source,tests,Path(__file__)]},indent=2)+'\n');print(json.dumps({'tests':4,'controls':len(rows),'allPassed':True}),flush=True)
 finally:
  source.write_bytes(original)
  with source.open('rb') as f:os.fsync(f.fileno())

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--repo',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();run(a.repo.resolve(),a.out.absolute())
