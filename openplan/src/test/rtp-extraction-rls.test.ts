import { randomUUID } from "node:crypto";
import { type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LIVE_RLS, getLocalSupabaseEnv, liveClient } from "./local-supabase-env";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * THE EXTRACTION STAGING TABLES REFUSE EVERY CLIENT WRITE — proved against a
 * real database, not against the migration text.
 *
 * `rtp-extraction-staging-migration.test.ts` proves the migration DECLARES the
 * posture: one member-SELECT policy per table, no write policy, `authenticated`
 * granted SELECT and nothing else. That is a statement about a file. This is the
 * statement about PostgREST — the path a signed-in planner with devtools
 * actually has, and the one every route guard in the product is blind to.
 *
 * The distinction matters more here than on an ordinary table. A
 * `rtp_extraction_candidates` row is a claim that some text was copied verbatim
 * off a numbered page of a document the agency adopted, checked by a
 * deterministic verifier. A row inserted straight through PostgREST is that
 * claim WITHOUT the check — a figure with a fabricated quote and a fabricated
 * page, sitting in the review queue looking exactly like a transcription, one
 * click from an RTP write route and from a citation on a public plan page.
 * "Members read, nobody writes as a client" is therefore not a tidiness
 * preference; it is the boundary the whole feature rests on.
 *
 * WHY A SIBLING FILE RATHER THAN TWO MORE PROBES IN `rls-isolation.test.ts`.
 * That suite asks ONE question — can tenant A read tenant B's rows — of 59
 * tables at once. The question here is different and needs a different fixture:
 * can the workspace's OWNER, the highest role there is, write a row to a table
 * only the service role may write? Adding it as a probe would have meant
 * widening that harness for one case. The census entry that tells
 * `rls-isolation.test.ts` these two tables are accounted for is a separate,
 * deliberate edit, handed to the lane that owns that file so two sessions do not
 * write to it at once.
 *
 * Run the live half with: npm run test:rls-live
 *
 * The offline half below runs everywhere, so this file is never vacuous: it ties
 * the probe list to the schema, which is the thing that fails when a THIRD
 * staging table ships with no live proof behind it.
 */

/** The tables this file proves the posture of. */
const STAGING_TABLES = ["rtp_extraction_runs", "rtp_extraction_candidates"] as const;

describe("the extraction staging probe list covers the staging schema", () => {
  it("probes every table the extraction lane stages rows in", () => {
    /**
     * Derived from the schema rather than typed beside it. The
     * shipped-invisible defect in a live suite is a new table nobody wrote a
     * probe for: the suite stays green because it never asks. This asks.
     */
    const schema = loadSchemaInventory();

    const staged = schema
      .tables()
      .filter((table) => table.startsWith("rtp_extraction_"))
      .sort();

    expect(staged.length, "the schema inventory found no extraction tables at all").toBeGreaterThan(0);
    expect(
      staged,
      "a table in the extraction staging family has no live posture proof in this file. Add it to " +
        "STAGING_TABLES and give it a fixture — a staging table nobody probes is a table whose " +
        "'no client writes' claim rests on the migration text alone."
    ).toEqual([...STAGING_TABLES].sort());
  });

  it("expects a workspace column on each, which is what the read policy scopes by", () => {
    const schema = loadSchemaInventory();
    for (const table of STAGING_TABLES) {
      expect(schema.hasColumn(table, "workspace_id"), `${table}.workspace_id`).toBe(true);
      expect(schema.rlsEnabled(table), `${table} row security`).toBe(true);
    }
  });
});

const liveDescribe = LIVE_RLS ? describe : describe.skip;

