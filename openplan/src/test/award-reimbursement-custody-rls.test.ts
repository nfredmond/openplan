import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";
import { resolveLocalDbContainer } from "./helpers/live-catalog";
import { blankComments, readMigration } from "./migrations/read-migrations";

/**
 * AWARD CLOSURE AND REIMBURSEMENT REQUEST CUSTODY, PROVED AGAINST POSTGRES
 * (KI-2026-11-16-130, -134 to -139; KL-2026-09-04-024).
 *
 * Lane 84's run-through (agent-run, local, November 16, 2026) closed a $1,000
 * award with no invoices by sending a PostgREST PATCH from a member's session
 * and again from an owner's. Both were accepted. This file sends the same
 * PATCH through the same Data API and expects the database to refuse it, then
 * closes the award the way the product does (the service-role close-out
 * command the routes call) and expects that to work.
 *
 * The request status rules are exercised as the workspace owner, who passes
 * every role rule, so the trigger is what refuses.
 *
 * BLIND CATEGORIES. These run against one local stack. They do not prove the
 * routes call the command (the route tests do), the hosted database's state,
 * or lock behavior under concurrent writers.
 *
 * Run with: npm run test:rls-live
 */

const CUSTODY = blankComments(readMigration("20261117000000_award_closure_custody.sql"));
const STATUS = blankComments(readMigration("20261117000100_reimbursement_request_status_custody.sql"));
const DATES = blankComments(readMigration("20261117000200_reimbursement_dates_and_numbers.sql"));

describe("award and request custody migrations declare what the live probe tests", () => {
  it("guards closure columns on every award, not only managed ones", () => {
    expect(CUSTODY).toMatch(/CREATE TRIGGER funding_award_closure_custody\s+BEFORE INSERT OR UPDATE ON public\.funding_awards/);
    expect(CUSTODY).toMatch(/current_setting\('openplan\.award_closure_command', true\) = NEW\.id::text/);
    expect(CUSTODY).not.toMatch(/latest_handoff_revision_id IS NOT NULL THEN\s+IF ROW\(NEW\.closure_basis/);
  });

  it("keeps the close-out command off the Data API", () => {
    expect(CUSTODY).toMatch(/REVOKE ALL ON FUNCTION public\.funding_award_closeout_command\([^)]*\) FROM PUBLIC, anon, authenticated;/);
    expect(CUSTODY).toMatch(/GRANT EXECUTE ON FUNCTION public\.funding_award_closeout_command\([^)]*\) TO service_role;/);
  });

  it("creates requests as drafts and checks every writer", () => {
    expect(STATUS).toMatch(/CREATE TRIGGER reimbursement_request_status_custody\s+BEFORE INSERT OR UPDATE ON public\.billing_invoice_records/);
    expect(STATUS).toMatch(/IF NEW\.status IS DISTINCT FROM 'draft' THEN/);
  });

  it("indexes one request number per award without regard to case", () => {
    expect(DATES).toMatch(/ON public\.billing_invoice_records \(funding_award_id, lower\(invoice_number\)\)\s+WHERE funding_award_id IS NOT NULL/);
  });
});

const liveDescribe = LIVE_RLS ? describe : describe.skip;

type Row = Record<string, unknown>;

