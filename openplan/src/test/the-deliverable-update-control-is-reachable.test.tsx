import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import {
  loadProjectBudgetInputs,
  type ProjectBudgetQuerySupabaseLike,
} from "@/lib/projects/budget-queries";
import { buildProjectBudgetSnapshot, type DeliverableBudgetSummary } from "@/lib/projects/budget";
import { buildProjectControlsSummary } from "@/lib/projects/controls";
import { ProjectDeliveryBoard } from "@/app/(app)/projects/[projectId]/_components/project-delivery-board";
import type { ProjectRow } from "@/app/(app)/projects/[projectId]/_components/_types";

/**
 * The deliverable branch of PATCH /api/projects/[projectId]/records/[recordId]
 * shipped complete and unreachable: no surface in the product called it, so a
 * deliverable's status, budget and progress were writable only at creation.
 *
 * This proves the path to the unit, not the unit. Every prop the board reads
 * for the deliverable lane is produced by the REAL loader and the REAL budget
 * builder over raw project_deliverables rows — never a hand-written
 * DeliverableBudgetSummary. A described fixture would prove the assertion; a
 * built one proves the feature. (The board itself is mounted unmocked by the
 * real page in project-detail-page.test.tsx, which closes the rest of the
 * chain from /projects/[projectId] down to this control.)
 */

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BUDGETED_DELIVERABLE_ID = "11111111-1111-4111-8111-111111111111";
const BARE_DELIVERABLE_ID = "22222222-2222-4222-8222-222222222222";

/** Raw project_deliverables rows, exactly as PostgREST would hand them back. */
const DELIVERABLE_ROWS = [
  {
    id: BUDGETED_DELIVERABLE_ID,
    title: "Existing Conditions Memo",
    summary: "Baseline write-up",
    owner_label: "Planning",
    due_date: "2026-09-01",
    status: "in_progress",
    created_at: "2026-08-01T00:00:00.000Z",
    budget_amount: "5000.00",
    percent_complete: "40",
  },
  {
    id: BARE_DELIVERABLE_ID,
    title: "Corridor Map Set",
    summary: null,
    owner_label: null,
    due_date: null,
    status: "not_started",
    created_at: "2026-08-02T00:00:00.000Z",
    budget_amount: null,
    percent_complete: null,
  },
];

type Recorded = { table: string; columns: string };

/**
 * A stand-in for the untyped Supabase client that answers the four reads
 * loadProjectBudgetInputs performs, recording each projection string. It does
 * NOT filter by the requested columns — that is exactly why the projection is
 * asserted directly below rather than inferred from the rendered output.
 */
function makeSupabase(recorded: Recorded[]): ProjectBudgetQuerySupabaseLike {
  const resultForTable = (table: string): { data: unknown[] | null; error: null } | { data: unknown; error: null } => {
    switch (table) {
      case "project_deliverables":
        return { data: DELIVERABLE_ROWS, error: null };
      case "projects":
        return { data: { budget_amount: 20000 }, error: null };
      case "project_spend_entries":
        return { data: [{ id: "s1", deliverable_id: BUDGETED_DELIVERABLE_ID, entry_date: null, amount: "2000", description: "Survey", vendor_label: null, created_at: "2026-08-01T00:00:00.000Z" }], error: null };
      default:
        return { data: [], error: null };
    }
  };

  return {
    from(table: string) {
      const result = resultForTable(table);
      const builder = {
        select(columns: string) {
          recorded.push({ table, columns });
          return builder;
        },
        eq: () => builder,
        in: () => builder,
        order: () => builder,
        limit: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
      };
      return builder as unknown as ReturnType<ProjectBudgetQuerySupabaseLike["from"]>;
    },
  } as unknown as ProjectBudgetQuerySupabaseLike;
}

const PROJECT: ProjectRow = {
  id: PROJECT_ID,
  workspace_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "Corridor Study",
  summary: null,
  status: "active",
  plan_type: "corridor",
  delivery_phase: "initiation",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  rtp_posture: null,
  rtp_posture_updated_at: null,
  latitude: null,
  longitude: null,
  place_source: null,
  place_kind: null,
  place_ref: null,
  place_label: null,
  place_country_code: null,
  place_subdivision_code: null,
  place_min_lon: null,
  place_min_lat: null,
  place_max_lon: null,
  place_max_lat: null,
  place_geometry_geojson: null,
  place_set_at: null,
};

/**
 * Composes the board's deliverable props the way the page does — real loader,
 * real snapshot builder, real controls builder.
 */
