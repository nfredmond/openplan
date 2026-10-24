"""Bounded source mutations on this owned checkout; exact restoration in finally."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
OUT = Path(__file__).parent
PYTHON = sys.executable
TOURS = ROOT/'scripts/modeling/tbi2019_tours.py'
CATALOG = ROOT/'scripts/modeling/population_source_profiles.v1.json'
MTC = ROOT/'scripts/modeling/activitysim_mtc_inputs.py'
SQL = ROOT/'openplan/supabase/migrations/20261023224145_population_profile_2019.sql'
TS = ROOT/'openplan/src/lib/geographies/population-source-registry.ts'
originals = {p:p.read_bytes() for p in (TOURS,CATALOG,MTC,SQL,TS)}
results = []


def run(name, path, mutate, suite, should_pass=False):
    before = originals[path]
    try:
        changed = mutate(before.decode())
        assert changed != before.decode(), name+' did not change source'
        path.write_text(changed)
        if suite == 'ts':
            cmd = ['npm','exec','--','vitest','run','src/test/population-source-registry.test.ts',
                   'src/test/model-common-population-profiles-migration.test.ts','--pool=forks','--maxWorkers=2']
            cwd = ROOT/'openplan'
        else:
            cmd = [PYTHON,'-B','-m','unittest','discover','-s','scripts/modeling/tests','-p',suite,'-v']
            cwd = ROOT
        done = subprocess.run(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        text = done.stdout
        (OUT/(name+'.log')).write_text(text)
        if should_pass:
            assert done.returncode == 0, name+' harmless mutation failed'
        elif suite == 'ts':
            assert done.returncode != 0 and 'AssertionError' in text and 'Failed Suites' not in text, name+' did not fail an assertion'
        else:
            assert done.returncode != 0 and 'FAIL:' in text and 'ERROR:' not in text, name+' did not fail an assertion'
        results.append(dict(name=name, file=str(path.relative_to(ROOT)), exit_code=done.returncode,
            expected='survive' if should_pass else 'assertion_failure', output_sha256=hashlib.sha256(text.encode()).hexdigest()))
    finally:
        path.write_bytes(before)
        assert path.read_bytes() == before


def replace(old, new):
    def mutation(text):
        assert text.count(old)==1, (old,text.count(old))
        return text.replace(old,new)
    return mutation


try:
    run('tour-harmless',TOURS,lambda s:'# Harmless source comment.\n'+s,'test_tbi2019_tours.py',True)
    run('catalog-harmless',CATALOG,lambda s:json.dumps(json.loads(s),sort_keys=True,indent=4)+'\n','test_population_2019.py',True)
    run('mtc-harmless',MTC,lambda s:'# Harmless source comment.\n'+s,'test_population_2019.py',True)
    run('sql-harmless',SQL,lambda s:'-- Harmless source comment.\n'+s,'ts',True)
    mutations = [
        ('tour-weight', 'return float(diary.day_weight)', 'return float(diary.person_weight)'),
        ('nonpositive-weight', 'and value > 0', 'and value >= 0'),
        ('primary-priority', "PURPOSE_PRIORITY = {'work': 0, 'university': 1, 'school': 2}", 'PURPOSE_PRIORITY = {}'),
        ('primary-duration', 'PURPOSE_PRIORITY.get(activity, 3), -duration', 'PURPOSE_PRIORITY.get(activity, 3), duration'),
        ('primary-arrival', 'trip.arrive, trip.id, trip.destination, activity', '-trip.arrive.timestamp(), trip.id, trip.destination, activity'),
        ('university-evidence', "if entry == 'university' and school_type not in", "if False and entry == 'university' and school_type not in"),
        ('unknown-mode', "return None, 'unknown_mode'", "return 'walk', None"),
        ('unsupported-mode', "return None, 'unsupported_mode'", "return 'auto', None"),
        ('auto-evidence', "if family == 'auto' and", "if False and family == 'auto' and"),
        ('transit-evidence', "if family == 'transit' and", "if False and family == 'transit' and"),
        ('incomplete-diary', 'if diary.complete is not True:', 'if False:'),
        ('unknown-diary', "return 'diary_completeness_unverified'", "return 'incomplete_diary'"),
        ('proxy', 'if diary.proxy is not False:', 'if False:'),
        ('overnight', "return 'overnight'", "return 'missing_time'"),
        ('time-order', "if trip.arrive < trip.depart:", "if False:"),
        ('region', 'if trip.in_region is not True:', 'if False:'),
        ('region-unknown', "return 'geography_unverified'", "return 'out_of_region'"),
        ('quality', 'if trip.trace_ok is not True:', 'if False:'),
        ('derived', 'if trip.derived_child is not False:', 'if False:'),
        ('joint', 'if any(t.joint for t in chain):', 'if False:'),
        ('continuity', 'previous.destination != current.origin or previous.destination_purpose != current.origin_purpose', 'False'),
        ('duplicate-trip', 'any(ids[t.id] != 1 for t in rows)', 'False'),
        ('home-return', 'or c[0].origin != c[-1].destination', 'or False'),
        ('mixed-family', 'if len(family_set) != 1:', 'if False:'),
        ('atwork-identity', 'trip.destination == workplace and', 'True and'),
        ('decoder-location', "location_evidence.get(identity, (None, None))", "location_evidence.get(identity, (str(row.get('trip_o_taz')), str(row.get('trip_d_taz'))))"),
        ('decoder-quality', "quality.get('trace_ok'), row.get('linked_trip_weight')", "quality.get('trace_ok', True), row.get('linked_trip_weight')"),
        ('decoder-dst', 'if early.utcoffset() != late.utcoffset():', 'if False:'),
    ]
    for name,old,new in mutations:
        run(name,TOURS,replace(old,new),'test_tbi2019_tours.py')
    for name,change in [
        ('profile-window', lambda e:e['profile'].update(sample_years=[2019,2019])),
        ('profile-puma', lambda e:e['profile'].update(puma_fields={'2020':'PUMA'})),
        ('profile-guided', lambda e:e['capabilities'].update(new_guided_launch='supported')),
    ]:
        def mutation(s, change=change):
            d=json.loads(s);change(d['profiles'][-1]);return json.dumps(d,indent=2)+'\n'
        run(name,CATALOG,mutation,'test_population_2019.py')
    run('income-deflator',MTC,replace('CPI_U_ANNUAL_2019 = 255.657','CPI_U_ANNUAL_2019 = 292.655'),'test_population_2019.py')
    run('sql-permission',SQL,lambda s:s+'\nGRANT EXECUTE ON FUNCTION public.model_common_population_profile_allowed(jsonb,text) TO authenticated;\n','ts')
    run('sql-profile',SQL,replace('"sample_years":[2015,2019]','"sample_years":[2016,2019]'),'ts')
    run('ts-membership',TS,replace('return matches.length === 1 && capability(matches[0], purpose).status === "supported";', 'return matches.length === 1;'),'ts')
finally:
    for path,data in originals.items():
        assert path.read_bytes()==data, str(path)+' restoration failed'
    (OUT/'mutations.json').write_text(json.dumps({'results':results,'restored_sha256':{
        str(p.relative_to(ROOT)):hashlib.sha256(b).hexdigest() for p,b in originals.items()}},indent=2)+'\n')
print(f'{len(results)} mutation controls completed; exact source restoration.')
