-- Run inside the wrapper's rollback transaction on an isolated verification stack.
-- Recreate equivalent FKs in both orders, without changing their definitions.
DO $order$
BEGIN
  IF current_setting('openplan.test_review_release_cascade_order') = 'release-first' THEN
    ALTER TABLE public.land_use_plans
      DROP CONSTRAINT land_use_plans_workspace_id_fkey,
      ADD CONSTRAINT land_use_plans_workspace_id_fkey FOREIGN KEY (workspace_id)
        REFERENCES public.workspaces(id) ON DELETE CASCADE;
    ALTER TABLE public.land_use_plan_versions
      DROP CONSTRAINT land_use_plan_versions_workspace_id_fkey,
      ADD CONSTRAINT land_use_plan_versions_workspace_id_fkey FOREIGN KEY (workspace_id)
        REFERENCES public.workspaces(id) ON DELETE CASCADE;
    ALTER TABLE public.land_use_plan_versions
      DROP CONSTRAINT land_use_plan_versions_plan_id_workspace_id_fkey,
      ADD CONSTRAINT land_use_plan_versions_plan_id_workspace_id_fkey FOREIGN KEY (plan_id, workspace_id)
        REFERENCES public.land_use_plans(id, workspace_id) ON DELETE CASCADE;
  ELSIF current_setting('openplan.test_review_release_cascade_order') = 'plan-first' THEN
    ALTER TABLE public.land_use_plan_review_releases
      DROP CONSTRAINT land_use_plan_review_releases_workspace_id_fkey,
      ADD CONSTRAINT land_use_plan_review_releases_workspace_id_fkey FOREIGN KEY (workspace_id)
        REFERENCES public.workspaces(id) ON DELETE CASCADE;
  ELSE
    RAISE EXCEPTION 'Unknown review-release cascade order';
  END IF;
END $order$;

