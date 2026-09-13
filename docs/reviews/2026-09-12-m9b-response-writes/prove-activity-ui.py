"""Semantic Activity boundary mutations; restores exact original source after each case."""
import hashlib,json,subprocess
from pathlib import Path
root=Path(__file__).resolve().parent;app=root.parents[2]/'openplan'
scratch=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/activity-mutations');scratch.mkdir(exist_ok=True)
paths={'reader':app/'src/lib/notifications/email-delivery-summary.ts','ui':app/'src/components/engagement/notifications-inbox.tsx','route':app/'src/app/api/engagement/campaigns/[campaignId]/notifications/route.ts'}
originals={key:path.read_text() for key,path in paths.items()}
cases=[
 ('baseline','reader',None,None,None),
 ('harmless-comment','reader','Read aggregate outcomes','Read complete aggregate outcomes',None),
 ('wrong-rpc-scope','reader','{ p_campaign: campaignId }','{ p_campaign: "22222222-2222-4222-8222-222222222222" }','uses the staff-scoped RPC'),
 ('wrong-return-scope','reader','if (record.campaignId !== campaignId)','if (false)','rejects a campaign defect at the reader'),
 ('partial-counts','reader','Object.values(record.counts).reduce((sum, value) => sum + value, 0) === record.total','true','rejects a total defect at the reader'),
 ('negative-counts','reader','.int().nonnegative().safe()','.int().safe()','rejects a negative defect at the reader'),
 ('private-record-field','reader','}).strict().refine(record','}).passthrough().refine(record','rejects a private defect at the reader'),
 ('missing-publication-state','reader','noShareToken: count }).strict(),','noShareToken: count }).strict().default({ queued: 0, prepared: 0, cancelled: 0, noShareToken: 0 }),','rejects a missing defect at the reader'),
 ('raw-provider-error','reader','message: z.literal(\n    "A delivery failure was recorded. This does not establish whether the message reached an inbox."\n  )','message: z.string()','refuses raw provider text'),
 ('browser-schema-bypass','ui','emailDeliveryRecordSchema.safeParse(summary)','{ success: true as const, data: summary }','rejects a total defect at the browser boundary'),
 ('browser-scope-bypass','ui','parsed.data.campaignId !== campaignId','false','rejects a campaign defect at the browser boundary'),
 ('stale-campaign-display','ui','delivery.state === "ready" && delivery.summary.campaignId !== campaignId','false','hides the old campaign record'),
 ('false-delivered-label','ui','label: "Accepted by email service"','label: "Delivered"','shows complete counts and honest outcome labels'),
 ('lost-refresh','ui','[campaignId, refresh]','[campaignId]','refreshes a changing attempt outcome'),
 ('false-empty','ui','summary.total === 0 && Object.values(summary.broadcasts).every(value => value === 0)','summary.total === 0','keeps unprepared recipient counts unknown'),
 ('missing-link-outcome','ui','summary.broadcasts.noShareToken > 0','false','distinguishes missing links'),
 ('missing-cancelled-outcome','ui','summary.broadcasts.cancelled > 0','false','distinguishes missing links'),
 ('route-permission-bypass','route','if (!access.allowed)','if (false)','does not read outcomes when campaign access is denied'),
 ('cached-private-record','route','"Cache-Control": "private, no-store"','"Cache-Control": "public, max-age=600"','uses the staff-scoped RPC'),
]
results=[]
try:
 for name,key,before,after,expected in cases:
  source=originals[key]
  if before:
   assert source.count(before)==(2 if name=="route-permission-bypass" else 1),(name,source.count(before))
   source=source.replace(before,after,1)
  paths[key].write_text(source);report=scratch/(name+'.json')
  run=subprocess.run(['npm','exec','--','vitest','run','src/test/engagement-email-delivery-is-visible.test.tsx','--reporter=json',f'--outputFile={report}'],cwd=app,capture_output=True,text=True,timeout=60)
  data=json.loads(report.read_text()) if report.exists() else {}
  failed=[t['fullName'] for f in data.get('testResults',[]) for t in f.get('assertionResults',[]) if t['status']=='failed']
  matched=run.returncode==0 and data.get('numPassedTests',0)>=16 if expected is None else run.returncode!=0 and any(expected in title for title in failed)
  results.append({'name':name,'matched':matched,'exit':run.returncode,'outcome':'survived' if run.returncode==0 else 'killed','expected':expected,'failedTests':failed,'passedTests':data.get('numPassedTests'),'sourceSha256':hashlib.sha256(source.encode()).hexdigest()})
  (root/'activity-ui-mutations.json').write_text(json.dumps(results,indent=2)+'\n');paths[key].write_text(originals[key])
  print(name,results[-1]['outcome'],matched,flush=True)
  assert matched,name
finally:
 for key,path in paths.items():path.write_text(originals[key])
