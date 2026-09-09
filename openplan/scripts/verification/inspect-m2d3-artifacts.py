from pathlib import Path
from decimal import Decimal
import zipfile,xml.etree.ElementTree as ET,json,hashlib,subprocess
w=Path(__file__).resolve().parents[3]
base=w/'docs/reviews/2026-09-09-m2d3-reimbursement'
ns={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def workbook(path):
 with zipfile.ZipFile(path) as z:
  shared=[]
  if 'xl/sharedStrings.xml' in z.namelist():shared=[''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml'))]
  names=[s.attrib['name'] for s in ET.fromstring(z.read('xl/workbook.xml')).find('x:sheets',ns)]
  result={}
  for i,name in enumerate(names,1):
   rows=[]
   for r in ET.fromstring(z.read(f'xl/worksheets/sheet{i}.xml')).findall('.//x:sheetData/x:row',ns):
    cells=[]
    for c in r:
     v=c.find('x:v',ns);text=v.text if v is not None else ''.join(c.find('x:is',ns).itertext()) if c.find('x:is',ns) is not None else ''
     if c.attrib.get('t')=='s':text=shared[int(text)]
     cells.append(text)
    rows.append(cells)
   result[name]=rows
  return result
q="SELECT jsonb_build_object('claims',(SELECT jsonb_agg(jsonb_build_object('id',id,'state',state,'version',version)) FROM public.work_program_reimbursement_claims WHERE program_id='40fd212d-5862-48d4-901f-a1888b7eeeb9'),'sources',(SELECT count(*) FROM public.work_program_reimbursement_sources WHERE program_id='40fd212d-5862-48d4-901f-a1888b7eeeb9'),'spendEntries',(SELECT count(*) FROM public.project_spend_entries WHERE work_program_id='40fd212d-5862-48d4-901f-a1888b7eeeb9'),'events',(SELECT jsonb_agg(kind ORDER BY sequence) FROM public.work_program_reimbursement_events WHERE program_id='40fd212d-5862-48d4-901f-a1888b7eeeb9'),'reports',(SELECT jsonb_agg(jsonb_build_object('id',id,'snapshotHash',snapshot_hash,'packetVersion',snapshot->'reimbursement'->'packetVersion','request',snapshot->'reimbursement'->'reimbursementTotal','contractCosts',jsonb_array_length(snapshot->'reimbursement'->'contractCosts'),'historyEvents',jsonb_array_length(snapshot->'reimbursement'->'history'))) FROM public.work_program_period_reports WHERE program_id='40fd212d-5862-48d4-901f-a1888b7eeeb9' AND report_kind='reimbursement'));"
r=json.loads(subprocess.check_output(['docker','exec','supabase_db_m2d3-reimbursement-verification','psql','-X','-U','postgres','-At','-c',q],text=True))
assert r['sources']==2 and r['spendEntries']==1 and r['claims'][0]['version']==8 and r['claims'][0]['state']=='accepted'
assert r['events']==['save','review','submit','return','save','review','submit','accept']
r['artifacts']=[]
for version in [1,2]:
 f=base/f'artifacts/synthetic-shared-v{version}.xlsx';book=workbook(f);fields=dict(book['Reimbursement packet'][1:]);expected='30.00' if version==1 else '29.00'
 assert fields['Reimbursement requested']==expected and fields['Source cost']=='37.35' and fields['Match']=='7.35'
 shares=book['Funding shares'][1:];assert sum(Decimal(row[5]) for row in shares if row[4]=='reimbursement')==Decimal(expected)
 assert all(row[3]=='000123.45' for row in shares)
 assert sum(Decimal(row[3]) for row in book['Eligibility decisions'][1:])==Decimal('37.35')
 retained=json.loads(''.join(row[2] for row in book['Shared contract costs'][1:]));assert retained['amount']=='25.00'
 assert retained['spend_entry_id'] in [row[4] for row in book['Cost work links'][1:]]
 assert len(book['Deliverable evidence'])==2 and len(book['Packet history'])==(2 if version==1 else 6)
 for fmt in ['pdf','xlsx']:
  p=base/f'artifacts/synthetic-shared-v{version}.{fmt}'
  r['artifacts'].append({'file':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size,'source':'retained worker artifact, not a confirmed browser download'})
r['independentWorkbookReconstruction']='passed using Python ZIP/XML and Decimal; source costs, request, match, vintage text, physical source and retained contract valuation reconcile'
(base/'shared-cycle-receipt.json').write_text(json.dumps(r,indent=2)+'\n')
print(r['independentWorkbookReconstruction'])
