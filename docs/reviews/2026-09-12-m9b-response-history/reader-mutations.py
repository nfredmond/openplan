"""Focused source mutations; restores exact bytes after every run, including failure."""
import hashlib, json, subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[3]
app=root/'openplan'
review=Path(__file__).resolve().parent
reader=app/'src/lib/engagement/response-history-server.ts'
route=app/'src/app/api/engagement/campaigns/[campaignId]/closeloop/history/route.ts'
cases=[
 ('harmless-comment',reader,'/** Verify','/** Harmless comment. Verify',None),
 ('skip-checksum',reader,'if (createHash("sha256").update(record_text, "utf8").digest("hex") !== entry.record_sha256)','if (false)','checksum corruption'),
 ('ignore-count',reader,'snapshot.count !== snapshot.entries.length','false','count mismatch'),
 ('ignore-envelope',reader,'snapshot.campaignId !== campaignId','false','foreign envelope'),
 ('ignore-row-scope',reader,'entry.campaign_id !== campaignId','false','foreign row'),
 ('ignore-retained-scope',reader,'record.id !== entry.response_id || record.campaign_id !== campaignId','false','foreign retained response'),
 ('ignore-revisions',reader,'entry.revision !== (revisions.get(entry.response_id) ?? 0) + 1','false','revision gap'),
 ('ignore-removal',reader,'removed.has(entry.response_id)','false','identity reused after removal'),
 ('ignore-baseline',reader,'if (entry.revision === 1 ? !["created", "legacy_baseline"].includes(entry.event) : ["created", "legacy_baseline"].includes(entry.event))','if (false)','wrong initial event'),
 ('wrong-anonymous-status',route,'status: 401','status: 200','anonymous'),
 ('allow-viewer',route,'if (!access.allowed)','if (false)','viewer'),
 ('ignore-access-error',route,'if (access.error)','if (false)','failed access read'),
 ('ignore-verification-error',route,'if (history.error)','if (false)','failed verification'),
 ('cache-private-history',route,'private, no-store','public, max-age=3600','private no-store'),
]
results=[]
for name,path,before,after,expected in cases:
 original=path.read_text(); assert original.count(before)==1,(name,original.count(before))
 try:
  path.write_text(original.replace(before,after))
  run=subprocess.run(['npx','vitest','run','src/test/engagement-response-history.test.ts','src/test/engagement-response-history-route.test.ts'],cwd=app,capture_output=True,text=True,timeout=60)
 finally: path.write_text(original)
 output=run.stdout+run.stderr
 matched=run.returncode==0 if expected is None else run.returncode!=0 and expected in output and 'AssertionError' in output
 results.append({'name':name,'status':run.returncode,'outcome':'survived' if run.returncode==0 else 'killed','matched':matched,'expectedTest':expected,'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'diagnostic':output[-1600:] if not matched else None})
 (review/'reader-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
 print(name,results[-1]['outcome'],matched,flush=True)
 if not matched: raise RuntimeError(output)
