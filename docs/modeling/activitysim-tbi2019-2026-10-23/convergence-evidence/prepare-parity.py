"""Freeze 64 whole synthetic households and identical model-output settings."""
import csv,heapq,json,shutil,sys,platform,importlib.metadata
from pathlib import Path
import yaml
sys.path.insert(0,'scripts/modeling')
from activitysim_chunk_parity import digest
import activitysim_walk_transfer as transfer
ROOT=Path('data/_screening_cache/tbi2019-convergence').resolve();E=Path(__file__).resolve().parent
bundle=ROOT/'bundle';subset=ROOT/'parity-inputs';subset.mkdir(exist_ok=False)
# Hash order fixes membership without consulting any modeled or survey outcome.
import hashlib
with (bundle/'households.csv').open() as f:
 chosen=heapq.nsmallest(64,csv.DictReader(f),key=lambda r:hashlib.sha256(('tbi2019-chunk-parity-v1:'+r['household_id']).encode()).digest())
ids={r['household_id'] for r in chosen};counts={}
for table,field in [('households','household_id'),('persons','household_id')]:
 with (bundle/(table+'.csv')).open() as inp,(subset/(table+'.csv')).open('x') as out:
  reader=csv.DictReader(inp);writer=csv.DictWriter(out,reader.fieldnames);writer.writeheader();n=0
  for row in reader:
   if row[field] in ids:writer.writerow(row);n+=1
  counts[table]=n
shutil.copyfile(bundle/'land_use.csv',subset/'land_use.csv')
# Copy the fixed full-domain matrices for portable archive reproduction.
shutil.copytree(bundle/'skims',subset/'skims')
stock=Path('/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs')
logging=yaml.safe_load((stock/'logging.yaml').read_text())
logging['logging']['loggers']['activitysim.core.chunk']={'level':'DEBUG','handlers':['console','logfile'],'propagate':False}
output=yaml.safe_load((bundle/'configs/settings.yaml').read_text())['output_tables']
output['tables']=[r for r in output['tables'] if r!='checkpoints']
base={'inherit_settings':True,'households_sample_size':0,'multiprocess':False,'rng_base_seed':0,
      'default_initial_rows_per_chunk':2,'output_tables':output}
for arm in ['current','semcog']:
 for mode in ['disabled','training','production']:
  config=ROOT/('parity-config-'+arm+'-'+mode)
  if arm=='semcog':
   built=transfer.build_overlay(stock,config,transfer.NAME)
   transfer.check_frozen_candidate(built,json.loads((transfer.PACKAGE/'overlay/coefficient-set.json').read_text()),config/'tour_mode_choice_coefficients.csv')
  else:config.mkdir()
  (config/'settings.yaml').write_text(yaml.safe_dump({**base,'chunk_size':0 if mode=='disabled' else 67108864,'chunk_training_mode':mode},sort_keys=False))
  (config/'logging.yaml').write_text(yaml.safe_dump(logging,sort_keys=False))
  (config/'network_los.yaml').write_text('inherit_settings: True\nskim_dict_factory: MemMapSkimFactory\n')
for mode in ['training','production']:
 config=ROOT/('runtime-configs-'+mode);config.mkdir()
 (config/'settings.yaml').write_text(yaml.safe_dump({**base,'default_initial_rows_per_chunk':100,'chunk_size':5500000000,'chunk_training_mode':mode},sort_keys=False))
 (config/'network_los.yaml').write_text('inherit_settings: True\nskim_dict_factory: MemMapSkimFactory\n')
import activitysim
package=Path(activitysim.__file__).parent
software={'python':platform.python_version(),'executable':sys.executable,'versions':{name:importlib.metadata.version(name) for name in ['activitysim','numpy','scipy','pandas','openmatrix']},'activitysim_sources':{str(p.relative_to(package)):digest(p) for p in sorted(package.rglob('*.py'))},'stock_configs_sha256':transfer.digest(stock/'settings.yaml')}
(E/'parity-environment.json').write_text(json.dumps(software,indent=2)+'\n')
record={'software_receipt_sha256':digest(E/'parity-environment.json'),'selection':'lowest 64 SHA256(tbi2019-chunk-parity-v1:household_id), complete households','household_ids':sorted(ids,key=int),'counts':counts,
        'seed':0,'input_files':{str(p.relative_to(subset)):{'sha256':digest(p),'bytes':p.stat().st_size} for p in subset.glob('*.csv')},
        'full_skims':{'sha256':digest(bundle/'skims/mtc_skims.omx'),'bytes':(bundle/'skims/mtc_skims.omx').stat().st_size},
        'bundle_manifest_sha256':digest(bundle/'manifest.json'),
        'configuration_files':{str(p.relative_to(ROOT)):digest(p) for p in ROOT.glob('parity-config-*/*') if p.is_file()},
        'output_scope':'All seven model final tables; operational checkpoint timestamps remain in pipeline metadata, not exported as model tables.',
        'survey_outcomes_accessed':False}
(E/'parity-input-freeze.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
