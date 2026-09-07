import pathlib,subprocess,json,re,hashlib
root=pathlib.Path('/tmp/owp-review-a'); container='supabase_db_owp-independent-review-a'
src=(root/'captured/20260909000001_work_program_review.sql').read_text(); pkt=(root/'captured/20260909000002_work_program_review_packets.sql').read_text()
def definition(name,source=src):
 match=re.search(r'CREATE(?: OR REPLACE)? FUNCTION public\.'+name+r'\(.*?END \$\$;',source,re.S)
 assert match,name
 return match.group().replace('CREATE FUNCTION','CREATE OR REPLACE FUNCTION',1)
rpc=definition('record_work_program_event'); packet=definition('enqueue_work_program_packet',pkt)
helpers="""
CREATE FUNCTION pg_temp.command(k text, p uuid, r uuid) RETURNS jsonb LANGUAGE SQL AS $$ SELECT jsonb_build_object('kind',k,'requestId',gen_random_uuid(),'expectedSequence',coalesce((SELECT sequence FROM public.program_work_program_workflow WHERE program_id=p),0),'expectedRevision',(SELECT max(revision) FROM public.program_work_program_revisions WHERE program_id=p),'revisionId',r,'revisionHash',(SELECT content_sha256 FROM public.program_work_program_revisions WHERE id=r),'note','SYNTHETIC ENGINEERING ONLY','visibility','internal','reviewerIds','[]'::jsonb,'documentIds','[]'::jsonb,'dueOn',NULL,'evidenceDate',NULL,'authority','','scope','','targetEventId',NULL) $$;
"""
start="""DO $probe$ DECLARE a uuid; b uuid; outsider uuid; viewer uuid; p uuid; w uuid; d uuid; r public.program_work_program_revisions; r2 public.program_work_program_revisions; e public.program_work_program_events; adoption public.program_work_program_events; c jsonb; saved jsonb; j public.kb_ocr_jobs; j2 public.kb_ocr_jobs; snap jsonb; token uuid:=gen_random_uuid(); BEGIN
SELECT id INTO a FROM review_a.identities WHERE k='owner';SELECT id INTO b FROM review_a.identities WHERE k='reviewer';SELECT id INTO outsider FROM review_a.identities WHERE k='outsider';SELECT id INTO viewer FROM review_a.identities WHERE k='viewer';SELECT id INTO p FROM review_a.identities WHERE k='program';SELECT id INTO w FROM review_a.identities WHERE k='workspace';SELECT id INTO d FROM review_a.identities WHERE k='evidence';SELECT * INTO r FROM public.program_work_program_revisions WHERE id=(SELECT id FROM review_a.identities WHERE k='revision');
"""
def cmd(k,revision='r',actor='a',extra="'{}'::jsonb"):
 return f"public.record_work_program_event(p,{actor},pg_temp.command('{k}',p,{revision}.id)||{extra})"