async function renderBoardFromRealBuilders() {
  const recorded: Recorded[] = [];
  const budgetInputs = await loadProjectBudgetInputs(makeSupabase(recorded), PROJECT_ID);
  const snapshot = buildProjectBudgetSnapshot({
    project: { budget_amount: budgetInputs.statedBudgetAmount },
    deliverables: budgetInputs.deliverables,
    spendEntries: budgetInputs.spendEntries,
    billedLines: budgetInputs.billedLines,
  });
  const budgetSummaryByDeliverableId = new Map<string, DeliverableBudgetSummary>(
    snapshot.deliverables
      .filter((summary): summary is DeliverableBudgetSummary & { deliverableId: string } => Boolean(summary.deliverableId))
      .map((summary) => [summary.deliverableId, summary])
  );
  const controlsSummary = buildProjectControlsSummary([], [], [], null, "2026-08-04T00:00:00.000Z");

  render(
    <ProjectDeliveryBoard
      project={PROJECT}
      projectControlsSummary={controlsSummary}
      invoiceSummary={controlsSummary.invoiceSummary}
      recommendedReport={null}
      firstBlockedMilestone={null}
      firstOverdueMilestone={null}
      firstOverdueSubmittal={null}
      firstOverdueInvoice={null}
      projectMilestonesPending={false}
      milestones={[]}
      prioritizedMilestones={[]}
      projectSubmittalsPending={false}
      submittals={[]}
      prioritizedSubmittals={[]}
      projectInvoicesPending={false}
      projectInvoices={[]}
      prioritizedProjectInvoices={[]}
      deliverables={budgetInputs.deliverables.slice(0, 6)}
      budgetSummaryByDeliverableId={budgetSummaryByDeliverableId}
    />
  );

  return { recorded, snapshot };
}

/** The rendered row for one deliverable, found by its visible title. */
function deliverableRow(title: string): HTMLElement {
  const heading = screen.getByText(title);
  const row = heading.closest(".module-record-row");
  if (!(row instanceof HTMLElement)) throw new Error(`No rendered row for deliverable "${title}"`);
  return row;
}

