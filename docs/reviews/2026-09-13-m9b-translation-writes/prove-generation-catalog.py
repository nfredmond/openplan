"""Behavioral catalog controls. Mutations are sequential and restored in finally."""
from pathlib import Path
import hashlib,json,re,subprocess,time
review=Path(__file__).resolve().parent;app=review.parents[2]/'openplan'
private=Path('/home/nathaniel/.local/state/openplan/response-write-probe-20260913/generation-catalog-controls')/time.strftime('%Y%m%dT%H%M%S');private.mkdir(parents=True)
paths={'catalog':app/'src/lib/engagement/translation-generation-catalog.ts','route':app/'src/app/api/engagement/campaigns/[campaignId]/translations/generation/route.ts','sql':app/'supabase/migrations/20261014000015_engagement_translation_generation_catalog.sql'}
original={k:p.read_text() for k,p in paths.items()};cases=[]
for k in paths:
 cases.extend([(f'baseline-{k}',k,original[k],None),(f'harmless-{k}',k,original[k]+('\n-- Harmless catalog control.\n' if k=='sql' else '\n// Harmless catalog control.\n'),None)])
def mutate(name,k,old,new,expected):
 assert original[k].count(old)==1,(name,original[k].count(old),old)
 cases.append((name,k,original[k].replace(old,new),expected))
c='catalog';r='route';s='sql'
mutate('campaign',c,'page.campaignId !== scope.campaignId.toLowerCase() ||','false ||','rejects inconsistent campaign')
mutate('workspace',c,'page.workspaceId !== scope.workspaceId.toLowerCase()','false','rejects inconsistent workspace')
mutate('duplicate-id',c,'new Set(page.requests.map(request => request.id)).size !== page.requests.length','false','rejects inconsistent duplicate')
mutate('counts',c,'Object.values(request.counts).reduce((sum, value) => sum + value, 0) !== request.fieldCount ||','false ||','rejects inconsistent counts')
mutate('time-order',c,'left.createdAt < right.createdAt','left.createdAt !== right.createdAt','rejects inconsistent time_order')
mutate('uuid-order',c,'left.id < right.id','left.id !== right.id','rejects inconsistent uuid_order')
mutate('cursor-inclusive',c,'left.id < right.id','left.id <= right.id','rejects inconsistent at_cursor')
mutate('cursor-dropped',c,'let previous = wantedCursor;','let previous = null;','rejects inconsistent after_cursor')
mutate('next-id',c,'page.next.id !== last.id ||','false ||','rejects inconsistent next_id')
mutate('next-time',c,'page.next.createdAt !== last.createdAt','false','rejects inconsistent next_time')
mutate('next-short',c,'page.requests.length !== 20 ||','false ||','rejects inconsistent short_next')
mutate('unknown-state',c,'cancelled: count }).strict()','cancelled: count }).passthrough()','rejects inconsistent unknown_state')
mutate('empty-fields',c,'fieldCount: z.number().int().min(1)','fieldCount: z.number().int().min(0)','rejects inconsistent empty_fields')
mutate('unknown-locale',c,'locale: z.enum(TRANSLATION_LANGUAGES)','locale: z.string()','rejects inconsistent unsupported_locale')
mutate('timestamp-width',c,'.regex(/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{6}Z$/)','','rejects inconsistent millisecond')
mutate('page-limit',c,').max(20)',').max(30)','rejects inconsistent overfull')
mutate('private-extra',c,'fieldCount: z.number().int().min(1).max(25), counts }).strict()','fieldCount: z.number().int().min(1).max(25), counts }).passthrough()','rejects inconsistent extra_private')
mutate('time-truncated',c,'p_before_created_at: checked?.createdAt ?? null','p_before_created_at: checked ? new Date(checked.createdAt).toISOString() : null','passes all microseconds')
mutate('cursor-id-dropped',c,'p_before_id: checked?.id ?? null','p_before_id: null','passes all microseconds')
mutate('rpc-lost-access',c,'response.error.code === "42501"','false','preserves database refusal 42501')
mutate('route-ambiguous',r,'(!cursor.success || (requestId.success && requestId.data !== undefined))','(!cursor.success)','refuses malformed or ambiguous selector ?requestId=')
mutate('route-cursor-dropped',r,'cursor?.data ?? null','null','passes all microseconds')
# GET-specific existing access guard: keep POST unchanged while probing catalog access.
old='if (!access.allowed) return refused("forbidden", 403);'
assert original[r].count(old)==2
cases.append(('route-nonstaff',r,original[r].rsplit(old,1)[0]+'/* missing staff refusal */'+original[r].rsplit(old,1)[1],'refuses nonstaff before listing'))
mutate('sql-permission',s,'workspace:=lock_translation_generation_scope(p_campaign,auth.uid());','SELECT workspace_id INTO workspace FROM engagement_campaigns WHERE id=p_campaign;','member catalog access')
mutate('sql-workspace',s,'r.workspace_id=workspace','true','Catalog leaked foreign workspace')
mutate('sql-campaign',s,'r.campaign_id=p_campaign AND','true AND','Catalog leaked another campaign')
mutate('sql-continuation',s,'LIMIT 21','LIMIT 20','Catalog first page lost continuation')
mutate('sql-inclusive',s,'(r.created_at,r.id)<(p_before_created_at,p_before_id)','(r.created_at,r.id)<=(p_before_created_at,p_before_id)','Catalog tail repeated or skipped requests')
mutate('sql-tie-loss',s,'(r.created_at,r.id)<(p_before_created_at,p_before_id)','r.created_at<p_before_created_at','Catalog tail repeated or skipped requests')
mutate('sql-partial-cursor',s,'(p_before_created_at IS NULL) IS DISTINCT FROM (p_before_id IS NULL)','false','partial cursor id')
mutate('sql-microseconds',s,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\'),\n   \'fieldCount\'','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"\'),\n   \'fieldCount\'','Catalog timestamp lost microseconds')
mutate('sql-private-payload',s,"'fieldCount',jsonb_array_length(r.intent->'fields')","'credential',r.credential,'fieldCount',jsonb_array_length(r.intent->'fields')",'Catalog exposed private payload or wrong scope')
mutate('sql-anon',s,'TO authenticated;','TO authenticated,anon;','anonymous catalog access')
for state in ['queued','reserved','running','completed','incomplete','failed','interrupted','cancelled']:
 mutate('sql-count-'+state,s,"f.state='"+state+"'","f.state='absent'",'Catalog state counts differ from fields')
