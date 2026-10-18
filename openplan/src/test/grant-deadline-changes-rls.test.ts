import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { LIVE_RLS } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";

// Authored for an explicitly selected isolated stack. These tests do not run
// in ordinary source checks. Each fixture and injected failure rolls back.
const live = LIVE_RLS ? describe : describe.skip;
live("grant deadline changes, atomic retention and access (20261018000001)", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Grant deadline fixtures require an explicit absolute OPENPLAN_SUPABASE_WORKDIR for an isolated stack.");
    }
    container = resolveLocalDbContainer();
  });

  function exercise(body: string) {
    const ids = Object.fromEntries(["creator", "outsider", "viewer", "opportunity", "unknown", "departed"].map((key) => [key, randomUUID()]));
    const sql = `BEGIN;
      INSERT INTO auth.users(id,email) VALUES
        ('@creator','@creator@example.test'), ('@outsider','@outsider@example.test'), ('@viewer','@viewer@example.test');
      CREATE FUNCTION pg_temp.grant_workspace() RETURNS uuid LANGUAGE sql AS $f$
        SELECT workspace_id FROM public.workspace_members WHERE user_id='@creator' AND role='owner' LIMIT 1;
      $f$;
      INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(pg_temp.grant_workspace(),'@viewer','viewer');
      CREATE FUNCTION pg_temp.assert_grant(ok boolean, reason text) RETURNS void LANGUAGE plpgsql AS $f$
        BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION '%',reason; END IF; END;
      $f$;
      SELECT set_config('request.jwt.claim.sub','@creator',true);
      INSERT INTO public.funding_opportunities(id,workspace_id,title,created_by,decision_state,closes_at,decision_due_at)
        VALUES('@opportunity',pg_temp.grant_workspace(),'Synthetic retained opportunity','@creator','pursue',
          '2026-10-18T18:00:00.123456Z','2026-10-18T17:00:00Z');
      ${body}
      SELECT 'GRANT_DEADLINE_ASSERTIONS_REACHED'; ROLLBACK;`.replace(
      /@(creator|outsider|viewer|opportunity|unknown|departed)/g, (_, key: string) => ids[key],
    );
    const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
      input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    expect(output).toContain("GRANT_DEADLINE_ASSERTIONS_REACHED");
  }

  it("retains initial, same-day, repeated, cleared and re-added facts without rewriting prior instants", () => exercise(`
    DO $$ BEGIN
      PERFORM pg_temp.assert_grant((SELECT count(*)=2 FROM public.funding_opportunity_deadline_changes WHERE opportunity_id='@opportunity'),'Initial dates not retained');
      PERFORM pg_temp.assert_grant((SELECT count(*)=2 FROM public.work_notifications WHERE subject_id='@opportunity' AND due_on IS NULL),'Initial notices missing or falsely dated');
      UPDATE public.funding_opportunities SET closes_at='2026-10-18T19:00:00.123456Z' WHERE id='@opportunity';
      UPDATE public.funding_opportunities SET closes_at='2026-10-18T19:00:00.123456Z',title='Renamed' WHERE id='@opportunity';
      PERFORM pg_temp.assert_grant((SELECT count(*)=3 FROM public.funding_opportunity_deadline_changes WHERE opportunity_id='@opportunity'),'Identical instant created an event');
      UPDATE public.funding_opportunities SET closes_at=NULL,decision_due_at=NULL WHERE id='@opportunity';
      UPDATE public.funding_opportunities SET closes_at='2026-10-18T18:00:00.123456Z' WHERE id='@opportunity';
      PERFORM pg_temp.assert_grant((SELECT count(*)=6 FROM public.funding_opportunity_deadline_changes WHERE opportunity_id='@opportunity'),'Repeated changes were lost');
      PERFORM pg_temp.assert_grant((SELECT count(*)=1 FROM public.funding_opportunity_deadline_changes WHERE opportunity_id='@opportunity' AND old_at='2026-10-18T18:00:00.123456Z' AND new_at='2026-10-18T19:00:00.123456Z'),'Old/new microseconds changed');
      PERFORM pg_temp.assert_grant((SELECT count(*)=2 FROM public.funding_opportunity_deadline_changes WHERE opportunity_id='@opportunity' AND new_at IS NULL),'Cleared dates were lost');
      PERFORM pg_temp.assert_grant((SELECT count(*)=6 AND count(DISTINCT deadline_change_id)=6 FROM public.work_notifications WHERE subject_id='@opportunity'),'Event IDs collapsed');
      PERFORM pg_temp.assert_grant(EXISTS(SELECT 1 FROM public.work_notifications WHERE subject_id='@opportunity' AND body LIKE '%2026-10-18T18:00:00.123456Z%' AND body LIKE '%2026-10-18T19:00:00.123456Z%'),'Exact instants missing from notice');
      BEGIN UPDATE public.funding_opportunity_deadline_changes SET old_at=NULL WHERE opportunity_id='@opportunity';
        RAISE EXCEPTION 'Journal update accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
      BEGIN UPDATE public.work_notifications SET body='rewritten' WHERE subject_id='@opportunity';
        RAISE EXCEPTION 'Notice fact update accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
      DELETE FROM public.funding_opportunities WHERE id='@opportunity';
      PERFORM pg_temp.assert_grant((SELECT count(*)=6 FROM public.funding_opportunity_deadline_changes WHERE opportunity_id='@opportunity'),'Opportunity deletion erased history');
    END $$;`));

  it("rolls back both dates and journal when the secondary notice write fails", () => exercise(`
    CREATE FUNCTION pg_temp.reject_grant_notice() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN RAISE EXCEPTION 'synthetic notice failure' USING ERRCODE='23514'; END;
    $f$;
    CREATE TRIGGER test_reject_grant_notice BEFORE INSERT ON public.work_notifications
      FOR EACH ROW EXECUTE FUNCTION pg_temp.reject_grant_notice();
    DO $$ BEGIN
      BEGIN UPDATE public.funding_opportunities SET closes_at=NULL WHERE id='@opportunity';
        RAISE EXCEPTION 'Notice failure did not abort update'; EXCEPTION WHEN check_violation THEN NULL; END;
      PERFORM pg_temp.assert_grant((SELECT closes_at='2026-10-18T18:00:00.123456Z' FROM public.funding_opportunities WHERE id='@opportunity'),'Date committed without notice');
      PERFORM pg_temp.assert_grant((SELECT count(*)=2 FROM public.funding_opportunity_deadline_changes WHERE opportunity_id='@opportunity'),'Failed update left a journal row');
    END $$;
    DROP TRIGGER test_reject_grant_notice ON public.work_notifications;`));

  it("keeps actor unknown explicit and journals dates even without a current creator recipient", () => exercise(`
    SELECT set_config('request.jwt.claim.sub','',true);
    INSERT INTO public.funding_opportunities(id,workspace_id,title,created_by,closes_at) VALUES
      ('@unknown',pg_temp.grant_workspace(),'Unknown creator',NULL,'2026-10-20T00:00:00Z'),
      ('@departed',pg_temp.grant_workspace(),'Creator outside this workspace','@outsider','2026-10-20T00:00:00Z');
    UPDATE public.funding_opportunities SET decision_due_at=NULL WHERE id='@opportunity';
    DO $$ BEGIN
      PERFORM pg_temp.assert_grant(EXISTS(SELECT 1 FROM public.funding_opportunity_deadline_changes WHERE opportunity_id='@unknown' AND recipient_status='creator_unknown' AND actor_user_id IS NULL),'Unknown creator facts lost');
      PERFORM pg_temp.assert_grant(EXISTS(SELECT 1 FROM public.funding_opportunity_deadline_changes WHERE opportunity_id='@departed' AND recipient_status='creator_not_member'),'Departed creator facts lost');
      PERFORM pg_temp.assert_grant(NOT EXISTS(SELECT 1 FROM public.work_notifications WHERE subject_id IN ('@unknown','@departed')),'Invented recipient');
      PERFORM pg_temp.assert_grant(EXISTS(SELECT 1 FROM public.work_notifications WHERE subject_id='@opportunity' AND body LIKE '%Actor unknown.%'),'Null actor not explicit');
    END $$;`));

  it("enforces tenant and recipient reads, direct-write denial, safe read marking and scoped definer access", () => exercise(`
    DO $$ DECLARE caller text; writer text; n integer; w uuid:=pg_temp.grant_workspace(); BEGIN
      FOREACH caller IN ARRAY ARRAY['@creator','@viewer','@outsider'] LOOP
        PERFORM set_config('request.jwt.claim.sub',caller,true); SET LOCAL ROLE authenticated;
        SELECT count(*) INTO n FROM public.funding_opportunity_deadline_changes WHERE opportunity_id='@opportunity';
        PERFORM pg_temp.assert_grant(n=CASE WHEN caller='@outsider' THEN 0 WHEN caller='@viewer' THEN 3 ELSE 2 END,'Tenant journal read wrong');
        SELECT count(*) INTO n FROM public.work_notifications WHERE subject_id='@opportunity';
        PERFORM pg_temp.assert_grant(n=CASE WHEN caller='@creator' THEN 2 ELSE 0 END,'Recipient notice read wrong');
        IF caller='@creator' THEN
          UPDATE public.work_notifications SET is_read=true,read_at=now() WHERE subject_id='@opportunity';
          GET DIAGNOSTICS n=ROW_COUNT; PERFORM pg_temp.assert_grant(n=2,'Creator could not mark read');
          UPDATE public.funding_opportunities SET closes_at=NULL WHERE id='@opportunity';
          PERFORM pg_temp.assert_grant((SELECT count(*)=3 FROM public.funding_opportunity_deadline_changes WHERE opportunity_id='@opportunity'),'Authenticated writer was not captured');
        END IF;
        RESET ROLE;
      END LOOP;
      FOREACH writer IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
        PERFORM set_config('request.jwt.claim.sub','@creator',true); EXECUTE format('SET LOCAL ROLE %I',writer);
        BEGIN INSERT INTO public.funding_opportunity_deadline_changes(workspace_id,opportunity_id,deadline_field,old_at,new_at,opportunity_title,recipient_status)
          VALUES(w,'@opportunity','closes_at',NULL,now(),'Forged','creator_unknown');
          RAISE EXCEPTION 'Direct journal insert accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        BEGIN UPDATE public.funding_opportunity_deadline_changes SET old_at=NULL WHERE opportunity_id='@opportunity';
          RAISE EXCEPTION 'Direct journal update accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        BEGIN DELETE FROM public.funding_opportunity_deadline_changes WHERE opportunity_id='@opportunity';
          RAISE EXCEPTION 'Direct journal delete accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        PERFORM pg_temp.assert_grant(NOT has_function_privilege(current_user,'public.record_funding_opportunity_deadline_changes()','EXECUTE'),'Capture function exposed');
        RESET ROLE;
      END LOOP;
      SET LOCAL ROLE anon;
      BEGIN PERFORM 1 FROM public.funding_opportunity_deadline_changes; RAISE EXCEPTION 'Anon journal granted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      RESET ROLE;
      BEGIN UPDATE public.funding_opportunities SET workspace_id=(SELECT workspace_id FROM public.workspace_members WHERE user_id='@outsider' AND role='owner' LIMIT 1) WHERE id='@opportunity';
        RAISE EXCEPTION 'Tenant move accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
    END $$;`));
});
