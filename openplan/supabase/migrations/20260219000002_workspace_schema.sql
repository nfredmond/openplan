CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE workspace_members (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX idx_workspace_members_user ON workspace_members(user_id);

CREATE TABLE analyses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled Analysis',
  query_text TEXT NOT NULL,
  sql_executed TEXT,
  result_geojson JSONB,
  summary_text TEXT,
  is_public BOOLEAN DEFAULT false,
  share_token TEXT UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_analyses_workspace ON analyses(workspace_id);
CREATE INDEX idx_analyses_share ON analyses(share_token) WHERE is_public = true;

-- RLS
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;
ALTER TABLE gtfs_feeds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_read" ON workspaces
  FOR SELECT USING (
    id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "members_read" ON workspace_members
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "analyses_read" ON analyses
  FOR SELECT USING (
    is_public = true OR
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "analyses_insert" ON analyses
  FOR INSERT WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "analyses_update" ON analyses
  FOR UPDATE USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

-- Add FK from gtfs_feeds to workspaces now that workspaces exists
ALTER TABLE gtfs_feeds ADD CONSTRAINT gtfs_feeds_workspace_fk
  FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;

CREATE POLICY "gtfs_feeds_read" ON gtfs_feeds
  FOR SELECT USING (
    workspace_id IS NULL OR
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "gtfs_feeds_insert" ON gtfs_feeds
  FOR INSERT WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
  );
