import hashlib,json,subprocess
from pathlib import Path
review=Path(__file__).resolve().parent
root=review.parents[2]
migration=root/'openplan/supabase/migrations/20261014000002_engagement_response_history_reader.sql'
original=migration.read_text(); probe=(review/'reader-probe.sql').read_text()
command=['docker','exec','-i','supabase_db_openplan-restore-target-2026091050','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-q']
assert subprocess.check_output(command+['-Atc',"SELECT to_regprocedure('public.read_engagement_response_history(uuid)') IS NULL"],text=True).strip()=='t','Requires unapplied reader migration'
cases=[
 ('harmless-comment',original+'\n-- Harmless comment.\n',None),
 ('cap-history',original.replace('public.engagement_response_history h','(SELECT * FROM public.engagement_response_history LIMIT 1000) h'),'READER: complete 1005 history copies'),
 ('wrong-checksum',original.replace("'record_sha256', h.record_sha256","'record_sha256', repeat('a',64)"),'READER: exact retained checksum'),
 ('reverse-revisions',original.replace('h.response_id, h.revision','h.response_id, h.revision DESC'),'READER: removed original and ordered corrections'),
 ('bypass-rls',original.replace('SECURITY INVOKER','SECURITY DEFINER'),'READER: outsider denied'),
 ('allow-anonymous',original+'\nGRANT EXECUTE ON FUNCTION public.read_engagement_response_history(uuid) TO anon;\n','READER: anonymous execution'),
]
results=[]
for name,sql,expected in cases:
 run=subprocess.run(command,input='BEGIN;\n'+sql+'\n'+probe+'\nROLLBACK;',capture_output=True,text=True,timeout=60)
 matched=run.returncode==0 if expected is None else run.returncode!=0 and expected in run.stderr
 results.append({'name':name,'outcome':'survived' if run.returncode==0 else 'killed','matched':matched,'expected':expected,'stderr':run.stderr[-1200:]})
 (review/'reader-sql-mutations.json').write_text(json.dumps({'stack':'openplan-restore-target-2026091050','migrationSha256':hashlib.sha256(original.encode()).hexdigest(),'results':results},indent=2)+'\n')
 print(name,results[-1]['outcome'],matched,flush=True)
 if not matched: raise RuntimeError(run.stderr)
assert subprocess.check_output(command+['-Atc',"SELECT to_regprocedure('public.read_engagement_response_history(uuid)') IS NULL"],text=True).strip()=='t'
