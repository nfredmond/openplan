import { describe, expect, it } from "vitest";
import {
  collectHelperCallSites,
  collectSupabaseWriteSites,
  parseWriteSitesFromSource,
  type SupabaseWriteSite,
} from "./supabase-call-sites";
import { loadPolicyInventory } from "./migrations/policy-inventory";
import { loadSchemaInventory } from "./migrations/schema-inventory";

/**
 * REGRESSION GUARD — a write through the caller's client may not target a table
 * that has no PERMISSIVE policy for that command, and an UPDATE or DELETE may
 * not be added without some way to see whether it changed anything.
 *
 * THE DEFECT. Postgres composes RLS as "at least one PERMISSIVE policy must
 * pass, then every RESTRICTIVE policy must also pass". A restrictive policy can
 * only ever SUBTRACT. So a table carrying a restrictive writer gate and no
 * permissive partner accepts no writes at all — and because the table-level
 * grant is still present, this is not a "permission denied" error. It is an
 * UPDATE that matches zero rows, which Postgres reports as a SUCCESSFUL
 * statement and supabase-js hands back as `error: null`.
 *
 * Two tables were in that state when this guard was written. `runs` discarded
 * every saved Analysis Studio map view, for every user of every role, since the
 * feature shipped — while audit-logging `run_updated` each time.
 * `project_rtp_cycle_links` chained `.single()`, so it 500'd instead: broken
 * loudly, but misclassified. Both were found by querying a running database.
 * Neither could be found by the test suite, and one of them HAD a test — named
 * "persists map view state into run metrics", asserting a 200 and the right
 * `.update()` argument, passing throughout. It verified the REQUEST and was
 * named for the RESULT.
 *
 * WHY AN AST. The question is structural — which `.from()` owns this
 * `.update()`, which client is behind it, what follows in the chain — across
 * prettier-split calls whose arguments contain parentheses and strings. The
 * other guards in this repo use regex because they only ask "does this file
 * contain this token". `src/test/supabase-call-sites.ts` uses the TypeScript
 * compiler, which is already a devDependency.
 *
 * ORDERING NOTE, worth keeping: run against the policy parser that existed
 * before `src/test/migrations/`, this guard reported FIVE gaps rather than two.
 * The three extra were the `scenario_*` spine tables, whose policies are built
 * by `EXECUTE format(…)` and were invisible to that parser. Had this guard
 * landed first, three permanent false entries would have gone into the
 * allowlist below and stayed there.
 *
 * NO LONGER NOT ASSERTED. This header used to record the status question as out
 * of scope: `PGRST116` appeared zero times in non-test `src`, so every caller-RLS
 * write chaining `.select().single()` answered 500 when its target row was not
 * writable — loud, but misclassified, exactly as `project_rtp_cycle_links` was,
 * and fixing it was "a separate change with its own blast radius". That change
 * has since landed. `src/lib/http/write-outcome.ts` holds the decision and
 * `write-zero-row-status-guard.test.ts` ratchets it over every caller UPDATE and
 * DELETE. The division between the two guards is worth keeping straight: this
 * one asks whether a write can SEE how many rows it changed, that one asks what
 * it then SAYS.
 *
 * DELIBERATELY NOT ASSERTED:
 *
 *   - That a write is AUTHORIZED. `workspace-write-role-gate-guard.test.ts`
 *     owns that question.
 *   - That an INSERT verifies rows. It cannot silently insert nothing: a
 *     WITH CHECK violation RAISES. Only UPDATE and DELETE match zero rows
 *     quietly, so only they are ratcheted.
 */

const inventory = loadPolicyInventory();
const schema = loadSchemaInventory();
const writeSites = collectSupabaseWriteSites();

/** Everything not provably service-role is treated as the caller's client. */
function callerWrites(): SupabaseWriteSite[] {
  return writeSites.filter((site) => site.clientKind !== "service-role");
}

/**
 * Writes with no permissive policy that are correct anyway, because the client
 * is service-role — which the AST cannot see, because these helpers take their
 * client as a PARAMETER and every declared type is `SupabaseClient`,
 * `Pick<SupabaseClient, "from">` or an alias. Those types describe the shape of
 * the client, never which key is behind it.
 *
 * So each entry names the functions that own the write, and the test below
 * PROVES the entry by resolving the client at every call site outside the
 * module. An entry that stops being true fails; it does not quietly persist.
 */
