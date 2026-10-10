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
-- Existing failGtfsFeedVersion sequence resumes with the retained scan ID.
DELETE FROM gtfs_route_service_levels WHERE feed_version_id IN(SELECT id FROM scanned);
DELETE FROM gtfs_stop_service_levels WHERE feed_version_id IN(SELECT id FROM scanned);
UPDATE gtfs_feed_versions SET status='failed',failure_code='abandoned',failure_detail='Synthetic race proof',route_service_level_rows=0,stop_service_level_rows=0,last_checked_at=now() WHERE id IN(SELECT id FROM scanned);
SELECT jsonb_build_object('versionStatus',v.status,'isCurrent',v.is_current,'feedStatus',f.status,'pointerMatches',f.current_version_id=v.id,'routeRows',(SELECT count(*) FROM gtfs_route_service_levels WHERE feed_version_id=v.id),'stopRows',(SELECT count(*) FROM gtfs_stop_service_levels WHERE feed_version_id=v.id)) FROM gtfs_feed_versions v JOIN gtfs_feeds f ON f.id=v.feed_id WHERE v.id='33333333-3333-4333-8333-333333333333';
DO $proof$
BEGIN
 IF NOT EXISTS (
 SELECT 1 FROM gtfs_feed_versions v JOIN gtfs_feeds f ON f.id=v.feed_id
 WHERE v.id='33333333-3333-4333-8333-333333333333'
 AND v.status='failed' AND v.is_current AND f.status='ready' AND f.current_version_id=v.id
 AND NOT EXISTS(SELECT 1 FROM gtfs_route_service_levels WHERE feed_version_id=v.id)
 AND NOT EXISTS(SELECT 1 FROM gtfs_stop_service_levels WHERE feed_version_id=v.id)
 ) THEN RAISE EXCEPTION 'stale sweep counterexample did not reproduce'; END IF;
END $proof$;
ROLLBACK;
