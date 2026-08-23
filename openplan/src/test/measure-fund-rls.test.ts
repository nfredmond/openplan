import { randomUUID } from "node:crypto";
import { type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";
import { blankComments, migrationFiles, readMigration } from "./migrations/read-migrations";

/**
 * THE MEASURE FUND'S TWO LOAD-BEARING DENIALS, PROVED AGAINST POSTGRES.
 *
 * `local-measure-fund-migration.test.ts` proves the migrations DECLARE the
 * boundary. That is a statement about a file. These tables entered
 * `PROBE_EXCUSED_TABLES` in `rls-isolation.test.ts` with an honest note saying
 * the live proof was still owed, and the 2026-08-16 review named the gap: the
 * only thing standing between this boundary and a defect was prose promising a
 * probe somebody had yet to write. This is that probe.
 *
 * WHAT IS AT STAKE, so the assertions below are read as more than tidiness.
 * These rows are a public fund's arithmetic: what an ordinance holds back
 * before anything is apportioned, and what each recipient claimed. They are
 * summed into a fiscal-year cap and onto a public oversight page a citizens'
 * committee reads. A forged or cross-tenant row does not corrupt a list — it
 * changes a published number that says where public money went.
 *
 * TWO QUESTIONS, neither of which the census can ask:
 *
 *   1. CAN A SUBMITTED CLAIM BE DELETED? `measure_claims_delete` is
 *      `workspace_member_can_write(workspace_id) AND status = 'draft'`, so a
 *      claim that has been submitted must be undeletable BY ANYONE — including
 *      the workspace owner, the highest role there is. A static guard proves
 *      that predicate was written; only Postgres can say it is enforced.
 *
 *   2. CAN A CHILD BE PARENTED ACROSS TENANTS? These rows denormalize
 *      `workspace_id` and reach their parent through a COMPOSITE foreign key
 *      into `(id, workspace_id)`. That constraint is the whole reason a member
 *      of one workspace cannot attach a period — or an off-the-top deduction —
 *      to another workspace's fund while carrying their own workspace_id past
 *      the INSERT policy. A guard reading the migration can prove the
 *      constraint was declared. It cannot prove the database refuses the row.
 *
 * The census entry in `rls-isolation.test.ts` stays and now points here, the
 * same way the extraction staging tables' entry points at
 * `rtp-extraction-rls.test.ts`.
 *
 * Run with: npm run test:rls-live
 */

/**
 * THE OFFLINE HALF, so this file is never a no-op.
 *
 * Without it, a checkout with no local Supabase stack runs a file that asserts
 * nothing and reports two skips — and a skipped file is indistinguishable from
 * a passing one at a glance. These read the migration corpus and pin the two
 * declarations the live half exists to prove Postgres actually enforces. If one
 * of them is ever deleted, this fails everywhere rather than only where a
 * database happens to be running.
 */
describe("the measure fund declares the boundary the live probe tests", () => {
  const corpus = migrationFiles()
    .map((name) => blankComments(readMigration(name)))
    .join("\n");

  it("declares the draft-only delete on measure_claims", () => {
    expect(
      /CREATE POLICY measure_claims_delete[\s\S]{0,400}?status\s*=\s*'draft'/.test(corpus),
      "measure_claims' DELETE policy no longer restricts to draft — a submitted claim would become deletable"
    ).toBe(true);
  });

  it("declares composite foreign keys into (id, workspace_id)", () => {
    // The constraint that stops a child being parented across tenants while
    // carrying its own workspace_id past the INSERT policy. Matched on the
    // constraint NAME plus its two halves, because the declaration spans three
    // lines and `public.` is optional in the reference.
    for (const [constraint, parent] of [
      ["measure_fund_periods_fund_fk", "measure_funds"],
      ["measure_period_off_the_top_period_fk", "measure_fund_periods"],
    ] as const) {
      const at = corpus.indexOf(`CONSTRAINT ${constraint}`);
      expect(at, `${constraint} is not declared anywhere`).toBeGreaterThan(-1);

      const declaration = corpus.slice(at, at + 240);
      expect(
        /FOREIGN KEY \([a-z_]+, workspace_id\)/.test(declaration),
        `${constraint} no longer carries workspace_id in its key`
      ).toBe(true);
      expect(
        new RegExp(`REFERENCES (?:public\\.)?${parent} ?\\(id, workspace_id\\)`).test(declaration),
        `${constraint} no longer references ${parent}(id, workspace_id)`
      ).toBe(true);
    }
  });
});

const liveDescribe = LIVE_RLS ? describe : describe.skip;

liveDescribe("the measure fund's boundary, live", () => {
  let service: SupabaseClient;
  let owner: SupabaseClient;

  const password = "OpenPlanMeasure!2026";
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);

  const workspaceAId = randomUUID();
  const workspaceBId = randomUUID();
  const programAId = randomUUID();
  const programBId = randomUUID();
  const fundAId = randomUUID();
  const fundBId = randomUUID();
  const periodAId = randomUUID();
  const periodBId = randomUUID();
  const recipientAId = randomUUID();
  const draftClaimId = randomUUID();
  const submittedClaimId = randomUUID();

  let userId = "";

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "openplan-measure-service");
    owner = liveClient(env.API_URL, env.ANON_KEY, "openplan-measure-owner");

    const email = `measure-rls-${suffix}@example.test`;
    const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) {
      throw new Error(`Failed to create probe user: ${created.error?.message ?? "missing user"}`);
    }
    userId = created.data.user.id;

    const mustInsert = async (table: string, row: Record<string, unknown>) => {
      const { error } = await service.from(table).insert(row);
      if (error) throw new Error(`Failed to seed ${table}: ${error.message}`);
    };

    for (const [workspaceId, slug] of [
      [workspaceAId, `measure-a-${suffix}`],
      [workspaceBId, `measure-b-${suffix}`],
    ] as const) {
      await mustInsert("workspaces", { id: workspaceId, name: `Measure ${slug}`, slug });
    }

    // OWNER of A, and no member of B at all. Owner rather than viewer on
    // purpose: the denials below must hold for the person who can do everything
    // else in the workspace, or they are not boundaries.
    await mustInsert("workspace_members", { workspace_id: workspaceAId, user_id: userId, role: "owner" });

    for (const [programId, workspaceId] of [
      [programAId, workspaceAId],
      [programBId, workspaceBId],
    ] as const) {
      await mustInsert("programs", {
        id: programId,
        workspace_id: workspaceId,
        title: `Measure program ${suffix}`,
        program_type: "local_measure",
        cycle_name: "FY26",
      });
    }

    for (const [fundId, programId, workspaceId] of [
      [fundAId, programAId, workspaceAId],
      [fundBId, programBId, workspaceBId],
    ] as const) {
      await mustInsert("measure_funds", {
        id: fundId,
        workspace_id: workspaceId,
        program_id: programId,
        receipt_cadence: "quarterly",
        currency_code: "USD",
      });
    }

    for (const [periodId, fundId, workspaceId] of [
      [periodAId, fundAId, workspaceAId],
      [periodBId, fundBId, workspaceBId],
    ] as const) {
      await mustInsert("measure_fund_periods", {
        id: periodId,
        workspace_id: workspaceId,
        measure_fund_id: fundId,
        period_label: `Q1 ${suffix}`,
        fiscal_year_label: "FY26",
        period_start: "2026-07-01",
        period_end: "2026-09-30",
      });
    }

    await mustInsert("measure_recipients", {
      id: recipientAId,
      workspace_id: workspaceAId,
      measure_fund_id: fundAId,
      name: `City of Example ${suffix}`,
    });

    const claim = (id: string, status: string) => ({
      id,
      workspace_id: workspaceAId,
      measure_fund_id: fundAId,
      recipient_id: recipientAId,
      period_id: periodAId,
      fiscal_year_label: "FY26",
      category_id: "streets",
      amount: "125000.00",
      status,
      ...(status === "draft" ? {} : { submitted_on: "2026-08-01" }),
    });

    await mustInsert("measure_claims", claim(draftClaimId, "draft"));
    await mustInsert("measure_claims", claim(submittedClaimId, "submitted"));

    const signIn = await owner.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`Failed to sign in probe owner: ${signIn.error.message}`);
  }, 90_000);

  /**
   * Signing up fires `on_auth_user_created`, which provisions a PERSONAL
   * workspace too — so deleting only the two this test knows about leaves the
   * user undeletable and the account behind. Delete by membership.
   */
  afterAll(async () => {
    await owner?.auth.signOut();
    if (!service || !userId) return;

    const { data: memberships } = await service
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId);
    for (const row of (memberships ?? []) as { workspace_id: string }[]) {
      await service.from("workspaces").delete().eq("id", row.workspace_id);
    }
    for (const workspaceId of [workspaceAId, workspaceBId]) {
      await service.from("workspaces").delete().eq("id", workspaceId);
    }

    const removed = await service.auth.admin.deleteUser(userId);
    if (removed.error) {
      throw new Error(`Measure probe left user ${userId} behind: ${removed.error.message}`);
    }
  }, 90_000);

  describe("a submitted claim", () => {
    it("cannot be deleted, even by the workspace owner", async () => {
      const { data, error } = await owner
        .from("measure_claims")
        .delete()
        .eq("id", submittedClaimId)
        .select("id");

      // A DELETE whose USING clause matches nothing reports success over zero
      // rows, so the row itself is what has to be re-read.
      expect(error).toBeNull();
      expect(data ?? []).toEqual([]);

      const { count } = await service
        .from("measure_claims")
        .select("id", { count: "exact", head: true })
        .eq("id", submittedClaimId);
      expect(count, "a submitted claim was deleted").toBe(1);
    });

    /*
      THE CONTROL. Without it this suite would pass just as happily against a
      database where deleting a claim is simply broken for everyone — which
      would prove nothing about the `status = 'draft'` half of the policy.
    */
    it("is the only kind that cannot — a DRAFT claim deletes", async () => {
      const { data, error } = await owner
        .from("measure_claims")
        .delete()
        .eq("id", draftClaimId)
        .select("id");

      expect(error).toBeNull();
      expect(data?.map((row) => row.id)).toEqual([draftClaimId]);
    });
  });

  describe("the composite foreign key", () => {
    it("refuses a period parented to another workspace's fund", async () => {
      // workspace_id is the caller's OWN — so the INSERT policy is satisfied —
      // while the parent belongs to workspace B. Only the composite key into
      // (id, workspace_id) stands between this row and the other agency's fund.
      // A DISTINCT period_start, and that is not cosmetic. The first version
      // reused the seeded date, which collides with workspace B's own period on
      // `UNIQUE (measure_fund_id, period_start)` — so the insert was refused by
      // a uniqueness constraint and the test passed with the composite key
      // DROPPED. Dropping it is the mutation this assertion exists to fail on.
      const { error } = await owner.from("measure_fund_periods").insert({
        workspace_id: workspaceAId,
        measure_fund_id: fundBId,
        period_label: `Smuggled ${suffix}`,
        fiscal_year_label: "FY27",
        period_start: "2027-07-01",
        period_end: "2027-09-30",
      });

      expect(error, "a period was parented across tenants").not.toBeNull();
    });

    it("refuses an off-the-top deduction parented to another workspace's period", async () => {
      /*
        The sharpest one. An off-the-top row is what an ordinance holds back
        BEFORE apportionment, so a forged row in another agency's period lowers
        every recipient's share there and changes the year-to-date total a
        fiscal-year cap and a public page are computed from.
      */
      const { error } = await owner.from("measure_period_off_the_top").insert({
        workspace_id: workspaceAId,
        measure_fund_id: fundAId,
        period_id: periodBId,
        off_the_top_id: "admin",
        label: `Smuggled deduction ${suffix}`,
        amount: "50000.00",
        uncapped_amount: "50000.00",
        cap_status: "no_cap",
      });

      expect(error, "an off-the-top deduction was parented across tenants").not.toBeNull();
    });

    it("refuses a row that simply claims the other workspace outright", async () => {
      // The plain cross-tenant write, for completeness: no composite key needed,
      // the INSERT policy alone must refuse it.
      const { error } = await owner.from("measure_period_off_the_top").insert({
        workspace_id: workspaceBId,
        measure_fund_id: fundBId,
        period_id: periodBId,
        off_the_top_id: "admin",
        label: `Outright ${suffix}`,
        amount: "50000.00",
        uncapped_amount: "50000.00",
        cap_status: "no_cap",
      });

      expect(error, "a member of one workspace wrote another workspace's fund").not.toBeNull();
    });
  });
});
