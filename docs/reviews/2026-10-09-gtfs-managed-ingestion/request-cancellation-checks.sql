DO $proof$
DECLARE workspace uuid:=gen_random_uuid(); other_workspace uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); delegate uuid:=gen_random_uuid(); viewer uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
 request uuid:=gen_random_uuid(); command uuid:=gen_random_uuid(); queued_request uuid:=gen_random_uuid(); active_request uuid:=gen_random_uuid(); terminal_request uuid;
 admitted jsonb; cancelled jsonb; original jsonb; receipt jsonb; version uuid; feed uuid; token uuid:=gen_random_uuid();
 source jsonb:='{"kind":"url","provisionalName":"Synthetic request cancellation","sourceUrl":"https://example.invalid/request.zip","normalizedSourceUrl":"https://example.invalid/request.zip"}';
BEGIN
 INSERT INTO auth.users(id,email) VALUES(actor,actor||'@example.invalid'),(delegate,delegate||'@example.invalid'),(viewer,viewer||'@example.invalid'),(outsider,outsider||'@example.invalid');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic cancellation','cancel-'||workspace),(other_workspace,'Synthetic other cancellation','cancel-'||other_workspace);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,actor,'owner'),(workspace,delegate,'owner'),(workspace,viewer,'viewer'),(other_workspace,actor,'owner');
 SET LOCAL ROLE service_role;
 BEGIN PERFORM public.cancel_gtfs_submission(workspace,request,viewer,command,'Planner cancelled'); RAISE EXCEPTION 'viewer cancelled request'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.cancel_gtfs_submission(workspace,request,actor,command,' '); RAISE EXCEPTION 'empty cancellation reason accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 cancelled:=public.cancel_gtfs_submission(workspace,request,actor,command,'Planner cancelled');
 IF cancelled->>'requestId' IS DISTINCT FROM request::text OR cancelled->>'workspaceId' IS DISTINCT FROM workspace::text
  OR cancelled->>'state' IS DISTINCT FROM 'cancelled' OR cancelled->>'versionId' IS NOT NULL OR cancelled->>'versionCancellation' IS NOT NULL
  OR cancelled->>'cancelledAt' IS NULL THEN RAISE EXCEPTION 'early cancellation invented a version or lost scope'; END IF;
 IF public.cancel_gtfs_submission(workspace,request,actor,command,'Planner cancelled') IS DISTINCT FROM cancelled THEN RAISE EXCEPTION 'request cancellation receipt changed'; END IF;
 BEGIN PERFORM public.cancel_gtfs_submission(workspace,request,actor,command,'Changed reason'); RAISE EXCEPTION 'changed reason replay accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN PERFORM public.cancel_gtfs_submission(workspace,gen_random_uuid(),actor,command,'Planner cancelled'); RAISE EXCEPTION 'changed request replay accepted'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN PERFORM public.cancel_gtfs_submission(workspace,request,actor,gen_random_uuid(),'Planner cancelled'); RAISE EXCEPTION 'second cancellation command replaced identity'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN PERFORM public.admit_gtfs_ingest(request,workspace,actor,NULL,source); RAISE EXCEPTION 'late admission created cancelled request'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 IF public.read_gtfs_submission_cancellation(workspace,request,viewer) IS DISTINCT FROM cancelled THEN RAISE EXCEPTION 'viewer cannot read cancellation'; END IF;
 IF public.read_gtfs_submission_cancellation(other_workspace,request,actor) IS NOT NULL THEN RAISE EXCEPTION 'foreign cancellation disclosed'; END IF;
 IF public.read_gtfs_submission_cancellation(workspace,gen_random_uuid(),actor) IS NOT NULL THEN RAISE EXCEPTION 'missing cancellation invented'; END IF;
 BEGIN PERFORM public.read_gtfs_submission_cancellation(workspace,request,outsider); RAISE EXCEPTION 'outsider read cancellation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 admitted:=public.admit_gtfs_ingest(queued_request,workspace,actor,NULL,source); version:=(admitted->>'versionId')::uuid; feed:=(admitted->>'feedId')::uuid;
 BEGIN PERFORM public.cancel_gtfs_submission(other_workspace,queued_request,actor,gen_random_uuid(),'Planner cancelled'); RAISE EXCEPTION 'foreign request cancelled'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 receipt:=public.cancel_gtfs_submission(workspace,queued_request,actor,gen_random_uuid(),'Planner cancelled');
 IF receipt->>'versionId' IS DISTINCT FROM version::text OR receipt->'versionCancellation'->>'state' IS DISTINCT FROM 'cancelled'
  OR (public.read_gtfs_ingest_status(workspace,version,viewer))->>'state' IS DISTINCT FROM 'cancelled' THEN RAISE EXCEPTION 'unfinished request was not closed'; END IF;
 BEGIN PERFORM public.admit_gtfs_ingest(queued_request,workspace,actor,NULL,source); RAISE EXCEPTION 'cancelled committed request replay admitted'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 admitted:=public.admit_gtfs_ingest(active_request,workspace,actor,feed,source); version:=(admitted->>'versionId')::uuid;
 PERFORM public.claim_gtfs_ingest(version,token);
 PERFORM public.stage_gtfs_ingest(version,token,'fetching');
 receipt:=public.cancel_gtfs_submission(workspace,active_request,actor,gen_random_uuid(),'Planner cancelled');
 BEGIN PERFORM public.stage_gtfs_ingest(version,token,'parsing'); RAISE EXCEPTION 'cancelled attempt retained ownership'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 admitted:=pg_temp.ready_gtfs(workspace,actor,NULL,2,2); version:=(admitted->>'versionId')::uuid; terminal_request:=(admitted->>'requestId')::uuid;
 BEGIN PERFORM public.cancel_gtfs_submission(workspace,terminal_request,actor,gen_random_uuid(),'Planner cancelled'); RAISE EXCEPTION 'ready processing renamed cancelled'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 original:=public.read_gtfs_submission_cancellation(workspace,queued_request,actor);
 RESET ROLE; DELETE FROM public.gtfs_feeds WHERE id=feed;
 SET LOCAL ROLE service_role;
 IF public.read_gtfs_submission_cancellation(workspace,queued_request,actor) IS DISTINCT FROM original THEN RAISE EXCEPTION 'deleted feed erased cancellation'; END IF;
 BEGIN PERFORM public.admit_gtfs_ingest(queued_request,workspace,actor,NULL,source); RAISE EXCEPTION 'deleted feed recreated cancelled request'; EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 RESET ROLE; UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
 SET LOCAL ROLE service_role;
 BEGIN PERFORM public.cancel_gtfs_submission(workspace,request,actor,command,'Planner cancelled'); RAISE EXCEPTION 'revoked actor recovered cancellation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE; UPDATE public.workspace_members SET role='owner' WHERE workspace_id=workspace AND user_id=actor;
 SET LOCAL ROLE service_role;
 BEGIN PERFORM openplan_gtfs.admit_gtfs_ingest(gen_random_uuid(),workspace,actor,NULL,source); RAISE EXCEPTION 'service bypassed cancellation wrapper'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SET LOCAL ROLE authenticated;
 BEGIN PERFORM public.cancel_gtfs_submission(workspace,gen_random_uuid(),actor,gen_random_uuid(),'Planner cancelled'); RAISE EXCEPTION 'authenticated client cancelled request'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.read_gtfs_submission_cancellation(workspace,request,viewer); RAISE EXCEPTION 'authenticated client read cancellation'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 RESET ROLE;
 IF EXISTS(SELECT 1 FROM openplan_gtfs.write_context) THEN RAISE EXCEPTION 'request cancellation context leaked'; END IF;
END $proof$;
