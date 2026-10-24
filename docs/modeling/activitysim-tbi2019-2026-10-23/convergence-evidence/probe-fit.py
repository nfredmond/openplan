import json,sys,collections,time
from pathlib import Path
import numpy as np
from scipy.optimize import linprog
sys.path.insert(0,'scripts/modeling')
import census_pums as cp,census_bulk_inputs as bulk,population_synthesis as ps
R=Path('/home/nathaniel/.t3/worktrees/openplan/t3-11910f11/data/_screening_cache/tbi2019-integration')
E=Path('docs/modeling/activitysim-tbi2019-2026-10-23')
m=json.loads((E/'integration-evidence/population-input-summary.json').read_text());raw=json.loads((R/'acs-controls.json').read_text())
p,summary=bulk.read_pums([R/'pums-household.response',R/'pums-h-wi.response'],[R/'pums-person.response',R/'pums-p-wi.response'],m['pumas'],m['profile'])
s,d=cp.seed_households_from_pums(p);cs,_=cp.controls_for_geography('tract');mat=ps.build_seed_matrix(s,cs)
A=np.concatenate([mat.contributions[c.name] for c in cs],axis=1)
u,inv=np.unique(A,axis=0,return_inverse=True)
w=np.bincount(inv,weights=[h.weight for h in s]); print('SEED',len(s),'patterns',len(u),'maxpersons',max(h.persons for h in s),flush=True)
np.savez('data/_screening_cache/tbi2019-convergence/seed-matrix.npz',A=A,unique=u,inverse=inv,weights=w)
for g in ['27123031500',list(raw)[0],'27053003300']:
 t=cp.zone_targets_from_acs(raw[g],cs);b=np.array([t[c.name][cat] for c in cs for cat in c.categories]);
 r=linprog(np.zeros(len(u)),A_eq=u.T,b_eq=b,bounds=(0,None),method='highs');print(g,'LP',r.success,r.message,flush=True)
 # exact exponential coordinate update: solve each person-count constraint with its count in the exponent.
 weights=w.copy(); active=np.all(u[:,b==0]==0,axis=1);weights[~active]=0
 for it in range(10000):
  for j,target in enumerate(b):
   if target==0:continue
   a=u[:,j];pos=(a>0)&active; av=a[pos];wv=weights[pos]
   lo,hi=-40.,40.
   for _ in range(45):
    mid=(lo+hi)/2
    if np.dot(av,wv*np.exp(mid*av))>target:hi=mid
    else:lo=mid
   weights[pos]*=np.exp(((lo+hi)/2)*av)
  err=np.max(np.abs(u.T@weights-b)/np.maximum(b,1))
  if err<=.001:break
 print('COORD',it+1,err,'nonzero',sum(weights>0),flush=True)
