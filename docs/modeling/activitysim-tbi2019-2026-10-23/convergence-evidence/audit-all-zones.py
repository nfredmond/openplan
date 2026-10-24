import json,sys,csv,time
from pathlib import Path
from dataclasses import asdict
import numpy as np
from scipy.optimize import linprog
sys.path.insert(0,'scripts/modeling')
import population_synthesis as ps,population_entropy as pe,census_pums as cp
R=Path('/home/nathaniel/.t3/worktrees/openplan/t3-11910f11/data/_screening_cache/tbi2019-integration');E=Path('docs/modeling/activitysim-tbi2019-2026-10-23/convergence-evidence')
a=np.load('data/_screening_cache/tbi2019-convergence/seed-matrix.npz');u=a['unique'];w=a['weights'];cs,_=cp.controls_for_geography('tract')
seed=[ps.SeedHousehold(str(i),v,{}) for i,v in enumerate(w)];con={};offset=0
for c in cs:con[c.name]=u[:,offset:offset+len(c.categories)];offset+=len(c.categories)
mat=ps.SeedMatrix(tuple(cs),con,len(seed));fitter=pe.EntropyFitter(seed,cs,mat)
raw=json.loads((R/'acs-controls.json').read_text());zs=list(csv.DictReader(open('docs/modeling/activitysim-transit-2026-10-23/zones.csv')));results=[]
for z in zs:
 g=z['GEOID'];targets=cp.zone_targets_from_acs(raw[g],cs);b=np.array([targets[c.name][cat] for c in cs for cat in c.categories]);start=time.monotonic()
 lp=linprog(np.zeros(len(u)),A_eq=u.T,b_eq=b,bounds=(0,None),method='highs')
 fit=fitter(seed,cs,targets,zone_id=int(z['zone_id']),seed_matrix=mat,margins=cp.zone_margins_from_acs(raw[g],cs),max_iterations=2000 if lp.success else 200)
 row=asdict(fit);row.pop('weights');row.update(GEOID=g,exact_seed_feasible=bool(lp.success),lp_status=lp.message,elapsed=time.monotonic()-start)
 results.append(row)
 print(json.dumps(row),flush=True)
 (E/'entropy-audit.json').write_text(json.dumps(results,indent=2)+'\n')
