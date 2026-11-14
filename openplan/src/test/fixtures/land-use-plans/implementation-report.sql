CREATE FUNCTION pg_temp.report_assert(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%',message; END IF; END $$;
CREATE FUNCTION pg_temp.report_refuses(statement text, expected text, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=expected THEN RETURN; END IF;
    RAISE EXCEPTION '%: unexpected % %',message,SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION '%: accepted',message;
END $$;
CREATE FUNCTION pg_temp.report_fault() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('openplan.report_test_failure',true)=TG_TABLE_NAME THEN
    RAISE EXCEPTION USING ERRCODE='PT499',MESSAGE='Synthetic report write failure';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER report_fault AFTER INSERT ON public.reports FOR EACH ROW EXECUTE FUNCTION pg_temp.report_fault();
CREATE TRIGGER report_fault AFTER INSERT ON public.report_artifacts FOR EACH ROW EXECUTE FUNCTION pg_temp.report_fault();
CREATE TRIGGER report_fault AFTER INSERT ON public.land_use_plan_implementation_reports FOR EACH ROW EXECUTE FUNCTION pg_temp.report_fault();
CREATE TRIGGER report_fault AFTER INSERT ON public.land_use_plan_implementation_report_commands FOR EACH ROW EXECUTE FUNCTION pg_temp.report_fault();
DO $test$
DECLARE
  actor uuid:=gen_random_uuid(); other_owner uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  workspace uuid:=gen_random_uuid(); other_workspace uuid:=gen_random_uuid(); plan uuid:=gen_random_uuid(); version uuid:=gen_random_uuid();
  first_action uuid; last_action uuid; action_one uuid:=gen_random_uuid(); action_two uuid:=gen_random_uuid();
  command_id uuid:=gen_random_uuid(); snapshot_text text; snapshot_hash text; command jsonb; raw text; statement text; result jsonb; replay jsonb;
  changed jsonb; receipt_before jsonb; artifact_before jsonb; register_before jsonb; journal record; metadata jsonb;
  item jsonb; key_item text; fault text; text_item text;
BEGIN
  first_action:=least(action_one,action_two); last_action:=greatest(action_one,action_two);
  INSERT INTO auth.users(id,email) VALUES(actor,actor||'@synthetic.invalid'),(other_owner,other_owner||'@synthetic.invalid'),(viewer,viewer||'@synthetic.invalid'),(outsider,outsider||'@synthetic.invalid');
  INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC report transaction',workspace::text),(other_workspace,'SYNTHETIC other',other_workspace::text);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,other_owner,'owner'),(workspace,viewer,'viewer'),(other_workspace,actor,'owner');
  INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label)
    VALUES(plan,workspace,'SYNTHETIC plan','local-unconfigured','community','SYNTHETIC authority','SYNTHETIC area');
  INSERT INTO public.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind)
    VALUES(version,workspace,plan,1,'original');
  INSERT INTO public.land_use_plan_implementation_actions(id,workspace_id,version_id,title,status,responsible_party,description,due_on)
    VALUES(last_action,workspace,version,'SYNTHETIC later ID','deferred',NULL,NULL,NULL),
      (first_action,workspace,version,'SYNTHETIC first ID','not_started','SYNTHETIC staff','SYNTHETIC description','2026-12-01');
  -- Deliberately small native contract fixture, not a browser-produced adoption.
  snapshot_text:=format('{"designations":[],"implementationActions":[],"nodes":[],"plan":{"authorityLabel":"SYNTHETIC authority","descriptorId":"local-unconfigured","geographyLabel":"SYNTHETIC area","id":"%s","planKindKey":"community","title":"SYNTHETIC plan"},"relationships":[],"version":{"id":"%s","versionNumber":1}}',plan,version);
  snapshot_hash:=encode(extensions.digest(snapshot_text,'sha256'),'hex');
  UPDATE public.land_use_plans SET current_adopted_version_id=version WHERE id=plan;
  command:=jsonb_build_object('operation','generate','commandId',command_id,'versionId',version,'expectedVersionHash',snapshot_hash,
    'reportingPeriodStart','2026-01-01','reportingPeriodEnd','2026-10-07','title','SYNTHETIC report','summary',NULL);
  raw:=E' \n'||command::text||E'\n';
  statement:=format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,raw,snapshot_text);
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.report_refuses(statement,'PT409','working selected version');
  RESET ROLE;
  -- Seed inconsistent retained sources before freezing them. Each deliberate
  -- subtransaction rollback restores the original valid fixture and permissions.
  BEGIN
    UPDATE public.land_use_plan_versions SET state='adopted',content_hash=snapshot_hash,frozen_by=actor,frozen_snapshot='{}',frozen_at=now() WHERE id=version;
    SET LOCAL ROLE service_role;
    PERFORM pg_temp.report_refuses(statement,'PT409','stored adopted snapshot mismatch');
    RAISE EXCEPTION USING ERRCODE='PT498',MESSAGE='Restore synthetic source';
  EXCEPTION WHEN SQLSTATE 'PT498' THEN NULL; END;
  FOREACH text_item IN ARRAY ARRAY[replace(snapshot_text,plan::text,gen_random_uuid()::text),
    replace(snapshot_text,version::text,gen_random_uuid()::text),replace(snapshot_text,'"versionNumber":1','"versionNumber":2')] LOOP
    BEGIN
      UPDATE public.land_use_plan_versions SET state='adopted',frozen_by=actor,frozen_snapshot=text_item::jsonb,
        content_hash=encode(extensions.digest(text_item,'sha256'),'hex'),frozen_at=now() WHERE id=version;
      changed:=command||jsonb_build_object('expectedVersionHash',encode(extensions.digest(text_item,'sha256'),'hex'));
      SET LOCAL ROLE service_role;
      PERFORM pg_temp.report_refuses(format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,changed::text,text_item),'PT409','retained source identity mismatch');
      RAISE EXCEPTION USING ERRCODE='PT498',MESSAGE='Restore synthetic source';
    EXCEPTION WHEN SQLSTATE 'PT498' THEN NULL; END;
  END LOOP;
  UPDATE public.land_use_plan_versions SET state='adopted',frozen_snapshot=snapshot_text::jsonb,content_hash=snapshot_hash,frozen_at=now(),frozen_by=actor WHERE id=version;
  PERFORM pg_temp.report_assert(NOT has_function_privilege('authenticated','public.create_land_use_plan_implementation_report(uuid,uuid,uuid,uuid,text,text)','EXECUTE'),'authenticated RPC denied');
  PERFORM pg_temp.report_assert(NOT has_function_privilege('anon','public.create_land_use_plan_implementation_report(uuid,uuid,uuid,uuid,text,text)','EXECUTE'),'anonymous RPC denied');
  PERFORM pg_temp.report_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.create_land_use_plan_implementation_report(uuid,uuid,uuid,uuid,text,text)'::regprocedure),'invoker function');
  PERFORM pg_temp.report_assert((SELECT relrowsecurity FROM pg_class WHERE oid='public.land_use_plan_implementation_report_commands'::regclass),'journal RLS');
  PERFORM pg_temp.report_assert(NOT has_table_privilege('authenticated','public.land_use_plan_implementation_report_commands','SELECT'),'journal private');
  PERFORM pg_temp.report_assert(NOT has_table_privilege('service_role','public.land_use_plan_implementation_report_commands','UPDATE'),'journal has no update grant');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.report_refuses(statement,'42501','authenticated invocation');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.report_refuses(replace(statement,actor::text,viewer::text),'42501','viewer denied');
  PERFORM pg_temp.report_refuses(replace(statement,actor::text,outsider::text),'42501','outsider denied');
  PERFORM pg_temp.report_refuses(replace(statement,workspace::text,other_workspace::text),'PT404','foreign workspace denied');
  FOREACH text_item IN ARRAY ARRAY['{','null','[]','1',raw||repeat(' ',98305),replace(raw,'SYNTHETIC report',E'\\u0000'),replace(raw,'SYNTHETIC report',E'\\ud800')] LOOP
    PERFORM pg_temp.report_refuses(format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,text_item,snapshot_text),'PT400','invalid command JSON or length');
  END LOOP;
  FOREACH key_item IN ARRAY ARRAY['operation','commandId','versionId','expectedVersionHash','reportingPeriodStart','reportingPeriodEnd','title','summary'] LOOP
    PERFORM pg_temp.report_refuses(format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,(command-key_item)::text,snapshot_text),'PT400','missing field '||key_item);
  END LOOP;
  FOREACH item IN ARRAY ARRAY[command||'{"extra":true}',command||'{"summary":12}',command||'{"title":" "}',command||'{"title":" padded "}',
    command||'{"reportingPeriodStart":"2026-02-30"}',command||'{"reportingPeriodEnd":"2025-12-31"}',command||'{"reportingPeriodStart":"0000-01-01"}',
    command||jsonb_build_object('title',repeat('x',181)),command||jsonb_build_object('summary',repeat('x',20001)),command||jsonb_build_object('commandId',gen_random_uuid())] LOOP
    PERFORM pg_temp.report_refuses(format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,item::text,snapshot_text),'PT400','invalid command field');
  END LOOP;
  changed:=command||jsonb_build_object('expectedVersionHash',repeat('a',64));
  PERFORM pg_temp.report_refuses(format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,changed::text,snapshot_text),'PT409','changed adopted hash');
  changed:=command||jsonb_build_object('versionId',gen_random_uuid());
  PERFORM pg_temp.report_refuses(format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,changed::text,snapshot_text),'PT409','missing selected version');
  PERFORM pg_temp.report_refuses(format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,NULL)',plan,workspace,actor,command_id,raw),'PT400','missing adopted snapshot');
  PERFORM pg_temp.report_refuses(format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,raw,'{'),'PT400','invalid adopted snapshot JSON');
  PERFORM pg_temp.report_refuses(format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,raw,snapshot_text||' '),'PT409','changed adopted snapshot bytes');
  PERFORM pg_temp.report_refuses(format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,%L)',plan,workspace,actor,command_id,raw,replace(snapshot_text,'SYNTHETIC plan','ALTERED')),'PT409','changed adopted source');
  RESET ROLE;
  UPDATE public.land_use_plans SET current_adopted_version_id=NULL WHERE id=plan;
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.report_refuses(statement,'PT409','changed current adopted pointer');
  RESET ROLE;
  UPDATE public.land_use_plans SET current_adopted_version_id=version WHERE id=plan;
  UPDATE public.land_use_plan_versions SET state='superseded' WHERE id=version;
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.report_refuses(statement,'PT409','superseded selected version');
  RESET ROLE;
  UPDATE public.land_use_plan_versions SET state='adopted' WHERE id=version;
  SET LOCAL ROLE service_role;
  FOREACH fault IN ARRAY ARRAY['reports','report_artifacts','land_use_plan_implementation_reports','land_use_plan_implementation_report_commands'] LOOP
    PERFORM set_config('openplan.report_test_failure',fault,true);
    PERFORM pg_temp.report_refuses(statement,'PT499','rollback at '||fault);
    PERFORM pg_temp.report_assert((SELECT count(*)=0 FROM public.reports WHERE land_use_plan_id=plan),'rollback leaves no report');
    PERFORM pg_temp.report_assert((SELECT count(*)=0 FROM public.report_artifacts WHERE metadata_json->>'landUsePlanId'=plan::text),'rollback leaves no artifact');
    PERFORM pg_temp.report_assert((SELECT count(*)=0 FROM public.land_use_plan_implementation_reports WHERE plan_id=plan),'rollback leaves no register');
    PERFORM pg_temp.report_assert((SELECT count(*)=0 FROM public.land_use_plan_implementation_report_commands WHERE plan_id=plan),'rollback leaves no receipt');
  END LOOP;
  PERFORM set_config('openplan.report_test_failure','',true);
  EXECUTE statement INTO result;
  PERFORM pg_temp.report_assert(result->>'replayed'='false' AND result->>'actorId'=actor::text AND result->>'workspaceId'=workspace::text AND result->>'planId'=plan::text,'new receipt scope');
  PERFORM pg_temp.report_assert(result->>'commandId'=command_id::text AND result->>'commandSha256'=encode(extensions.digest(raw,'sha256'),'hex'),'exact command receipt');
  PERFORM pg_temp.report_assert(result->>'versionId'=version::text AND result->>'adoptedVersionContentHash'=snapshot_hash,'receipt version');
  PERFORM pg_temp.report_assert(result->>'reportingPeriodStart'='2026-01-01' AND result->>'reportingPeriodEnd'='2026-10-07' AND result->>'title'='SYNTHETIC report' AND result->'summary'='null'::jsonb,'receipt reporting fields');
  SELECT * INTO journal FROM public.land_use_plan_implementation_report_commands WHERE plan_id=plan;
  PERFORM pg_temp.report_assert(journal.command_text=raw AND journal.receipt=result AND journal.snapshot_text::jsonb#>>'{actions,0,id}'=first_action::text,'retained bytes and ordered actions');
  PERFORM pg_temp.report_assert(journal.content_hash=encode(extensions.digest(journal.snapshot_text,'sha256'),'hex') AND result->>'contentHash'=journal.content_hash,'retained snapshot hash');
  SELECT to_jsonb(a),a.metadata_json INTO artifact_before,metadata FROM public.report_artifacts a WHERE id=(result->>'artifactId')::uuid;
  PERFORM pg_temp.report_assert(metadata->'snapshot'=journal.snapshot_text::jsonb AND metadata->>'contentHash'=journal.content_hash AND metadata->>'contentHashEncoding'='postgresql-jsonb-text-sha256','artifact retains exact snapshot');
  PERFORM pg_temp.report_assert((SELECT array_agg(k ORDER BY k)=ARRAY['description','due_on','evidence_document_id','id','program_id','project_id','responsible_party','status','title','updated_at'] FROM jsonb_object_keys(metadata#>'{snapshot,actions,0}') k),'public action projection');
  SELECT to_jsonb(r) INTO register_before FROM public.land_use_plan_implementation_reports r WHERE id=(result->>'implementationReportId')::uuid;
  PERFORM pg_temp.report_assert(register_before->'action_status_snapshot'=metadata#>'{snapshot,actions}' AND register_before->>'report_id'=result->>'reportId' AND register_before->>'content_hash'=journal.content_hash,'register matches artifact');
  PERFORM pg_temp.report_assert((SELECT summary='Implementation status for 2026-01-01 through 2026-10-07.' AND generated_at=(result->>'generatedAt')::timestamptz FROM public.reports WHERE id=(result->>'reportId')::uuid),'report date and fallback summary');
  receipt_before:=result;
  RESET ROLE;
  UPDATE public.land_use_plan_implementation_actions SET status='in_progress' WHERE id=first_action;
  UPDATE public.land_use_plans SET current_adopted_version_id=NULL WHERE id=plan;
  UPDATE public.land_use_plan_versions SET state='superseded' WHERE id=version;
  SET LOCAL ROLE service_role;
  SELECT public.create_land_use_plan_implementation_report(plan,workspace,actor,command_id,raw,NULL) INTO replay;
  PERFORM pg_temp.report_assert(replay=receipt_before||'{"replayed":true}'::jsonb,'exact replay after current state changes');
  PERFORM pg_temp.report_assert((SELECT count(*)=1 FROM public.reports WHERE land_use_plan_id=plan),'replay creates no duplicate');
  PERFORM pg_temp.report_assert((SELECT to_jsonb(a)=artifact_before FROM public.report_artifacts a WHERE id=(result->>'artifactId')::uuid),'replay retains artifact bytes');
  PERFORM pg_temp.report_assert((SELECT to_jsonb(r)=register_before FROM public.land_use_plan_implementation_reports r WHERE id=(result->>'implementationReportId')::uuid),'replay retains saved statuses');
  PERFORM pg_temp.report_refuses(format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,NULL)',plan,workspace,actor,command_id,raw||' '),'PT409','changed retry bytes denied');
  PERFORM pg_temp.report_refuses(format('SELECT public.create_land_use_plan_implementation_report(%L,%L,%L,%L,%L,NULL)',plan,workspace,other_owner,command_id,raw),'PT409','different writer cannot recover another actor command');
  RESET ROLE;
  UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.report_refuses(statement,'42501','revoked write permission cannot replay');
  RESET ROLE;
  PERFORM pg_temp.report_refuses(format('UPDATE public.land_use_plan_implementation_report_commands SET command_text=%L WHERE plan_id=%L',raw||' ',plan),'P0001','receipt append-only');
  DELETE FROM public.workspaces WHERE id=workspace;
  PERFORM pg_temp.report_assert((SELECT count(*)=0 FROM public.land_use_plan_implementation_report_commands WHERE plan_id=plan),'workspace cascade removes owned receipt');
END $test$;

-- Publication uses the same native report custody home. This is synthetic
-- contract source, not agency adoption or an executed migration claim.
DO $publication$
DECLARE
  actor uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid(); plan uuid:=gen_random_uuid();
  version uuid:=gen_random_uuid(); document uuid:=gen_random_uuid(); release uuid:=gen_random_uuid(); foreign_plan uuid:=gen_random_uuid();
  decision_id uuid:=gen_random_uuid(); snapshot_text text; content_hash text; manifest jsonb;
  statement text; receipt jsonb; replay jsonb; artifact_before jsonb; native_before jsonb;
  competitor_kind text; competitor_date date;
  signup_workspace uuid; cleanup_count integer; workspaces_before jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.id),'[]'::jsonb)
    INTO workspaces_before FROM public.workspaces w;
  INSERT INTO auth.users(id,email) VALUES(actor,actor||'@synthetic.invalid');
  -- Bind the signup hook's separate workspace before creating the plan scope.
  SELECT w.id INTO STRICT signup_workspace
    FROM public.workspaces w JOIN public.workspace_members m ON m.workspace_id=w.id
    WHERE w.name=actor::text AND w.slug=actor::text||'-'||substring(actor::text,1,8)
      AND m.user_id=actor AND m.role='owner';
  INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC publication boundary',workspace::text);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner');
  INSERT INTO public.kb_documents(id,workspace_id,title,source_kind,status)
    VALUES(document,workspace,'SYNTHETIC publication evidence','pasted_text','ready');
  INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label)
    VALUES(plan,workspace,'SYNTHETIC publication','local-unconfigured','community','SYNTHETIC authority','SYNTHETIC area');
  INSERT INTO public.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind)
    VALUES(version,workspace,plan,1,'original');
  INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label)
    VALUES(foreign_plan,workspace,'SYNTHETIC foreign decision plan','local-unconfigured','community','SYNTHETIC','SYNTHETIC');
  snapshot_text:=format('{"designations":[],"implementationActions":[],"nodes":[],"plan":{"authorityLabel":"SYNTHETIC authority","descriptorId":"local-unconfigured","geographyLabel":"SYNTHETIC area","id":"%s","planKindKey":"community","title":"SYNTHETIC publication"},"relationships":[],"version":{"id":"%s","versionNumber":1}}',plan,version);
  content_hash:=encode(extensions.digest(snapshot_text,'sha256'),'hex');
  UPDATE public.land_use_plan_versions SET state='public_review',frozen_snapshot=snapshot_text::jsonb,
    content_hash=encode(extensions.digest(snapshot_text,'sha256'),'hex'),frozen_at=now(),frozen_by=actor WHERE id=version;
  INSERT INTO public.land_use_plan_review_releases(id,workspace_id,plan_id,version_id,version_content_hash,round_number,
    review_method,review_open_on,review_close_on,external_review_document_id)
    VALUES(release,workspace,plan,version,content_hash,1,'external_process','2026-10-01','2026-10-07',document);
  UPDATE public.land_use_plan_review_releases SET status='closed',outcome_snapshot='{}',closed_at=now(),closed_by=actor WHERE id=release;
  manifest:=jsonb_build_object('planId',plan,'versionId',version,'versionContentHash',content_hash,'reviewReleaseId',release,
    'reviewOutcomeHash',(SELECT outcome_hash FROM public.land_use_plan_review_releases WHERE id=release),
    'decision',jsonb_build_object('kind','adoption','body','SYNTHETIC body','instrumentType','Resolution',
      'instrumentIdentifier','TEST-1','vote',NULL,'decidedOn','2026-10-07','effectiveOn',NULL));
  statement:=format('SELECT public.publish_land_use_plan_version(%L,%L,%L,%L,%L,%L,%L)',workspace,plan,actor,version,content_hash,'SYNTHETIC packet',snapshot_text);
  BEGIN
    INSERT INTO public.land_use_plan_decisions(workspace_id,plan_id,version_id,version_content_hash,review_release_id,
      adoption_manifest,decision_kind,decision_body,instrument_type,instrument_identifier,decided_on,supporting_document_id,created_by)
      VALUES(workspace,plan,version,content_hash,release,jsonb_set(manifest,'{decision,body}','42'),
        'adoption','SYNTHETIC body','Resolution','TEST-1','2026-10-07',document,actor);
    UPDATE public.land_use_plan_versions SET state='adopted' WHERE id=version;
    UPDATE public.land_use_plans SET current_adopted_version_id=version WHERE id=plan;
    SET LOCAL ROLE service_role;
    PERFORM pg_temp.report_refuses(statement,'PT409','unreadable singleton decision accepted');
    RAISE EXCEPTION USING ERRCODE='PT498',MESSAGE='Restore malformed decision subtransaction';
  EXCEPTION WHEN SQLSTATE 'PT498' THEN NULL; END;
  INSERT INTO public.land_use_plan_decisions(id,workspace_id,plan_id,version_id,version_content_hash,review_release_id,
    adoption_manifest,decision_kind,decision_body,instrument_type,instrument_identifier,decided_on,supporting_document_id,created_by)
    VALUES(decision_id,workspace,plan,version,content_hash,release,manifest,'adoption','SYNTHETIC body','Resolution','TEST-1','2026-10-07',document,actor);
  -- Use the existing native trigger rather than bypassing constraints to forge
  -- a foreign decision. The public reader also refuses supplied foreign rows.
  PERFORM pg_temp.report_refuses(format(
    'INSERT INTO public.land_use_plan_decisions(workspace_id,plan_id,version_id,version_content_hash,review_release_id,adoption_manifest,decision_kind,decision_body,instrument_type,instrument_identifier,decided_on,supporting_document_id,created_by) SELECT workspace_id,%L,version_id,version_content_hash,review_release_id,adoption_manifest,decision_kind,decision_body,instrument_type,instrument_identifier,decided_on,supporting_document_id,created_by FROM public.land_use_plan_decisions WHERE id=%L',
    foreign_plan,decision_id),'P0001','foreign decision entered native source');
  UPDATE public.land_use_plan_versions SET state='adopted' WHERE id=version;
  UPDATE public.land_use_plans SET current_adopted_version_id=version WHERE id=plan;
  SET LOCAL ROLE service_role;
  EXECUTE statement INTO receipt;
  PERFORM pg_temp.report_assert(receipt->>'alreadyPublished'='false','normal adoption did not publish');
  SELECT to_jsonb(a) INTO artifact_before FROM public.report_artifacts a WHERE id=(receipt->>'artifactId')::uuid;
  SELECT to_jsonb(d) INTO native_before FROM public.land_use_plan_decisions d WHERE id=decision_id;
  EXECUTE statement INTO replay;
  PERFORM pg_temp.report_assert(replay=receipt||'{"alreadyPublished":true}'::jsonb,'publication exact replay changed identity');
  PERFORM pg_temp.report_assert((SELECT to_jsonb(a)=artifact_before FROM public.report_artifacts a WHERE id=(receipt->>'artifactId')::uuid),'publication replay changed artifact bytes');
  PERFORM pg_temp.report_assert((SELECT count(*)=1 FROM public.reports WHERE land_use_plan_id=plan),'publication replay duplicated report');
  PERFORM pg_temp.report_assert(public.land_use_plan_publication_source_v1(plan)#>>'{decisions,0,id}'=decision_id::text,'public source chose another decision');
  PERFORM pg_temp.report_assert(NOT has_function_privilege('authenticated','public.land_use_plan_publication_source_v1(uuid)','EXECUTE'),'raw publication source exposed');
  PERFORM pg_temp.report_refuses(format('SELECT public.publish_land_use_plan_version(%L,%L,%L,%L,%L,%L,%L)',workspace,gen_random_uuid(),actor,version,content_hash,'SYNTHETIC packet',snapshot_text),'PT404','foreign plan publication accepted');
  FOREACH competitor_kind IN ARRAY ARRAY['repeal','adoption','amendment'] LOOP
    competitor_date:=CASE WHEN competitor_kind='repeal' THEN DATE '2026-10-08' ELSE DATE '2026-10-07' END;
    BEGIN
      INSERT INTO public.land_use_plan_decisions(workspace_id,plan_id,version_id,version_content_hash,review_release_id,
        adoption_manifest,decision_kind,decision_body,instrument_type,instrument_identifier,decided_on,supporting_document_id,created_by)
        VALUES(workspace,plan,version,content_hash,release,
          jsonb_set(jsonb_set(manifest,'{decision,kind}',to_jsonb(competitor_kind)),'{decision,decidedOn}',to_jsonb(competitor_date::text)),
          competitor_kind,'SYNTHETIC body','Resolution','TEST-1',competitor_date,document,actor);
      PERFORM pg_temp.report_refuses(statement,'PT409','competing '||competitor_kind||' accepted');
      PERFORM pg_temp.report_assert(jsonb_array_length(public.land_use_plan_publication_source_v1(plan)->'decisions')=2,'public source hid competing decision');
      PERFORM pg_temp.report_assert((SELECT to_jsonb(a)=artifact_before FROM public.report_artifacts a WHERE id=(receipt->>'artifactId')::uuid),'conflict rewrote historical artifact');
      PERFORM pg_temp.report_assert((SELECT to_jsonb(d)=native_before FROM public.land_use_plan_decisions d WHERE id=decision_id),'conflict rebound retained adoption');
      RAISE EXCEPTION USING ERRCODE='PT498',MESSAGE='Restore competitor subtransaction';
    EXCEPTION WHEN SQLSTATE 'PT498' THEN NULL; END;
  END LOOP;
  -- The retained artifact is independent of current authority and never repaired.
  BEGIN
    UPDATE public.report_artifacts SET metadata_json=jsonb_set(metadata_json,'{adoptionManifest,decision,body}','"Changed retained decision"') WHERE id=(receipt->>'artifactId')::uuid;
    PERFORM pg_temp.report_refuses(statement,'PT409','unreadable retained decision replay accepted');
    RAISE EXCEPTION USING ERRCODE='PT498',MESSAGE='Restore retained artifact subtransaction';
  EXCEPTION WHEN SQLSTATE 'PT498' THEN NULL; END;
  RESET ROLE;
  DELETE FROM public.workspaces WHERE id=workspace;
  -- Delete only the captured synthetic signup scope before removing its owner.
  DELETE FROM public.workspaces w
    WHERE w.id=signup_workspace AND w.name=actor::text
      AND w.slug=actor::text||'-'||substring(actor::text,1,8)
      AND EXISTS (SELECT 1 FROM public.workspace_members m
        WHERE m.workspace_id=w.id AND m.user_id=actor AND m.role='owner')
      AND NOT EXISTS (SELECT 1 FROM public.workspace_members m
        WHERE m.workspace_id=w.id AND m.user_id<>actor);
  GET DIAGNOSTICS cleanup_count=ROW_COUNT;
  PERFORM pg_temp.report_assert(cleanup_count=1,'publication signup workspace cleanup must remove exactly its captured scope');
  DELETE FROM auth.users WHERE id=actor AND email=actor::text||'@synthetic.invalid';
  GET DIAGNOSTICS cleanup_count=ROW_COUNT;
  PERFORM pg_temp.report_assert(cleanup_count=1,'publication actor cleanup must remove exactly its synthetic user');
  PERFORM pg_temp.report_assert((SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.id),'[]'::jsonb)=workspaces_before
    FROM public.workspaces w),'publication cleanup must preserve unrelated workspace rows');
END $publication$;
SELECT 'publication decision boundary verified';
SELECT 'atomic implementation report verified';
