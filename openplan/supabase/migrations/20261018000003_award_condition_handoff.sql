-- B4/M13e. Additive source candidate, not applied. No invented legacy currency/terms.
ALTER TABLE public.funding_awards
 ADD COLUMN latest_handoff_revision_id uuid,
 ADD COLUMN current_handoff_revision_id uuid,
 ADD COLUMN currency_code text CHECK(currency_code ~ '^[A-Z]{3}$'),
 ADD COLUMN has_source_backed_issuance boolean NOT NULL DEFAULT false;
ALTER TABLE public.projects ADD COLUMN funding_source_epoch bigint NOT NULL DEFAULT 0;
ALTER TABLE public.funding_opportunities ADD COLUMN has_source_backed_issuance boolean NOT NULL DEFAULT false;

CREATE TABLE public.funding_award_handoff_revisions (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES public.workspaces(id),
 project_id uuid NOT NULL REFERENCES public.projects(id), opportunity_id uuid NOT NULL REFERENCES public.funding_opportunities(id),
 award_id uuid NOT NULL REFERENCES public.funding_awards(id), sequence integer NOT NULL CHECK(sequence>0),
 predecessor_id uuid REFERENCES public.funding_award_handoff_revisions(id),
 request_key uuid NOT NULL, schema_version integer NOT NULL DEFAULT 1 CHECK(schema_version=1),
 reviewed_hash text NOT NULL, reviewed_payload jsonb NOT NULL, proposal jsonb NOT NULL, proposal_hash text NOT NULL CHECK(proposal_hash ~ '^[a-f0-9]{64}$'), terms jsonb NOT NULL,
 receipt jsonb NOT NULL, actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(award_id,sequence), UNIQUE(workspace_id,request_key), UNIQUE(id,award_id,project_id,workspace_id)
);
ALTER TABLE public.funding_awards
 ADD FOREIGN KEY(latest_handoff_revision_id,id,project_id,workspace_id) REFERENCES public.funding_award_handoff_revisions(id,award_id,project_id,workspace_id) DEFERRABLE INITIALLY DEFERRED,
 ADD FOREIGN KEY(current_handoff_revision_id,id,project_id,workspace_id) REFERENCES public.funding_award_handoff_revisions(id,award_id,project_id,workspace_id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE public.funding_award_handoff_sources (
 revision_id uuid NOT NULL REFERENCES public.funding_award_handoff_revisions(id),
 family text NOT NULL CHECK(family IN ('kb_pdf','application_pdf')), source_id uuid NOT NULL,
 kb_document_id uuid REFERENCES public.kb_documents(id), export_id uuid REFERENCES public.funding_opportunity_application_exports(id),
 bucket text NOT NULL, object_name text NOT NULL, object_identity jsonb NOT NULL,
 checksum text NOT NULL CHECK(checksum ~ '^[a-f0-9]{64}$'), byte_size bigint NOT NULL CHECK(byte_size>0), receipt jsonb NOT NULL,
 PRIMARY KEY(revision_id,family,source_id),
 CHECK((family='kb_pdf' AND kb_document_id=source_id AND export_id IS NULL) OR (family='application_pdf' AND export_id=source_id AND kb_document_id IS NULL))
);
ALTER TABLE public.project_submittals ADD COLUMN funding_award_id uuid REFERENCES public.funding_awards(id), ADD COLUMN handoff_origin_revision_id uuid REFERENCES public.funding_award_handoff_revisions(id), ADD COLUMN handoff_condition_key text, ADD COLUMN handoff_occurrence_key text;
ALTER TABLE public.project_milestones ADD COLUMN handoff_origin_revision_id uuid REFERENCES public.funding_award_handoff_revisions(id), ADD COLUMN handoff_condition_key text, ADD COLUMN handoff_occurrence_key text;
CREATE TABLE public.funding_award_handoff_occurrences (
 id uuid PRIMARY KEY, revision_id uuid NOT NULL, award_id uuid NOT NULL, project_id uuid NOT NULL, workspace_id uuid NOT NULL,
 condition_key text NOT NULL, occurrence_key text NOT NULL, requirement jsonb NOT NULL,
 prior_occurrence_id uuid REFERENCES public.funding_award_handoff_occurrences(id),
 submittal_id uuid REFERENCES public.project_submittals(id), milestone_id uuid REFERENCES public.project_milestones(id), outcome_snapshot jsonb,
 UNIQUE(revision_id,condition_key,occurrence_key),
 FOREIGN KEY(revision_id,award_id,project_id,workspace_id) REFERENCES public.funding_award_handoff_revisions(id,award_id,project_id,workspace_id),
 CHECK(submittal_id IS NULL OR milestone_id IS NULL)
);
CREATE INDEX handoff_occurrences_award ON public.funding_award_handoff_occurrences(award_id,revision_id);
CREATE INDEX handoff_sources_object ON public.funding_award_handoff_sources(bucket,object_name);
ALTER TABLE public.billing_invoice_records ADD COLUMN award_handoff_revision_id uuid REFERENCES public.funding_award_handoff_revisions(id), ADD COLUMN currency_code text CHECK(currency_code ~ '^[A-Z]{3}$'), ADD COLUMN handoff_applicable_revision_id uuid REFERENCES public.funding_award_handoff_revisions(id);
CREATE TABLE public.funding_award_closure_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), award_id uuid NOT NULL REFERENCES public.funding_awards(id),
 workspace_id uuid NOT NULL REFERENCES public.workspaces(id), revision_id uuid REFERENCES public.funding_award_handoff_revisions(id),
 event text NOT NULL CHECK(event IN ('earned_coverage','recorded_on_import','reopen')), basis jsonb NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION public.handoff_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Retained award evidence is immutable' USING ERRCODE='23514'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['funding_award_handoff_revisions','funding_award_handoff_sources','funding_award_handoff_occurrences','funding_award_closure_receipts'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT SELECT,INSERT ON public.%I TO service_role',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.handoff_immutable()',t);
 END LOOP;
END $$;
CREATE POLICY member_read ON public.funding_award_handoff_revisions FOR SELECT TO authenticated USING(EXISTS(SELECT FROM public.workspace_members m WHERE m.workspace_id=funding_award_handoff_revisions.workspace_id AND m.user_id=auth.uid()));
CREATE POLICY member_read ON public.funding_award_handoff_sources FOR SELECT TO authenticated USING(EXISTS(SELECT FROM public.funding_award_handoff_revisions r WHERE r.id=revision_id));
CREATE POLICY member_read ON public.funding_award_handoff_occurrences FOR SELECT TO authenticated USING(EXISTS(SELECT FROM public.workspace_members m WHERE m.workspace_id=funding_award_handoff_occurrences.workspace_id AND m.user_id=auth.uid()));
CREATE POLICY member_read ON public.funding_award_closure_receipts FOR SELECT TO authenticated USING(EXISTS(SELECT FROM public.workspace_members m WHERE m.workspace_id=funding_award_closure_receipts.workspace_id AND m.user_id=auth.uid()));

-- Approved family, independent of caller access: exclude every narrower generated KB family.
CREATE FUNCTION public.handoff_ordinary_pdf(d public.kb_documents) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT d.source_kind='uploaded_pdf' AND d.content_type='application/pdf' AND d.status IN ('stored','ready')
 AND d.checksum ~ '^[a-f0-9]{64}$' AND d.byte_size>0
 AND d.storage_ref LIKE 'storage://kb-documents/'||d.workspace_id||'/'||d.id||'/%'
 AND coalesce(to_jsonb(d)->>'work_program_revision_id',to_jsonb(d)->>'work_program_packet_id',to_jsonb(d)->>'work_program_report_id',to_jsonb(d)->>'contract_snapshot_id') IS NULL
$$;

-- Ordinary uploads use upsert:false. Row-first deletion remains possible until retained.
-- Freeze object identity while an eligible source row exists, including service writes.
-- A row deletion cannot race apply's FOR SHARE, and retained rows cannot be deleted.
CREATE FUNCTION public.guard_handoff_source_object() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b text; n text;
BEGIN
 b:=OLD.bucket_id; n:=OLD.name;
 -- Access bookkeeping may change on a download. It is not byte identity.
 -- Version, object ID, metadata/ETag, bucket and name remain protected.
 IF TG_OP='UPDATE' AND (to_jsonb(NEW)-'last_accessed_at'-'updated_at')=(to_jsonb(OLD)-'last_accessed_at'-'updated_at') THEN RETURN NEW; END IF;
 IF EXISTS(SELECT FROM public.funding_award_handoff_sources s WHERE s.bucket=b AND s.object_name=n)
 OR (b='kb-documents' AND EXISTS(SELECT FROM public.kb_documents d WHERE public.handoff_ordinary_pdf(d) AND d.storage_ref='storage://'||b||'/'||n))
 OR (b='grant-application-exports' AND EXISTS(SELECT FROM public.funding_opportunity_application_exports e WHERE e.storage_path=n)) THEN
  RAISE EXCEPTION 'Original award/application PDF bytes cannot be replaced; upload a new document/version' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER handoff_source_object BEFORE UPDATE OR DELETE ON storage.objects FOR EACH ROW EXECUTE FUNCTION public.guard_handoff_source_object();
