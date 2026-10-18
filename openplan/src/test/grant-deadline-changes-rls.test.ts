import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
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
    const ids = Object.fromEntries(["creator", "outsider", "viewer", "opportunity", "unknown", "departed", "project", "award", "deliverable"].map((key) => [key, randomUUID()]));
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
      /@(creator|outsider|viewer|opportunity|unknown|departed|project|award|deliverable)/g, (_, key: string) => ids[key],
    );
    const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], {
      input: sql, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    });
    expect(output).toContain("GRANT_DEADLINE_ASSERTIONS_REACHED");
  }

  const awardFixture = `
    INSERT INTO public.projects(id,workspace_id,name) VALUES('@project',pg_temp.grant_workspace(),'Synthetic rollout project');
    INSERT INTO public.project_deliverables(id,project_id,title,due_date,status,assignee_user_id)
      VALUES('@deliverable','@project','Unrelated deliverable','2026-10-19','in_progress','@creator');
    INSERT INTO public.funding_awards(id,workspace_id,project_id,title,created_by,spending_status,obligation_due_at,expenditure_deadline_at)
      VALUES('@award',pg_temp.grant_workspace(),'@project','Same award','@creator','active','2026-10-19T01:30:00Z','2026-10-19T01:30:00Z');
    CREATE FUNCTION pg_temp.reminder_batch() RETURNS jsonb LANGUAGE sql AS $f$
      SELECT jsonb_agg(jsonb_build_object('workspace_id',pg_temp.grant_workspace(),'recipient_user_id','@creator',
        'kind',v.kind,'subject_table',v.subject_table,'subject_id',v.subject_id,'project_id','@project',
        'due_on','2026-10-19','title',v.title,'body','Synthetic '||v.kind))
      FROM (VALUES ('deliverable_due','project_deliverables','@deliverable','Unrelated deliverable'),
        ('award_obligation_due','funding_awards','@award','Same award'),
        ('award_expenditure_due','funding_awards','@award','Same award')) AS v(kind,subject_table,subject_id,title);
    $f$;`;

  function activationProposal() {
    return readFileSync(join(process.cwd(), "..", "docs/reviews/2026-10-18-grant-deadline-alerts/20261018000004_work_notification_kind_activation.sql"), "utf8")
      .replace(/^BEGIN;|^COMMIT;/gm, "");
  }

  it.each([
    [false, null], [false, "award_obligation_due"], [false, "award_expenditure_due"],
    [true, null], [true, "award_obligation_due"], [true, "award_expenditure_due"],
  ] as const)("classifies every same-award kind and unrelated deliverable, active=%s retained=%s", (active, retainedKind) => exercise(`
    ${awardFixture}
    DO $$ BEGIN
      IF ${retainedKind ? `'${retainedKind}'` : "NULL"} IS NOT NULL THEN
        INSERT INTO public.work_notifications(workspace_id,recipient_user_id,kind,subject_table,subject_id,project_id,due_on,title,body)
          VALUES(pg_temp.grant_workspace(),'@creator',${retainedKind ? `'${retainedKind}'` : "NULL"},'funding_awards','@award','@project','2026-10-19','Old title','Old body')
          ON CONFLICT(subject_table,subject_id,recipient_user_id,due_on) DO NOTHING;
      END IF;
    END $$;
    ${active ? activationProposal() : ""}
    SET LOCAL ROLE service_role;
    DO $$ DECLARE outcomes jsonb; repeated jsonb; BEGIN
      SELECT jsonb_agg(to_jsonb(r)) INTO outcomes FROM public.insert_work_notification_reminders(pg_temp.reminder_batch()) r;
      PERFORM pg_temp.assert_grant(jsonb_array_length(outcomes)=3,'Incomplete batch classification');
      PERFORM pg_temp.assert_grant((SELECT count(*)=3 FROM jsonb_array_elements(pg_temp.reminder_batch()) i
        JOIN jsonb_array_elements(outcomes) o ON o.value-ARRAY['classification','blocking_kind']=i.value),'Kinds, dates or request facts changed');
      PERFORM pg_temp.assert_grant((SELECT count(*)=${active ? (retainedKind ? 2 : 3) : (retainedKind ? 1 : 2)} FROM jsonb_array_elements(outcomes) r WHERE r->>'classification'='inserted'),'Wrong inserted count');
      PERFORM pg_temp.assert_grant((SELECT count(*)=${retainedKind ? 1 : 0} FROM jsonb_array_elements(outcomes) r WHERE r->>'classification'='duplicate'),'Same-kind duplicate misclassified');
      PERFORM pg_temp.assert_grant((SELECT count(*)=${active ? 0 : 1} FROM jsonb_array_elements(outcomes) r WHERE r->>'classification'='deferred_old_key'),'Opposite kind silently lost');
      PERFORM pg_temp.assert_grant(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(outcomes) r
        WHERE r->>'classification'='deferred_old_key' AND (r->>'subject_id'<>'@award' OR r->>'blocking_kind'=r->>'kind' OR r->>'blocking_kind' IS NULL)),'Deferred identity or blocker wrong');
      PERFORM pg_temp.assert_grant(EXISTS(SELECT 1 FROM public.work_notifications WHERE subject_id='@deliverable' AND kind='deliverable_due'),'Award collision aborted unrelated deliverable');
      PERFORM pg_temp.assert_grant((SELECT count(*)=${active ? 2 : 1} FROM public.work_notifications WHERE subject_id='@award'),'Wrong retained award kinds');
      SELECT jsonb_agg(to_jsonb(r)) INTO repeated FROM public.insert_work_notification_reminders(pg_temp.reminder_batch()) r;
      PERFORM pg_temp.assert_grant((SELECT count(*)=0 FROM jsonb_array_elements(repeated) r WHERE r->>'classification'='inserted'),'Retry inserts duplicates');
      PERFORM pg_temp.assert_grant((SELECT count(*)=${active ? 3 : 2} FROM jsonb_array_elements(repeated) r WHERE r->>'classification'='duplicate'),'Retry loses same-kind identity');
      PERFORM pg_temp.assert_grant((SELECT count(*)=${active ? 0 : 1} FROM jsonb_array_elements(repeated) r WHERE r->>'classification'='deferred_old_key'),'Retry hides deferral');
      PERFORM pg_temp.assert_grant((SELECT obligation_due_at='2026-10-19T01:30:00Z' AND expenditure_deadline_at=obligation_due_at AND spending_status='active' FROM public.funding_awards WHERE id='@award'),'Raw award deadlines changed');
      IF ${retainedKind ? `'${retainedKind}'` : "NULL"} IS NOT NULL THEN
        PERFORM pg_temp.assert_grant(EXISTS(SELECT 1 FROM public.work_notifications WHERE subject_id='@award'
          AND kind=${retainedKind ? `'${retainedKind}'` : "NULL"} AND title='Old title' AND body='Old body' AND due_on='2026-10-19'),'Old row rewritten');
      END IF;
    END $$;
    RESET ROLE;`));

  it("refuses invalid typed rows and rolls back unrelated inserts when classification evidence is missing", () => exercise(`
    ${awardFixture}
    CREATE FUNCTION pg_temp.suppress_rollout_expenditure() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN IF NEW.kind='award_expenditure_due' THEN RETURN NULL; END IF; RETURN NEW; END;
    $f$;
    CREATE TRIGGER test_rollout_suppression BEFORE INSERT ON public.work_notifications
      FOR EACH ROW EXECUTE FUNCTION pg_temp.suppress_rollout_expenditure();
    SET LOCAL ROLE service_role;
    DO $$ DECLARE valid jsonb; invalid jsonb; BEGIN
      SELECT jsonb_agg(r.value) INTO valid FROM jsonb_array_elements(pg_temp.reminder_batch()) r WHERE r.value->>'kind'<>'award_obligation_due';
      BEGIN
        PERFORM * FROM public.insert_work_notification_reminders(valid);
        RAISE EXCEPTION 'Missing classification accepted';
      EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.assert_grant(SQLERRM='work_reminder_classification_missing','Wrong classification refusal');
      END;
      PERFORM pg_temp.assert_grant(NOT EXISTS(SELECT 1 FROM public.work_notifications WHERE subject_id IN ('@award','@deliverable')),'Unrelated row committed after refusal');
      FOREACH invalid IN ARRAY ARRAY[
        jsonb_build_array((valid->0)-'kind'),
        jsonb_build_array(jsonb_set(valid->0,'{due_on}','null')),
        jsonb_build_array(jsonb_set(valid->0,'{due_on}','"2026-10-19T00:00:00Z"')),
        jsonb_build_array(jsonb_set(valid->0,'{kind}','"grant_deadline_changed"')),
        jsonb_build_array(jsonb_set(valid->0,'{body}','false')),
        jsonb_build_array(jsonb_set(valid->0,'{project_id}','42')),
        jsonb_build_array((valid->0)||jsonb_build_object('deadline_change_id','@opportunity')),
        jsonb_build_array(valid->0,valid->0)
      ] LOOP
        BEGIN PERFORM * FROM public.insert_work_notification_reminders(invalid); RAISE EXCEPTION 'Invalid row accepted';
        EXCEPTION WHEN check_violation THEN NULL; END;
      END LOOP;
      BEGIN
        PERFORM * FROM public.insert_work_notification_reminders(jsonb_build_array(jsonb_set(valid->0,'{subject_id}','"not-a-uuid"')));
        RAISE EXCEPTION 'Invalid UUID accepted';
      EXCEPTION WHEN invalid_text_representation THEN NULL; END;
    END $$;
    RESET ROLE;
    DROP TRIGGER test_rollout_suppression ON public.work_notifications;`));

  it("rolls back the full batch if an insert trigger changes a requested fact or the kind key is missing", () => exercise(`
    ${awardFixture}
    CREATE FUNCTION pg_temp.rewrite_rollout_body() RETURNS trigger LANGUAGE plpgsql AS $f$
      BEGIN NEW.body := 'Rewritten fact'; RETURN NEW; END;
    $f$;
    CREATE TRIGGER test_rollout_rewrite BEFORE INSERT ON public.work_notifications
      FOR EACH ROW EXECUTE FUNCTION pg_temp.rewrite_rollout_body();
    DO $$ BEGIN
      BEGIN PERFORM * FROM public.insert_work_notification_reminders(pg_temp.reminder_batch());
        RAISE EXCEPTION 'Changed inserted fact accepted';
      EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.assert_grant(SQLERRM='work_reminder_inserted_facts_changed','Wrong fact-change refusal');
      END;
      PERFORM pg_temp.assert_grant(NOT EXISTS(SELECT 1 FROM public.work_notifications WHERE subject_id IN ('@award','@deliverable')),'Fact-change refusal left rows');
    END $$;
    DROP TRIGGER test_rollout_rewrite ON public.work_notifications;
    DROP INDEX public.ux_work_notifications_subject_recipient_kind;
    DO $$ BEGIN
      BEGIN PERFORM * FROM public.insert_work_notification_reminders(pg_temp.reminder_batch());
        RAISE EXCEPTION 'Missing kind key accepted';
      EXCEPTION WHEN check_violation THEN
        PERFORM pg_temp.assert_grant(SQLERRM='work_reminder_kind_key_missing','Wrong missing-key refusal');
      END;
      PERFORM pg_temp.assert_grant(NOT EXISTS(SELECT 1 FROM public.work_notifications WHERE subject_id IN ('@award','@deliverable')),'Missing-key refusal left rows');
    END $$;`));

  it("keeps old and targeted writers idempotent after stage one without 42P10", () => exercise(`
    SET LOCAL ROLE service_role;
    DO $$ DECLARE conflict_columns text; BEGIN
      PERFORM pg_temp.assert_grant(public.work_notification_kind_activation()=false,'Stage one activated application reminders');
      FOREACH conflict_columns IN ARRAY ARRAY[
        'subject_table,subject_id,recipient_user_id,due_on',
        'subject_table,subject_id,recipient_user_id,due_on,kind',
        'subject_table,subject_id,recipient_user_id,due_on'
      ] LOOP
        EXECUTE 'INSERT INTO public.work_notifications
          (workspace_id,recipient_user_id,kind,subject_table,subject_id,due_on,title,body)
          VALUES (pg_temp.grant_workspace(),''@creator'',''grant_decision_due'',
            ''funding_opportunities'',''@opportunity'',''2026-10-18'',''Synthetic old writer'',''Retained reminder'')
          ON CONFLICT (' || conflict_columns || ') DO NOTHING';
      END LOOP;
      PERFORM pg_temp.assert_grant((SELECT count(*)=1 FROM public.work_notifications WHERE subject_id='@opportunity' AND due_on IS NOT NULL),'Old/bridge retries duplicated or lost reminders');
      PERFORM pg_temp.assert_grant((SELECT count(*)=2 FROM public.work_notifications WHERE subject_id='@opportunity' AND due_on IS NULL),'Old writer damaged event notices');
      PERFORM pg_temp.assert_grant((SELECT count(*)=1 AND bool_and(r.classification='duplicate' AND r.project_id IS NULL)
        FROM public.insert_work_notification_reminders(jsonb_build_array(jsonb_build_object(
          'workspace_id',pg_temp.grant_workspace(),'recipient_user_id','@creator','kind','grant_decision_due',
          'subject_table','funding_opportunities','subject_id','@opportunity','project_id',NULL,
          'due_on','2026-10-18','title','Synthetic old writer','body','Retained reminder'))) r),'Bridge lost old nullable-project duplicate');
      BEGIN
        INSERT INTO public.work_notifications(workspace_id,recipient_user_id,kind,subject_table,subject_id,due_on,title,body)
          VALUES(pg_temp.grant_workspace(),'@creator','grant_application_due','funding_opportunities','@opportunity','2026-10-18','Synthetic application','Same instant');
        RAISE EXCEPTION 'Stage one unexpectedly permits distinct-kind duplicate dates';
      EXCEPTION WHEN unique_violation THEN NULL; END;
    END $$;
    RESET ROLE;`));

  it("activates distinct same-instant kinds without breaking the bridge and records the old-writer rollback limit", () => {
    // Exercise the exact proposal inside this rollback-only fixture. It remains
    // outside migration up and does not write migration history.
    const proposal = activationProposal();
    exercise(`
      DO $$ BEGIN
        PERFORM pg_temp.assert_grant(public.work_notification_kind_activation()=false,'Expected stage one before proposal');
      END $$;
      INSERT INTO public.work_notifications(workspace_id,recipient_user_id,kind,subject_table,subject_id,due_on,title,body)
        VALUES(pg_temp.grant_workspace(),'@creator','grant_decision_due','funding_opportunities','@opportunity','2026-10-18','Synthetic decision','Retained decision')
        ON CONFLICT(subject_table,subject_id,recipient_user_id,due_on,kind) DO NOTHING;
      ${proposal}
      UPDATE public.funding_opportunities SET decision_due_at=closes_at WHERE id='@opportunity';
      DO $$ DECLARE attempt integer; BEGIN
        PERFORM pg_temp.assert_grant(public.work_notification_kind_activation()=true,'Proposal did not activate');
        PERFORM pg_temp.assert_grant((SELECT closes_at=decision_due_at FROM public.funding_opportunities WHERE id='@opportunity'),'Due instants differ');
        FOR attempt IN 1..2 LOOP
          INSERT INTO public.work_notifications(workspace_id,recipient_user_id,kind,subject_table,subject_id,due_on,title,body)
            VALUES(pg_temp.grant_workspace(),'@creator','grant_decision_due','funding_opportunities','@opportunity','2026-10-18','Synthetic decision','Retained decision'),
              (pg_temp.grant_workspace(),'@creator','grant_application_due','funding_opportunities','@opportunity','2026-10-18','Synthetic application','Same instant')
            ON CONFLICT(subject_table,subject_id,recipient_user_id,due_on,kind) DO NOTHING;
        END LOOP;
        PERFORM pg_temp.assert_grant((SELECT count(*)=2 AND count(DISTINCT kind)=2 AND count(DISTINCT due_on)=1 FROM public.work_notifications WHERE subject_id='@opportunity' AND due_on IS NOT NULL),'Active kinds collapsed or retries duplicated');
        PERFORM pg_temp.assert_grant((SELECT count(*)=3 FROM public.work_notifications WHERE subject_id='@opportunity' AND due_on IS NULL),'Activation damaged event notices');
        BEGIN
          INSERT INTO public.work_notifications(workspace_id,recipient_user_id,kind,subject_table,subject_id,due_on,title,body)
            VALUES(pg_temp.grant_workspace(),'@creator','grant_decision_due','funding_opportunities','@opportunity','2026-10-18','Unsupported old build','Old writer')
            ON CONFLICT(subject_table,subject_id,recipient_user_id,due_on) DO NOTHING;
          RAISE EXCEPTION 'Old writer unexpectedly supported after activation';
        EXCEPTION WHEN SQLSTATE '42P10' THEN NULL; END;
        BEGIN
          CREATE UNIQUE INDEX ux_work_notifications_subject_recipient
            ON public.work_notifications(subject_table,subject_id,recipient_user_id,due_on);
          RAISE EXCEPTION 'Four-column rollback unexpectedly preserves both kinds';
        EXCEPTION WHEN unique_violation THEN NULL; END;
        PERFORM pg_temp.assert_grant((SELECT count(*)=2 FROM public.work_notifications WHERE subject_id='@opportunity' AND due_on IS NOT NULL),'Rollback probe removed reminders');
      END $$;`);
  });

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
        PERFORM pg_temp.assert_grant(has_function_privilege(current_user,'public.work_notification_kind_activation()','EXECUTE')=(writer='service_role'),'Activation read privilege wrong');
        PERFORM pg_temp.assert_grant(has_function_privilege(current_user,'public.insert_work_notification_reminders(jsonb)','EXECUTE')=(writer='service_role'),'Batch RPC privilege wrong');
        IF writer='service_role' THEN
          PERFORM * FROM public.insert_work_notification_reminders('[]'::jsonb);
        ELSE
          BEGIN PERFORM * FROM public.insert_work_notification_reminders('[]'::jsonb);
            RAISE EXCEPTION 'Batch RPC client execution accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
        END IF;
        RESET ROLE;
      END LOOP;
      SET LOCAL ROLE anon;
      BEGIN PERFORM 1 FROM public.funding_opportunity_deadline_changes; RAISE EXCEPTION 'Anon journal granted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      RESET ROLE;
      BEGIN UPDATE public.funding_opportunities SET workspace_id=(SELECT workspace_id FROM public.workspace_members WHERE user_id='@outsider' AND role='owner' LIMIT 1) WHERE id='@opportunity';
        RAISE EXCEPTION 'Tenant move accepted'; EXCEPTION WHEN check_violation THEN NULL; END;
    END $$;`));
});
