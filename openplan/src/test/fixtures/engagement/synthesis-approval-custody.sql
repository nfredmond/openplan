-- Runs after synthesis-source-custody.sql in a rollback transaction. These are
-- explicitly synthetic persistence inputs; the production TypeScript join is separate.
RESET ROLE;
CREATE TEMP TABLE approval_probe(key text PRIMARY KEY,value jsonb);
GRANT SELECT,INSERT ON approval_probe TO authenticated,service_role;
-- Anonymous fault probes must reach the real RPC, not fail on this synthetic input table.
GRANT SELECT ON approval_probe TO anon;
INSERT INTO approval_probe SELECT 'sourceSha',to_jsonb(snapshot_sha256) FROM engagement_synthesis_sources WHERE id='d0000000-0000-4000-8000-000000000002';
INSERT INTO approval_probe SELECT 'preparation',jsonb_build_object('algorithmVersion',1,'interpretation','not_assessed',
 'source',jsonb_build_object('requestId','d0000000-0000-4000-8000-000000000002','sha256',(SELECT value FROM approval_probe WHERE key='sourceSha'),
 'campaignId','10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','workspaceId','d51d566d-28c6-49d2-95d2-3a7a2f0902e1'),'syntheticCustodyFixture',true);
INSERT INTO approval_probe SELECT 'content',jsonb_build_object('schemaVersion',1,'status','staff_draft',
 'sourceId','d0000000-0000-4000-8000-000000000002','sourceSha256',(SELECT value FROM approval_probe WHERE key='sourceSha'),
 'title','SYNTHETIC approval custody draft','notes','SYNTHETIC original review');