CREATE FUNCTION public.guard_handoff_source_row() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='kb_documents' AND TG_OP='UPDATE' AND EXISTS(SELECT FROM public.kb_documents d WHERE d.id=OLD.id AND public.handoff_ordinary_pdf(d)) AND (to_jsonb(NEW)->'storage_ref',to_jsonb(NEW)->'checksum',to_jsonb(NEW)->'byte_size',to_jsonb(NEW)->'content_type',to_jsonb(NEW)->'source_kind') IS DISTINCT FROM (to_jsonb(OLD)->'storage_ref',to_jsonb(OLD)->'checksum',to_jsonb(OLD)->'byte_size',to_jsonb(OLD)->'content_type',to_jsonb(OLD)->'source_kind') THEN RAISE EXCEPTION 'Upload a new original PDF identity' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT FROM public.funding_award_handoff_sources s WHERE s.source_id=OLD.id AND s.family=CASE WHEN TG_TABLE_NAME='kb_documents' THEN 'kb_pdf' ELSE 'application_pdf' END) THEN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'updated_at'-'chunk_count'-'char_count'-'extraction_error'-'extraction_source'-'status') IS DISTINCT FROM (to_jsonb(OLD)-'updated_at'-'chunk_count'-'char_count'-'extraction_error'-'extraction_source'-'status') THEN
   RAISE EXCEPTION 'This source supports immutable award terms; retain it and upload a new version' USING ERRCODE='23503';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER handoff_kb_source BEFORE UPDATE OR DELETE ON public.kb_documents FOR EACH ROW EXECUTE FUNCTION public.guard_handoff_source_row();
CREATE TRIGGER handoff_export_source BEFORE UPDATE OR DELETE ON public.funding_opportunity_application_exports FOR EACH ROW EXECUTE FUNCTION public.guard_handoff_source_row();

-- One lock order for handoff, record outcomes, invoice writers and closeout:
-- workspace advisory lock 713, current member SHARE, award UPDATE, opportunity UPDATE,
-- project UPDATE (blocks FK additions), sections UPDATE (blocks draft FK additions),
-- drafts/attachments/exports SHARE in id order, source rows SHARE then objects SHARE,
-- occurrence targets/invoices UPDATE in id order. Ordinary source writes also take 713.
CREATE FUNCTION public.handoff_writer_lock() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w uuid; old_w uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN
  old_w:=nullif(to_jsonb(OLD)->>'workspace_id','')::uuid;
  IF old_w IS NULL THEN SELECT workspace_id INTO old_w FROM public.projects WHERE id=(to_jsonb(OLD)->>'project_id')::uuid; END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
  w:=nullif(to_jsonb(NEW)->>'workspace_id','')::uuid;
  IF w IS NULL THEN SELECT workspace_id INTO w FROM public.projects WHERE id=(to_jsonb(NEW)->>'project_id')::uuid; END IF;
 END IF;
 -- Reparenting locks both scopes deterministically.
 FOR w IN SELECT DISTINCT x FROM unnest(ARRAY[w,old_w]) x WHERE x IS NOT NULL ORDER BY x LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(w::text,713));
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['funding_awards','funding_opportunities','funding_opportunity_application_sections','funding_opportunity_section_drafts','funding_opportunity_attachments','funding_opportunity_application_exports','kb_documents','billing_invoice_records','project_submittals','project_milestones'] LOOP
  EXECUTE format('CREATE TRIGGER aa_handoff_writer_lock BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.handoff_writer_lock()',t);
 END LOOP;
END $$;

-- A single database JSON representation supplies preview and apply fingerprints.
CREATE FUNCTION public.award_handoff_state(p_actor uuid,p_award uuid,p_opportunity uuid,p_sources jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.funding_awards; o public.funding_opportunities; s jsonb; d public.kb_documents; e public.funding_opportunity_application_exports; obj storage.objects; refs jsonb:='[]'; proposal jsonb; application_snapshot jsonb;
BEGIN
 IF current_user NOT IN ('service_role','postgres') OR p_actor IS NULL THEN RAISE EXCEPTION 'Server actor required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(713,1);
 SELECT * INTO STRICT a FROM public.funding_awards WHERE id=p_award;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.workspace_id::text,713));
 PERFORM FROM public.workspace_members WHERE workspace_id=a.workspace_id AND user_id=p_actor AND role IN ('owner','admin','member') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current programs writer required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.funding_awards WHERE id=p_award FOR UPDATE;
 SELECT * INTO STRICT o FROM public.funding_opportunities WHERE id=p_opportunity FOR UPDATE;
 IF o.workspace_id<>a.workspace_id OR o.project_id IS DISTINCT FROM a.project_id OR o.pursuit_kind<>'grant' OR a.funding_opportunity_id IS NOT NULL AND a.funding_opportunity_id<>o.id THEN RAISE EXCEPTION 'Select a grant and matching award/project' USING ERRCODE='22023'; END IF;
 PERFORM FROM public.projects WHERE id=a.project_id AND workspace_id=a.workspace_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Project unavailable' USING ERRCODE='42501'; END IF;
 PERFORM FROM public.funding_opportunity_application_sections WHERE opportunity_id=o.id ORDER BY id FOR UPDATE;
 PERFORM FROM public.funding_opportunity_section_drafts WHERE opportunity_id=o.id ORDER BY id FOR SHARE;
 PERFORM FROM public.funding_opportunity_attachments WHERE opportunity_id=o.id ORDER BY id FOR SHARE;
 PERFORM FROM public.funding_opportunity_application_exports WHERE opportunity_id=o.id ORDER BY id FOR SHARE;
 IF EXISTS(SELECT FROM public.funding_opportunity_application_sections s WHERE s.opportunity_id=o.id AND (s.workspace_id<>a.workspace_id OR s.finalized_from_draft_id IS NOT NULL AND NOT EXISTS(SELECT FROM public.funding_opportunity_section_drafts d WHERE d.id=s.finalized_from_draft_id AND d.opportunity_id=o.id AND d.section_id=s.id AND d.workspace_id=a.workspace_id)))
 OR EXISTS(SELECT FROM public.funding_opportunity_section_drafts d WHERE d.opportunity_id=o.id AND d.workspace_id<>a.workspace_id)
 OR EXISTS(SELECT FROM public.funding_opportunity_attachments x WHERE x.opportunity_id=o.id AND x.workspace_id<>a.workspace_id)
 THEN RAISE EXCEPTION 'Application provenance scope is inconsistent' USING ERRCODE='42501'; END IF;
 -- Final text and finalizer/provenance identity share the application audience.
 -- Never copy private draft grounding, report text, attachment metadata or arbitrary URLs.
 proposal:=jsonb_build_object('label','Current reviewed application, not proof of submission','opportunityId',o.id,'title',o.title,
  'sections',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'key',x.section_key,'title',x.title,'status',x.status,'finalText',x.final_markdown,'finalizer',x.finalized_by,'finalizedAt',x.finalized_at,'recordedEditor',x.updated_by,'finalizerBasis','Retained finalizer columns; null remains unrecorded legacy provenance','finalizedFromDraftId',x.finalized_from_draft_id,'updatedAt',x.updated_at) ORDER BY x.id) FROM public.funding_opportunity_application_sections x WHERE x.opportunity_id=o.id),'[]'),
  'draftProvenance',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'sectionId',x.section_id,'author',x.created_by,'createdAt',x.created_at,'revisionOf',x.revision_of,'model',x.model,'origin',x.origin,'groundedSentenceCount',x.grounded_sentence_count,'totalSentenceCount',x.total_sentence_count) ORDER BY x.id) FROM public.funding_opportunity_section_drafts x WHERE x.opportunity_id=o.id),'[]'),
  'attachments',coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'key',x.attachment_key,'required',x.required,'status',x.status,'kbDocumentId',CASE WHEN EXISTS(SELECT FROM public.kb_documents d WHERE d.id=x.kb_document_id AND d.workspace_id=a.workspace_id AND public.handoff_ordinary_pdf(d)) THEN x.kb_document_id END,'availability',CASE WHEN x.report_artifact_id IS NOT NULL THEN 'Excluded source family; not retained' ELSE 'Select an allowed PDF separately' END) ORDER BY x.id) FROM public.funding_opportunity_attachments x WHERE x.opportunity_id=o.id),'[]'));
 application_snapshot:=proposal;
 IF a.latest_handoff_revision_id IS NOT NULL THEN SELECT r.proposal INTO proposal FROM public.funding_award_handoff_revisions r WHERE r.award_id=a.id ORDER BY r.sequence LIMIT 1; END IF;
 FOR s IN SELECT value FROM jsonb_array_elements(p_sources) ORDER BY value->>'family',value->>'id' LOOP
  IF s->>'family'='kb_pdf' THEN
   SELECT * INTO d FROM public.kb_documents WHERE id=(s->>'id')::uuid AND workspace_id=a.workspace_id FOR SHARE;
   IF d.id IS NULL OR NOT coalesce(public.handoff_ordinary_pdf(d),false) THEN RAISE EXCEPTION 'Only ordinary same-audience uploaded PDFs are allowed' USING ERRCODE='42501'; END IF;
   SELECT * INTO obj FROM storage.objects WHERE bucket_id='kb-documents' AND name=substring(d.storage_ref FROM length('storage://kb-documents/')+1) FOR SHARE;
   IF obj.id IS NULL THEN RAISE EXCEPTION 'Original PDF unavailable' USING ERRCODE='22023'; END IF;
   refs:=refs||jsonb_build_array(s||jsonb_build_object('bucket',obj.bucket_id,'objectName',obj.name,'objectIdentity',to_jsonb(obj)-'last_accessed_at'-'updated_at','checksum',d.checksum,'byteSize',d.byte_size));
  ELSIF s->>'family'='application_pdf' THEN
   SELECT * INTO e FROM public.funding_opportunity_application_exports WHERE id=(s->>'id')::uuid AND opportunity_id=o.id AND workspace_id=a.workspace_id FOR SHARE;
   IF e.id IS NULL OR e.storage_path NOT LIKE a.workspace_id||'/'||o.id||'/%' THEN RAISE EXCEPTION 'Application export unavailable' USING ERRCODE='42501'; END IF;
   -- Legacy exports have no checksum. Explicitly refuse rather than attest guessed bytes.
   RAISE EXCEPTION 'Application PDF exports lack an immutable upload checksum in this installation; use reviewed application rows and an ordinary uploaded notice PDF. Export retention is not enabled.' USING ERRCODE='22023';
  ELSE RAISE EXCEPTION 'Source family excluded' USING ERRCODE='42501'; END IF;
 END LOOP;
 PERFORM FROM public.project_submittals WHERE project_id=a.project_id ORDER BY id FOR UPDATE;
 PERFORM FROM public.project_milestones WHERE project_id=a.project_id ORDER BY id FOR UPDATE;
 PERFORM FROM public.billing_invoice_records WHERE funding_award_id=a.id ORDER BY id FOR UPDATE;
 RETURN jsonb_build_object('awardId',a.id,'workspaceId',a.workspace_id,'projectId',a.project_id,'opportunityId',o.id,
  'expectedLatest',a.latest_handoff_revision_id,'expectedCurrent',a.current_handoff_revision_id,'spendingStatus',a.spending_status,
  'proposal',proposal,'currentApplicationSnapshot',application_snapshot,'applicationMemberFingerprint',encode(sha256(convert_to(coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM public.funding_opportunity_application_sections x WHERE x.opportunity_id=o.id),'[]')||coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM public.funding_opportunity_section_drafts x WHERE x.opportunity_id=o.id),'[]')||coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM public.funding_opportunity_attachments x WHERE x.opportunity_id=o.id),'[]')||coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id)::text FROM public.funding_opportunity_application_exports x WHERE x.opportunity_id=o.id),'[]'),'UTF8')),'hex'),'sources',refs,
  'occurrences',coalesce((SELECT jsonb_agg(to_jsonb(x)||jsonb_build_object('outcome',coalesce((SELECT to_jsonb(t) FROM public.project_submittals t WHERE t.id=x.submittal_id),(SELECT to_jsonb(t) FROM public.project_milestones t WHERE t.id=x.milestone_id))) ORDER BY x.id) FROM public.funding_award_handoff_occurrences x WHERE x.revision_id=a.current_handoff_revision_id AND x.requirement->>'disposition'<>'withdraw'),'[]'),
  'legacyObligations',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.project_milestones m WHERE m.funding_award_id=a.id AND m.project_id=a.project_id AND m.milestone_type='obligation' AND m.handoff_origin_revision_id IS NULL),'[]'),
  'invoices',coalesce((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('amount',i.amount::text,'retention_amount',i.retention_amount::text,'net_amount',i.net_amount::text) ORDER BY i.id) FROM public.billing_invoice_records i WHERE i.funding_award_id=a.id),'[]'));
