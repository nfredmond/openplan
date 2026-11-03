"""Verify public archives and reproduce the committed, outcome-free zone CSV."""
import csv
import hashlib
import io
import json
from pathlib import Path
import zipfile
ROOT=Path(__file__).resolve().parents[4]
FOLDER=Path(__file__).resolve().parent.parent
CACHE=ROOT/'data/_screening_cache/activitysim-transit-2019'
config=json.loads((FOLDER/'config.json').read_text())
feed=CACHE/'GTFS20191005.zip';gazetteer=CACHE/'2019_Gaz_tracts_national.zip'
hash_file=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert hash_file(feed)==config['feed_sha256']
counties={'27003':'Anoka','27019':'Carver','27037':'Dakota','27053':'Hennepin','27123':'Ramsey','27139':'Scott','27163':'Washington'}
with zipfile.ZipFile(gazetteer) as z:
    rows=list(csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0])),delimiter='\t'))
selected=sorted((r for r in rows if r['GEOID'][:5] in counties),key=lambda r:r['GEOID'])
rows=[{'zone_id':i+1,'GEOID':r['GEOID'],'centroid_lon':r[next(k for k in r if k.strip()=='INTPTLONG')].strip(),'centroid_lat':r['INTPTLAT'].strip()} for i,r in enumerate(selected)]
# Match the checked-in text file's newline conversion on Linux.
f=io.StringIO(newline='');w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
assert f.getvalue().encode()==(FOLDER/'zones.csv').read_bytes()
record={'acquired_on':'2026-10-23','feed_url':config['feed_url'],'feed_sha256':hash_file(feed),'feed_bytes':feed.stat().st_size,
        'gazetteer_url':'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2019_Gazetteer/2019_Gaz_tracts_national.zip',
        'gazetteer_sha256':hash_file(gazetteer),'gazetteer_bytes':gazetteer.stat().st_size,
        'zone_csv_sha256':hash_file(FOLDER/'zones.csv'),'zones':len(rows),'zone_ids':'GEOID ascending, 1-based',
        'county_counts':{counties[k]:sum(r['GEOID'].startswith(k) for r in rows) for k in counties},
        'respondent_rows_read':0,'terms':'notice.rtf inside the exact feed; attached without alteration'}
(FOLDER/'evidence/source-custody.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
