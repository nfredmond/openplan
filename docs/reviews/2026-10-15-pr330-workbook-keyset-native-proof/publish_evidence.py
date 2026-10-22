"""Publish synthetic results, hashes and receipts. Never copy secrets or raw histories."""
import hashlib,json,xml.etree.ElementTree as E,zipfile
from pathlib import Path
BASE=Path('/home/nathaniel/.local/state/openplan/pr330-workbook-keyset-native-proof-20261015')
OUT=Path(__file__).parent/'evidence'
def sha(b):return hashlib.sha256(b).hexdigest()
def read(p):return json.loads(p.read_text())
def write(n,v):(OUT/n).write_text(json.dumps(v,indent=None if n in ['native.json','workbook-values.json','sql-fixture-values.json'] else 2,default=str)+'\n')
p=read(BASE/'plan.json');write('target.json',p)
bind=read(BASE/'source-bindings.json');paths=['src/app/api/projects/export/workbook/route.ts','src/lib/projects/portfolio-export.ts','src/lib/projects/portfolio-workbook.ts','src/lib/projects/portfolio-round-trip-contract.ts','src/lib/projects/project-place.ts','src/lib/export/review-workbook-layout.ts']
write('source-bindings.json',{'head':bind['head'],'appTree':bind['appTree'],'files':{x:bind['files'][x] for x in paths},'fullPrivateManifestSha256':sha((BASE/'source-bindings.json').read_bytes()),'fullPrivateFileCount':len(bind['files'])})
helpers=[];resources=[];trials=[];cases=[]
for d in sorted(BASE.iterdir()):
 if not d.is_dir():continue
 if (d/'receipt.json').exists():
  helpers.append({**read(d/'receipt.json'),'stopped':read(d/'stopped.json')})
  resources.append({'trial':d.name,**read(d/'resources.json')})
 for t in sorted(d.glob('*/classification.json')):
  v=read(t);v['trial']=str(t.parent.relative_to(BASE));trials.append(v)
 for t in sorted(d.glob('*/observations.json')):
  cases.append({'trial':str(t.parent.relative_to(BASE)),'observations':read(t)})
write('helpers.json',helpers);write('resources.json',resources);write('trials.json',trials);write('native.json',cases)
concurrent={}
for name in ['harmless','fault-old-offset','restored']:
 concurrent[name]=read(BASE/'cap-2'/name/'concurrent-before-assert.json')
write('concurrent.json',concurrent)
# Retain emitted workbook values independently of the live serializer implementation.
ns={'s':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def workbook(p):
 with zipfile.ZipFile(p) as z:
  strings=[]
  if 'xl/sharedStrings.xml' in z.namelist():
   strings=[''.join(x.itertext()) for x in E.fromstring(z.read('xl/sharedStrings.xml')).findall('s:si',ns)]
  root=E.fromstring(z.read('xl/worksheets/sheet1.xml'));rows=[]
  for row in root.findall('s:sheetData/s:row',ns):
   values={}
   for cell in row.findall('s:c',ns):
    v=cell.find('s:v',ns);t=cell.get('t');text='' if v is None else (v.text or '')
    if t=='s':text=strings[int(text)]
    elif t=='inlineStr':text=''.join(cell.find('s:is',ns).itertext())
    values[cell.get('r')]=text
   rows.append(values)
  return {'path':str(p.relative_to(BASE)),'sha256':sha(p.read_bytes()),'rows':rows}
values=[]
for d in ['failed-attempt-02-cap-1000/baseline','cap-137/baseline','cap-2/harmless','cap-2/restored']:
 for x in sorted((BASE/d).glob('*.xlsx')):values.append(workbook(x))
write('workbook-values.json',values)
fixtures=read(BASE/'fixtures-private.json')
columns=['id','name','summary','status','plan_type','delivery_phase','estimated_cost_amount','estimated_cost_currency','estimated_cost_basis_year','estimated_cost_source_document_id','estimated_cost_recorded_at','created_at','updated_at','place_source','place_kind','place_ref','place_label','place_country_code','place_subdivision_code','place_min_lon','place_min_lat','place_max_lon','place_max_lat','place_set_at']
for portfolio in fixtures['portfolios']:portfolio['rows']=[{k:v for k,v in row.items() if k in columns} for row in portfolio['rows']]
write('sql-fixture-values.json',fixtures)
write('safety.json',read(BASE/'safety.json'))
for name in ['preservation.json','resources-final.json']:
 if (BASE/name).exists():write(name,read(BASE/name))
# Full failed reports/logs remain private; publish exact rejection metadata and hashes.
failed=[]
for x in sorted(BASE.glob('failed-*.json')):failed.append({'file':x.name,**read(x),'sha256':sha(x.read_bytes())})
write('failures.json',failed)
write('classifier.json',[read(x) for x in sorted(BASE.glob('classifier-cap-*.json'))])
