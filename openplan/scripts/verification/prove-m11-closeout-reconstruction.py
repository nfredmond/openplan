"""Prove downloaded-file reconstruction rejects altered evidence independently of app code."""
from pathlib import Path
import copy,csv,hashlib,importlib.util,json
module_path=Path(__file__).with_name('verify-m11-agency-closeout.py')
spec=importlib.util.spec_from_file_location('reconstruct',module_path);verify=importlib.util.module_from_spec(spec);spec.loader.exec_module(verify)
name='closeout-b40809c2-826d-429d-9dcf-eaf87c7513da';original=json.loads((Path('/home/nathaniel/Downloads')/(name+'.json')).read_text());csv_text=(Path('/home/nathaniel/Downloads')/(name+'.csv')).read_text();results=[]
for control,reason in [('harmless-json-formatting',None),('changed-cost-with-new-hash','Independent actual totals'),('lost-open-obligation','Continuing obligation lost'),('changed-csv-version','CSV source-version identities'),('altered-content-hash','Retained closeout content hash mismatch')]:
 folder=Path('/tmp/openplan-m11-acceptance/reconstruction-controls')/control;folder.mkdir(parents=True,exist_ok=True);d=copy.deepcopy(original);text=csv_text
 if control=='changed-cost-with-new-hash':
  next(a for a in d['content']['package']['state']['actuals'] if a['command']['sourceKey']=='synthetic-vendor-cost')['amount']='26.00'
 if control=='lost-open-obligation':d['content']['package']['request']['obligations'][0]['dueOn']=None
 if control=='changed-csv-version':text=text.replace('09b1ec00-feee-4f09-a593-301c373d3c2d','00000000-0000-4000-8000-000000000000',1)
 if control=='altered-content-hash':d['content_hash']='0'*64
 elif control!='harmless-json-formatting':d['content_hash']=hashlib.sha256(json.dumps(verify.canonical_jsonb(d['content']),ensure_ascii=False,separators=(', ',': ')).encode()).hexdigest()
 (folder/(name+'.json')).write_text(json.dumps(d,indent=4,sort_keys=True));(folder/(name+'.csv')).write_text(text)
 try:verify.verify(folder)
 except AssertionError as error:
  assert reason and reason in str(error),(control,str(error));outcome='killed'
 else:assert reason is None,control+' survived';outcome='survived'
 results.append({'name':control,'outcome':outcome,'reason':reason});print(control,outcome)
(Path(__file__).resolve().parents[3]/'docs/reviews/2026-09-08-m11-delivery/closeout-reconstruction-controls.json').write_text(json.dumps(results,indent=2)+'\n')