const SERVICE_ROLE_ONLY_WRITES: Record<string, { functions: string[]; reason: string }> = {
  "src/lib/aerial/artifact-custody-server.ts": {
    functions: ["runAerialCustodyPass", "finalizeAerialCustodyState"],
    reason:
      "aerial_artifact_custody records whether OpenPlan holds the bytes of a drone flight's " +
      "outputs. Members READ it (that is the whole point — a job whose deliverables are only a " +
      "vendor link must be visible as such) but may not write it: custody is established by " +
      "fetching from the processing worker, so a row asserting 'these bytes are here, this hash' " +
      "is evidence, and the subject of evidence must not be able to author it. Both writers are " +
      "reached only from the service-role processing-callback routes.",
  },
  "src/lib/engagement/survey-responses.ts": {
    functions: ["insertSurveyResponse"],
    reason:
      "Public survey submission. The writer is /api/engage/[shareToken]/survey/submit, which is " +
      "unauthenticated by design — an anonymous respondent has no workspace membership to scope " +
      "an RLS policy to, so these tables are written service-role and read only through the " +
      "campaign-scoped helpers this module exposes.",
  },
  "src/lib/knowledge-base/documents.ts": {
    functions: ["insertKbChunks"],
    reason:
      "kb_document_chunks carries embedding rows fanned out from one document. It has a read " +
      "policy and no write policy on purpose: chunks are derived data, written only by the " +
      "ingest routes under /api/knowledge-base, never by a user action.",
  },
  "src/lib/notifications/engagement.ts": {
    functions: [
      "recordOperatorNotification",
      "enqueueEmail",
      "enqueueCampaignSubscriberEmails",
      "subscribeParticipant",
      "confirmSubscription",
      "unsubscribeByToken",
    ],
    reason:
      "engagement_email_outbox and engagement_subscriptions hold participant PII (email " +
      "addresses of members of the public). They have no write policy so that no workspace " +
      "member can reach them through PostgREST at all; the confinement of the reads is enforced " +
      "separately by engagement-notifications-reader-inventory.test.ts.",
  },
  "src/lib/observability/action-audit.ts": {
    functions: ["recordAssistantActionExecution"],
    reason:
      "assistant_action_executions is an append-only audit trail of what the assistant did. A " +
      "subject of an audit log must not be able to write it, so it has no INSERT policy and the " +
      "route-level service client records the entry.",
  },
  "src/lib/safety/ingest.ts": {
    functions: ["ingestCrashesForStudyArea"],
    reason:
      "safety_crashes rows are fetched from a state crash API and shared; the ingest bookkeeping " +
      "in safety_crash_ingests is written by /api/safety/crashes/ingest with a service client so " +
      "a partially-completed ingest cannot be edited into looking complete.",
  },
  "src/lib/workspaces/invitations.ts": {
    functions: ["createWorkspaceInvitation"],
    reason:
      "workspace_invitations rows are addressed to someone who is NOT yet a member, so no " +
      "membership-scoped policy could match the row for the person it is for. Accepting and " +
      "declining likewise run service-role from /api/workspaces/invitations/*.",
  },
};

/**
 * UPDATE and DELETE writes through the caller's client that cannot observe how
 * many rows they changed, counted per file.
 *
 * This number may only ever go DOWN. It is not approval — it is the debt that
 * existed when this guard was written, recorded so that a NEW unverified write
 * fails, and so that FIXING one fails until the number is decremented, putting
 * the improvement in the diff.
 *
 * Counted per file rather than per line because line numbers move and file
 * paths do not. Requiring verification everywhere today would mean 79
 * exemptions carrying individual reasons, which is not an allowlist — it is a
 * second copy of the codebase.
 */