describe("the deliverable update control is reachable from the delivery board", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    refreshMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ recordType: "deliverable", record: {} }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("asks the database for the budget columns the control prefills from", async () => {
    const { recorded } = await renderBoardFromRealBuilders();

    const deliverableSelect = recorded.find((entry) => entry.table === "project_deliverables");
    expect(deliverableSelect).toBeDefined();
    // Prefilling the two editable numeric fields is only possible if they were
    // projected. A mocked client answers any projection, so assert the string.
    expect(deliverableSelect?.columns).toContain("budget_amount");
    expect(deliverableSelect?.columns).toContain("percent_complete");
    expect(deliverableSelect?.columns).toContain("status");
  });

  it("renders a status control and budget/progress fields on every deliverable row", async () => {
    await renderBoardFromRealBuilders();

    for (const title of ["Existing Conditions Memo", "Corridor Map Set"]) {
      const row = deliverableRow(title);
      expect(within(row).getByLabelText("Set deliverable status")).toBeInTheDocument();
      expect(within(row).getByLabelText("Budget (not to exceed)")).toBeInTheDocument();
      expect(within(row).getByLabelText("Percent complete")).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: "Save budget & progress" })).toBeInTheDocument();
    }
  });

  it("prefills the numeric fields from the real budget snapshot, and leaves them blank when nothing is recorded", async () => {
    const { snapshot } = await renderBoardFromRealBuilders();

    // The values under test come from the builder, not from this test.
    const budgeted = snapshot.deliverables.find((summary) => summary.deliverableId === BUDGETED_DELIVERABLE_ID);
    expect(budgeted?.budgetAmount).toBe(5000);
    expect(budgeted?.percentComplete).toBe(40);

    const budgetedRow = deliverableRow("Existing Conditions Memo");
    expect(within(budgetedRow).getByLabelText("Budget (not to exceed)")).toHaveValue(5000);
    expect(within(budgetedRow).getByLabelText("Percent complete")).toHaveValue(40);

    const bareRow = deliverableRow("Corridor Map Set");
    expect(within(bareRow).getByLabelText("Budget (not to exceed)")).toHaveValue(null);
    expect(within(bareRow).getByLabelText("Percent complete")).toHaveValue(null);
  });

  it("advances a deliverable's status through the real record route", async () => {
    await renderBoardFromRealBuilders();

    const row = deliverableRow("Corridor Map Set");
    fireEvent.click(within(row).getByRole("button", { name: "Start deliverable" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PROJECT_ID}/records/${BARE_DELIVERABLE_ID}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ recordType: "deliverable", status: "in_progress" });
  });

  it("offers only the four statuses project_deliverables.status accepts", async () => {
    await renderBoardFromRealBuilders();

    const select = within(deliverableRow("Corridor Map Set")).getByLabelText("Set deliverable status");
    const values = Array.from(select.querySelectorAll("option")).map((option) => option.getAttribute("value"));
    // "scheduled" is a milestone state; offering it here would 400 at the route.
    expect(values).toEqual(["not_started", "in_progress", "blocked", "complete"]);
  });

  it("writes an edited budget and percent complete, re-asserting the rendered status", async () => {
    await renderBoardFromRealBuilders();

    const row = deliverableRow("Existing Conditions Memo");
    fireEvent.change(within(row).getByLabelText("Budget (not to exceed)"), { target: { value: "7500.50" } });
    fireEvent.change(within(row).getByLabelText("Percent complete"), { target: { value: "65" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save budget & progress" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PROJECT_ID}/records/${BUDGETED_DELIVERABLE_ID}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({
      recordType: "deliverable",
      status: "in_progress",
      budgetAmount: 7500.5,
      percentComplete: 65,
    });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("sends an explicit null when a planner clears a budget, and omits the field they never touched", async () => {
    await renderBoardFromRealBuilders();

    const row = deliverableRow("Existing Conditions Memo");
    fireEvent.change(within(row).getByLabelText("Budget (not to exceed)"), { target: { value: "" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save budget & progress" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const payload = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    // Clearing is an edit: null is the planner's answer and must be written.
    expect(payload.budgetAmount).toBeNull();
    // Percent complete was never touched. The route writes a column only when
    // its key is present, so omitting it leaves the stored value alone instead
    // of re-asserting what this page happened to render.
    expect(payload).not.toHaveProperty("percentComplete");
  });

  it("never writes a value the planner did not enter, so an unreadable blank cannot erase a stored one", async () => {
    // A blank field is not proof that nothing is recorded: when a deployment
    // has not applied the deliverable budget columns, loadProjectBudgetInputs
    // falls back to the legacy projection and every prefill is blank because
    // the value could not be READ. Re-asserting those blanks would turn
    // "could not be read" into "erase it".
    await renderBoardFromRealBuilders();

    const row = deliverableRow("Existing Conditions Memo");
    fireEvent.click(within(row).getByRole("button", { name: "Save budget & progress" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(row).getByText("Nothing changed, so nothing was saved.")).toBeInTheDocument();
    expect(within(row).queryByText(/budget and progress saved\./i)).not.toBeInTheDocument();
  });

  it("declares the same numeric bounds the route's schema enforces, so an out-of-range value never leaves the page", async () => {
    await renderBoardFromRealBuilders();

    const row = deliverableRow("Existing Conditions Memo");
    const budgetField = within(row).getByLabelText("Budget (not to exceed)");
    const percentField = within(row).getByLabelText("Percent complete");

    // These attributes are the ACTIVE guard, not decoration: native constraint
    // validation blocks the submit event outright, which is why the component's
    // own range checks below never fire in a browser. They mirror the deliverable
    // branch of updateRecordSchema in
    // src/app/api/projects/[projectId]/records/[recordId]/route.ts —
    // budgetAmount .min(0), percentComplete .min(0).max(100). If the route's
    // bounds move, these must move with them.
    expect(budgetField).toHaveAttribute("type", "number");
    expect(budgetField).toHaveAttribute("min", "0");
    expect(percentField).toHaveAttribute("type", "number");
    expect(percentField).toHaveAttribute("min", "0");
    expect(percentField).toHaveAttribute("max", "100");

    fireEvent.change(percentField, { target: { value: "140" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save budget & progress" }));

    // Nothing is sent, and nothing claims a save happened.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(row).queryByText(/saved\./i)).not.toBeInTheDocument();
  });

  it("surfaces a refusal from the route instead of reporting a save that did not happen", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: "You do not have write access to this workspace" }),
    });
    await renderBoardFromRealBuilders();

    const row = deliverableRow("Existing Conditions Memo");
    fireEvent.change(within(row).getByLabelText("Percent complete"), { target: { value: "65" } });
    fireEvent.click(within(row).getByRole("button", { name: "Save budget & progress" }));

    await waitFor(() =>
      expect(within(row).getByText("You do not have write access to this workspace")).toBeInTheDocument()
    );
    expect(within(row).queryByText(/saved\./i)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
