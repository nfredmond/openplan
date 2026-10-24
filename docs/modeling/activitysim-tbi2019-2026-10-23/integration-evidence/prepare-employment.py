"""Join published 2019 WAC employment to the unchanged 704-zone system."""
import csv, json, sys, hashlib
from pathlib import Path
sys.path.insert(0, 'scripts/modeling')
from lodes_wac_inputs import aggregate_wac
ROOT=Path('data/_screening_cache/tbi2019-integration')
EVIDENCE=Path(__file__).resolve().parent
source=ROOT/'lodes-wac2019.response'
rows=list(csv.DictReader((ROOT/'zone_attributes.csv').open()))
totals,record=aggregate_wac(source,{r['GEOID'] for r in rows})
for row in rows:
 row.update(totals[row['GEOID']])
 row['households']=row.pop('est_households');row['worker_residents']=row.pop('est_workers');row['area_share']=1
with (ROOT/'zone_attributes.with-employment.csv').open('x',newline='') as handle:
 writer=csv.DictWriter(handle,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
record.update(source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),
 source_url='https://lehd.ces.census.gov/data/lodes/LODES7/mn/wac/mn_wac_S000_JT00_2019.csv.gz',
 geographic_basis='LODES7 2010 blocks, 11-digit tract prefix, every selected TIGER2019 tract present',
 limitations=['Jobs, not unique workers or observed trips.','Existing MTC sector pooling remains explicit.'])
(EVIDENCE/'employment.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record))
