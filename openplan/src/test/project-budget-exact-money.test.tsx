import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildDeliverableBudgetSummary, buildProjectBudgetSnapshot } from "@/lib/projects/budget";
import { buildProjectPortfolioSummary } from "@/lib/projects/portfolio";
import type { PortfolioLane, ProjectPortfolioInputs } from "@/lib/projects/portfolio-queries";
import { compareMoney, moneyCents, moneyFromCents, subtractMoney, moneyPercent, compareMoneyPercent } from "@/lib/money/optional-amount";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { formatMoney, formatMoneyRange } from "@/lib/money/format";
import { fmtCurrency } from "@/app/(app)/projects/[projectId]/_components/_helpers";
import { ProjectBudgetPanel } from "@/app/(app)/projects/[projectId]/_components/project-budget-panel";

vi.mock("@/components/projects/project-spend-entry-form", () => ({ ProjectSpendEntryForm: () => null }));

// This reference reads literal decimal digits independently of the production parser.
const reference = (text: string) => BigInt(text.replace(".", ""));
const cases: Array<[number, string, string]> = [
  [10000, "0.01", "100.00"], [10000, "19999.99", "199999900.00"],
  [2, "999999999999.99", "1999999999999.98"], [19, "999999999999.99", "18999999999999.81"],
  [33, "999999999999.99", "32999999999999.67"], [49, "999999999999.99", "48999999999999.51"],
  [79, "999999999999.99", "78999999999999.21"], [89, "999999999999.99", "88999999999999.11"],
  [90, "999999999999.99", "89999999999999.10"], [101, "999999999999.99", "100999999999998.99"],
  [1001, "999999999999.99", "1000999999999989.99"],
];

function snapshot(count: number, amount: string) {
  return buildProjectBudgetSnapshot({ project: { budget_amount: null },
    deliverables: [{ id: "d", title: "Study", budget_amount: null }],
    spendEntries: Array.from({ length: count }, () => ({ deliverable_id: "d", amount })),
    billedLines: [],
  });
}

function lane<T>(rows: T[]): PortfolioLane<T> {
  return { byProjectId: new Map([["p", rows]]), outcome: { rowCount: rows.length, pending: false, failed: false, truncated: false } };
}

function portfolio(budget: string | null, count = 101, actual = "100999999999998.98") {
  const inputs: ProjectPortfolioInputs = {
    projectIds: ["p"], projectsTruncated: false, projectBudgets: lane([{ id: "p", budget_amount: budget }]),
    deliverables: lane(Array.from({ length: count }, (_, index) => ({ id: `d${index}`, project_id: "p", title: "Study", status: null, due_date: null, budget_amount: "999999999999.99" }))),
    milestones: lane([]), submittals: lane([]),
    spendEntries: lane([{ project_id: "p", deliverable_id: null, amount: actual }]),
    billedLines: lane([]), deliverableBudgetColumnsPending: false, reads: new ReadFailureLog(), rowLimitPerLane: 10000,
  };
  return buildProjectPortfolioSummary({ projects: [{ id: "p", name: "Study", status: "active", deliveryPhase: "planning", updatedAt: "2026-10-16" }], inputs, now: new Date("2026-10-16") }).rows[0].burn;
}

