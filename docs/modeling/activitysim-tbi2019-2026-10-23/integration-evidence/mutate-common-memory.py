"""Retain source restoration and rejection sensitivity for the memory repair."""
import hashlib,json,subprocess,sys
from pathlib import Path
p=Path('scripts/modeling/common_population.py');original=p.read_bytes();out=Path(__file__).resolve().parent
cases=[('comment',None,None,True),('household-count','len(people) != household["persons"]','False',False),('worker-count','sum(p[1] for p in people) != household["workers"]','False',False),('person-numbers','sorted(p[0] for p in people) != list(range(1, len(people) + 1))','False',False),('row-width','if None in row or any(value is None for value in row.values()):','if False:',False),('canonical-spacing','json.dump(diagnostics, diagnostics_file, sort_keys=True, separators=(",", ":"),','json.dump(diagnostics, diagnostics_file, sort_keys=True, separators=(", ", ": "),',False),('nonfinite','                  ensure_ascii=True, allow_nan=False)','                  ensure_ascii=True, allow_nan=True)',False)]
r=[]
try:
 for name,old,new,survive in cases:
  source=original.decode()
  if old is not None and source.count(old)!=1:raise RuntimeError('Anchor mismatch: '+name)
  p.write_text(source+'\n# Harmless control.\n' if old is None else source.replace(old,new))
  logs=[];codes=[]
  for pattern in ['test_common_population.py','test_common_population_memory.py']:
   run=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','scripts/modeling/tests','-p',pattern,'-v'],capture_output=True,text=True);logs.append(run.stdout+run.stderr);codes.append(run.returncode)
  text='\n'.join(logs);(out/('common-memory-mutation-'+name+'.log')).write_text(text)
  p.write_bytes(original)
  ok=not any(codes) if survive else any(codes) and 'FAIL:' in text and 'ERROR:' not in text
  r.append({'name':name,'expected':'survive' if survive else 'assertion failure','exit_codes':codes,'expected_observed':bool(ok),'restored_sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
  if not ok:break
finally:
 p.write_bytes(original);(out/'common-memory-mutations.json').write_text(json.dumps(r,indent=2)+'\n')
if len(r)!=len(cases) or not all(x['expected_observed'] for x in r):sys.exit(1)