const UNVERIFIED_CALLER_WRITES: Record<string, number> = {
  "src/app/api/county-runs/[countyRunId]/enqueue/route.ts": 2,
  "src/app/api/county-runs/[countyRunId]/manifest/route.ts": 2,
  "src/app/api/county-runs/[countyRunId]/scaffold/route.ts": 1,
  "src/app/api/county-runs/[countyRunId]/validate/refresh/route.ts": 1,
  "src/app/api/engagement/campaigns/[campaignId]/closeloop/[entryId]/route.ts": 1,
  "src/app/api/engagement/campaigns/[campaignId]/items/[itemId]/route.ts": 1,
  "src/app/api/engagement/campaigns/[campaignId]/moderation-scan/route.ts": 1,
  "src/app/api/engagement/campaigns/[campaignId]/representativeness/route.ts": 1,
  // 1 -> 0: the campaign PATCH now chains `.select("id").maybeSingle()` and
  // answers zero matched rows through write-outcome.ts. It had to, because
  // 20260729000003 gave that same UPDATE the campaign's map area: an operator
  // setting the area their whole public portal opens on was being told
  // `{ success: true }` over a write the database may have refused.
  "src/app/api/engagement/campaigns/[campaignId]/share-token/route.ts": 1,
  "src/app/api/engagement/campaigns/[campaignId]/survey/questions/[questionId]/options/[optionId]/route.ts": 1,
  "src/app/api/engagement/campaigns/[campaignId]/survey/questions/[questionId]/route.ts": 1,
  "src/app/api/engagement/campaigns/[campaignId]/synthesis/route.ts": 1,
  // 1 -> 0: the award close-out UPDATE moved into
  // src/app/api/funding-awards/[awardId]/award-closure.ts, shared with the new
  // PATCH route, and now chains `.select("id").maybeSingle()` and answers zero
  // matched rows through write-outcome.ts. It matters more here than most: this
  // is the write that marks an award fully spent, so reporting success over zero
  // rows would have told a planner their award was closed when it was not.
  "src/app/api/funding-opportunities/[opportunityId]/application/route.ts": 1,
  "src/app/api/funding-opportunities/[opportunityId]/sections/[sectionId]/draft/route.ts": 1,
  "src/app/api/funding-opportunities/[opportunityId]/sections/[sectionId]/route.ts": 1,
  "src/app/api/invoicing/client-invoices/[invoiceId]/route.ts": 4,
  "src/app/api/invoicing/rate-tables/[rateTableId]/route.ts": 1,
  "src/app/api/invoicing/time-entries/[timeEntryId]/route.ts": 1,
  // 4 -> 3: the relaunch re-queue now chains `.select("id").maybeSingle()` and
  // answers zero matched rows through write-outcome.ts, because that write also
  // carries the run's rebuilt demographics.
  //
  // 3 -> 5 (2026-07-30): relaunch now also deletes the prior attempt's
  // `modeling_claim_decisions` and `modeling_validation_results` — the worker
  // writes tiers mid-run, so a relaunched run could otherwise display a tier
  // (up to calibrated_to_counts) over KPIs the relaunch had deleted. These two
  // deletes deliberately do NOT observe their row count: zero rows matched is
  // the COMMON case (a run that never earned a tier has nothing to clear), so a
  // count proves nothing. Both check `.error`, which is the failure that matters
  // — a delete refused by RLS or a missing table must not report a clean slate.
  "src/app/api/models/[modelId]/runs/[modelRunId]/launch/route.ts": 5,
  "src/app/api/models/[modelId]/runs/[modelRunId]/route.ts": 2,
  "src/app/api/models/[modelId]/runs/route.ts": 15,
  "src/app/api/plans/[planId]/route.ts": 1,
  "src/app/api/programs/[programId]/route.ts": 1,
  // 1 -> 0 (2026-08-05): the DELETE handler was the last blind write here. It
  // ran `.delete().eq("id", …)` and tested only `.error`, so a delete that
  // matched ZERO rows — the shape PostgREST reports with `error: null` — was
  // answered `{ ok: true }` and written to the audit ledger as
  // `audit.info("deleted")` for a row still in the table. It now chains
  // `.select("id").maybeSingle()` and reports the outcome through
  // write-outcome.ts, like the PATCH beside it. `"id"` and not the full
  // projection on purpose: a DELETE returns the caller no record, and asking
  // for the financial columns would 503 every delete on a deployment that has
  // not run 20260805000003.
  "src/app/api/reports/[reportId]/generate/route.ts": 6,
  "src/app/api/reports/[reportId]/route.ts": 4,
  "src/app/api/rtp-cycles/[rtpCycleId]/public-share/route.ts": 1,
  "src/app/api/rtp-cycles/packet-presets/route.ts": 2,
  "src/app/api/scenarios/[scenarioSetId]/entries/[entryId]/route.ts": 2,
  "src/app/api/scenarios/[scenarioSetId]/route.ts": 1,
  "src/lib/api/link-replacement.ts": 2,
  "src/lib/engagement/survey-responses.ts": 1,
  "src/lib/models/behavioral-onramp-kpis.ts": 1,
  "src/lib/models/evidence-backbone.ts": 1,
  "src/lib/notifications/engagement.ts": 2,
  "src/lib/projects/rtp-posture-writeback.ts": 1,
  "src/lib/reports/scenario-writeback.ts": 2,
  "src/lib/safety/ingest.ts": 2,
};

