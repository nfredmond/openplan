"""Exercise failure controls against the actual history and translation modules."""
from pathlib import Path
import os,json,subprocess
root=Path(__file__).resolve().parent
app=root.parents[2]/'openplan'
private=Path(os.environ['OPENPLAN_TRANSLATION_PROBE_EVIDENCE']).resolve()
if private.is_relative_to(root.parents[2]): raise ValueError('Evidence must be outside repo')
private.mkdir(parents=True,exist_ok=True)
helper='src/lib/engagement/translation.ts'; reader='src/lib/engagement/translation-history-server.ts'
ui='src/components/engagement/translation-history.tsx'; route='src/app/api/engagement/campaigns/[campaignId]/translations/history/route.ts'
tests={'helper':'src/test/engagement-translation.test.ts','reader':'src/test/engagement-translation-history.test.ts','ui':'src/test/engagement-translation-history-ui.test.tsx','route':'src/test/engagement-translation-history-route.test.ts','census':'src/test/rls-isolation.test.ts'}
cases=[
 ('source-prefix',helper,'(input.text ?? "").trim()','(input.text ?? "").trim().slice(0,4000)','helper','sends the entire valid long source'),
 ('partial-completion',helper,'finishReason !== "stop" || !translated','!translated','helper','refuses nonempty output'),
 ('unbounded-input',helper,'Buffer.byteLength(text, "utf8") > TRANSLATION_INPUT_MAX_BYTES','false','helper','refuses oversized UTF-8 input'),
 ('checksum',reader,'if (createHash("sha256").update(record_text, "utf8").digest("hex") !== entry.record_sha256)','if (false)','reader','checksum corruption'),
 ('count',reader,'snapshot.count !== snapshot.entries.length','false','reader','count mismatch'),
 ('workspace',reader,'record.workspace_id !== workspaceId','false','reader','foreign retained workspace'),
 ('sequence',reader,'entry.revision !== (previous?.revision ?? 0) + 1','false','reader','revision gap'),
 ('after-removal',reader,'previous?.event === "removed"','false','reader','identity reused after removal'),
 ('duplicate-id',reader,'ids.has(entry.id)','false','reader','duplicate identity with valid revisions'),
 ('baseline-actor',reader,'entry.event === "legacy_baseline" && entry.actor_id !== null','false','reader','invented legacy actor'),
 ('address',reader,'if (previous && ["entity_type", "entity_id", "field", "locale"].some','if (false && previous && ["entity_type", "entity_id", "field", "locale"].some','reader','address changed within identity'),
 ('viewer-route',route,'if (!access.allowed)','if (false && !access.allowed)','route','refuses viewer'),
 ('failed-read',route,'if (history.error)','if (false && history.error)','route','reports failed verification'),
 ('foreign-ui',ui,'if (rows.some(row =>','if (false && rows.some(row =>','ui','refuses a foreign history payload'),
 ('stale-ui',ui,'[campaignId, attempt, revision]','[campaignId, attempt]','ui','refreshes open history'),
]
results=[]
def run(name,test,expected=None):
 report=private/(name+'.json')
 r=subprocess.run(['npm','exec','--','vitest','run',test,'--reporter=json','--outputFile='+str(report)],cwd=app,capture_output=True,text=True,timeout=90)
 (private/(name+'.log')).write_text(r.stdout+r.stderr)
 d=json.loads(report.read_text());failed=[a['fullName'] for f in d['testResults'] for a in f['assertionResults'] if a['status']=='failed']
 matched=(r.returncode==0 and d['numPassedTests']>0) if expected is None else (r.returncode!=0 and any(expected in n for n in failed))
 item={'case':name,'matched':matched,'outcome':'survived' if r.returncode==0 else 'killed','failed':failed};results.append(item);print(name,matched,flush=True)
 (private/'results.json').write_text(json.dumps(results,indent=2)+'\n');assert matched,item
for key,test in tests.items(): run('baseline-'+key,test)
p=app/helper;original=p.read_text()
try:
 p.write_text(original+'\n// Harmless translation control.\n');run('harmless-comment',tests['helper'])
finally:p.write_text(original)
for name,path,old,new,test,expected in cases:
 p=app/path;original=p.read_text();assert original.count(old)==1,(name,original.count(old))
 try:p.write_text(original.replace(old,new,1));run(name,tests[test],expected)
 finally:p.write_text(original)
