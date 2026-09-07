-- Review records do not backfill authority onto historical preparation revisions.
ALTER TABLE public.program_work_program_revisions ADD COLUMN amendment_baseline_id uuid REFERENCES public.program_work_program_revisions(id);
CREATE TABLE public.program_work_program_workflow (
 program_id uuid PRIMARY KEY REFERENCES public.programs(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 sequence integer NOT NULL DEFAULT 0, effective_revision_id uuid REFERENCES public.program_work_program_revisions(id),
 submission_revision_id uuid REFERENCES public.program_work_program_revisions(id), submission_id uuid,
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','review','returned','approved','adopted'))
);
CREATE TABLE public.program_work_program_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), program_id uuid NOT NULL REFERENCES public.programs(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 sequence integer NOT NULL, revision_id uuid NOT NULL REFERENCES public.program_work_program_revisions(id), revision_hash text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('submit','comment','resolve_comment','return','approve','adoption','external_acceptance','spending_authorization','withdraw_authority','start_amendment')),
 request_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id), payload jsonb NOT NULL, evidence jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(program_id,sequence), UNIQUE(program_id,request_id)
);
ALTER TABLE public.program_work_program_workflow ADD FOREIGN KEY (submission_id) REFERENCES public.program_work_program_events(id);
CREATE TABLE public.program_work_program_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), program_id uuid NOT NULL REFERENCES public.programs(id), workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 revision_id uuid NOT NULL REFERENCES public.program_work_program_revisions(id), submission_id uuid NOT NULL REFERENCES public.program_work_program_events(id),
 assignee_user_id uuid NOT NULL REFERENCES auth.users(id), due_on date, status text NOT NULL CHECK(status IN ('pending','approved','returned','superseded')),
 UNIQUE(submission_id,assignee_user_id)
);
ALTER TABLE public.program_work_program_workflow ENABLE ROW LEVEL SECURITY;
CREATE POLICY program_work_program_workflow_read ON public.program_work_program_workflow FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.workspace_members wm JOIN public.programs p ON p.workspace_id=wm.workspace_id
 WHERE wm.user_id=auth.uid() AND p.id=program_id AND p.workspace_id=program_work_program_workflow.workspace_id));
REVOKE ALL ON public.program_work_program_workflow FROM anon,authenticated,service_role;
GRANT SELECT ON public.program_work_program_workflow TO authenticated,service_role;

ALTER TABLE public.program_work_program_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY program_work_program_events_read ON public.program_work_program_events FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.workspace_members wm JOIN public.programs p ON p.workspace_id=wm.workspace_id
 WHERE wm.user_id=auth.uid() AND p.id=program_id AND p.workspace_id=program_work_program_events.workspace_id));
REVOKE ALL ON public.program_work_program_events FROM anon,authenticated,service_role;
GRANT SELECT ON public.program_work_program_events TO authenticated,service_role;

ALTER TABLE public.program_work_program_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY program_work_program_reviews_read ON public.program_work_program_reviews FOR SELECT TO authenticated USING (
 EXISTS(SELECT 1 FROM public.workspace_members wm JOIN public.programs p ON p.workspace_id=wm.workspace_id
 WHERE wm.user_id=auth.uid() AND p.id=program_id AND p.workspace_id=program_work_program_reviews.workspace_id));
REVOKE ALL ON public.program_work_program_reviews FROM anon,authenticated,service_role;
GRANT SELECT ON public.program_work_program_reviews TO authenticated,service_role;

-- New preparation revisions retain the effective baseline and close stale review work.
CREATE FUNCTION public.work_program_revision_review_boundary() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s public.program_work_program_workflow; BEGIN
 SELECT * INTO s FROM public.program_work_program_workflow WHERE program_id=NEW.program_id;
 NEW.amendment_baseline_id := s.effective_revision_id;
 IF EXISTS(SELECT 1 FROM public.program_work_program_revisions b WHERE b.id=s.effective_revision_id AND b.content_json=NEW.content_json) THEN
  NEW.source_ids := (SELECT source_ids FROM public.program_work_program_revisions WHERE id=s.effective_revision_id);
 END IF;
 IF s.submission_id IS NOT NULL THEN
  UPDATE public.program_work_program_reviews SET status='superseded' WHERE submission_id=s.submission_id AND status IN ('pending','returned');
  UPDATE public.program_work_program_workflow SET submission_id=NULL,submission_revision_id=NULL,status='draft' WHERE program_id=NEW.program_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_program_revision_review_boundary BEFORE INSERT ON public.program_work_program_revisions FOR EACH ROW EXECUTE FUNCTION public.work_program_revision_review_boundary();