evidence="jsonb_build_object('authority','Synthetic recorder','scope','Engineering only, no actual spending','evidenceDate',current_date,'documentIds',jsonb_build_array(d))"
submit="PERFORM "+cmd('submit',extra="jsonb_build_object('reviewerIds',jsonb_build_array(b))")+';'
approve="PERFORM "+cmd('approve',actor='b')+';'
adopt="SELECT * INTO adoption FROM "+cmd('adoption',extra=evidence)+';'
adopted=submit+approve+adopt
amend="PERFORM "+cmd('start_amendment')+"; SELECT * INTO r2 FROM public.program_work_program_revisions WHERE program_id=p ORDER BY revision DESC LIMIT 1;"
def deny(statement,code,label):return f"BEGIN {statement}; RAISE EXCEPTION 'ASSERT_{label}'; EXCEPTION WHEN SQLSTATE '{code}' THEN NULL; END;"
def check(expr,label):return f"IF NOT ({expr}) THEN RAISE EXCEPTION 'ASSERT_{label}'; END IF;"
cases={}
cases['baseline_late_authority']=adopted+amend+'PERFORM '+cmd('external_acceptance',extra=evidence)+';PERFORM '+cmd('spending_authorization',extra=evidence)+';'+check("(SELECT effective_revision_id=r.id FROM public.program_work_program_workflow WHERE program_id=p)",'BASELINE_CHANGED')+deny('PERFORM '+cmd('spending_authorization',revision='r2',extra=evidence),'PT409','PENDING_AUTHORIZED')
cases['sequence']=deny('PERFORM '+cmd('comment',extra="'{\"expectedSequence\":99}'"),'PT409','STALE_SEQUENCE')
cases['hash']=deny('PERFORM '+cmd('comment',extra="jsonb_build_object('revisionHash',repeat('0',64))"),'PT409','WRONG_HASH')
cases['role']=adopted+deny('PERFORM '+cmd('spending_authorization',actor='b',extra=evidence),'42501','MEMBER_AUTHORITY')
cases['independent']=deny('PERFORM '+cmd('submit',extra="jsonb_build_object('reviewerIds',jsonb_build_array(a))"),'42501','SELF_REVIEW')
cases['retry']="saved:=pg_temp.command('comment',p,r.id);SELECT * INTO e FROM public.record_work_program_event(p,a,saved);PERFORM public.record_work_program_event(p,a,saved);"+check("(SELECT count(*)=1 FROM public.program_work_program_events WHERE program_id=p)",'RETRY_DUPLICATE')+deny("PERFORM public.record_work_program_event(p,a,saved||'{\"note\":\"changed\"}')",'PT409','CHANGED_RETRY')
cases['revocation']="saved:=pg_temp.command('comment',p,r.id);PERFORM public.record_work_program_event(p,a,saved);UPDATE public.workspace_members SET role='owner' WHERE workspace_id=w AND user_id=b;DELETE FROM public.workspace_members WHERE workspace_id=w AND user_id=a;"+deny("PERFORM public.record_work_program_event(p,a,saved)",'42501','REVOKED_RETRY')
cases['disclosure']=submit+"PERFORM "+cmd('comment',extra="'{\"note\":\"PRIVATE REVIEW SENTINEL\"}'")+";SELECT * INTO j FROM public.enqueue_work_program_packet(p,r.revision,2,'public',true,'html',a);SELECT snapshot INTO snap FROM public.program_work_program_packets WHERE id=(SELECT work_program_packet_id FROM public.kb_documents WHERE id=j.document_id);"+check("snap::text NOT LIKE '%PRIVATE REVIEW SENTINEL%'",'PRIVATE_LEAK')+"SELECT * INTO j FROM public.enqueue_work_program_packet(p,r.revision,2,'internal',false,'html',a);SELECT snapshot INTO snap FROM public.program_work_program_packets WHERE id=(SELECT work_program_packet_id FROM public.kb_documents WHERE id=j.document_id);"+check("snap::text LIKE '%PRIVATE REVIEW SENTINEL%'",'INTERNAL_OMITTED')
cases['public_review']=deny("PERFORM public.enqueue_work_program_packet(p,r.revision,0,'public',false,'html',a)",'42501','UNREVIEWED_COPY')
cases['evidence']=adopted+deny("UPDATE public.kb_documents SET checksum=repeat('e',64) WHERE id=d",'23514','EVIDENCE_CHANGED')+deny("DELETE FROM public.kb_documents WHERE id=d",'23503','EVIDENCE_DELETED')
cases['withdrawal']=adopted+'PERFORM '+cmd('withdraw_authority',extra=evidence+"||jsonb_build_object('targetEventId',adoption.id)")+';'+check("(SELECT effective_revision_id IS NULL FROM public.program_work_program_workflow WHERE program_id=p)",'WITHDRAW_BASELINE')+check("(SELECT count(*)=1 FROM public.program_work_program_events WHERE id=adoption.id)",'WITHDRAW_HISTORY')+deny('PERFORM '+cmd('spending_authorization',extra=evidence),'PT409','WITHDRAW_AUTHORIZED')
cases['stale_review']=submit+"SELECT * INTO r2 FROM public.save_program_work_program_revision(p,a,r.revision,gen_random_uuid(),r.content_json||'{\"changed\":true}');"+deny('PERFORM '+cmd('approve',actor='b'),'PT409','STALE_APPROVAL')+check("NOT EXISTS(SELECT 1 FROM public.program_work_program_reviews WHERE program_id=p AND status='pending')",'STALE_TASK')
cases['return_resubmit']=submit+'PERFORM '+cmd('return',actor='b')+';'+check("EXISTS(SELECT 1 FROM public.program_work_program_reviews WHERE program_id=p AND assignee_user_id=a AND status='returned' AND due_on IS NULL)",'AUTHOR_RETURN_TASK')+"SELECT * INTO r2 FROM public.save_program_work_program_revision(p,a,r.revision,gen_random_uuid(),r.content_json||'{\"changed\":true}');PERFORM "+cmd('submit',revision='r2',extra="jsonb_build_object('reviewerIds',jsonb_build_array(b))")+';'+check("(SELECT count(*)=1 FROM public.program_work_program_reviews WHERE program_id=p AND status IN ('pending','returned'))",'DUPLICATE_TASK')
cases['rls']=submit+"PERFORM set_config('request.jwt.claim.sub',a::text,true);SET LOCAL ROLE authenticated;"+check("EXISTS(SELECT 1 FROM public.program_work_program_events WHERE program_id=p)",'MEMBER_READ')+deny("UPDATE public.program_work_program_events SET kind='adoption' WHERE program_id=p",'42501','DIRECT_WRITE')+deny("PERFORM public.record_work_program_event(p,a,'{}')",'42501','DIRECT_RPC')+"RESET ROLE;PERFORM set_config('request.jwt.claim.sub',outsider::text,true);SET LOCAL ROLE authenticated;"+check("NOT EXISTS(SELECT 1 FROM public.program_work_program_events WHERE program_id=p)",'OUTSIDER_EVENTS')+check("NOT EXISTS(SELECT 1 FROM public.program_work_program_reviews WHERE program_id=p)",'OUTSIDER_REVIEWS')+check("NOT EXISTS(SELECT 1 FROM public.program_work_program_workflow WHERE program_id=p)",'OUTSIDER_STATE')+"RESET ROLE;"
cases['packet_recovery']="SELECT * INTO j FROM public.enqueue_work_program_packet(p,r.revision,0,'internal',false,'html',a);SELECT * INTO j2 FROM public.enqueue_work_program_packet(p,r.revision,0,'internal',false,'html',a);"+check("j2.id=j.id",'PACKET_RETRY_DUPLICATE')+"UPDATE public.kb_ocr_jobs SET status='failed',cancel_requested=true WHERE id=j.id;SELECT * INTO j2 FROM public.enqueue_work_program_packet(p,r.revision,0,'internal',false,'html',a);"+check("j2.id=j.id AND j2.status='queued' AND NOT j2.cancel_requested",'FAILED_PACKET_RECOVERY')+"UPDATE public.kb_ocr_jobs SET status='running',lease_token=token,lease_until=now()+interval '10 minutes' WHERE id=j.id;"+deny("PERFORM public.finish_work_program_export(j.id,gen_random_uuid(),repeat('f',64),123,'storage://kb-documents/'||w||'/'||j.document_id||'/'||repeat('f',64)||'.html','synthetic')",'PT409','FOREIGN_LEASE')+"PERFORM public.finish_work_program_export(j.id,token,repeat('f',64),123,'storage://kb-documents/'||w||'/'||j.document_id||'/'||repeat('f',64)||'.html','synthetic');"+check("(SELECT status='succeeded' FROM public.kb_ocr_jobs WHERE id=j.id)",'PACKET_FINISH')+deny("UPDATE public.kb_documents SET checksum=repeat('e',64) WHERE id=j.document_id",'23514','PACKET_BYTES_CHANGED')
cases['public_role']=deny("PERFORM public.enqueue_work_program_packet(p,r.revision,0,'public',true,'html',b)",'42501','MEMBER_PUBLIC_COPY')
cases['stale_packet']=deny("PERFORM public.enqueue_work_program_packet(p,r.revision,99,'internal',false,'html',a)",'PT409','STALE_PACKET')
# Every probe starts from the same retained predecessor and rolls back completely.
def run(name,body,replacement=''):
 sql='BEGIN;'+replacement+helpers+start+body+"END $probe$; SELECT 'PROBE_REACHED'; ROLLBACK;"
 (root/(name+'.sql')).write_text(sql)
 result=subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],input=sql,text=True,capture_output=True)
 (root/(name+'.log')).write_text(result.stdout+result.stderr)
 return result.returncode==0 and 'PROBE_REACHED' in result.stdout,result.stderr