CREATE FUNCTION pg_temp.review_release_assert(p_ok boolean, p_message text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION '%', p_message; END IF;
END $$;

-- Match the actual guard message, so an FK or permission error cannot count.
CREATE FUNCTION pg_temp.review_release_refuses(p_sql text, p_message text, p_label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  BEGIN EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = 'P0001' AND SQLERRM = p_message THEN RETURN; END IF;
    RAISE EXCEPTION '%: unexpected % %', p_label, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION '%: accepted', p_label;
END $$;

-- Observe actual parent visibility before the production guard executes.
-- This prevents either run from passing without reaching its declared order.
CREATE FUNCTION pg_temp.review_release_cascade_probe()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('openplan.test_review_release_delete_scope', true) = 'plan' THEN
    PERFORM pg_temp.review_release_assert(
      NOT EXISTS (SELECT 1 FROM public.land_use_plans WHERE id=OLD.plan_id AND workspace_id=OLD.workspace_id)
      AND EXISTS (SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id),
      'plan cascade must remove plan while workspace remains');
  ELSIF current_setting('openplan.test_review_release_delete_scope', true) = 'workspace' THEN
    PERFORM pg_temp.review_release_assert(
      NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id),
      'workspace cascade must remove workspace before release');
    IF current_setting('openplan.test_review_release_cascade_order') = 'release-first' THEN
      PERFORM pg_temp.review_release_assert(
        EXISTS (SELECT 1 FROM public.land_use_plans WHERE id=OLD.plan_id AND workspace_id=OLD.workspace_id),
        'release-first workspace cascade must reach release while plan remains visible');
    ELSE
      PERFORM pg_temp.review_release_assert(
        NOT EXISTS (SELECT 1 FROM public.land_use_plans WHERE id=OLD.plan_id AND workspace_id=OLD.workspace_id),
        'plan-first workspace cascade must remove plan before release');
    END IF;
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER aa_review_release_cascade_probe
  BEFORE DELETE ON public.land_use_plan_review_releases
  FOR EACH ROW EXECUTE FUNCTION pg_temp.review_release_cascade_probe();

DO $test$
DECLARE
  actor uuid:=gen_random_uuid(); outsider uuid:=gen_random_uuid();
  retained_owner uuid:=gen_random_uuid();
  workspace uuid; plan uuid; version uuid; document uuid; release_ids uuid[]; release_id uuid;
  sentinel_workspace uuid:=gen_random_uuid(); sentinel_plan uuid:=gen_random_uuid();
  deletion_scope text; writer_role text; read_role text; row_count integer; before_rows jsonb;
  hash text:=encode(extensions.digest('{}','sha256'),'hex'); release_count integer;
BEGIN
  INSERT INTO auth.users(id,email) VALUES(actor,actor||'@synthetic.invalid'),
    (outsider,outsider||'@synthetic.invalid'),(retained_owner,retained_owner||'@synthetic.invalid');
  INSERT INTO public.workspaces(id,name,slug)
    VALUES(sentinel_workspace,'SYNTHETIC unrelated review owner',sentinel_workspace::text);
  INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label)
    VALUES(sentinel_plan,sentinel_workspace,'SYNTHETIC unrelated plan','local-unconfigured','community','SYNTHETIC','SYNTHETIC');
  FOREACH deletion_scope IN ARRAY ARRAY['plan','workspace'] LOOP
    PERFORM set_config('openplan.test_review_release_delete_scope','direct',true);
    workspace:=gen_random_uuid(); plan:=gen_random_uuid(); version:=gen_random_uuid(); document:=gen_random_uuid();
    release_ids:=ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
    INSERT INTO public.workspaces(id,name,slug)
      VALUES(workspace,'SYNTHETIC review release cascade',workspace::text);
    -- Keep ownership lawful while actor cycles through writer and viewer roles.
    INSERT INTO public.workspace_members(workspace_id,user_id,role)
      VALUES(workspace,retained_owner,'owner'),(workspace,actor,'owner');
    INSERT INTO public.kb_documents(id,workspace_id,title,source_kind,status)
      VALUES(document,workspace,'SYNTHETIC external review','pasted_text','ready');
    INSERT INTO public.land_use_plans(id,workspace_id,title,descriptor_id,plan_kind_key,authority_label,geography_label)
      VALUES(plan,workspace,'SYNTHETIC release plan','local-unconfigured','community','SYNTHETIC','SYNTHETIC');
    INSERT INTO public.land_use_plan_versions(id,workspace_id,plan_id,version_number,version_kind)
      VALUES(version,workspace,plan,1,'original');
    PERFORM pg_temp.review_release_refuses(format(
      'INSERT INTO public.land_use_plan_review_releases(workspace_id,plan_id,version_id,version_content_hash,round_number,review_method,review_open_on,review_close_on,external_review_document_id) VALUES(%L,%L,%L,%L,1,%L,%L,%L,%L)',
      workspace,plan,version,hash,'external_process','2026-10-01','2026-10-07',document),
      'Review release must name the exact frozen public-review version hash','working version release refused');
    UPDATE public.land_use_plan_versions SET state='public_review',frozen_snapshot='{}',
      content_hash=hash,frozen_at=now(),frozen_by=actor WHERE id=version;
    FOR release_count IN 1..3 LOOP
      INSERT INTO public.land_use_plan_review_releases(id,workspace_id,plan_id,version_id,version_content_hash,
        round_number,review_method,review_open_on,review_close_on,external_review_document_id,created_by)
        VALUES(release_ids[release_count],workspace,plan,version,hash,release_count,
          'external_process','2026-10-01','2026-10-07',document,actor);
    END LOOP;
    PERFORM pg_temp.review_release_refuses(format(
      'UPDATE public.land_use_plan_review_releases SET version_content_hash=%L WHERE id=%L',repeat('b',64),release_ids[1]),
      'Published review release identity is immutable','frozen review hash cannot change');
    UPDATE public.land_use_plan_review_releases SET status='closed',outcome_snapshot='{"synthetic":true}',
      closed_at=now(),closed_by=actor WHERE id=release_ids[2];
    PERFORM pg_temp.review_release_assert((SELECT outcome_hash=encode(
      extensions.digest(convert_to(outcome_snapshot::text,'UTF8'),'sha256'),'hex')
      FROM public.land_use_plan_review_releases WHERE id=release_ids[2]),'close computes exact outcome hash');
    PERFORM pg_temp.review_release_refuses(format(
      'UPDATE public.land_use_plan_review_releases SET outcome_snapshot=%L WHERE id=%L','{}',release_ids[2]),
      'A closed review release is immutable','closed outcome cannot change');
    UPDATE public.land_use_plan_review_releases SET status='withdrawn',withdrawn_at=now(),withdrawn_by=actor,
      withdrawal_reason='SYNTHETIC withdrawal' WHERE id=release_ids[3];
    PERFORM pg_temp.review_release_refuses(format(
      'UPDATE public.land_use_plan_review_releases SET withdrawal_reason=%L WHERE id=%L','changed',release_ids[3]),
      'A withdrawn review release is immutable','withdrawal cannot change');
    SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) INTO before_rows
      FROM public.land_use_plan_review_releases r WHERE r.plan_id=plan;
    PERFORM pg_temp.review_release_assert(jsonb_array_length(before_rows)=3,'seed all release states');

    -- Privileged deletes reach the guard without RLS filtering.
    FOREACH release_id IN ARRAY release_ids LOOP
      PERFORM pg_temp.review_release_refuses(format('DELETE FROM public.land_use_plan_review_releases WHERE id=%L',release_id),
        'Public review releases are append-only','postgres direct delete refused');
    END LOOP;
    SET LOCAL ROLE service_role;
    FOREACH release_id IN ARRAY release_ids LOOP
      PERFORM pg_temp.review_release_refuses(format('DELETE FROM public.land_use_plan_review_releases WHERE id=%L',release_id),
        'Public review releases are append-only','service direct delete refused');
    END LOOP;
    RESET ROLE;
    FOREACH writer_role IN ARRAY ARRAY['owner','admin','member'] LOOP
      UPDATE public.workspace_members SET role=writer_role WHERE workspace_id=workspace AND user_id=actor;
      PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
      SET LOCAL ROLE authenticated;
      PERFORM pg_temp.review_release_assert(
        EXISTS(SELECT 1 FROM public.land_use_plans WHERE id=plan AND workspace_id=workspace)
        AND EXISTS(SELECT 1 FROM public.workspaces WHERE id=workspace)
        AND (SELECT count(*)=3 FROM public.land_use_plan_review_releases WHERE plan_id=plan),
        writer_role||' must see release and both parents before direct delete');
      FOREACH release_id IN ARRAY release_ids LOOP
        PERFORM pg_temp.review_release_refuses(format('DELETE FROM public.land_use_plan_review_releases WHERE id=%L',release_id),
          'Public review releases are append-only',writer_role||' direct delete refused');
      END LOOP;
      RESET ROLE;
    END LOOP;
    FOREACH read_role IN ARRAY ARRAY['viewer','outsider'] LOOP
      UPDATE public.workspace_members SET role='viewer' WHERE workspace_id=workspace AND user_id=actor;
      PERFORM set_config('request.jwt.claims',jsonb_build_object(
        'sub',CASE WHEN read_role='viewer' THEN actor ELSE outsider END,'role','authenticated')::text,true);
      SET LOCAL ROLE authenticated;
      PERFORM pg_temp.review_release_assert((SELECT count(*)=CASE WHEN read_role='viewer' THEN 3 ELSE 0 END
        FROM public.land_use_plan_review_releases WHERE plan_id=plan),read_role||' read visibility');
      IF read_role='outsider' THEN
        PERFORM pg_temp.review_release_assert(
          NOT EXISTS(SELECT 1 FROM public.land_use_plans WHERE id=plan)
          AND NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=workspace),'outsider parents are RLS-invisible');
      END IF;
      DELETE FROM public.land_use_plan_review_releases WHERE plan_id=plan;
      GET DIAGNOSTICS row_count=ROW_COUNT;
      PERFORM pg_temp.review_release_assert(row_count=0,read_role||' cannot delete RLS-invisible or read-only release');
      RESET ROLE;
    END LOOP;
    PERFORM pg_temp.review_release_assert((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id)=before_rows
      FROM public.land_use_plan_review_releases r WHERE r.plan_id=plan),'all direct attempts retain exact release rows');
    -- Check the allowed transition, then retain all three states for cascades.
    BEGIN
      UPDATE public.land_use_plan_review_releases SET status='withdrawn',withdrawn_at=now(),withdrawn_by=actor,
        withdrawal_reason='SYNTHETIC closed withdrawal' WHERE id=release_ids[2];
      PERFORM pg_temp.review_release_assert((SELECT status='withdrawn'
        FROM public.land_use_plan_review_releases WHERE id=release_ids[2]),'closed release can withdraw');
      RAISE EXCEPTION USING ERRCODE='PT498',MESSAGE='Restore closed release fixture';
    EXCEPTION WHEN SQLSTATE 'PT498' THEN NULL; END;

    PERFORM set_config('openplan.test_review_release_delete_scope',deletion_scope,true);
    IF deletion_scope='plan' THEN
      DELETE FROM public.land_use_plans WHERE id=plan AND workspace_id=workspace;
      PERFORM pg_temp.review_release_assert(EXISTS(SELECT 1 FROM public.workspaces WHERE id=workspace),
        'plan delete retains its workspace');
    ELSE
      DELETE FROM public.workspaces WHERE id=workspace;
      PERFORM pg_temp.review_release_assert(NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=workspace),
        'workspace delete removes its workspace');
    END IF;
    PERFORM pg_temp.review_release_assert(
      NOT EXISTS(SELECT 1 FROM public.land_use_plans WHERE id=plan)
      AND NOT EXISTS(SELECT 1 FROM public.land_use_plan_versions WHERE id=version)
      AND NOT EXISTS(SELECT 1 FROM public.land_use_plan_review_releases WHERE id=ANY(release_ids)),
      deletion_scope||' cascade must remove owning plan, version and all release states');
    PERFORM pg_temp.review_release_assert(EXISTS(SELECT 1 FROM public.land_use_plans
      WHERE id=sentinel_plan AND workspace_id=sentinel_workspace),'unrelated scoped plan remains');
    RAISE NOTICE 'review release % cascade verified: %',deletion_scope,current_setting('openplan.test_review_release_cascade_order');
  END LOOP;
END $test$;
SELECT 'review release plan cascade verified: '||current_setting('openplan.test_review_release_cascade_order');
SELECT 'review release workspace cascade verified: '||current_setting('openplan.test_review_release_cascade_order');
