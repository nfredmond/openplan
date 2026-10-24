"""Run the existing skim adapter separately from population materialization."""
import sys,json,hashlib
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
import activitysim_mtc_inputs as mtc
import build_activitysim_input_bundle as builder
ROOT=Path('data/_screening_cache/tbi2019-integration')
EVIDENCE=Path(__file__).resolve().parent
out=ROOT/'expanded-skims';out.mkdir(exist_ok=False)
stock=mtc.resolve_stock_prototype_mtc('/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs')
raw=builder.load_zone_attributes(ROOT/'zone_attributes.with-employment.csv')
source=ROOT/'highway-get/run_output/travel_time_skims.omx'
centroids=mtc.read_centroid_map(ROOT/'highway-get/work/network_setup_summary.json')
config=json.loads((EVIDENCE/'transit-config.json').read_text())
record=mtc.expand_skims(source_omx=source,output_omx=out/'mtc_skims.omx',internal_zone_rows=raw,
 centroid_map=centroids,stock_configs_dir=stock['configs_dir'],stock_skims_omx=stock['stock_skims_omx'],transit_config=config)
inputs={'source_omx_sha256':builder.sha256_for_file(source),'zone_rows':raw,'centroid_map':centroids,
 'stock_configs_sha256':mtc.stock_configs_digest(stock['configs_dir']),
 'stock_skims_sha256':builder.sha256_for_file(stock['stock_skims_omx']),'transit_config':config,
 'implementations':{p:builder.sha256_for_file(Path(p)) for p in ['scripts/modeling/activitysim_mtc_inputs.py','scripts/modeling/activitysim_transit_skims.py']}}
result={'inputs':inputs,'accounting':record,'artifacts':{p.name:{'sha256':builder.sha256_for_file(p),'bytes':p.stat().st_size} for p in out.iterdir() if p.is_file()}}
(out/'record.json').write_text(json.dumps(result,indent=2)+'\n')
(EVIDENCE/'expanded-skims.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'status':'completed','artifacts':result['artifacts'],'matrices':record['matrices_written']}),flush=True)
