"""Reuse verified unchanged skims and rebuild population-dependent MTC members."""
import gc,json,sys
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
import build_activitysim_input_bundle as builder,common_population as common,activitysim_mtc_inputs as mtc
from retained_skim_expansion import copy_expansion
from activitysim_geographic_subset import subset_bundle,descriptor
SOURCE=Path('/home/nathaniel/.t3/worktrees/openplan/t3-11910f11/data/_screening_cache/tbi2019-integration')
OUT=Path('data/_screening_cache/tbi2019-convergence');E=Path(__file__).resolve().parent
report=json.loads((E/'population-rebuild.json').read_text())
if report['fit_quality']['zones_not_converged']!=4 or report['fit_quality']['zones_outside_published_margin']!=0:
 raise RuntimeError('Population audit differs from declared four failed fits')
if report['realized_outside_margin']:
 raise RuntimeError('Realized population lies outside published margins; repair integerization first')
original=mtc.expand_skims
mtc.expand_skims=lambda **kwargs:copy_expansion(SOURCE/'expanded-skims',**kwargs)
try:
 result=builder.build_activitysim_input_bundle(screening_run_dir=str(SOURCE/'screening-inputs'),output_dir=str(OUT/'bundle-all704'),
  population_source='census',config_package='mtc',retained_population={'directory':str(OUT/'common_population'),'manifest':report['manifest']},
  stock_configs_dir='/home/nathaniel/code/openplan/workers/activitysim_worker/.venv-exec/lib/python3.11/site-packages/activitysim/examples/prototype_mtc/configs',
  transit_config=json.loads((E.parent/'integration-evidence/transit-config.json').read_text()))
finally:mtc.expand_skims=original
(E/'bundle-all704-result.json').write_text(json.dumps(result,indent=2)+'\n');del result;gc.collect()
coverage=json.loads((E.parent/'integration-evidence/coverage.json').read_text())
excluded=[row['zone_id'] for row in coverage['zone_exclusions']]+[row['zone_id'] for row in report['exclusions']]
result=subset_bundle(OUT/'bundle-all704',OUT/'bundle',excluded,
 reason='mvta_service_missing_or_population_fit_failed',
 source={'mvta_coverage':descriptor(E.parent/'integration-evidence/coverage.json'),
         'population_fit':descriptor(E/'population-rebuild.json'),
         'population_failed_zone_ids':[row['zone_id'] for row in report['exclusions']]})
(E/'bundle-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
