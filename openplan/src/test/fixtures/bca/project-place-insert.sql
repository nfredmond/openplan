-- PREPARED ONLY. Root must admit an isolated migrated target before execution.
-- This proves native insertion/retention if run, not HTTP replay or concurrency.
-- H0: harmless comment; N1: disable project_bca_place_insert_guard; N2: remove
-- the final expected comparison; N3: remove the canonical jurisdiction check;
-- N4: change FOR SHARE to no row lock (requires the separate two-session plan).
BEGIN;
SET LOCAL timezone = 'UTC';
-- MUTATION
CREATE FUNCTION pg_temp.bca_fixture_document(project_id uuid) RETURNS jsonb
LANGUAGE sql SET search_path = '' SET timezone = 'UTC' AS $$
 SELECT jsonb_build_object('schemaVersion',2,'projectId',p.id,'title','Synthetic native BCA',
   'alternative','Synthetic Build','noBuildDescription','Synthetic No Build','geography','Original affected-area narrative',
   'programId','custom','programVersion','Synthetic source','applicability','Not an application',
   'methodology','Synthetic fixture','priceYear',2026,'discountYear',2026,'startYear',2026,
   'openingYear',2026,'endYear',2027,'discountRatePct',7,'costConvention','capital-only',
   'evidence','[]'::jsonb,'flows','[]'::jsonb,'qualitativeBenefits','','exclusions','Synthetic fixture',
   'reviewNotes','','sensitivity',jsonb_build_object('benefitLowPct',-20,'benefitHighPct',20,
     'costLowPct',-10,'costHighPct',30,'alternateDiscountRatePct',3,'rationale','Synthetic fixture'),
   'projectPlace',jsonb_build_object('projectId',p.id,'projectUpdatedAt',p.updated_at,'placeSetAt',p.place_set_at,
     'status',CASE WHEN p.place_source IS NULL THEN 'missing' WHEN p.place_source='drawn' THEN 'drawn'
       WHEN p.place_source='uploaded_file' THEN 'uploaded' ELSE 'recorded' END,
     'place',jsonb_build_object('source',p.place_source,'kind',p.place_kind,'ref',p.place_ref,'label',p.place_label,
       'countryCode',p.place_country_code,'subdivisionCode',p.place_subdivision_code,
       'bbox',CASE WHEN p.place_min_lon IS NULL THEN NULL ELSE jsonb_build_object(
         'minLon',p.place_min_lon,'minLat',p.place_min_lat,'maxLon',p.place_max_lon,'maxLat',p.place_max_lat) END,
       'geometry',NULL),'jurisdiction',p.jurisdiction_context))
 FROM public.projects p WHERE p.id=project_id;
$$;
CREATE FUNCTION pg_temp.bca_fixture_insert(project_id uuid, actor_id uuid, doc jsonb, version_id uuid DEFAULT gen_random_uuid())
RETURNS void LANGUAGE sql AS $$
 INSERT INTO public.project_bca_versions(id,project_id,created_by,document_json,engine_version)
 VALUES(version_id,project_id,actor_id,doc,'annual-ledger-1');
