"""Rebuild from hash-verified retained public inputs with explicit entropy fitting."""
import csv,gc,hashlib,json,os,platform,sys,time
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
import census_pums as cp,census_bulk_inputs as bulk,common_population as common,synthetic_population as synthesis
SOURCE=Path('/home/nathaniel/.t3/worktrees/openplan/t3-11910f11/data/_screening_cache/tbi2019-integration')
OUT=Path('data/_screening_cache/tbi2019-convergence');E=Path(__file__).resolve().parent
OLD=E.parent/'integration-evidence';ZONE=Path('docs/modeling/activitysim-transit-2026-10-23/zones.csv')
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
prior=json.loads((OLD/'population-result.json').read_text());binding={}
for name,digest in prior['checkpoint']['binding']['files'].items():
 if name.startswith('data/_screening_cache/tbi2019-integration/'):
  p=SOURCE/Path(name).name
 elif name.startswith('docs/'):
  p=Path(name)
 else:continue
 if sha(p)!=digest:raise RuntimeError('Retained source hash differs: '+str(p))
 binding[str(p)]={'sha256':digest,'bytes':p.stat().st_size}
for name in ['population_entropy.py','population_synthesis.py','synthetic_population.py','common_population.py','census_pums.py','census_bulk_inputs.py']:
 p=Path('scripts/modeling')/name;binding[str(p)]={'sha256':sha(p),'bytes':p.stat().st_size}
meta=json.loads((OLD/'population-input-summary.json').read_text());profile=meta['profile'];pumas=meta['pumas'];zones=list(csv.DictReader(ZONE.open()))
raw=json.loads((SOURCE/'acs-controls.json').read_text())
people,summary=bulk.read_pums([SOURCE/'pums-household.response',SOURCE/'pums-h-wi.response'],[SOURCE/'pums-person.response',SOURCE/'pums-p-wi.response'],pumas,profile)
def enrollment(geoids,key,**kwargs):
 original=cp._fetch_acs_rows
 cp._fetch_acs_rows=lambda geoids,variables,key,**kw:{g:{v:raw[g][v] for v in variables} for g in geoids}
 try:return cp.fetch_acs_school_enrollment(geoids,key,**kwargs)
 finally:cp._fetch_acs_rows=original
start=time.monotonic()
settings={'fitting_method':'entropy','fitting_max_iterations':2000,'exclude_failed_fits':True}
(E/'population-rebuild.started.json').write_text(json.dumps({'binding':binding,'settings':settings,'python':platform.python_version()},indent=2)+'\n')
result=synthesis.synthesize_study_area(zones,census_api_key='',source_profile=profile,include_school_enrollment=True,
 resolve_pumas=lambda *a,**kw:pumas,fetch_pums_person_rows=lambda *a,**kw:(people,summary),
 fetch_acs_zone_controls=lambda *a,**kw:raw,fetch_acs_school_enrollment=enrollment,**settings)
del people;gc.collect()
result['source_controls']['fitting_settings']=settings
print('FITTED',json.dumps(result['summary']),json.dumps(result['fit_quality']),flush=True)
report={'summary':result['summary'],'fit_quality':result['fit_quality'],'exclusions':result['source_controls']['fit_exclusions'],'binding':binding,'settings':settings,'python':platform.python_version()}
# Preserve each unchanged published margin and distinguish fractional fits from integer realizations.
realized=[]
geoids={int(z['zone_id']):z['GEOID'] for z in zones};cs,_=cp.controls_for_geography('tract')
excluded={x['zone_id'] for x in report['exclusions']}
for fit in result['zone_fits']:
 if fit['zone_id'] in excluded:continue
 margins=cp.zone_margins_from_acs(raw[geoids[fit['zone_id']]],cs)
 for control,cats in fit['control_differences'].items():
  for category,diff in cats.items():
   margin=margins[control][category]
   if margin>0 and abs(diff['realized_minus_target'])>margin:
    realized.append({'zone_id':fit['zone_id'],'GEOID':geoids[fit['zone_id']],'control':control,'category':category,'margin':margin,**diff})
report['realized_outside_margin']=realized
(E/'population-rebuild.fit.json').write_text(json.dumps(report,indent=2)+'\n')
manifest=common.retain_population(OUT/'common_population',zones,result,source_manifest_path=SOURCE/'population-source-manifest.json',zone_attributes_path=ZONE,source_profile=profile)
report.update(manifest=manifest,elapsed_seconds=time.monotonic()-start)
(E/'population-rebuild.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
