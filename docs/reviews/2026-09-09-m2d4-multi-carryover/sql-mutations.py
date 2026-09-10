from pathlib import Path
import json,subprocess,os
root=Path('/home/nathaniel/.local/state/openplan/m2d4-multi-carryover-2026-09-09/openplan');out=Path('/home/nathaniel/.local/state/openplan/m2d4-multi-carryover-evidence-2026-09-09')
sql=(root/'supabase/migrations/20261007000001_work_program_multi_carryover.sql').read_text()
cases=[('harmless comment',sql+'\n-- harmless mutation control',True)]
for name,old,new in [
 ('read allocation arrays',"CASE WHEN row ? 'allocations' THEN row->'allocations' ELSE jsonb_build_array(row) END","jsonb_build_array(row)"),
 ('list shape',"jsonb_typeof(row->'allocations') IS DISTINCT FROM 'array'",'false'),
 ('mixed legacy mapping',"IF row->>'successorRevisionId' IS NOT NULL OR row->>'successorElementId' IS NOT NULL OR row->>'sourceFundId' IS NOT NULL OR row->>'successorFundId' IS NOT NULL OR row->>'amount' IS NOT NULL THEN",'IF false THEN'),
 ('list limit',"jsonb_array_length(row->'allocations')>100",'false'),
 ('empty carryover',"jsonb_array_length(public.work_program_carryover_allocations(jsonb_build_array(row)))=0",'false'),
 ('whole cents',"coalesce(allocation->>'amount','') !~ '^[0-9]{1,12}(\\.[0-9]{1,2})?$'",'false'),
 ('completed allocations',"coalesce(jsonb_array_length(row->'allocations'),0)>0",'false'),
 ('successor identity',"b->>'id'=allocation->>'successorRevisionId'",'true'),
 ('successor element',"NOT EXISTS(SELECT 1 FROM jsonb_array_elements(target->'content_json'->'elements')e WHERE e->>'id'=allocation->>'successorElementId')",'false'),
 ('source assessment',"IF fund IS NULL OR fund->>'amount' IS NULL THEN RAISE EXCEPTION 'Carryover source", "IF false THEN RAISE EXCEPTION 'Carryover source"),
 ('successor fund',"IF fund IS NULL OR fund->>'amount' IS NULL OR fund->>'kind' IS DISTINCT FROM 'carryover' THEN",'IF false THEN'),
 ('source ceiling',"IF total>(fund->>'amount')::numeric THEN RAISE EXCEPTION 'Carryover exceeds the source", "IF false THEN RAISE EXCEPTION 'Carryover exceeds the source"),
 ('successor ceiling',"IF total>(fund->>'amount')::numeric THEN RAISE EXCEPTION 'Carryover exceeds the successor", "IF false THEN RAISE EXCEPTION 'Carryover exceeds the successor"),
 ('history allocation arrays',"jsonb_array_elements(public.work_program_carryover_allocations(c.content->'assessment'->'work'))e", "jsonb_array_elements(c.content->'assessment'->'work')e"),
 ('reserve through reopening',"AND c.state='approved'", "AND c.state='draft'"),
 ('reserve across amendments',"(SELECT b.program_id FROM public.program_work_program_revisions b WHERE b.id=(e->>'successorRevisionId')::uuid)=(target->>'program_id')::uuid", "e->>'successorRevisionId'=target->>'id'"),
]:
 assert old in sql,name
 cases.append((name,sql.replace(old,new),False))
results=[]
for i,(name,body,survive) in enumerate(cases):
 path=out/'current-mutation.sql';path.write_text(body)
 run=subprocess.run(['node','--env-file-if-exists=.env.local','node_modules/vitest/vitest.mjs','run','src/test/work-program-closeout-rls.test.ts','-t','multi carryover'],cwd=root,env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','M2D4_SQL_REPLACEMENT':str(path)},text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (out/f'sql-mutation-{i}.log').write_text(run.stdout)
 result={'name':name,'exit':run.returncode,'expected':'survived' if survive else 'detected','matched':(run.returncode==0)==survive};results.append(result);(out/'sql-mutations.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(result),flush=True)
 if not result['matched']:raise SystemExit(1)
