"""Fault the HTTP error mappings and direct-table receipt census.

Mocked route tests cover status/meaning, not installed PostgREST retry behavior.
The census covers its declared direct-table set; live join-scoped privacy is
separate. Run only when no browser journey is collecting source evidence.
"""
import json
import subprocess
from pathlib import Path
root=Path(__file__).resolve().parent
app=root.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/conflict-mapping-mutations')
private.mkdir(mode=0o700,exist_ok=True)
paths={'response':app/'src/lib/engagement/response-write.ts','item':app/'src/app/api/engagement/campaigns/[campaignId]/items/[itemId]/route.ts','census':app/'src/test/rls-isolation.test.ts'}
original={k:p.read_text() for k,p in paths.items()}
tests=['engagement-response-write.test.ts','engagement-response-write-route.test.ts','engagement-items-route.test.ts','rls-isolation.test.ts']
cases=[
 ('baseline',{},None),
 ('harmless-comment',{'response':original['response']+'\n// Harmless conflict mapping control.\n'},None),
 ('response-conflict-unavailable',{'response':original['response'].replace('code === "PT409" || ','')},'distinguishes database PT409'),
 ('unconfirmed-receipt-editable',{'response':original['response'].replace('code === "PT409" || ','code === "PT503" || code === "PT409" || ')},'distinguishes database PT503'),
 ('item-conflict-unavailable',{'item':original['item'].replace('updateError?.code === "PT409" || ','')},'returns reviewable conflict for database PT409'),
 ('receipt-census-entry-removed',{'census':original['census'].replace('      "engagement_response_write_receipts",\n','')},'covers every direct workspace-scoped table'),
]
results=[]
try:
 for name,edits,expected in cases:
  for k,s in edits.items():
   assert s!=original[k],(name,'mutation did not change code')
   paths[k].write_text(s)
  report=private/(name+'.json')
  run=subprocess.run(['npm','exec','--','vitest','run',*[f'src/test/{t}' for t in tests],'--reporter=json','--outputFile='+str(report)],cwd=app,capture_output=True,text=True,timeout=120)
  (private/(name+'.log')).write_text(run.stdout+'\n'+run.stderr)
  d=json.loads(report.read_text());failed=[t['fullName'] for f in d['testResults'] for t in f['assertionResults'] if t['status']=='failed']
  matched=run.returncode==0 and d['numPassedTests']>=127 if expected is None else run.returncode!=0 and any(expected in t for t in failed)
  row={'name':name,'outcome':'survived' if run.returncode==0 else 'killed','matched':matched,'passed':d['numPassedTests'],'failed':failed,'expected':expected};results.append(row)
  (root/'conflict-mapping-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
  for k in edits:paths[k].write_text(original[k])
  print(name,row['outcome'],matched,flush=True)
  assert matched,row
finally:
 for k,p in paths.items():p.write_text(original[k])