results=[]
def record(name,ok,detail):
 results.append({'name':name,'passed':ok,'detail':detail});print(name,'PASS' if ok else 'FAIL',detail[:160]);(root/'guard-results.json').write_text(json.dumps(results,indent=2))
# Positive control first, before trusting targeted kills.
ok,err=run('noop_survivor',cases['sequence'],rpc.replace('Workflow or revision changed; reload','Workflow changed; reload'));record('noop_survivor',ok,err)
assert ok,'No-op could not survive'
for name,body in cases.items():
 ok,err=run('baseline_'+name,body);record('baseline_'+name,ok,err)
mutations=[
 ('revocation',rpc,'actor_role IS NULL OR ','','ASSERT_REVOKED_RETRY'),
 ('sequence',rpc,"s.sequence<>(p_command->>'expectedSequence')::integer OR ",'','ASSERT_STALE_SEQUENCE'),
 ('hash',rpc," OR r.content_sha256 IS DISTINCT FROM p_command->>'revisionHash'",'','ASSERT_WRONG_HASH'),
 ('role',rpc,"AND actor_role NOT IN ('owner','admin') THEN","AND false THEN",'ASSERT_MEMBER_AUTHORITY'),
 ('independent',rpc,'reviewer=r.created_by OR reviewer=p_actor_id OR ','','ASSERT_SELF_REVIEW'),
 ('retry',rpc,'e.actor_id<>p_actor_id OR e.payload<>p_command','false','ASSERT_CHANGED_RETRY'),
 ('baseline_late_authority',rpc,"IF s.effective_revision_id IS DISTINCT FROM r.id THEN RAISE EXCEPTION 'Authority evidence must name the effective adopted revision'","IF false THEN RAISE EXCEPTION 'Authority evidence must name the effective adopted revision'",'ASSERT_PENDING_AUTHORIZED'),
 ('public_review',packet,'p_public_reviewed IS DISTINCT FROM true','false','ASSERT_UNREVIEWED_COPY'),
 ('disclosure',packet,"(p_audience='internal' OR e.payload->>'visibility'='public')",'true','ASSERT_PRIVATE_LEAK'),
 ('withdrawal',rpc,"effective_revision_id=NULL,status='draft'","effective_revision_id=r.id,status='draft'",'ASSERT_WITHDRAW_BASELINE'),
 ('evidence',definition('guard_work_program_review_evidence'),"IF (NEW.workspace_id,NEW.checksum,NEW.storage_ref,NEW.byte_size) IS DISTINCT FROM (OLD.workspace_id,OLD.checksum,OLD.storage_ref,OLD.byte_size)","IF false",'ASSERT_EVIDENCE_CHANGED'),
]
for name,definition_,old,new,expected in mutations:
 assert definition_.count(old)==1,(name,definition_.count(old))
 ok,err=run('mutant_'+name,cases[name],definition_.replace(old,new))
 record('mutant_'+name,not ok and expected in err,err)
assert all(r['passed'] for r in results),'Some checks failed; inspect retained logs'
