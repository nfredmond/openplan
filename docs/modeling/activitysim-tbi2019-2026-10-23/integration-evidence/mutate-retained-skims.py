"""Check retained expansion refusals and restore exact bytes."""
import hashlib,json,subprocess,sys
from pathlib import Path
p=Path('scripts/modeling/retained_skim_expansion.py');original=p.read_bytes();out=Path(__file__).resolve().parent
cases=[('comment',None,None,True),('request',"if requested != record['inputs']:",'if False:',False),('inventory',"if set(record['artifacts']) != {'mtc_skims.omx', 'transit_skims.npz'}:",'if False:',False),('hash',"sha256_for_file(source) != expected['sha256']",'False',False),('size',"source.stat().st_size != expected['bytes']",'False',False),('destination','if destination.exists():','if False:',False)]
cases.append(('launch-directory', "'implementations': {str(p.relative_to(_ROOT)): sha256_for_file(p)\n                                for p in [_ROOT / 'scripts/modeling/activitysim_mtc_inputs.py',\n                                          _ROOT / 'scripts/modeling/activitysim_transit_skims.py']}", "'implementations': {str(p.relative_to(Path.cwd())): sha256_for_file(p)\n                                for p in [Path.cwd() / 'scripts/modeling/activitysim_mtc_inputs.py',\n                                          Path.cwd() / 'scripts/modeling/activitysim_transit_skims.py']}", False))
results=[]
try:
 for name,old,new,survive in cases:
  source=original.decode()
  if old is not None and source.count(old)!=1:raise RuntimeError('Anchor mismatch')
  p.write_text(source+'\n# Harmless comment.\n' if old is None else source.replace(old,new))
  run=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','scripts/modeling/tests','-p','test_retained_skim_expansion.py','-v'],capture_output=True,text=True)
  text=run.stdout+run.stderr;(out/('retained-skims-mutation-'+name+'.log')).write_text(text)
  p.write_bytes(original)
  ok=run.returncode==0 if survive else run.returncode!=0 and 'FAIL:' in text and 'ERROR:' not in text
  results.append({'name':name,'expected':'survive' if survive else 'assertion failure','exit_code':run.returncode,'expected_observed':ok,'restored_sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
  if not ok:break
finally:
 p.write_bytes(original);(out/'retained-skims-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
if len(results)!=len(cases) or not all(r['expected_observed'] for r in results):sys.exit(1)