-- Only the authenticated manual route may pass an actor to this service-only RPC.
CREATE FUNCTION public.record_work_program_event(p_program_id uuid,p_actor_id uuid,p_command jsonb)
RETURNS public.program_work_program_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 w uuid; actor_role text; r public.program_work_program_revisions; latest public.program_work_program_revisions;
 s public.program_work_program_workflow; e public.program_work_program_events; target public.program_work_program_events;
 k text := p_command->>'kind'; doc_id uuid; reviewer uuid; d public.kb_documents; evidence jsonb := '[]';
BEGIN
 SELECT workspace_id INTO w FROM public.programs WHERE id=p_program_id FOR UPDATE;
 SELECT role INTO actor_role FROM public.workspace_members WHERE workspace_id=w AND user_id=p_actor_id FOR SHARE;
 IF w IS NULL OR actor_role IS NULL OR actor_role NOT IN ('owner','admin','member') THEN RAISE EXCEPTION 'Work program write access denied' USING ERRCODE='42501'; END IF;
 IF p_command IS NULL OR octet_length(p_command::text)>100000 OR k IS NULL OR k NOT IN ('submit','comment','resolve_comment','return','approve','adoption','external_acceptance','spending_authorization','withdraw_authority','start_amendment')
  OR coalesce(length(btrim(p_command->>'note')),0)=0 OR p_command->>'visibility' IS NULL OR p_command->>'visibility' NOT IN ('internal','public') OR p_command->>'requestId' IS NULL
  OR p_command->>'expectedSequence' IS NULL OR p_command->>'expectedRevision' IS NULL OR p_command->>'revisionId' IS NULL OR p_command->>'revisionHash' IS NULL
  OR jsonb_typeof(p_command->'reviewerIds') IS DISTINCT FROM 'array' OR jsonb_typeof(p_command->'documentIds') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'Invalid workflow command' USING ERRCODE='22023'; END IF;
 SELECT * INTO e FROM public.program_work_program_events WHERE program_id=p_program_id AND request_id=(p_command->>'requestId')::uuid;
 IF FOUND THEN
  IF e.actor_id<>p_actor_id OR e.payload<>p_command THEN RAISE EXCEPTION 'Retry payload or actor changed' USING ERRCODE='PT409'; END IF;
  RETURN e;
 END IF;
 IF k NOT IN ('adoption','external_acceptance','spending_authorization','withdraw_authority') AND (coalesce(p_command->>'authority','')<>'' OR coalesce(p_command->>'scope','')<>'' OR p_command->>'evidenceDate' IS NOT NULL) THEN RAISE EXCEPTION 'Authority fields require an authority record' USING ERRCODE='22023'; END IF;
 INSERT INTO public.program_work_program_workflow(program_id,workspace_id) VALUES(p_program_id,w) ON CONFLICT DO NOTHING;
 SELECT * INTO s FROM public.program_work_program_workflow WHERE program_id=p_program_id;
 SELECT * INTO r FROM public.program_work_program_revisions WHERE id=(p_command->>'revisionId')::uuid AND program_id=p_program_id AND workspace_id=w;
 SELECT * INTO latest FROM public.program_work_program_revisions WHERE program_id=p_program_id ORDER BY revision DESC LIMIT 1;
 IF r.id IS NULL THEN RAISE EXCEPTION 'Revision access denied' USING ERRCODE='42501'; END IF;
 IF s.sequence<>(p_command->>'expectedSequence')::integer OR latest.revision<>(p_command->>'expectedRevision')::integer OR r.content_sha256 IS DISTINCT FROM p_command->>'revisionHash'
 THEN RAISE EXCEPTION 'Workflow or revision changed; reload' USING ERRCODE='PT409'; END IF;
 IF k NOT IN ('comment','resolve_comment','withdraw_authority','start_amendment','external_acceptance','spending_authorization') AND r.id<>latest.id THEN RAISE EXCEPTION 'Old decisions cannot authorize new content' USING ERRCODE='PT409'; END IF;
 IF k IN ('adoption','external_acceptance','spending_authorization','withdraw_authority') AND actor_role NOT IN ('owner','admin') THEN RAISE EXCEPTION 'An owner or administrator must record authority' USING ERRCODE='42501'; END IF;
 FOR doc_id IN SELECT value::uuid FROM jsonb_array_elements_text(p_command->'documentIds') LOOP
  SELECT * INTO d FROM public.kb_documents WHERE id=doc_id AND workspace_id=w AND checksum IS NOT NULL AND storage_ref IS NOT NULL FOR SHARE;
  IF d.id IS NULL THEN RAISE EXCEPTION 'Supporting document unavailable or foreign' USING ERRCODE='42501'; END IF;
  evidence := evidence || jsonb_build_array(jsonb_build_object('id',d.id,'title',d.title,'checksum',d.checksum));
 END LOOP;
 IF k IN ('adoption','external_acceptance','spending_authorization','withdraw_authority') THEN
  IF jsonb_array_length(evidence)=0 OR coalesce(length(btrim(p_command->>'authority')),0)=0 OR coalesce(length(btrim(p_command->>'scope')),0)=0 OR p_command->>'evidenceDate' IS NULL
  THEN RAISE EXCEPTION 'Actual dated authority, scope and supporting documents required' USING ERRCODE='22023'; END IF;
  IF (p_command->>'evidenceDate')::date > current_date THEN RAISE EXCEPTION 'A future event is not recorded evidence' USING ERRCODE='22023'; END IF;
 END IF;
 IF k='submit' THEN
  IF s.status IN ('review','approved','adopted') AND s.submission_revision_id=r.id THEN RAISE EXCEPTION 'This revision is already submitted; save a new revision' USING ERRCODE='PT409'; END IF;
  IF jsonb_array_length(p_command->'reviewerIds')=0 THEN RAISE EXCEPTION 'Assign at least one independent reviewer' USING ERRCODE='22023'; END IF;
  IF r.amendment_baseline_id IS DISTINCT FROM s.effective_revision_id THEN RAISE EXCEPTION 'Amendment baseline changed' USING ERRCODE='PT409'; END IF;
  FOR reviewer IN SELECT value::uuid FROM jsonb_array_elements_text(p_command->'reviewerIds') LOOP
   IF reviewer=r.created_by OR reviewer=p_actor_id OR NOT EXISTS(SELECT 1 FROM public.workspace_members WHERE workspace_id=w AND user_id=reviewer AND role IN ('owner','admin','member'))
   THEN RAISE EXCEPTION 'Reviewer must be a separate current workspace writer' USING ERRCODE='42501'; END IF;
  END LOOP;
 ELSIF k IN ('approve','return') THEN
  IF s.status<>'review' OR s.submission_revision_id IS DISTINCT FROM r.id OR NOT EXISTS(SELECT 1 FROM public.program_work_program_reviews WHERE submission_id=s.submission_id AND assignee_user_id=p_actor_id AND status='pending')
  THEN RAISE EXCEPTION 'No current assigned review for this actor and revision' USING ERRCODE='42501'; END IF;
  IF p_actor_id=r.created_by THEN RAISE EXCEPTION 'Author cannot approve own revision' USING ERRCODE='42501'; END IF;
  IF k='approve' AND EXISTS(SELECT 1 FROM public.program_work_program_events c WHERE c.program_id=p_program_id AND c.kind='comment' AND c.revision_id=r.id AND NOT EXISTS(SELECT 1 FROM public.program_work_program_events x WHERE x.kind='resolve_comment' AND x.payload->>'targetEventId'=c.id::text AND x.program_id=p_program_id)) THEN RAISE EXCEPTION 'Resolve open review comments first' USING ERRCODE='PT409'; END IF;
 ELSIF k='resolve_comment' THEN
  SELECT * INTO target FROM public.program_work_program_events WHERE id=(p_command->>'targetEventId')::uuid AND program_id=p_program_id AND revision_id=r.id AND kind='comment';
  IF target.id IS NULL OR (target.actor_id<>p_actor_id AND actor_role NOT IN ('owner','admin')) THEN RAISE EXCEPTION 'Only comment author or administrator can resolve it' USING ERRCODE='42501'; END IF;
 ELSIF k='adoption' THEN
  IF s.status<>'approved' OR s.submission_revision_id IS DISTINCT FROM r.id OR r.amendment_baseline_id IS DISTINCT FROM s.effective_revision_id
   OR EXISTS(SELECT 1 FROM public.program_work_program_events c WHERE c.program_id=p_program_id AND c.kind='comment' AND c.revision_id=r.id AND NOT EXISTS(SELECT 1 FROM public.program_work_program_events x WHERE x.kind='resolve_comment' AND x.payload->>'targetEventId'=c.id::text AND x.program_id=p_program_id))
  THEN RAISE EXCEPTION 'Exact current revision needs completed internal review' USING ERRCODE='PT409'; END IF;
 ELSIF k IN ('external_acceptance','spending_authorization') THEN
  IF s.effective_revision_id IS DISTINCT FROM r.id THEN RAISE EXCEPTION 'Authority evidence must name the effective adopted revision' USING ERRCODE='PT409'; END IF;
 ELSIF k='withdraw_authority' THEN
  SELECT * INTO target FROM public.program_work_program_events WHERE id=(p_command->>'targetEventId')::uuid AND program_id=p_program_id AND revision_id=r.id AND kind IN ('adoption','external_acceptance','spending_authorization');
  IF target.id IS NULL THEN RAISE EXCEPTION 'Select an authority record from this revision' USING ERRCODE='22023'; END IF;
 ELSIF k='start_amendment' THEN
  IF s.effective_revision_id IS DISTINCT FROM r.id THEN RAISE EXCEPTION 'Select the current adopted baseline' USING ERRCODE='PT409'; END IF;
 END IF;
 INSERT INTO public.program_work_program_events(program_id,workspace_id,sequence,revision_id,revision_hash,kind,request_id,actor_id,payload,evidence)
 VALUES(p_program_id,w,s.sequence+1,r.id,r.content_sha256,k,(p_command->>'requestId')::uuid,p_actor_id,p_command,evidence) RETURNING * INTO e;
 UPDATE public.program_work_program_workflow SET sequence=e.sequence WHERE program_id=p_program_id;
 IF k='submit' THEN
  UPDATE public.program_work_program_reviews SET status='superseded' WHERE program_id=p_program_id AND status IN ('pending','returned');
  INSERT INTO public.program_work_program_reviews(program_id,workspace_id,revision_id,submission_id,assignee_user_id,due_on,status)
  SELECT DISTINCT p_program_id,w,r.id,e.id,value::uuid,(p_command->>'dueOn')::date,'pending' FROM jsonb_array_elements_text(p_command->'reviewerIds');
  UPDATE public.program_work_program_workflow SET submission_id=e.id,submission_revision_id=r.id,status='review' WHERE program_id=p_program_id;
 ELSIF k='return' THEN
  UPDATE public.program_work_program_reviews SET status='superseded' WHERE submission_id=s.submission_id AND status IN ('pending','returned');
  INSERT INTO public.program_work_program_reviews(program_id,workspace_id,revision_id,submission_id,assignee_user_id,due_on,status) VALUES(p_program_id,w,r.id,s.submission_id,r.created_by,NULL,'returned');
  UPDATE public.program_work_program_workflow SET status='returned' WHERE program_id=p_program_id;
 ELSIF k='approve' THEN
  UPDATE public.program_work_program_reviews SET status='approved' WHERE submission_id=s.submission_id AND assignee_user_id=p_actor_id;
  IF NOT EXISTS(SELECT 1 FROM public.program_work_program_reviews WHERE submission_id=s.submission_id AND status='pending') THEN UPDATE public.program_work_program_workflow SET status='approved' WHERE program_id=p_program_id; END IF;
 ELSIF k='adoption' THEN
  UPDATE public.program_work_program_workflow SET status='adopted',effective_revision_id=r.id WHERE program_id=p_program_id;
 ELSIF k='withdraw_authority' AND target.kind='adoption' AND s.effective_revision_id=r.id THEN
  UPDATE public.program_work_program_workflow SET effective_revision_id=NULL,status='draft' WHERE program_id=p_program_id;
 ELSIF k='start_amendment' THEN
  PERFORM public.save_program_work_program_revision(p_program_id,p_actor_id,latest.revision,(p_command->>'requestId')::uuid,r.content_json);
 END IF;
 RETURN e;
END $$;
REVOKE ALL ON FUNCTION public.record_work_program_event(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_work_program_event(uuid,uuid,jsonb) TO service_role;

-- Supporting document identities are retained alongside the exact decision.
CREATE FUNCTION public.guard_work_program_review_evidence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.program_work_program_events WHERE evidence @> jsonb_build_array(jsonb_build_object('id',OLD.id))) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retained review evidence cannot be deleted' USING ERRCODE='23503'; END IF;
  IF (NEW.workspace_id,NEW.checksum,NEW.storage_ref,NEW.byte_size) IS DISTINCT FROM (OLD.workspace_id,OLD.checksum,OLD.storage_ref,OLD.byte_size)
  THEN RAISE EXCEPTION 'Retained review evidence identity is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_work_program_review_evidence BEFORE UPDATE OR DELETE ON public.kb_documents FOR EACH ROW EXECUTE FUNCTION public.guard_work_program_review_evidence();
