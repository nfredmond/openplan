"""Execute one complete model arm without survey input or comparison code."""
import argparse,csv,collections,datetime,hashlib,json,os,platform,subprocess,sys
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
import activitysim_walk_transfer as transfer
import activitysim_mtc_inputs as mtc
ROOT=Path('data/_screening_cache/tbi2019-integration').resolve()
EVIDENCE=Path(__file__).resolve().parent
p=argparse.ArgumentParser();p.add_argument('arm',choices=['current','semcog']);a=p.parse_args()
bundle=ROOT/'bundle';stock=mtc.resolve_stock_prototype_mtc('/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs')['configs_dir']
arm=ROOT/('modeled-'+a.arm);arm.mkdir(exist_ok=False)
overlay=arm/'configs'
if a.arm=='semcog':
 result=transfer.build_overlay(stock,overlay,transfer.NAME)
 frozen=json.loads((transfer.PACKAGE/'overlay/coefficient-set.json').read_text())
 transfer.check_frozen_candidate(result,frozen,overlay/'tour_mode_choice_coefficients.csv')
else:overlay.mkdir()
# Runtime-only memory policy, identical in both arms, all 638-zone households retained.
(overlay/'settings.yaml').write_text('inherit_settings: True\nchunk_size: 4500000000\nchunk_training_mode: adaptive\ndefault_initial_rows_per_chunk: 100\nhouseholds_sample_size: 0\nmultiprocess: False\n')
(overlay/'network_los.yaml').write_text('inherit_settings: True\nskim_dict_factory: MemMapSkimFactory\n')
output=arm/'output';output.mkdir()
command=[sys.executable,'-B',str(EVIDENCE/'activitysim-memory-runner.py'),'run','-c',str(overlay),'-c',str(bundle/'configs'),'-c',str(stock),'-d',str(bundle),'-o',str(output)]
record={'arm':a.arm,'claim':'MODELED ONLY; no TBI outcomes or scientific acceptance',
 'python':platform.python_version(),'command':command,'started_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'memory_policy':{'MemoryMax':'6G','MemorySwapMax':0,'chunk_size':4500000000,'chunk_training_mode':'adaptive','initial_rows':100},
 'stock_sha256':mtc.stock_configs_digest(stock),'bundle_manifest_sha256':transfer.digest(bundle/'manifest.json'),
 'runtime_settings_sha256':transfer.digest(overlay/'settings.yaml'),
 'network_runtime_sha256':transfer.digest(overlay/'network_los.yaml'),'skim_factory':'MemMapSkimFactory',
 'allocator_runner_sha256':transfer.digest(EVIDENCE/'activitysim-memory-runner.py'),
 'allocator_helper_sha256':transfer.digest(Path('scripts/modeling/activitysim_allocator_reclaim.py')),
 'coefficient_sha256':transfer.digest((overlay if a.arm=='semcog' else stock)/'tour_mode_choice_coefficients.csv')}
(EVIDENCE/('modeled-'+a.arm+'.started.json')).write_text(json.dumps(record,indent=2)+'\n')
with (arm/'stdout.log').open('x') as log:
 run=subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,env={**os.environ,'OPENBLAS_NUM_THREADS':'1','OMP_NUM_THREADS':'2'})
record.update(exit_code=run.returncode,finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat(),stdout_sha256=transfer.digest(arm/'stdout.log'))
record['completion']='completed' if run.returncode==0 else 'failed'
record['tour_count']=None;record['mode_counts_MODELED']=None;record['mode_shares_MODELED']=None
if run.returncode==0:
 counts=collections.Counter()
 with (output/'final_tours.csv').open() as handle:
  for row in csv.DictReader(handle):counts[row['tour_mode']]+=1
 total=sum(counts.values());record['tour_count']=total
 record['mode_counts_MODELED']=dict(sorted(counts.items()))
 record['mode_shares_MODELED']={k:v/total for k,v in sorted(counts.items())} if total else {}
 record['output_files']={p.name:{'sha256':transfer.digest(p),'bytes':p.stat().st_size} for p in output.glob('final_*.csv')}
(EVIDENCE/('modeled-'+a.arm+'.json')).write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record),flush=True)
sys.exit(run.returncode)
