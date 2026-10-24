"""Real 2019 bulk inputs through the existing synthesizer. No TBI access."""
import csv,sys,json,hashlib,platform,datetime
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
import census_pums as cp
import census_bulk_inputs as bulk
import common_population as common
import synthetic_population as synthesis
ROOT=Path('data/_screening_cache/tbi2019-integration')
EVIDENCE=Path('docs/modeling/activitysim-tbi2019-2026-10-23/integration-evidence')
ZONE_PATH=Path('docs/modeling/activitysim-transit-2026-10-23/zones.csv')
zones=list(csv.DictReader(ZONE_PATH.open()))
profile=common.census_source_profile('https://api.census.gov/data/2019/acs/acs5','https://api.census.gov/data/2019/acs/acs5/pums')
manifest=[]
for path in sorted(EVIDENCE.glob('source-manifest.*.json')):
 for item in json.loads(path.read_text()):
  if 'sha256' in item:
   actual=hashlib.sha256(Path(item['path']).read_bytes()).hexdigest()
   if actual!=item['sha256']:raise ValueError('Source hash changed: '+item['name'])
  manifest.append(item)
controls=cp.controls_for_geography('tract')[0]
variables=sorted(set(cp.acs_variables_for(controls)+[cp.ENROLLMENT_HIGH_SCHOOL_CELL,*cp.ENROLLMENT_COLLEGE_CELLS,'B01003_001E','B11001_001E','B23025_004E','B19013_001E']))
archives={p.name.split('-')[-1].split('.')[0]:p for p in ROOT.glob('acs-sequence-*.response')}
raw=bulk.read_sequence_controls(ROOT/'acs-geography.response',ROOT/'acs-lookup.response',archives,{z['GEOID'] for z in zones},variables)
(ROOT/'acs-controls.json').write_text(json.dumps(raw,sort_keys=True,indent=2)+'\n')
args={'acs5_url':profile['acs_summary_endpoint'],'pums_url':profile['pums_endpoint']}
# Retain the exact public TIGER response before using the existing resolver.
original_get=cp._get_json
def retained_get(url,params,label):
 import requests
 response=requests.get(url,params=params,timeout=60);response.raise_for_status()
 path=ROOT/'puma-response.corrected.json';path.write_bytes(response.content)
 manifest.append({'name':'puma-response','url':response.url,'path':str(path),'bytes':len(response.content),'sha256':hashlib.sha256(response.content).hexdigest(),'http_status':response.status_code,'retrieved_at':datetime.datetime.now(datetime.timezone.utc).isoformat()})
 return response.json()
cp._get_json=retained_get
try:pumas=cp.resolve_pumas(synthesis.zones_bbox(synthesis.internal_zones(zones)),**args)
finally:cp._get_json=original_get
people,summary=bulk.read_pums([ROOT/'pums-household.response',ROOT/'pums-h-wi.response'],[ROOT/'pums-person.response',ROOT/'pums-p-wi.response'],pumas,profile)
print('BULK_INPUTS',json.dumps({'zones':len(zones),'pumas':len(pumas),**summary}),flush=True)
# Use the existing enrollment decoder on retained source cells; it makes no HTTP call.
def enrollment(geoids,key,**kwargs):
 old=cp._fetch_acs_rows
 cp._fetch_acs_rows=lambda geoids,variables,key,**kw:{g:{v:raw[g][v] for v in variables} for g in geoids}
 try:return cp.fetch_acs_school_enrollment(geoids,key,**kwargs)
 finally:cp._fetch_acs_rows=old
source_path=ROOT/'population-source-manifest.json';source_path.write_text(json.dumps(manifest,indent=2)+'\n')
(EVIDENCE/'population-input-summary.json').write_text(json.dumps({'profile':profile,'python':platform.python_version(),'zones':len(zones),'pumas':pumas,'bulk':summary,'source_manifest_sha256':hashlib.sha256(source_path.read_bytes()).hexdigest(),'control_file_sha256':hashlib.sha256((ROOT/'acs-controls.json').read_bytes()).hexdigest()},indent=2)+'\n')
result=synthesis.synthesize_study_area(zones,census_api_key='',source_profile=profile,include_school_enrollment=True,
 resolve_pumas=lambda *a,**kw:pumas,fetch_pums_person_rows=lambda *a,**kw:(people,summary),
 fetch_acs_zone_controls=lambda *a,**kw:raw,fetch_acs_school_enrollment=enrollment)
print('FIT_COMPLETE',json.dumps(result['summary']),flush=True)
descriptor=common.retain_population(ROOT/'common_population',zones,result,source_manifest_path=source_path,zone_attributes_path=ZONE_PATH,source_profile=profile)
report={'summary':result['summary'],'fit_quality':result['fit_quality'],'fit_grading_note':result['fit_grading_note'],'manifest':descriptor,'python':platform.python_version()}
(EVIDENCE/'population-result.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