$$;
CREATE FUNCTION pg_temp.bca_fixture_refuse(project_id uuid, actor_id uuid, doc jsonb, wanted_state text, witness text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
   PERFORM pg_temp.bca_fixture_insert(project_id,actor_id,doc);
 EXCEPTION WHEN OTHERS THEN
   IF SQLSTATE = wanted_state THEN RETURN; END IF;
   RAISE EXCEPTION 'Wrong denial for %: % %', witness, SQLSTATE, SQLERRM;
 END;
 RAISE EXCEPTION 'Accepted invalid BCA witness: %', witness;
END;
$$;
-- P2 witnesses use complete exact-current documents, real project FKs and an
-- authenticated workspace owner. Require each specific predicate's message,
-- not an unrelated CHECK, RLS denial or stale-source refusal with a shared code.
CREATE FUNCTION pg_temp.bca_fixture_refuse_domain(project_id uuid, actor_id uuid, doc jsonb, wanted_message text, witness text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN
   PERFORM pg_temp.bca_fixture_insert(project_id,actor_id,doc);
 EXCEPTION WHEN OTHERS THEN
   IF SQLSTATE = '23514' AND SQLERRM = wanted_message THEN RETURN; END IF;
   RAISE EXCEPTION 'Wrong domain denial for %: % %', witness, SQLSTATE, SQLERRM;
 END;
 RAISE EXCEPTION 'Accepted invalid BCA domain witness: %', witness;
END;
$$;
DO $reader_domains$
DECLARE
 owner_id uuid:=gen_random_uuid(); workspace_id uuid:=gen_random_uuid(); source_id uuid;
 uuid_text text; variant text; version integer; timestamp_text text; mode text; doc jsonb; wanted_message text;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(owner_id,owner_id||'@example.test');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace_id,'Synthetic BCA reader domains',workspace_id::text);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace_id,owner_id,'owner');
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 -- Fixed nil/max/version witnesses must be absent on the admitted isolated
 -- target. A PK collision stops the fixture; never reuse or clean another row.
 FOR version IN 1..8 LOOP
   uuid_text := '00000000-0000-'||version||'000-8000-000000000001';
   source_id := uuid_text::uuid;
   INSERT INTO public.projects(id,workspace_id,name,created_by) VALUES(source_id,workspace_id,'Synthetic UUID version',owner_id);
   SET LOCAL ROLE authenticated;
   PERFORM pg_temp.bca_fixture_insert(source_id,owner_id,pg_temp.bca_fixture_document(source_id));
   IF (SELECT count(*) FROM public.project_bca_versions v WHERE v.project_id=source_id) <> 1 THEN
     RAISE EXCEPTION 'Missing UUID version survivor: %', uuid_text;
   END IF;
   RESET ROLE;
 END LOOP;
 FOREACH variant IN ARRAY ARRAY['9','a','b','nil','max'] LOOP
   uuid_text := CASE variant WHEN 'nil' THEN '00000000-0000-0000-0000-000000000000'
     WHEN 'max' THEN 'ffffffff-ffff-ffff-ffff-ffffffffffff'
     ELSE '00000000-0000-4000-'||variant||'000-000000000001' END;
   source_id := uuid_text::uuid;
   INSERT INTO public.projects(id,workspace_id,name,created_by) VALUES(source_id,workspace_id,'Synthetic UUID variant',owner_id);
   SET LOCAL ROLE authenticated;
   PERFORM pg_temp.bca_fixture_insert(source_id,owner_id,pg_temp.bca_fixture_document(source_id));
   IF (SELECT count(*) FROM public.project_bca_versions v WHERE v.project_id=source_id) <> 1 THEN
     RAISE EXCEPTION 'Missing UUID variant survivor: %', uuid_text;
   END IF;
   RESET ROLE;
 END LOOP;
 FOREACH timestamp_text IN ARRAY ARRAY['0001-01-01T00:00:00+00:00',
   '9999-12-31T23:59:59.123456+00:00','2026-10-19T01:02:03.123456+00:00'] LOOP
   source_id := gen_random_uuid();
   -- Supply updated_at on INSERT. The existing UPDATE trigger changes it.
   INSERT INTO public.projects(id,workspace_id,name,created_by,updated_at,place_source,place_label,
     place_min_lon,place_min_lat,place_max_lon,place_max_lat,place_set_at)
   VALUES(source_id,workspace_id,'Synthetic timestamp survivor',owner_id,timestamp_text::timestamptz,
     'drawn','Synthetic area',1,1,2,2,timestamp_text::timestamptz);
   doc := pg_temp.bca_fixture_document(source_id);
   IF doc#>>'{projectPlace,projectUpdatedAt}' IS DISTINCT FROM timestamp_text
     OR doc#>>'{projectPlace,placeSetAt}' IS DISTINCT FROM timestamp_text THEN
     RAISE EXCEPTION 'Timestamp survivor source spelling differs: %', timestamp_text;
   END IF;
   SET LOCAL ROLE authenticated;
   PERFORM pg_temp.bca_fixture_insert(source_id,owner_id,doc);
   IF NOT EXISTS (SELECT 1 FROM public.project_bca_versions v WHERE v.project_id=source_id AND v.document_json=doc) THEN
     RAISE EXCEPTION 'Missing exact timestamp survivor: %', timestamp_text;
   END IF;
   RESET ROLE;
 END LOOP;
 FOREACH mode IN ARRAY ARRAY['uuid-domain','updated_at-domain','place_set_at-domain'] LOOP
   source_id := CASE WHEN mode='uuid-domain' THEN '00000000-0000-0000-8000-000000000001'::uuid ELSE gen_random_uuid() END;
   INSERT INTO public.projects(id,workspace_id,name,created_by,updated_at,place_source,place_label,
     place_min_lon,place_min_lat,place_max_lon,place_max_lat,place_set_at)
   VALUES(source_id,workspace_id,'Synthetic native-only reader domain',owner_id,
     CASE WHEN mode='updated_at-domain' THEN '10000-01-01T00:00:00+00:00'::timestamptz
       ELSE '2026-10-19T01:02:03.123456+00:00'::timestamptz END,
     CASE WHEN mode='place_set_at-domain' THEN 'drawn' END,
     CASE WHEN mode='place_set_at-domain' THEN 'Synthetic area' END,
     CASE WHEN mode='place_set_at-domain' THEN 1 END,CASE WHEN mode='place_set_at-domain' THEN 1 END,
     CASE WHEN mode='place_set_at-domain' THEN 2 END,CASE WHEN mode='place_set_at-domain' THEN 2 END,
     CASE WHEN mode='place_set_at-domain' THEN '10000-01-01T00:00:00+00:00'::timestamptz END);
   doc := pg_temp.bca_fixture_document(source_id);
   wanted_message := CASE mode WHEN 'uuid-domain' THEN 'Project identity is outside the BCA reader UUID domain'
     WHEN 'updated_at-domain' THEN 'Project updated_at is outside the BCA reader datetime domain'
     ELSE 'Project place_set_at is outside the BCA reader datetime domain' END;
   SET LOCAL ROLE authenticated;
   PERFORM pg_temp.bca_fixture_refuse_domain(source_id,owner_id,doc,wanted_message,mode);
   RESET ROLE;
 END LOOP;
