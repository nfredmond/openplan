from pathlib import Path
import os,subprocess,json,re
root=Path('/home/nathaniel/.local/state/openplan/m2d4-refund-matching-2026-09-09/openplan')
out=Path('/home/nathaniel/.local/state/openplan/m2d4-refund-matching-evidence-2026-09-09')
sql=(root/'supabase/migrations/20261006000001_work_program_refund_matches.sql').read_text()
functions='\n'.join(re.findall(r'CREATE (?:OR REPLACE )?FUNCTION.*?END \$\$;',sql,re.S)).replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION')
cases=[('harmless comment',functions+'\n-- Harmless verification comment',True)]
for name,old,new in [
 ('refund list shape',"row ? 'refundPayments' AND jsonb_typeof(row->'refundPayments') IS DISTINCT FROM 'array'",'false'),
 ('refund source identity lookup',"a->>'id'=match->>'actualVersionId' AND ",''),
 ('refund source kind',"AND a->>'kind'='payment' ",''),
 ('refund approved source',"AND a->>'status'='approved'",''),
 ('refund currency',"actual->>'currency' IS DISTINCT FROM source->'report'->'snapshot'->'baseline'->'content_json'->>'currency'",'false'),
 ('whole cents',"coalesce(match->>'amount','') !~ '^[0-9]{1,12}(\\.[0-9]{1,2})?$'",'false'),
 ('positive refund',"OR (match->>'amount')::numeric<=0",''),
 ('refund evidence',"coalesce(length(trim(row->>'evidence')),0)=0",'false'),
 ('direction conflict',"IF opposite THEN RAISE EXCEPTION 'A physical payment", "IF false THEN RAISE EXCEPTION 'A physical payment"),
 ('other baseline direction',"IF opposite THEN RAISE EXCEPTION 'Another baseline", "IF false THEN RAISE EXCEPTION 'Another baseline"),
 ('physical ceiling',"allocated+reserved>(actual->>'amount')::numeric",'false'),
 ('reservation through reopening',"AND retained.state='approved'", "AND retained.state='draft'"),
 ('version independent reservation',"a.entry_id::text=actual->>'entry_id'", "a.id::text=actual->>'id'"),
 ('late refund closure protection',"(c->'receipts')||coalesce(c->'refundPayments','[]')", "c->'receipts'"),
]:
 assert old in functions,name
 cases.append((name,functions.replace(old,new,1),False))
results=[]
for index,(name,body,survive) in enumerate(cases):
 path=out/'current-mutation.sql';path.write_text(body)
 env={**os.environ,'OPENPLAN_RLS_LIVE_TEST':'1','OPENPLAN_SUPABASE_WORKDIR':'/home/nathaniel/.local/state/openplan/m2d4-refund-matching-verification','M2D4_SQL_REPLACEMENT':str(path)}
 r=subprocess.run(['node','node_modules/vitest/vitest.mjs','run','src/test/work-program-closeout-rls.test.ts','-t','refund matching'],cwd=root,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (out/f'sql-mutation-{index}.log').write_text(r.stdout)
 result={'name':name,'exit':r.returncode,'expected':'survived' if survive else 'detected','matched':(r.returncode==0)==survive}
 results.append(result);(out/'sql-mutations.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(result),flush=True)
 if not result['matched']:raise SystemExit(1)
