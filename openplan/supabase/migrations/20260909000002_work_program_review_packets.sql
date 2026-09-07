-- Review packets are additional immutable snapshots. Preparation exports keep their original identities.
CREATE TABLE public.program_work_program_packets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), program_id uuid NOT NULL REFERENCES public.programs(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 revision_id uuid NOT NULL REFERENCES public.program_work_program_revisions(id), sequence integer NOT NULL,
 audience text NOT NULL CHECK(audience IN ('internal','public')), snapshot jsonb NOT NULL, snapshot_hash text NOT NULL,
 created_by uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(revision_id,sequence,audience)
);
ALTER TABLE public.program_work_program_packets ENABLE ROW LEVEL SECURITY;
CREATE POLICY work_program_packets_read ON public.program_work_program_packets FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id=program_work_program_packets.workspace_id AND wm.user_id=auth.uid()));
REVOKE ALL ON public.program_work_program_packets FROM anon,authenticated,service_role;
GRANT SELECT ON public.program_work_program_packets TO authenticated,service_role;
ALTER TABLE public.kb_documents ADD COLUMN work_program_packet_id uuid REFERENCES public.program_work_program_packets(id);
ALTER TABLE public.kb_documents ADD COLUMN work_program_packet_format text CHECK(work_program_packet_format IN ('html','pdf','xlsx'));
ALTER TABLE public.kb_documents ADD CONSTRAINT work_program_packet_identity CHECK((work_program_packet_id IS NULL)=(work_program_packet_format IS NULL) AND (work_program_packet_id IS NULL OR work_program_revision_id IS NULL));
CREATE UNIQUE INDEX work_program_packet_document ON public.kb_documents(work_program_packet_id,work_program_packet_format) WHERE work_program_packet_id IS NOT NULL;
CREATE FUNCTION public.guard_work_program_packet_document() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.work_program_packet_id IS NOT NULL THEN RAISE EXCEPTION 'Retained review packet cannot be deleted' USING ERRCODE='23503'; END IF;
  RETURN OLD;
 END IF;
 IF NEW.work_program_packet_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.program_work_program_packets p WHERE p.id=NEW.work_program_packet_id AND p.workspace_id=NEW.workspace_id)
 THEN RAISE EXCEPTION 'Foreign review packet' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND OLD.work_program_packet_id IS NOT NULL AND ((NEW.workspace_id,NEW.work_program_packet_id,NEW.work_program_packet_format) IS DISTINCT FROM (OLD.workspace_id,OLD.work_program_packet_id,OLD.work_program_packet_format)
  OR (OLD.checksum IS NOT NULL AND (NEW.storage_ref,NEW.checksum,NEW.byte_size,NEW.content_type) IS DISTINCT FROM (OLD.storage_ref,OLD.checksum,OLD.byte_size,OLD.content_type)))
 THEN RAISE EXCEPTION 'Retained review packet identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_work_program_packet_document BEFORE INSERT OR UPDATE OR DELETE ON public.kb_documents FOR EACH ROW EXECUTE FUNCTION public.guard_work_program_packet_document();