END;
$reader_domains$;
DO $test$
DECLARE
 owner_id uuid:=gen_random_uuid(); admin_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid();
 viewer_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); workspace_id uuid:=gen_random_uuid();
 project_id uuid:=gen_random_uuid(); foreign_project uuid:=gen_random_uuid(); foreign_workspace uuid:=gen_random_uuid();
 legacy_id uuid:=gen_random_uuid(); saved_id uuid:=gen_random_uuid(); actor_id uuid;
 doc jsonb; bad jsonb; context jsonb; legacy jsonb; legacy_hash bytea; saved_hash bytea;
 mode text; field text; padding text; state_count integer:=0;
BEGIN
 INSERT INTO auth.users(id,email) SELECT x,x||'@example.test'
 FROM unnest(ARRAY[owner_id,admin_id,member_id,viewer_id,outsider]) x;
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace_id,'Synthetic native BCA',workspace_id::text),
   (foreign_workspace,'Synthetic foreign workspace',foreign_workspace::text);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
   (workspace_id,owner_id,'owner'),(workspace_id,admin_id,'admin'),(workspace_id,member_id,'member'),
   (workspace_id,viewer_id,'viewer'),(foreign_workspace,outsider,'owner');
 INSERT INTO public.projects(id,workspace_id,name) VALUES(project_id,workspace_id,'Synthetic BCA'),
   (foreign_project,foreign_workspace,'Synthetic foreign project');
 -- Trusted postgres can restore an original v1 document. Capture its exact
 -- native JSONB bytes/hash, not the different application canonical hash.
 legacy := (pg_temp.bca_fixture_document(project_id)-'projectPlace') || '{"schemaVersion":1}'::jsonb;
 PERFORM pg_temp.bca_fixture_insert(project_id,owner_id,legacy,legacy_id);
 legacy_hash := sha256(convert_to(legacy::text,'UTF8'));
 FOREACH actor_id IN ARRAY ARRAY[owner_id,admin_id,member_id] LOOP
   PERFORM set_config('request.jwt.claim.sub',actor_id::text,true);
   SET LOCAL ROLE authenticated;
   PERFORM pg_temp.bca_fixture_insert(project_id,actor_id,pg_temp.bca_fixture_document(project_id));
   RESET ROLE;
 END LOOP;
 -- All valid place states; the final five entries are the existing resolver's
 -- kind vocabulary. The opaque source remains independent of that adapter.
 FOREACH mode IN ARRAY ARRAY['missing','drawn','uploaded_file','opaque','county','city','cdp','metro','micro'] LOOP
   UPDATE public.projects SET place_source=CASE WHEN mode='missing' THEN NULL WHEN mode='opaque' THEN 'fixture-resolver'
       WHEN mode IN ('drawn','uploaded_file') THEN mode ELSE 'tigerweb' END,
     place_kind=CASE WHEN mode IN ('missing','drawn','uploaded_file') THEN NULL WHEN mode='opaque' THEN 'opaque-area' ELSE mode END,
     place_ref=CASE WHEN mode IN ('missing','drawn','uploaded_file') THEN NULL WHEN mode='opaque' THEN 'opaque:area-1' ELSE '12345' END,
     place_label=CASE WHEN mode='missing' THEN NULL ELSE 'Synthetic area' END,
     place_country_code=NULL,place_subdivision_code=NULL,
     place_min_lon=CASE WHEN mode='missing' THEN NULL ELSE 170 END,place_max_lon=CASE WHEN mode='missing' THEN NULL ELSE -170 END,
     place_min_lat=CASE WHEN mode='missing' THEN NULL ELSE -20 END,place_max_lat=CASE WHEN mode='missing' THEN NULL ELSE 20 END,
     place_set_at=CASE WHEN mode='missing' THEN NULL ELSE '2026-10-19T01:02:03.123456+00:00'::timestamptz END
   WHERE id=project_id;
   doc := pg_temp.bca_fixture_document(project_id);
   PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
   SET LOCAL ROLE authenticated;
   PERFORM pg_temp.bca_fixture_insert(project_id,owner_id,doc);
   RESET ROLE;
   state_count := state_count+1;
 END LOOP;
 IF state_count<>9 THEN RAISE EXCEPTION 'Valid state loop did not run completely'; END IF;
 context := jsonb_build_object('version',1,'state','declared','recordedBy',owner_id,
   'recordedAt','2026-10-19T01:02:03.654321+00:00','entries',jsonb_build_array(
     jsonb_build_object('label','Synthetic sovereign body','kind','authority','countryCode',NULL,
       'subdivisionCode',NULL,'reference',NULL,'scope','sovereign','identity','staff_declared'),
     jsonb_build_object('label','Synthetic overlap body','kind','authority','countryCode',NULL,
       'subdivisionCode',NULL,'reference',NULL,'scope','overlap','identity','staff_declared')));
 UPDATE public.projects SET jurisdiction_context=context WHERE id=project_id;
 -- Explicit unresolved and existing adapter-resolved context both validate.
 UPDATE public.projects SET jurisdiction_context=jsonb_build_object('version',1,'state','unresolved',
   'recordedBy',owner_id,'recordedAt','2026-10-19T01:02:03.654321+00:00','entries','[]'::jsonb) WHERE id=project_id;
 bad := pg_temp.bca_fixture_document(project_id);
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.bca_fixture_insert(project_id,owner_id,bad);
 RESET ROLE;
 UPDATE public.projects SET jurisdiction_context=jsonb_set(context,'{entries}',jsonb_build_array(
   jsonb_build_object('label','Synthetic resolved body','kind','tigerweb:county','countryCode',NULL,
     'subdivisionCode',NULL,'reference','tigerweb:county:12345','scope','administrative','identity','server_resolved'))) WHERE id=project_id;
 bad := pg_temp.bca_fixture_document(project_id);
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.bca_fixture_insert(project_id,owner_id,bad);
 RESET ROLE;
 UPDATE public.projects SET jurisdiction_context=context WHERE id=project_id;
 doc := pg_temp.bca_fixture_document(project_id);
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.bca_fixture_insert(project_id,owner_id,doc,saved_id);
 -- Numeric equality follows the typed literal; lexical JSON number formatting
 -- such as 2.0 is not a string-version bypass.
 PERFORM pg_temp.bca_fixture_insert(project_id,owner_id,jsonb_set(doc,'{schemaVersion}','2.0'::jsonb));
 -- First negative is deliberately a structurally valid, same-project invented
 -- source. N2 must fail here by accepting it, not at a redundant table CHECK.
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,'{projectPlace,place,source}','"invented-resolver"'::jsonb),'PT409','invented-source');
 FOREACH field IN ARRAY ARRAY['projectId','projectUpdatedAt','placeSetAt','status','place','jurisdiction'] LOOP
   PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,'{projectPlace}',(doc->'projectPlace')-field),'PT409','absent-'||field);
   PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,ARRAY['projectPlace',field],'null'::jsonb),'PT409','null-'||field);
 END LOOP;
 FOREACH field IN ARRAY ARRAY['source','kind','ref','label','countryCode','subdivisionCode','bbox','geometry'] LOOP
   bad := jsonb_set(doc,'{projectPlace,place}',(doc#>'{projectPlace,place}')-field);
   PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,bad,'PT409','missing-place-'||field);
   bad := jsonb_set(doc,ARRAY['projectPlace','place',field],'[]'::jsonb);
   PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,bad,'PT409','wrong-type-place-'||field);
 END LOOP;
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,'{schemaVersion}','1'::jsonb),'23514','new-v1');
 PERFORM set_config('request.jwt.claim.role','postgres',true);
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,'{schemaVersion}','1'::jsonb),'23514','ordinary-restore-role-claim-spoof');
 PERFORM set_config('request.jwt.claim.role','authenticated',true);
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,'{schemaVersion}','"2"'::jsonb),'23514','string-v2');
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,'{schemaVersion}','null'::jsonb),'23514','null-version');
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,doc-'schemaVersion','23514','missing-version');
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,'{projectId}',to_jsonb(foreign_project::text)),'23514','foreign-document');
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,'{projectPlace,projectId}',to_jsonb(foreign_project::text)),'PT409','foreign-snapshot');
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,'{projectPlace,place,bbox,minLon}','"170"'::jsonb),'PT409','string-extent');
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,'{projectPlace,jurisdiction,state}','null'::jsonb),'PT409','invalid-context');
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,'{projectPlace,projectUpdatedAt}',
   to_jsonb((doc#>>'{projectPlace,projectUpdatedAt}')::timestamptz+interval '1 microsecond')),'PT409','one-microsecond-stale');
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,'{projectPlace,projectUpdatedAt}',
   to_jsonb(CASE WHEN right(doc#>>'{projectPlace,projectUpdatedAt}',1)='Z'
     THEN regexp_replace(doc#>>'{projectPlace,projectUpdatedAt}','Z$','+00:00')
     ELSE replace(doc#>>'{projectPlace,projectUpdatedAt}','+00:00','Z') END)),'PT409','equivalent-timestamp-spelling');
 PERFORM pg_temp.bca_fixture_refuse(project_id,outsider,doc,'42501','foreign-author');
 PERFORM pg_temp.bca_fixture_refuse(foreign_project,owner_id,
   jsonb_set(doc,'{projectId}',to_jsonb(foreign_project::text)),'42501','foreign-project');
 PERFORM set_config('request.jwt.claim.sub',viewer_id::text,true);
 PERFORM pg_temp.bca_fixture_refuse(project_id,viewer_id,doc,'42501','viewer');
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 PERFORM pg_temp.bca_fixture_refuse(project_id,outsider,doc,'42501','outsider');
 RESET ROLE;
 -- Service-role table grants are not a snapshot or actor bypass.
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 SET LOCAL ROLE service_role;
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,jsonb_set(doc,'{projectPlace,place,label}','"invented"'::jsonb),'PT409','service-invented-place');
 PERFORM set_config('request.jwt.claim.sub','',true);
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,doc,'42501','service-without-actor');
 RESET ROLE;
 SET LOCAL ROLE anon;
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,doc,'42501','anonymous');
 RESET ROLE;
 -- Raw contexts that the shared reader would trim cannot be adopted as raw or
 -- silently normalized in the new immutable BCA document.
 FOREACH padding IN ARRAY ARRAY[' ',chr(9),chr(160),chr(65279)] LOOP
   UPDATE public.projects SET jurisdiction_context=jsonb_set(context,'{entries,0,label}',to_jsonb(padding||'Synthetic sovereign body'||padding)) WHERE id=project_id;
   bad := pg_temp.bca_fixture_document(project_id);
   PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
   SET LOCAL ROLE authenticated;
   PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,bad,'23514','reader-would-trim');
   RESET ROLE;
 END LOOP;
 -- A label at the projects table's 200 code point limit, all astral, still
 -- snapshots: the BCA check counts code points exactly as that table does.
 UPDATE public.projects SET jurisdiction_context=jsonb_set(context,'{entries,0,label}',to_jsonb(repeat(chr(128512),200))) WHERE id=project_id;
 bad := pg_temp.bca_fixture_document(project_id);
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.bca_fixture_insert(project_id,owner_id,bad);
 RESET ROLE;
 UPDATE public.projects SET jurisdiction_context=jsonb_set(context,'{entries}',jsonb_build_array(
   jsonb_build_object('label','Synthetic invalid resolved body','kind','tigerweb:unsupported','countryCode',NULL,
     'subdivisionCode',NULL,'reference','tigerweb:unsupported:12345','scope','administrative','identity','server_resolved'))) WHERE id=project_id;
 bad := pg_temp.bca_fixture_document(project_id);
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,bad,'23514','invalid-current-resolved-context');
 RESET ROLE;
 UPDATE public.projects SET jurisdiction_context=context WHERE id=project_id;
 FOREACH mode IN ARRAY ARRAY['orphan','drawn','uploaded_file','opaque','bad-adapter'] LOOP
   UPDATE public.projects SET place_source=CASE mode WHEN 'orphan' THEN NULL WHEN 'opaque' THEN 'fixture-resolver'
       WHEN 'bad-adapter' THEN 'tigerweb' ELSE mode END,
     place_kind=CASE WHEN mode IN ('drawn','bad-adapter') THEN 'unsupported' ELSE NULL END,
     place_ref=CASE WHEN mode IN ('uploaded_file','bad-adapter') THEN '12345' ELSE NULL END,
     place_label='Synthetic invalid current scope',place_country_code=NULL,place_subdivision_code=NULL,
     place_set_at=CASE WHEN mode='orphan' THEN NULL ELSE '2026-10-19T01:02:03.123456+00:00'::timestamptz END,
     place_min_lon=CASE WHEN mode='orphan' THEN NULL ELSE 170 END,place_max_lon=CASE WHEN mode='orphan' THEN NULL ELSE -170 END,
     place_min_lat=CASE WHEN mode='orphan' THEN NULL ELSE -20 END,place_max_lat=CASE WHEN mode='orphan' THEN NULL ELSE 20 END
   WHERE id=project_id;
   bad := pg_temp.bca_fixture_document(project_id);
   SET LOCAL ROLE authenticated;
   PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,bad,'23514','invalid-current-'||mode);
   RESET ROLE;
 END LOOP;
 UPDATE public.projects SET jurisdiction_context=context,place_source='tigerweb',place_kind='micro',place_ref='12345',
   place_label='Changed source label',place_min_lon=170,place_max_lon=-170,place_min_lat=-20,place_max_lat=20,
   place_set_at='2026-10-19T01:02:03.123456+00:00' WHERE id=project_id;
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 SET LOCAL ROLE authenticated;
 PERFORM pg_temp.bca_fixture_refuse(project_id,owner_id,doc,'PT409','actual-current-source-change');
 SELECT sha256(convert_to(document_json::text,'UTF8')) INTO saved_hash FROM public.project_bca_versions WHERE id=saved_id;
 IF saved_hash IS DISTINCT FROM sha256(convert_to(doc::text,'UTF8')) THEN RAISE EXCEPTION 'Retained v2 bytes changed'; END IF;
 IF (SELECT document_json FROM public.project_bca_versions WHERE id=legacy_id) IS DISTINCT FROM legacy
   OR (SELECT sha256(convert_to(document_json::text,'UTF8')) FROM public.project_bca_versions WHERE id=legacy_id) IS DISTINCT FROM legacy_hash
   THEN RAISE EXCEPTION 'Retained legacy bytes/hash changed'; END IF;
 RESET ROLE;
END;
$test$;
ROLLBACK;
