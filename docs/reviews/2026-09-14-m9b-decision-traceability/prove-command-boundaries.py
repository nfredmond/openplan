"""Native command grants and malformed intent checks; every transaction rolls back."""
from pathlib import Path
import importlib.util,json,hashlib,time
review=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('link_boundaries',review/'prove-decision-links.py');link=importlib.util.module_from_spec(spec);spec.loader.exec_module(link)
private=link.fixture.private/('command-boundaries-'+str(time.time_ns()));private.mkdir(mode=0o700)
original=link.original
checks=link.root_save
preview="(SELECT value->>'contextSha256' FROM decision_probe WHERE key='preview')"
for name,query in [
 ('missing-request',f"SELECT pg_temp.link(NULL,'link',NULL,{preview},'SYNTHETIC reason')"),
 ('missing-operation',f"SELECT pg_temp.link('{link.ids['invalid']}',NULL,NULL,{preview},'SYNTHETIC reason')"),
 ('unknown-operation',f"SELECT pg_temp.link('{link.ids['invalid']}','erase',NULL,{preview},'SYNTHETIC reason')"),
 ('missing-context',f"SELECT pg_temp.link('{link.ids['invalid']}','link',NULL,NULL,'SYNTHETIC reason')"),
 ('invalid-context',f"SELECT pg_temp.link('{link.ids['invalid']}','link',NULL,'INVALID','SYNTHETIC reason')"),
 ('missing-reason',f"SELECT pg_temp.link('{link.ids['invalid']}','link',NULL,{preview},NULL)"),
 ('long-reason',f"SELECT pg_temp.link('{link.ids['invalid']}','link',NULL,{preview},repeat('x',2001))"),
 ('self-predecessor',f"SELECT pg_temp.link('{link.ids['invalid']}','refresh','{link.ids['invalid']}',{preview},'SYNTHETIC reason')"),
]: checks+=link.expect_error(query,'22023',name+' was not refused')
# Request scope is fixed by native arguments, not by a caller-provided workspace.
for name,response,decision in [('missing-response','NULL',"'"+link.f['decision']+"'"),('missing-decision',"'"+link.f['response']+"'",'NULL')]:
 query=f"SELECT write_engagement_response_decision_link('{link.f['campaign']}',{response},{decision},'{link.ids['invalid']}','link',NULL,{preview},'SYNTHETIC reason')"
 checks+=link.expect_error(query,'22023',name+' was not refused')
checks+="SELECT set_config('openplan.probe_context_sha',"+preview+",true);"
for role in ['anon','service_role']:
 checks+='RESET ROLE; SET LOCAL ROLE '+role+';'
 checks+=link.expect_error(link.root_command.replace(preview,"current_setting('openplan.probe_context_sha')"),'42501',role+' command execution was not refused')
checks+='RESET ROLE; SET LOCAL ROLE authenticated;'
insert=f"INSERT INTO engagement_response_decision_links(id,workspace_id,campaign_id,response_id,decision_id,project_id,predecessor_id,operation,actor_id,reason,payload_json,context_text) SELECT '{link.ids['invalid']}',workspace_id,campaign_id,response_id,decision_id,project_id,id,'refresh',actor_id,reason,payload_json||jsonb_build_object('operation','refresh','predecessorId',id),context_text FROM engagement_response_decision_links WHERE id='{link.ids['root']}'"
checks+=link.expect_error(insert,'42501','Direct staff insert was not refused')
checks+=f"SELECT pg_temp.assert_true((SELECT count(*)=1 FROM engagement_response_decision_links WHERE campaign_id='{link.f['campaign']}'),'Boundary refusals changed retained records');"
checks+="SELECT jsonb_build_object('boundaryCases',13,'retainedRecords',1);"


def run(body):
 result=link.fixture.sql("BEGIN; SET LOCAL statement_timeout='20s';"+link.fixture.original+body+link.fixture.seed+link.helpers+checks+'ROLLBACK;')
 assert result.returncode==0,result.stderr
 assert json.loads(result.stdout.splitlines()[-1])=={'boundaryCases':13,'retainedRecords':1}


mutations=[
 ('anonymous-command-grant','TO authenticated;','TO authenticated, anon;','anon command execution was not refused'),
 ('service-command-grant','TO authenticated;','TO authenticated, service_role;','service_role command execution was not refused'),
 ('direct-staff-insert',"CREATE POLICY engagement_response_decision_link_staff_read", "GRANT INSERT ON public.engagement_response_decision_links TO authenticated;\nCREATE POLICY synthetic_direct_insert ON public.engagement_response_decision_links FOR INSERT TO authenticated WITH CHECK(true);\nCREATE POLICY engagement_response_decision_link_staff_read",'Direct staff insert was not refused'),
 ('malformed-context',' OR p_expected_context_sha256 !~ \'^[0-9a-f]{64}$\'','','invalid-context was not refused'),
 ('self-predecessor','OR p_request = p_predecessor OR ','OR ','self-predecessor was not refused'),
]
results=[]
try:
 for name,body,expected in [('baseline',original,None),('harmless-comment',original+'\n-- Harmless boundary comment.\n',None)]+[(name,original.replace(old,new,1),expected) for name,old,new,expected in mutations]:
  if expected:
   old=next(old for key,old,_,_ in mutations if key==name)
   # TO authenticated occurs in both the read grant and final command grant.
   if name.endswith('command-grant'):
    body=original.rsplit(old,1)[0]+next(new for key,_,new,_ in mutations if key==name)+original.rsplit(old,1)[1]
   else: assert original.count(old)==1,name
  try: run(body)
  except AssertionError as error:
   (private/(name+'.log')).write_text(str(error)+'\n');assert expected and expected in str(error),str(error); outcome='killed'
  else: assert expected is None,'Mutation survived: '+name;outcome='survived'
  results.append({'case':name,'outcome':outcome,'expectedFailure':expected});print(name,outcome,flush=True)
finally:
 restored=link.fixture.state()=='339:20261014000020\nt'
 (review/'decision-command-boundaries-results.json').write_text(json.dumps({'privateEvidence':str(private),'candidateSha256':hashlib.sha256(link.candidate.read_bytes()).hexdigest(),'contextCandidateSha256':hashlib.sha256(link.fixture.candidate.read_bytes()).hexdigest(),'results':results,'candidateAndFixturesRolledBack':restored,'limits':'Native serial command grants and malformed-input checks. No live HTTP, browser recovery or public disclosure.'},indent=2)+'\n');assert restored
