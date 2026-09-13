"""Unapplied Activity summary over installed response queue, all fixtures rolled back."""
import hashlib
import json
import subprocess
from pathlib import Path
root = Path(__file__).resolve().parent
migration = root.parents[2] / 'openplan/supabase/migrations/20261014000004_engagement_delivery_summary.sql'
original = migration.read_text()
probe = (root/'broadcast-probe.sql').read_text()+'\n'+(root/'activity-summary-probe.sql').read_text()
command = ['docker','exec','-i','supabase_db_openplan-restore-target-2026091050','psql','-X','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1']
existing = subprocess.run(command+['-c', "SELECT pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='read_engagement_email_delivery_summary'"], capture_output=True, check=True).stdout
if existing:
 original = original.replace('CREATE FUNCTION public.read_engagement_email_delivery_summary', 'CREATE OR REPLACE FUNCTION public.read_engagement_email_delivery_summary', 1)
cases = [
 ('baseline',None,None,None),
 ('harmless-comment','Complete staff-only campaign outcomes','Complete campaign outcomes for staff',None),
 ('foreign-campaign','WHERE o.campaign_id=p_campaign','WHERE true','Complete campaign count lost rows or included another campaign'),
 ('lost-durable-state',"COALESCE(m.state,o.status)",'o.status','Durable states were replaced by legacy queued counts'),
 ('raw-transport',"THEN transport ELSE 'other' END","THEN transport ELSE transport END",'Private participant or provider strings escaped the aggregate'),
 ('raw-error',"'A delivery failure was recorded. This does not establish whether the message reached an inbox.'","'private@example.invalid'",'Private participant or provider strings escaped the aggregate'),
 ('lost-queued-publication',"'queued',count(*) FILTER(WHERE state='queued'),\n    'prepared'","'queued',0,\n    'prepared'",'Unprepared publication was invisible'),
 ('lost-no-share',"'noShareToken',count(*) FILTER(WHERE state='no_share_token')","'noShareToken',0",'Missing-share preparation was invisible'),
 ('lost-cancelled',"'cancelled',count(*) FILTER(WHERE state='cancelled'),\n    'noShareToken'","'cancelled',0,\n    'noShareToken'",'Cancelled preparation was invisible'),
 ('viewer-permitted',"m.role IN ('owner','admin','member')","m.role IN ('owner','admin','member','viewer')",'Viewer read private delivery outcomes'),
 ('another-membership-permitted',"m.user_id=auth.uid() AND m.role IN ('owner','admin','member')","m.role IN ('owner','admin','member')",'Viewer read private delivery outcomes'),
 ('anonymous-execute','FROM PUBLIC,anon;','FROM PUBLIC;','Anonymous delivery summary execution permitted'),
]
# A GRANT is needed to expose anonymous execution; removing REVOKE alone still
# inherits the PUBLIC revocation and is therefore a no-op, not a targeted fault.
cases[-1]=('anonymous-execute', 'TO authenticated;', 'TO authenticated,anon;', 'Anonymous delivery summary execution permitted')
results=[]
for name,before,after,expected in cases:
 changed=original
 if before:
  assert original.count(before)==1,name
  changed=original.replace(before,after)
 run=subprocess.run(command,input="BEGIN; SET LOCAL statement_timeout='30s';\n"+changed+'\n'+probe+'\nROLLBACK;',text=True,capture_output=True,timeout=45)
 matched=run.returncode==0 if expected is None else run.returncode!=0 and expected in run.stderr
 results.append({'name':name,'matched':matched,'exit':run.returncode,'expected':expected,'outcome':'survived' if run.returncode==0 else 'killed','sqlSha256':hashlib.sha256(changed.encode()).hexdigest(),'diagnostic':None if matched else run.stderr[-1200:]})
 (root/'activity-sql-mutations.json').write_text(json.dumps(results,indent=2)+'\n')
 print(name,results[-1]['outcome'],matched,flush=True)
 assert matched,name
check=subprocess.run(command+['-c',"SELECT pg_get_functiondef(oid) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='read_engagement_email_delivery_summary'"],capture_output=True,check=True)
assert check.stdout==existing,'Summary function changed after rolled-back probes'