results=[];test_count=None
try:
 for name,k,body,expected in cases:
  assert paths[k].read_text()==original[k];paths[k].write_text(body)
  output=private/(name+'.json')
  try:
   command=['python3',str(review/'run-generation-catalog-probe.py')] if k=='sql' else ['npm','exec','--','vitest','run','src/test/translation-generation-catalog.test.ts','--reporter=json','--outputFile='+str(output)]
   if k!='sql' and expected:command+=['-t',re.escape(expected)]
   run=subprocess.run(command,cwd=app,text=True,capture_output=True,timeout=45)
  finally:paths[k].write_text(original[k])
  (private/(name+'.log')).write_text(run.stdout+run.stderr)
  failed=[]
  if k=='sql':correct=run.returncode==0 and '"rollbackContained": true' in run.stdout if expected is None else run.returncode!=0 and expected in run.stdout+run.stderr
  else:
   report=json.loads(output.read_text());assert report['numPassedTests']+report['numFailedTests']>0,'Test filter selected no assertions';failed=[a['fullName'] for suite in report['testResults'] for a in suite['assertionResults'] if a['status']=='failed']
   if test_count is None:test_count=report['numPassedTests'];assert test_count>=33
   correct=run.returncode==0 and report['numPassedTests']==test_count if expected is None else run.returncode!=0 and any(expected in f for f in failed)
  results.append({'case':name,'outcome':'survived' if run.returncode==0 else 'killed','expectedFailure':expected,'failedAssertions':failed,'expectedOutcome':correct})
  (review/'generation-catalog-controls.json').write_text(json.dumps({'sourceSha256':{k:hashlib.sha256(v.encode()).hexdigest() for k,v in original.items()},'testSha256':hashlib.sha256((app/'src/test/translation-generation-catalog.test.ts').read_bytes()).hexdigest(),'testCount':test_count,'privateEvidence':str(private),'results':results,'limits':'Mocked route auth, native page validation and real SQL permission/projection in a rolled-back proof DB. Projection fixtures directly insert all eight states; this does not prove workers produced their outcomes. No browser journey or concurrent page-wide snapshot claim.'},indent=2)+'\n')
  print(name,results[-1]['outcome'],'expected' if correct else 'UNEXPECTED',flush=True)
  assert correct,(name,failed)
finally:
 for k,p in paths.items():assert p.read_text()==original[k]
