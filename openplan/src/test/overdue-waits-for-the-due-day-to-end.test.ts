import { describe, expect, it } from "vitest";

import { isInvoiceOverdue as isInvoicingRowOverdue } from "@/app/(app)/invoicing/_components/invoicing-page-helpers";
import { isInvoiceOverdue as isGrantsInvoiceOverdue } from "@/lib/grants/page-helpers";
import {
  buildBillingInvoicePriorityQueue,
  filterBillingInvoiceRecordsByOverdueStatus,
  summarizeBillingInvoiceRecords,
} from "@/lib/invoicing/invoice-records";
import { buildWorkspaceOperationsSummaryFromSourceRows } from "@/lib/operations/workspace-summary";
import { invoicePriority, isDeadlinePast, milestonePriority, submittalPriority } from "@/lib/work/deadlines";

/**
 * A DUE DATE IS NOT OVERDUE THE EVENING BEFORE, ON ANY SCREEN.
 *
 * Servers run in UTC. Read with `new Date("2026-10-14")`, a date-only due date
 * is midnight UTC, which is 5 p.m. Pacific on October 13: the evening before
 * it is due. `isDeadlinePast` already reads it as a calendar day (past only
 * once the day has ended everywhere, noon UTC the next day), and the counts on
 * these screens use it. The lane orders, invoice flags and the relink queue
 * below each had their own midnight-UTC comparison, so a screen could call a
 * record overdue next to a count that did not.
 *
 * The instants used throughout:
 *   - 2026-10-14T01:00Z is 6 p.m. Pacific on October 13. Nothing due on the
 *     13th or the 14th is overdue yet.
 *   - 2026-10-14T12:00Z is the moment October 13 has ended everywhere, so a
 *     record due on the 13th turns overdue then, and not a millisecond before.
 *
 * BLIND CATEGORY: these call each function with an explicit `now`. A caller
 * that passes the wrong clock, or a screen that never calls these functions,
 * is not seen here.
 */

const EVENING_BEFORE = new Date("2026-10-14T01:00:00Z");
const JUST_BEFORE_THE_13TH_ENDS = new Date("2026-10-14T11:59:59.999Z");
const THE_13TH_HAS_ENDED = new Date("2026-10-14T12:00:00Z");

describe("the shared rule these all defer to", () => {
  it("is the instants this file relies on", () => {
    expect(isDeadlinePast("2026-10-14", EVENING_BEFORE)).toBe(false);
    expect(isDeadlinePast("2026-10-13", EVENING_BEFORE)).toBe(false);
    expect(isDeadlinePast("2026-10-13", JUST_BEFORE_THE_13TH_ENDS)).toBe(false);
    expect(isDeadlinePast("2026-10-13", THE_13TH_HAS_ENDED)).toBe(true);
  });
});

