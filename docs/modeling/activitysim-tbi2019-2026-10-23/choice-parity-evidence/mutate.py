"""Run isolated source mutations and verify byte restoration."""
import hashlib,json,shutil,subprocess,tempfile
from pathlib import Path
E=Path(__file__).resolve().parent
PYTHON='/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python'
source=Path('scripts/modeling/activitysim_choice_parity.py')
original=source.read_bytes()
mutations=[('harmless',None,None,True),
 ('choice-tolerance','if auxiliary(column) and','if True and',False),
 ('wide-tolerance','1e-12*max','1e-6*max',False),
 ('five-ulp','4*max(math.ulp','5*max(math.ulp',False),
 ('missing-table',"raise ParityFailure([{'error': 'Final table census differs'}])",'return []',False),
 ('row-identity',"raise ParityFailure([{'table': name, 'error': 'Ambiguous row identity'}])",'return []',False),
 ('schema','if list(a.columns) != list(b.columns) or not a[key].equals(b[key]):','if list(a.columns) != list(b.columns) or not a[key].equals(b[key]):\n            return []',False),
 ('nonfinite','failures.append(record)','pass # lost failure',False)]
records=[]
for name,old,new,survive in mutations:
 with tempfile.TemporaryDirectory() as tmp:
  root=Path(tmp);shutil.copytree('scripts/modeling/tests',root/'tests',ignore=shutil.ignore_patterns('__pycache__'))
  shutil.copyfile('scripts/modeling/activitysim_chunk_parity.py',root/'activitysim_chunk_parity.py')
  p=root/source.name
  mutated=original.decode()+'\n# harmless custody comment\n' if old is None else original.decode().replace(old,new)
  assert old is None or mutated!=original.decode()
  p.write_text(mutated)
  run=subprocess.run([PYTHON,'-B','-m','unittest','discover','-s',str(root/'tests'),'-p','test_activitysim_choice_parity.py','-v'],capture_output=True,text=True)
  (E/f'mutation-{name}.log').write_text(run.stdout+run.stderr)
  p.write_bytes(original);assert p.read_bytes()==original
  accepted=run.returncode==0 if survive else run.returncode!=0 and 'FAIL:' in run.stderr
  records.append({'name':name,'harmless':survive,'exit_code':run.returncode,'accepted':accepted,'restored':True})
  if not accepted:break
assert source.read_bytes()==original
(E/'mutations.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records));assert all(r['accepted'] for r in records)
