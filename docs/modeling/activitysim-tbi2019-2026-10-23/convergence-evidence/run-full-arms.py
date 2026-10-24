"""Run full modeled-only arms after the exact built-in chunking parity gate."""
import collections,csv,json,shutil,subprocess,sys,time
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
from activitysim_chunk_parity import digest
import activitysim_walk_transfer as transfer
ROOT=Path('data/_screening_cache/tbi2019-convergence').resolve();E=Path(__file__).resolve().parent
parity=json.loads((E/'parity-result.json').read_text())
if parity['status']!='passed_exact_value_parity' or not parity['full_runs_authorized_by_parity']:
 raise RuntimeError('Exact chunking parity has not passed; full runs refused')
stock=Path('/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs')
records=[]
for arm in ['current','semcog']:
 coefficients=ROOT/('full-coefficients-'+arm)
 if arm=='semcog':
  built=transfer.build_overlay(stock,coefficients,transfer.NAME)
  transfer.check_frozen_candidate(built,json.loads((transfer.PACKAGE/'overlay/coefficient-set.json').read_text()),coefficients/'tour_mode_choice_coefficients.csv')
 else:coefficients.mkdir()
 for mode in ['training','production']:
  output=ROOT/('full-'+arm+'-'+mode);output.mkdir(exist_ok=False)
  cache_sha=None
  if mode=='production':
   cache=ROOT/('full-'+arm+'-training')/'cache/chunk_cache.csv'
   if not cache.is_file():raise RuntimeError('Full training cache missing; no production fallback permitted')
   (output/'cache').mkdir();shutil.copyfile(cache,output/'cache/chunk_cache.csv');cache_sha=digest(cache)
  configs=[ROOT/('runtime-configs-'+mode),coefficients,ROOT/'bundle/configs',stock]
  command=['systemd-run','--user','--scope','--unit=tbi2019-full-'+arm+'-'+mode+'-20261024',
           '-p','MemoryMax=9G','-p','MemorySwapMax=0','env','OPENBLAS_NUM_THREADS=1','OMP_NUM_THREADS=1',
           '/usr/bin/time','-v',sys.executable,'-B',str(E/'scope-runner.py'),str(output/'scope-health.json'),
           sys.executable,'-B','-m','activitysim','run']
  for config in configs:command+=['-c',str(config)]
  command+=['-d',str(ROOT/'bundle'),'-o',str(output)]
  record={'arm':arm,'mode':mode,'claim':'MODELED ONLY; no survey input or comparison',
          'command':command,'parity_receipt_sha256':digest(E/'parity-result.json'),
          'input_archive_sha256':json.loads((E/'archive-custody.json').read_text())['sha256'],
          'bundle_manifest_sha256':digest(ROOT/'bundle/manifest.json'),'chunk_cache_input_sha256':cache_sha,
          'coefficient_sha256':digest((coefficients if arm=='semcog' else stock)/'tour_mode_choice_coefficients.csv'),
          'tour_count':None,'mode_counts_MODELED':None,'mode_shares_MODELED':None}
  (E/('full-'+arm+'-'+mode+'.started.json')).write_text(json.dumps(record,indent=2)+'\n')
  start=time.monotonic()
  with stdout.open('x') as log:run=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT)
  record.update(exit_code=run.returncode,elapsed_seconds=time.monotonic()-start,stdout_sha256=digest(stdout),completion='completed' if run.returncode==0 else 'failed')
  if (output/'scope-health.json').exists():record['health']=json.loads((output/'scope-health.json').read_text())
  if run.returncode==0:
   if mode=='production' and 'chunk_training_mode falling back to' in stdout.read_text():raise RuntimeError('Unexpected production fallback')
   counts=collections.Counter()
   with (output/'final_tours.csv').open() as f:
    for row in csv.DictReader(f):counts[row['tour_mode']]+=1
   total=sum(counts.values());record.update(tour_count=total,mode_counts_MODELED=dict(sorted(counts.items())),mode_shares_MODELED={k:v/total for k,v in sorted(counts.items())} if total else {})
   record['final_files']={p.name:{'sha256':digest(p),'bytes':p.stat().st_size} for p in output.glob('final_*.csv')}
  records.append(record);(E/'full-runs.json').write_text(json.dumps(records,indent=2)+'\n');print(json.dumps(record),flush=True)
  if run.returncode!=0:break
