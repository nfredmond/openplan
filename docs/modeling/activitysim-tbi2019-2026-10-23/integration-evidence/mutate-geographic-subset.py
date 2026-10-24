"""Exercise exclusion controls against targeted faults, then restore exact bytes."""
import hashlib,json,subprocess,sys
from pathlib import Path
p=Path('scripts/modeling/activitysim_geographic_subset.py');original=p.read_bytes();out=Path(__file__).resolve().parent
cases=[('comment',None,None,True),
 ('unknown-zone','if not excluded <= zone_set:','if False:',False),
 ('all-zones','if not positions:','if False:',False),
 ('source',"if not reason or not source:",'if False:',False),
 ('conservation','if any(households.values()):','if False:',False),
 ('matrix-order','np.ix_(positions, positions)','np.ix_(list(reversed(positions)), positions)',False),
 ('household-exclusion','if home not in excluded:','if True:',False),
 ('person-exclusion','if hid in kept_households:','if True:',False),
 ('duplicate-zone','if len(zone_set) != len(zone_ids):','if False:',False)]
cases += [
 ('home-zone', 'home not in zone_set', 'False', False),
 ('duplicate-household', 'hid in households or', 'False or', False),
 ('duplicate-person', 'pid in seen_people or', 'False or', False),
 ('existing-destination', "raise ValueError('Destination already exists')", 'destination.rmdir()', False),
 ('no-residents', 'if not kept_households:', 'if False:', False),
 ('mapped-parent', 'if inp.list_mappings():', 'if False:', False),
 ('matrix-shape', "raise ValueError('Matrix shape differs from zone order')", 'continue', False),
]
cases.append(('sorted-recode',
 'positions = sorted((i for i, zone in enumerate(zone_ids) if zone not in excluded),\n                       key=lambda i: zone_ids[i])',
 'positions = [i for i, zone in enumerate(zone_ids) if zone not in excluded]', False))
results=[]
try:
 for name,old,new,survive in cases:
  source=original.decode()
  if old is not None and source.count(old)!=1:raise RuntimeError('Anchor mismatch')
  p.write_text(source+'\n# Harmless comment.\n' if old is None else source.replace(old,new))
  run=subprocess.run([sys.executable,'-B','-m','unittest','discover','-s','scripts/modeling/tests','-p','test_activitysim_geographic_subset.py','-v'],capture_output=True,text=True)
  log=run.stdout+run.stderr;(out/('geographic-subset-mutation-'+name+'.log')).write_text(log)
  p.write_bytes(original)
  ok=run.returncode==0 if survive else run.returncode!=0 and 'FAIL:' in log and 'ERROR:' not in log
  results.append({'name':name,'expected':'survive' if survive else 'assertion failure','exit_code':run.returncode,'expected_observed':ok,'restored_sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
  if not ok:break
finally:
 p.write_bytes(original);(out/'geographic-subset-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
if len(results)!=len(cases) or not all(r['expected_observed'] for r in results):sys.exit(1)
