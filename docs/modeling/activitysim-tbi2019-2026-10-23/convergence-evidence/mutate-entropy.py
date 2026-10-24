"""Mutate disposable source copies, never the active study implementation."""
import hashlib,json,os,shutil,subprocess,sys,tempfile
from pathlib import Path
E=Path(__file__).resolve().parent;root=Path.cwd(); source=root/'scripts/modeling'
cases=[
 ('harmless','population_entropy.py','from __future__ import annotations','# Harmless control comment.\nfrom __future__ import annotations',True),
 ('wrong-count-exponent','population_entropy.py','weights *= np.exp(((lo + hi) / 2) * column)','weights *= np.exp(((lo + hi) / 2) * (column > 0))',False),
 ('zero-reentry','population_entropy.py','weights[np.any(self.patterns[:, target == 0] > 0, axis=1)] = 0','weights[np.any(self.patterns[:, target == 0] > 0, axis=1)] *= 1',False),
 ('loose-convergence','population_entropy.py','worst <= tolerance','worst <= 1000',False),
 ('invalid-target','population_entropy.py','if not np.isfinite(target).all() or (target < 0).any():','if False:',False),
 ('seed-identity','population_entropy.py','if households is not self.households or tuple(controls) != self.controls or seed_matrix is not self.matrix:','if False:',False),
 ('seed-weight','population_entropy.py','if not np.isfinite(self.seed_weights).all() or (self.seed_weights <= 0).any():','if False:',False),
 ('contribution-fraction','population_entropy.py','if not np.equal(contributions, np.floor(contributions)).all():','if False:',False),
 ('invalid-settings','population_entropy.py','if tolerance <= 0 or max_iterations < 1:','if False:',False),
 ('roster-method','common_population.py','or row["synthesis_method"] != synthesis_method','or False',False),
 ('wrong-method-label','synthetic_population.py','"synthesis_method": method','"synthesis_method": SYNTHESIS_METHOD',False),
 ('iteration-forwarding','synthetic_population.py','max_iterations=fitting_max_iterations','max_iterations=200',False),
 ('unknown-method','synthetic_population.py','raise SyntheticPopulationError(f"Unknown population fitting method: {fitting_method}")','pass',False),
]
cases.append(('failed-fit-leaks', 'synthetic_population.py', 'if exclude_failed_fits and (not fit.converged or fit.unmet_controls or fit.outside_margin):', 'if False:', False))
# A narrow iteration gate fault must award convergence despite a failed residual.
cases[3]=('loose-convergence','population_entropy.py','converged=converged and math.isfinite(worst) and worst <= tolerance','converged=True',False)
cases.extend([
 ('parity-harmless','activitysim_chunk_parity.py','from pathlib import Path','# Harmless parity comment.\nfrom pathlib import Path',True),
 ('parity-tolerance','activitysim_chunk_parity.py','check_exact=True','check_exact=False',False),
 ('parity-census','activitysim_chunk_parity.py','if set(left) != required or set(right) != required:','if False:',False),
])
cases.extend([
 ('integer-harmless','population_integerization.py','import numpy as np','# Harmless integerization comment.\nimport numpy as np',True),
 ('integer-missing-margin','population_integerization.py',"raise PopulationSynthesisError('Controlled integerization needs published margins.')", "margins = {c.name: {cat: 0 for cat in c.categories} for c in controls}",False),
 ('integer-invalid-margin','population_integerization.py',"raise PopulationSynthesisError('Controlled integerization margins must be finite and nonnegative.')", "margin = np.nan_to_num(np.abs(margin), posinf=0)",False),
 ('integer-no-household','population_integerization.py',"raise PopulationSynthesisError('Controlled integerization needs a household total.')", "household_controls = [controls[0]]",False),
 ('integer-total','population_integerization.py',"raise PopulationSynthesisError('Published household total must be a nonnegative integer.')", "total = round(total)",False),
 ('integer-solver-failure','population_integerization.py',"raise PopulationSynthesisError('Controlled integerization failed: ' + result.message)", "return [0] * len(weights)",False),
 ('integer-bounds','population_integerization.py',"if (rounded < 0).any() or int(rounded.sum()) != int(total) or (actual < lower).any() or (actual > upper).any():", "if False:",False),
 ('integer-allocation','population_integerization.py',"if not np.array_equal(np.bincount(inverse, weights=counts, minlength=n), rounded):", "if False:",False),
 ('integer-option','synthetic_population.py',"raise SyntheticPopulationError(f\"Unsupported integerization method: {integerization_method}\")", "pass",False),
])
cases.append(('parity-identity','activitysim_chunk_parity.py',"if (key not in a or key not in b or a[key].isna().any() or b[key].isna().any()\n                or not a[key].is_unique or not b[key].is_unique):", "if False:",False))
cases.extend([
 ('chunk-no-split','activitysim_chunk_parity.py',"raise AssertionError('No actual chooser split appears in the chunk log')", "return {'chunk_log_records': 0, 'largest_chunk_ordinal': 0}",False),
 ('chunk-fallback','activitysim_chunk_parity.py',"if 'chunk_training_mode falling back to' in log:","if False:",False),
])
cases.append(('contribution-finite-nonnegative','population_entropy.py',"if not np.isfinite(contributions).all() or (contributions < 0).any():","if False:",False))
cases.append(('parity-export-key','activitysim_chunk_parity.py','key = identities[name]','key = a.columns[0]',False))
records=[]
for name,file,old,new,passing in cases:
 with tempfile.TemporaryDirectory() as tmp:
  dest=Path(tmp)/'modeling';shutil.copytree(source,dest,ignore=shutil.ignore_patterns('__pycache__'))
  p=dest/file;original=p.read_bytes();s=original.decode();assert old in s,name;p.write_text(s.replace(old,new,1))
  cmd=[sys.executable,'-B','-m','unittest','discover','-s',str(dest/'tests'),'-p','test_activitysim_chunk_parity.py' if file == 'activitysim_chunk_parity.py' else 'test_population_integerization.py' if file == 'population_integerization.py' else 'test_population_entropy*.py','-v']
  run=subprocess.run(cmd,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env={**os.environ,'OPENBLAS_NUM_THREADS':'1'})
  log=run.stdout.decode();(E/(name+'.log')).write_text(log)
  accepted=run.returncode==0 if passing else run.returncode!=0 and 'FAIL:' in log
  records.append({'control':name,'expected_pass':passing,'exit':run.returncode,'accepted':accepted,'source_sha256':hashlib.sha256(original).hexdigest(),'mutated_sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
  p.write_bytes(original);assert p.read_bytes()==original
  (E/'mutations.json').write_text(json.dumps(records,indent=2)+'\n')
  if not accepted:raise RuntimeError('Control did not reach expected assertion: '+name)
print(json.dumps(records))
