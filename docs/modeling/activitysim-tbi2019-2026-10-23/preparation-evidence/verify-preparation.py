"""Inspect permitted roster fields and metadata; never acquire travel outcomes."""
import hashlib
import json
from pathlib import Path
import sys
from collections import Counter

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / 'scripts/modeling'))
import tbi2019_development_split as split
import census_pums as cp
import activitysim_mtc_inputs as mtc

OUT = Path(__file__).parent
SOURCE = Path('/home/nathaniel/.local/state/openplan/tbi2019-development-20261023/roster')
PREP = Path('/home/nathaniel/.local/state/openplan/tbi2019-preparation-20261023/sources')


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


# This is the original outcome-free projection, not a new split or opening.
manifest = json.loads((SOURCE / 'source-manifest.json').read_bytes())
rows = []
for entry in manifest:
    if not entry['file'].startswith('roster-'):
        continue
    data = (SOURCE / entry['file']).read_bytes()
    assert sha(data) == entry['sha256']
    page = json.loads(data)['features']
    for feature in page:
        assert set(feature['attributes']) == split.ROSTER_FIELDS
        rows.append(feature['attributes'])
assigned = split.partition(rows, split.load_spec())
assert sha(split.canonical(assigned)) == 'd00206802218a92d31dceea4c108c74cab540dadd8c90d9d1f21e8b11b99c392'
development = [r for r in assigned if r['partition'] == 'development']
write('development-roster.json', {
    'scope': 'Original frozen roster fields only; no weights, trips, times, purposes or modes',
    'assignment_sha256': sha(split.canonical(assigned)),
    'development_households': len(development),
    'study_region_households': sum(r['in_study_region'] for r in development),
    'excluded_development_households_by_reason': {
        'outside_frozen_study_region': sum(not r['in_study_region'] for r in development),
        'missing_county': sum(r['county'] == '__missing__' for r in development)},
    'county_counts': dict(Counter(r['county'] for r in development)),
    'respondent_outcome_rows_requested': 0, 'respondent_outcome_rows_read': 0,
    'held_out_outcome_rows_requested': 0, 'held_out_outcome_rows_read': 0,
    'real_trip_and_tour_exclusion_counts': None,
    'unavailability_reason': 'Frozen admission protocol does not permit outcome fields in this preparation lane',
})
summary = 'https://api.census.gov/data/2019/acs/acs5'
v = json.loads((PREP/'census-pums-variables.json').read_text())['variables']
a = json.loads((PREP/'census-acs-variables.json').read_text())['variables']
# The summary index exposes estimates; group metadata also exposes margins.
for table in ('B11016','B19001','B25044','B08202','B01001'):
    a.update(json.loads((PREP/(table+'.json')).read_text())['variables'])
required = sorted(set(cp.acs_variables_for([cp.SIZE_CONTROL, cp.INCOME_CONTROL, cp.VEHICLES_CONTROL,
    cp.WORKERS_CONTROL, cp.AGE_CONTROL]) + [cp.ENROLLMENT_HIGH_SCHOOL_CELL, *cp.ENROLLMENT_COLLEGE_CELLS]))
assert all(k in a for k in required)
assert all(k in v for k in [*cp.PUMS_HOUSEHOLD_VARIABLES, *cp.PUMS_PERSON_VARIABLES, 'PUMA'])
assert '2010 Census' in v['PUMA']['label']
assert v['ADJINC']['values']['item']['1080470'].startswith('2015 factor')
profile = cp.census_vintage_profile(summary, summary+'/pums')
assert (profile.first_year, profile.final_year, profile.puma_fields) == (2015,2019,(('2010','PUMA'),))
assert mtc.check_income_vintage(summary, summary+'/pums') == 2019
write('population-source-audit.json', {
    'acs_variables_sha256': sha((PREP/'census-acs-variables.json').read_bytes()),
    'pums_variables_sha256': sha((PREP/'census-pums-variables.json').read_bytes()),
    'group_metadata_sha256': {table:sha((PREP/(table+'.json')).read_bytes()) for table in ('B11016','B19001','B25044','B08202','B01001')},
    'acs_required_variable_count': len(required),
    'acs_required_variables': {k:a[k]['label'] for k in required},
    'pums_required_variables': {k:v[k] for k in [*cp.PUMS_HOUSEHOLD_VARIABLES, *cp.PUMS_PERSON_VARIABLES,'PUMA']},
    'sample_years': [profile.first_year, profile.final_year], 'puma_fields': dict(profile.puma_fields),
    'income_source_dollar_year': 2019, 'mtc_income_dollar_year': 2000,
    'mtc_income_deflator': 172.2/255.657,
    'live_population_fit': 'not executed; no secret or microdata requested',
})
print('Frozen assignment preserved; 2019 metadata and adapter checks pass.')
