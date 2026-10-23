"""Build the requested stock MTC package from retained public inputs only."""
import csv,json,sys,shutil,hashlib
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
import build_activitysim_input_bundle as builder
import common_population as common
ROOT=Path('data/_screening_cache/tbi2019-integration')
EVIDENCE=Path(__file__).resolve().parent
source=ROOT/'screening-inputs';source.mkdir(exist_ok=False)
(source/'package').mkdir();(source/'run_output').mkdir();(source/'work').mkdir()
shutil.copy2(ROOT/'zone_attributes.with-employment.csv',source/'package/zone_attributes.csv')
shutil.copy2(ROOT/'highway-get/run_output/travel_time_skims.omx',source/'run_output/travel_time_skims.omx')
shutil.copy2(ROOT/'highway-get/work/network_setup_summary.json',source/'work/network_setup_summary.json')
manifest={'run_name':'tbi2019-input-preparation','screening_grade':True,
 'status':'input_only_no_demand_or_assignment','demand':{'status':'not_run'},
 'zones':{'internal':704,'source':'TIGER2019'},
 'skims':json.loads((ROOT/'highway-get/skim-summary.json').read_text())}
# Existing builder expects this input-manifest path; it is not a completed assignment receipt.
manifest_path=source/builder.SOURCE_MANIFEST_RELATIVE_PATH
manifest_path.parent.mkdir(parents=True,exist_ok=True);manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
pop=ROOT/'common_population'
expected=common.file_descriptor(pop/common.MANIFEST_NAME)
result=builder.build_activitysim_input_bundle(screening_run_dir=str(source),output_dir=str(ROOT/'bundle'),
 population_source='census',config_package='mtc',retained_population={'directory':str(pop),'manifest':expected},
 stock_configs_dir='/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs',
 transit_config=json.loads((EVIDENCE/'transit-config.json').read_text()))
(EVIDENCE/'bundle-result.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result),flush=True)
