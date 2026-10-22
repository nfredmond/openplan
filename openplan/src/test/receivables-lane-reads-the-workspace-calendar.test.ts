import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE RECEIVABLES LANE AGES CLIENT INVOICES ON THE WORKSPACE'S CALENDAR.
 *
 * `summarizeReceivables` counts days past due on whatever zone it is given and
 * falls back to UTC. This file checks the wiring: the lane reads the calendar
 * of the workspace it was opened for and passes that zone, and a failed read
 * leaves the old UTC behaviour. The zone differs per workspace so a lane that
 * passed a constant would fail.
 *
 * BLIND CATEGORY: the lane is called, not rendered, so its child components
 * are not exercised, and the lane does not print the overdue count today.
 */

const { summarizeSpy, workspaceRows, calendarReads, invoice } = vi.hoisted(() => ({
  summarizeSpy: vi.fn(),
  invoice: { id: "invoice-1", client_id: "client-1", status: "sent", due_date: "2026-10-13", total_amount: 500 },
  workspaceRows: new Map<string, { data: unknown; error: { message: string } | null }>(),
  calendarReads: [] as Array<{ columns: string; column: string; value: string }>,
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/invoicing/receivables", async () => {
  const actual = await vi.importActual<typeof import("@/lib/invoicing/receivables")>("@/lib/invoicing/receivables");
  return {
    ...actual,
    summarizeReceivables: (...args: Parameters<typeof actual.summarizeReceivables>) => {
      const result = actual.summarizeReceivables(...args);
      summarizeSpy(args, result);
      return result;
    },
  };
});

/** A chain that answers every list read with no rows, except client invoices. */
function listChain(table: string) {
  const result = { data: table === "client_invoices" ? [invoice] : [], error: null };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "in"]) {
    chain[method] = () => chain;
  }
  chain.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function workspacesChain() {
  return {
    select: (columns: string) => ({
      eq: (column: string, value: string) => ({
        maybeSingle: async () => {
          calendarReads.push({ columns, column, value });
          return workspaceRows.get(value) ?? { data: null, error: null };
        },
      }),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => (table === "workspaces" ? workspacesChain() : listChain(table)),
  }),
}));

import { ReceivablesLane } from "@/app/(app)/invoicing/_components/receivables-lane";

type SummarizeCall = [[unknown, Date, string?], { overdueCount: number }];

async function laneSummary(workspaceId: string) {
  await ReceivablesLane({ workspaceId, canWriteInvoices: false });
  expect(summarizeSpy).toHaveBeenCalledTimes(1);
  const [[, now, timeZone], result] = summarizeSpy.mock.calls[0] as SummarizeCall;
  return { now, timeZone, overdueCount: result.overdueCount };
}

describe("the receivables lane reads the workspace calendar", () => {
  beforeEach(() => {
    summarizeSpy.mockReset();
    workspaceRows.clear();
    calendarReads.length = 0;
    invoice.due_date = "2026-10-13";
    workspaceRows.set("workspace-pacific", { data: { time_zone: "America/Los_Angeles", home_country_code: "US" }, error: null });
    workspaceRows.set("workspace-tokyo", { data: { time_zone: "Asia/Tokyo", home_country_code: "JP" }, error: null });
    workspaceRows.set("workspace-unreadable", { data: null, error: { message: "column workspaces.time_zone does not exist" } });
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks for the calendar of the workspace it was opened for", async () => {
    vi.setSystemTime(new Date("2026-10-14T01:00:00Z"));

    await laneSummary("workspace-pacific");
    summarizeSpy.mockReset();
    await laneSummary("workspace-tokyo");

    expect(calendarReads).toEqual([
      { columns: "time_zone, home_country_code", column: "id", value: "workspace-pacific" },
      { columns: "time_zone, home_country_code", column: "id", value: "workspace-tokyo" },
    ]);
  });

  it("does not age an invoice due October 13 at 6 p.m. Pacific that day", async () => {
    vi.setSystemTime(new Date("2026-10-14T01:00:00Z"));

    const summary = await laneSummary("workspace-pacific");
    expect(summary.timeZone).toBe("America/Los_Angeles");
    expect(summary.now.toISOString()).toBe("2026-10-14T01:00:00.000Z");
    expect(summary.overdueCount).toBe(0);
  });

  it("uses standard time after US DST ends", async () => {
    // 11:30 p.m. PST on November 1, the due date. At the summer offset, or in
    // UTC, it would already be November 2.
    invoice.due_date = "2026-11-01";
    vi.setSystemTime(new Date("2026-11-02T07:30:00Z"));
    expect((await laneSummary("workspace-pacific")).overdueCount).toBe(0);
  });

  it("ages on Tokyo's calendar for a Tokyo workspace", async () => {
    // Midnight October 14 in Tokyo is 3 p.m. October 13 in UTC.
    vi.setSystemTime(new Date("2026-10-13T15:00:00Z"));

    const summary = await laneSummary("workspace-tokyo");
    expect(summary.timeZone).toBe("Asia/Tokyo");
    expect(summary.overdueCount).toBe(1);
  });

  it("falls back to UTC when the calendar cannot be read", async () => {
    vi.setSystemTime(new Date("2026-10-14T01:00:00Z"));

    const summary = await laneSummary("workspace-unreadable");
    expect(summary.timeZone).toBe("UTC");
    // The UTC day is already October 14.
    expect(summary.overdueCount).toBe(1);
  });
});
