CREATE FUNCTION pg_temp.gis_assert(ok boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF ok IS NOT TRUE THEN RAISE EXCEPTION '%',label; END IF; END $$;
CREATE FUNCTION pg_temp.gis_refuses(statement text, expected_message text, label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE='P0001' AND SQLERRM=expected_message THEN RETURN; END IF;
    RAISE EXCEPTION '%: unexpected % %',label,SQLSTATE,SQLERRM;
  END;
  RAISE EXCEPTION '%: accepted',label;
END $$;
DO $test$
DECLARE
  workspace uuid:=gen_random_uuid(); layer uuid:=gen_random_uuid();
  ready_version uuid:=gen_random_uuid(); draft_version uuid:=gen_random_uuid();
  ready_feature uuid:=gen_random_uuid(); draft_feature uuid:=gen_random_uuid();
  version_error text:='Finalized workspace GIS versions are immutable';
  feature_error text:='Features of a finalized workspace GIS version are immutable';
BEGIN
  INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC GIS cascade',workspace::text);
  INSERT INTO public.workspace_gis_layers(id,workspace_id,name) VALUES(layer,workspace,'SYNTHETIC GIS');
  INSERT INTO public.workspace_gis_layer_versions(id,layer_id,workspace_id,version_number,source_format,source_filename,source_byte_size,srs_name,srs_basis,declared_feature_count,source_feature_count)
    VALUES(ready_version,layer,workspace,1,'geojson','SYNTHETIC.geojson',0,'WGS84','geojson_rfc7946_default',1,1),
      (draft_version,layer,workspace,2,'geojson','SYNTHETIC-draft.geojson',0,'WGS84','geojson_rfc7946_default',1,1);
  INSERT INTO public.workspace_gis_features(id,version_id,layer_id,workspace_id,feature_index,geom,properties)
    VALUES(ready_feature,ready_version,layer,workspace,0,ST_SetSRID(ST_Point(-121,38),4326),'{"name":"retained"}'),
      (draft_feature,draft_version,layer,workspace,0,ST_SetSRID(ST_Point(-121,38),4326),'{"name":"draft"}');
  UPDATE public.workspace_gis_layer_versions SET ingest_status='ready',finalized_at=now(),feature_count=(SELECT count(*) FROM public.workspace_gis_features WHERE version_id=ready_version) WHERE id=ready_version;
  PERFORM pg_temp.gis_refuses(format('UPDATE public.workspace_gis_layer_versions SET source_filename=%L WHERE id=%L','changed',ready_version),version_error,'direct ready version update');
  PERFORM pg_temp.gis_refuses(format('DELETE FROM public.workspace_gis_layer_versions WHERE id=%L',ready_version),version_error,'direct ready version delete');
  PERFORM pg_temp.gis_refuses(format('UPDATE public.workspace_gis_layer_versions SET ingest_status=%L WHERE id=%L','receiving',ready_version),version_error,'ready version unfreeze');
  PERFORM pg_temp.gis_refuses(format('UPDATE public.workspace_gis_features SET properties=%L WHERE id=%L','{"name":"changed"}',ready_feature),feature_error,'direct ready feature update');
  PERFORM pg_temp.gis_refuses(format('DELETE FROM public.workspace_gis_features WHERE id=%L',ready_feature),feature_error,'direct ready feature delete');
  PERFORM pg_temp.gis_refuses(format('UPDATE public.workspace_gis_features SET version_id=%L,feature_index=1 WHERE id=%L',draft_version,ready_feature),feature_error,'move out of ready version');
  PERFORM pg_temp.gis_refuses(format('UPDATE public.workspace_gis_features SET version_id=%L,feature_index=1 WHERE id=%L',ready_version,draft_feature),feature_error,'move into ready version');
  PERFORM pg_temp.gis_refuses(format('INSERT INTO public.workspace_gis_features(version_id,layer_id,workspace_id,feature_index,geom) VALUES(%L,%L,%L,1,ST_SetSRID(ST_Point(-121,38),4326))',ready_version,layer,workspace),feature_error,'insert into ready version');
  UPDATE public.workspace_gis_layer_versions SET source_filename='editable.geojson' WHERE id=draft_version;
  UPDATE public.workspace_gis_features SET properties='{"name":"editable"}' WHERE id=draft_feature;
  PERFORM pg_temp.gis_assert((SELECT properties->>'name'='editable' FROM public.workspace_gis_features WHERE id=draft_feature),'draft feature remains editable');
  PERFORM pg_temp.gis_assert((SELECT properties->>'name'='retained' AND version_id=ready_version FROM public.workspace_gis_features WHERE id=ready_feature),'finalized feature retained');
  DELETE FROM public.workspace_gis_layer_versions WHERE id=draft_version;
  PERFORM pg_temp.gis_assert(NOT EXISTS(SELECT 1 FROM public.workspace_gis_features WHERE id=draft_feature),'mutable version cascade');
  IF current_setting('openplan.test_cascade_workspace',true)='1' THEN
    DELETE FROM public.workspaces WHERE id=workspace;
    PERFORM pg_temp.gis_assert(NOT EXISTS(SELECT 1 FROM public.workspace_gis_layers WHERE id=layer),'workspace removes layer');
  ELSE
    DELETE FROM public.workspace_gis_layers WHERE id=layer;
  END IF;
  PERFORM pg_temp.gis_assert(NOT EXISTS(SELECT 1 FROM public.workspace_gis_layer_versions WHERE id=ready_version),'parent removes finalized version');
  PERFORM pg_temp.gis_assert(NOT EXISTS(SELECT 1 FROM public.workspace_gis_features WHERE id=ready_feature),'parent removes finalized feature');
END $test$;
SELECT 'gis cascade verified';