CREATE FUNCTION pg_temp.new_approval_review(request uuid) RETURNS jsonb LANGUAGE sql AS $$
 SELECT retain_engagement_synthesis_review('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','13466ed2-dcb7-4861-a528-68cc5579eea9','d51d566d-28c6-49d2-95d2-3a7a2f0902e1',
 jsonb_build_object('operation','create','requestId',request,'actorId','13466ed2-dcb7-4861-a528-68cc5579eea9','workspaceId','d51d566d-28c6-49d2-95d2-3a7a2f0902e1',
 'sourceId','d0000000-0000-4000-8000-000000000002','sourceSha256',(SELECT value FROM approval_probe WHERE key='sourceSha')),
 'd0000000-0000-4000-8000-000000000002',(SELECT value#>>'{}' FROM approval_probe WHERE key='sourceSha'),
 (SELECT value::text FROM approval_probe WHERE key='preparation'),(SELECT value::text FROM approval_probe WHERE key='content'));
$$;
SET LOCAL ROLE service_role;
INSERT INTO approval_probe SELECT 'review1',pg_temp.new_approval_review('e2000000-0000-4000-8000-000000000001');
INSERT INTO approval_probe SELECT 'otherReview',pg_temp.new_approval_review('e2000000-0000-4000-8000-000000000100');
RESET ROLE;
INSERT INTO approval_probe SELECT 'intent',jsonb_build_object('campaignId',r.campaign_id,'workspaceId',r.workspace_id,'reviewId',r.id,
 'sourceId',r.source_id,'sourceSha256',r.source_sha256,'preparationSha256',r.preparation_sha256,'revisionId',v.id,
 'revisionSha256',v.content_sha256,'revisionNo',v.revision_no,'requestId','f2000000-0000-4000-8000-000000000001',
 'actorId','13466ed2-dcb7-4861-a528-68cc5579eea9','operation','approve','reason','SYNTHETIC exact internal review 中文 🚲',
 'predecessorId',NULL,'predecessorSha256',NULL)
 FROM engagement_synthesis_reviews r JOIN engagement_synthesis_review_revisions v ON v.review_id=r.id WHERE r.id='e2000000-0000-4000-8000-000000000001';
CREATE FUNCTION pg_temp.approval(command jsonb DEFAULT NULL,actor uuid DEFAULT '13466ed2-dcb7-4861-a528-68cc5579eea9',
 workspace uuid DEFAULT 'd51d566d-28c6-49d2-95d2-3a7a2f0902e1',campaign uuid DEFAULT '10c5cdd7-16c6-4b91-b9c0-d2f67598a54f') RETURNS jsonb LANGUAGE sql AS $$
 SELECT retain_engagement_synthesis_approval(campaign,actor,workspace,COALESCE(command,(SELECT value FROM approval_probe WHERE key='intent')));
$$;
CREATE FUNCTION pg_temp.approval_history(review uuid DEFAULT 'e2000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_approval_history('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',review);
$$;
CREATE FUNCTION pg_temp.approval_read(request uuid DEFAULT 'f2000000-0000-4000-8000-000000000001') RETURNS jsonb LANGUAGE sql AS $$
 SELECT read_engagement_synthesis_approval('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',request);
$$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.approval_history()->>'eventCount'='0' AND pg_temp.approval_history()->'entries'='[]'::jsonb
 AND pg_temp.approval_history()->'headId'='null'::jsonb AND pg_temp.approval_history()->'headSha256'='null'::jsonb,'Empty approval history was invented');
SELECT pg_temp.assert_true(pg_temp.approval_read() IS NULL,'Missing approval event was invented');
SELECT pg_temp.assert_true(pg_temp.approval_history('e2000000-0000-4000-8000-000000000099') IS NULL,'Missing review got empty approval history');
SELECT pg_temp.expect_error('SELECT pg_temp.approval()','42501','Authenticated user directly wrote an approval');
SELECT pg_temp.expect_error('SELECT * FROM engagement_synthesis_approval_events','42501','Direct private approval table read was allowed');
SELECT pg_temp.expect_error($q$SELECT engagement_synthesis_approval_packet('f2000000-0000-4000-8000-000000000001')$q$,'42501','Private approval packet helper was callable');
RESET ROLE;
SET LOCAL ROLE service_role;
INSERT INTO approval_probe SELECT 'first',pg_temp.approval();
SELECT pg_temp.assert_true((SELECT value->>'replayed'='false' AND (value#>>'{event,eventText}')::jsonb->>'purpose'='internal_staff_synthesis'
 AND (value#>>'{event,eventText}')::jsonb->>'schemaVersion'='1' AND (value#>>'{event,eventText}')::jsonb->>'eventNo'='1'
 AND (value#>>'{event,eventText}')::jsonb->'intent'=(SELECT value FROM approval_probe WHERE key='intent')
 AND value#>>'{event,eventSha256}'=encode(extensions.digest(value#>>'{event,eventText}','sha256'),'hex') FROM approval_probe WHERE key='first'),'First approval packet or exact intent differs');
SELECT pg_temp.assert_true(pg_temp.approval()=(SELECT value||'{"replayed":true}' FROM approval_probe WHERE key='first'),'Exact approval retry changed retained actor clock or bytes');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||'{"reason":"SYNTHETIC changed retry"}' FROM approval_probe WHERE key='intent'))$q$,'PT409','Changed approval retry was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||'{"actorId":"7a50d4fb-35b7-41f4-9bce-8a4e7d157569"}' FROM approval_probe WHERE key='intent'),'7a50d4fb-35b7-41f4-9bce-8a4e7d157569')$q$,'PT409','Another actor reused approval request');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||jsonb_build_object('sourceSha256',repeat('0',64)) FROM approval_probe WHERE key='intent'))$q$,'PT409','Changed source retry was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||'{"requestId":"f2000000-0000-4000-8000-000000000099"}' FROM approval_probe WHERE key='intent'))$q$,'PT409','Competing root approval was accepted');
RESET ROLE;
INSERT INTO approval_probe SELECT 'successor',value||jsonb_build_object('requestId','f2000000-0000-4000-8000-000000000002',
 'predecessorId','f2000000-0000-4000-8000-000000000001','predecessorSha256',(SELECT value#>>'{event,eventSha256}' FROM approval_probe WHERE key='first')) FROM approval_probe WHERE key='intent';
INSERT INTO approval_probe SELECT 'validation',value||'{"operation":"withdraw"}' FROM approval_probe WHERE key='successor';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value FROM approval_probe WHERE key='successor'))$q$,'PT409','Already approved version was approved again');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||jsonb_build_object('predecessorSha256',repeat('0',64)) FROM approval_probe WHERE key='validation'))$q$,'PT409','Wrong approval predecessor checksum was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||'{"predecessorId":"f2000000-0000-4000-8000-000000000098"}' FROM approval_probe WHERE key='validation'))$q$,'PT409','Wrong approval predecessor identifier was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||'{"sourceId":"d0000000-0000-4000-8000-000000000001"}' FROM approval_probe WHERE key='validation'))$q$,'PT409','Wrong approval source identifier was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||jsonb_build_object('sourceSha256',repeat('0',64)) FROM approval_probe WHERE key='validation'))$q$,'PT409','Wrong approval source checksum was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||jsonb_build_object('preparationSha256',repeat('0',64)) FROM approval_probe WHERE key='validation'))$q$,'PT409','Wrong approval preparation checksum was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||jsonb_build_object('revisionSha256',repeat('0',64)) FROM approval_probe WHERE key='validation'))$q$,'PT409','Wrong approval revision checksum was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||'{"revisionNo":2}' FROM approval_probe WHERE key='validation'))$q$,'PT409','Wrong approval revision number was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||'{"revisionId":"e2000000-0000-4000-8000-000000000100"}' FROM approval_probe WHERE key='validation'))$q$,'PT409','Another review supplied the approval revision');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||'{"reason":""}' FROM approval_probe WHERE key='validation'))$q$,'22023','Empty approval reason was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||jsonb_build_object('reason',E'\t\n ') FROM approval_probe WHERE key='validation'))$q$,'22023','Whitespace approval reason was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||jsonb_build_object('reason',U&'\FEFF\00A0\FEFF') FROM approval_probe WHERE key='validation'))$q$,'22023','Unicode blank approval reason was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||jsonb_build_object('reason',repeat('🚲',2001)) FROM approval_probe WHERE key='validation'))$q$,'22023','Overlong approval reason was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||'{"operation":"publish"}' FROM approval_probe WHERE key='validation'))$q$,'22023','Approval promoted public authority');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||'{"extra":true}' FROM approval_probe WHERE key='validation'))$q$,'22023','Unknown approval intent field was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value-'reason' FROM approval_probe WHERE key='validation'))$q$,'22023','Missing approval intent field was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||'{"requestId":"not-a-uuid"}' FROM approval_probe WHERE key='validation'))$q$,'22023','Invalid approval identifier was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||'{"predecessorId":null}' FROM approval_probe WHERE key='validation'))$q$,'22023','Unpaired approval predecessor was accepted');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||'{"predecessorId":"f2000000-0000-4000-8000-000000000002"}' FROM approval_probe WHERE key='validation'))$q$,'22023','Self approval predecessor was accepted');
RESET ROLE;
-- Approval first, then correction: correction remains a draft and the original event is untouched.
INSERT INTO approval_probe SELECT 'correctionIntent',jsonb_build_object('operation','correct','requestId','e2000000-0000-4000-8000-000000000002',
 'actorId','13466ed2-dcb7-4861-a528-68cc5579eea9','workspaceId','d51d566d-28c6-49d2-95d2-3a7a2f0902e1','reviewId','e2000000-0000-4000-8000-000000000001',
 'expectedRevisionId','e2000000-0000-4000-8000-000000000001','expectedRevisionSha256',value->'revisionSha256','reason','SYNTHETIC reviewed correction',
 'change',jsonb_build_object('kind','notes','title','SYNTHETIC approval custody draft','notes','SYNTHETIC corrected review')) FROM approval_probe WHERE key='review1';
