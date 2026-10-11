DO $proof$
DECLARE workspace uuid:=gen_random_uuid(); foreign_workspace uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 feed uuid; first_version uuid; next_version uuid; unfinished uuid; command uuid:=gen_random_uuid(); small_command uuid:=gen_random_uuid();
 receipt jsonb; review jsonb; original jsonb; stale jsonb; small_review jsonb;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.invalid'),(viewer,viewer||'@example.invalid'),(outsider,outsider||'@example.invalid');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic human review','human-'||workspace),(foreign_workspace,'Synthetic other review','human-'||foreign_workspace);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,viewer,'viewer'),(foreign_workspace,actor,'owner');
 SET LOCAL ROLE service_role;
 receipt:=pg_temp.ready_gtfs(workspace,actor,NULL,10,10); first_version:=(receipt->>'versionId')::uuid; feed:=(receipt->>'feedId')::uuid;
 review:=public.read_gtfs_adoption_review(workspace,first_version,viewer);
 IF review->'basis'->>'versionId' IS DISTINCT FROM first_version::text OR review->'basis'->>'previousVersionId' IS NOT NULL OR review->>'materialShrinkage' IS DISTINCT FROM 'false' OR review->>'isCurrent' IS DISTINCT FROM 'false' THEN
  RAISE EXCEPTION 'completed review differs or invents adoption'; END IF;
 IF (SELECT current_version_id FROM public.gtfs_feeds WHERE id=feed) IS NOT NULL THEN RAISE EXCEPTION 'review adopted a feed'; END IF;
 BEGIN PERFORM public.read_gtfs_adoption_review(workspace,first_version,outsider); RAISE EXCEPTION 'nonmember read review'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.read_gtfs_adoption_review(foreign_workspace,first_version,actor); RAISE EXCEPTION 'foreign workspace read review'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.adopt_reviewed_gtfs_ingest(workspace,first_version,gen_random_uuid(),viewer,review->'basis',false); RAISE EXCEPTION 'viewer adopted reviewed feed'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.adopt_reviewed_gtfs_ingest(workspace,first_version,gen_random_uuid(),actor,jsonb_set(review->'basis','{routeCount}','11'),false); RAISE EXCEPTION 'changed reviewed counts accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 original:=public.adopt_reviewed_gtfs_ingest(workspace,first_version,command,actor,review->'basis',false);
 IF original->>'adopted' IS DISTINCT FROM 'true' OR original->>'humanAcceptShrinkage' IS DISTINCT FROM 'false' OR original->'basis' IS DISTINCT FROM review->'basis' THEN RAISE EXCEPTION 'reviewed adoption result differs'; END IF;
 IF public.adopt_reviewed_gtfs_ingest(workspace,first_version,command,actor,review->'basis',false) IS DISTINCT FROM original THEN RAISE EXCEPTION 'reviewed adoption replay changed'; END IF;
 BEGIN PERFORM public.adopt_reviewed_gtfs_ingest(workspace,first_version,command,actor,review->'basis',true); RAISE EXCEPTION 'changed human acceptance replay accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN PERFORM public.adopt_reviewed_gtfs_ingest(workspace,first_version,command,actor,jsonb_set(review->'basis','{stopCount}','11'),false); RAISE EXCEPTION 'changed human basis replay accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 receipt:=pg_temp.ready_gtfs(workspace,actor,feed,6,7); next_version:=(receipt->>'versionId')::uuid;
 small_review:=public.read_gtfs_adoption_review(workspace,next_version,viewer);
 IF small_review->>'materialShrinkage' IS DISTINCT FROM 'true' OR small_review->'basis'->>'previousVersionId' IS DISTINCT FROM first_version::text THEN RAISE EXCEPTION 'material review concealed shrinkage'; END IF;
 BEGIN PERFORM public.adopt_reviewed_gtfs_ingest(workspace,next_version,small_command,actor,small_review->'basis',false); RAISE EXCEPTION 'unaccepted shrinkage adopted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 receipt:=public.adopt_reviewed_gtfs_ingest(workspace,next_version,small_command,actor,small_review->'basis',true);
 IF receipt->>'adopted' IS DISTINCT FROM 'true' OR receipt->>'humanAcceptShrinkage' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'accepted shrinkage was not adopted'; END IF;
 IF public.adopt_reviewed_gtfs_ingest(workspace,first_version,command,actor,review->'basis',false) IS DISTINCT FROM original OR (SELECT current_version_id FROM public.gtfs_feeds WHERE id=feed) IS DISTINCT FROM next_version THEN RAISE EXCEPTION 'historical review replay reapplied adoption'; END IF;
 stale:=review->'basis';
 BEGIN PERFORM public.adopt_reviewed_gtfs_ingest(workspace,first_version,gen_random_uuid(),actor,stale,false); RAISE EXCEPTION 'stale human predecessor accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 receipt:=public.admit_gtfs_ingest(gen_random_uuid(),workspace,actor,feed,'{"kind":"url","provisionalName":"Synthetic unfinished review","sourceUrl":"https://example.invalid/unfinished.zip","normalizedSourceUrl":"https://example.invalid/unfinished.zip"}'); unfinished:=(receipt->>'versionId')::uuid;
 BEGIN PERFORM public.read_gtfs_adoption_review(workspace,unfinished,actor); RAISE EXCEPTION 'unfinished version reviewed as ready'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 -- The fixture's original completed rows are removed only inside this rollback
 -- transaction to distinguish the completion guard from its ready-stage guard.
 RESET ROLE; DELETE FROM openplan_gtfs.completion_receipts WHERE version_id=first_version;
 SET LOCAL ROLE service_role;
 BEGIN PERFORM public.read_gtfs_adoption_review(workspace,first_version,actor); RAISE EXCEPTION 'missing completion reviewed'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 small_review:=public.read_gtfs_adoption_review(workspace,next_version,actor);
 SET LOCAL ROLE authenticated;
 BEGIN PERFORM public.read_gtfs_adoption_review(workspace,next_version,actor); RAISE EXCEPTION 'authenticated client invoked review'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.adopt_reviewed_gtfs_ingest(workspace,next_version,gen_random_uuid(),actor,small_review->'basis',true); RAISE EXCEPTION 'authenticated client invoked adoption'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 IF EXISTS(SELECT 1 FROM openplan_gtfs.write_context) THEN RAISE EXCEPTION 'human adoption context leaked'; END IF;
END $proof$;
