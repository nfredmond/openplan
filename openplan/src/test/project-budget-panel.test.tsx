import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildProjectBudgetSnapshot } from "@/lib/projects/budget";
import { ProjectBudgetPanel } from "@/app/(app)/projects/[projectId]/_components/project-budget-panel";

vi.mock("@/components/projects/project-spend-entry-form", () => ({
  ProjectSpendEntryForm: () => <div data-testid="project-spend-entry-form" />,
}));

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const D1 = "11111111-1111-4111-8111-111111111111";
const D2 = "22222222-2222-4222-8222-222222222222";

const NO_PENDING = { deliverableBudgetColumns: false, spendEntries: false, clientInvoices: false };

describe("ProjectBudgetPanel", () => {
  it("names partial coverage plainly and refuses verdicts without a basis", () => {
    const snapshot = buildProjectBudgetSnapshot({
      project: { budget_amount: 20000 },
      deliverables: [
        { id: D1, title: "Existing Conditions Memo", budget_amount: 5000, percent_complete: 40 },
        { id: D2, title: "Corridor Map Set", budget_amount: null, percent_complete: null },
      ],
      spendEntries: [{ deliverable_id: D1, amount: 2000 }],
      billedLines: [{ deliverable_id: D2, amount: 750, invoice_status: "sent" }],
    });

    render(
      <ProjectBudgetPanel
        projectId={PROJECT_ID}
        snapshot={snapshot}
        pendingSchema={NO_PENDING}
        deliverableOptions={[{ id: D1, title: "Existing Conditions Memo" }]}
      />
    );

    // The coverage copy names the partial basis — never an implied total.
    expect(screen.getByText(/1 of 2 deliverables budgeted\./i)).toBeInTheDocument();
    expect(screen.getAllByText(/partial figure, not a project total/i).length).toBeGreaterThan(0);

    // The budgeted deliverable gets a verdict; the unbudgeted one gets the
    // honest refusal, not an invented percentage.
    expect(screen.getByText("On pace")).toBeInTheDocument();
    expect(screen.getByText("No budget entered")).toBeInTheDocument();
    expect(
      screen.getByText(/No budget entered for this deliverable, so burn cannot be judged\./i)
    ).toBeInTheDocument();

    // Money decomposition stays visible: billed (sent line) + direct spend.
    expect(screen.getByText("$750.00")).toBeInTheDocument();
    expect(screen.getByText("$2,000.00")).toBeInTheDocument();
    expect(screen.getByText("$2,750.00")).toBeInTheDocument();

    expect(screen.getByTestId("project-spend-entry-form")).toBeInTheDocument();
  });

  it("says when nothing is budgeted instead of showing zeros as facts", () => {
    const snapshot = buildProjectBudgetSnapshot({
      project: null,
      deliverables: [{ id: D1, title: "Memo", budget_amount: null, percent_complete: null }],
      spendEntries: [],
      billedLines: [],
    });

    render(
      <ProjectBudgetPanel
        projectId={PROJECT_ID}
        snapshot={snapshot}
        pendingSchema={NO_PENDING}
        deliverableOptions={[]}
      />
    );

    expect(screen.getByText("Not entered")).toBeInTheDocument();
    expect(screen.getByText("None entered")).toBeInTheDocument();
    expect(screen.getByText(/0 of 1 deliverables budgeted\./i)).toBeInTheDocument();
    expect(screen.getByText(/Enter a project budget to see remaining against it\./i)).toBeInTheDocument();
  });

  it("discloses each pending migration instead of rendering empty money", () => {
    const snapshot = buildProjectBudgetSnapshot({
      project: null,
      deliverables: [],
      spendEntries: [],
      billedLines: [],
    });

    render(
      <ProjectBudgetPanel
        projectId={PROJECT_ID}
        snapshot={snapshot}
        pendingSchema={{ deliverableBudgetColumns: true, spendEntries: true, clientInvoices: true }}
        deliverableOptions={[]}
      />
    );

    expect(screen.getByText(/Deliverable budget fields will appear after/i)).toBeInTheDocument();
    expect(screen.getByText(/spend ledger will appear after/i)).toBeInTheDocument();
    expect(screen.getByText(/client-invoice lines will appear after/i)).toBeInTheDocument();
  });
});
