import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

/**
 * The survey counts function against the real schema (20261017000002). Survey
 * answers stay closed to every client role; this function is the one way a
 * planner's own session can count them, and it must return counts only, to
 * members only. Every case runs inside one transaction that rolls back.
 */
const live = LIVE_RLS ? describe : describe.skip;
live("engagement survey question counts", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Survey count fixtures require an explicit absolute OPENPLAN_SUPABASE_WORKDIR for an isolated stack.");
    }
    container = resolveLocalDbContainer();
  });

  function exercise(body: string) {
    const keys = ["owner", "viewer", "outsider", "workspace", "other", "campaign", "missing", "s1", "s2", "s3", "q1", "q2"];
    const ids = Object.fromEntries(keys.map(key => [key, randomUUID()]));
    const sql = `BEGIN;
      INSERT INTO auth.users(id,email) VALUES('@owner','@owner@example.test'),('@viewer','@viewer@example.test'),('@outsider','@outsider@example.test');
      INSERT INTO public.workspaces(id,name,slug) VALUES('@workspace','Synthetic survey workspace','@workspace'),('@other','Synthetic other workspace','@other');
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES('@workspace','@owner','owner'),('@workspace','@viewer','viewer'),('@other','@outsider','owner');
      INSERT INTO public.engagement_campaigns(id,workspace_id,title) VALUES('@campaign','@workspace','Synthetic survey campaign');
      -- Answers normally arrive through the public submit path, which validates
      -- them against published questions. Counting needs only the rows.
      SET LOCAL session_replication_role = replica;
      INSERT INTO public.engagement_survey_response_sessions(id,campaign_id,status,source_type) VALUES
        ('@s1','@campaign','approved','public'),('@s2','@campaign','approved','public'),('@s3','@campaign','pending','public');
      INSERT INTO public.engagement_survey_answers(session_id,campaign_id,question_id,question_type,question_prompt_snapshot,answer_json,answer_text) VALUES
        ('@s1','@campaign','@q1','single_choice','Which improvement matters most?','{"option_id":"x"}','RESIDENT WORDS ONE'),
        ('@s2','@campaign','@q1','single_choice','Which improvement matters most?','{"option_id":"y"}',NULL),
        ('@s2','@campaign','@q2','free_text','Anything else?','{"reviewed_redaction":true}','REDACTED WORDS'),
        ('@s3','@campaign','@q1','single_choice','Which improvement matters most?','{"option_id":"z"}','PENDING WORDS');
      SET LOCAL session_replication_role = origin;
      CREATE FUNCTION pg_temp.as_user(p_user uuid) RETURNS void LANGUAGE sql AS $p$
        SELECT set_config('request.jwt.claims', json_build_object('sub',p_user,'role','authenticated')::text, true);
      $p$;
      ${body}
      SELECT 'SURVEY_COUNT_ASSERTIONS_REACHED'; ROLLBACK;`.replace(
      /@(owner|viewer|outsider|workspace|other|campaign|missing|s1|s2|s3|q1|q2)\b/g,
      (_, key: string) => ids[key],
    );
    const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
      input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    expect(output).toContain("SURVEY_COUNT_ASSERTIONS_REACHED");
  }

  it("gives any member approved counts per question, and no answer", () => exercise(`
    SET LOCAL ROLE authenticated;
    DO $$ DECLARE counts jsonb; who uuid; BEGIN
      FOREACH who IN ARRAY ARRAY['@owner'::uuid,'@viewer'::uuid] LOOP
        PERFORM pg_temp.as_user(who);
        counts:=public.engagement_campaign_survey_question_counts('@campaign');
        IF (counts->>'approvedResponseCount')::int IS DISTINCT FROM 2 THEN RAISE EXCEPTION 'Approved responses miscounted: %', counts; END IF;
        IF jsonb_array_length(counts->'questions') IS DISTINCT FROM 1 THEN RAISE EXCEPTION 'A redacted or pending answer was counted: %', counts; END IF;
        IF (counts->'questions'->0->>'answeredCount')::int IS DISTINCT FROM 2 OR counts->'questions'->0->>'prompt' IS DISTINCT FROM 'Which improvement matters most?' THEN
          RAISE EXCEPTION 'Question count is wrong: %', counts; END IF;
        IF counts::text ~ '(RESIDENT|REDACTED|PENDING) WORDS|option_id|@s1|@s2' THEN RAISE EXCEPTION 'An answer or session left the function: %', counts; END IF;
      END LOOP;
    END $$;
  `));

  it("refuses a non-member and a missing campaign alike, and keeps the tables closed", () => exercise(`
    SET LOCAL ROLE authenticated;
    DO $$ DECLARE refused text; missing text; BEGIN
      PERFORM pg_temp.as_user('@outsider');
      BEGIN PERFORM public.engagement_campaign_survey_question_counts('@campaign'); RAISE EXCEPTION 'A non-member read survey counts';
      EXCEPTION WHEN insufficient_privilege THEN refused:=SQLERRM; END;
      PERFORM pg_temp.as_user('@owner');
      BEGIN PERFORM public.engagement_campaign_survey_question_counts('@missing'); RAISE EXCEPTION 'A missing campaign returned counts';
      EXCEPTION WHEN insufficient_privilege THEN missing:=SQLERRM; END;
      IF refused IS DISTINCT FROM missing THEN RAISE EXCEPTION 'The refusal tells a missing campaign from a foreign one'; END IF;
      BEGIN PERFORM 1 FROM public.engagement_survey_answers LIMIT 1; RAISE EXCEPTION 'The answers table opened to a planner session';
      EXCEPTION WHEN insufficient_privilege THEN NULL; END;
    END $$;
  `));

  it("cannot be executed anonymously", () => exercise(`
    DO $$ BEGIN
      IF has_function_privilege('anon','public.engagement_campaign_survey_question_counts(uuid)','EXECUTE') THEN RAISE EXCEPTION 'anon can execute the counts function'; END IF;
      IF NOT has_function_privilege('authenticated','public.engagement_campaign_survey_question_counts(uuid)','EXECUTE') THEN RAISE EXCEPTION 'authenticated cannot execute the counts function'; END IF;
    END $$;
  `));
});
