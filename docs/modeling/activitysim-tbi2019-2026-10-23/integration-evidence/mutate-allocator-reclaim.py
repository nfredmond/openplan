"""Retain sensitivity and restoration for the allocator-call wrapper."""
import hashlib,json,subprocess,sys
from pathlib import Path
p=Path('scripts/modeling/activitysim_allocator_reclaim.py');original=p.read_bytes();out=Path(__file__).resolve().parent
cases=[('comment',None,None,True),('omit-hook','        reclaim()','        pass',False),('duplicate-call','        return original(*args, **kwargs)','        original(*args, **kwargs)\n        return original(*args, **kwargs)',False),('discard-return','        return original(*args, **kwargs)','        original(*args, **kwargs)',False),('reorder','        reclaim()\n        return original(*args, **kwargs)','        result = original(*args, **kwargs)\n        reclaim()\n        return result',False)]
records=[]
try:
 for name,old,new,survive in cases:
  source=original.decode()
  if old is not None and source.count(old)!=1:raise RuntimeError('Anchor mismatch')
  p.write_text(source+'\n# Harmless comment.\n' if old is None else source.replace(old,new))
  run=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','scripts/modeling/tests','-p','test_activitysim_allocator_reclaim.py','-v'],capture_output=True,text=True)
  log=run.stdout+run.stderr;(out/('allocator-reclaim-mutation-'+name+'.log')).write_text(log)
  p.write_bytes(original)
  ok=run.returncode==0 if survive else run.returncode!=0 and 'FAIL:' in log and 'ERROR:' not in log
  records.append({'name':name,'expected':'survive' if survive else 'assertion failure','exit_code':run.returncode,'expected_observed':ok,'restored_sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
  if not ok:break
finally:
 p.write_bytes(original);(out/'allocator-reclaim-mutations.json').write_text(json.dumps(records,indent=2)+'\n')
if len(records)!=len(cases) or not all(r['expected_observed'] for r in records):sys.exit(1)