describe("project lane priorities (lib/work/deadlines)", () => {
  it("does not put a milestone due tomorrow in the overdue tier the evening before", () => {
    expect(milestonePriority({ status: "scheduled", target_date: "2026-10-14" }, EVENING_BEFORE)).toBe(2);
    expect(milestonePriority({ status: "scheduled", target_date: "2026-10-13" }, EVENING_BEFORE)).toBe(2);
    expect(milestonePriority({ status: "scheduled", target_date: "2026-10-13" }, JUST_BEFORE_THE_13TH_ENDS)).toBe(2);
    expect(milestonePriority({ status: "scheduled", target_date: "2026-10-13" }, THE_13TH_HAS_ENDED)).toBe(1);
  });

  it("does not put a submittal due tomorrow in the overdue tier the evening before", () => {
    expect(submittalPriority({ status: "submitted", due_date: "2026-10-14" }, EVENING_BEFORE)).toBe(1);
    expect(submittalPriority({ status: "submitted", due_date: "2026-10-13" }, JUST_BEFORE_THE_13TH_ENDS)).toBe(1);
    expect(submittalPriority({ status: "submitted", due_date: "2026-10-13" }, THE_13TH_HAS_ENDED)).toBe(0);
  });

  it("does not put an invoice due tomorrow in the overdue tier the evening before", () => {
    expect(invoicePriority({ status: "submitted", due_date: "2026-10-14" }, EVENING_BEFORE)).toBe(1);
    expect(invoicePriority({ status: "submitted", due_date: "2026-10-13" }, JUST_BEFORE_THE_13TH_ENDS)).toBe(1);
    expect(invoicePriority({ status: "submitted", due_date: "2026-10-13" }, THE_13TH_HAS_ENDED)).toBe(0);
  });

  it("agrees with isDeadlinePast for every record type at every instant", () => {
    const instants = [EVENING_BEFORE, JUST_BEFORE_THE_13TH_ENDS, THE_13TH_HAS_ENDED];
    const dates = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-14T00:30:00Z", "2026-10-14T02:00:00Z"];
    for (const now of instants) {
      for (const date of dates) {
        const past = isDeadlinePast(date, now);
        expect(milestonePriority({ status: "scheduled", target_date: date }, now) === 1, `milestone ${date} at ${now.toISOString()}`).toBe(past);
        expect(submittalPriority({ status: "submitted", due_date: date }, now) === 0, `submittal ${date} at ${now.toISOString()}`).toBe(past);
        expect(invoicePriority({ status: "submitted", due_date: date }, now) === 0, `invoice ${date} at ${now.toISOString()}`).toBe(past);
      }
    }
  });

  it("still compares a timestamp as an instant", () => {
    // 00:30 UTC on the 14th has passed at 01:00 UTC; 02:00 UTC has not.
    expect(invoicePriority({ status: "submitted", due_date: "2026-10-14T00:30:00Z" }, EVENING_BEFORE)).toBe(0);
    expect(invoicePriority({ status: "submitted", due_date: "2026-10-14T02:00:00Z" }, EVENING_BEFORE)).toBe(1);
  });

  it("keeps closed records and undated records out of the overdue tier", () => {
    expect(milestonePriority({ status: "complete", target_date: "2026-10-01" }, THE_13TH_HAS_ENDED)).toBe(3);
    expect(submittalPriority({ status: "accepted", due_date: "2026-10-01" }, THE_13TH_HAS_ENDED)).toBe(2);
    expect(invoicePriority({ status: "paid", due_date: "2026-10-01" }, THE_13TH_HAS_ENDED)).toBe(3);
    expect(milestonePriority({ status: "scheduled", target_date: null }, THE_13TH_HAS_ENDED)).toBe(2);
    expect(invoicePriority({ status: "draft", due_date: "not a date" }, THE_13TH_HAS_ENDED)).toBe(2);
  });
});

describe("reimbursement invoice register (lib/invoicing/invoice-records)", () => {
  const record = (dueDate: string) => ({
    id: `invoice-${dueDate}`,
    status: "submitted",
    amount: 1000,
    retention_percent: 0,
    retention_amount: 0,
    due_date: dueDate,
    funding_award_id: null,
  });

  it("does not count an invoice due tomorrow as overdue the evening before", () => {
    const summary = summarizeBillingInvoiceRecords([record("2026-10-14"), record("2026-10-13")], EVENING_BEFORE);
    expect(summary.overdueCount).toBe(0);
    expect(summary.overdueNetAmount).toBe(0);
  });

  it("counts the invoice due on the 13th once the 13th has ended everywhere", () => {
    expect(summarizeBillingInvoiceRecords([record("2026-10-13")], JUST_BEFORE_THE_13TH_ENDS).overdueCount).toBe(0);
    const summary = summarizeBillingInvoiceRecords([record("2026-10-14"), record("2026-10-13")], THE_13TH_HAS_ENDED);
    expect(summary.overdueCount).toBe(1);
    expect(summary.overdueNetAmount).toBe(1000);
  });

  it("filters and flags the same way the count does", () => {
    const rows = [record("2026-10-14"), record("2026-10-13")];
    expect(filterBillingInvoiceRecordsByOverdueStatus(rows, "overdue", EVENING_BEFORE)).toEqual([]);
    expect(
      filterBillingInvoiceRecordsByOverdueStatus(rows, "overdue", THE_13TH_HAS_ENDED).map((row) => row.due_date)
    ).toEqual(["2026-10-13"]);
    const queue = buildBillingInvoicePriorityQueue(rows, { now: EVENING_BEFORE });
    expect(queue.map((entry) => entry.isOverdue)).toEqual([false, false]);
    expect(queue.every((entry) => entry.priorityTier === 2)).toBe(true);
  });

  it("still compares a timestamp as an instant and leaves settled invoices alone", () => {
    expect(summarizeBillingInvoiceRecords([record("2026-10-14T00:30:00Z")], EVENING_BEFORE).overdueCount).toBe(1);
    expect(
      summarizeBillingInvoiceRecords([{ ...record("2026-10-01"), status: "paid" }], THE_13TH_HAS_ENDED).overdueCount
    ).toBe(0);
  });
});

