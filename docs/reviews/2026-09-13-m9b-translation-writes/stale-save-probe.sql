BEGIN;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='3s';
CREATE TEMP TABLE translation_write_probe_result (result jsonb NOT NULL);
DO $proof$
DECLARE
 campaign uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid();
 actor uuid:=gen_random_uuid(); translation uuid:=gen_random_uuid();
 source_before text:='SYNTHETIC original source';
 history_before text; previous_clock timestamptz;
BEGIN
 INSERT INTO auth.users(id,aud,role,email) VALUES(actor,'authenticated','authenticated',actor::text||'@translation-write-probe.invalid');
 INSERT INTO workspaces(id,name,slug) VALUES(workspace,'SYNTHETIC translation write probe',workspace::text);
 INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner');
 INSERT INTO engagement_campaigns(id,workspace_id,title,created_by) VALUES(campaign,workspace,source_before,actor);
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 SET LOCAL ROLE authenticated;
 INSERT INTO engagement_content_translations(id,workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,created_by)
 VALUES(translation,workspace,campaign,'campaign',campaign,'title','qaa','SYNTHETIC original wording','operator',actor);
 SELECT updated_at INTO STRICT previous_clock FROM engagement_content_translations WHERE id=translation;
 SELECT record_sha256 INTO STRICT history_before FROM engagement_translation_history WHERE translation_id=translation AND revision=1;
 UPDATE engagement_content_translations SET translated_text='SYNTHETIC newer correction',updated_at=clock_timestamp() WHERE id=translation;
 IF NOT EXISTS(SELECT 1 FROM engagement_content_translations WHERE id=translation AND translated_text='SYNTHETIC newer correction') THEN
  RAISE EXCEPTION 'Positive correction control failed';
 END IF;
 -- This has the route's current upsert shape: it carries no expected version.
 INSERT INTO engagement_content_translations(workspace_id,campaign_id,entity_type,entity_id,field,locale,translated_text,source,created_by,updated_at)
 VALUES(workspace,campaign,'campaign',campaign,'title','qaa','SYNTHETIC stale editor wording','operator',actor,clock_timestamp())
 ON CONFLICT(entity_type,entity_id,field,locale) DO UPDATE SET
  translated_text=EXCLUDED.translated_text,source=EXCLUDED.source,created_by=EXCLUDED.created_by,updated_at=EXCLUDED.updated_at;
 IF NOT EXISTS(SELECT 1 FROM engagement_content_translations WHERE id=translation AND translated_text='SYNTHETIC stale editor wording') THEN
  RAISE EXCEPTION 'Current stale-write behavior changed; reassess the probe';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=translation AND revision=1 AND record_sha256=history_before)
 OR NOT EXISTS(SELECT 1 FROM engagement_translation_history WHERE translation_id=translation AND revision=2 AND record_json->>'translated_text'='SYNTHETIC newer correction') THEN
  RAISE EXCEPTION 'Existing history custody control failed';
 END IF;
 UPDATE engagement_campaigns SET title='SYNTHETIC changed source' WHERE id=campaign;
 UPDATE engagement_content_translations SET translated_text='SYNTHETIC wording of old source',source_text_hash=encode(extensions.digest(source_before,'sha256'),'hex') WHERE id=translation;
 IF NOT EXISTS(SELECT 1 FROM engagement_content_translations WHERE id=translation AND translated_text='SYNTHETIC wording of old source') THEN
  RAISE EXCEPTION 'Current source-race behavior changed; reassess the probe';
 END IF;
 RESET ROLE;
 INSERT INTO pg_temp.translation_write_probe_result VALUES(jsonb_build_object(
  'staleSaveSilentlyReplacesNewerWording',true,
  'sourceChangedBeforeSaveStillAcceptsOldSourceHash',true,
  'originalAndNewerHistoryRetained',true,
  'observedOldClock',previous_clock IS NOT NULL,
  'scope','Actual authenticated SQL with current route-shaped writes; no simultaneous clients or HTTP proof'));
END $proof$;
SELECT result FROM pg_temp.translation_write_probe_result;
ROLLBACK;
