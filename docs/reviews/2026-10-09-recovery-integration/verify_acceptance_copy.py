import json,subprocess
from pathlib import Path
p=Path('/home/nathaniel/.local/state/openplan/recovery-integration-acceptance-8611f4af');s=json.loads((p/'state.json').read_text())
def sql(database,q):
 r=subprocess.run(['docker','exec','-i',s['container'],'psql','-U','supabase_admin','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1'],input=q,text=True,capture_output=True,timeout=60)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def quote(v):return '"'+v.replace('"','""')+'"'
rows=json.loads(sql(s['sourceDatabase'],"SELECT json_agg(t) FROM (SELECT n.nspname AS schema,c.relname AS name,array_agg(a.attname ORDER BY a.attnum) AS columns FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname IN ('public','auth','storage') AND c.relkind='r' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e') GROUP BY n.nspname,c.relname ORDER BY n.nspname,c.relname) t;"))
queries=[]
for row in rows:
 table=quote(row['schema'])+'.'+quote(row['name']);columns=','.join(quote(c) for c in row['columns'])
 queries.append("SELECT json_build_object('table','"+row['schema']+'.'+row['name']+"','rows',count(*),'md5',md5(coalesce(string_agg(to_jsonb(r)::text,E'\\n' ORDER BY to_jsonb(r)::text),''))) FROM (SELECT "+columns+' FROM '+table+') r;')
q='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\n'+'\n'.join(queries)+'\nCOMMIT;'
before=sql(s['sourceDatabase'],q);after=sql(s['database'],q)
assert before==after,'Restored original columns or rows differ'
assert sql(s['sourceDatabase'],q)==before,'Source changed during comparison'
assert sql(s['database'],'-- harmless comment\n'+q)==after
changed=sql(s['database'],"BEGIN; UPDATE public.projects SET name=name || ' [rollback control]';\n"+'\n'.join(queries)+'\nROLLBACK;')
assert changed!=after,'Changed project name was not detected'
assert sql(s['database'],q)==after,'Mutation did not roll back'
result={'harmlessCommentMatches':True,'changedProjectNameRefused':True,'mutationRolledBack':True,'sourceDatabase':s['sourceDatabase'],'targetDatabase':s['database'],'tablesCompared':len(rows),'rowsCompared':sum(json.loads(line)['rows'] for line in before.splitlines()),'originalColumnValuesMatch':True,'sourceStableAcrossComparison':True,'method':'Sorted JSON row counts and MD5 across original columns, repeatable-read transactions; excludes extension-owned relations.'}
(p/'copy-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result))