liveDescribe("RTP extraction staging RLS (live)", () => {
  let service: SupabaseClient;
  let owner: SupabaseClient;

  const password = "OpenPlanExtraction!2026";
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);

  // Tenant A — the signed-in owner's own workspace.
  const workspaceAId = randomUUID();
  const cycleAId = randomUUID();
  const documentAId = randomUUID();
  const runAId = randomUUID();
  const candidateAId = randomUUID();

  // Tenant B — somebody else's agency.
  const workspaceBId = randomUUID();
  const cycleBId = randomUUID();
  const documentBId = randomUUID();
  const runBId = randomUUID();
  const candidateBId = randomUUID();

  let userId = "";

  const seedRun = (workspaceId: string, cycleId: string, documentId: string, runId: string) => ({
    id: runId,
    workspace_id: workspaceId,
    rtp_cycle_id: cycleId,
    kb_document_id: documentId,
    extraction_source: "text_layer",
    status: "succeeded",
    model: "extraction-probe-model",
    candidate_count: 1,
    discarded_count: 0,
  });

  const seedCandidate = (
    workspaceId: string,
    cycleId: string,
    runId: string,
    candidateId: string,
    quote: string
  ) => ({
    id: candidateId,
    workspace_id: workspaceId,
    rtp_cycle_id: cycleId,
    run_id: runId,
    target_kind: "financial_line",
    proposed_json: { entryKind: "revenue", sourceName: "STBG", amount: 12400000 },
    source_page: 112,
    source_quote: quote,
    quote_verified: true,
  });

  beforeAll(async () => {
    const env = getLocalSupabaseEnv();
    service = liveClient(env.API_URL, env.SERVICE_ROLE_KEY, "openplan-extraction-service");
    owner = liveClient(env.API_URL, env.ANON_KEY, "openplan-extraction-owner");

    const email = `rtp-extraction-${suffix}@example.test`;
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
      [workspaceAId, `extraction-a-${suffix}`],
      [workspaceBId, `extraction-b-${suffix}`],
    ] as const) {
      await mustInsert("workspaces", { id: workspaceId, name: `Extraction ${slug}`, slug });
    }

    // The signed-in user is an OWNER of A — the highest role there is — and no
    // member of B at all. Owner rather than viewer on purpose: this table is
    // service-role-written, so the interesting denial is the one that holds for
    // the person who can do everything else in the workspace.
    await mustInsert("workspace_members", { workspace_id: workspaceAId, user_id: userId, role: "owner" });

    await mustInsert("rtp_cycles", { id: cycleAId, workspace_id: workspaceAId, title: `Cycle A ${suffix}` });
    await mustInsert("rtp_cycles", { id: cycleBId, workspace_id: workspaceBId, title: `Cycle B ${suffix}` });

    for (const [documentId, workspaceId] of [
      [documentAId, workspaceAId],
      [documentBId, workspaceBId],
    ] as const) {
      await mustInsert("kb_documents", {
        id: documentId,
        workspace_id: workspaceId,
        title: `Adopted RTP ${suffix}`,
        source_kind: "uploaded_pdf",
        status: "ready",
        extraction_source: "text_layer",
      });
    }

    await mustInsert("rtp_extraction_runs", seedRun(workspaceAId, cycleAId, documentAId, runAId));
    await mustInsert("rtp_extraction_runs", seedRun(workspaceBId, cycleBId, documentBId, runBId));
    await mustInsert(
      "rtp_extraction_candidates",
      seedCandidate(workspaceAId, cycleAId, runAId, candidateAId, `Own agency quote ${suffix}`)
    );
    await mustInsert(
      "rtp_extraction_candidates",
      seedCandidate(workspaceBId, cycleBId, runBId, candidateBId, `Other agency quote ${suffix}`)
    );

    const signIn = await owner.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`Failed to sign in probe owner: ${signIn.error.message}`);
  }, 90_000);

  /**
   * Signing up fires `on_auth_user_created`, which provisions a PERSONAL
   * workspace as well — so deleting only the two workspaces this test knows
   * about leaves the user undeletable and the account behind. Delete by
   * MEMBERSHIP, and make a failed deletion fail the run: an orphaned throwaway
   * account is a real account with a real password in whatever database the
   * suite last pointed at.
   */
  afterAll(async () => {
    if (!service) return;
    await owner?.auth.signOut();

    // The runs hold kb_documents by ON DELETE RESTRICT, so the workspace
    // cascade would deadlock on its own children if the order were wrong.
    // Removing the runs first is also a small live proof that the RESTRICT is
    // on the DOCUMENT and not on the workspace.
    await service.from("rtp_extraction_runs").delete().in("id", [runAId, runBId]);
    await service.from("workspaces").delete().in("id", [workspaceAId, workspaceBId]);

    if (userId) {
      const { data: memberships } = await service
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId);
      for (const row of (memberships ?? []) as { workspace_id: string }[]) {
        await service.from("workspaces").delete().eq("id", row.workspace_id);
      }

      const removed = await service.auth.admin.deleteUser(userId);
      if (removed.error) {
        throw new Error(`Extraction RLS probe left user ${userId} behind: ${removed.error.message}`);
      }
    }
  }, 90_000);

  it("lets a member read their own workspace's runs and candidates", async () => {
    // THE NEGATIVE CONTROL. Without it every denial below would pass just as
    // happily against a database where these tables are unreadable by everyone,
    // which would prove nothing about the policy and hide a broken review page.
    const runs = await owner.from("rtp_extraction_runs").select("id,workspace_id").eq("workspace_id", workspaceAId);
    expect(runs.error).toBeNull();
    expect(runs.data?.map((row) => row.id)).toContain(runAId);

    const candidates = await owner
      .from("rtp_extraction_candidates")
      .select("id,source_page,source_quote")
      .eq("workspace_id", workspaceAId);
    expect(candidates.error).toBeNull();
    expect(candidates.data?.map((row) => row.id)).toContain(candidateAId);
    // The page and the quote are what make a candidate reviewable at all; a
    // read that returned the row without them would render an empty citation.
    expect(candidates.data?.[0]?.source_page).toBe(112);
    expect(candidates.data?.[0]?.source_quote).toContain(suffix);
  });

  it("shows a member nothing of another agency's extraction", async () => {
    for (const table of STAGING_TABLES) {
      const { data, error } = await owner.from(table).select("id").eq("workspace_id", workspaceBId);
      expect(error, `${table} cross-tenant read errored instead of returning nothing`).toBeNull();
      expect(data, `${table} leaked another workspace's rows`).toEqual([]);
    }
  });

  it("refuses an INSERT from the workspace OWNER, not merely from a viewer", async () => {
    /**
     * The row this would create is the whole hazard: a candidate carrying a
     * quote and a page that no verifier ever checked, indistinguishable in the
     * review queue from a real transcription.
     */
    const forgedRun = await owner.from("rtp_extraction_runs").insert(
      seedRun(workspaceAId, cycleAId, documentAId, randomUUID())
    );
    expect(forgedRun.error, "an owner inserted an extraction run through PostgREST").not.toBeNull();

    const forgedCandidate = await owner.from("rtp_extraction_candidates").insert(
      seedCandidate(workspaceAId, cycleAId, runAId, randomUUID(), "A quote nothing verified")
    );
    expect(
      forgedCandidate.error,
      "an owner inserted a candidate through PostgREST — a figure with an unchecked quote and page"
    ).not.toBeNull();
  });

  it("refuses an UPDATE from the workspace owner — a quote is not editable in place", async () => {
    // Editing `source_quote` would leave the citation pointing at a page whose
    // text no longer says what the row claims it says. Acceptance edits a
    // VALUE through the ordinary RTP write route; it never rewrites the record
    // of what the machine proposed.
    const rewritten = await owner
      .from("rtp_extraction_candidates")
      .update({ source_quote: "Something the document never said" })
      .eq("id", candidateAId);
    expect(rewritten.error ?? null, "an owner rewrote a stored quote through PostgREST").not.toBeNull();

    const accepted = await owner
      .from("rtp_extraction_candidates")
      .update({ status: "accepted", reviewed_at: new Date().toISOString(), accepted_row_id: randomUUID() })
      .eq("id", candidateAId);
    expect(accepted.error ?? null, "an owner accepted a candidate through PostgREST").not.toBeNull();

    const { data } = await service
      .from("rtp_extraction_candidates")
      .select("status,source_quote")
      .eq("id", candidateAId)
      .single();
    expect(data?.status).toBe("pending");
    expect(data?.source_quote).toContain(suffix);
  });

  it("refuses a DELETE from the workspace owner — the record of what was proposed survives", async () => {
    // "What did the planner change?" has to stay answerable forever, which it
    // cannot be if the proposal can be deleted from the client.
    for (const [table, id] of [
      ["rtp_extraction_candidates", candidateAId],
      ["rtp_extraction_runs", runAId],
    ] as const) {
      const { error } = await owner.from(table).delete().eq("id", id);
      expect(error ?? null, `an owner deleted from ${table} through PostgREST`).not.toBeNull();

      const { count } = await service.from(table).select("id", { count: "exact", head: true }).eq("id", id);
      expect(count, `${table} row ${id} was destroyed by a client delete`).toBe(1);
    }
  });

  it("refuses an anonymous visitor entirely", async () => {
    const env = getLocalSupabaseEnv();
    const visitor = liveClient(env.API_URL, env.ANON_KEY, "openplan-extraction-anon");

    for (const table of STAGING_TABLES) {
      const { data, error } = await visitor.from(table).select("id");
      // Either a hard permission denial or an empty set is acceptable; a ROW is
      // not. Unreviewed transcription, quotes included, must never be reachable
      // with the public key.
      expect(data ?? [], `${table} returned rows to an anonymous client`).toEqual([]);
      if (error) expect(error.message.length).toBeGreaterThan(0);
    }
  });
});
