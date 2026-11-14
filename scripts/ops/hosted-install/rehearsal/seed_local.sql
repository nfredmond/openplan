-- Synthetic rows for the Phase A rehearsal on a scratch stack at 448
-- migrations: three users (each auth.users insert also creates that user's
-- own workspace), one project in each of the first two workspaces. Every
-- address uses the reserved .invalid domain. Run as supabase_admin.
INSERT INTO auth.users (instance_id, id, aud, role, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
VALUES
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated',
   'rehearsal-owner-a@openplan.invalid', now() - interval '2 days', now() - interval '2 days', '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated',
   'rehearsal-owner-b@openplan.invalid', now() - interval '2 days', now() - interval '2 days', '{}', '{}'),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated',
   'rehearsal-other-c@openplan.invalid', now() - interval '2 days', now() - interval '2 days', '{}', '{}');

INSERT INTO public.projects (workspace_id, name, summary, created_by, created_at, updated_at)
SELECT m.workspace_id, 'Rehearsal corridor ' || left(m.user_id::text, 1), 'Synthetic rehearsal project', m.user_id,
       now() - interval '1 day' + (row_number() OVER (ORDER BY m.user_id)) * interval '1 minute',
       now() - interval '1 day'
FROM public.workspace_members m
WHERE m.user_id IN ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
  AND m.role = 'owner';

SELECT (SELECT count(*) FROM auth.users) AS users, (SELECT count(*) FROM public.workspaces) AS workspaces,
       (SELECT count(*) FROM public.workspace_members) AS members, (SELECT count(*) FROM public.projects) AS projects;
