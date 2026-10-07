from pathlib import Path
import json,subprocess,os,sys
base=Path('/home/nathaniel/.local/state/openplan/t3-restart-recovery-20261006/land-use-authority')
query="""SELECT jsonb_build_object(
'readableReportCount',(SELECT count(*) FROM public.reports WHERE land_use_plan_id='fb049e81-a3a7-4ae0-be50-752410899be8' AND report_type='land_use_plan_implementation_report'),
'report',(SELECT to_jsonb(r) FROM public.reports r WHERE id='ad1a3d1e-925a-44da-a003-9b784689b29a'),
'versions',(SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id) FROM public.land_use_plan_versions v WHERE plan_id='fb049e81-a3a7-4ae0-be50-752410899be8'),
'artifacts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.report_artifacts a WHERE report_id='ad1a3d1e-925a-44da-a003-9b784689b29a'),
'implementationReports',(SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.land_use_plan_implementation_reports i WHERE plan_id='fb049e81-a3a7-4ae0-be50-752410899be8'),
'actions',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM public.land_use_plan_implementation_actions a WHERE version_id='da327c80-ee2d-456b-b4db-263b57ac50ce')
);"""
result=subprocess.check_output(['docker','exec','-e','PGOPTIONS=-c default_transaction_read_only=on','supabase_db_openplan-restore-target-2026091050','psql','-XAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',query],text=True)
native=json.loads(result)
p=base/('implementation-report-'+sys.argv[1]+'-native-private.json');assert not p.exists(),p
p.write_text(json.dumps(native,indent=2)+'\n');os.chmod(p,0o600)
assert len(native['artifacts'])==1 and len(native['implementationReports'])==1
print(json.dumps({'reportId':native['report']['id'],'implementationReportId':native['implementationReports'][0]['id'],'artifactId':native['artifacts'][0]['id'],'savedStatus':native['implementationReports'][0]['action_status_snapshot'][0]['status'],'currentStatus':native['actions'][0]['status'],'contentHash':native['implementationReports'][0]['content_hash']}))
