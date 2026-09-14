-- Follows synthesis-source-custody.sql in the same rollback transaction.
-- These are synthetic service-persistence inputs. TypeScript preparation and
-- correction semantics have separate tests; this fixture proves native custody.
RESET ROLE;
CREATE TEMP TABLE review_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON review_probe TO authenticated,service_role;
INSERT INTO review_probe SELECT 'sha',to_jsonb(snapshot_sha256) FROM engagement_synthesis_sources WHERE id='d0000000-0000-4000-8000-000000000002';
INSERT INTO review_probe SELECT 'members',jsonb_agg(id ORDER BY id) FROM (
 SELECT 'item:'||(v->>'id') id FROM synthesis_probe p CROSS JOIN LATERAL jsonb_array_elements(p.value->'items') v WHERE p.key='snapshot'
 UNION ALL SELECT 'answer:'||(v->>'id') FROM synthesis_probe p CROSS JOIN LATERAL jsonb_array_elements(p.value->'answers') v WHERE p.key='snapshot'
) members;
INSERT INTO review_probe SELECT 'preparation',jsonb_build_object('algorithmVersion',1,'interpretation','not_assessed',
 'source',jsonb_build_object('requestId','d0000000-0000-4000-8000-000000000002','sha256',(SELECT value FROM review_probe WHERE key='sha'),
 'campaignId','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','workspaceId','d51d566d-28c6-49d2-95d2-3a7a2f0902e1'),
 'syntheticCustodyFixture',true,'members',(SELECT value FROM review_probe WHERE key='members'));
INSERT INTO review_probe SELECT 'content',jsonb_build_object('schemaVersion',1,'status','staff_draft',
 'sourceId','d0000000-0000-4000-8000-000000000002','sourceSha256',(SELECT value FROM review_probe WHERE key='sha'),
 'title','SYNTHETIC original draft','notes','', 'assignedSourceCount',303,'overlappingSourceCount',0,'unassignedSourceIds','[]'::jsonb,
 'groups',jsonb_build_array(jsonb_build_object('id','synthetic-custody','label','SYNTHETIC native custody group','summary','','sentiment','not_assessed','sourceIds',(SELECT value FROM review_probe WHERE key='members'))));