describe("write policy coverage", () => {
  it("never writes through the caller's client to a table with no permissive policy", () => {
    const gaps = callerWrites()
      .filter((site) => site.table !== null)
      .filter((site) => schema.rlsEnabled(site.table as string))
      .filter((site) => inventory.permissiveGrants(site.table as string, site.command).length === 0)
      .filter((site) => !(site.file in SERVICE_ROLE_ONLY_WRITES))
      .map((site) => `${site.file}:${site.line} → ${site.table} ${site.command}`)
      .sort();

    expect(
      gaps,
      "These write through the caller's client to a table with a RESTRICTIVE gate and no " +
        "PERMISSIVE policy for that command. Under RLS that is not an error — the statement " +
        "succeeds over zero rows and supabase-js returns error: null, so the route reports " +
        "success while nothing is saved. Either add the permissive policy in a migration, or, if " +
        "the write is genuinely service-role, add the module to SERVICE_ROLE_ONLY_WRITES with a " +
        "reason (the test below will make you prove it)."
    ).toEqual([]);
  });

  it("never writes through the caller's client to a table with RLS disabled", () => {
    // A different condition with a different severity, kept separate on purpose:
    // "no permissive policy" means the write silently does nothing, while "no
    // RLS" means it succeeds for everyone. Ten reference tables (GTFS, census,
    // LODES) run without RLS by design and no caller-RLS write touches them.
    const unprotected = callerWrites()
      .filter((site) => site.table !== null && schema.tables().includes(site.table))
      .filter((site) => !schema.rlsEnabled(site.table as string))
      .map((site) => `${site.file}:${site.line} → ${site.table} ${site.command}`)
      .sort();

    expect(unprotected).toEqual([]);
  });

  it("proves every allowlisted module is handed a service-role client", () => {
    // The entries above claim a fact the type system cannot express. This is
    // where the claim is checked: resolve the client at every call site OUTSIDE
    // the module itself and require it to be service-role. Internal pass-throughs
    // (one helper calling another in the same file) are excluded — the client
    // there is the same parameter, already covered by its own callers.
    const functions = Object.values(SERVICE_ROLE_ONLY_WRITES).flatMap((entry) => entry.functions);
    const external = collectHelperCallSites(functions).filter(
      (site) => !(site.file in SERVICE_ROLE_ONLY_WRITES)
    );

    const wrong = external
      .filter((site) => site.clientKind !== "service-role")
      .map((site) => `${site.file}:${site.line} ${site.fn}(${site.argumentText}) → ${site.clientKind}`)
      .sort();

    expect(
      wrong,
      "An allowlisted helper is being called with something other than a service-role client. " +
        "Its SERVICE_ROLE_ONLY_WRITES entry is no longer true: either pass the service client, or " +
        "add the permissive policies the caller's client now needs."
    ).toEqual([]);

    // And the allowlist must not be resting on functions nobody calls.
    expect(external.length).toBeGreaterThanOrEqual(functions.length);
  });

  it("keeps the allowlist honest — no module listed that no longer needs it", () => {
    const stale = Object.keys(SERVICE_ROLE_ONLY_WRITES).filter((file) => {
      const gaps = writeSites
        .filter((site) => site.file === file && site.table !== null && schema.rlsEnabled(site.table))
        .filter((site) => inventory.permissiveGrants(site.table as string, site.command).length === 0);
      return gaps.length === 0;
    });

    expect(
      stale,
      "This module no longer writes to any table lacking a permissive policy, so its entry is " +
        "dead weight. Remove it."
    ).toEqual([]);
  });

  it("adds no new UPDATE or DELETE that cannot see whether it changed anything", () => {
    const counts: Record<string, number> = {};
    for (const site of callerWrites()) {
      if (site.command !== "UPDATE" && site.command !== "DELETE") continue;
      if (site.verifiesAffectedRows) continue;
      counts[site.file] = (counts[site.file] ?? 0) + 1;
    }

    expect(
      counts,
      "A write that cannot observe its own row count reports success over zero rows. If this " +
        "fails with a HIGHER number, chain `.select()` and check the length (or use " +
        "`.maybeSingle()`), rather than adding to the map. If it fails with a LOWER number, you " +
        "fixed one — decrement it here so the improvement is recorded."
    ).toEqual(UNVERIFIED_CALLER_WRITES);
  });

  it("guards the guard", () => {
    // A scanner that silently matched nothing would make every assertion above
    // vacuously green.
    expect(writeSites.length).toBeGreaterThan(200);
    expect(writeSites.filter((site) => site.clientKind === "service-role").length).toBeGreaterThan(25);
    expect(writeSites.filter((site) => site.routeId !== null).length).toBeGreaterThan(150);
    expect(new Set(writeSites.map((site) => site.command))).toEqual(new Set(["INSERT", "UPDATE", "DELETE"]));

    // Dynamic table names, where the projection/policy question cannot be
    // answered statically. Two helpers, both replace-a-link-set idioms.
    expect([...new Set(writeSites.filter((site) => site.table === null).map((site) => site.file))].sort()).toEqual([
      "src/lib/api/link-replacement.ts",
      "src/lib/models/evidence-backbone.ts",
    ]);

    // Every literal table the scanner found is a real table.
    const unknown = [...new Set(writeSites.map((site) => site.table))].filter(
      (table): table is string => table !== null && !schema.relations().includes(table)
    );
    expect(unknown).toEqual([]);

    // The two defects this guard exists for, as parse fixtures.
    const silent = parseWriteSitesFromSource(
      'const supabase = await createClient();\nawait supabase.from("runs").update({ metrics }).eq("id", id);'
    );
    expect(silent).toHaveLength(1);
    expect(silent[0]).toMatchObject({
      table: "runs",
      command: "UPDATE",
      clientKind: "caller-rls",
      verifiesAffectedRows: false,
    });

    // Observable is not observed: chaining `.select()` and then ignoring the
    // rows leaves the route exactly where it started.
    expect(
      parseWriteSitesFromSource(
        [
          "async function handler() {",
          "  const supabase = await createClient();",
          '  const { error } = await supabase.from("runs").update({ metrics }).eq("id", id).select("id");',
          "  if (error) return 500;",
          "  return 200;",
          "}",
        ].join("\n")
      )[0].verifiesAffectedRows
    ).toBe(false);

    // The same write, actually fixed — the rows come back AND are looked at.
    expect(
      parseWriteSitesFromSource(
        [
          "async function handler() {",
          "  const supabase = await createClient();",
          '  const { data, error } = await supabase.from("runs").update({ metrics }).eq("id", id).select("id");',
          "  if (error) return 500;",
          "  if ((data?.length ?? 0) === 0) return 500;",
          "  return 200;",
          "}",
        ].join("\n")
      )[0].verifiesAffectedRows
    ).toBe(true);

    // A prettier-split chain resolves to ONE site, with the whole chain seen.
    const split = parseWriteSitesFromSource(
      [
        "const supabase = await createClient();",
        "const { data, error } = await supabase",
        '  .from("project_rtp_cycle_links")',
        "  .update(updates)",
        '  .eq("id", link.id)',
        '  .select("id")',
        "  .single();",
      ].join("\n")
    );
    expect(split).toHaveLength(1);
    expect(split[0]).toMatchObject({ table: "project_rtp_cycle_links", verifiesAffectedRows: true });

    // Service-role is distinguished from the caller's client.
    expect(
      parseWriteSitesFromSource(
        'const service = createServiceRoleClient();\nawait service.from("runs").update({ x: 1 }).eq("id", id);'
      )[0].clientKind
    ).toBe("service-role");

    // A ternary of both fails CLOSED.
    expect(
      parseWriteSitesFromSource(
        'const supabase = valid ? createServiceRoleClient() : await createClient();\nawait supabase.from("runs").delete().eq("id", id);'
      )[0].clientKind
    ).toBe("caller-rls");

    // Things that are not Supabase calls at all.
    expect(parseWriteSitesFromSource("Buffer.from(x).update(y);")).toEqual([]);
    expect(parseWriteSitesFromSource("Array.from(rows).map((r) => r.update);")).toEqual([]);
  });
});
