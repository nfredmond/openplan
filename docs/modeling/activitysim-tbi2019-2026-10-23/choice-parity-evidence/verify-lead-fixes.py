"""Verify harmless and targeted controls, restoring each owned source exactly."""
import json,subprocess
from pathlib import Path
E=Path(__file__).resolve().parent;ROOT=Path.cwd()
py='/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python'
checks=[
 ('import-guard',Path('openplan/src/test/modeling-requirements-cover-the-modeling-imports.test.ts'),['npm','exec','--','vitest','run','src/test/modeling-requirements-cover-the-modeling-imports.test.ts','--pool=forks','--maxWorkers=2'],ROOT/'openplan',lambda s:s.replace('"codecs", ',''),'AssertionError'),
 ('catalog-pin',Path('workers/aequilibrae_worker/test_population_image_packaging.py'),[py,'-B','-m','unittest','discover','-s','workers/aequilibrae_worker','-p','test_population_image_packaging.py','-v'],ROOT,lambda s:s.replace("'us_census_acs5_pums_2019'","'us_census_acs5_pums_1900'"),'FAIL:'),
 ('psutil-dependency',Path('docs/modeling/activitysim-tbi2019-2026-10-23/integration-evidence/activitysim-memory-runner.py'),['/home/nathaniel/.local/bin/python3.11','-S','-m','unittest','discover','-s','scripts/modeling/tests','-p','test_activitysim_memory_runner.py','-v'],ROOT,lambda s:'import psutil\n'+s,"ModuleNotFoundError: No module named 'psutil'")]
records=[]
for name,path,command,cwd,mutate,reason in checks:
 original=path.read_bytes()
 try:
  for harmless in (True,False):
   changed=original.decode()+ ('\n// harmless comment\n' if path.suffix=='.ts' else '\n# harmless comment\n') if harmless else mutate(original.decode())
   assert changed!=original.decode();path.write_text(changed)
   run=subprocess.run(command,cwd=cwd,capture_output=True,text=True)
   log=run.stdout+run.stderr
   (E/f'control-{name}-{harmless}.log').write_text(log)
   accepted=run.returncode==0 if harmless else run.returncode!=0 and reason in log
   records.append({'name':name,'harmless':harmless,'exit_code':run.returncode,'accepted':accepted,'expected_failure':None if harmless else reason})
   assert accepted,records[-1]
 finally:
  path.write_bytes(original);assert path.read_bytes()==original
 for record in records:
  if record['name']==name:record['restored']=True
(E/'lead-fix-controls.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(records))