INSERT INTO review_probe VALUES('createIntent','{"operation":"create","requestId":"e0000000-0000-4000-8000-000000000001","actorId":"13466ed2-dcb7-4861-a528-68cc5579eea9","workspaceId":"d51d566d-28c6-49d2-95d2-3a7a2f0902e1","sourceId":"d0000000-0000-4000-8000-000000000002"}');
UPDATE review_probe SET value=value||jsonb_build_object('sourceSha256',(SELECT value FROM review_probe WHERE key='sha')) WHERE key='createIntent';
CREATE FUNCTION pg_temp.retain_review(intent jsonb,content jsonb,preparation jsonb DEFAULT NULL,
 actor uuid DEFAULT '13466ed2-dcb7-4861-a528-68cc5579eea9',workspace uuid DEFAULT 'd51d566d-28c6-49d2-95d2-3a7a2f0902e1') RETURNS jsonb LANGUAGE sql AS $$
 SELECT retain_engagement_synthesis_review('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',actor,workspace,intent,
 'd0000000-0000-4000-8000-000000000002',(SELECT value#>>'{}' FROM review_probe WHERE key='sha'),preparation::text,content::text);
$$;
CREATE FUNCTION pg_temp.create_review(request uuid DEFAULT 'e0000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.retain_review((SELECT value||jsonb_build_object('requestId',request) FROM review_probe WHERE key='createIntent'),
 (SELECT value FROM review_probe WHERE key='content'),(SELECT value FROM review_probe WHERE key='preparation'));
$$;
CREATE FUNCTION pg_temp.read_review(revision uuid DEFAULT NULL,review uuid DEFAULT 'e0000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_review('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',review,revision);
$$;
SET LOCAL ROLE service_role;
INSERT INTO review_probe SELECT 'receipt',pg_temp.create_review();
SELECT pg_temp.assert_true((SELECT value->>'revisionNo'='1' AND value->>'replayed'='false' FROM review_probe WHERE key='receipt'),'Initial review receipt differs');
SELECT pg_temp.assert_true(pg_temp.create_review()=(SELECT value||'{"replayed":true}'::jsonb FROM review_probe WHERE key='receipt'),'Exact review retry changed its receipt');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM engagement_synthesis_reviews),'Review retry duplicated roots');
SELECT pg_temp.assert_true((SELECT count(*)=1 FROM engagement_synthesis_review_revisions),'Review retry duplicated revisions');
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE authenticated;
INSERT INTO review_probe SELECT 'originalRead',pg_temp.read_review();
SELECT pg_temp.assert_true((SELECT value->>'preparationText'=(SELECT value::text FROM review_probe WHERE key='preparation')
 AND value->'revision'->>'contentText'=(SELECT value::text FROM review_probe WHERE key='content') FROM review_probe WHERE key='originalRead'),'Review changed retained bytes');
SELECT pg_temp.assert_true((SELECT jsonb_array_length((value->'revision'->>'contentText')::jsonb->'groups'->0->'sourceIds')=303 FROM review_probe WHERE key='originalRead'),'Review lost complete member IDs');
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_reviews','42501','Direct private review read was allowed');
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_review_revisions','42501','Direct private revision read was allowed');
SELECT pg_temp.expect_error('SELECT pg_temp.create_review()','42501','Authenticated caller forged machine preparation');
SELECT pg_temp.expect_error($q$SELECT engagement_synthesis_review_receipt('e0000000-0000-4000-8000-000000000001',false)$q$,'42501','Private receipt helper was callable');
RESET ROLE;
INSERT INTO review_probe SELECT 'corrected',value||jsonb_build_object('title','SYNTHETIC corrected title','notes',repeat('SYNTHETIC Unicode é ',80)||'CORRECTION TAIL') FROM review_probe WHERE key='content';
INSERT INTO review_probe SELECT 'correctionIntent',jsonb_build_object('requestId','e0000000-0000-4000-8000-000000000002','actorId','13466ed2-dcb7-4861-a528-68cc5579eea9',
 'workspaceId','d51d566d-28c6-49d2-95d2-3a7a2f0902e1','operation','correct','reviewId','e0000000-0000-4000-8000-000000000001',
 'expectedRevisionId','e0000000-0000-4000-8000-000000000001','expectedRevisionSha256',value->'revisionSha256',
 'reason','SYNTHETIC staff checked wording','change',jsonb_build_object('kind','notes','title','SYNTHETIC corrected title','notes',(SELECT value->>'notes' FROM review_probe WHERE key='corrected')))
 FROM review_probe WHERE key='receipt';
SET LOCAL ROLE service_role;
INSERT INTO review_probe SELECT 'correctedReceipt',pg_temp.retain_review((SELECT value FROM review_probe WHERE key='correctionIntent'),(SELECT value FROM review_probe WHERE key='corrected'));
SELECT pg_temp.assert_true((SELECT value->>'revisionNo'='2' AND value->>'revisionSha256'<>(SELECT value->>'revisionSha256' FROM review_probe WHERE key='receipt') FROM review_probe WHERE key='correctedReceipt'),'Correction did not retain a new revision');
SELECT pg_temp.assert_true(pg_temp.retain_review((SELECT value FROM review_probe WHERE key='correctionIntent'),'{"ignoredOnExactRetry":true}')=(SELECT value||'{"replayed":true}' FROM review_probe WHERE key='correctedReceipt'),'Exact correction retry did not return original');
SELECT pg_temp.expect_error($q$SELECT pg_temp.retain_review((SELECT value||'{"reason":"SYNTHETIC changed retry"}' FROM review_probe WHERE key='correctionIntent'),(SELECT value FROM review_probe WHERE key='corrected'))$q$,'PT409','Changed correction retry was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.retain_review((SELECT value||'{"actorId":"7a50d4fb-35b7-41f4-9bce-8a4e7d157569"}' FROM review_probe WHERE key='correctionIntent'),(SELECT value FROM review_probe WHERE key='corrected'),NULL,'7a50d4fb-35b7-41f4-9bce-8a4e7d157569')$q$,'PT409','Another actor reused review request');
SELECT pg_temp.expect_error($q$SELECT pg_temp.retain_review((SELECT value||'{"requestId":"e0000000-0000-4000-8000-000000000003"}' FROM review_probe WHERE key='correctionIntent'),(SELECT value||'{"notes":"SYNTHETIC stale overwrite"}' FROM review_probe WHERE key='corrected'))$q$,'PT409','Stale parent overwrote the current review');
RESET ROLE;
SET LOCAL ROLE authenticated;
INSERT INTO review_probe SELECT 'currentRead',pg_temp.read_review();
SELECT pg_temp.assert_true((SELECT value->'revision'->>'contentText'=(SELECT value::text FROM review_probe WHERE key='corrected') AND value->'revision'->>'parentId'='e0000000-0000-4000-8000-000000000001' FROM review_probe WHERE key='currentRead'),'Latest corrected read differs');
SELECT pg_temp.assert_true(pg_temp.read_review('e0000000-0000-4000-8000-000000000001')->'revision'=(SELECT value->'revision' FROM review_probe WHERE key='originalRead'),'Original review revision was replaced');
SELECT pg_temp.assert_true(pg_temp.read_review()->>'preparationText'=(SELECT value->>'preparationText' FROM review_probe WHERE key='originalRead'),'Correction rewrote original preparation');
SELECT pg_temp.assert_true(pg_temp.read_review('e0000000-0000-4000-8000-000000000099') IS NULL,'Missing revision was substituted with current');
SELECT pg_temp.assert_true(pg_temp.read_review(NULL,'e0000000-0000-4000-8000-000000000099') IS NULL,'Missing review was substituted');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_review('250f0f62-7225-48b3-a2f7-5a134d3b9f78','e0000000-0000-4000-8000-000000000001')$q$,'42501','Foreign campaign returned private review');
RESET ROLE;
CREATE FUNCTION pg_temp.correct_review(request uuid,parent uuid,parent_sha text,notes text) RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.retain_review((SELECT value||jsonb_build_object('requestId',request,'expectedRevisionId',parent,'expectedRevisionSha256',parent_sha,
 'reason','SYNTHETIC correction evidence','change',jsonb_build_object('kind','notes','title','SYNTHETIC corrected title','notes',notes)) FROM review_probe WHERE key='correctionIntent'),
 (SELECT value||jsonb_build_object('notes',notes) FROM review_probe WHERE key='corrected'));
$$;
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.correct_review('e0000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000002',repeat('0',64),'SYNTHETIC mismatch')$q$,'PT409','Wrong parent checksum was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.retain_review((SELECT value||'{"requestId":"e0000000-0000-4000-8000-000000000003","reason":" "}' FROM review_probe WHERE key='correctionIntent'),(SELECT value FROM review_probe WHERE key='corrected'))$q$,'22023','Blank correction reason was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.retain_review((SELECT value||'{"requestId":"e0000000-0000-4000-8000-000000000003","unexpected":true}' FROM review_probe WHERE key='createIntent'),(SELECT value FROM review_probe WHERE key='content'),(SELECT value FROM review_probe WHERE key='preparation'))$q$,'22023','Unknown intent field was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.retain_review((SELECT value||'{"requestId":"e0000000-0000-4000-8000-000000000003"}' FROM review_probe WHERE key='createIntent'),(SELECT value||'{"status":"approved"}' FROM review_probe WHERE key='content'),(SELECT value FROM review_probe WHERE key='preparation'))$q$,'22023','Draft retention promoted approval');
SELECT pg_temp.expect_error($q$SELECT pg_temp.retain_review((SELECT value||'{"requestId":"e0000000-0000-4000-8000-000000000003"}' FROM review_probe WHERE key='createIntent'),(SELECT value||jsonb_build_object('sourceSha256',repeat('0',64)) FROM review_probe WHERE key='content'),(SELECT value FROM review_probe WHERE key='preparation'))$q$,'22023','Content source checksum differed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.retain_review((SELECT value||'{"requestId":"e0000000-0000-4000-8000-000000000003"}' FROM review_probe WHERE key='createIntent'),(SELECT value FROM review_probe WHERE key='content'),(SELECT jsonb_set(value,'{source,sha256}',to_jsonb(repeat('0',64))) FROM review_probe WHERE key='preparation'))$q$,'22023','Preparation source checksum differed');
SELECT pg_temp.expect_error($q$SELECT pg_temp.retain_review((SELECT value||'{"requestId":"e0000000-0000-4000-8000-000000000003"}' FROM review_probe WHERE key='createIntent'),(SELECT value FROM review_probe WHERE key='content'),(SELECT value||'{"interpretation":"neutral"}' FROM review_probe WHERE key='preparation'))$q$,'22023','Preparation claimed inferred sentiment');
SELECT pg_temp.expect_error($q$SELECT pg_temp.retain_review((SELECT value||'{"requestId":"e0000000-0000-4000-8000-000000000003"}' FROM review_probe WHERE key='createIntent'),(SELECT value FROM review_probe WHERE key='content'),NULL)$q$,'22023','Missing preparation was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.retain_review((SELECT value||'{"requestId":"e0000000-0000-4000-8000-000000000003"}' FROM review_probe WHERE key='createIntent'),NULL,(SELECT value FROM review_probe WHERE key='preparation'))$q$,'22023','Missing review content was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.correct_review('e0000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000002',(SELECT value->>'revisionSha256' FROM review_probe WHERE key='correctedReceipt'),(SELECT value->>'notes' FROM review_probe WHERE key='corrected'))$q$,'22023','Unchanged content created a revision');
RESET ROLE;
CREATE FUNCTION pg_temp.fail_review_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC review save failure'; END $$;
CREATE TRIGGER synthetic_review_insert_failure BEFORE INSERT ON engagement_synthesis_review_revisions FOR EACH ROW
 WHEN (NEW.id='e0000000-0000-4000-8000-000000000099'::uuid) EXECUTE FUNCTION pg_temp.fail_review_insert();
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.create_review('e0000000-0000-4000-8000-000000000099')$q$,'P0001','Failed review persistence returned an acknowledgement');
RESET ROLE;
SELECT pg_temp.assert_true(NOT EXISTS(SELECT 1 FROM engagement_synthesis_reviews WHERE id='e0000000-0000-4000-8000-000000000099'),'Failed initial revision left an orphan review');
SELECT pg_temp.assert_true((SELECT count(*)=2 FROM engagement_synthesis_review_revisions),'Refusals inserted revision rows');
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_reviews SET preparation_text='{}' WHERE id='e0000000-0000-4000-8000-000000000001'$q$,'P0001','Original preparation was mutable');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_reviews WHERE id='e0000000-0000-4000-8000-000000000001'$q$,'P0001','Original review could be deleted');
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_review_revisions SET content_text='{}' WHERE id='e0000000-0000-4000-8000-000000000002'$q$,'P0001','Revision content was mutable');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_review_revisions WHERE id='e0000000-0000-4000-8000-000000000002'$q$,'P0001','Revision history could be deleted');
UPDATE workspace_members SET role='viewer' WHERE user_id='13466ed2-dcb7-4861-a528-68cc5579eea9' AND workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.create_review()','42501','Revoked staff replayed review creation');
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.read_review()','42501','Viewer read a private review');
SELECT pg_temp.expect_error($q$SELECT list_engagement_synthesis_reviews('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','d0000000-0000-4000-8000-000000000002')$q$,'42501','Viewer listed private review metadata');
SELECT pg_temp.expect_error($q$SELECT list_engagement_synthesis_review_revisions('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','e0000000-0000-4000-8000-000000000001')$q$,'42501','Viewer listed revision metadata');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE user_id='13466ed2-dcb7-4861-a528-68cc5579eea9' AND workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1';
SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.read_review()','42501','Foreign workspace read private review');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT pg_temp.read_review()','42501','Anonymous review read was allowed');
SELECT pg_temp.expect_error($q$SELECT list_engagement_synthesis_reviews('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','d0000000-0000-4000-8000-000000000002')$q$,'42501','Anonymous review listing was allowed');
SELECT pg_temp.expect_error($q$SELECT list_engagement_synthesis_review_revisions('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','e0000000-0000-4000-8000-000000000001')$q$,'42501','Anonymous revision listing was allowed');
RESET ROLE;
-- Metadata lists must reach the tail of both root and revision histories.
SET LOCAL ROLE service_role;
SELECT pg_temp.create_review(('e0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid) FROM generate_series(100,125) n;
DO $$ DECLARE n integer; parent_id uuid:='e0000000-0000-4000-8000-000000000002'; parent_sha text; receipt jsonb;
BEGIN
 SELECT value->>'revisionSha256' INTO parent_sha FROM review_probe WHERE key='correctedReceipt';
 FOR n IN 3..28 LOOP
  receipt:=pg_temp.correct_review(('f0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,parent_id,parent_sha,'SYNTHETIC revision '||n);
  parent_id:=(receipt->>'requestId')::uuid; parent_sha:=receipt->>'revisionSha256';
 END LOOP;
END $$;
SET LOCAL ROLE authenticated;
INSERT INTO review_probe SELECT 'reviewPage',list_engagement_synthesis_reviews('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','d0000000-0000-4000-8000-000000000002');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(value->'entries')=25 AND jsonb_typeof(value->'nextCursor')='object' FROM review_probe WHERE key='reviewPage'),'Review list lost its continuation');
INSERT INTO review_probe SELECT 'reviewTail',list_engagement_synthesis_reviews('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','d0000000-0000-4000-8000-000000000002',(SELECT value->'nextCursor' FROM review_probe WHERE key='reviewPage'));
SELECT pg_temp.assert_true((SELECT jsonb_array_length(value->'entries')=2 AND value->'nextCursor'='null'::jsonb FROM review_probe WHERE key='reviewTail'),'Review list lost its tail');
SELECT pg_temp.assert_true((SELECT value->'entries'->1->>'title'='SYNTHETIC corrected title' FROM review_probe WHERE key='reviewTail'),'Review list title did not follow retained head');
INSERT INTO review_probe SELECT 'revisionPage',list_engagement_synthesis_review_revisions('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','e0000000-0000-4000-8000-000000000001');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(value->'entries')=25 AND value->>'nextCursor'='4' FROM review_probe WHERE key='revisionPage'),'Revision list lost its continuation');
INSERT INTO review_probe SELECT 'revisionTail',list_engagement_synthesis_review_revisions('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','e0000000-0000-4000-8000-000000000001',(SELECT (value->>'nextCursor')::integer FROM review_probe WHERE key='revisionPage'));
SELECT pg_temp.assert_true((SELECT jsonb_array_length(value->'entries')=3 AND value->'entries'->2->>'revisionNo'='1' AND value->'nextCursor'='null'::jsonb FROM review_probe WHERE key='revisionTail'),'Revision list lost its tail');
SELECT pg_temp.expect_error($q$SELECT list_engagement_synthesis_reviews('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','d0000000-0000-4000-8000-000000000002','{"createdAt":"now","id":"e0000000-0000-4000-8000-000000000001"}')$q$,'22023','Review list accepted relative cursor');
SELECT pg_temp.expect_error($q$SELECT list_engagement_synthesis_reviews('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','d0000000-0000-4000-8000-000000000002','null')$q$,'22023','Review list accepted a null JSON cursor');
SELECT pg_temp.expect_error($q$SELECT list_engagement_synthesis_review_revisions('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','e0000000-0000-4000-8000-000000000001',0)$q$,'22023','Revision list accepted zero cursor');
RESET ROLE;
SELECT 'synthesis-review-custody-verified';
