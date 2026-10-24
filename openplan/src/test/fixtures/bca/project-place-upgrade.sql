-- PREPARED ONLY. Root must admit a disposable pre-candidate database and psql
-- session, with ON_ERROR_STOP=1, before using this file. It commits synthetic
-- setup, applies the exact candidate once and preserves the nonempty evidence.
-- Do not reuse an already-migrated/fenced target or call this a restore proof.
BEGIN;
CREATE TEMP TABLE bca_upgrade_baseline(project_id uuid, actor_id uuid, version_id uuid, document jsonb, input_hash bytea);
DO $before$
DECLARE actor uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); version uuid:=gen_random_uuid(); doc jsonb;
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
   WHERE c.conrelid='public.project_bca_versions'::regclass AND c.contype='c'
     AND pg_catalog.pg_get_expr(c.conbin,c.conrelid)='((document_json ->> ''schemaVersion''::text) = ''1''::text)') THEN
   RAISE EXCEPTION 'This fixture requires the original pre-candidate version CHECK';
 END IF;
 INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.test');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic BCA nonempty upgrade',workspace::text);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner');
 INSERT INTO public.projects(id,workspace_id,name) VALUES(project,workspace,'Synthetic retained BCA');
 doc := jsonb_build_object('schemaVersion',1,'projectId',project,'title','Retained legacy BCA',
   'alternative','Synthetic Build','noBuildDescription','Synthetic No Build','geography','Original affected-area narrative',
   'programId','custom','programVersion','Synthetic source','applicability','Not an application',
   'methodology','Synthetic fixture','priceYear',2026,'discountYear',2026,'startYear',2026,
   'openingYear',2026,'endYear',2027,'discountRatePct',7,'costConvention','capital-only',
   'evidence','[]'::jsonb,'flows','[]'::jsonb,'qualitativeBenefits','','exclusions','Synthetic fixture',
   'reviewNotes','','sensitivity',jsonb_build_object('benefitLowPct',-20,'benefitHighPct',20,
     'costLowPct',-10,'costHighPct',30,'alternateDiscountRatePct',3,'rationale','Synthetic fixture'));
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 SET LOCAL ROLE authenticated;
 INSERT INTO public.project_bca_versions(id,project_id,created_by,document_json,engine_version)
 VALUES(version,project,actor,doc,'annual-ledger-1');
 RESET ROLE;
 INSERT INTO bca_upgrade_baseline VALUES(project,actor,version,doc,sha256(convert_to(doc::text,'UTF8')));
END;
$before$;
COMMIT;

\ir ../../../../supabase/migrations/20261023190200_bca_project_place_snapshot.sql

BEGIN;
DO $after$
DECLARE baseline bca_upgrade_baseline%ROWTYPE; retained jsonb;
BEGIN
 SELECT * INTO STRICT baseline FROM bca_upgrade_baseline;
 SELECT document_json INTO STRICT retained FROM public.project_bca_versions WHERE id=baseline.version_id;
 IF retained IS DISTINCT FROM baseline.document
   OR sha256(convert_to(retained::text,'UTF8')) IS DISTINCT FROM baseline.input_hash THEN
   RAISE EXCEPTION 'Nonempty upgrade changed original legacy document/hash';
 END IF;
 UPDATE public.projects SET place_source='drawn',place_label='Changed project area',place_kind=NULL,place_ref=NULL,
   place_country_code=NULL,place_subdivision_code=NULL,place_min_lon=170,place_max_lon=-170,
   place_min_lat=-20,place_max_lat=20,place_set_at='2026-10-19T01:02:03.123456+00:00'
 WHERE id=baseline.project_id;
 PERFORM set_config('request.jwt.claim.sub',baseline.actor_id::text,true);
 SET LOCAL ROLE authenticated;
 SELECT document_json INTO STRICT retained FROM public.project_bca_versions WHERE id=baseline.version_id;
 IF retained IS DISTINCT FROM baseline.document THEN RAISE EXCEPTION 'Legacy SELECT recovery changed after project update'; END IF;
 BEGIN
   INSERT INTO public.project_bca_versions(id,project_id,created_by,document_json,engine_version)
   VALUES(gen_random_uuid(),baseline.project_id,baseline.actor_id,baseline.document,'annual-ledger-1');
   RAISE EXCEPTION 'New ordinary legacy insert succeeded after upgrade';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 RESET ROLE;
END;
$after$;
COMMIT;
-- Root's actual HTTP exact-replay case must use the original version id,
-- attributed actor and full retained document after the source change, compare
-- the application's canonical SHA-256 separately, and reject changed author,
-- content/id and foreign project. This SQL SELECT is not HTTP replay evidence.
-- Capture the disposable target and baseline before any later fixture/cleanup.