END $$;
REVOKE ALL ON FUNCTION public.award_handoff_state(uuid,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.award_handoff_state(uuid,uuid,uuid,jsonb) TO service_role;

CREATE FUNCTION public.handoff_validate_terms(t jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE x jsonb; field text; c numeric;
BEGIN
 IF coalesce(t->'issuanceDisposition'->>'state','') NOT IN ('issued','rescinded','corrected') OR coalesce(length(trim(t->'issuanceDisposition'->>'evidence')),0)=0 THEN RAISE EXCEPTION 'Current funder disposition requires actual notice evidence' USING ERRCODE='22023'; END IF;
 IF t->>'issued' IS DISTINCT FROM 'true' OR jsonb_array_length(t->'sources')<1 OR t->>'effective' NOT IN ('true','false') THEN RAISE EXCEPTION 'Actual notice and effective-source choice required' USING ERRCODE='22023'; END IF;
 FOREACH field IN ARRAY ARRAY['ceiling','match'] LOOP
  IF coalesce(t->>field,'') !~ '^\d+(\.\d{1,2})?$' THEN RAISE EXCEPTION 'Exact actual money required' USING ERRCODE='22023'; END IF;
  c:=(t->>field)::numeric; IF c>999999999999.99 THEN RAISE EXCEPTION 'Award NUMERIC(14,2) limit exceeded' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF t->'currency'->>'code' IN ('BHD','IQD','JOD','KWD','LYD','OMR','TND','CLF','UYW','JPY','KRW','VND','CLP','PYG','RWF','UGX','VUV','XAF','XOF','XPF','BIF','DJF','GNF','KMF') THEN RAISE EXCEPTION 'Currency precision is not supported by the cent store' USING ERRCODE='22023'; END IF;
 IF coalesce(t->'currency'->>'code','') !~ '^[A-Z]{3}$' OR t->'currency'->>'minorUnits' IS DISTINCT FROM '2' OR coalesce(length(trim(t->'currency'->>'source')),0)=0 THEN RAISE EXCEPTION 'Explicit source-confirmed cent currency required; unsupported precision refuses' USING ERRCODE='22023'; END IF;
 FOREACH field IN ARRAY ARRAY['recipient','funder','scope','differences','commitments','applicability','submissionReceipt','scheduleCoverage','effectiveEvidence','acceptanceEvidence'] LOOP
  IF coalesce(length(trim(t->>field)),0)=0 THEN RAISE EXCEPTION 'Complete actual terms or explicit unresolved qualification required: %',field USING ERRCODE='22023'; END IF;
 END LOOP;
 IF t->>'acceptance' NOT IN ('not_recorded','pending','accepted','declined') OR t->'authorization'->>'state' NOT IN ('not_recorded','not_authorized','authorized') THEN RAISE EXCEPTION 'Independent acceptance and authorization states required' USING ERRCODE='22023'; END IF;
 IF t->'authorization'->>'amount' IS NOT NULL AND coalesce(t->'authorization'->>'amountCurrencyCode','') !~ '^[A-Z]{3}$' THEN RAISE EXCEPTION 'Authorization amount requires its independently recorded currency' USING ERRCODE='22023'; END IF;
 IF t->'authorization'->>'amount' IS NOT NULL AND (coalesce(t->'authorization'->>'amount','') !~ '^\d+(\.\d{1,2})?$' OR (t->'authorization'->>'amount')::numeric>999999999999.99) THEN RAISE EXCEPTION 'Invalid independently sourced authorization amount' USING ERRCODE='22023'; END IF;
 FOREACH field IN ARRAY ARRAY['unknownReason','authority','scope','period','evidence'] LOOP
  IF coalesce(length(trim(t->'authorization'->>field)),0)=0 THEN RAISE EXCEPTION 'State authorization evidence or its unresolved qualification' USING ERRCODE='22023'; END IF;
 END LOOP;
 IF t->>'acceptance' IN ('accepted','declined') AND (coalesce(t->>'acceptanceEvidence','') ~* 'not recorded|unresolved|unknown' OR NOT EXISTS(SELECT FROM jsonb_array_elements(t->'sources') s WHERE s->>'id'=t->>'acceptanceSourceId')) THEN RAISE EXCEPTION 'Acceptance/decline requires actual retained evidence' USING ERRCODE='22023'; END IF;
 IF t->'authorization'->>'state'<>'not_recorded' OR t->'authorization'->>'amount' IS NOT NULL THEN
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(t->'sources') s WHERE s->>'id'=t->'authorization'->>'sourceId') OR concat_ws(' ',t->'authorization'->>'authority',t->'authorization'->>'scope',t->'authorization'->>'period',t->'authorization'->>'evidence') ~* 'not recorded|unresolved|unknown' THEN RAISE EXCEPTION 'Authorization facts require actual retained authority/scope/period evidence' USING ERRCODE='22023'; END IF;
 END IF;
 IF NOT EXISTS(SELECT FROM jsonb_array_elements(t->'sources') s WHERE s->>'id'=t->>'noticeSourceId' AND s->>'family'='kb_pdf') THEN RAISE EXCEPTION 'Actual notice PDF required' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(t->'sources') s GROUP BY s->>'family',s->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'Select each retained PDF once' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(t->'occurrences') x GROUP BY x->>'conditionKey',x->>'occurrenceKey' HAVING count(*)>1) THEN RAISE EXCEPTION 'Duplicate occurrence identity' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements(t->'occurrences') x GROUP BY x->>'requirement',x->'clock' HAVING count(*)>1 AND count(DISTINCT x->>'distinctSourceIdentity')<>count(*)) THEN RAISE EXCEPTION 'Duplicate dates/requirements need explicit distinct source identities' USING ERRCODE='22023'; END IF;
 IF (SELECT count(*) FROM jsonb_array_elements(t->'occurrences') x WHERE x->>'kind'='obligation' AND x->>'disposition'<>'withdraw')>1 THEN RAISE EXCEPTION 'One obligation milestone per award; retain further clocks unresolved' USING ERRCODE='22023'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(t->'occurrences') LOOP
  IF coalesce(x->>'conditionKey','') !~ '^[a-zA-Z0-9._-]{1,100}$' OR coalesce(x->>'occurrenceKey','') !~ '^[a-zA-Z0-9._-]{1,100}$' OR x->>'kind' NOT IN ('report','obligation','expenditure') OR x->>'disposition' NOT IN ('new','carry','reschedule','replace','reopen','withdraw','adopt_legacy') THEN RAISE EXCEPTION 'Invalid occurrence identity or disposition' USING ERRCODE='22023'; END IF;
  FOREACH field IN ARRAY ARRAY['requirement','responsibleParty','citation','reason','distinctSourceIdentity'] LOOP
   IF coalesce(length(trim(x->>field)),0)=0 THEN RAISE EXCEPTION 'Complete occurrence and source identity required' USING ERRCODE='22023'; END IF;
  END LOOP;
  IF x->'clock'->>'kind'='date_only' THEN
   IF (x->'clock'->>'date')::date::text IS DISTINCT FROM x->'clock'->>'date' THEN RAISE EXCEPTION 'Invalid date-only clock' USING ERRCODE='22023'; END IF;
  ELSIF x->'clock'->>'kind'='instant' THEN
   IF x->'clock'->>'value' !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' OR coalesce(length(x->'clock'->>'sourceZone'),0)=0 OR coalesce(length(x->'clock'->>'calendarDateBasis'),0)=0 THEN RAISE EXCEPTION 'Original offset/source zone and source calendar projection required' USING ERRCODE='22023'; END IF;
   PERFORM (x->'clock'->>'value')::timestamptz; PERFORM (x->'clock'->>'calendarDate')::date;
  ELSIF x->'clock'->>'kind'<>'unresolved_trigger' OR coalesce(length(x->'clock'->>'trigger'),0)=0 THEN RAISE EXCEPTION 'Typed clock required' USING ERRCODE='22023'; END IF;
 END LOOP;
