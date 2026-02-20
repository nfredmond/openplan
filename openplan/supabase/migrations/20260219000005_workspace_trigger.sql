CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  org_name TEXT;
  workspace_slug TEXT;
  new_workspace_id UUID;
BEGIN
  org_name := COALESCE(
    NEW.raw_user_meta_data->>'org_name',
    split_part(NEW.email, '@', 1)
  );
  workspace_slug := lower(regexp_replace(org_name, '[^a-z0-9]', '-', 'g'))
    || '-' || substring(NEW.id::text, 1, 8);

  INSERT INTO workspaces (name, slug)
  VALUES (org_name, workspace_slug)
  RETURNING id INTO new_workspace_id;

  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace_id, NEW.id, 'owner');

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
