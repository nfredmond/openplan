import pathlib,subprocess,json,hashlib
root=pathlib.Path('/tmp/owp-review-a/final'); container='supabase_db_owp-independent-review-a-final'
def sql(s):
 p=subprocess.run(['docker','exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],input=s,text=True,capture_output=True)
 if p.returncode: raise RuntimeError(p.stderr)
 return p.stdout.strip()
seed="""
CREATE SCHEMA review_a;
CREATE TABLE review_a.identities(k text primary key,id uuid not null);
DO $$ DECLARE a uuid:=gen_random_uuid(); reviewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); w uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); d uuid:=gen_random_uuid(); evidence uuid:=gen_random_uuid(); s public.program_work_program_sources; r public.program_work_program_revisions; j public.kb_ocr_jobs; token uuid:=gen_random_uuid(); BEGIN
 INSERT INTO auth.users(id,email) VALUES(a,a||'@example.test'),(reviewer,reviewer||'@example.test'),(outsider,outsider||'@example.test'),(viewer,viewer||'@example.test');
 INSERT INTO public.workspaces(id,name,slug) VALUES(w,'Reviewer A synthetic upgrade only',w::text);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(w,a,'owner'),(w,reviewer,'member'),(w,viewer,'viewer');
 INSERT INTO public.programs(id,workspace_id,title,program_type,cycle_name) VALUES(p,w,'Synthetic predecessor OWP, no agency authority','other','2026 engineering');
 INSERT INTO public.kb_documents(id,workspace_id,title,source_kind,checksum,page_count,status,storage_ref,byte_size) VALUES(d,w,'Synthetic source PDF','uploaded_pdf',repeat('a',64),1,'stored','storage://kb-documents/synthetic-original',101),(evidence,w,'Synthetic authority fixture, not an actual decision','uploaded_pdf',repeat('b',64),1,'stored','storage://kb-documents/synthetic-evidence',102);
 SELECT * INTO s FROM public.attach_program_work_program_source(p,a,d,repeat('a',64),'predecessor','https://example.test/source',1,'{"pages":[{"page":1,"text":"Synthetic original amount 125.50"}]}');
 SELECT * INTO r FROM public.save_program_work_program_revision(p,a,0,gen_random_uuid(),jsonb_build_object('schemaVersion',1,'agency','Synthetic','elements',jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'source',jsonb_build_object('sourceId',s.id),'budget',125.50))));
 SELECT * INTO r FROM public.save_program_work_program_revision(p,a,1,gen_random_uuid(),r.content_json||'{"internalNote":"PRIVATE PREPARATION SENTINEL"}');
 SELECT * INTO j FROM public.enqueue_work_program_export(p,2,'html',a);
 SELECT * INTO j FROM public.claim_work_program_export(token);
 PERFORM public.finish_work_program_export(j.id,token,repeat('c',64),123,'storage://kb-documents/'||w||'/'||j.document_id||'/'||repeat('c',64)||'.html','synthetic-metadata-only');
 PERFORM public.enqueue_work_program_export(p,2,'xlsx',a);
 INSERT INTO review_a.identities VALUES('owner',a),('reviewer',reviewer),('outsider',outsider),('viewer',viewer),('workspace',w),('program',p),('document',d),('evidence',evidence),('source',s.id),('revision',r.id);
END $$;
"""
if sql("SELECT to_regclass('review_a.identities') IS NOT NULL;")!='t': sql(seed)
if sql("SELECT count(*) FROM public.program_work_program_extractions;")=='0':
 sql("""DO $$ DECLARE a uuid; d uuid; w uuid; s uuid; j public.kb_ocr_jobs; x uuid; BEGIN
 SELECT id INTO a FROM review_a.identities WHERE k='owner'; SELECT id INTO d FROM review_a.identities WHERE k='document'; SELECT id INTO w FROM review_a.identities WHERE k='workspace'; SELECT id INTO s FROM review_a.identities WHERE k='source';
 SELECT * INTO j FROM public.enqueue_kb_extraction(d,a,gen_random_uuid()::text,'text',ARRAY['eng'],'http://127.0.0.1:58321/synthetic-no-worker');
 INSERT INTO public.kb_document_extractions(workspace_id,document_id,job_id,document_checksum,pages_json,page_count,content_sha256,engine_json) VALUES(w,d,j.id,repeat('a',64),'[{"page":1,"text":"Synthetic extraction"}]',1,repeat('d',64),'{"name":"synthetic"}') RETURNING id INTO x;
 PERFORM public.version_work_program_extraction(s,a,x,gen_random_uuid(),'{"pageCount":1,"elements":[]}');
 END $$;""")
tables=['program_work_program_sources','program_work_program_revisions','program_work_program_extractions','kb_documents','kb_ocr_jobs']
def snapshot():
 out={}
 for table in tables:
  rows=json.loads(sql(f"SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM public.{table} t;"))
  for row in rows:
   for key in ['amendment_baseline_id','work_program_packet_id','work_program_packet_format']: row.pop(key,None)
  out[table]=rows
 return out
before=snapshot();(root/'before.json').write_text(json.dumps(before,indent=2))
assert all(before[t] for t in tables),'Nonempty seeded tables required'
assert len(before['program_work_program_revisions'])==2
for file in sorted((root/'captured').glob('*.sql')): sql('BEGIN;\n'+file.read_text()+'\nCOMMIT;')
after=snapshot();(root/'after.json').write_text(json.dumps(after,indent=2));assert before==after,'Upgrade mutated predecessor records'
assert sql("SELECT count(*) FROM public.program_work_program_workflow;")== '0'
assert sql("SELECT count(*) FROM public.program_work_program_events;")== '0'
assert sql("SELECT count(*) FROM public.program_work_program_reviews;")== '0'
assert sql("SELECT count(*) FROM public.program_work_program_packets;")== '0'
assert sql("SELECT count(*) FROM public.program_work_program_revisions WHERE amendment_baseline_id IS NOT NULL;")== '0'
result={'predecessor':'3004393820ec6f2b05f7a00136bf887914da48b4','container':container,'table_counts':{t:len(before[t]) for t in tables},'record_sha256':hashlib.sha256(json.dumps(before,sort_keys=True).encode()).hexdigest(),'unchanged':True,'no_authority_backfilled':True,'migrations':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in (root/'captured').glob('*.sql')}}
(root/'upgrade-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
