from pathlib import Path
import json,subprocess,os
base=Path('/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority')
query="""SELECT jsonb_build_object(
'report',(SELECT to_jsonb(r) FROM public.reports r WHERE id='e0aab60e-a9ff-4d51-a98e-4f01e99ceb45'),
'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.land_use_plan_versions v WHERE plan_id='fb049e81-a3a7-4ae0-be50-752410899be8'),
'artifacts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.report_artifacts a WHERE report_id='e0aab60e-a9ff-4d51-a98e-4f01e99ceb45'),
'decisions',(SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.land_use_plan_decisions d WHERE plan_id='fb049e81-a3a7-4ae0-be50-752410899be8'),
'gisVersion',(SELECT jsonb_build_object('id',id,'workspace_id',workspace_id,'feature_hash',feature_hash,'ingest_status',ingest_status,'feature_count',feature_count) FROM public.workspace_gis_layer_versions WHERE id='caa598d2-9916-4527-873d-ae9eb341fda0')
);"""
result=subprocess.check_output(['docker','exec','-e','PGOPTIONS=-c default_transaction_read_only=on','supabase_db_openplan-restore-target-2026091050','psql','-XAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',query],text=True)
native=json.loads(result)
p=base/'report-map-native-private.json';p.write_text(json.dumps(native,indent=2)+'\n');os.chmod(p,0o600)
previous=json.loads((base/'report-adoption-native-private.json').read_text())
checks={}
for key,value in previous.items():
 now=native[key]
 if isinstance(value,list):value=sorted(value,key=lambda x:x['id']);now=sorted(now,key=lambda x:x['id'])
 checks[key+'Unchanged']=now==value
assert all(checks.values()),checks
checks['gisVersion']=native['gisVersion']
checks['boundary']='Read-only SQL comparison. No new producer writes, native nonempty geography, historical native or foreign-workspace browser case.'
(base/'report-map-native-comparison.json').write_text(json.dumps(checks,indent=2)+'\n')
print(json.dumps(checks))
