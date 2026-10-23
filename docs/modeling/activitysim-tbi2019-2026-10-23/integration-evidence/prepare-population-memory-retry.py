"""Repeat unchanged fitting with bounded retention and a hash-bound checkpoint."""
import csv,gc,hashlib,json,pickle,platform,sys
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
import census_pums as cp
import census_bulk_inputs as bulk
import common_population as common
import synthetic_population as synthesis
ROOT=Path('data/_screening_cache/tbi2019-integration');EVIDENCE=Path(__file__).resolve().parent
ZONE_PATH=Path('docs/modeling/activitysim-transit-2026-10-23/zones.csv')
def sha(path):
 h=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
 return h.hexdigest()
metadata=json.loads((EVIDENCE/'population-input-summary.json').read_text())
profile=metadata['profile'];pumas=metadata['pumas'];zones=list(csv.DictReader(ZONE_PATH.open()))
paths=[ROOT/n for n in ['acs-controls.json','pums-household.response','pums-person.response','pums-h-wi.response','pums-p-wi.response','population-source-manifest.json']]
paths += [ZONE_PATH,*[Path('scripts/modeling')/n for n in ['census_pums.py','synthetic_population.py','population_synthesis.py','census_bulk_inputs.py']]]
binding={'files':{str(p):sha(p) for p in paths},'profile':profile,'pumas':pumas}
checkpoint=ROOT/'population-fit.checkpoint.pkl';receipt=ROOT/'population-fit.checkpoint.json'
if receipt.exists():
 saved=json.loads(receipt.read_text())
 if saved['binding']!=binding or saved['sha256']!=sha(checkpoint):raise RuntimeError('Checkpoint custody differs')
 # Read only this process family's own hash-verified checkpoint, never a supplied pickle.
 with checkpoint.open('rb') as f:result=pickle.load(f)
 print('CHECKPOINT_REUSED',flush=True)
else:
 raw=json.loads((ROOT/'acs-controls.json').read_text())
 people,summary=bulk.read_pums([ROOT/'pums-household.response',ROOT/'pums-h-wi.response'],[ROOT/'pums-person.response',ROOT/'pums-p-wi.response'],pumas,profile)
 def enrollment(geoids,key,**kwargs):
  old=cp._fetch_acs_rows
  cp._fetch_acs_rows=lambda geoids,variables,key,**kw:{g:{v:raw[g][v] for v in variables} for g in geoids}
  try:return cp.fetch_acs_school_enrollment(geoids,key,**kwargs)
  finally:cp._fetch_acs_rows=old
 print('RETRY_FIT_STARTED',json.dumps(summary),flush=True)
 result=synthesis.synthesize_study_area(zones,census_api_key='',source_profile=profile,include_school_enrollment=True,
  resolve_pumas=lambda *a,**kw:pumas,fetch_pums_person_rows=lambda *a,**kw:(people,summary),
  fetch_acs_zone_controls=lambda *a,**kw:raw,fetch_acs_school_enrollment=enrollment)
 del people;gc.collect()
 print('FIT_COMPLETE',json.dumps(result['summary']),flush=True)
 with checkpoint.open('xb') as f:pickle.dump(result,f,protocol=5)
 receipt.write_text(json.dumps({'binding':binding,'sha256':sha(checkpoint),'bytes':checkpoint.stat().st_size,'claim':'recovery of this owned public-input fit only'},indent=2)+'\n')
 print('CHECKPOINT_RETAINED',sha(checkpoint),flush=True)
descriptor=common.retain_population(ROOT/'common_population',zones,result,
 source_manifest_path=ROOT/'population-source-manifest.json',zone_attributes_path=ZONE_PATH,source_profile=profile)
report={'summary':result['summary'],'fit_quality':result['fit_quality'],'fit_grading_note':result['fit_grading_note'],
 'manifest':descriptor,'python':platform.python_version(),'retention_implementation_sha256':sha(Path(common.__file__)),
 'checkpoint':json.loads(receipt.read_text())}
(EVIDENCE/'population-result.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report),flush=True)
