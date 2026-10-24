"""Check exact installed logsum values and RNG after allocator reclamation."""
import ctypes,gc,hashlib,json,sys,tempfile
from pathlib import Path
import numpy as np
import pandas as pd
import activitysim.abm
from activitysim.core import workflow,los
from activitysim.core.configuration.logit import TourLocationComponentSettings
from activitysim.abm.models import location_choice
sys.path.insert(0,'scripts/modeling')
from activitysim_allocator_reclaim import reclaim_before
trim=ctypes.CDLL(None).malloc_trim
trim.argtypes=[ctypes.c_size_t];trim.restype=ctypes.c_int
def reclaim():gc.collect();trim(0)
ROOT=Path('data/_screening_cache/tbi2019-integration').resolve();EVIDENCE=Path(__file__).resolve().parent
STOCK=Path('/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs')
land=pd.read_csv(ROOT/'bundle/land_use.csv');land['_original_zone_id']=land.zone_id;land['zone_id']=range(len(land));land=land.set_index('zone_id')
people=pd.DataFrame({'home_zone_id':[0,1,2,3,4,5], 'hhsize':[2,3,1,4,2,3], 'density_index':[1.,2.,3.,4.,5.,6.],
 'age':[16,35,25,18,70,12],'age_16_p':[True,True,True,True,True,False], 'age_16_to_19':[True,False,False,True,False,False],
 'auto_ownership':[0,1,2,3,1,1],'num_workers':[0,1,1,2,0,1],'value_of_time':[6.,12.,15.,20.,9.,5.],
 'free_parking_at_work':[False,True,False,True,False,False]},index=pd.Index([11,22,33,44,55,66],name='person_id'))
sample=pd.DataFrame({'alt_dest':np.tile([1,2,3,4,5,6,7],6),'pick_count':1,'prob':1/7},index=people.index.repeat(7))
records=[]
with tempfile.TemporaryDirectory(prefix='openplan-logsum-parity-') as tmp:
 tmp=Path(tmp);overlay=tmp/'overlay';overlay.mkdir()
 (overlay/'settings.yaml').write_text('inherit_settings: True\nmultiprocess: False\nsharrow: False\nchunk_size: 100000000\nchunk_training_mode: adaptive\ndefault_initial_rows_per_chunk: 10\n')
 (overlay/'network_los.yaml').write_text('inherit_settings: True\nskim_dict_factory: MemMapSkimFactory\n')
 def evaluate(arm,model,segment,bound):
  out=tmp/f'{arm}-{model}-{segment}-{bound}';out.mkdir()
  configs=[overlay]
  if arm=='semcog':configs.append(ROOT/'verified-candidate-overlay')
  configs.extend([ROOT/'bundle/configs',STOCK])
  state=workflow.State.make_default(tmp,configs_dir=tuple(configs),data_dir=(ROOT/'bundle',),output_dir=out,cache_dir=tmp/'cache')
  state.settings.offset_preprocessing=True
  state.add_table('land_use',land.copy());state.add_table('persons',people.copy())
  state.run.by_name('initialize_landuse')
  rng=state.get_rn_generator();rng.add_channel('persons',people);rng.begin_step(model)
  network=state.get_injectable('network_los')
  settings=TourLocationComponentSettings.read_settings_file(state.filesystem,model+'.yaml')
  function=location_choice.run_location_logsums if bound is None else reclaim_before(location_choice.run_location_logsums,reclaim)
  result=function(state,segment,people.copy(),network,sample.copy(),settings,100000000,'native-parity',model+'.native-parity')
  next_draw=rng.random_for_df(people,n=3)
  state.close_open_files()
  return result,next_draw
 for arm in ['current','semcog']:
  for model,segment in [('school_location','highschool'),('school_location','university'),('workplace_location','work')]:
   baseline,base_rng=evaluate(arm,model,segment,None)
   for bound in [1]:
    actual,actual_rng=evaluate(arm,model,segment,bound)
    pd.testing.assert_frame_equal(actual,baseline,check_exact=True)
    np.testing.assert_array_equal(actual_rng,base_rng)
    records.append({'arm':arm,'model':model,'allocator_reclamation':True,'rows':len(sample),'logsums_exact':True,'next_rng_draws_exact':True})
record={'comparisons':records,'fixture':'six synthetic persons, seven alternatives each; actual retained LOS and installed stock specs',
 'outcomes_accessed':False,'blind_category':'bounded contexts tested only; no whole-engine or scientific acceptance',
 'installed_location_choice_sha256':hashlib.sha256(Path(location_choice.__file__).read_bytes()).hexdigest(),
 'wrapper_sha256':hashlib.sha256(Path('scripts/modeling/activitysim_allocator_reclaim.py').read_bytes()).hexdigest()}
(EVIDENCE/'allocator-native-parity.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