CREATE FUNCTION public.enqueue_work_program_packet(p_program_id uuid,p_revision integer,p_sequence integer,p_audience text,p_public_reviewed boolean,p_format text,p_actor_id uuid)
RETURNS public.kb_ocr_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w uuid; r public.program_work_program_revisions; s public.program_work_program_workflow; packet public.program_work_program_packets; d public.kb_documents; j public.kb_ocr_jobs; snap jsonb;
BEGIN
 SELECT workspace_id INTO w FROM public.programs WHERE id=p_program_id FOR UPDATE;
 IF w IS NULL OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=p_actor_id)
 THEN RAISE EXCEPTION 'Program access denied' USING ERRCODE='42501'; END IF;
 IF p_format IS NULL OR p_format NOT IN ('html','pdf','xlsx') OR p_audience IS NULL OR p_audience NOT IN ('internal','public') THEN RAISE EXCEPTION 'Invalid packet format or audience' USING ERRCODE='22023'; END IF;
 IF p_audience='public' AND (p_public_reviewed IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=p_actor_id AND role IN ('owner','admin')))
 THEN RAISE EXCEPTION 'An administrator must review the entire selected version and source content for a public copy' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.program_work_program_revisions WHERE program_id=p_program_id AND revision=p_revision;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Revision unavailable' USING ERRCODE='42501'; END IF;
 SELECT * INTO packet FROM public.program_work_program_packets WHERE revision_id=r.id AND sequence=p_sequence AND audience=p_audience;
 IF packet.id IS NULL THEN
  SELECT * INTO s FROM public.program_work_program_workflow WHERE program_id=p_program_id;
  IF p_sequence IS NULL OR p_sequence IS DISTINCT FROM coalesce(s.sequence,0) THEN RAISE EXCEPTION 'Review history changed; reload before preparing a new packet' USING ERRCODE='PT409'; END IF;
  SELECT jsonb_build_object('revisionId',r.id,'revisionHash',r.content_sha256,'sequence',p_sequence,'audience',p_audience,
   'baseline', (SELECT to_jsonb(b) FROM public.program_work_program_revisions b WHERE b.id=r.amendment_baseline_id),
   'events',coalesce(jsonb_agg(CASE WHEN p_audience='internal' THEN to_jsonb(e) ELSE jsonb_build_object('id',e.id,'sequence',e.sequence,'revision_id',e.revision_id,'revision_hash',e.revision_hash,'kind',e.kind,'created_at',e.created_at,'evidence',e.evidence,'payload',e.payload-'reviewerIds'-'requestId') END ORDER BY e.sequence) FILTER(WHERE e.id IS NOT NULL),'[]'::jsonb)) INTO snap
   FROM public.program_work_program_events e WHERE e.program_id=p_program_id AND e.sequence<=p_sequence AND (p_audience='internal' OR e.payload->>'visibility'='public');
  INSERT INTO public.program_work_program_packets(program_id,workspace_id,revision_id,sequence,audience,snapshot,snapshot_hash,created_by)
   VALUES(p_program_id,w,r.id,p_sequence,p_audience,snap,encode(extensions.digest(convert_to(snap::text,'UTF8'),'sha256'),'hex'),p_actor_id) RETURNING * INTO packet;
 END IF;
 SELECT * INTO d FROM public.kb_documents WHERE work_program_packet_id=packet.id AND work_program_packet_format=p_format;
 IF d.id IS NULL THEN
  INSERT INTO public.kb_documents(workspace_id,uploaded_by,title,source_kind,original_filename,content_type,status,extraction_source,work_program_packet_id,work_program_packet_format)
  VALUES(w,p_actor_id,'Work program revision '||r.revision||' review record '||p_sequence||' ('||p_audience||')',CASE p_format WHEN 'pdf' THEN 'uploaded_pdf' WHEN 'xlsx' THEN 'uploaded_spreadsheet' ELSE 'uploaded_other' END,
   'work-program-r'||r.revision||'-review-'||p_sequence||'-'||p_audience||'.'||p_format,CASE p_format WHEN 'pdf' THEN 'application/pdf' WHEN 'xlsx' THEN 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ELSE 'text/html' END,'pending','none',packet.id,p_format) RETURNING * INTO d;
 END IF;
 SELECT * INTO j FROM public.kb_ocr_jobs WHERE document_id=d.id AND job_kind='work_program_export' ORDER BY created_at DESC LIMIT 1;
 IF j.id IS NOT NULL THEN
  IF j.status='failed' THEN UPDATE public.kb_ocr_jobs SET status='queued',requested_by=p_actor_id,failure_detail=NULL,cancel_requested=false,lease_token=NULL,lease_until=NULL WHERE id=j.id RETURNING * INTO j; END IF;
  RETURN j;
 END IF;
 INSERT INTO public.kb_ocr_jobs(workspace_id,document_id,request_id,requested_by,job_kind) VALUES(w,d.id,gen_random_uuid()::text,p_actor_id,'work_program_export') RETURNING * INTO j;
 RETURN j;
END $$;
REVOKE ALL ON FUNCTION public.enqueue_work_program_packet(uuid,integer,integer,text,boolean,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_work_program_packet(uuid,integer,integer,text,boolean,text,uuid) TO service_role;

-- Same lease and byte custody for preparation files and review packets.
CREATE OR REPLACE FUNCTION public.finish_work_program_export(p_job uuid,p_token uuid,p_checksum text,p_bytes bigint,p_storage_ref text,p_engine text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j public.kb_ocr_jobs; d public.kb_documents;
BEGIN
 SELECT * INTO j FROM public.kb_ocr_jobs WHERE id=p_job AND job_kind='work_program_export' FOR UPDATE;
 IF j.id IS NULL OR p_token IS NULL OR j.status<>'running' OR j.lease_token IS DISTINCT FROM p_token OR j.lease_until IS NULL OR j.lease_until<=now() OR j.cancel_requested
 THEN RAISE EXCEPTION 'Export lease no longer current' USING ERRCODE='PT409'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=j.workspace_id AND user_id=j.requested_by) THEN RAISE EXCEPTION 'Requester access revoked' USING ERRCODE='42501'; END IF;
 SELECT * INTO d FROM public.kb_documents WHERE id=j.document_id FOR UPDATE;
 IF d.workspace_id IS DISTINCT FROM j.workspace_id OR (d.work_program_revision_id IS NULL AND d.work_program_packet_id IS NULL) OR p_checksum IS NULL OR p_bytes IS NULL OR p_storage_ref IS NULL OR p_checksum !~ '^[a-f0-9]{64}$' OR p_bytes<=0 OR p_storage_ref IS DISTINCT FROM
  'storage://kb-documents/'||d.workspace_id||'/'||d.id||'/'||p_checksum||'.'||coalesce(d.work_program_export_format,d.work_program_packet_format)
 THEN RAISE EXCEPTION 'Invalid retained export identity' USING ERRCODE='22023'; END IF;
 UPDATE public.kb_documents SET checksum=p_checksum,byte_size=p_bytes,storage_ref=p_storage_ref,status='stored',extraction_error=NULL WHERE id=d.id;
 UPDATE public.kb_ocr_jobs SET status='succeeded',progress=100,message='Review file retained',engine_name=p_engine,lease_until=NULL WHERE id=j.id;
END $$;