liveDescribe("award and request custody, live", () => {
  let service: SupabaseClient;
  let owner: SupabaseClient;
  let member: SupabaseClient;
  let outsider: SupabaseClient;

  const password = "OpenPlanAwardCustody!2026";
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const projectId = randomUUID();
  const ids = { owner: "", member: "", outsider: "" };
  const today = new Date().toISOString().slice(0, 10);

  const insert = async (table: string, row: Row) => {
    const { data, error } = await service.from(table).insert(row).select("id").single();
    if (error || !data) throw new Error(`Failed to seed ${table}: ${error?.message ?? "no row"}`);
    return data.id as string;
  };

  const award = (title: string, awarded: number) =>
    insert("funding_awards", {
      workspace_id: workspaceId,
      project_id: projectId,
      title: `${title} ${suffix}`,
      awarded_amount: awarded,
      spending_status: "active",
    });

  const readAward = async (id: string) => {
    const { data, error } = await service.from("funding_awards").select("*").eq("id", id).single();
    if (error || !data) throw new Error(`Failed to read award: ${error?.message ?? "missing"}`);
    return data as Row;
  };

  const request = async (awardId: string, invoiceNumber: string, amount: number, extra: Row = {}) => {
    const { data, error } = await owner
      .from("billing_invoice_records")
      .insert({ workspace_id: workspaceId, project_id: projectId, funding_award_id: awardId, invoice_number: invoiceNumber, amount, net_amount: amount, ...extra })
      .select("id")
      .single();
    if (error || !data) throw new Error(`Failed to log request ${invoiceNumber}: ${error?.message ?? "no row"}`);
    return data.id as string;
  };

  const move = (id: string, patch: Row) => owner.from("billing_invoice_records").update(patch).eq("id", id).select("id, status, paid_date, rejection_reason");

  const pay = async (id: string) => {
    for (const patch of [{ status: "submitted" }, { status: "approved_for_payment" }, { status: "paid", paid_date: today }]) {
      const { error } = await move(id, patch);
      if (error) throw new Error(`Failed to move request: ${error.message}`);
    }
  };

  const command = (awardId: string, event: string, note: string | null, actor = ids.member, reopen: string | null = null) =>
    service.rpc("funding_award_closeout_command", {
      p_actor: actor,
      p_award: awardId,
      p_event: event,
      p_note: note,
      p_calendar_date: today,
      p_reopen_spending_status: reopen,
    });

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "openplan-award-custody-service");
    owner = liveClient(env.API_URL, env.ANON_KEY, "openplan-award-custody-owner");
    member = liveClient(env.API_URL, env.ANON_KEY, "openplan-award-custody-member");
    outsider = liveClient(env.API_URL, env.ANON_KEY, "openplan-award-custody-outsider");

    for (const [role, client] of [["owner", owner], ["member", member], ["outsider", outsider]] as const) {
      const email = `award-custody-${role}-${suffix}@example.test`;
      const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error || !created.data.user) throw new Error(`Failed to create ${role}: ${created.error?.message}`);
      ids[role] = created.data.user.id;
      const signed = await client.auth.signInWithPassword({ email, password });
      if (signed.error) throw new Error(`Failed to sign in ${role}: ${signed.error.message}`);
    }

    await insert("workspaces", { id: workspaceId, name: `Award custody ${suffix}`, slug: `award-custody-${suffix}` });
    await insert("workspaces", { id: otherWorkspaceId, name: `Award custody other ${suffix}`, slug: `award-custody-other-${suffix}` });
    for (const [user, role, workspace] of [
      [ids.owner, "owner", workspaceId],
      [ids.member, "member", workspaceId],
      [ids.outsider, "owner", otherWorkspaceId],
    ] as const) {
      const { error } = await service.from("workspace_members").insert({ workspace_id: workspace, user_id: user, role });
      if (error) throw new Error(`Failed to add ${role}: ${error.message}`);
    }
    await insert("projects", { id: projectId, workspace_id: workspaceId, name: `Synthetic corridor ${suffix}` });
  });

  afterAll(async () => {
    if (!service) return;
    // Requests reference each other and their awards, so the workspace cascade
    // removes them together.
    await service.from("workspaces").delete().in("id", [workspaceId, otherWorkspaceId]);
    for (const id of Object.values(ids)) if (id) await service.auth.admin.deleteUser(id);
  });

  it("refuses the member's and the owner's closing PATCH, as lane 84 sent it", async () => {
    for (const [label, client] of [["member", member], ["owner", owner]] as const) {
      const probe = await award(`Probe ${label}`, 1000);
      const { data, error } = await client
        .from("funding_awards")
        .update({ spending_status: "fully_spent", closure_basis: "earned_coverage", closed_at: new Date().toISOString() })
        .eq("id", probe)
        .select("id");
      expect(error?.code, `${label} PATCH was not refused: ${JSON.stringify(data)}`).toBe("23514");
      expect(error?.message).toContain("Award closure changes only through the close-out");
      const after = await readAward(probe);
      expect([after.spending_status, after.closure_basis, after.closed_at]).toEqual(["active", null, null]);
    }
  });

  it("refuses every closure column on its own, and a service-role write that skips the command", async () => {
    const probe = await award("Columns", 1000);
    for (const patch of [
      { closure_note: "Typed in" },
      { closed_at: new Date().toISOString() },
      { closed_by: ids.owner },
      { closure_released_amount: 10 },
      { reopened_at: new Date().toISOString(), reopen_reason: "Typed in" },
    ]) {
      const { error } = await owner.from("funding_awards").update(patch).eq("id", probe).select("id");
      expect(error?.code, JSON.stringify(patch)).toBe("23514");
    }
    const direct = await service
      .from("funding_awards")
      .update({ spending_status: "fully_spent", closure_basis: "recorded_on_import", closure_note: "Service write" })
      .eq("id", probe)
      .select("id");
    expect(direct.error?.code).toBe("23514");
  });

  it("still lets a member make an ordinary edit, and keeps another workspace out", async () => {
    const probe = await award("Edit", 1000);
    const edit = await member.from("funding_awards").update({ spending_status: "delayed", obligated_on: "2026-03-01" }).eq("id", probe).select("id");
    expect(edit.error).toBeNull();
    expect(edit.data).toHaveLength(1);
    const foreign = await outsider.from("funding_awards").update({ notes: "Outsider" }).eq("id", probe).select("id");
    expect(foreign.error).toBeNull();
    expect(foreign.data).toHaveLength(0);
  });

  it("keeps the close-out command off the Data API", async () => {
    const probe = await award("Rpc", 1000);
    const { error } = await member.rpc("funding_award_closeout_command", {
      p_actor: ids.member,
      p_award: probe,
      p_event: "recorded_on_import",
      p_note: "Member called the command directly",
      p_calendar_date: today,
      p_reopen_spending_status: null,
    });
    expect(error).not.toBeNull();
    expect((await readAward(probe)).spending_status).toBe("active");
    const outsiderCommand = await command(probe, "recorded_on_import", "Outsider actor", ids.outsider);
    expect(outsiderCommand.error?.code).toBe("42501");
  });

  it("closes an award earned through the product's command, files the milestone and reopens it", async () => {
    const earned = await award("Earned", 1000);
    const paid = await request(earned, `E-${suffix}-1`, 1000);
    await pay(paid);

    const closed = await command(earned, "earned_coverage", null);
    expect(closed.error).toBeNull();
    expect(closed.data).toMatchObject({ status: "closed", closureBasis: "earned_coverage", paid: "1000.00", milestoneFiled: true });
    const row = await readAward(earned);
    expect([row.spending_status, row.closure_basis, row.closed_by]).toEqual(["fully_spent", "earned_coverage", ids.member]);
    const milestones = await service.from("project_milestones").select("milestone_type, actual_date").eq("funding_award_id", earned).eq("milestone_type", "closeout");
    expect(milestones.data).toEqual([{ milestone_type: "closeout", actual_date: today }]);
    expect(closed.data).toMatchObject({ basis: { paid: "1000.00", ceiling: "1000.00", openRequests: 0 } });
    // No receipt row: an ordinary closed award must stay deletable with its project.
    const receipts = await service.from("funding_award_closure_receipts").select("id").eq("award_id", earned);
    expect(receipts.data).toEqual([]);

    const again = await command(earned, "earned_coverage", null);
    expect(again.data).toMatchObject({ status: "already_closed" });

    const blankReopen = await command(earned, "reopen", " ", ids.owner, "active");
    expect(blankReopen.error?.code).toBe("22023");
    const reopened = await command(earned, "reopen", "Funder de-obligated part of the award", ids.owner, "delayed");
    expect(reopened.error).toBeNull();
    const back = await readAward(earned);
    expect([back.spending_status, back.closure_basis, back.closed_at, back.reopen_reason]).toEqual(["delayed", null, null, "Funder de-obligated part of the award"]);
  });

  it("refuses close-out while any linked request is open, whichever basis is asked for", async () => {
    const open = await award("Open", 1000);
    await pay(await request(open, `O-${suffix}-1`, 1000));
    await request(open, `O-${suffix}-2`, 50);
    for (const [event, note] of [["earned_coverage", null], ["reconciled_with_balance", "Finished early"], ["recorded_on_import", "Closed elsewhere"]] as const) {
      const refused = await command(open, event, note);
      expect(refused.error?.code, event).toBe("22023");
      expect(refused.error?.message).toContain("still open");
    }
    expect((await readAward(open)).spending_status).toBe("active");
  });

  it("asks for a stated basis when paid exceeds the ceiling", async () => {
    const over = await award("Over", 1000);
    await pay(await request(over, `V-${suffix}-1`, 1500));
    const silent = await command(over, "earned_coverage", null);
    expect(silent.error?.code).toBe("22023");
    expect(silent.error?.message).toContain("exceed the award ceiling");
    const stated = await command(over, "earned_coverage", "Amendment 1 raised the ceiling to $1,500");
    expect(stated.error).toBeNull();
    expect((await readAward(over)).closure_note).toBe("Amendment 1 raised the ceiling to $1,500");
  });

  it("closes an award that finished under its ceiling with the balance released", async () => {
    const under = await award("Under", 1000);
    await pay(await request(under, `U-${suffix}-1`, 400));
    const rejected = await request(under, `U-${suffix}-2`, 100);
    await move(rejected, { status: "submitted" });
    await move(rejected, { status: "rejected", rejection_reason: "Missing timesheets" });

    expect((await command(under, "earned_coverage", null)).error?.message).toContain("below the award ceiling");
    expect((await command(under, "reconciled_with_balance", null)).error?.code).toBe("22023");
    const reconciled = await command(under, "reconciled_with_balance", "Project finished under budget; remainder returned");
    expect(reconciled.error).toBeNull();
    expect(reconciled.data).toMatchObject({ closureBasis: "reconciled_with_balance", paid: "400.00", released: "600.00", milestoneFiled: true });
    const row = await readAward(under);
    expect([row.closure_basis, Number(row.closure_released_amount)]).toEqual(["reconciled_with_balance", 600]);
  });

  it("records an imported closure only with a written basis, and files no milestone", async () => {
    const imported = await award("Imported", 1000);
    expect((await command(imported, "recorded_on_import", "  ")).error?.code).toBe("22023");
    const ok = await command(imported, "recorded_on_import", "Closed in 2019; requests kept on paper");
    expect(ok.error).toBeNull();
    expect(ok.data).toMatchObject({ closureBasis: "recorded_on_import", milestoneFiled: false });
  });

  it("creates every request as a draft and moves it forward only", async () => {
    const statusAward = await award("Status", 5000);
    const born = await owner
      .from("billing_invoice_records")
      .insert({ workspace_id: workspaceId, project_id: projectId, funding_award_id: statusAward, invoice_number: `S-${suffix}-0`, amount: 10, net_amount: 10, status: "paid" })
      .select("id");
    expect(born.error?.code).toBe("23514");

    const id = await request(statusAward, `S-${suffix}-1`, 100);
    expect((await move(id, { status: "paid", paid_date: today })).error?.code).toBe("23514");
    expect((await move(id, { status: "rejected", rejection_reason: "Too early" })).error?.code).toBe("23514");
    expect((await move(id, { status: "submitted" })).error).toBeNull();
    expect((await move(id, { status: "internal_review" })).error?.code).toBe("23514");
    expect((await move(id, { status: "paid", paid_date: today })).error?.code).toBe("23514");
    expect((await move(id, { status: "approved_for_payment" })).error).toBeNull();
    expect((await move(id, { status: "paid" })).error?.code).toBe("23514");
    expect((await move(id, { status: "paid", paid_date: "2999-01-01" })).error?.code).toBe("23514");
    expect((await move(id, { status: "paid", paid_date: today })).error).toBeNull();
    expect((await move(id, { status: "draft" })).error?.code).toBe("23514");
    expect((await move(id, { paid_date: "2026-01-01" })).error?.code).toBe("23514");
    const memberWrite = await member.from("billing_invoice_records").update({ status: "draft" }).eq("id", id).select("id");
    expect(memberWrite.data ?? []).toHaveLength(0);
  });

  it("rejects with a reason, keeps the rejection final and links one resubmission", async () => {
    const resubmitAward = await award("Resubmit", 5000);
    const otherAward = await award("Other", 5000);
    const original = await request(resubmitAward, `INV-${suffix}-2`, 450);
    await move(original, { status: "submitted" });
    expect((await move(original, { status: "rejected" })).error?.code).toBe("23514");
    expect((await move(original, { status: "rejected", rejection_reason: "Returned: revise the date" })).error).toBeNull();
    expect((await move(original, { status: "submitted" })).error?.code).toBe("23514");

    const pending = await request(resubmitAward, `INV-${suffix}-3`, 10);
    const notRejected = await owner
      .from("billing_invoice_records")
      .insert({ workspace_id: workspaceId, project_id: projectId, funding_award_id: resubmitAward, invoice_number: `INV-${suffix}-3A`, amount: 10, net_amount: 10, resubmits_invoice_id: pending })
      .select("id");
    expect(notRejected.error?.code).toBe("23514");
    const wrongAward = await owner
      .from("billing_invoice_records")
      .insert({ workspace_id: workspaceId, project_id: projectId, funding_award_id: otherAward, invoice_number: `INV-${suffix}-2A`, amount: 450, net_amount: 450, resubmits_invoice_id: original })
      .select("id");
    expect(wrongAward.error?.code).toBe("23514");

    const resubmission = await request(resubmitAward, `INV-${suffix}-2A`, 450, { resubmits_invoice_id: original });
    const second = await owner
      .from("billing_invoice_records")
      .insert({ workspace_id: workspaceId, project_id: projectId, funding_award_id: resubmitAward, invoice_number: `INV-${suffix}-2B`, amount: 450, net_amount: 450, resubmits_invoice_id: original })
      .select("id");
    expect(second.error?.code).toBe("23505");
    const relink = await owner.from("billing_invoice_records").update({ funding_award_id: otherAward }).eq("id", resubmission).select("id");
    expect(relink.error?.code).toBe("23514");
    const unlinkOriginal = await owner.from("billing_invoice_records").update({ funding_award_id: null }).eq("id", original).select("id");
    expect(unlinkOriginal.error?.code).toBe("23514");
  });

  it("refuses a second request with the same number on one award, in any case", async () => {
    const numbered = await award("Numbers", 5000);
    await request(numbered, `E-DUP-${suffix}`, 700);
    const twin = await owner
      .from("billing_invoice_records")
      .insert({ workspace_id: workspaceId, project_id: projectId, funding_award_id: numbered, invoice_number: `e-dup-${suffix}`, amount: 700, net_amount: 700 })
      .select("id");
    expect(twin.error?.code).toBe("23505");
    const otherAward = await award("Numbers other", 5000);
    await request(otherAward, `E-DUP-${suffix}`, 700);
  });
});

