"""Sequential choice parity on two fixed subsets and both coefficient arms."""
import json, shutil, subprocess, sys, time
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
from activitysim_choice_parity import compare_choices, ParityFailure, chunk_evidence, digest
ROOT=Path('data/_screening_cache/tbi2019-choice-parity').resolve()
OLD=Path('/home/nathaniel/.t3/worktrees/openplan/t3-8dddce31/data/_screening_cache/tbi2019-convergence')
E=Path(__file__).resolve().parent
stock=Path(sys.executable).resolve().parent # overwritten with the version-pinned configuration root
import activitysim, importlib.metadata
assert importlib.metadata.version('activitysim')=='1.5.1'
stock=Path(activitysim.__file__).parent/'examples/prototype_mtc/configs'
freeze=json.loads((E/'input-freeze.json').read_text())
for group in ('inputs','configurations'):
 for folder,files in freeze[group].items():
  for name,sha in files.items():assert digest(ROOT/folder/name)==sha,(folder,name)
records=[]
for size in (64,2000):
 for arm in ('current','semcog'):
  reference=None;training=None
  for mode in ('disabled','training','production'):
   output=ROOT/f'parity-{size}-{arm}-{mode}'
   record={'households':size,'arm':arm,'mode':mode,'output':str(output)}
   if size==64 and arm=='current' and mode in ('disabled','training'):
    output=OLD/f'parity-current-{mode}';record.update(output=str(output),reused=True)
    for name,d in freeze['existing_outputs_verified'][mode].items():assert digest(output/name)==d['sha256']
    record['health']=json.loads((output/'scope-health.json').read_text())
    log=(E.parent/'convergence-evidence'/f'parity-current-{mode}.activitysim.log').read_text()
   else:
    output.mkdir(exist_ok=False)
    if mode=='production':
     cache=training/'cache/chunk_cache.csv'
     if not cache.is_file():raise RuntimeError('No training cache; production refused')
     (output/'cache').mkdir();shutil.copyfile(cache,output/'cache/chunk_cache.csv')
     record['cache_input_sha256']=digest(cache)
    command=['systemd-run','--user','--scope','--unit='+f'tbi2019-choice-{size}-{arm}-{mode}',
             '-p','MemoryMax=9G','-p','MemorySwapMax=0','env','OPENBLAS_NUM_THREADS=1','OMP_NUM_THREADS=1',
             '/usr/bin/time','-v',sys.executable,'-B',str(E.parent/'convergence-evidence/scope-runner.py'),str(output/'scope-health.json'),
             sys.executable,'-B','-m','activitysim','run','-c',str(ROOT/f'parity-config-{arm}-{mode}'),
             '-c',str(ROOT/'bundle/configs'),'-c',str(stock),'-d',str(ROOT/('parity-inputs' if size==64 else 'inputs-2000')),'-o',str(output)]
    record['command']=command
    (E/'active-run.json').write_text(json.dumps(record,indent=2)+'\n')
    stdout=E/f'parity-{size}-{arm}-{mode}.stdout.log';start=time.monotonic()
    with stdout.open('x') as f:run=subprocess.run(command,stdout=f,stderr=subprocess.STDOUT)
    record.update(exit_code=run.returncode,elapsed_seconds=time.monotonic()-start,stdout_sha256=digest(stdout))
    if (output/'scope-health.json').exists():record['health']=json.loads((output/'scope-health.json').read_text())
    if run.returncode:
     (E/'run-failure.json').write_text(json.dumps(record,indent=2)+'\n');raise RuntimeError('Engine failed; stopped')
    log=stdout.read_text()
   record['final_files']={p.name:digest(p) for p in output.glob('final_*.csv')}
   if mode=='disabled':reference=output
   else:
    record['actual_chunking']=chunk_evidence(log)
    try:record['comparison']=compare_choices(reference,output)
    except ParityFailure as exc:
     failure={'status':'failed_choice_parity','households':size,'arm':arm,'mode':mode,'records':exc.records,'run':record,'full_runs_authorized':False}
     (E/'parity-result.json').write_text(json.dumps(failure,indent=2)+'\n');print(json.dumps(failure),flush=True);sys.exit(2)
   if mode=='training':training=output
   records.append(record);(E/'parity-runs.json').write_text(json.dumps(records,indent=2)+'\n')
   print(json.dumps({k:record[k] for k in ('households','arm','mode','output')}),flush=True)
(E/'parity-result.json').write_text(json.dumps({'status':'passed_choice_parity','full_runs_authorized':True,'runs':records},indent=2)+'\n')
