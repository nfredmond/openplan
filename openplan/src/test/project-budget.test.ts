import { describe, expect, it } from "vitest";
import {
  buildDeliverableBudgetSummary,
  buildProjectBudgetSnapshot,
  DELIVERABLE_PACE_LABELS,
  deliverableBudgetPaceTone,
  PACE_TOLERANCE_POINTS,
  type BilledLineLike,
  type SpendEntryLike,
} from "@/lib/projects/budget";

const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";

function sentLine(deliverableId: string | null, amount: number | string, invoiceStatus = "paid"): BilledLineLike {
  return { deliverable_id: deliverableId, amount, invoice_status: invoiceStatus };
}

function spend(deliverableId: string | null, amount: number | string): SpendEntryLike {
  return { deliverable_id: deliverableId, amount };
}

describe("buildDeliverableBudgetSummary — pace gates", () => {
  it("refuses any verdict without a budget", () => {
    const summary = buildDeliverableBudgetSummary(
      { id: D1, title: "Memo", budget_amount: null, percent_complete: 50 },
      [spend(D1, 400)],
      [sentLine(D1, 600)]
    );

    expect(summary.paceStatus).toBe("no_budget");
    expect(summary.budgetAmount).toBeNull();
    expect(summary.remaining).toBeNull();
    expect(summary.burnPercent).toBeNull();
    // Money is still reported honestly even without a budget.
    expect(summary.actualToDate).toBe(1000);
    expect(summary.paceDetail).toMatch(/no budget/i);
  });

  it("refuses a pace verdict without an entered percent_complete", () => {
    const summary = buildDeliverableBudgetSummary(
      { id: D1, budget_amount: 1000, percent_complete: null },
      [spend(D1, 300)],
      []
    );

    expect(summary.paceStatus).toBe("no_progress_basis");
    expect(summary.burnPercent).toBe(30);
    expect(summary.paceDetail).toMatch(/percent complete/i);
  });

  it("is on pace inside the tolerance band", () => {
    const summary = buildDeliverableBudgetSummary(
      { id: D1, budget_amount: 1000, percent_complete: 45 },
      [],
      [sentLine(D1, 500)]
    );

    expect(summary.burnPercent).toBe(50);
    expect(summary.paceStatus).toBe("on_pace");
    expect(summary.paceDetail).toContain(`${PACE_TOLERANCE_POINTS} points`);
  });

  it("is still on pace at both edges of the band, inclusive", () => {
    // burn 50%, progress 40% → drift exactly +PACE_TOLERANCE_POINTS.
    const upperEdge = buildDeliverableBudgetSummary(
      { id: D1, budget_amount: 1000, percent_complete: 40 },
      [],
      [sentLine(D1, 500)]
    );
    expect(upperEdge.paceStatus).toBe("on_pace");

    // burn 50%, progress 60% → drift exactly -PACE_TOLERANCE_POINTS.
    const lowerEdge = buildDeliverableBudgetSummary(
      { id: D1, budget_amount: 1000, percent_complete: 60 },
      [],
      [sentLine(D1, 500)]
    );
    expect(lowerEdge.paceStatus).toBe("on_pace");
  });

  it("flags burn ahead of progress just past the band edge", () => {
    // burn 50.1%, progress 40% → drift 10.1 > 10.
    const summary = buildDeliverableBudgetSummary(
      { id: D1, budget_amount: 1000, percent_complete: 40 },
      [spend(D1, 501)],
      []
    );

    expect(summary.burnPercent).toBe(50.1);
    expect(summary.paceStatus).toBe("billed_ahead_of_progress");
  });

  it("flags billing behind progress just past the band edge", () => {
    // burn 29.9%, progress 40% → drift -10.1 < -10.
    const summary = buildDeliverableBudgetSummary(
      { id: D1, budget_amount: 1000, percent_complete: 40 },
      [],
      [sentLine(D1, 299)]
    );

    expect(summary.burnPercent).toBe(29.9);
    expect(summary.paceStatus).toBe("billed_behind_progress");
  });

  it("is over budget when actual exceeds budget, even with percent entered", () => {
    const summary = buildDeliverableBudgetSummary(
      { id: D1, budget_amount: 1000, percent_complete: 90 },
      [spend(D1, 600)],
      [sentLine(D1, 500)]
    );

    expect(summary.paceStatus).toBe("over_budget");
    expect(summary.actualToDate).toBe(1100);
    expect(summary.remaining).toBe(-100);
    expect(summary.paceDetail).toContain("$1100.00");
  });

  it("is over budget even without a progress basis — the fact needs no percent", () => {
    const summary = buildDeliverableBudgetSummary(
      { id: D1, budget_amount: 100, percent_complete: null },
      [spend(D1, 150)],
      []
    );

    expect(summary.paceStatus).toBe("over_budget");
  });

  it("gives no pace verdict on a zero budget with zero actual", () => {
    const summary = buildDeliverableBudgetSummary(
      { id: D1, budget_amount: 0, percent_complete: 50 },
      [],
      []
    );

    expect(summary.paceStatus).toBe("no_progress_basis");
    expect(summary.burnPercent).toBeNull();
    expect(summary.paceDetail).toMatch(/zero budget/i);
  });
});

