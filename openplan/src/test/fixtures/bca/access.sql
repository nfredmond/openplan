BEGIN;
-- MUTATION
CREATE FUNCTION pg_temp.expect_denied(statement text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN insufficient_privilege OR check_violation OR unique_violation THEN RETURN; END;
 RAISE EXCEPTION 'Expected denial: %', statement;
END $$;
DO $test$
DECLARE owner_id uuid:=gen_random_uuid(); viewer_id uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid(); project uuid:=gen_random_uuid(); version uuid:=gen_random_uuid(); n integer;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(owner_id,owner_id||'@example.test'),(viewer_id,viewer_id||'@example.test'),(outsider,outsider||'@example.test');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic BCA permission fixture',workspace::text);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,owner_id,'owner'),(workspace,viewer_id,'viewer');
 INSERT INTO public.projects(id,workspace_id,name) VALUES(project,workspace,'Synthetic BCA fixture');
 PERFORM set_config('request.jwt.claim.sub',owner_id::text,true);
 SET LOCAL ROLE authenticated;
 INSERT INTO public.project_bca_versions(id,project_id,created_by,document_json,engine_version) VALUES(version,project,owner_id,jsonb_build_object('projectId',project,'schemaVersion',1),'test');
 SELECT count(*) INTO n FROM public.project_bca_versions WHERE id=version;
 IF n<>1 THEN RAISE EXCEPTION 'Owner cannot read own version'; END IF;
 PERFORM pg_temp.expect_denied(format('UPDATE public.project_bca_versions SET engine_version=''changed'' WHERE id=%L',version));
 PERFORM pg_temp.expect_denied(format('DELETE FROM public.project_bca_versions WHERE id=%L',version));
 PERFORM pg_temp.expect_denied(format('INSERT INTO public.project_bca_versions(id,project_id,created_by,document_json,engine_version) VALUES(%L,%L,%L,%L,''test'')',gen_random_uuid(),project,outsider,jsonb_build_object('projectId',project,'schemaVersion',1)));
 PERFORM pg_temp.expect_denied(format('INSERT INTO public.project_bca_versions(id,project_id,created_by,document_json,engine_version) VALUES(%L,%L,%L,''{}'',''test'')',gen_random_uuid(),project,owner_id));
 PERFORM pg_temp.expect_denied(format('INSERT INTO public.project_bca_versions(id,project_id,created_by,document_json,engine_version) VALUES(%L,%L,%L,%L,''test'')',gen_random_uuid(),project,owner_id,jsonb_build_object('projectId',gen_random_uuid(),'schemaVersion',1)));
 PERFORM pg_temp.expect_denied(format('INSERT INTO public.project_bca_versions(id,project_id,created_by,document_json,engine_version) VALUES(%L,%L,%L,%L,''test'')',version,project,owner_id,jsonb_build_object('projectId',project,'schemaVersion',1)));
 PERFORM set_config('request.jwt.claim.sub',viewer_id::text,true);
 SELECT count(*) INTO n FROM public.project_bca_versions WHERE id=version;
 IF n<>1 THEN RAISE EXCEPTION 'Viewer cannot read own workspace'; END IF;
 PERFORM pg_temp.expect_denied(format('INSERT INTO public.project_bca_versions(id,project_id,created_by,document_json,engine_version) VALUES(%L,%L,%L,%L,''test'')',gen_random_uuid(),project,viewer_id,jsonb_build_object('projectId',project,'schemaVersion',1)));
 PERFORM set_config('request.jwt.claim.sub',outsider::text,true);
 SELECT count(*) INTO n FROM public.project_bca_versions WHERE id=version;
 IF n<>0 THEN RAISE EXCEPTION 'Outsider can read another workspace'; END IF;
 PERFORM pg_temp.expect_denied(format('INSERT INTO public.project_bca_versions(id,project_id,created_by,document_json,engine_version) VALUES(%L,%L,%L,%L,''test'')',gen_random_uuid(),project,outsider,jsonb_build_object('projectId',project,'schemaVersion',1)));
 RESET ROLE;
 SET LOCAL ROLE anon;
 PERFORM pg_temp.expect_denied('SELECT * FROM public.project_bca_versions');
 RESET ROLE;
END $test$;
ROLLBACK;
