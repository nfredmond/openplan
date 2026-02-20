-- Enable extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GTFS feeds registry (workspace_id NULL = public preloaded feed)
CREATE TABLE gtfs_feeds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID,  -- FK added after workspaces table exists
  city TEXT,
  state TEXT,
  agency_name TEXT NOT NULL,
  feed_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  loaded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(city, agency_name)
);

CREATE INDEX idx_gtfs_feeds_workspace ON gtfs_feeds(workspace_id);
CREATE INDEX idx_gtfs_feeds_public ON gtfs_feeds(city, state) WHERE workspace_id IS NULL;

CREATE TABLE agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id UUID NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  agency_id TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  lang TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(feed_id, agency_id)
);
CREATE INDEX idx_agencies_feed ON agencies(feed_id);

CREATE TABLE routes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id UUID NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  route_id TEXT NOT NULL,
  agency_id TEXT,
  short_name TEXT,
  long_name TEXT,
  type INTEGER NOT NULL DEFAULT 3,
  color TEXT DEFAULT 'FFFFFF',
  text_color TEXT DEFAULT '000000',
  UNIQUE(feed_id, route_id)
);
CREATE INDEX idx_routes_feed ON routes(feed_id);

CREATE TABLE stops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id UUID NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  stop_id TEXT NOT NULL,
  name TEXT NOT NULL,
  geometry GEOMETRY(Point, 4326) NOT NULL,
  wheelchair_boarding INTEGER DEFAULT 0,
  UNIQUE(feed_id, stop_id)
);
CREATE INDEX idx_stops_feed ON stops(feed_id);
CREATE INDEX idx_stops_geometry ON stops USING GIST(geometry);

CREATE TABLE trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id UUID NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  trip_id TEXT NOT NULL,
  route_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  headsign TEXT,
  direction_id INTEGER,
  shape_id TEXT,
  UNIQUE(feed_id, trip_id)
);
CREATE INDEX idx_trips_feed ON trips(feed_id);
CREATE INDEX idx_trips_route ON trips(feed_id, route_id);

CREATE TABLE stop_times (
  id BIGSERIAL PRIMARY KEY,
  feed_id UUID NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  trip_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  arrival_time TEXT,
  departure_time TEXT,
  stop_sequence INTEGER NOT NULL
);
CREATE INDEX idx_stop_times_feed ON stop_times(feed_id);
CREATE INDEX idx_stop_times_trip ON stop_times(feed_id, trip_id);
CREATE INDEX idx_stop_times_stop ON stop_times(feed_id, stop_id);

CREATE TABLE shapes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id UUID NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  shape_id TEXT NOT NULL,
  geometry GEOMETRY(LineString, 4326) NOT NULL,
  UNIQUE(feed_id, shape_id)
);
CREATE INDEX idx_shapes_feed ON shapes(feed_id);
CREATE INDEX idx_shapes_geometry ON shapes USING GIST(geometry);

CREATE TABLE calendar (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id UUID NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  monday BOOLEAN NOT NULL DEFAULT false,
  tuesday BOOLEAN NOT NULL DEFAULT false,
  wednesday BOOLEAN NOT NULL DEFAULT false,
  thursday BOOLEAN NOT NULL DEFAULT false,
  friday BOOLEAN NOT NULL DEFAULT false,
  saturday BOOLEAN NOT NULL DEFAULT false,
  sunday BOOLEAN NOT NULL DEFAULT false,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  UNIQUE(feed_id, service_id)
);
CREATE INDEX idx_calendar_feed ON calendar(feed_id);

CREATE TABLE calendar_dates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feed_id UUID NOT NULL REFERENCES gtfs_feeds(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL,
  date DATE NOT NULL,
  exception_type INTEGER NOT NULL
);
CREATE INDEX idx_calendar_dates_feed ON calendar_dates(feed_id);