describe("buildDeliverableBudgetSummary — billed vs spend decomposition", () => {
  it("decomposes actual into billed (sent/paid only) plus ledger spend", () => {
    const summary = buildDeliverableBudgetSummary(
      { id: D1, budget_amount: "5000.00", percent_complete: "40" },
      [spend(D1, "750.25"), spend(D1, 249.75)],
      [
        sentLine(D1, 400, "submitted"),
        sentLine(D1, 350, "approved_for_payment"),
        sentLine(D1, 250, "paid"),
      ]
    );

    expect(summary.billedToDate).toBe(1000);
    expect(summary.spendToDate).toBe(1000);
    expect(summary.actualToDate).toBe(2000);
    expect(summary.budgetAmount).toBe(5000);
    expect(summary.remaining).toBe(3000);
    expect(summary.burnPercent).toBe(40);
    expect(summary.paceStatus).toBe("on_pace");
  });

  it("counts client-invoice 'sent' lines as billed — both invoicing vocabularies are covered", () => {
    const summary = buildDeliverableBudgetSummary(
      { id: D1, budget_amount: 1000, percent_complete: 40 },
      [],
      [sentLine(D1, 250, "sent"), sentLine(D1, 150, "paid")]
    );

    expect(summary.billedToDate).toBe(400);
    expect(summary.actualToDate).toBe(400);
    expect(summary.paceStatus).toBe("on_pace");
  });

  it("keeps draft and internal-review lines out of billed, disclosed as draftedAmount", () => {
    const summary = buildDeliverableBudgetSummary(
      { id: D1, budget_amount: 1000, percent_complete: 10 },
      [],
      [
        sentLine(D1, 100, "paid"),
        sentLine(D1, 200, "draft"),
        sentLine(D1, 300, "internal_review"),
        sentLine(D1, 999, "rejected"),
      ]
    );

    expect(summary.billedToDate).toBe(100);
    expect(summary.draftedAmount).toBe(500);
    // Rejected lines count nowhere.
    expect(summary.actualToDate).toBe(100);
  });

  it("ignores billed lines and spend attributed to other deliverables", () => {
    const summary = buildDeliverableBudgetSummary(
      { id: D1, budget_amount: 1000, percent_complete: 20 },
      [spend(D1, 100), spend(D2, 900), spend(null, 50)],
      [sentLine(D1, 100), sentLine(D2, 900), sentLine(null, 50)]
    );

    expect(summary.spendToDate).toBe(100);
    expect(summary.billedToDate).toBe(100);
    expect(summary.actualToDate).toBe(200);
  });
});

