import hashlib,json,os,subprocess
from pathlib import Path
root=Path('/home/nathaniel/.local/state/openplan/engagement-write-recovery-2026-09-12');app=root/'openplan';out=Path(__file__).with_suffix('.json')
lib=app/'src/lib/notifications/engagement.ts';ledger=app/'src/test/migrations/release-ordering.test.ts';worker=root/'workers/activitysim_worker/supabase_poll.py';test=root/'workers/activitysim_worker/test_screening_handoff.py'
checks=['src/test/engagement-email-delivery-is-visible.test.tsx','src/test/a-library-may-not-discard-a-read-error.test.ts','src/test/migrations/release-ordering.test.ts']
cases=[
 ('harmless-comment',lib,'Record a message in the outbox,','Retain a message in the outbox,',None,'ts'),
 ('false-unsaved-count',lib,'let unrecorded = 0;','let unrecorded = 1;','a publish tells the operator','ts'),
 ('discard-repaired-insert-error',lib,'const { data: row, error: insertError } = await client','const insertError = null; const { data: row } = await client','notifications/engagement.ts','ts'),
 ('incorrect-shipped-migration-count',ledger,'migrationsAtRelease: 321','migrationsAtRelease: 322','no migration has been inserted','ts'),
 ('worker-harmless-comment',test,'This file-copy test never contacts Supabase','This file-copy check never contacts Supabase',None,'python'),
 ('lost-network-setup',worker,'shutil.copy2(setup_summary_path, os.path.join(screening_dir, "work", "network_setup_summary.json"))','with open(os.path.join(screening_dir, "work", "network_setup_summary.json"), "w") as output:\n        output.write("{}")','AssertionError','python'),
]
results=[]
for name,path,before,after,expected,kind in cases:
 original=path.read_text();assert original.count(before)==1,(name,original.count(before))
 command=['npx','vitest','run',*checks] if kind=='ts' else [str(root/'workers/activitysim_worker/.venv311/bin/python'),'-B',str(test)]
 env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'}
 for key in ['SUPABASE_URL','NEXT_PUBLIC_SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']:env.pop(key,None)
 try:
  path.write_text(original.replace(before,after));r=subprocess.run(command,cwd=app if kind=='ts' else test.parent,env=env,capture_output=True,text=True,timeout=90)
 finally:path.write_text(original)
 output=r.stdout+r.stderr;matched=r.returncode==0 if expected is None else r.returncode!=0 and expected in output and 'AssertionError' in output
 results.append({'name':name,'outcome':'survived' if r.returncode==0 else 'killed','matched':matched,'sourceSha256':hashlib.sha256(original.encode()).hexdigest(),'expected':expected,'diagnostic':None if matched else output[-2500:]});out.write_text(json.dumps(results,indent=2)+'\n');print(name,results[-1]['outcome'],matched,flush=True)
 if not matched:raise RuntimeError('Mutation result did not match; source restored')
