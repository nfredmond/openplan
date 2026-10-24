"""Acquire public inputs only. Never contact the TBI service."""
import csv,sys,requests,hashlib,json,datetime,concurrent.futures
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
import census_pums as cp
ROOT=Path('data/_screening_cache/tbi2019-integration')
variables=cp.acs_variables_for(cp.controls_for_geography('tract')[0])+[cp.ENROLLMENT_HIGH_SCHOOL_CELL,*cp.ENROLLMENT_COLLEGE_CELLS,'B01003_001E','B11001_001E','B23025_004E','B19013_001E']
tables={v.split('_')[0] for v in variables}
lookup=list(csv.DictReader((ROOT/'acs-lookup.response').open(encoding='cp1252')))
sequences=sorted({r['Sequence Number'] for r in lookup if r['Table ID'] in tables})
base='https://www2.census.gov/programs-surveys/acs/summary_file/2019/data/5_year_seq_by_state/Minnesota/Tracts_Block_Groups_Only/'
urls={f'acs-sequence-{s}':base+f'20195mn{s}000.zip' for s in sequences}
urls.update({'tracts-2019':'https://www2.census.gov/geo/tiger/TIGER2019/TRACT/tl_2019_27_tract.zip','places-2019':'https://www2.census.gov/geo/tiger/TIGER2019/PLACE/tl_2019_27_place.zip'})
def get(item):
 name,url=item
 p=ROOT/(name+'.response')
 if p.exists(): raise ValueError('Refuse overwrite: '+str(p))
 try:
  r=requests.get(url,timeout=90);p.write_bytes(r.content)
  return {'name':name,'url':url,'resolved_url':r.url,'http_status':r.status_code,'bytes':len(r.content),'sha256':hashlib.sha256(r.content).hexdigest(),'path':str(p),'retrieved_at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
 except Exception as e:return {'name':name,'url':url,'error':str(e)}
rows=list(concurrent.futures.ThreadPoolExecutor(3).map(get,urls.items()))
Path('docs/modeling/activitysim-tbi2019-2026-10-23/integration-evidence/source-manifest.fourth.json').write_text(json.dumps(rows,indent=2)+'\n')
for r in rows:print(r['name'],r.get('http_status'),r.get('bytes'),r.get('error',''))
