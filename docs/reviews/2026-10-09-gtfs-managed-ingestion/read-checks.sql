DO $proof$
DECLARE workspace uuid:=gen_random_uuid(); other_workspace uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid();
 viewer uuid:=gen_random_uuid(); revoked uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 source_feed uuid; queued uuid; awaiting uuid; running uuid; expired uuid; finished uuid; failed uuid; cancelled uuid; inaccessible uuid;
 receipt jsonb; snapshot jsonb; original jsonb; source jsonb; versions uuid[]; claim_token uuid; replacement uuid:=gen_random_uuid();
 expired_token uuid:=gen_random_uuid(); revoked_token uuid:=gen_random_uuid(); completed_token uuid; before_rows jsonb; after_rows jsonb;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.invalid'),(viewer,viewer||'@example.invalid'),
  (revoked,revoked||'@example.invalid'),(outsider,outsider||'@example.invalid');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic read scope','gtfs-read-'||workspace),
  (other_workspace,'Synthetic other read scope','gtfs-read-'||other_workspace);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,viewer,'viewer'),
  (workspace,revoked,'member'),(other_workspace,actor,'owner');
 source:='{"kind":"url","provisionalName":"Synthetic read source","sourceUrl":"https://example.invalid/feed.zip","normalizedSourceUrl":"https://example.invalid/feed.zip"}';
 SET LOCAL ROLE service_role;
 receipt:=public.admit_gtfs_ingest(gen_random_uuid(),workspace,actor,source_feed,source); queued:=(receipt->>'versionId')::uuid; source_feed:=(receipt->>'feedId')::uuid;
 receipt:=public.admit_gtfs_ingest(gen_random_uuid(),workspace,actor,NULL,
  jsonb_build_object('kind','upload','provisionalName','Synthetic awaiting bytes','uploadSha256',repeat('e',64),'uploadBytes',99));
 awaiting:=(receipt->>'versionId')::uuid;
 receipt:=pg_temp.ready_gtfs(workspace,actor,NULL,2,2,false); running:=(receipt->>'versionId')::uuid; claim_token:=(receipt->>'token')::uuid;
 receipt:=public.admit_gtfs_ingest(gen_random_uuid(),workspace,actor,source_feed,source); expired:=(receipt->>'versionId')::uuid;
 PERFORM public.claim_gtfs_ingest(expired,expired_token);
 receipt:=pg_temp.ready_gtfs(workspace,actor,NULL,2,2); finished:=(receipt->>'versionId')::uuid;
 receipt:=public.admit_gtfs_ingest(gen_random_uuid(),workspace,actor,source_feed,source); failed:=(receipt->>'versionId')::uuid;
 receipt:=public.claim_gtfs_ingest(failed,replacement);
 PERFORM public.fail_gtfs_ingest(failed,replacement,gen_random_uuid(),'fetch_failed','Synthetic fetch failure');
 replacement:=gen_random_uuid();
 receipt:=public.admit_gtfs_ingest(gen_random_uuid(),workspace,actor,source_feed,source); cancelled:=(receipt->>'versionId')::uuid;
 PERFORM public.cancel_gtfs_ingest(workspace,cancelled,gen_random_uuid(),actor,'Synthetic read cancellation');
 receipt:=public.admit_gtfs_ingest(gen_random_uuid(),workspace,revoked,source_feed,source); inaccessible:=(receipt->>'versionId')::uuid;
 PERFORM public.claim_gtfs_ingest(inaccessible,revoked_token);
 RESET ROLE;
 UPDATE openplan_gtfs.executions SET lease_until=clock_timestamp()-interval '1 second' WHERE version_id IN (expired,inaccessible);
 UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=revoked;
 SELECT token INTO completed_token FROM openplan_gtfs.claims WHERE version_id=finished;
 SELECT jsonb_agg(to_jsonb(j) ORDER BY version_id) INTO before_rows FROM openplan_gtfs.executions j;
 SET LOCAL ROLE service_role;
 SELECT array_agg(version_id) INTO versions FROM public.list_gtfs_ingest_candidates(100);
 IF versions IS DISTINCT FROM ARRAY[queued,expired] THEN RAISE EXCEPTION 'queue selected ineligible or out-of-order work'; END IF;
 SELECT array_agg(version_id) INTO versions FROM public.list_gtfs_ingest_candidates(1);
 IF versions IS DISTINCT FROM ARRAY[queued] THEN RAISE EXCEPTION 'queue bound ignored'; END IF;
 FOR i IN 0..2 LOOP
  BEGIN
   PERFORM public.list_gtfs_ingest_candidates(CASE i WHEN 0 THEN 0 WHEN 1 THEN 101 ELSE NULL END);
   RAISE EXCEPTION 'invalid queue bound accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 END LOOP;
 RESET ROLE;
 FOR i IN 1..3 LOOP
  BEGIN
   INSERT INTO openplan_gtfs.write_context VALUES(txid_current(),expired,'version','UPDATE',expired_token);
   IF i=1 THEN UPDATE public.gtfs_feed_versions SET status='failed',failure_code='abandoned' WHERE id=expired;
   ELSIF i=2 THEN UPDATE public.gtfs_feed_versions SET ingest_closed_at=clock_timestamp() WHERE id=expired;
   ELSE UPDATE public.gtfs_feed_versions SET ingest_abandoned_at=clock_timestamp() WHERE id=expired; END IF;
   DELETE FROM openplan_gtfs.write_context;
   SET LOCAL ROLE service_role;
   IF EXISTS(SELECT 1 FROM public.list_gtfs_ingest_candidates(100) WHERE version_id=expired) THEN
    RAISE EXCEPTION 'queue selected publicly closed work'; END IF;
   RAISE EXCEPTION 'restore synthetic inconsistent fixture' USING ERRCODE='PZ001';
  EXCEPTION WHEN SQLSTATE 'PZ001' THEN NULL; END;
 END LOOP;
 SET LOCAL ROLE service_role;
 original:=public.read_gtfs_ingest_attempt(running,claim_token);
 IF original->>'active' IS DISTINCT FROM 'true' OR original->>'prepared' IS DISTINCT FROM 'true'
  OR original->>'stage' IS DISTINCT FROM 'parsing' OR original->>'archiveConfirmed' IS DISTINCT FROM 'true'
  OR original->'claim'->>'token' IS DISTINCT FROM claim_token::text OR original->'plan'->>'routeRows' IS DISTINCT FROM '2' THEN
  RAISE EXCEPTION 'active attempt snapshot incorrect'; END IF;
 IF public.read_gtfs_ingest_attempt(running,claim_token) IS DISTINCT FROM original THEN RAISE EXCEPTION 'attempt read changed snapshot'; END IF;
 BEGIN
  PERFORM public.read_gtfs_ingest_attempt(running,expired_token);
  RAISE EXCEPTION 'foreign claim read attempt';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.read_gtfs_ingest_attempt(inaccessible,revoked_token);
  RAISE EXCEPTION 'revoked submitter read attempt';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.read_gtfs_ingest_attempt(gen_random_uuid(),claim_token);
  RAISE EXCEPTION 'missing attempt read succeeded';
 EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'GTFS attempt is unavailable' THEN RAISE; END IF;
 END;
 snapshot:=public.read_gtfs_ingest_attempt(finished,completed_token);
 IF snapshot->>'active' IS DISTINCT FROM 'false' OR snapshot->>'state' IS DISTINCT FROM 'ready'
  OR snapshot->'completion'->>'status' IS DISTINCT FROM 'ready' THEN RAISE EXCEPTION 'completed attempt read incorrect'; END IF;
 snapshot:=public.read_gtfs_ingest_status(workspace,running,viewer);
 IF snapshot->>'state' IS DISTINCT FROM 'running' OR snapshot->>'workspaceId' IS DISTINCT FROM workspace::text
  OR snapshot->>'archiveConfirmed' IS DISTINCT FROM 'true' OR snapshot->>'submitterAccessUnavailable' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'member status snapshot incorrect'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(snapshot) field WHERE field NOT IN
  ('schemaVersion','requestId','versionId','feedId','workspaceId','state','stage','attempts','leaseUntil',
   'archiveConfirmed','submittedAt','isCurrent','failureCode','failureDetail','submitterAccessUnavailable'))
  OR position(claim_token::text IN snapshot::text)>0 THEN RAISE EXCEPTION 'member status exposed worker secrets'; END IF;
 snapshot:=public.read_gtfs_ingest_status(workspace,inaccessible,viewer);
 IF snapshot->>'submitterAccessUnavailable' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'revoked submitter hidden in member status'; END IF;
 snapshot:=public.read_gtfs_ingest_status(workspace,cancelled,viewer);
 IF snapshot->>'state' IS DISTINCT FROM 'cancelled' OR snapshot->>'stage' IS DISTINCT FROM 'failed'
  OR snapshot->>'failureCode' IS DISTINCT FROM 'abandoned' OR snapshot->>'failureDetail' IS DISTINCT FROM 'Synthetic read cancellation' THEN
  RAISE EXCEPTION 'member cancellation status incorrect'; END IF;
 BEGIN
  PERFORM public.read_gtfs_ingest_status(other_workspace,running,actor);
  RAISE EXCEPTION 'foreign workspace read status';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.read_gtfs_ingest_status(workspace,running,outsider);
  RAISE EXCEPTION 'nonmember read status';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 FOR i IN 1..2 LOOP
  PERFORM set_config('role',CASE i WHEN 1 THEN 'anon' ELSE 'authenticated' END,true);
  BEGIN
   PERFORM public.list_gtfs_ingest_candidates(1);
   RAISE EXCEPTION 'client called queue';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
   PERFORM public.read_gtfs_ingest_attempt(running,claim_token);
   RAISE EXCEPTION 'client called attempt read';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
   PERFORM public.read_gtfs_ingest_status(workspace,running,viewer);
   RAISE EXCEPTION 'client called status read';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 END LOOP;
 RESET ROLE;
 SELECT jsonb_agg(to_jsonb(j) ORDER BY version_id) INTO after_rows FROM openplan_gtfs.executions j;
 IF after_rows IS DISTINCT FROM before_rows THEN RAISE EXCEPTION 'read commands changed execution state'; END IF;
 UPDATE openplan_gtfs.executions SET lease_until=clock_timestamp()-interval '1 second' WHERE version_id=running;
 SET LOCAL ROLE service_role;
 PERFORM public.claim_gtfs_ingest(running,replacement);
 snapshot:=public.read_gtfs_ingest_attempt(running,claim_token);
 IF snapshot->>'active' IS DISTINCT FROM 'false' OR snapshot->>'prepared' IS DISTINCT FROM 'false'
  OR snapshot->>'attempts' IS DISTINCT FROM '2' OR snapshot->'claim'->>'attempt' IS DISTINCT FROM '1'
  OR snapshot->'claim'->>'token' IS DISTINCT FROM claim_token::text
  OR position(replacement::text IN snapshot::text)>0
  OR snapshot->'plan' IS DISTINCT FROM original->'plan' THEN RAISE EXCEPTION 'old attempt snapshot exposed replacement or lost history'; END IF;
 snapshot:=public.read_gtfs_ingest_attempt(running,replacement);
 IF snapshot->>'active' IS DISTINCT FROM 'true' OR snapshot->>'prepared' IS DISTINCT FROM 'false'
  OR snapshot->'plan' IS DISTINCT FROM 'null'::jsonb THEN RAISE EXCEPTION 'replacement borrowed old preparation'; END IF;
 RESET ROLE;
 DELETE FROM public.workspaces WHERE id IN (workspace,other_workspace);
END $proof$;
