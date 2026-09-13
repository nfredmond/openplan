import hashlib,json,subprocess
from pathlib import Path
review=Path(__file__).resolve().parent
root=review.parents[2];app=root/'openplan'
lib=app/'src/lib/notifications/engagement.ts'
ui=app/'src/components/engagement/close-loop-builder.tsx'
route=app/'src/app/api/engage/[shareToken]/subscribe/route.ts'
form=app/'src/components/engagement/public-subscribe-form.tsx'
cases=[
 ('harmless-comment',lib,'Record a message in the outbox,','Retain a message in the outbox,',None),
 ('ignore-write-refusal',lib,'if (insertError || !row || typeof row.id !== "string" || !row.id.trim())','if (false)','error alongside a row'),
 ('omit-identity-projection',lib,'.select("id")\n      .single()','.select("*")\n      .single()','does not attempt email delivery'),
 ('count-unsaved-as-enqueued',lib,'if (!outcome.outboxId) { unrecorded += 1; continue; }','if (false) { unrecorded += 1; continue; }','counts only saved emails'),
 ('false-empty-subscriber-notice',ui,'if (enqueued === 0 && unrecorded === 0)','if (enqueued === 0)','does not call failed outbox writes an empty subscriber list'),
 ('hide-partial-failure',ui,'delivered === enqueued && unrecorded === 0','delivered === enqueued','keeps partial delivery and unsaved emails distinct'),
 ('hide-confirmation-persistence-error',route,': !confirmation?.outboxId',': false','outbox unavailable'),
 ('hide-confirmation-transport-error',route,': confirmation.status === "failed"',': false','transport refusal'),
 ('hide-confirmation-retry-flag',route,'const confirmationNeedsRetry = !result.alreadyConfirmed && (!confirmation?.outboxId || confirmation.status === "failed");','const confirmationNeedsRetry = false;','outbox unavailable'),
 ('close-failed-confirmation-form',form,'if (payload.confirmationNeedsRetry)','if (false)','keeps the saved email address available'),
 ('configuration-as-delivery',route,': confirmation.status === "sent"',': transportConfigured','transport skipped'),
]
results=[]
for name,path,before,after,expected in cases:
 original=path.read_text();assert original.count(before)==1,(name,original.count(before))
 try:
  path.write_text(original.replace(before,after))
  run=subprocess.run(['npx','vitest','run','src/test/notifications-engagement.test.ts','src/test/subscribe-route.test.ts','src/test/close-loop-builder.test.tsx','src/test/public-engagement-subscribe-form.test.tsx'],cwd=app,capture_output=True,text=True,timeout=60)
 finally:path.write_text(original)
 output=run.stdout+run.stderr
 matched=run.returncode==0 if expected is None else run.returncode!=0 and expected in output and ('AssertionError' in output or 'TestingLibraryElementError: Unable to find role="status"' in output)
 results.append({'name':name,'outcome':'survived' if run.returncode==0 else 'killed','matched':matched,'expectedTest':expected,'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'diagnostic':output[-2000:] if not matched else None})
 (review/'mutations.json').write_text(json.dumps(results,indent=2)+'\n');print(name,results[-1]['outcome'],matched,flush=True)
 if not matched:raise RuntimeError(output)
