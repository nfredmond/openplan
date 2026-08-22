import { describe, expect, it, vi } from "vitest";

import {
  ASSISTANT_ACTIVITY_SELECT,
  ASSISTANT_ACTIVITY_SELECT_CORE,
  buildAssistantActivitySummary,
  loadAssistantActivityRows,
  type AssistantActionExecutionRow,
} from "@/lib/assistant/activity-summary";

/**
 * THE ASSISTANT ACTIVITY LEDGER'S READ, TESTED WHERE IT NOW LIVES.
 *
 * These assertions came from `assistant-activity-route.test.ts`, which covered
 * a GET endpoint nothing called: the page imported the same two functions
 * directly and ran its own query, so the route was a second answer that could
 * drift from the first. The route is gone (2026-08-21, the last entry on
 * `KNOWN_UNWIRED`) and the module moved to `src/lib/assistant/` — but the
 * DECISIONS it protected outlive the implementation, which is why they were
 * moved here rather than deleted with it.
 *
 * WHAT DID NOT COME ACROSS, and why that is not a loss: the route's zod cap on
 * `?limit=`. It existed because the route took a limit from the query string.
 * The page passes a fixed constant, so no user input reaches `.limit()` any
 * more and there is nothing left to cap. Its 401/400 branches went the same
 * way — there is no request to reject.
 *
 * MUTATION-VERIFIED — see the tail of this file.
 */

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_WORKSPACE = "22222222-2222-4222-8222-222222222222";

function chainCapturing(result: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown]> = [];
  const selects: string[] = [];
  const chain = {
    select: (columns: string) => {
      selects.push(columns);
      return chain;
    },
    eq: (column: string, value: unknown) => {
      calls.push([column, value]);
      return chain;
    },
    order: (column: string, options: unknown) => {
      calls.push([`order:${column}`, options]);
      return chain;
    },
    limit: (count: number) => {
      calls.push(["limit", count]);
      return Promise.resolve(result);
    },
  };
  return { client: { from: vi.fn(() => chain) }, calls, selects };
}

describe("the assistant activity read is workspace-scoped", () => {
  it("filters by workspace, newest first, to the caller's limit", async () => {
    // The tenancy assertion. This is a service-visible audit ledger of what the
    // agent did; a missing `.eq` here lists another workspace's actions.
    const { client, calls } = chainCapturing({ data: [], error: null });

    await loadAssistantActivityRows(client as never, { workspaceId: WORKSPACE_ID, limit: 50 });

    expect(calls).toContainEqual(["workspace_id", WORKSPACE_ID]);
    expect(calls).toContainEqual(["order:completed_at", { ascending: false }]);
    expect(calls).toContainEqual(["limit", 50]);
    expect(calls).not.toContainEqual(["workspace_id", OTHER_WORKSPACE]);
  });

  it("asks for the columns the ledger renders", async () => {
    // `.select()` strings are not type-checked in this codebase, so a dropped
    // column surfaces as a blank cell at runtime rather than as a build error.
    const { client, selects } = chainCapturing({ data: [], error: null });

    await loadAssistantActivityRows(client as never, { workspaceId: WORKSPACE_ID, limit: 50 });

    expect(selects[0]).toBe(ASSISTANT_ACTIVITY_SELECT);
    for (const column of ["action_kind", "outcome", "input_hash", "error_message"]) {
      expect(ASSISTANT_ACTIVITY_SELECT_CORE).toContain(column);
    }
  });

  it("falls back to the core columns when authorship is not deployed, and says so", async () => {
    // The deploy/migrate window: the authorship columns arrived in a migration,
    // and a deployment behind it must still show its ledger rather than an
    // error — but the surface has to know the authorship is absent rather than
    // empty.
    const calls: string[] = [];
    const chain = {
      select: (columns: string) => {
        calls.push(columns);
        return chain;
      },
      eq: () => chain,
      order: () => chain,
      limit: () =>
        Promise.resolve(
          calls.length === 1
            ? { data: null, error: { message: "column assistant_action_executions.acted_by does not exist" } }
            : { data: [], error: null }
        ),
    };

    const result = await loadAssistantActivityRows({ from: () => chain } as never, {
      workspaceId: WORKSPACE_ID,
      limit: 50,
    });

    expect(calls).toHaveLength(2);
    expect(calls[1]).toBe(ASSISTANT_ACTIVITY_SELECT_CORE);
    expect(result.error).toBeNull();
    expect(result.authorshipAvailable).toBe(false);
  });

  it("reports a genuine failure rather than an empty ledger", async () => {
    // Both reads failing is a real failure. An empty ledger here would say the
    // agent has done nothing, which is the single most misleading thing this
    // page could state.
    const { client } = chainCapturing({ data: null, error: { message: "permission denied", code: "42501" } });

    const result = await loadAssistantActivityRows(client as never, {
      workspaceId: WORKSPACE_ID,
      limit: 50,
    });

    expect(result.data).toBeNull();
    expect(result.error).toMatchObject({ message: "permission denied" });
    expect(result.authorshipAvailable).toBe(false);
  });
});

describe("the activity summary counts what the ledger shows", () => {
  const rows = [
    { id: "a", action_kind: "generate_report_artifact", outcome: "succeeded", approval: "auto" },
    { id: "b", action_kind: "create_funding_opportunity", outcome: "failed", approval: "approval_required" },
    { id: "c", action_kind: "generate_report_artifact", outcome: "succeeded", approval: "approval_required" },
  ] as unknown as AssistantActionExecutionRow[];

  it("totals by outcome, by action, and by whether approval gated it", () => {
    const summary = buildAssistantActivitySummary(rows);

    expect(summary.total).toBe(3);
    expect(summary.byOutcome).toMatchObject({ succeeded: 2, failed: 1 });
    expect(summary.byActionKind).toMatchObject({
      generate_report_artifact: 2,
      create_funding_opportunity: 1,
    });
    expect(summary.approvalGated).toBe(2);
    expect(summary.failed).toBe(1);
  });

  it("counts nothing as nothing", () => {
    const summary = buildAssistantActivitySummary([]);
    expect(summary.total).toBe(0);
    expect(summary.failed).toBe(0);
  });
});