/**
 * Cascades the guards must let through, and the harness case: with the
 * trigger dropped inside a rolled-back transaction, the closing PATCH that
 * lane 84 sent goes through, so the refusal above is the trigger's.
 */
(LIVE_RLS ? describe : describe.skip)("award and request custody, inside one rolled-back transaction", () => {
  let container: string;
  beforeAll(() => {
    if (process.env.GITHUB_ACTIONS !== "true" && !isAbsolute(process.env.OPENPLAN_SUPABASE_WORKDIR ?? "")) {
      throw new Error("Select an explicit isolated Supabase workdir.");
    }
    container = resolveLocalDbContainer();
  });

  function exercise(body: string, before = "") {
    const sql = `BEGIN; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='2s';
${before}
DO $test$ DECLARE
 owner_id uuid:=gen_random_uuid(); closer uuid:=gen_random_uuid(); workspace uuid:=gen_random_uuid(); project uuid:=gen_random_uuid();
 award uuid:=gen_random_uuid(); rejected uuid:=gen_random_uuid(); resubmitted uuid:=gen_random_uuid(); n integer;
BEGIN
 INSERT INTO auth.users(id,email) VALUES(owner_id,owner_id||'@example.test'),(closer,closer||'@example.test');
 INSERT INTO public.workspaces(id,name,slug) VALUES(workspace,'Synthetic custody',workspace::text);
 INSERT INTO public.workspace_members(workspace_id,user_id,role) VALUES(workspace,owner_id,'owner'),(workspace,closer,'member');
 INSERT INTO public.projects(id,workspace_id,name) VALUES(project,workspace,'Synthetic corridor');
 INSERT INTO public.funding_awards(id,workspace_id,project_id,title,awarded_amount,spending_status) VALUES(award,workspace,project,'Synthetic award',100,'active');
 ${body}
END $test$;
SELECT 'AWARD_CUSTODY_ASSERTIONS_REACHED'; ROLLBACK;`;
    return spawnSync("docker", ["exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", "postgres", "-qAt", "-v", "ON_ERROR_STOP=1"], {
      input: sql,
      encoding: "utf8",
      timeout: 20000,
    });
  }

  const asMember = `PERFORM set_config('request.jwt.claim.sub',closer::text,true); EXECUTE 'SET LOCAL ROLE authenticated';`;
  const closingPatch = `UPDATE public.funding_awards SET spending_status='fully_spent',closure_basis='earned_coverage',closed_at=now() WHERE id=award;`;

  it("lets an account deletion clear the closer, and an award deletion clear a resubmission's award", () => {
    const result = exercise(`
 PERFORM set_config('openplan.award_closure_command',award::text,true);
 UPDATE public.funding_awards SET spending_status='fully_spent',closure_basis='recorded_on_import',closure_note='Closed elsewhere',closed_at=now(),closed_by=closer WHERE id=award;
 PERFORM set_config('openplan.award_closure_command','',true);
 -- A new auth user owns a personal workspace; remove it so the owner floor allows the deletion.
 DELETE FROM public.workspaces WHERE id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id=closer AND role='owner');
 DELETE FROM auth.users WHERE id=closer;
 IF (SELECT closed_by FROM public.funding_awards WHERE id=award) IS NOT NULL THEN RAISE EXCEPTION 'Closer was not cleared'; END IF;
 BEGIN UPDATE public.funding_awards SET closed_by=owner_id WHERE id=award; RAISE EXCEPTION 'Closer rewritten'; EXCEPTION WHEN check_violation THEN NULL; END;
 INSERT INTO public.funding_awards(id,workspace_id,project_id,title,awarded_amount) VALUES(gen_random_uuid(),workspace,project,'Second award',100);
 INSERT INTO public.billing_invoice_records(id,workspace_id,project_id,funding_award_id,invoice_number,amount) VALUES(rejected,workspace,project,(SELECT id FROM public.funding_awards WHERE title='Second award' AND workspace_id=workspace),'R-1',10);
 UPDATE public.billing_invoice_records SET status='submitted' WHERE id=rejected;
 UPDATE public.billing_invoice_records SET status='rejected',rejection_reason='Returned' WHERE id=rejected;
 INSERT INTO public.billing_invoice_records(id,workspace_id,project_id,funding_award_id,invoice_number,amount,resubmits_invoice_id) VALUES(resubmitted,workspace,project,(SELECT id FROM public.funding_awards WHERE title='Second award' AND workspace_id=workspace),'R-1A',10,rejected);
 DELETE FROM public.funding_awards WHERE title='Second award' AND workspace_id=workspace;
 SELECT count(*) INTO n FROM public.billing_invoice_records WHERE id IN (rejected,resubmitted) AND funding_award_id IS NULL;
 IF n<>2 THEN RAISE EXCEPTION 'Award deletion did not clear both links'; END IF;`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("AWARD_CUSTODY_ASSERTIONS_REACHED");
  });

  it("refuses the closing PATCH from an authenticated session with the trigger in place", () => {
    const result = exercise(`${asMember}
 BEGIN ${closingPatch} RAISE EXCEPTION 'Closing PATCH accepted'; EXCEPTION WHEN check_violation THEN NULL; END;`);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("AWARD_CUSTODY_ASSERTIONS_REACHED");
  });

  it("harness: with the custody trigger dropped, the same PATCH goes through", () => {
    const result = exercise(`${asMember}
 ${closingPatch} GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>1 THEN RAISE EXCEPTION 'Harness did not reach the row'; END IF;`, "DROP TRIGGER funding_award_closure_custody ON public.funding_awards;");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("AWARD_CUSTODY_ASSERTIONS_REACHED");
  });

  it("harness: with the request trigger dropped, a request is born paid", () => {
    const result = exercise(`
 INSERT INTO public.billing_invoice_records(workspace_id,project_id,funding_award_id,invoice_number,amount,status,paid_date) VALUES(workspace,project,award,'P-1',10,'paid',current_date);`,
      "DROP TRIGGER reimbursement_request_status_custody ON public.billing_invoice_records;");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("AWARD_CUSTODY_ASSERTIONS_REACHED");
  });
});
