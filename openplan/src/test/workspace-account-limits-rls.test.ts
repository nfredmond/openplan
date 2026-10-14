import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

/**
 * Migration 20261017000010 against the real schema. Every case runs in one
 * transaction that rolls back.
 *
 * - create_owned_workspace counts only the workspaces a person OWNS (the one
 *   the signup trigger made included), creates the workspace and its owner
 *   membership together while under the limit, writes nothing at the limit,
 *   and is callable by the service role only.
 * - workspace_storage_bytes sums Storage's recorded size for this workspace's
 *   prefix only, counts an object with no recorded size as nothing, and is
 *   callable by the service role only.
 */
const live = LIVE_RLS ? describe : describe.skip;

live("workspace account limits (20261017000010)", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Account limit fixtures require an explicit absolute OPENPLAN_SUPABASE_WORKDIR for an isolated stack.");
    }
    container = resolveLocalDbContainer();
  });

  function exercise(body: string) {
    const keys = ["person", "other", "campaign"];
    const ids: Record<string, string> = Object.fromEntries(keys.map((key) => [key, randomUUID()]));
    for (const n of [2, 3, 4, 5, 6]) ids[`slug${n}`] = `limits-${randomUUID().slice(0, 8)}-${n}`;
    const sql = `BEGIN;
      INSERT INTO auth.users(id,email) VALUES('@person','@person@example.test'),('@other','@other@example.test');
      CREATE FUNCTION pg_temp.make(p_user uuid, p_slug text, p_limit integer) RETURNS jsonb LANGUAGE sql AS $p$
        SELECT public.create_owned_workspace(p_user,'Synthetic workspace',p_slug,'us_federal_aid_stage_gates_v0_1','0.1.0',
          'interim_unconfigured_default','workspace_bootstrap_interim',p_limit);
      $p$;
      ${body}
      SELECT 'ACCOUNT_LIMIT_ASSERTIONS_REACHED'; ROLLBACK;`.replace(
      /@(person|other|campaign|slug2|slug3|slug4|slug5|slug6)/g,
      (_, key: string) => ids[key],
    );
    const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
      input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    expect(output).toContain("ACCOUNT_LIMIT_ASSERTIONS_REACHED");
  }

  it("creates owned workspaces up to the limit and writes nothing past it", () => exercise(`
    DO $$ DECLARE r jsonb; ws uuid; BEGIN
      -- The signup trigger already gave each person one owned workspace.
      IF (SELECT count(*) FROM public.workspace_members WHERE user_id='@person' AND role='owner') <> 1 THEN
        RAISE EXCEPTION 'Signup did not leave exactly one owned workspace'; END IF;
      r:=pg_temp.make('@person','@slug2',3);
      IF NOT (r->>'created')::boolean OR (r->>'owned')::integer <> 2 OR (r->>'limit')::integer <> 3 THEN RAISE EXCEPTION 'Under the limit was refused: %', r; END IF;
      ws:=(r->'workspace'->>'id')::uuid;
      IF (SELECT array_agg(user_id::text||':'||role) FROM public.workspace_members WHERE workspace_id=ws) IS DISTINCT FROM ARRAY['@person:owner'] THEN
        RAISE EXCEPTION 'The new workspace is not owned by its creator alone'; END IF;
      IF (SELECT slug||'|'||stage_gate_template_id||'|'||stage_gate_binding_source FROM public.workspaces WHERE id=ws)
        IS DISTINCT FROM '@slug2|us_federal_aid_stage_gates_v0_1|workspace_bootstrap_interim' THEN RAISE EXCEPTION 'The workspace row lost its binding'; END IF;
      -- Being a member of someone else's workspace does not count against the limit.
      INSERT INTO public.workspace_members(workspace_id,user_id,role)
        SELECT workspace_id,'@person','member' FROM public.workspace_members WHERE user_id='@other' AND role='owner';
      r:=pg_temp.make('@person','@slug3',3);
      IF NOT (r->>'created')::boolean OR (r->>'owned')::integer <> 3 THEN RAISE EXCEPTION 'Membership was counted as ownership: %', r; END IF;
      r:=pg_temp.make('@person','@slug4',3);
      IF (r->>'created')::boolean OR (r->>'owned')::integer <> 3 OR (r->>'limit')::integer <> 3 OR r ? 'workspace' THEN RAISE EXCEPTION 'At the limit was not refused: %', r; END IF;
      IF EXISTS (SELECT 1 FROM public.workspaces WHERE slug='@slug4') THEN RAISE EXCEPTION 'A refusal wrote a workspace'; END IF;
      IF (SELECT count(*) FROM public.workspace_members WHERE user_id='@person' AND role='owner') <> 3 THEN RAISE EXCEPTION 'A refusal wrote a membership'; END IF;
      -- A raised limit lets the same person continue; another person's count is their own.
      r:=pg_temp.make('@person','@slug4',4);
      IF NOT (r->>'created')::boolean THEN RAISE EXCEPTION 'A raised limit was not honoured'; END IF;
      r:=pg_temp.make('@other','@slug5',1);
      IF (r->>'created')::boolean THEN RAISE EXCEPTION 'The other person was not limited by their own count'; END IF;
      r:=pg_temp.make('@other','@slug5',2);
      IF NOT (r->>'created')::boolean OR (r->>'owned')::integer <> 2 THEN RAISE EXCEPTION 'The other person was charged for someone else''s workspaces: %', r; END IF;
      BEGIN PERFORM pg_temp.make('@other','@slug5',5); RAISE EXCEPTION 'A taken slug was accepted'; EXCEPTION WHEN unique_violation THEN NULL; END;
      BEGIN PERFORM pg_temp.make('@other','@slug6',0); RAISE EXCEPTION 'A limit of zero was accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      BEGIN PERFORM public.create_owned_workspace('@other','  ','@slug6','t','v','s','b',5); RAISE EXCEPTION 'A blank name was accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    END $$;`));

  it("sums only this workspace's stored bytes", () => exercise(`
    DO $$ DECLARE ws uuid; other uuid; BEGIN
      SELECT workspace_id INTO ws FROM public.workspace_members WHERE user_id='@person' AND role='owner';
      SELECT workspace_id INTO other FROM public.workspace_members WHERE user_id='@other' AND role='owner';
      IF public.workspace_storage_bytes(ws) <> 0 THEN RAISE EXCEPTION 'A new workspace already stores bytes'; END IF;
      INSERT INTO storage.objects(bucket_id,name,metadata) VALUES
        ('project-map-packages', ws||'/project/package/maps.zip', '{"size": 1000}'),
        ('aerial-imagery', ws||'/mission/image/photo.jpg', '{"size": 234}'),
        -- Issued but not yet written: no recorded size, so nothing counted.
        ('aerial-imagery', ws||'/mission/image/pending.jpg', NULL),
        ('project-map-packages', ws||'/project/package/odd.zip', '{"size": "unknown"}'),
        ('project-map-packages', other||'/project/package/maps.zip', '{"size": 50000}'),
        -- Campaign-prefixed public photos are outside the workspace prefix.
        ('engagement-photos', '@campaign/photo.jpg', '{"size": 999}');
      IF public.workspace_storage_bytes(ws) <> 1234 THEN RAISE EXCEPTION 'Wrong total for the workspace: %', public.workspace_storage_bytes(ws); END IF;
      IF public.workspace_storage_bytes(other) <> 50000 THEN RAISE EXCEPTION 'Wrong total for the other workspace: %', public.workspace_storage_bytes(other); END IF;
      BEGIN PERFORM public.workspace_storage_bytes(NULL); RAISE EXCEPTION 'A missing workspace was accepted'; EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
    END $$;`));

  it("lets only the service role call either function", () => exercise(`
    DO $$ DECLARE ws uuid; caller text; BEGIN
      SELECT workspace_id INTO ws FROM public.workspace_members WHERE user_id='@person' AND role='owner';
      FOREACH caller IN ARRAY ARRAY['authenticated','anon'] LOOP
        PERFORM set_config('request.jwt.claim.sub','@person',true); EXECUTE format('SET LOCAL ROLE %I', caller);
        BEGIN PERFORM public.create_owned_workspace('@person','Synthetic workspace','@slug2','us_federal_aid_stage_gates_v0_1','0.1.0','interim_unconfigured_default','workspace_bootstrap_interim',99);
          RAISE EXCEPTION '% created a workspace directly', caller; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        BEGIN PERFORM public.workspace_storage_bytes(ws); RAISE EXCEPTION '% read storage use directly', caller; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        EXECUTE 'RESET ROLE';
      END LOOP;
      EXECUTE 'SET LOCAL ROLE service_role';
      IF public.workspace_storage_bytes(ws) <> 0 THEN RAISE EXCEPTION 'The service role read a wrong total'; END IF;
      IF NOT (public.create_owned_workspace('@person','Synthetic workspace','@slug2','us_federal_aid_stage_gates_v0_1','0.1.0','interim_unconfigured_default','workspace_bootstrap_interim',5)->>'created')::boolean THEN
        RAISE EXCEPTION 'The service role could not create a workspace'; END IF;
      EXECUTE 'RESET ROLE';
    END $$;`));
});
