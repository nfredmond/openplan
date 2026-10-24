"""Prove group, positional and refusal controls before native model use."""
import hashlib,json,subprocess,sys
from pathlib import Path
p=Path('scripts/modeling/activitysim_bounded_logsums.py');original=p.read_bytes();out=Path(__file__).resolve().parent
cases=[('comment',None,None,True),
 ('row-bound','if not isinstance(max_rows, int) or isinstance(max_rows, bool) or max_rows < 1:','if False:',False),
 ('group-contiguity','if len(set(ids)) != len(ids):','if False:',False),
 ('split-person','    return result\n','    return [slice(i, min(i + max_rows, len(values))) for i in range(0, len(values), max_rows)]\n',False),
 ('result-order','if not result.index.equals(local.index) or len(result) != len(local):','if False:',False),
 ('positional-values',"output[span] = result['mode_choice_logsum'].to_numpy()", "output[span] = result['mode_choice_logsum'].to_numpy()[::-1]",False)]
records=[]
try:
 for name,old,new,survive in cases:
  source=original.decode()
  if old is not None and source.count(old)!=1:raise RuntimeError('Anchor mismatch')
  p.write_text(source+'\n# Harmless comment.\n' if old is None else source.replace(old,new))
  run=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','scripts/modeling/tests','-p','test_activitysim_bounded_logsums.py','-v'],capture_output=True,text=True)
  log=run.stdout+run.stderr;(out/('bounded-logsums-mutation-'+name+'.log')).write_text(log)
  p.write_bytes(original)
  ok=run.returncode==0 if survive else run.returncode!=0 and 'FAIL:' in log and 'ERROR:' not in log
  records.append({'name':name,'expected':'survive' if survive else 'assertion failure','exit_code':run.returncode,'expected_observed':ok,'restored_sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
  if not ok:break
finally:
 p.write_bytes(original);(out/'bounded-logsums-mutations.json').write_text(json.dumps(records,indent=2)+'\n')
if len(records)!=len(cases) or not all(r['expected_observed'] for r in records):sys.exit(1)
