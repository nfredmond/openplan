"""Verify WAC guards, with exact restoration and assertion-only failures."""
import hashlib,json,subprocess,sys
from pathlib import Path
p=Path('scripts/modeling/lodes_wac_inputs.py');original=p.read_bytes();out=Path(__file__).resolve().parent
cases=[('comment',None,None,True),('columns',"raise ValueError('WAC columns missing')",'return {}, {}',False),('identity',"if len(block) != 15 or not block.isdigit() or block in seen:",'if False:',False),('negative','if any(value < 0 for value in counts.values()):','if False:',False),('conservation',"if sum(counts[f'CNS{i:02d}'] for i in range(1, 21)) != counts['C000']:",'if False:',False),('coverage','if set(totals) != geoids:','if False:',False),('sum','result[name] += counts[field]','result[name] = counts[field]',False)]
results=[]
try:
 for name,old,new,survive in cases:
  source=original.decode()
  if old is not None and source.count(old)!=1:raise RuntimeError('Anchor mismatch')
  p.write_text(source+'\n# Harmless comment.\n' if old is None else source.replace(old,new))
  run=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','scripts/modeling/tests','-p','test_lodes_wac_inputs.py','-v'],capture_output=True,text=True)
  text=run.stdout+run.stderr;(out/('lodes-mutation-'+name+'.log')).write_text(text)
  p.write_bytes(original)
  # Missing-header and malformed-ID controls may raise incidental errors after
  # the intended assertRaises failure; they cannot count as useful mutations.
  ok=run.returncode==0 if survive else run.returncode!=0 and 'FAIL:' in text and 'ERROR:' not in text
  results.append({'name':name,'expected':'survive' if survive else 'assertion failure','exit_code':run.returncode,'expected_observed':ok,'restored_sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
  if not ok:break
finally:
 p.write_bytes(original);(out/'lodes-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
if len(results)!=len(cases) or not all(r['expected_observed'] for r in results):sys.exit(1)
