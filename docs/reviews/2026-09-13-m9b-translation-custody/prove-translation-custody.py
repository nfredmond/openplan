from pathlib import Path
import os,subprocess, hashlib, json
source=Path(__file__).resolve().parent
root=Path(os.environ["OPENPLAN_TRANSLATION_PROBE_EVIDENCE"]).resolve()
if root.is_relative_to(source.parents[2]):
 raise ValueError("Evidence must be outside the repository")
root.mkdir(parents=True,exist_ok=True)
base=['docker','exec','-i','supabase_db_openplan-restore-target-2026091050','psql','-U','postgres','-d','postgres','-X','-At','-v','ON_ERROR_STOP=1']
query="SELECT pg_get_functiondef('public.capture_engagement_configuration(uuid)'::regprocedure);"
def read(): return subprocess.run(base,input=query,text=True,capture_output=True,check=True).stdout
original=read()
probe=(source/'translation-custody-probe.sql').read_text()
assert original.count("t.entity_type='campaign'")==1
cases=[('baseline',None,True),('harmless-comment',original.replace('BEGIN','BEGIN\n-- Harmless custody inventory control.',1),True),('drop-campaign-translation',original.replace("t.entity_type='campaign'",'false'),False)]
results=[]
for name,definition,expected in cases:
 sql=probe if definition is None else probe.replace('BEGIN;\n','BEGIN;\n'+definition+';\n',1)
 run=subprocess.run(base,input=sql,text=True,capture_output=True)
 (root/f'translation-custody-{name}.log').write_text(run.stdout+run.stderr)
 restored=read()==original
 actual=run.returncode==0
 result={'case':name,'expected_success':expected,'exit_code':run.returncode,'matched':actual==expected,'original_function_restored':restored}
 if not expected: result['failed_for_missing_campaign_snapshot']='query returned no rows' in run.stderr
 results.append(result)
 assert result['matched'] and restored and (expected or result['failed_for_missing_campaign_snapshot']), result
report={'container':'supabase_db_openplan-restore-target-2026091050','database':'postgres','function_sha256':hashlib.sha256(original.encode()).hexdigest(),'cases':results}
(root/'translation-custody-mutations.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report))
