CREATE FUNCTION pg_temp.revision_assert(ok boolean, message text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS NOT TRUE THEN RAISE EXCEPTION '%', message; END IF;
END $$;
CREATE FUNCTION pg_temp.revision_exec(v uuid, statement text, label text, delta integer DEFAULT 1)
RETURNS void LANGUAGE plpgsql AS $$ DECLARE before_revision integer; after_revision integer; BEGIN
  SELECT draft_revision INTO before_revision FROM public.land_use_plan_versions WHERE id=v;
  EXECUTE statement;
  SELECT draft_revision INTO after_revision FROM public.land_use_plan_versions WHERE id=v;
  PERFORM pg_temp.revision_assert(after_revision=before_revision+delta, label||' revision delta');
END $$;
CREATE FUNCTION pg_temp.revision_refuses(statement text, expected_state text, label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE=expected_state THEN RETURN; END IF;
    RAISE EXCEPTION '%: unexpected % %',label,SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION '%: accepted',label;
END $$;
-- A controlled nested write checks the frozen-counter guard independently of
-- the separate rule rejecting direct counter edits.
CREATE TEMP TABLE frozen_revision_probe(version_id uuid);
CREATE FUNCTION pg_temp.force_nested_revision()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  UPDATE public.land_use_plan_versions SET draft_revision=draft_revision+1 WHERE id=NEW.version_id;
  RETURN NEW;
END $$;
CREATE TRIGGER force_revision BEFORE INSERT ON frozen_revision_probe
  FOR EACH ROW EXECUTE FUNCTION pg_temp.force_nested_revision();
DO $test$
DECLARE actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid();
  plan uuid:=gen_random_uuid(); version uuid:=gen_random_uuid(); other_version uuid:=gen_random_uuid();
  node uuid:=gen_random_uuid(); relation uuid:=gen_random_uuid(); designation uuid:=gen_random_uuid();
  link uuid:=gen_random_uuid(); action uuid:=gen_random_uuid(); process uuid:=gen_random_uuid(); consultation uuid:=gen_random_uuid();
  layer uuid:=gen_random_uuid(); layer_version uuid:=gen_random_uuid(); before_revision integer;
  item record; source_revision integer; target_revision integer;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.test'),(viewer,viewer||'@example.test');
  INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC draft revision',workspace::text);
  INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,viewer,'viewer');
  INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label)
    VALUES(plan,workspace,'SYNTHETIC revision','local-unconfigured','community','SYNTHETIC','SYNTHETIC');
  INSERT INTO public.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind)
    VALUES(version,workspace,plan,1,'original'),(other_version,workspace,plan,2,'revision');
  UPDATE public.land_use_plans SET current_working_version_id=version WHERE id=plan;
  INSERT INTO public.workspace_gis_layers(id,workspace_id,name) VALUES(layer,workspace,'SYNTHETIC');
  INSERT INTO public.workspace_gis_layer_versions(id,layer_id,workspace_id,version_number,source_format,source_filename,source_byte_size,srs_name,srs_basis,declared_feature_count,source_feature_count)
    VALUES(layer_version,layer,workspace,1,'geojson','SYNTHETIC.geojson',0,'WGS84','geojson_rfc7946_default',0,0);
  UPDATE public.workspace_gis_layer_versions SET ingest_status='ready',finalized_at=now() WHERE id=layer_version;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.revision_assert((SELECT draft_revision=0 FROM public.land_use_plan_versions WHERE id=version),'initial counter');
  PERFORM pg_temp.revision_refuses(format('UPDATE public.land_use_plan_versions SET draft_revision=99 WHERE id=%L',version),'42501','direct counter overwrite refused');
  PERFORM pg_temp.revision_refuses(format('INSERT INTO public.land_use_plan_versions(workspace_id,plan_id,version_number,version_kind,draft_revision) VALUES(%L,%L,3,%L,5)',workspace,plan,'revision'),'42501','invented initial counter refused');
  PERFORM pg_temp.revision_refuses(format('UPDATE public.land_use_plan_versions SET id=%L WHERE id=%L',gen_random_uuid(),other_version),'42501','version ownership rewrite refused');
  PERFORM pg_temp.revision_exec(version,format('INSERT INTO public.land_use_plan_content_nodes(id,workspace_id,version_id,node_kind,title,body) VALUES(%L,%L,%L,%L,%L,%L)',node,workspace,version,'policy','SYNTHETIC','Original'),'node insert');
  PERFORM pg_temp.revision_exec(version,format('INSERT INTO public.land_use_plan_relationships(id,workspace_id,plan_id,version_id,related_plan_label,relationship_kind) VALUES(%L,%L,%L,%L,%L,%L)',relation,workspace,plan,version,'SYNTHETIC','overlapping'),'relationship insert');
  PERFORM pg_temp.revision_exec(version,format('INSERT INTO public.land_use_plan_designations(id,workspace_id,version_id,layer_id,layer_version_id,designation_set_label) VALUES(%L,%L,%L,%L,%L,%L)',designation,workspace,version,layer,layer_version,'SYNTHETIC'),'designation insert');
  PERFORM pg_temp.revision_exec(version,format('INSERT INTO public.land_use_plan_designation_policy_links(id,workspace_id,version_id,designation_id,policy_node_id) VALUES(%L,%L,%L,%L,%L)',link,workspace,version,designation,node),'policy link insert');
  PERFORM pg_temp.revision_exec(version,format('INSERT INTO public.land_use_plan_implementation_actions(id,workspace_id,version_id,title) VALUES(%L,%L,%L,%L)',action,workspace,version,'SYNTHETIC'),'implementation insert');
  PERFORM pg_temp.revision_exec(version,format('INSERT INTO public.land_use_plan_process_records(id,workspace_id,plan_id,version_id,descriptor_id,process_key) VALUES(%L,%L,%L,%L,%L,%L)',process,workspace,plan,version,'local-unconfigured','local_process'),'process insert');
  PERFORM pg_temp.revision_exec(version,format('INSERT INTO public.land_use_plan_consultation_records(id,workspace_id,plan_id,version_id,status) VALUES(%L,%L,%L,%L,%L)',consultation,workspace,plan,version,'not_started'),'consultation insert');
  FOR item IN SELECT * FROM (VALUES
    ('land_use_plan_content_nodes',node,'body',quote_literal('Edited')),
    ('land_use_plan_relationships',relation,'notes',quote_literal('Edited')),
    ('land_use_plan_designations',designation,'map_note',quote_literal('Edited')),
    ('land_use_plan_designation_policy_links',link,'created_at',quote_literal('2026-10-01')),
    ('land_use_plan_implementation_actions',action,'title',quote_literal('Edited')),
    ('land_use_plan_process_records',process,'status',quote_literal('in_progress')),
    ('land_use_plan_consultation_records',consultation,'status',quote_literal('in_progress'))
  ) AS changes(table_name,id,column_name,value) LOOP
    PERFORM pg_temp.revision_exec(version,format('UPDATE public.%I SET %I=%s WHERE id=%L',item.table_name,item.column_name,item.value,item.id),item.table_name||' update');
  END LOOP;
  FOR item IN SELECT * FROM (VALUES ('title'),('authority_label'),('geography_label'),('descriptor_id'),('plan_kind_key')) AS fields(column_name) LOOP
    PERFORM pg_temp.revision_exec(version,format('UPDATE public.land_use_plans SET %I=%L WHERE id=%L',item.column_name,'SYNTHETIC changed '||item.column_name,plan),'plan '||item.column_name);
  END LOOP;
  PERFORM pg_temp.revision_exec(version,format('UPDATE public.land_use_plans SET geography_geojson=%L WHERE id=%L','{"type":"Polygon","coordinates":[]}',plan),'plan study geometry');
  PERFORM pg_temp.revision_exec(version,format('UPDATE public.land_use_plans SET title=title WHERE id=%L',plan),'identical plan identity',0);
  PERFORM pg_temp.revision_exec(version,format('UPDATE public.land_use_plan_versions SET applicable_requirement_keys=ARRAY[%L] WHERE id=%L','locally_defined',version),'applicability');
  PERFORM pg_temp.revision_exec(version,format('UPDATE public.land_use_plan_versions SET version_kind=%L WHERE id=%L','revision',version),'version kind');
  PERFORM pg_temp.revision_exec(version,format('UPDATE public.land_use_plan_versions SET based_on_version_id=%L WHERE id=%L',other_version,version),'base version');
  PERFORM pg_temp.revision_exec(version,format('UPDATE public.land_use_plan_versions SET version_number=4 WHERE id=%L',version),'version number');
  SELECT draft_revision INTO source_revision FROM public.land_use_plan_versions WHERE id=version;
  SELECT draft_revision INTO target_revision FROM public.land_use_plan_versions WHERE id=other_version;
  UPDATE public.land_use_plan_implementation_actions SET version_id=other_version WHERE id=action;
  PERFORM pg_temp.revision_assert((SELECT draft_revision=source_revision+1 FROM public.land_use_plan_versions WHERE id=version),'move source revision');
  PERFORM pg_temp.revision_assert((SELECT draft_revision=target_revision+1 FROM public.land_use_plan_versions WHERE id=other_version),'move target revision');
  UPDATE public.land_use_plan_implementation_actions SET version_id=version WHERE id=action;
  SELECT draft_revision INTO before_revision FROM public.land_use_plan_versions WHERE id=version;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',viewer,'role','authenticated')::text,true);
  UPDATE public.land_use_plan_content_nodes SET body='VIEWER' WHERE id=node;
  PERFORM pg_temp.revision_assert((SELECT draft_revision=before_revision FROM public.land_use_plan_versions WHERE id=version),'viewer cannot advance revision');
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  -- Each delete is checked before dependent parents, avoiding cascade counts.
  FOR item IN SELECT * FROM (VALUES
    ('land_use_plan_designation_policy_links',link),('land_use_plan_relationships',relation),
    ('land_use_plan_designations',designation),('land_use_plan_process_records',process),
    ('land_use_plan_consultation_records',consultation)
  ) AS removed(table_name,id) LOOP
    PERFORM pg_temp.revision_exec(version,format('DELETE FROM public.%I WHERE id=%L',item.table_name,item.id),item.table_name||' delete');
  END LOOP;
  PERFORM pg_temp.revision_exec(version,format('DELETE FROM public.land_use_plan_implementation_actions WHERE id=%L',action),'implementation delete');
  PERFORM pg_temp.revision_exec(version,format('DELETE FROM public.land_use_plan_content_nodes WHERE id=%L',node),'node delete');
  INSERT INTO public.land_use_plan_content_nodes(id,workspace_id,version_id,node_kind,title) VALUES(node,workspace,version,'policy','SYNTHETIC retained');
  INSERT INTO public.land_use_plan_implementation_actions(id,workspace_id,version_id,title) VALUES(action,workspace,version,'SYNTHETIC retained');
  SET LOCAL ROLE service_role;
  PERFORM pg_temp.revision_exec(version,format('UPDATE public.land_use_plans SET plan_context=%L WHERE id=%L','{"schemaVersion":1,"place":{},"assessment":{"authorities":[{}]},"savedBy":"synthetic","savedAt":"synthetic"}',plan),'saved plan context');
  -- Context payload is a shallow SQL fixture, not accepted application data.
  UPDATE public.land_use_plans SET plan_context=NULL WHERE id=plan;
  SELECT draft_revision INTO before_revision FROM public.land_use_plan_versions WHERE id=version;
  UPDATE public.land_use_plan_versions SET state='public_review',content_hash=repeat('f',64),frozen_snapshot='{}',frozen_at=now(),frozen_by=actor WHERE id=version;
  PERFORM pg_temp.revision_assert((SELECT draft_revision=before_revision FROM public.land_use_plan_versions WHERE id=version),'freeze preserves final revision');
  PERFORM pg_temp.revision_refuses(format('UPDATE public.land_use_plan_content_nodes SET body=%L WHERE id=%L','Changed frozen',node),'P0001','frozen content update refused');
  PERFORM pg_temp.revision_refuses(format('UPDATE public.land_use_plan_content_nodes SET version_id=%L WHERE id=%L',other_version,node),'42501','move out of frozen content refused');
  PERFORM pg_temp.revision_exec(version,format('UPDATE public.land_use_plan_implementation_actions SET status=%L WHERE id=%L','in_progress',action),'permitted frozen implementation status',0);
  PERFORM pg_temp.revision_refuses(format('UPDATE public.land_use_plan_versions SET draft_revision=draft_revision+1 WHERE id=%L',version),'42501','frozen counter rewrite refused');
  SET LOCAL ROLE postgres;
  PERFORM pg_temp.revision_refuses(format('INSERT INTO frozen_revision_probe(version_id) VALUES(%L)',version),'42501','nested frozen counter rewrite refused');
  SET LOCAL ROLE authenticated;
  -- Source ownership and counter checks do not prevent legitimate cascade cleanup.
  DELETE FROM public.land_use_plans WHERE id=plan;
  PERFORM pg_temp.revision_assert(NOT EXISTS(SELECT 1 FROM public.land_use_plan_versions WHERE plan_id=plan),'plan cascade succeeds');
END $test$;
SELECT 'draft revision verified';
