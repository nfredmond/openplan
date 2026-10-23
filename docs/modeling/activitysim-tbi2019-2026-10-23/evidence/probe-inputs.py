"""Read actual adapter behavior without opening survey or model outcomes."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import sys

root = Path.cwd()
sys.path.insert(0, str(root / 'scripts/modeling'))
import census_pums
import activitysim_mtc_inputs as mtc

profiles = []
for year in (2019, 2022, 2023):
    summary = f'https://api.census.gov/data/{year}/acs/acs5'
    pums = summary + '/pums'
    try:
        profile = census_pums.census_vintage_profile(summary, pums)
        income = mtc.check_income_vintage(summary, pums)
        profiles.append(dict(year=year, status='supported', profile=vars(profile), income_year=income))
    except (census_pums.CensusPumsError, mtc.MtcInputError) as exc:
        profiles.append(dict(year=year, status='refused', exception=type(exc).__name__, message=str(exc)))
files = ['scripts/modeling/build_activitysim_input_bundle.py',
         'scripts/modeling/census_pums.py', 'scripts/modeling/population_source_profiles.v1.json',
         'scripts/modeling/synthetic_population.py', 'scripts/modeling/activitysim_mtc_inputs.py',
         'scripts/modeling/activitysim_walk_transfer.py',
         'data/modeling/activitysim-accepted-components.json',
         'data/modeling/activitysim-semcog-walk-development-v1/overlay/tour_mode_choice_coefficients.csv']
print(json.dumps(dict(
    python=sys.version,
    packages={n: importlib.metadata.version(n) for n in ('activitysim', 'numpy', 'pandas', 'openmatrix')},
    census_profile_probes=profiles,
    skim_classification={name: mtc.classify_skim_name(name) for name in
                         ('WLK_LOC_WLK_TOTIVT__AM', 'DRV_LOC_WLK_TOTIVT__PM', 'SOV_TIME__AM', 'SOV_TIME__PM')},
    source_sha256={f: hashlib.sha256((root / f).read_bytes()).hexdigest() for f in files},
    network_or_census_downloads=0,
    real_model_executions=0,
    survey_outcome_rows_read=0), indent=2))