END $$;

CREATE FUNCTION public.award_handoff_command(p_actor uuid,p_award uuid,p_operation text,p_payload jsonb,p_hash text DEFAULT NULL,p_verified jsonb DEFAULT '[]') RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.funding_awards; r public.funding_award_handoff_revisions; t jsonb; state jsonb; reviewed jsonb; h text; rid uuid:=gen_random_uuid(); seq integer; receipt jsonb; x jsonb; src jsonb; prior public.funding_award_handoff_occurrences; sid uuid; mid uuid; oid uuid; outcome jsonb; due date; obligation timestamptz; expenditure timestamptz;
BEGIN
 IF current_user NOT IN ('service_role','postgres') OR p_actor IS NULL THEN RAISE EXCEPTION 'Server actor required' USING ERRCODE='42501'; END IF;
 -- Before row locks, take the same statement-level mutex as every affected writer.
 PERFORM pg_advisory_xact_lock(713,1);
 SELECT * INTO STRICT a FROM public.funding_awards WHERE id=p_award;
 PERFORM pg_advisory_xact_lock(hashtextextended(a.workspace_id::text,713));
 PERFORM FROM public.workspace_members WHERE workspace_id=a.workspace_id AND user_id=p_actor AND role IN ('owner','admin','member') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current programs writer required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.funding_awards WHERE id=p_award FOR UPDATE;
 IF p_operation='apply' THEN
  SELECT * INTO r FROM public.funding_award_handoff_revisions WHERE workspace_id=a.workspace_id AND request_key=(p_payload->>'requestKey')::uuid;
  IF r.id IS NOT NULL THEN
   IF r.award_id<>a.id OR r.actor_id<>p_actor OR r.reviewed_payload IS DISTINCT FROM p_payload OR r.reviewed_hash IS DISTINCT FROM p_hash THEN RAISE EXCEPTION 'Request key reused with changed actor/payload' USING ERRCODE='PT409'; END IF;
   RETURN r.receipt;
  END IF;
  t:=p_payload->'terms';
 ELSE t:=p_payload->'terms'; END IF;
 PERFORM public.handoff_validate_terms(t);
 IF t->'issuanceDisposition'->>'state' IN ('rescinded','corrected') AND NOT EXISTS(SELECT FROM public.funding_award_handoff_revisions prior WHERE prior.id=(t->'issuanceDisposition'->>'priorRevisionId')::uuid AND prior.award_id=a.id) THEN RAISE EXCEPTION 'Correction/rescission must link this awards earlier retained issuance' USING ERRCODE='22023'; END IF;
 state:=public.award_handoff_state(p_actor,a.id,(p_payload->>'opportunityId')::uuid,t->'sources');
 IF p_operation='preview' THEN
  reviewed:=jsonb_build_object('schemaVersion',1,'requestKey',(p_payload->>'requestKey')::uuid,'opportunityId',p_payload->>'opportunityId','state',state,'terms',t);
  h:=encode(sha256(convert_to(reviewed::text,'UTF8')),'hex');
  RETURN jsonb_build_object('reviewed',reviewed,'reviewHash',h);
 END IF;
 IF p_operation<>'apply' THEN RAISE EXCEPTION 'Unknown handoff operation' USING ERRCODE='22023'; END IF;
 h:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
 IF p_hash IS DISTINCT FROM h OR p_payload->'state' IS DISTINCT FROM state THEN RAISE EXCEPTION 'Sources, outcomes or terms pointers changed; review again' USING ERRCODE='PT409'; END IF;
 IF jsonb_array_length(p_verified)<>jsonb_array_length(state->'sources') OR EXISTS(SELECT FROM jsonb_array_elements(state->'sources') s WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(p_verified) v WHERE v->>'id'=s->>'id' AND v->>'checksum'=s->>'checksum' AND v->>'byteSize'=s->>'byteSize' AND v->'objectIdentity'=s->'objectIdentity')) THEN RAISE EXCEPTION 'Server byte verification required' USING ERRCODE='22023'; END IF;
 IF (t->>'effective')::boolean AND a.spending_status='fully_spent' THEN RAISE EXCEPTION 'Explicitly reopen the closed award before changing effective terms' USING ERRCODE='22023'; END IF;
 -- Complete current set must be reconciled, including withdrawn requirements.
 IF (t->>'effective')::boolean AND EXISTS(SELECT FROM jsonb_array_elements(state->'occurrences') old WHERE NOT EXISTS(SELECT FROM jsonb_array_elements(t->'occurrences') n WHERE n->>'priorOccurrenceId'=old->>'id')) THEN RAISE EXCEPTION 'Reconcile every current occurrence, including withdrawals' USING ERRCODE='22023'; END IF;
 seq:=coalesce((SELECT max(sequence) FROM public.funding_award_handoff_revisions WHERE award_id=a.id),0)+1;
 receipt:=jsonb_build_object('revisionId',rid,'awardId',a.id,'sequence',seq,'requestKey',p_payload->>'requestKey','reviewHash',h,'effective',(t->>'effective')::boolean,'amountMeaning','recorded_award_ceiling');
 INSERT INTO public.funding_award_handoff_revisions(id,workspace_id,project_id,opportunity_id,award_id,sequence,predecessor_id,request_key,reviewed_hash,reviewed_payload,proposal,proposal_hash,terms,receipt,actor_id)
 VALUES(rid,a.workspace_id,a.project_id,(p_payload->>'opportunityId')::uuid,a.id,seq,a.latest_handoff_revision_id,(p_payload->>'requestKey')::uuid,h,p_payload,state->'proposal',encode(sha256(convert_to((state->'proposal')::text,'UTF8')),'hex'),t,receipt,p_actor);
 PERFORM set_config('openplan.award_handoff_command',rid::text,true);
 FOR src IN SELECT value FROM jsonb_array_elements(state->'sources') LOOP
  INSERT INTO public.funding_award_handoff_sources(revision_id,family,source_id,kb_document_id,export_id,bucket,object_name,object_identity,checksum,byte_size,receipt)
  VALUES(rid,src->>'family',(src->>'id')::uuid,CASE WHEN src->>'family'='kb_pdf' THEN (src->>'id')::uuid END,CASE WHEN src->>'family'='application_pdf' THEN (src->>'id')::uuid END,src->>'bucket',src->>'objectName',src->'objectIdentity',src->>'checksum',(src->>'byteSize')::bigint,src);
 END LOOP;
 IF (t->>'effective')::boolean THEN
  FOR x IN SELECT value FROM jsonb_array_elements(t->'occurrences') LOOP
   sid:=NULL; mid:=NULL; outcome:=NULL; prior:=NULL;
   IF x->>'disposition'='adopt_legacy' THEN
    IF x->>'kind'<>'obligation' OR x->>'priorOccurrenceId' IS NOT NULL OR x->>'legacyObligationId' IS NULL OR x->>'fulfillmentStillApplies' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Explicit legacy obligation and applicability review required' USING ERRCODE='22023'; END IF;
    SELECT id,to_jsonb(m) INTO mid,outcome FROM public.project_milestones m WHERE m.id=(x->>'legacyObligationId')::uuid AND m.funding_award_id=a.id AND m.project_id=a.project_id AND m.milestone_type='obligation' AND m.handoff_origin_revision_id IS NULL;
    IF mid IS NULL THEN RAISE EXCEPTION 'Selected legacy obligation is unavailable or already managed' USING ERRCODE='PT409'; END IF;
   ELSIF x->>'legacyObligationId' IS NOT NULL THEN RAISE EXCEPTION 'Legacy selection requires explicit adoption' USING ERRCODE='22023'; END IF;
   IF x->>'disposition'='new' AND x->>'priorOccurrenceId' IS NOT NULL THEN RAISE EXCEPTION 'New work cannot replace an existing occurrence without a reviewed disposition' USING ERRCODE='22023'; END IF;
   IF x->>'priorOccurrenceId' IS NOT NULL THEN
    SELECT * INTO prior FROM public.funding_award_handoff_occurrences WHERE id=(x->>'priorOccurrenceId')::uuid AND revision_id=a.current_handoff_revision_id AND award_id=a.id;
    IF prior.id IS NULL THEN RAISE EXCEPTION 'Prior occurrence is not current for this award' USING ERRCODE='22023'; END IF;
    IF x->>'disposition' IN ('carry','reschedule','reopen','withdraw') AND (x->>'conditionKey'<>prior.condition_key OR x->>'occurrenceKey'<>prior.occurrence_key) THEN RAISE EXCEPTION 'Retain stable occurrence identity' USING ERRCODE='22023'; END IF;
    IF x->>'disposition'='replace' AND x->>'conditionKey'=prior.condition_key AND x->>'occurrenceKey'=prior.occurrence_key THEN RAISE EXCEPTION 'Replacement requires a new occurrence key' USING ERRCODE='22023'; END IF;
    IF x->>'disposition' IN ('carry','reschedule') THEN
     IF (x-'disposition'-'priorOccurrenceId'-'reason'-'fulfillmentStillApplies'-'clock'-'legacyObligationId') IS DISTINCT FROM (prior.requirement-'disposition'-'priorOccurrenceId'-'reason'-'fulfillmentStillApplies'-'clock'-'legacyObligationId') OR (x->>'disposition'='carry' AND x->'clock' IS DISTINCT FROM prior.requirement->'clock') THEN RAISE EXCEPTION 'Changed work needs explicit replacement/reopen/withdrawal' USING ERRCODE='22023'; END IF;
     sid:=prior.submittal_id; mid:=prior.milestone_id;
     outcome:=coalesce((SELECT to_jsonb(s) FROM public.project_submittals s WHERE id=sid),(SELECT to_jsonb(m) FROM public.project_milestones m WHERE id=mid));
     IF x->>'disposition'='reschedule' AND coalesce(outcome->>'status','') IN ('submitted','accepted','complete') AND x->>'fulfillmentStillApplies' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Resolve applicability of completed work before rescheduling' USING ERRCODE='22023'; END IF;
    END IF;
   ELSIF x->>'disposition' NOT IN ('new','adopt_legacy') THEN RAISE EXCEPTION 'Prior occurrence required' USING ERRCODE='22023'; END IF;
   IF prior.id IS NOT NULL AND outcome IS NULL THEN outcome:=coalesce((SELECT to_jsonb(s) FROM public.project_submittals s WHERE id=prior.submittal_id),(SELECT to_jsonb(m) FROM public.project_milestones m WHERE id=prior.milestone_id)); END IF;
   due:=CASE x->'clock'->>'kind' WHEN 'date_only' THEN (x->'clock'->>'date')::date WHEN 'instant' THEN (x->'clock'->>'calendarDate')::date END;
   IF x->>'kind'='obligation' AND x->>'disposition'='new' AND EXISTS(SELECT FROM public.project_milestones WHERE funding_award_id=a.id AND milestone_type='obligation') THEN RAISE EXCEPTION 'Explicitly adopt the existing legacy obligation; unresolved clocks cannot omit its actual fulfillment' USING ERRCODE='22023'; END IF;
   -- Reopened/replacement work has one target even while its date is unresolved.
   IF x->>'disposition'<>'withdraw' AND (due IS NOT NULL OR x->>'disposition' IN ('reopen','replace','adopt_legacy')) THEN
    IF x->>'kind'='report' AND sid IS NULL THEN
     sid:=gen_random_uuid();
     INSERT INTO public.project_submittals(id,project_id,title,submittal_type,status,due_date,notes,created_by,funding_award_id,handoff_origin_revision_id,handoff_condition_key,handoff_occurrence_key)
     VALUES(sid,a.project_id,x->>'requirement','progress_report','draft',due,x->>'citation',p_actor,a.id,rid,x->>'conditionKey',x->>'occurrenceKey');
    ELSIF x->>'kind'='obligation' THEN
     -- A completed original obligation remains fulfilled. Reopened/replacement
     -- work is a new schedule record linked to its immutable prior occurrence.
     IF mid IS NULL AND EXISTS(SELECT FROM public.project_milestones WHERE funding_award_id=a.id AND milestone_type='obligation') AND x->>'disposition' NOT IN ('reopen','replace') THEN RAISE EXCEPTION 'Select explicit legacy adoption or reconcile the current obligation' USING ERRCODE='22023'; END IF;
     IF mid IS NULL THEN
      mid:=gen_random_uuid(); INSERT INTO public.project_milestones(id,project_id,title,milestone_type,status,target_date,created_by,funding_award_id,handoff_origin_revision_id,handoff_condition_key,handoff_occurrence_key)
      VALUES(mid,a.project_id,x->>'requirement',CASE WHEN x->>'disposition' IN ('reopen','replace') AND EXISTS(SELECT FROM public.project_milestones WHERE funding_award_id=a.id AND milestone_type='obligation') THEN 'schedule' ELSE 'obligation' END,'scheduled',due,p_actor,a.id,rid,x->>'conditionKey',x->>'occurrenceKey');
     END IF;
     obligation:=CASE WHEN x->'clock'->>'kind'='instant' THEN (x->'clock'->>'value')::timestamptz ELSE due::timestamp AT TIME ZONE 'UTC' END;
    ELSIF x->>'kind'='expenditure' THEN
     IF mid IS NULL THEN
      mid:=gen_random_uuid(); INSERT INTO public.project_milestones(id,project_id,title,milestone_type,status,target_date,created_by,funding_award_id,handoff_origin_revision_id,handoff_condition_key,handoff_occurrence_key)
      VALUES(mid,a.project_id,x->>'requirement','schedule','scheduled',due,p_actor,a.id,rid,x->>'conditionKey',x->>'occurrenceKey');
     END IF;
     expenditure:=CASE WHEN x->'clock'->>'kind'='instant' THEN (x->'clock'->>'value')::timestamptz ELSE due::timestamp AT TIME ZONE 'UTC' END;
    END IF;
   END IF;
   IF x->>'disposition'<>'withdraw' THEN
    IF sid IS NOT NULL AND x->>'disposition'='reschedule' THEN UPDATE public.project_submittals SET due_date=due WHERE id=sid; END IF;
    IF mid IS NOT NULL THEN UPDATE public.project_milestones SET target_date=due,handoff_origin_revision_id=coalesce(handoff_origin_revision_id,rid),handoff_condition_key=coalesce(handoff_condition_key,x->>'conditionKey'),handoff_occurrence_key=coalesce(handoff_occurrence_key,x->>'occurrenceKey') WHERE id=mid; END IF;
    IF x->>'kind'='obligation' THEN obligation:=CASE WHEN x->'clock'->>'kind'='instant' THEN (x->'clock'->>'value')::timestamptz ELSE due::timestamp AT TIME ZONE 'UTC' END; END IF;
    IF x->>'kind'='expenditure' THEN expenditure:=CASE WHEN x->'clock'->>'kind'='instant' THEN (x->'clock'->>'value')::timestamptz ELSE due::timestamp AT TIME ZONE 'UTC' END; END IF;
   END IF;
   oid:=gen_random_uuid();
   INSERT INTO public.funding_award_handoff_occurrences(id,revision_id,award_id,project_id,workspace_id,condition_key,occurrence_key,requirement,prior_occurrence_id,submittal_id,milestone_id,outcome_snapshot)
   VALUES(oid,rid,a.id,a.project_id,a.workspace_id,x->>'conditionKey',x->>'occurrenceKey',x,prior.id,sid,mid,outcome);
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(t->'occurrences') x WHERE x->>'kind'='expenditure' AND x->>'disposition'<>'withdraw')>1 THEN expenditure:=NULL; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(t->'invoiceApplicability') LOOP
   UPDATE public.billing_invoice_records SET handoff_applicable_revision_id=rid WHERE id=(x->>'invoiceId')::uuid AND funding_award_id=a.id AND award_handoff_revision_id IS NOT NULL AND currency_code=t->'currency'->>'code';
   IF NOT FOUND THEN RAISE EXCEPTION 'Only known-currency version-bound invoices can be explicitly carried' USING ERRCODE='22023'; END IF;
  END LOOP;
 END IF;
 UPDATE public.funding_awards SET funding_opportunity_id=(p_payload->>'opportunityId')::uuid,latest_handoff_revision_id=rid,
  current_handoff_revision_id=CASE WHEN (t->>'effective')::boolean THEN rid ELSE current_handoff_revision_id END,
  awarded_amount=CASE WHEN (t->>'effective')::boolean THEN (t->>'ceiling')::numeric ELSE awarded_amount END,
  match_amount=CASE WHEN (t->>'effective')::boolean THEN (t->>'match')::numeric ELSE match_amount END,
  currency_code=CASE WHEN (t->>'effective')::boolean THEN t->'currency'->>'code' ELSE currency_code END,
  obligation_due_at=CASE WHEN (t->>'effective')::boolean THEN obligation ELSE obligation_due_at END,
  expenditure_deadline_at=CASE WHEN (t->>'effective')::boolean THEN expenditure ELSE expenditure_deadline_at END,
  has_source_backed_issuance=true,updated_at=clock_timestamp() WHERE id=a.id;
 UPDATE public.funding_opportunities SET has_source_backed_issuance=true WHERE id=(p_payload->>'opportunityId')::uuid;
 -- Invalidate stale cached posture in the transaction, before an optional later rebuild.
 UPDATE public.projects SET rtp_posture=NULL,rtp_posture_updated_at=NULL WHERE id=a.project_id;
 RETURN receipt;
