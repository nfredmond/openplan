from pathlib import Path
import subprocess,json
root=Path('/home/nathaniel/.local/state/openplan/m2d4-refund-matching-2026-09-09/openplan');out=Path('/home/nathaniel/.local/state/openplan/m2d4-refund-matching-evidence-2026-09-09');p=root/'vitest.config.ts';original=p.read_text();key="process.env.OPENPLAN_RLS_LIVE_TEST !== '1'";assert key in original
results=[]
try:
 for name,source,expected,reason in [('harmless comment',original+'\n// Harmless scheduling control\n',0,''),('live files overlap',original.replace(key,'true'),1,'EEXIST'),('ordinary suites serialized',original.replace(key,'false'),1,'ordinary-parallel=false')]:
  p.write_text(source)
  try:r=subprocess.run(['node','node_modules/vitest/vitest.mjs','run','src/test/live-rls-suites-run-serially.test.ts'],cwd=root,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
  finally:p.write_text(original)
  (out/('runner-'+name.replace(' ','-')+'.log')).write_text(r.stdout)
  assert (r.returncode==0)==(expected==0) and reason in r.stdout,r.stdout
  results.append({'case':name,'exitCode':r.returncode,'result':'survived' if r.returncode==0 else 'targeted defect detected','failureEvidence':reason});print(results[-1],flush=True)
 (out/'runner-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
finally:p.write_text(original)