describe("exact project budget money", () => {
  it("reconstructs safe and beyond-range accepted totals and JSON without losing cents", () => {
    for (const [count, amount, expected] of cases) {
      const result = snapshot(count, amount);
      const independentlyComputed = reference(amount) * BigInt(count);
      expect(independentlyComputed).toBe(reference(expected));
      expect(moneyCents(result.actualToDate), `${count} actual`).toBe(independentlyComputed);
      expect(moneyCents(result.deliverables[0].actualToDate)).toBe(independentlyComputed);
      const roundtrip = JSON.parse(JSON.stringify(result)) as typeof result;
      expect(moneyCents(roundtrip.actualToDate)).toBe(independentlyComputed);
      if (typeof result.actualToDate === "number") expect(result.actualToDate.toFixed(2)).toBe(expected);
      expect(compareMoney(result.actualToDate, expected)).toBe(0);
    }
    expect(typeof snapshot(101, "999999999999.99").actualToDate).toBe("string");
    expect(snapshot(10000, "0.01").actualToDate).toBe(100);
  });

  it("keeps billing, drafts, attribution, budgets and remaining amounts reconstructible", () => {
    const rows = Array.from({ length: 101 }, () => ({ deliverable_id: "d", amount: "999999999999.99" }));
    const result = buildProjectBudgetSnapshot({ project: { budget_amount: "100999999999999.00" },
      deliverables: Array.from({ length: 101 }, (_, i) => ({ id: i ? `other${i}` : "d", budget_amount: "999999999999.99" })),
      spendEntries: [...rows, { deliverable_id: "stale", amount: "0.01" }],
      billedLines: [...rows.map(row => ({ ...row, invoice_status: "paid" })), ...rows.map(row => ({ ...row, invoice_status: "draft" })),
        { deliverable_id: null, amount: "0.02", invoice_status: "sent" },
        { deliverable_id: "unknown", amount: "900.00", invoice_status: "paid" }],
    });
    expect(moneyCents(result.actualToDate)).toBe(reference("100999999999999.00"));
    expect(moneyCents(result.billedToDate)).toBe(reference("100999999999999.01"));
    expect(moneyCents(result.deliverables[0].draftedAmount)).toBe(reference("100999999999998.99"));
    expect(moneyCents(result.deliverableBudgetTotal)).toBe(reference("100999999999998.99"));
    expect(result.remainingAgainstStatedBudget).toBe(0);
    expect(moneyCents(result.deliverables[0].remaining)).toBe(-reference("99999999999999.00"));
    expect(result.attention.join(" ")).toContain("1 billed line references");
    expect(subtractMoney("100999999999999.00", result.deliverableBudgetTotal!)).toBe(0.01);
    expect(compareMoney("100999999999998.99", "100999999999998.98")).toBe(1);
    expect(moneyFromCents(reference("100999999999998.99"))).toBe("100999999999998.99");
  });

  it("keeps null and zero distinct and rejects invalid or sub-cent amounts", () => {
    const absent = snapshot(0, "0.00");
    expect(absent.statedBudget).toBeNull();
    expect(absent.deliverableBudgetTotal).toBeNull();
    expect(absent.deliverables[0].paceStatus).toBe("no_budget");
    const zero = buildDeliverableBudgetSummary({ id: "d", budget_amount: 0, percent_complete: 50 }, [], []);
    expect(zero.budgetAmount).toBe(0);
    expect(zero.remaining).toBe(0);
    expect(zero.burnPercent).toBeNull();
    expect(zero.paceStatus).toBe("no_progress_basis");
    for (const invalid of ["1bad", "", "0.001", NaN, null, -1]) {
      expect(() => buildProjectBudgetSnapshot({ project: null, deliverables: [], spendEntries: [{ amount: invalid }] })).toThrow();
    }
    expect(() => buildDeliverableBudgetSummary({ budget_amount: "bad" }, [], [])).toThrow("Invalid optional money");
  });

  it("judges exact over-budget and ten-point boundaries before percent display rounding", () => {
    const summary = (amount: string, progress: number | null = 40) => buildDeliverableBudgetSummary({ id: "d", budget_amount: "1000000.00", percent_complete: progress }, [{ deliverable_id: "d", amount }], []);
    expect(summary("500000.00").paceStatus).toBe("on_pace");
    expect(summary("500000.01").burnPercent).toBe(50);
    expect(summary("500000.01").paceStatus).toBe("billed_ahead_of_progress");
    expect(summary("300000.00").paceStatus).toBe("on_pace");
    expect(summary("299999.99").paceStatus).toBe("billed_behind_progress");
    expect(summary("1000000.01", null).paceStatus).toBe("over_budget");
    expect(summary("100.00", null).paceStatus).toBe("no_progress_basis");
    const exact = buildDeliverableBudgetSummary({ id: "d", budget_amount: "100999999999998.98" }, [{ deliverable_id: "d", amount: "100999999999998.99" }], []);
    expect(exact.paceStatus).toBe("over_budget");
    expect(exact.remaining).toBe(-0.01);
    expect(summary("100100.00", 20.01).paceStatus).toBe("on_pace");
  });

  it("carries exact portfolio bases and burn through complete and stated budgets", () => {
    const complete = portfolio(null);
    expect(complete.budgetAmount).toBe("100999999999998.99");
    expect(moneyCents(complete.actualToDate)).toBe(reference("100999999999998.98"));
    expect(complete.basis).toBe("deliverable_budgets");
    expect(complete.burnPercent).toBe(100);
    const stated = portfolio("100999999999998.99");
    expect(stated.budgetAmount).toBe("100999999999998.99");
    expect(stated.basis).toBe("stated_budget");
    expect(stated.burnPercent).toBe(100);
    expect(portfolio("200.00", 1, "2.01").burnPercent).toBe(1.01);
  });

  it("refuses invalid percentage bases and nonfinite formatter inputs", () => {
    expect(() => moneyPercent(1, 0)).toThrow("positive budget");
    expect(() => moneyPercent(1, -1)).toThrow("positive budget");
    expect(() => compareMoneyPercent(1, 10, NaN)).toThrow("Invalid percentage");
    expect(formatMoney(Infinity, { precision: "cents" })).toBe("Not recorded");
    expect(formatMoney("1e309", { precision: "cents" })).toBe("Not recorded");
  });

  it("formats exact decimal amounts in currency minor units with existing rounding modes", () => {
    const cents = { precision: "cents" } as const;
    expect(formatMoney("100999999999998.99", cents)).toBe("$100,999,999,999,998.99");
    expect(formatMoney("100999999999998.99", { precision: "whole" })).toBe("$100,999,999,999,999");
    expect(formatMoney("100999999999998.99", { precision: "auto", currency: "EUR" })).toBe("€100,999,999,999,998.99");
    expect(formatMoney("100999999999998.00", { precision: "auto" })).toBe("$100,999,999,999,998");
    expect(formatMoney("100999999999998.50", { ...cents, currency: "JPY" })).toBe("¥100,999,999,999,999");
    expect(formatMoney("100999999999998.995", { ...cents, currency: "KWD", currencyDisplay: "code" }).replace(/\s/g, " ")).toBe("KWD 100,999,999,999,998.995");
    expect(formatMoney("-0.005", cents)).toBe("-$0.01");
    expect(formatMoney("-0.004", cents)).toBe("-$0.00");
    expect(formatMoney(-0, cents)).toBe("-$0.00");
    expect(formatMoney("-12.50", { precision: "whole" })).toBe("-$13");
    expect(formatMoney("1e-2", cents)).toBe("$0.01");
    expect(formatMoney("1.005", cents)).toBe("$1.01");
    expect(formatMoney("12.50", { ...cents, currency: "invalid-code" })).toBe("INVALID-CODE 12.50");
    expect(formatMoney(null, { ...cents, absent: "Unknown" })).toBe("Unknown");
    expect(formatMoney("bad", cents)).toBe("Not recorded");
    expect(formatMoneyRange("100999999999998.99", "100999999999998.98", cents)).toBe("$100,999,999,999,998.98–$100,999,999,999,998.99");
    expect(fmtCurrency("100999999999998.99")).toBe("$100,999,999,999,998.99");
    expect(fmtCurrency(null)).toBe("Not recorded");
  });

  it("renders exact project totals, negative remaining and draft money in the DOM", () => {
    const total = "100999999999998.99";
    const result = buildProjectBudgetSnapshot({ project: { budget_amount: "100999999999998.98" },
      deliverables: [{ id: "d", title: "Study", budget_amount: total }],
      spendEntries: [{ deliverable_id: "d", amount: total }],
      billedLines: [{ deliverable_id: "d", amount: total, invoice_status: "sent" }, { deliverable_id: "d", amount: total, invoice_status: "draft" }],
    });
    const { container } = render(<ProjectBudgetPanel projectId="p" snapshot={result} pendingSchema={{ deliverableBudgetColumns: false, spendEntries: false, clientInvoices: false }} deliverableOptions={[]} />);
    expect(container.textContent).toContain("$100,999,999,999,998.99");
    expect(container.textContent).toContain("-$0.01 remaining");
    expect(container.textContent).toContain("Drafted (not billed) $100,999,999,999,998.99");
    expect(container.textContent).not.toContain("$100,999,999,999,999.00");
  });
});