END $$;
REVOKE ALL ON FUNCTION public.award_handoff_command(uuid,uuid,text,jsonb,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.award_handoff_command(uuid,uuid,text,jsonb,text,jsonb) TO service_role;

-- Statement trigger runs before PostgreSQL acquires any target row lock. This
-- avoids the row-trigger/advisory-lock inversion with ordinary UPDATE/DELETE.
CREATE FUNCTION public.handoff_statement_lock() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN PERFORM pg_advisory_xact_lock(713,1); RETURN NULL; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['funding_awards','funding_opportunities','funding_opportunity_application_sections','funding_opportunity_section_drafts','funding_opportunity_attachments','funding_opportunity_application_exports','kb_documents','billing_invoice_records','project_submittals','project_milestones','projects','project_funding_profiles','workspace_members','workspaces'] LOOP
  EXECUTE format('CREATE TRIGGER aaa_handoff_statement BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.handoff_statement_lock()',t);
 END LOOP;
END $$;

-- Program deletion updates opportunity/award children through SET NULL. Take
-- the entry mutex before locking the parent, as work-program saves already do.
CREATE TRIGGER aaa_handoff_program_delete BEFORE DELETE ON public.programs
 FOR EACH STATEMENT EXECUTE FUNCTION public.handoff_statement_lock();

-- Hard actor deletion can enter the membership cascade with its parent locked.
-- Take the mutex before that row lock, as first work-program saves already do.
CREATE TRIGGER aaa_handoff_auth_delete BEFORE DELETE ON auth.users
 FOR EACH STATEMENT EXECUTE FUNCTION public.handoff_statement_lock();

CREATE FUNCTION public.guard_handoff_award() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.funding_award_handoff_revisions; issued boolean;
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.latest_handoff_revision_id IS NOT NULL THEN RAISE EXCEPTION 'Retained award cannot be deleted' USING ERRCODE='23503'; END IF; RETURN OLD;
 END IF;
 issued:=EXISTS(SELECT FROM public.funding_award_handoff_revisions x WHERE x.award_id=NEW.id AND x.terms->>'issued'='true');
 IF NEW.has_source_backed_issuance IS DISTINCT FROM issued THEN RAISE EXCEPTION 'Issuance derives from retained notices' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND OLD.latest_handoff_revision_id IS NOT NULL THEN
  IF ROW(NEW.project_id,NEW.workspace_id,NEW.funding_opportunity_id) IS DISTINCT FROM ROW(OLD.project_id,OLD.workspace_id,OLD.funding_opportunity_id) THEN RAISE EXCEPTION 'Managed award scope cannot be rebound' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.awarded_amount,NEW.match_amount,NEW.currency_code,NEW.obligation_due_at,NEW.expenditure_deadline_at,NEW.current_handoff_revision_id,NEW.latest_handoff_revision_id)
   IS DISTINCT FROM ROW(OLD.awarded_amount,OLD.match_amount,OLD.currency_code,OLD.obligation_due_at,OLD.expenditure_deadline_at,OLD.current_handoff_revision_id,OLD.latest_handoff_revision_id)
   AND NOT coalesce((current_setting('role',true) IN ('service_role','postgres','none') AND current_setting('openplan.award_handoff_command',true)=NEW.latest_handoff_revision_id::text),false) THEN RAISE EXCEPTION 'Revise the award handoff to change controlled terms' USING ERRCODE='23514'; END IF;
  IF ((NEW.spending_status='fully_spent') IS DISTINCT FROM (OLD.spending_status='fully_spent') OR ROW(NEW.closure_basis,NEW.closed_at,NEW.reopened_at) IS DISTINCT FROM ROW(OLD.closure_basis,OLD.closed_at,OLD.reopened_at))
   AND NOT coalesce((current_setting('role',true) IN ('service_role','postgres','none') AND current_setting('openplan.award_closure_command',true)=NEW.id::text),false) THEN RAISE EXCEPTION 'Managed closure/reopen requires the version-bound transaction' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.current_handoff_revision_id IS NOT NULL THEN
  SELECT * INTO r FROM public.funding_award_handoff_revisions WHERE id=NEW.current_handoff_revision_id AND award_id=NEW.id;
  IF r.id IS NULL OR r.terms->>'effective'<>'true' OR NEW.awarded_amount IS DISTINCT FROM (r.terms->>'ceiling')::numeric OR NEW.match_amount IS DISTINCT FROM (r.terms->>'match')::numeric OR NEW.currency_code IS DISTINCT FROM r.terms->'currency'->>'code' THEN RAISE EXCEPTION 'Award projection must match effective terms' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER handoff_award_guard BEFORE INSERT OR UPDATE OR DELETE ON public.funding_awards FOR EACH ROW EXECUTE FUNCTION public.guard_handoff_award();
