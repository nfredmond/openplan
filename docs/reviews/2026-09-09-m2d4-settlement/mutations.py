import json, os, re, subprocess
from pathlib import Path
root=Path('/home/nathaniel/.local/state/openplan/m2d4-settlement-2026-09-09/openplan')
out=Path('/home/nathaniel/.local/state/openplan/m2d4-settlement-evidence-2026-09-09')
sql=(root/'supabase/migrations/20261004000001_work_program_closeout_reconciliation.sql').read_text()
functions=sql[sql.index('CREATE FUNCTION public.read_work_program_closeout'):].replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
messages=['Invalid closeout command','Complete the reconciliation lists','List the matched receipts','Closeout retry differs from saved command','Closeout changed; reload retained history','Closeout sources changed; reload and reconcile again','Reopen the current approved reconciliation','Reopen the approved reconciliation before changing it','Save a current reconciliation before approval','Reconciliation repeats a source','Reconcile every retained claim, commitment and work element','Claim is outside the retained baseline','Match a positive amount to a current approved payment','Receipt allocations exceed the physical payment','Enter refunds in whole cents or leave unknown','Assess each current claim and refund with evidence before approval','Commitment is outside the retained report','Outstanding commitment exceeds its recorded value','Assess each commitment with evidence before approval','Select a retained work element and disposition','Carryover requires an adopted successor work element in this workspace and currency','Carryover requires an explicit amount in whole cents','Carryover source fund has no assessed baseline amount','Carryover exceeds the source fund baseline','Select an assessed carryover fund in the adopted successor','Carryover exceeds the successor fund baseline','Only carryover work may name a successor or amount','Assess completion or carryover authority for each element before approval','Record the approval or reopening evidence','Record the register completeness and reconciliation evidence','The retained baseline no longer has adoption authority','Issue a current management report before approving changed costs or commitments','Select a retained management report in this program']
probes=[('harmless comment',functions.replace('-- Lock before comparing','-- Serialize before comparing'),True)]
for msg in messages:
    pattern=r"RAISE EXCEPTION '"+re.escape(msg)+r"' USING ERRCODE='[^']+';"
    changed,count=re.subn(pattern,'NULL;',functions)
    assert count==1,(msg,count)
    probes.append((msg,changed,False))
for pos in [0,1]:
    target="RAISE EXCEPTION 'Private closeout requires an owner or administrator' USING ERRCODE='42501';"
    parts=functions.split(target); assert len(parts)==3
    changed=parts[0]+('NULL;' if pos==0 else target)+parts[1]+('NULL;' if pos==1 else target)+parts[2]
    probes.append((f'role guard {pos}',changed,False))
probes += [('private RLS',functions+"\nALTER POLICY closeout_private_read ON public.work_program_closeout_records USING (true);",False),('immutable history',functions+'\nALTER TABLE public.work_program_closeout_records DISABLE TRIGGER immutable_work_program_closeout;',False)]
probes += [('direct reader execution',functions+'\nGRANT EXECUTE ON FUNCTION public.read_work_program_closeout(uuid,uuid,uuid) TO authenticated;',False),('direct command execution',functions+'\nGRANT EXECUTE ON FUNCTION public.work_program_closeout_command(uuid,uuid,jsonb) TO authenticated;',False)]
old="(SELECT b.program_id FROM public.program_work_program_revisions b WHERE b.id=(e->>'successorRevisionId')::uuid)=(target->>'program_id')::uuid"
assert old in functions
probes.append(('successor amendment bypass',functions.replace(old,"e->>'successorRevisionId'=row->>'successorRevisionId'"),False))
results=[]
for i,(name,body,control) in enumerate(probes):
    path=out/'mutation.sql';path.write_text(body)
    env=os.environ|{'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/m2d4-settlement-verification','M2D4_SQL_REPLACEMENT':str(path)}
    run=subprocess.run(['npm','exec','--','vitest','run','src/test/work-program-closeout-rls.test.ts'],cwd=root,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    (out/f'mutation-{i}.log').write_text(run.stdout)
    results.append({'name':name,'expected':'survived' if control else 'killed','result':'survived' if run.returncode==0 else 'killed','exitCode':run.returncode,'log':f'mutation-{i}.log'})
    (out/'sql-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
    print(i,name,results[-1]['result'],flush=True)
assert all(r['expected']==r['result'] for r in results)
