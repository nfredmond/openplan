"""Wait for the owned population job, then execute dependent stages in order."""
import json,subprocess,sys,time
from pathlib import Path
E=Path(__file__).resolve().parent
pid=492313
while Path('/proc/'+str(pid)).exists():time.sleep(5)
health=E/'population-scope-health.json'
for _ in range(20):
 try:
  result=json.loads(health.read_text());break
 except (FileNotFoundError,json.JSONDecodeError):time.sleep(.5)
else:raise RuntimeError('Population scope health unavailable')
if result['exit_code']!=0:raise RuntimeError('Population job failed; downstream work stays stopped')
steps=['rebuild-bundle','prepare-parity','rebuild-archive','verify-archive','run-parity','run-full-arms']
records=[]
for step in steps:
 command=[sys.executable,'-B',str(E/(step+'.py'))]
 if step not in ['run-parity','run-full-arms']:
  command=['systemd-run','--user','--scope','--unit=tbi2019-'+step+'-20261024','-p','MemoryMax=9G','-p','MemorySwapMax=0',
           'env','OPENBLAS_NUM_THREADS=1','OMP_NUM_THREADS=1','/usr/bin/time','-v',sys.executable,'-B',str(E/'scope-runner.py'),str(E/(step+'-scope.json')),*command]
 (E/'continuation-stage.json').write_text(json.dumps({'stage':step,'state':'running','command':command},indent=2)+'\n')
 with (E/(step+'.log')).open('x') as log:run=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
 records.append({'stage':step,'exit_code':run.returncode});(E/'continuation-results.json').write_text(json.dumps(records,indent=2)+'\n')
 print(json.dumps(records[-1]),flush=True)
 if run.returncode:
  (E/'continuation-stage.json').write_text(json.dumps({'stage':step,'state':'stopped','exit_code':run.returncode},indent=2)+'\n');sys.exit(run.returncode)
(E/'continuation-stage.json').write_text(json.dumps({'state':'completed'},indent=2)+'\n')