CREATE FUNCTION public.guard_handoff_opportunity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.has_source_backed_issuance IS DISTINCT FROM EXISTS(SELECT FROM public.funding_award_handoff_revisions r WHERE r.opportunity_id=NEW.id AND r.terms->>'issued'='true') THEN RAISE EXCEPTION 'Issuance is independent of pursuit/status and derives across every retained award' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER handoff_issuance_guard BEFORE INSERT OR UPDATE ON public.funding_opportunities FOR EACH ROW EXECUTE FUNCTION public.guard_handoff_opportunity();

CREATE FUNCTION public.guard_handoff_record() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; r uuid; old_json jsonb; new_json jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN r:=OLD.handoff_origin_revision_id; a:=OLD.funding_award_id; old_json:=to_jsonb(OLD); END IF;
 IF TG_OP<>'DELETE' THEN r:=coalesce(r,NEW.handoff_origin_revision_id); a:=coalesce(a,NEW.funding_award_id); new_json:=to_jsonb(NEW); END IF;
 IF r IS NOT NULL THEN
  IF NOT coalesce((current_setting('role',true) IN ('service_role','postgres','none') AND EXISTS(SELECT FROM public.funding_award_handoff_revisions rev WHERE rev.id::text=current_setting('openplan.award_handoff_command',true) AND rev.award_id=a)),false) THEN
   IF TG_OP<>'UPDATE' OR (new_json-'status'-'submitted_at'-'review_cycle'-'notes'-'owner_label'-'assignee_user_id'-'actual_date'-'updated_at') IS DISTINCT FROM (old_json-'status'-'submitted_at'-'review_cycle'-'notes'-'owner_label'-'assignee_user_id'-'actual_date'-'updated_at') THEN RAISE EXCEPTION 'Source schedule and occurrence origin require a reviewed handoff revision; outcomes remain editable' USING ERRCODE='23514'; END IF;
  END IF;
  IF NOT EXISTS(SELECT FROM public.funding_awards aw WHERE aw.id=a AND aw.project_id=(coalesce(new_json,old_json)->>'project_id')::uuid) THEN RAISE EXCEPTION 'Award/project record mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER handoff_record_guard BEFORE INSERT OR UPDATE OR DELETE ON public.project_submittals FOR EACH ROW EXECUTE FUNCTION public.guard_handoff_record();
