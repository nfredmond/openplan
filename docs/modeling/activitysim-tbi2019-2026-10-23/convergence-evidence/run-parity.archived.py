"""Sequential exact parity proof using the installed engine's own chunking."""
import json,os,shutil,subprocess,sys,time,importlib.metadata
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
from activitysim_chunk_parity import compare_tables,digest,chunk_evidence
ROOT=Path('data/_screening_cache/tbi2019-convergence').resolve();E=Path(__file__).resolve().parent
stock=Path('/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs')
if importlib.metadata.version('activitysim')!='1.5.1':raise RuntimeError('Unadmitted engine version')
freeze=json.loads((E/'parity-input-freeze.json').read_text())
for name,d in freeze['input_files'].items():
 if digest(ROOT/'parity-inputs'/name)!=d['sha256']:raise RuntimeError('Parity input changed')
for name,sha in freeze['configuration_files'].items():
 if digest(ROOT/name)!=sha:raise RuntimeError('Parity configuration changed')
records=[]
for arm in ['current','semcog']:
 for mode in ['disabled','training','production']:
  output=ROOT/('parity-'+arm+'-'+mode);output.mkdir(exist_ok=False)
  if mode=='production':
   cache=ROOT/('parity-'+arm+'-training')/'cache/chunk_cache.csv'
   if not cache.is_file():raise RuntimeError('Training cache missing; production fallback refused')
   (output/'cache').mkdir();shutil.copyfile(cache,output/'cache/chunk_cache.csv')
  scope='tbi2019-parity-'+arm+'-'+mode+'-20261024'
  command=['systemd-run','--user','--scope','--unit='+scope,'-p','MemoryMax=9G','-p','MemorySwapMax=0',
           'env','OPENBLAS_NUM_THREADS=1','OMP_NUM_THREADS=1','/usr/bin/time','-v',sys.executable,'-B',str(E/'scope-runner.py'),str(output/'scope-health.json'),sys.executable,'-B','-m','activitysim','run',
           '-c',str(ROOT/('parity-config-'+arm+'-'+mode)),'-c',str(ROOT/'bundle/configs'),'-c',str(stock),
           '-d',str(ROOT/'parity-inputs'),'-o',str(output)]
  start=time.monotonic()
  with (output/'stdout.log').open('x') as log:run=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
  record={'arm':arm,'mode':mode,'command':command,'exit_code':run.returncode,'elapsed_seconds':time.monotonic()-start,'stdout_sha256':digest(output/'stdout.log')}
  
  if (output/'scope-health.json').exists():record['health']=json.loads((output/'scope-health.json').read_text())
  records.append(record);(E/'parity-runs.json').write_text(json.dumps(records,indent=2)+'\n')
  print(json.dumps(record),flush=True)
  if run.returncode:raise RuntimeError('Parity engine run failed; full runs remain blocked')
  log=(output/'stdout.log').read_text()
  if mode=='production' and 'chunk_training_mode falling back to' in log:raise RuntimeError('Production fell back to training')
  if mode!='disabled':
   record['actual_chunking']=chunk_evidence(log)
   try:tables=compare_tables(ROOT/('parity-'+arm+'-disabled'),output)
   except AssertionError as exc:
    failure={'status':'failed_exact_parity','arm':arm,'mode':mode,'error':str(exc),'full_runs_authorized_by_parity':False}
    (E/'parity-result.json').write_text(json.dumps(failure,indent=2)+'\n');print(json.dumps(failure),flush=True);sys.exit(2)
   record['parity']=tables
   (E/'parity-runs.json').write_text(json.dumps(records,indent=2)+'\n')
(E/'parity-result.json').write_text(json.dumps({'status':'passed_exact_value_parity','runs':records,'full_runs_authorized_by_parity':True},indent=2)+'\n')