describe("grants invoice flag (lib/grants/page-helpers)", () => {
  it("does not flag an invoice due tomorrow the evening before", () => {
    expect(isGrantsInvoiceOverdue("submitted", "2026-10-14", EVENING_BEFORE)).toBe(false);
    expect(isGrantsInvoiceOverdue("submitted", "2026-10-13", JUST_BEFORE_THE_13TH_ENDS)).toBe(false);
    expect(isGrantsInvoiceOverdue("submitted", "2026-10-13", THE_13TH_HAS_ENDED)).toBe(true);
  });

  it("leaves settled, undated and instant due dates as they were", () => {
    expect(isGrantsInvoiceOverdue("paid", "2026-10-01", THE_13TH_HAS_ENDED)).toBe(false);
    expect(isGrantsInvoiceOverdue("rejected", "2026-10-01", THE_13TH_HAS_ENDED)).toBe(false);
    expect(isGrantsInvoiceOverdue("submitted", null, THE_13TH_HAS_ENDED)).toBe(false);
    expect(isGrantsInvoiceOverdue("submitted", "not a date", THE_13TH_HAS_ENDED)).toBe(false);
    expect(isGrantsInvoiceOverdue("submitted", "2026-10-14T00:30:00Z", EVENING_BEFORE)).toBe(true);
  });
});

describe("invoicing register row flag (invoicing-page-helpers)", () => {
  it("does not flag an invoice due tomorrow the evening before", () => {
    expect(isInvoicingRowOverdue("submitted", "2026-10-14", EVENING_BEFORE)).toBe(false);
    expect(isInvoicingRowOverdue("submitted", "2026-10-13", JUST_BEFORE_THE_13TH_ENDS)).toBe(false);
    expect(isInvoicingRowOverdue("submitted", "2026-10-13", THE_13TH_HAS_ENDED)).toBe(true);
  });

  it("leaves settled, undated and instant due dates as they were", () => {
    expect(isInvoicingRowOverdue("paid", "2026-10-01", THE_13TH_HAS_ENDED)).toBe(false);
    expect(isInvoicingRowOverdue("rejected", "2026-10-01", THE_13TH_HAS_ENDED)).toBe(false);
    expect(isInvoicingRowOverdue("submitted", undefined, THE_13TH_HAS_ENDED)).toBe(false);
    expect(isInvoicingRowOverdue("submitted", "2026-10-14T00:30:00Z", EVENING_BEFORE)).toBe(true);
  });
});

describe("workspace relink queue (lib/operations/workspace-summary)", () => {
  /**
   * Two projects, each with one award and one unlinked invoice: an exact
   * relink. An overdue invoice leads the queue; otherwise the larger one does.
   * The small invoice is due on the 13th, so which project leads says whether
   * the queue called it overdue.
   */
  function relinkLead(now: Date) {
    const projects = [
      { id: "project-small", name: "Small invoice project", status: "active", delivery_phase: "delivery", updated_at: "2026-10-01T10:00:00.000Z" },
      { id: "project-large", name: "Large invoice project", status: "active", delivery_phase: "delivery", updated_at: "2026-10-01T11:00:00.000Z" },
    ];
    const summary = buildWorkspaceOperationsSummaryFromSourceRows({
      projects,
      plans: [],
      programs: [],
      reports: [],
      fundingOpportunities: [],
      fundingAwards: projects.map((project) => ({
        id: `award-${project.id}`,
        project_id: project.id,
        funding_opportunity_id: null,
        title: `Award for ${project.name}`,
        awarded_amount: 100000,
        updated_at: "2026-10-01T09:00:00.000Z",
      })),
      fundingInvoices: [
        {
          id: "invoice-small",
          project_id: "project-small",
          funding_award_id: null,
          amount: 1000,
          retention_percent: null,
          retention_amount: null,
          status: "submitted",
          due_date: "2026-10-13",
        },
        {
          id: "invoice-large",
          project_id: "project-large",
          funding_award_id: null,
          amount: 50000,
          retention_percent: null,
          retention_amount: null,
          status: "submitted",
          due_date: "2026-12-01",
        },
      ],
      projectFundingProfiles: projects.map((project) => ({
        project_id: project.id,
        funding_need_amount: 500000,
        local_match_need_amount: 50000,
      })),
      now,
    });
    const item = summary.commandQueue.find((entry) => entry.key === "relink-project-invoice-awards");
    expect(item, "the relink item was not produced").toBeDefined();
    return item?.targetProjectId;
  }

  it("does not lead with an invoice due on the 13th while the 13th is still under way somewhere", () => {
    expect(relinkLead(EVENING_BEFORE)).toBe("project-large");
    expect(relinkLead(JUST_BEFORE_THE_13TH_ENDS)).toBe("project-large");
  });

  it("leads with it once the 13th has ended everywhere", () => {
    expect(relinkLead(THE_13TH_HAS_ENDED)).toBe("project-small");
  });
});
