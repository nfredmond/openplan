"""Continue owned preparation jobs; never open survey outcomes or frozen locks."""
import datetime,json,os,subprocess,time
from pathlib import Path
ROOT=Path('data/_screening_cache/tbi2019-integration')
EVIDENCE=Path(__file__).resolve().parent
PYTHON='/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/bin/python'
record={'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'claim':'input and modeled preparation only','stages':[]}
def save():
 (EVIDENCE/'pipeline-status.retry.json').write_text(json.dumps(record,indent=2)+'\n')
def live(pid):
 try:os.kill(pid,0);return True
 except ProcessLookupError:return False
save()
while any(live(p) for p in [2839520]):time.sleep(10)
requirements=[EVIDENCE/'population-result.json',ROOT/'expanded-skims/record.json']
missing=[str(p) for p in requirements if not p.exists()]
if missing:
 record.update(status='blocked_before_bundle',missing=missing)
else:
 for label,script,args in [('bundle','prepare-bundle.py',[]),('current','run-modeled-arm.py',['current']),('semcog','run-modeled-arm.py',['semcog'])]:
  command=['systemd-run','--user','--scope','--unit=op-tbi2019-11910f11-'+label,'-p','MemoryMax=6G','-p','MemorySwapMax=0','env','OPENBLAS_NUM_THREADS=1','OMP_NUM_THREADS=2','/usr/bin/time','-v',PYTHON,'-u','-B',str(EVIDENCE/script),*args]
  stage={'name':label,'command':command,'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
  record['stages'].append(stage);save()
  with (EVIDENCE/('pipeline-'+label+'.log')).open('x') as log:
   run=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
  stage.update(exit_code=run.returncode,finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
  stage['scope_properties']=subprocess.run(['systemctl','--user','show','op-tbi2019-11910f11-'+label+'.scope','-p','Result','-p','MemoryPeak','-p','MemoryMax','-p','MemorySwapMax'],capture_output=True,text=True).stdout
  if label in ['current','semcog']:
   path=EVIDENCE/('modeled-'+label+'.json')
   prior=json.loads(path.read_text()) if path.exists() else {}
   if 'started_at' not in prior:
    path.write_text(json.dumps({'arm':label,'completion':'failed','reason':'run controller did not retain a terminal model receipt','exit_code':run.returncode,'scope_properties':stage['scope_properties'],'tour_count':None,'mode_counts_MODELED':None,'mode_shares_MODELED':None,'outcomes_accessed':False},indent=2)+'\n')
  save()
  if label=='bundle' and run.returncode:
   record['status']='blocked_before_model_runs';break
  # Both arms receive an attempt independently if the common bundle exists.
 else:record['status']='model_attempts_finished'
if record.get('status') in ['blocked_before_bundle','blocked_before_model_runs']:
 for arm in ['current','semcog']:
  result={'arm':arm,'completion':'not_started','reason':record['status'],'tour_count':None,'mode_counts_MODELED':None,'mode_shares_MODELED':None,'outcomes_accessed':False}
  (EVIDENCE/('modeled-'+arm+'.json')).write_text(json.dumps(result,indent=2)+'\n')
record['finished_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();save()
print(json.dumps(record),flush=True)