CREATE TRIGGER handoff_record_guard BEFORE INSERT OR UPDATE OR DELETE ON public.project_milestones FOR EACH ROW EXECUTE FUNCTION public.guard_handoff_record();

-- Current links, including carried earlier-origin records, control actionable work.
CREATE VIEW public.current_award_handoff_records WITH(security_invoker=true) AS
 SELECT o.*,r.terms FROM public.funding_award_handoff_occurrences o JOIN public.funding_awards a ON a.current_handoff_revision_id=o.revision_id JOIN public.funding_award_handoff_revisions r ON r.id=o.revision_id
 WHERE o.requirement->>'disposition'<>'withdraw';
GRANT SELECT ON public.current_award_handoff_records TO authenticated,service_role;

CREATE FUNCTION public.guard_handoff_invoice() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.funding_awards; aid uuid; new_a uuid; old_a uuid;
BEGIN
 IF TG_OP<>'INSERT' THEN old_a:=OLD.funding_award_id; END IF;
 IF TG_OP<>'DELETE' THEN new_a:=NEW.funding_award_id; END IF;
 FOR aid IN SELECT DISTINCT x FROM unnest(ARRAY[old_a,new_a]) x WHERE x IS NOT NULL ORDER BY x LOOP
  SELECT * INTO a FROM public.funding_awards WHERE id=aid FOR UPDATE;
  IF a.latest_handoff_revision_id IS NOT NULL AND a.spending_status='fully_spent' THEN RAISE EXCEPTION 'Explicitly reopen before changing a managed closed award invoice set' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 SELECT * INTO a FROM public.funding_awards WHERE id=NEW.funding_award_id;
  IF TG_OP='UPDATE' AND OLD.award_handoff_revision_id IS NOT NULL AND ROW(NEW.funding_award_id,NEW.award_handoff_revision_id,NEW.currency_code) IS DISTINCT FROM ROW(OLD.funding_award_id,OLD.award_handoff_revision_id,OLD.currency_code) THEN RAISE EXCEPTION 'Retain invoice original terms; record applicability through amendment' USING ERRCODE='23514'; END IF;
 IF NEW.award_handoff_revision_id IS NOT NULL THEN
  IF NEW.retention_amount>NEW.amount OR NEW.net_amount IS DISTINCT FROM NEW.amount-NEW.retention_amount THEN RAISE EXCEPTION 'Exact invoice gross/retention/net must reconcile' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT FROM public.funding_award_handoff_revisions r WHERE r.id=NEW.award_handoff_revision_id AND r.award_id=NEW.funding_award_id AND r.project_id=NEW.project_id AND r.workspace_id=NEW.workspace_id AND r.terms->'currency'->>'code'=NEW.currency_code) THEN RAISE EXCEPTION 'Invoice version/currency/scope mismatch' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' OR NEW.funding_award_id IS DISTINCT FROM OLD.funding_award_id OR NEW.award_handoff_revision_id IS DISTINCT FROM OLD.award_handoff_revision_id THEN
   IF NEW.award_handoff_revision_id IS DISTINCT FROM a.current_handoff_revision_id THEN RAISE EXCEPTION 'Invoice terms are stale; review current terms' USING ERRCODE='PT409'; END IF;
  END IF;
 ELSIF a.latest_handoff_revision_id IS NOT NULL AND (TG_OP='INSERT' OR NEW.funding_award_id IS DISTINCT FROM OLD.funding_award_id) THEN RAISE EXCEPTION 'Review current terms and explicitly bind the invoice' USING ERRCODE='22023'; END IF;
 IF NEW.handoff_applicable_revision_id IS DISTINCT FROM (CASE WHEN TG_OP='UPDATE' THEN OLD.handoff_applicable_revision_id END) AND NOT EXISTS(SELECT FROM public.funding_award_handoff_revisions r WHERE r.id=NEW.handoff_applicable_revision_id AND r.award_id=NEW.funding_award_id AND r.id::text=current_setting('openplan.award_handoff_command',true) AND current_setting('role',true) IN ('service_role','postgres','none')) THEN RAISE EXCEPTION 'Invoice applicability requires reviewed amendment' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER handoff_invoice_guard BEFORE INSERT OR UPDATE OR DELETE ON public.billing_invoice_records FOR EACH ROW EXECUTE FUNCTION public.guard_handoff_invoice();

