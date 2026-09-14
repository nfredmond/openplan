-- Extends the rolled-back source-custody fixture; no lasting application fixtures.
SELECT set_config('request.jwt.claim.sub','13466ed2-dcb7-4861-a528-68cc5579eea9',true);
SET LOCAL ROLE authenticated;
-- All captures share transaction_timestamp(); UUID breaks the ordering tie.
SELECT pg_temp.capture(('e0000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid) FROM generate_series(1,26) n;
INSERT INTO synthesis_probe SELECT 'list1',public.list_engagement_synthesis_sources('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f');
SELECT pg_temp.assert_true((SELECT jsonb_array_length(value->'entries')=25 AND jsonb_typeof(value->'nextCursor')='object' FROM synthesis_probe WHERE key='list1'),'Source list page size or continuation was lost');
INSERT INTO synthesis_probe SELECT 'list2',public.list_engagement_synthesis_sources('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f',value->'nextCursor') FROM synthesis_probe WHERE key='list1';
SELECT pg_temp.assert_true((SELECT jsonb_array_length(value->'entries')=6 AND value->'nextCursor'='null'::jsonb FROM synthesis_probe WHERE key='list2'),'Source list lost the second page');
SELECT pg_temp.assert_true((SELECT count(*)=31 AND count(DISTINCT entry->>'requestId')=31 FROM synthesis_probe CROSS JOIN LATERAL jsonb_array_elements(value->'entries') entry WHERE key IN ('list1','list2')),'Source list duplicated or omitted captures');
SELECT pg_temp.assert_true((SELECT bool_and(entry->>'campaignId'='10c5cdd7-16c6-4b91-b9c0-d2f67598a54f' AND entry->>'workspaceId'='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND NOT entry ?| ARRAY['snapshotText','snapshot_text','items','answers']) FROM synthesis_probe CROSS JOIN LATERAL jsonb_array_elements(value->'entries') entry WHERE key IN ('list1','list2')),'Source list leaked text or returned another scope');
SELECT pg_temp.assert_true((SELECT value->'nextCursor'->>'id'=value->'entries'->24->>'requestId' AND value->'nextCursor'->>'createdAt'=value->'entries'->24->>'createdAt' FROM synthesis_probe WHERE key='list1'),'Source list cursor differs from the last visible entry');
SELECT pg_temp.expect_error($q$SELECT public.list_engagement_synthesis_sources('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f','{"id":"e0000000-0000-4000-8000-000000000026","createdAt":"now"}')$q$,'22023','Source list accepted a relative cursor');
SELECT pg_temp.expect_error($q$SELECT public.list_engagement_synthesis_sources('250f0f62-7225-48b3-a2f7-5a134d3b9f78')$q$,'42501','Source list allowed another workspace');
RESET ROLE;
UPDATE workspace_members SET role='viewer' WHERE workspace_id='d51d566d-28c6-49d2-95d2-3a7a2f0902e1' AND user_id='13466ed2-dcb7-4861-a528-68cc5579eea9';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT public.list_engagement_synthesis_sources('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f')$q$,'42501','Source list allowed revoked staff');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($q$SELECT public.list_engagement_synthesis_sources('10c5cdd7-16c6-4b91-b9c0-d2f67598a54f')$q$,'42501','Anonymous source list was allowed');
RESET ROLE;
SELECT 'synthesis-source-list-verified';
