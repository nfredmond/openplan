import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

/**
 * The workspace time zone against the real schema (20261017000007).
 * `set_workspace_time_zone` is the only client write path to the column: it
 * reads the caller from auth.uid(), allows owners and admins of that
 * workspace, and the trigger refuses a name that is not an IANA zone. Every
 * case runs inside one transaction that rolls back.
 */
const live = LIVE_RLS ? describe : describe.skip;
live("workspace time zone", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Time zone fixtures require an explicit absolute OPENPLAN_SUPABASE_WORKDIR for an isolated stack.");
    }
    container = resolveLocalDbContainer();
  });

  function exercise(body: string) {
    const keys = ["owner", "admin", "member", "viewer", "outsider", "workspace", "other"];
    const ids = Object.fromEntries(keys.map((key) => [key, randomUUID()]));
    const sql = `BEGIN;
      INSERT INTO auth.users(id,email) VALUES('@owner','@owner@example.test'),('@admin','@admin@example.test'),
        ('@member','@member@example.test'),('@viewer','@viewer@example.test'),('@outsider','@outsider@example.test');
      INSERT INTO public.workspaces(id,name,slug) VALUES('@workspace','Synthetic time zone workspace','@workspace'),
        ('@other','Synthetic other workspace','@other');
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('@workspace','@owner','owner'),
        ('@workspace','@admin','admin'),('@workspace','@member','member'),('@workspace','@viewer','viewer'),
        ('@other','@outsider','owner');
      CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $p$
        SELECT set_config('request.jwt.claims', json_build_object('sub',p_user,'role','authenticated')::text, true);
      $p$;
      ${body}
      SELECT 'TIME_ZONE_ASSERTIONS_REACHED'; ROLLBACK;`.replace(
      /@(owner|admin|member|viewer|outsider|workspace|other)\b/g,
      (_, key: string) => ids[key],
    );
    const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
      input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    expect(output).toContain("TIME_ZONE_ASSERTIONS_REACHED");
  }

  it("lets an owner and an admin set and clear the zone", () => exercise(`
    SET LOCAL ROLE authenticated;
    DO $$ DECLARE stored text; BEGIN
      PERFORM pg_temp.as_user('@owner');
      stored:=public.set_workspace_time_zone('@workspace','America/Chicago');
      IF stored IS DISTINCT FROM 'America/Chicago' THEN RAISE EXCEPTION 'Owner set returned %', stored; END IF;
      IF (SELECT time_zone FROM public.workspaces WHERE id='@workspace') IS DISTINCT FROM 'America/Chicago' THEN
        RAISE EXCEPTION 'Owner set was not stored'; END IF;
      PERFORM pg_temp.as_user('@admin');
      stored:=public.set_workspace_time_zone('@workspace','Pacific/Auckland');
      IF (SELECT time_zone FROM public.workspaces WHERE id='@workspace') IS DISTINCT FROM 'Pacific/Auckland' THEN
        RAISE EXCEPTION 'Admin set was not stored'; END IF;
      stored:=public.set_workspace_time_zone('@workspace','  ');
      IF stored IS NOT NULL OR (SELECT time_zone FROM public.workspaces WHERE id='@workspace') IS NOT NULL THEN
        RAISE EXCEPTION 'A blank zone did not clear the setting'; END IF;
    END $$;
  `));

  it("refuses a viewer, a member and a non-member alike, and changes nothing", () => exercise(`
    UPDATE public.workspaces SET time_zone='America/Chicago' WHERE id='@workspace';
    SET LOCAL ROLE authenticated;
    DO $$ DECLARE who uuid; refusals text[] := '{}'; BEGIN
      FOREACH who IN ARRAY ARRAY['@viewer'::uuid,'@member'::uuid,'@outsider'::uuid] LOOP
        PERFORM pg_temp.as_user(who);
        BEGIN PERFORM public.set_workspace_time_zone('@workspace','Asia/Tokyo'); RAISE EXCEPTION 'A % set the time zone', who;
        EXCEPTION WHEN insufficient_privilege THEN refusals:=refusals||SQLERRM; END;
      END LOOP;
      IF array_length(refusals,1) IS DISTINCT FROM 3 OR refusals[1] IS DISTINCT FROM refusals[3] THEN
        RAISE EXCEPTION 'Refusals differ or are missing: %', refusals; END IF;
      PERFORM pg_temp.as_user('@owner');
      IF (SELECT time_zone FROM public.workspaces WHERE id='@workspace') IS DISTINCT FROM 'America/Chicago' THEN
        RAISE EXCEPTION 'A refused call changed the zone'; END IF;
      -- A direct write has no UPDATE policy to pass: it is refused or matches no row.
      BEGIN UPDATE public.workspaces SET time_zone='Asia/Tokyo' WHERE id='@workspace';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      IF (SELECT time_zone FROM public.workspaces WHERE id='@workspace') IS DISTINCT FROM 'America/Chicago' THEN
        RAISE EXCEPTION 'A direct UPDATE changed the zone'; END IF;
    END $$;
  `));

  it("refuses a name that is not an IANA zone, from the function and from a service write", () => exercise(`
    DO $$ DECLARE bad text; BEGIN
      FOREACH bad IN ARRAY ARRAY['PST','Mars/Olympus_Mons','posixrules','Factory','america/chicago','UTC; DROP TABLE x'] LOOP
        BEGIN UPDATE public.workspaces SET time_zone=bad WHERE id='@workspace'; RAISE EXCEPTION 'Stored %', bad;
        EXCEPTION WHEN invalid_parameter_value OR check_violation THEN NULL; END;
      END LOOP;
    END $$;
    SET LOCAL ROLE authenticated;
    DO $$ BEGIN
      PERFORM pg_temp.as_user('@owner');
      BEGIN PERFORM public.set_workspace_time_zone('@workspace','PST'); RAISE EXCEPTION 'The function stored PST';
      EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
      IF (SELECT time_zone FROM public.workspaces WHERE id='@workspace') IS NOT NULL THEN RAISE EXCEPTION 'An invalid zone was stored'; END IF;
    END $$;
  `));

  it("cannot be executed anonymously", () => exercise(`
    DO $$ BEGIN
      IF has_function_privilege('anon','public.set_workspace_time_zone(uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'anon can set a time zone'; END IF;
      IF NOT has_function_privilege('authenticated','public.set_workspace_time_zone(uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'authenticated cannot set a time zone'; END IF;
      IF has_function_privilege('authenticated','public.workspaces_require_iana_time_zone()','EXECUTE') THEN RAISE EXCEPTION 'the trigger function is callable'; END IF;
    END $$;
  `));
});