CREATE FUNCTION public.managed_award_closeout(p_actor uuid,p_award uuid,p_expected uuid,p_event text,p_note text) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.funding_awards; paid numeric:=0; basis jsonb; result jsonb; closure_id uuid:=gen_random_uuid();
BEGIN
 IF current_user NOT IN ('service_role','postgres') OR p_actor IS NULL THEN RAISE EXCEPTION 'Server actor required' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(713,1);
 SELECT * INTO STRICT a FROM public.funding_awards WHERE id=p_award;
 PERFORM FROM public.workspace_members WHERE workspace_id=a.workspace_id AND user_id=p_actor AND role IN ('owner','admin','member') FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Current programs writer required' USING ERRCODE='42501'; END IF;
 SELECT * INTO STRICT a FROM public.funding_awards WHERE id=p_award FOR UPDATE;
 IF (p_event<>'reopen' AND a.current_handoff_revision_id IS NULL) OR a.current_handoff_revision_id IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Review current effective terms before closing or reopening' USING ERRCODE='PT409'; END IF;
 PERFORM FROM public.billing_invoice_records WHERE funding_award_id=a.id ORDER BY id FOR UPDATE;
 basis:=jsonb_build_object('previousClosure',jsonb_build_object('basis',a.closure_basis,'closedAt',a.closed_at,'note',a.closure_note),'expectedCurrent',p_expected,'note',p_note);
 IF p_event='earned_coverage' THEN
  IF a.spending_status='fully_spent' THEN RETURN jsonb_build_object('status','already_closed','awardId',a.id,'revisionId',p_expected,'closureBasis',a.closure_basis); END IF;
  IF a.awarded_amount<=0 OR a.currency_code IS NULL OR EXISTS(SELECT FROM public.billing_invoice_records i WHERE i.funding_award_id=a.id AND i.status='paid' AND (i.currency_code IS DISTINCT FROM a.currency_code OR i.award_handoff_revision_id IS NULL OR i.retention_amount>i.amount OR i.net_amount IS DISTINCT FROM i.amount-i.retention_amount OR NOT coalesce((i.award_handoff_revision_id=p_expected OR i.handoff_applicable_revision_id=p_expected),false))) THEN RAISE EXCEPTION 'Paid coverage is unassessed: require positive recorded ceiling, known matching currency and applicable version for every paid row' USING ERRCODE='22023'; END IF;
  SELECT coalesce(sum(net_amount),0) INTO paid FROM public.billing_invoice_records WHERE funding_award_id=a.id AND status='paid';
  IF paid<a.awarded_amount THEN RAISE EXCEPTION 'Paid coverage is below the recorded award ceiling' USING ERRCODE='22023'; END IF;
  basis:=basis||jsonb_build_object('ceiling',a.awarded_amount::text,'paid',paid::text,'currency',a.currency_code,'invoices',coalesce((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('amount',i.amount::text,'net_amount',i.net_amount::text) ORDER BY i.id) FROM public.billing_invoice_records i WHERE i.funding_award_id=a.id AND i.status='paid'),'[]'));
 ELSIF p_event='reopen' THEN
  IF a.spending_status<>'fully_spent' OR coalesce(length(trim(p_note)),0)=0 THEN RAISE EXCEPTION 'Reopen requires a closed award and reason' USING ERRCODE='22023'; END IF;
 ELSE RAISE EXCEPTION 'Managed awards support earned closeout or explicit reopen' USING ERRCODE='22023'; END IF;
 INSERT INTO public.funding_award_closure_receipts(id,award_id,workspace_id,revision_id,event,basis,actor_id) VALUES(closure_id,a.id,a.workspace_id,p_expected,p_event,basis,p_actor);
 PERFORM set_config('openplan.award_closure_command',a.id::text,true);
 IF p_event='earned_coverage' THEN
  UPDATE public.funding_awards SET spending_status='fully_spent',closure_basis='earned_coverage',closed_at=clock_timestamp(),closed_by=p_actor,closure_note=p_note WHERE id=a.id;
  INSERT INTO public.project_milestones(project_id,title,milestone_type,status,actual_date,created_by,funding_award_id) VALUES(a.project_id,'Paid coverage against recorded award ceiling','closeout','complete',current_date,p_actor,a.id);
 ELSE
  UPDATE public.funding_awards SET spending_status='active',closure_basis=NULL,closed_at=NULL,closed_by=NULL,closure_note=NULL,reopened_at=clock_timestamp(),reopened_by=p_actor,reopen_reason=p_note WHERE id=a.id;
 END IF;
 UPDATE public.projects SET rtp_posture=NULL,rtp_posture_updated_at=NULL WHERE id=a.project_id;
 result:=jsonb_build_object('awardId',a.id,'revisionId',p_expected,'closureReceiptId',closure_id,'status',CASE WHEN p_event='reopen' THEN 'reopened' ELSE 'closed' END,'paid',paid::text,'closedAt',CASE WHEN p_event='earned_coverage' THEN clock_timestamp() END,'priorClosureBasis',a.closure_basis);
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.managed_award_closeout(uuid,uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.managed_award_closeout(uuid,uuid,uuid,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.handoff_validate_terms(jsonb),public.handoff_ordinary_pdf(public.kb_documents),public.handoff_immutable(),public.guard_handoff_source_object(),public.guard_handoff_source_row(),public.handoff_writer_lock(),public.handoff_statement_lock(),public.guard_handoff_award(),public.guard_handoff_opportunity(),public.guard_handoff_record(),public.guard_handoff_invoice() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.handoff_validate_terms(jsonb),public.handoff_ordinary_pdf(public.kb_documents) TO service_role;

-- Read current per-revision links rather than original record revision. Carried
-- submitted/accepted work keeps the same row and is excluded by existing states.
CREATE VIEW public.active_project_submittals WITH(security_invoker=true) AS
 SELECT s.* FROM public.project_submittals s WHERE s.handoff_origin_revision_id IS NULL OR EXISTS(SELECT FROM public.current_award_handoff_records o WHERE o.submittal_id=s.id);
CREATE VIEW public.active_project_milestones WITH(security_invoker=true) AS
 SELECT m.* FROM public.project_milestones m WHERE m.handoff_origin_revision_id IS NULL OR EXISTS(SELECT FROM public.current_award_handoff_records o WHERE o.milestone_id=m.id);
-- Pending first versions retain history without replacing the ordinary calendar.
CREATE VIEW public.legacy_calendar_funding_awards WITH(security_invoker=true) AS SELECT a.* FROM public.funding_awards a WHERE a.current_handoff_revision_id IS NULL;
GRANT SELECT ON public.active_project_submittals,public.active_project_milestones,public.legacy_calendar_funding_awards TO authenticated,service_role;
CREATE VIEW public.funding_award_handoff_fulfillment WITH(security_invoker=true) AS
 SELECT o.id,o.award_id,o.revision_id,o.condition_key,o.occurrence_key,o.submittal_id,o.milestone_id,o.requirement,
 s.status AS submittal_status,s.submitted_at,coalesce(s.notes,m.notes) AS fulfillment_evidence,m.status AS milestone_status,m.actual_date
 FROM public.current_award_handoff_records o LEFT JOIN public.project_submittals s ON s.id=o.submittal_id LEFT JOIN public.project_milestones m ON m.id=o.milestone_id;
GRANT SELECT ON public.funding_award_handoff_fulfillment TO authenticated,service_role;
-- Any ordinary source write invalidates cached project financial posture too.
CREATE FUNCTION public.invalidate_handoff_posture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p uuid; old_p uuid; BEGIN
 IF TG_OP<>'DELETE' THEN p:=NEW.project_id; END IF;
 IF TG_OP<>'INSERT' THEN old_p:=OLD.project_id; END IF;
 UPDATE public.projects SET rtp_posture=NULL,rtp_posture_updated_at=NULL,funding_source_epoch=funding_source_epoch+1 WHERE id IN (p,old_p);
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER handoff_posture_invalidated AFTER INSERT OR UPDATE OR DELETE ON public.funding_awards FOR EACH ROW EXECUTE FUNCTION public.invalidate_handoff_posture();
CREATE TRIGGER handoff_posture_invalidated AFTER INSERT OR UPDATE OR DELETE ON public.billing_invoice_records FOR EACH ROW EXECUTE FUNCTION public.invalidate_handoff_posture();
CREATE TRIGGER handoff_posture_invalidated AFTER INSERT OR UPDATE OR DELETE ON public.funding_opportunities FOR EACH ROW EXECUTE FUNCTION public.invalidate_handoff_posture();
CREATE TRIGGER handoff_posture_invalidated AFTER INSERT OR UPDATE OR DELETE ON public.project_funding_profiles FOR EACH ROW EXECUTE FUNCTION public.invalidate_handoff_posture();
CREATE FUNCTION public.guard_funding_source_epoch() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.funding_source_epoch IS DISTINCT FROM OLD.funding_source_epoch AND pg_trigger_depth()<2 THEN RAISE EXCEPTION 'Funding source epoch is controlled by source invalidation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER funding_source_epoch_guard BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.guard_funding_source_epoch();
REVOKE ALL ON FUNCTION public.guard_funding_source_epoch() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.invalidate_handoff_posture() FROM PUBLIC,anon,authenticated;
-- Distinct awards, never revision counts. A pending amendment or recipient
-- decline cannot remove earlier source-backed issuance. Pursuit stays independent.
CREATE VIEW public.funding_opportunity_issuance WITH(security_invoker=true) AS
 SELECT r.opportunity_id,r.workspace_id,count(DISTINCT r.award_id) AS source_backed_award_count,
 array_agg(DISTINCT r.award_id) AS award_ids
 FROM public.funding_award_handoff_revisions r WHERE r.terms->>'issued'='true' GROUP BY r.opportunity_id,r.workspace_id;
GRANT SELECT ON public.funding_opportunity_issuance TO authenticated,service_role;

-- Compose existing transaction entry points without rewriting 000001/000002 or
-- duplicating their large bodies. This list comes from the covered-row explicit
-- lock inventory, including current wrappers and retained implementation helpers.
-- Replacing the body preserves OIDs, dependency edges, ACLs and security mode.
-- Read/scope helpers do not join this mutex: provider/map scope assertions,
-- agreement retention and engagement capture can run after a caller's row lock.
-- They do not write a covered table or call a composed function. Keep their
-- existing row locks and checks, without adding a nested row -> 713 edge.
-- Import/calculation entry takes 713 before its existing 451/engagement/job locks.
DO $compose$
DECLARE f record; body text; definition text; name text;
BEGIN
 FOREACH name IN ARRAY ARRAY[
  'persist_safety_plan_generation','apply_ss4a_safety_seed','accept_workspace_invitation',
  'record_assistant_stage_gate_hold','record_assistant_project_submittal',
  'enqueue_kb_extraction','apply_kb_extraction_callback','cancel_kb_extraction',
  'save_program_work_program_revision','attach_program_work_program_source',
  'enqueue_work_program_export','finish_work_program_export','record_work_program_event',
  'enqueue_work_program_packet','record_work_program_actual','enqueue_work_program_report',
  'record_contract_command','record_contract_command_v046','record_contract_command_closeout',
  'record_contract_import','finish_contract_calculation','enqueue_contract_snapshot',
  'reuse_engagement_setup','write_engagement_response_decision_link',
  'create_project_map_package',
  'record_aerial_original_dispatch','replace_client_invoice_lines'
 ] LOOP
  IF NOT EXISTS(SELECT FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name) THEN RAISE EXCEPTION 'Missing composed lock entry: %',name; END IF;
  FOR f IN SELECT p.oid,p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE n.nspname='public' AND p.proname=name AND l.lanname='plpgsql' LOOP
   body:=regexp_replace(f.prosrc,'\mBEGIN\M',E'BEGIN\n PERFORM pg_catalog.pg_advisory_xact_lock(713,1); -- award handoff entry order','i');
   IF body=f.prosrc THEN RAISE EXCEPTION 'Cannot compose lock entry: %',name; END IF;
   definition:=replace(pg_get_functiondef(f.oid),f.prosrc,body);
   EXECUTE definition;
  END LOOP;
 END LOOP;
END $compose$;
