"""Independent retained-artifact readback and non-vacuity controls. No database writes."""
import copy,hashlib,json
from pathlib import Path
from controls import classify,ROOT
D=Path(__file__).parent/'evidence'
def read(n):return json.loads((D/n).read_text())
fixtures=read('sql-fixture-values.json')['portfolios'];books=read('workbook-values.json')
columns=['name','id','summary','estimated_cost_amount','estimated_cost_currency','estimated_cost_basis_year','plan_type','status','delivery_phase','place_label','place_source','place_kind','place_ref','place_country_code','place_subdivision_code','estimated_cost_source_document_id','estimated_cost_recorded_at','created_at','updated_at']
def text(v,k):
 if v is None:return ''
 if k.endswith('_at'):return str(v).replace(' ','T')
 return str(v)
def verify(book):
 count=int(Path(book['path']).stem.split('-')[-1]);p=next(x for x in fixtures if x['count']==count)
 assert len(book['rows'])==count+1,'artifact row count'
 for index,row in enumerate(p['rows'],2):
  for c,k in enumerate(columns):
   address=chr(65+c)+str(index)
   assert book['rows'][index-1].get(address,'')==text(row.get(k),k),'artifact exact '+k
for b in books:
 if 'concurrent' not in b['path']:verify(b)
base=next(b for b in books if 'cap-137/' in b['path'] and b['path'].endswith('portfolio-2000.xlsx'))
verify(copy.deepcopy(base));killed=[]
for col,field in [('B','id'),('A','name'),('D','estimated_cost_amount'),('S','updated_at')]:
 broken=copy.deepcopy(base);broken['rows'][1][col+'2']='fault'
 try:verify(broken)
 except AssertionError as e:assert str(e)=='artifact exact '+field;killed.append(field)
 else:raise AssertionError('artifact control survived '+field)
verify(copy.deepcopy(base))
# Reclassify retained accepted mutation reports against recorded process exits and report hashes.
BASE=Path('/home/nathaniel/.local/state/openplan/pr330-workbook-keyset-native-proof-20261015')
replayed=[]
for trial in read('trials.json'):
 if trial['outcome'] not in ['killed','survived']:continue
 path=BASE/trial['trial']/'report.json'
 assert hashlib.sha256(path.read_bytes()).hexdigest()==trial['reportSha256'],'retained report hash'
 assert classify(json.loads(path.read_text()),trial['exit'],trial['tests'],trial['diagnostic'])==trial['outcome']
 replayed.append(trial['trial'])
# Establish the count-only trap directly from the actual old-reader material.
c=read('concurrent.json');old=c['fault-old-offset'];restored=c['restored']
assert old['count']==4 and len(old['ids'])==4,'old count survives'
assert sorted(old['ids'])!=sorted(old['originalIds']),'old native identity failure'
assert sorted(restored['ids'])==sorted(restored['originalIds']) and len(set(restored['ids']))==4,'restored native identity success'
(D/'packet-controls.json').write_text(json.dumps({'artifactHarmless':'survived','artifactFaults':killed,'exactInputRestore':True,'replayedAcceptedTrials':replayed,'oldReaderCount':4,'oldReaderDuplicate':sorted({x for x in old['ids'] if old['ids'].count(x)>1}),'oldReaderOmitted':sorted(set(old['originalIds'])-set(old['ids'])),'blind':'Artifact/XML readback proves these retained workbook cell values, not native Excel behavior, cookie login, Next HTTP, or arbitrary future serializer changes.'},indent=2)+'\n')
