import json,sys,csv,collections
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
import census_pums as cp
root=Path('/home/nathaniel/.t3/worktrees/openplan/t3-11910f11/data/_screening_cache/tbi2019-integration')
d=json.loads((root/'common_population/diagnostics.json').read_text())
print('KEYS',d.keys(),flush=True)
fits=d['zone_fits']
for f in fits:f.pop('weights',None)
raw=json.loads((root/'acs-controls.json').read_text()); cs,_=cp.controls_for_geography('tract')
zs=list(csv.DictReader(open('docs/modeling/activitysim-transit-2026-10-23/zones.csv')))
for z,f in zip(zs,fits):
 f['GEOID']=z['GEOID'];t=cp.zone_targets_from_acs(raw[z['GEOID']],cs)
 f['target_totals']={k:sum(v.values()) for k,v in t.items()}
 f['household_total_spread']=max(f['target_totals'][c.name] for c in cs if c.level=='household')-min(f['target_totals'][c.name] for c in cs if c.level=='household')
print('worst',collections.Counter(f['worst_control'] for f in fits),flush=True)
print('hh disagreement',sum(f['household_total_spread']>0 for f in fits),flush=True)
print('outmargin',[(f['zone_id'],f['GEOID'],f['target_totals'],f['outside_margin']) for f in fits if f['outside_margin']],flush=True)
Path('docs/modeling/activitysim-tbi2019-2026-10-23/convergence-evidence/prior-zone-diagnostics.json').write_text(json.dumps(fits,indent=2)+'\n')
