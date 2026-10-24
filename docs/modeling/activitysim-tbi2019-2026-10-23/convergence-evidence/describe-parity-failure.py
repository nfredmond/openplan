"""Describe the already-detected modeled trip-logsum mismatch without new runs."""
import csv,json,math,struct,sys
from pathlib import Path
sys.path.insert(0,'scripts/modeling')
from activitysim_chunk_parity import digest
E=Path(__file__).resolve().parent;R=Path('data/_screening_cache/tbi2019-convergence');tables={}
for mode in ['disabled','training']:
 with (R/('parity-current-'+mode)/'final_trips.csv').open() as f:
  tables[mode]={r['trip_id']:r for r in csv.DictReader(f)}
failures=[]
for key,a in tables['disabled'].items():
 b=tables['training'][key]
 if a['destination_logsum']==b['destination_logsum']:continue
 x,y=float(a['destination_logsum']),float(b['destination_logsum'])
 if math.isnan(x) and math.isnan(y):continue
 failures.append({'trip_id':key,'column':'destination_logsum','unchunked_decimal':a['destination_logsum'],'training_decimal':b['destination_logsum'],'unchunked_float_hex':x.hex(),'training_float_hex':y.hex(),'absolute_difference':abs(x-y),'ulp_distance_same_sign':abs(struct.unpack('>q',struct.pack('>d',x))[0]-struct.unpack('>q',struct.pack('>d',y))[0])})
record={'claim':'MODELED ONLY; exact parity failed; no tolerance applied','differences':failures,'trip_rows':len(tables['disabled']),'comparison_stopped_at_first_failing_column':True,'remaining_trip_columns_unassessed':True,'full_runs_started':False,'source_parity_result_sha256':digest(E/'parity-result.json')}
(E/'parity-failure-detail.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record,indent=2))
