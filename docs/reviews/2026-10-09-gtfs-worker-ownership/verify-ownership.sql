DO $proof$
DECLARE workspace uuid:=gen_random_uuid(); feed uuid:=gen_random_uuid(); version uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
 first_token uuid:=gen_random_uuid(); replacement uuid:=gen_random_uuid(); receipt jsonb; replay jsonb; result jsonb;
BEGIN
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic GTFS ownership','proof-'||workspace);
 INSERT INTO public.gtfs_feeds(id,workspace_id,agency_name) VALUES(feed,workspace,'Synthetic ownership');
 INSERT INTO public.gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status) VALUES(version,workspace,feed,'upload','pending'),(other,workspace,feed,'upload','pending');
 INSERT INTO gtfs_execution_probe(version_id) VALUES(version),(other);
 receipt:=ownership_probe.claim_gtfs_probe(version,first_token);
 IF receipt->>'active' IS DISTINCT FROM 'true' OR receipt->'claim'->>'attempt' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'first claim incorrect'; END IF;
 replay:=ownership_probe.claim_gtfs_probe(version,first_token);
 IF replay IS DISTINCT FROM receipt OR (SELECT count(*) FROM gtfs_claim_probe)<>1 THEN RAISE EXCEPTION 'lost reply retry created another claim'; END IF;
 IF ownership_probe.claim_gtfs_probe(version,replacement) IS NOT NULL THEN RAISE EXCEPTION 'live attempt replaced'; END IF;
 BEGIN
  PERFORM ownership_probe.claim_gtfs_probe(other,first_token);
  RAISE EXCEPTION 'token rebound to another version';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'claim token already belongs to another version' THEN RAISE; END IF;
 END;
 IF ownership_probe.renew_gtfs_probe(version,first_token) IS NOT TRUE THEN RAISE EXCEPTION 'active renewal failed'; END IF;
 PERFORM ownership_probe.write_gtfs_probe(version,first_token,'first');
 -- Fixture clock advancement affects only the prototype lease, not production records.
 UPDATE gtfs_execution_probe SET lease_until=clock_timestamp()-interval '1 second' WHERE version_id=version;
 result:=ownership_probe.claim_gtfs_probe(version,first_token);
 IF result->>'active' IS DISTINCT FROM 'false' OR result->'claim' IS DISTINCT FROM receipt->'claim' THEN RAISE EXCEPTION 'expired claim revived'; END IF;
 IF ownership_probe.renew_gtfs_probe(version,first_token) IS NOT FALSE THEN RAISE EXCEPTION 'expired renewal revived owner'; END IF;
 BEGIN
  PERFORM ownership_probe.write_gtfs_probe(version,first_token,'expired');
  RAISE EXCEPTION 'expired owner wrote';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 result:=ownership_probe.claim_gtfs_probe(version,replacement);
 IF result->>'active' IS DISTINCT FROM 'true' OR result->'claim'->>'attempt' IS DISTINCT FROM '2' THEN RAISE EXCEPTION 'replacement claim incorrect'; END IF;
 IF ownership_probe.renew_gtfs_probe(version,first_token) IS NOT FALSE THEN RAISE EXCEPTION 'old token renewed new attempt'; END IF;
 BEGIN
  PERFORM ownership_probe.write_gtfs_probe(version,first_token,'stale');
  RAISE EXCEPTION 'old token wrote after replacement';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 PERFORM ownership_probe.write_gtfs_probe(version,replacement,'replacement');
 IF (SELECT count(*) FROM gtfs_write_probe)<>2 THEN RAISE EXCEPTION 'unexpected write count'; END IF;
 IF (SELECT count(*) FROM gtfs_claim_probe)<>2 THEN RAISE EXCEPTION 'unexpected claim count'; END IF;
 UPDATE public.gtfs_feed_versions SET status='failed',failure_code='partial_write' WHERE id=version;
 IF ownership_probe.renew_gtfs_probe(version,replacement) IS NOT FALSE THEN RAISE EXCEPTION 'terminal version renewed'; END IF;
 BEGIN
  PERFORM ownership_probe.write_gtfs_probe(version,replacement,'terminal');
  RAISE EXCEPTION 'terminal version accepted output';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
END $proof$;