describe("buildProjectBudgetSnapshot", () => {
  it("keeps the deliverable budget total null until at least one deliverable is budgeted", () => {
    const snapshot = buildProjectBudgetSnapshot({
      project: { budget_amount: null },
      deliverables: [
        { id: D1, title: "Memo", budget_amount: null },
        { id: D2, title: "Map set", budget_amount: null },
      ],
      spendEntries: [spend(D1, 100)],
      billedLines: [],
    });

    expect(snapshot.deliverableBudgetTotal).toBeNull();
    expect(snapshot.budgetCoverage).toBe("none");
    expect(snapshot.statedBudget).toBeNull();
    expect(snapshot.remainingAgainstStatedBudget).toBeNull();
    expect(snapshot.spendToDate).toBe(100);
  });

  it("labels partial coverage and never implies a project total from it", () => {
    const snapshot = buildProjectBudgetSnapshot({
      project: { budget_amount: 20000 },
      deliverables: [
        { id: D1, title: "Memo", budget_amount: 5000, percent_complete: 50 },
        { id: D2, title: "Map set", budget_amount: null },
      ],
      spendEntries: [spend(D1, 1000)],
      billedLines: [sentLine(D2, 500)],
    });

    expect(snapshot.budgetCoverage).toBe("partial");
    // The partial total is the sum of what IS budgeted, not a project total.
    expect(snapshot.deliverableBudgetTotal).toBe(5000);
    expect(snapshot.attention).toContainEqual(expect.stringContaining("1 of 2 deliverables have budgets"));
    expect(snapshot.attention).toContainEqual(expect.stringContaining("not a project total"));
  });

  it("reports complete coverage and stated-budget remaining", () => {
    const snapshot = buildProjectBudgetSnapshot({
      project: { budget_amount: "10000" },
      deliverables: [
        { id: D1, budget_amount: 4000, percent_complete: 25 },
        { id: D2, budget_amount: 6000, percent_complete: 0 },
      ],
      spendEntries: [spend(D1, 1000)],
      billedLines: [sentLine(D2, 500), sentLine(null, 250)],
    });

    expect(snapshot.budgetCoverage).toBe("complete");
    expect(snapshot.deliverableBudgetTotal).toBe(10000);
    expect(snapshot.statedBudget).toBe(10000);
    // Project-level billing (null deliverable) counts at the project level.
    expect(snapshot.billedToDate).toBe(750);
    expect(snapshot.spendToDate).toBe(1000);
    expect(snapshot.actualToDate).toBe(1750);
    expect(snapshot.remainingAgainstStatedBudget).toBe(8250);
  });

  it("ignores billed lines that reference deliverables outside the project, and says so", () => {
    const UNKNOWN = "99999999-9999-4999-8999-999999999999";
    const snapshot = buildProjectBudgetSnapshot({
      project: { budget_amount: 1000 },
      deliverables: [{ id: D1, budget_amount: 1000, percent_complete: 10 }],
      spendEntries: [],
      billedLines: [sentLine(D1, 100), sentLine(UNKNOWN, 5000)],
    });

    expect(snapshot.billedToDate).toBe(100);
    expect(snapshot.actualToDate).toBe(100);
    expect(snapshot.attention).toContainEqual(
      expect.stringContaining("1 billed line references deliverables outside this project")
    );
  });

  it("surfaces over-budget deliverables and an exceeded stated budget in attention", () => {
    const snapshot = buildProjectBudgetSnapshot({
      project: { budget_amount: 1000 },
      deliverables: [{ id: D1, title: "Memo", budget_amount: 500, percent_complete: 50 }],
      spendEntries: [spend(D1, 700), spend(null, 400)],
      billedLines: [],
    });

    expect(snapshot.deliverables[0]?.paceStatus).toBe("over_budget");
    expect(snapshot.attention).toContainEqual(expect.stringContaining("Memo"));
    expect(snapshot.attention).toContainEqual(
      expect.stringContaining("exceeds the stated project budget")
    );
    expect(snapshot.remainingAgainstStatedBudget).toBe(-100);
  });

  it("warns when deliverable budgets add up past the stated budget", () => {
    const snapshot = buildProjectBudgetSnapshot({
      project: { budget_amount: 1000 },
      deliverables: [
        { id: D1, budget_amount: 800 },
        { id: D2, budget_amount: 700 },
      ],
      spendEntries: [],
      billedLines: [],
    });

    expect(snapshot.attention).toContainEqual(
      expect.stringContaining("more than the stated project budget")
    );
  });

  it("maps pace statuses to chip tones and honest labels", () => {
    expect(deliverableBudgetPaceTone("over_budget")).toBe("warning");
    expect(deliverableBudgetPaceTone("billed_ahead_of_progress")).toBe("warning");
    expect(deliverableBudgetPaceTone("on_pace")).toBe("success");
    expect(deliverableBudgetPaceTone("billed_behind_progress")).toBe("info");
    // The refusals stay neutral — a missing basis is not an alarm.
    expect(deliverableBudgetPaceTone("no_budget")).toBe("neutral");
    expect(deliverableBudgetPaceTone("no_progress_basis")).toBe("neutral");
    expect(DELIVERABLE_PACE_LABELS.no_budget).toBe("No budget entered");
    expect(DELIVERABLE_PACE_LABELS.no_progress_basis).toBe("No progress basis");
  });

  it("handles empty inputs without inventing anything", () => {
    const snapshot = buildProjectBudgetSnapshot({
      project: null,
      deliverables: null,
      spendEntries: null,
      billedLines: null,
    });

    expect(snapshot).toMatchObject({
      statedBudget: null,
      deliverableBudgetTotal: null,
      budgetCoverage: "none",
      billedToDate: 0,
      spendToDate: 0,
      actualToDate: 0,
      remainingAgainstStatedBudget: null,
      deliverables: [],
      attention: [],
    });
  });
});
