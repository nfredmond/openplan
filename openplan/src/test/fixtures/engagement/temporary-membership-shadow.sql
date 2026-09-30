-- Synthetic role probe. Every caller wraps this fixture in a rollback transaction.
INSERT INTO auth.users(id,aud,role,email) VALUES
 ('ad870000-0000-4000-8000-000000000001','authenticated','authenticated','owner@synthetic-shadow.invalid'),
 ('ad870000-0000-4000-8000-000000000002','authenticated','authenticated','outsider@synthetic-shadow.invalid');
INSERT INTO public.workspaces(id,name,slug) VALUES
 ('ad870000-0000-4000-8000-000000000010','SYNTHETIC trusted membership','synthetic-shadow-ad870000');
INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES
 ('ad870000-0000-4000-8000-000000000010','ad870000-0000-4000-8000-000000000001','owner');
INSERT INTO public.engagement_campaigns(id,workspace_id,title,created_by) VALUES
 ('ad870000-0000-4000-8000-000000000020','ad870000-0000-4000-8000-000000000010','SYNTHETIC private campaign','ad870000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claim.sub','ad870000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE harmless_shadow_control(workspace_id uuid,user_id uuid,role text);
-- Create the conflicting relation before the first call in this session.
-- Otherwise a cached plan may already bind the trusted table and hide the fault.
CREATE TEMP TABLE workspace_members(workspace_id uuid,user_id uuid,role text);
INSERT INTO workspace_members VALUES
 ('ad870000-0000-4000-8000-000000000010','ad870000-0000-4000-8000-000000000001','owner'),
 ('ad870000-0000-4000-8000-000000000010','ad870000-0000-4000-8000-000000000002','owner');
DO $control$
DECLARE packet jsonb;
BEGIN
 packet := public.read_engagement_synthesis_response_links('ad870000-0000-4000-8000-000000000020','ad870000-0000-4000-8000-000000000030','ad870000-0000-4000-8000-000000000040','synthetic-group');
 IF packet->>'eventCount' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'Authorized empty history was not readable'; END IF;
END $control$;
SELECT set_config('request.jwt.claim.sub','ad870000-0000-4000-8000-000000000002',true);
DO $probe$
DECLARE refused boolean := false;
BEGIN
 BEGIN
  PERFORM public.read_engagement_synthesis_response_links('ad870000-0000-4000-8000-000000000020','ad870000-0000-4000-8000-000000000030','ad870000-0000-4000-8000-000000000040','synthetic-group');
 EXCEPTION WHEN insufficient_privilege THEN refused := true;
 END;
 IF NOT refused THEN RAISE EXCEPTION 'Temporary membership bypassed campaign access'; END IF;
END $probe$;
RESET ROLE;
SELECT 'temporary-membership-refused';
