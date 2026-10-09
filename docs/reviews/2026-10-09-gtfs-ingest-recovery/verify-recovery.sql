\set ON_ERROR_STOP on
BEGIN;
INSERT INTO workspaces(id,name,slug) VALUES('11111111-1111-4111-8111-111111111111','Synthetic GTFS recovery','synthetic-gtfs-recovery');
INSERT INTO gtfs_feeds(id,workspace_id,agency_name) VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Synthetic recovery feed');
INSERT INTO gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status,updated_at) VALUES('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','upload','parsing',now()-interval '20 minutes');
CREATE TEMP TABLE scanned AS SELECT id FROM gtfs_feed_versions WHERE status IN ('pending','fetching','parsing') AND updated_at<now()-interval '15 minutes';
-- Deterministic interleaving: ingest completes after the sweep selects its row.
INSERT INTO gtfs_route_service_levels(workspace_id,feed_version_id,route_id,route_type,service_day,trips_per_day,derivation_method) VALUES('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','R',3,'monday',1,'scheduled');
INSERT INTO gtfs_stop_service_levels(workspace_id,feed_version_id,stop_id,stop_name,latitude,longitude,service_day,trips_per_day,derivation_method) VALUES('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','S','Synthetic stop',44,-104,'monday',1,'scheduled');
UPDATE gtfs_feed_versions SET status='ready',route_count=1,stop_count=1,route_service_level_rows=1,stop_service_level_rows=1 WHERE id='33333333-3333-4333-8333-333333333333';
SELECT promote_gtfs_feed_version('33333333-3333-4333-8333-333333333333');
DO $proof$
BEGIN
 IF reap_gtfs_feed_version('33333333-3333-4333-8333-333333333333',now()-interval '15 minutes') THEN
 RAISE EXCEPTION 'completed version was reaped'; END IF;
 IF (SELECT count(*) FROM gtfs_route_service_levels WHERE feed_version_id='33333333-3333-4333-8333-333333333333')<>1 THEN
 RAISE EXCEPTION 'completed route rows changed'; END IF;
END $proof$;
INSERT INTO gtfs_feed_versions(id,workspace_id,feed_id,source_kind,status,updated_at)
VALUES('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','upload','parsing',now()-interval '20 minutes');
DO $proof$
BEGIN
 IF NOT reap_gtfs_feed_version('44444444-4444-4444-8444-444444444444',now()-interval '15 minutes') THEN
 RAISE EXCEPTION 'stale version not reaped'; END IF;
 IF reap_gtfs_feed_version('44444444-4444-4444-8444-444444444444',now()-interval '15 minutes') THEN
 RAISE EXCEPTION 'repeat cleanup claimed success'; END IF;
 BEGIN
 UPDATE gtfs_feed_versions SET status='parsing' WHERE id='44444444-4444-4444-8444-444444444444';
 RAISE EXCEPTION 'late stage write accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 BEGIN
 INSERT INTO gtfs_route_service_levels(workspace_id,feed_version_id,route_id,route_type,service_day,trips_per_day,derivation_method)
 VALUES('11111111-1111-4111-8111-111111111111','44444444-4444-4444-8444-444444444444','late',3,'monday',1,'scheduled');
 RAISE EXCEPTION 'late derived write accepted';
 EXCEPTION WHEN SQLSTATE '55000' THEN NULL; END;
 IF (SELECT status FROM gtfs_feeds WHERE id='22222222-2222-4222-8222-222222222222')<>'ready' THEN
 RAISE EXCEPTION 'working feed status changed'; END IF;
END $proof$;
ROLLBACK;
