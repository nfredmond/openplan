"""Exercise archive validation and rendering faults in the owned checkout, restoring exact source."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
root = Path(__file__).resolve().parents[3]
app = root / 'openplan'
out = Path(os.environ['OPENPLAN_REPORT_HISTORY_EVIDENCE'])
out.mkdir(parents=True, exist_ok=True)
export = app / 'src/lib/engagement/review-export.ts'
links = app / 'src/lib/engagement/decision-links.ts'
download = app / 'src/lib/engagement/review-export-download.ts'
worker = app / 'src/lib/engagement/review-export-worker.ts'
ui = app / 'src/components/engagement/engagement-review-files.tsx'
route = app / 'src/app/api/engagement/campaigns/[campaignId]/reports/route.ts'
originals = {p: p.read_text() for p in [export, links, download, worker, ui, route]}
cases = [
 ('baseline',export,None,None,None),
 ('harmless-comment',links,'/** Validate an exact historical inventory','/** Verify an exact historical inventory',None),
 ('public-history-field-guard-removed',export,'if (value.schema === 1 && historyFields.some(field => field in value))','if (false)','rejects private'),
 ('public-schema-two-allowed',export,'value.scope !== "internal" || value.decisionLinkHistoryScope','value.decisionLinkHistoryScope','rejects schema-2 public'),
 ('job-campaign-scope-ignored',export,'if (expected && (value.campaign.id !== expected.campaignId || value.scope !== expected.scope))','if (false)','matches campaign'),
 ('job-workspace-scope-ignored',export,'|| (expected && value.workspaceId !== expected.workspaceId)','', 'matches campaign'),
 ('history-count-ignored',links,'if (history.entryCount !== history.entries.length)','if (false)','refuses incomplete inventories'),
 ('history-chains-skipped',links,'for (const row of entries) {','for (const row of []) {','refuses incomplete inventories'),
 ('exact-payload-check-skipped',links,'await checkHash(row.payload_text, row.payload_sha256);','', 'refuses altered exact bytes'),
 ('history-html-missing',export,'${decisionHistoryHtml(snapshot)}','', 'discloses campaign-wide'),
 ('source-number-shifted',export,'Source ${source.position}:','Source ${source.position + 1}:','original source positions'),
 ('workbook-original-context-lost',export,"cell('decision action',row.id,'context_text',row.context_text)","cell('decision action',row.id,'context_text','')",'workbook continuation rows'),
 ('workbook-total-lost',export,'if(snapshot.schema===2)totals.push','if(false)totals.push','workbook continuation rows'),
 ('portable-snapshot-reencoded',export,"addText('snapshot.json',snapshotText)","addText('snapshot.json',JSON.stringify(snapshot))",'retains exact snapshot bytes'),
 ('portable-history-csv-missing',export,"if(snapshot.schema===2)addText('decision-history.csv'","if(false)addText('decision-history.csv'",'retains exact snapshot bytes'),
 ('worker-job-scope-ignored',worker,',job.snapshot_sha256,{campaignId:job.campaign_id,workspaceId:job.workspace_id,scope:job.scope}',',job.snapshot_sha256','validates history and job scope'),
 ('worker-cache-corruption-ignored',worker,"if(createHash('sha256').update(bytes).digest('hex')!==file.checksum)throw new Error('Incomplete cache');",'', 'rebuilds a damaged cache'),
 ('preparation-disclosure-missing',ui,"{scope==='internal'?<p>",'{false?<p>','shows the broader private history scope'),
 ('legacy-format-mislabelled',ui,'job.snapshot_format===1?', 'false?', 'distinguishes old, new and unknown'),
 ('unknown-format-mislabelled',ui,'job.snapshot_format===2?', 'job.snapshot_format!==1?', 'distinguishes old, new and unknown'),
 ('retained-report-filter-removed',ui,'(reportId?jobs.filter(job=>job.report_id===reportId):jobs)','jobs','retains the old-format notice'),
 ('format-projection-missing',route,'id,report_id,scope,snapshot_format,filters_json','id,report_id,scope,filters_json','projects the derived format'),
 ('internal-download-validation-skipped',download,'try {\n  const snapshot=await parseReviewSnapshot','try {\n  if(row.scope===\'public\') { const snapshot=await parseReviewSnapshot','refuses orphan history'),
]
# The last mutation closes its added public-only block before the existing catch.
results=[]
try:
 for label,path,old,new,expected in cases:
  for p,s in originals.items():p.write_text(s)
  if old is not None:
   assert old in originals[path],label
   source=originals[path].replace(old,new,1)
   if label=='internal-download-validation-skipped':source=source.replace(' } catch { return denied(); }',' } } catch { return denied(); }',1)
   path.write_text(source)
  report=out/(label+'.json')
  with (out/(label+'.log')).open('w') as log:
   result=subprocess.run(['npm','exec','--','vitest','run','src/test/engagement-decision-links.test.ts','src/test/engagement-review-export.test.ts','src/test/engagement-review-decision-history.test.ts','src/test/engagement-review-history-download.test.ts','src/test/engagement-review-history-worker.test.ts','src/test/engagement-review-history-ui.test.tsx','src/test/engagement-review-history-list-route.test.ts','--reporter=json','--outputFile='+str(report)],cwd=app,stdout=log,stderr=subprocess.STDOUT)
  data=json.loads(report.read_text());failed=[a['fullName'] for t in data['testResults'] for a in t['assertionResults'] if a['status']=='failed']
  correct=(result.returncode==0 and data['numPassedTests']==53 and not failed) if expected is None else (result.returncode!=0 and any(expected in name for name in failed))
  results.append({'case':label,'exit':result.returncode,'passed':data['numPassedTests'],'failed':failed,'expectedOutcome':correct})
  print(label,correct,flush=True)
  assert correct,label
finally:
 for p,s in originals.items():p.write_text(s)
 (out/'results.json').write_text(json.dumps({'results':results,'sources':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in originals},'limits':['Native synthetic decision rows exercise real hash/chain validators, not the report queue SQL.','PDF rendering is replaced; real PDF layout needs Chrome and artifact inspection.','Download storage and membership queries are controlled doubles, not live RLS.','Worker disk-cache checks use actual files and the real parser; storage delivery and queue leases remain mocked.']},indent=2)+'\n')