SET LOCAL ROLE service_role;
INSERT INTO approval_probe SELECT 'review2',retain_engagement_synthesis_review('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','13466ed2-dcb7-4861-a528-68cc5579eea9','d51d566d-28c6-49d2-95d2-3a7a2f0902e1',
 (SELECT value FROM approval_probe WHERE key='correctionIntent'),'d0000000-0000-4000-8000-000000000002',(SELECT value#>>'{}' FROM approval_probe WHERE key='sourceSha'),NULL,
 (SELECT (value||'{"notes":"SYNTHETIC corrected review"}')::text FROM approval_probe WHERE key='content'));
SELECT pg_temp.assert_true(pg_temp.approval()=(SELECT value||'{"replayed":true}' FROM approval_probe WHERE key='first'),'Old approval retry was blocked by a later correction');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value FROM approval_probe WHERE key='successor'))$q$,'PT409','Correction first allowed stale approval');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=1 AND bool_and(revision_id='e2000000-0000-4000-8000-000000000001') FROM engagement_synthesis_approval_events WHERE review_id='e2000000-0000-4000-8000-000000000001'),'Correction inherited approval');
SELECT pg_temp.assert_true((SELECT content_text::jsonb->>'status'='staff_draft' FROM engagement_synthesis_review_revisions WHERE id='e2000000-0000-4000-8000-000000000002'),'Correction changed draft status');
SET LOCAL ROLE authenticated;
SELECT pg_temp.assert_true(pg_temp.approval_read()=(SELECT value->'event' FROM approval_probe WHERE key='first'),'Approval read changed original bytes');
SELECT pg_temp.assert_true(pg_temp.approval_history('e2000000-0000-4000-8000-000000000100')->>'eventCount'='0','Another review inherited approval history');
RESET ROLE;
INSERT INTO approval_probe SELECT 'withdrawal',value||jsonb_build_object('operation','withdraw','reason',repeat('🚲',2000)) FROM approval_probe WHERE key='successor';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||jsonb_build_object('revisionId','e2000000-0000-4000-8000-000000000002','revisionNo',2,'revisionSha256',(SELECT value->>'revisionSha256' FROM approval_probe WHERE key='review2')) FROM approval_probe WHERE key='withdrawal'))$q$,'PT409','Withdrawal named the wrong approved revision');
INSERT INTO approval_probe SELECT 'withdrawn',pg_temp.approval((SELECT value FROM approval_probe WHERE key='withdrawal'));
SELECT pg_temp.assert_true(pg_temp.approval((SELECT value FROM approval_probe WHERE key='withdrawal'))=(SELECT value||'{"replayed":true}' FROM approval_probe WHERE key='withdrawn'),'Withdrawal retry changed retained bytes');
RESET ROLE;
INSERT INTO approval_probe SELECT 'renewed',value||jsonb_build_object('requestId','f2000000-0000-4000-8000-000000000003',
 'revisionId','e2000000-0000-4000-8000-000000000002','revisionNo',2,'revisionSha256',(SELECT value->>'revisionSha256' FROM approval_probe WHERE key='review2'),
 'predecessorId','f2000000-0000-4000-8000-000000000002','predecessorSha256',(SELECT value#>>'{event,eventSha256}' FROM approval_probe WHERE key='withdrawn')) FROM approval_probe WHERE key='intent';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||jsonb_build_object('requestId','f2000000-0000-4000-8000-000000000003','predecessorId','f2000000-0000-4000-8000-000000000002','predecessorSha256',(SELECT value#>>'{event,eventSha256}' FROM approval_probe WHERE key='withdrawn')) FROM approval_probe WHERE key='withdrawal'))$q$,'PT409','Already withdrawn approval was withdrawn again');
SELECT pg_temp.expect_error($q$SELECT pg_temp.approval((SELECT value||jsonb_build_object('revisionId','e2000000-0000-4000-8000-000000000001','revisionNo',1,'revisionSha256',(SELECT value->>'revisionSha256' FROM approval_probe WHERE key='review1')) FROM approval_probe WHERE key='renewed'))$q$,'PT409','A corrected review accepted approval of original');
INSERT INTO approval_probe SELECT 'third',pg_temp.approval((SELECT value FROM approval_probe WHERE key='renewed'));
RESET ROLE;
SET LOCAL ROLE authenticated;
INSERT INTO approval_probe SELECT 'history',pg_temp.approval_history();
SELECT pg_temp.assert_true((SELECT value->>'eventCount'='3' AND jsonb_array_length(value->'entries')=3
 AND value->>'headId'='f2000000-0000-4000-8000-000000000003' AND value->>'headSha256'=(SELECT value#>>'{event,eventSha256}' FROM approval_probe WHERE key='third')
 AND value->'entries'->0=(SELECT value->'event' FROM approval_probe WHERE key='first')
 AND value->'entries'->1=(SELECT value->'event' FROM approval_probe WHERE key='withdrawn')
 AND value->'entries'->2=(SELECT value->'event' FROM approval_probe WHERE key='third') FROM approval_probe WHERE key='history'),'Approval history lost exact count order or head');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_approval('250f0f62-7225-48b3-a2f7-5a134d3b9f78','f2000000-0000-4000-8000-000000000001')$q$,'42501','Foreign campaign read private approval');
SELECT pg_temp.expect_error($q$SELECT read_engagement_synthesis_approval_history('250f0f62-7225-48b3-a2f7-5a134d3b9f78','e2000000-0000-4000-8000-000000000001')$q$,'42501','Foreign campaign read private approval history');
RESET ROLE;
SELECT pg_temp.expect_error($q$UPDATE engagement_synthesis_approval_events SET event_text='{}' WHERE id='f2000000-0000-4000-8000-000000000001'$q$,'P0001','Approval event was mutable');
SELECT pg_temp.expect_error($q$DELETE FROM engagement_synthesis_approval_events WHERE id='f2000000-0000-4000-8000-000000000001'$q$,'P0001','Approval event was deletable');
SELECT pg_temp.expect_error($q$INSERT INTO engagement_synthesis_approval_events(id,review_id,revision_id,event_no,predecessor_id,predecessor_sha256,actor_id,operation,intent_json,event_text,created_at)
 SELECT 'f2000000-0000-4000-8000-000000000099',review_id,revision_id,4,id,repeat('0',64),actor_id,'withdraw',intent_json,event_text,created_at
 FROM engagement_synthesis_approval_events WHERE id='f2000000-0000-4000-8000-000000000003'$q$,'23503','Approval predecessor checksum constraint was bypassed');
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SET LOCAL ROLE service_role;
SELECT pg_temp.expect_error('SELECT pg_temp.approval()','42501','Revoked staff replayed approval');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error('SELECT pg_temp.approval_read()','42501','Viewer read private approval');
SELECT pg_temp.expect_error('SELECT pg_temp.approval_history()','42501','Viewer read private approval history');
SELECT set_config('request.jwt.claim.sub','14a71429-1cb2-49b5-8711-c696a2f394c3',true);
SELECT pg_temp.expect_error('SELECT pg_temp.approval_read()','42501','Another workspace read private approval');
SELECT pg_temp.expect_error('SELECT pg_temp.approval_history()','42501','Another workspace read private approval history');
SELECT pg_temp.assert_true(read_engagement_synthesis_approval('250f0f62-7225-48b3-a2f7-5a134d3b9f78','f2000000-0000-4000-8000-000000000001') IS NULL,'Own foreign campaign exposed another approval');
SELECT pg_temp.assert_true(read_engagement_synthesis_approval_history('250f0f62-7225-48b3-a2f7-5a134d3b9f78','e2000000-0000-4000-8000-000000000001') IS NULL,'Own foreign campaign exposed another approval history');
RESET ROLE;
UPDATE workspace_members SET role='owner' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
-- A retained subject deliberately remains in the claims while role is anon: lack of EXECUTE must still refuse it.
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error('SELECT pg_temp.approval_read()','42501','Anonymous approval read was allowed');
SELECT pg_temp.expect_error('SELECT pg_temp.approval_history()','42501','Anonymous approval history was allowed');
SELECT pg_temp.expect_error('SELECT pg_temp.approval()','42501','Anonymous approval write was allowed');
RESET ROLE;
SELECT pg_temp.assert_true((SELECT count(*)=3 FROM engagement_synthesis_approval_events WHERE review_id='e2000000-0000-4000-8000-000000000001'),'Approval refusals or retries added events');
SELECT jsonb_build_object('history',(SELECT value FROM approval_probe WHERE key='history'),
 'first',(SELECT value FROM approval_probe WHERE key='first'),'intent',(SELECT value FROM approval_probe WHERE key='intent'),
 'original',(SELECT value-'requestId'-'actorId'-'operation'-'reason'-'predecessorId'-'predecessorSha256' FROM approval_probe WHERE key='intent'),
 'current',(SELECT jsonb_build_object('campaignId',r.campaign_id,'workspaceId',r.workspace_id,'reviewId',r.id,'sourceId',r.source_id,
   'sourceSha256',r.source_sha256,'preparationSha256',r.preparation_sha256,'revisionId',v.id,'revisionSha256',v.content_sha256,'revisionNo',v.revision_no)
   FROM engagement_synthesis_reviews r JOIN engagement_synthesis_review_revisions v ON v.review_id=r.id
   WHERE v.id='e2000000-0000-4000-8000-000000000002'));
SELECT 'synthesis-approval-custody-verified';
