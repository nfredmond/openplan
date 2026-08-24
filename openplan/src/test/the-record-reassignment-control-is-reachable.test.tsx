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
import {
  loadProjectRecordLanes,
  loadProjectScheduleLanes,
  type ProjectRecordLaneSupabaseLike,
} from "@/app/(app)/projects/[projectId]/_components/_record-lanes";
import { ProjectDeliveryBoard } from "@/app/(app)/projects/[projectId]/_components/project-delivery-board";
import { ProjectRiskAndDecisionLog } from "@/app/(app)/projects/[projectId]/_components/project-risk-decision-log";
import type { ProjectRow } from "@/app/(app)/projects/[projectId]/_components/_types";
import { ReadFailureLog } from "@/lib/ui/read-failures";
import { DEPARTED_ASSIGNEE_SENTENCE } from "@/lib/workspaces/roster";

/**
 * REASSIGNMENT, ON EVERY LANE THAT CAN CARRY AN ASSIGNEE.
 *
 * `assigneeUserId` shipped on four branches of
 * PATCH /api/projects/[projectId]/records/[recordId], with route tests, and no
 * surface in the product ever sent it — so a record could be assigned once, at
 * creation, and never again. The case the lane rendered most carefully was the
 * one it stranded hardest: a departed member's work printed the honest
 * "previously a member" sentence everywhere and could be handed to nobody.
 *
 * Every prop below is produced by the REAL loaders over raw PostgREST-shaped
 * rows — `loadProjectBudgetInputs`, `loadProjectScheduleLanes`,
 * `loadProjectRecordLanes` — never a hand-written row shape. A described
 * fixture proves the assertion; a built one proves the feature.
 *
 * THE BINDING IS VARIED, deliberately and in two dimensions: two different
 * members chosen on two different lanes must produce two different request
 * bodies. One fixture cannot tell "threads the chosen assignee" apart from
 * "hardcodes the one id in the test".
 */

const PROJECT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALICE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BOB = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
/** Assigned work whose owner is no longer on the roster. */
const DEPARTED = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const DELIVERABLE_ID = "11111111-1111-4111-8111-111111111111";
const MILESTONE_ID = "22222222-2222-4222-8222-222222222222";
const SUBMITTAL_ID = "33333333-3333-4333-8333-333333333333";
const ISSUE_ID = "44444444-4444-4444-8444-444444444444";
const RISK_ID = "55555555-5555-4555-8555-555555555555";

const ROSTER_MEMBERS = [
  { userId: ALICE, email: "alice@example.gov", role: "member" },
  { userId: BOB, email: "bob@example.gov", role: "admin" },
];

/** Raw rows, as PostgREST would hand them back. */
const RAW_ROWS: Record<string, Record<string, unknown>[]> = {
  project_deliverables: [
    {
      id: DELIVERABLE_ID,
      title: "Existing Conditions Memo",
      summary: "Baseline write-up",
      owner_label: "Planning",
      due_date: "2026-09-01",
      status: "in_progress",
      created_at: "2026-08-01T00:00:00.000Z",
      budget_amount: "5000.00",
      percent_complete: "40",
      // The motivating case: work owned by somebody who has left.
      assignee_user_id: DEPARTED,
    },
  ],
  project_milestones: [
    {
      id: MILESTONE_ID,
      title: "Environmental clearance",
      summary: "NEPA/CEQA determination filed",
      milestone_type: "decision",
      phase_code: "environmental",
      status: "in_progress",
      owner_label: null,
      assignee_user_id: ALICE,
      target_date: "2026-09-15",
      actual_date: null,
      notes: null,
      created_at: "2026-08-01T00:00:00.000Z",
    },
  ],
  project_submittals: [
    {
      id: SUBMITTAL_ID,
      title: "Invoice backup packet",
      submittal_type: "invoice_backup",
      status: "draft",
      agency_label: "the funding agency",
      assignee_user_id: null,
      reference_number: "INV-7",
      due_date: "2026-09-20",
      submitted_at: null,
      review_cycle: 1,
      notes: null,
      created_at: "2026-08-01T00:00:00.000Z",
    },
  ],
  project_issues: [
    {
      id: ISSUE_ID,
      title: "Traffic count package still missing",
      description: "Counts were never delivered by the vendor.",
      severity: "high",
      status: "open",
      owner_label: null,
      assignee_user_id: BOB,
      created_at: "2026-08-01T00:00:00.000Z",
    },
  ],
  project_risks: [
    {
      id: RISK_ID,
      title: "Schedule compression may weaken review quality",
      description: "Two review cycles were collapsed into one.",
      severity: "medium",
      status: "open",
      mitigation: null,
      created_at: "2026-08-01T00:00:00.000Z",
    },
  ],
  projects: [{ budget_amount: 20000 }],
};

type ClientOptions = {
  /** Projections that must FAIL, per table, as a pending migration would. */
  pendingColumn?: { table: string; column: string };
};

/**
 * A Supabase double that APPLIES the projection: a column the loader did not
 * ask for is genuinely absent from the row it hands back, exactly as PostgREST
 * behaves. Without that, a `.select()` missing `assignee_user_id` would still
 * render an assignee and every assertion below would pass over a broken page.
 */
function makeClient(options: ClientOptions = {}) {
  const projections: Record<string, string> = {};

  const client = {
    from(table: string) {
      return {
        select(columns: string) {
          projections[table] = columns;
          const requested = columns.split(",").map((column) => column.trim());
          const pendingHit =
            options.pendingColumn?.table === table &&
            requested.includes(options.pendingColumn.column);

          const rows = (RAW_ROWS[table] ?? []).map((row) => {
            const projected: Record<string, unknown> = {};
            for (const column of requested) {
              if (column in row) projected[column] = row[column];
            }
            return projected;
          });

          const result = pendingHit
            ? {
                data: null,
                error: {
                  message: `column ${table}.${options.pendingColumn?.column} does not exist`,
                },
              }
            : { data: rows, error: null };

          const chain = {
            eq: () => chain,
            in: () => chain,
            neq: () => chain,
            order: () => chain,
            limit: async () => result,
            maybeSingle: async () => ({
              data: pendingHit ? null : rows[0] ?? null,
              error: pendingHit ? result.error : null,
            }),
          };
          return chain;
        },
      };
    },
  };

  return { client, projections };
}

const PROJECT: ProjectRow = {
  id: PROJECT_ID,
  workspace_id: WORKSPACE_ID,
  name: "Corridor Study",
  summary: null,
  status: "active",
  plan_type: "corridor",
  delivery_phase: "initiation",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-08-01T00:00:00.000Z",
  estimated_cost_amount: null,
  estimated_cost_currency: null,
  estimated_cost_basis_year: null,
  estimated_cost_source_document_id: null,
  estimated_cost_recorded_at: null,
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

/** Both panels, composed the way the page composes them. */
async function renderProjectRecordSurfaces({
  canWrite = true,
  pendingColumn,
}: { canWrite?: boolean; pendingColumn?: ClientOptions["pendingColumn"] } = {}) {
  const { client, projections } = makeClient({ ...(pendingColumn ? { pendingColumn } : {}) });
  const reads = new ReadFailureLog();

  const budgetInputs = await loadProjectBudgetInputs(
    client as unknown as ProjectBudgetQuerySupabaseLike,
    PROJECT_ID
  );
  const snapshot = buildProjectBudgetSnapshot({
    project: { budget_amount: budgetInputs.statedBudgetAmount },
    deliverables: budgetInputs.deliverables,
    spendEntries: budgetInputs.spendEntries,
    billedLines: budgetInputs.billedLines,
  });
  const budgetSummaryByDeliverableId = new Map<string, DeliverableBudgetSummary>(
    snapshot.deliverables
      .filter((summary): summary is DeliverableBudgetSummary & { deliverableId: string } =>
        Boolean(summary.deliverableId)
      )
      .map((summary) => [summary.deliverableId, summary])
  );

  const schedule = await loadProjectScheduleLanes(
    client as unknown as ProjectRecordLaneSupabaseLike,
    PROJECT_ID,
    reads
  );
  const lanes = await loadProjectRecordLanes(
    client as unknown as ProjectRecordLaneSupabaseLike,
    PROJECT_ID,
    reads
  );

  const controlsSummary = buildProjectControlsSummary(
    schedule.milestones,
    schedule.submittals,
    [],
    null,
    "2026-08-04T00:00:00.000Z"
  );

  render(
    <>
      <ProjectDeliveryBoard
        project={PROJECT}
        projectControlsSummary={controlsSummary}
        invoiceSummary={controlsSummary.invoiceSummary}
        recommendedReport={null}
        firstBlockedMilestone={null}
        firstOverdueMilestone={null}
        firstOverdueSubmittal={null}
        firstOverdueInvoice={null}
        projectMilestonesPending={schedule.milestonesPending}
        milestones={schedule.milestones}
        prioritizedMilestones={schedule.milestones}
        projectSubmittalsPending={schedule.submittalsPending}
        submittals={schedule.submittals}
        prioritizedSubmittals={schedule.submittals}
        projectInvoicesPending={false}
        projectInvoices={[]}
        prioritizedProjectInvoices={[]}
        deliverables={budgetInputs.deliverables}
        budgetSummaryByDeliverableId={budgetSummaryByDeliverableId}
        assigneeRoster={{ ok: true, members: ROSTER_MEMBERS }}
        deliverableAssigneeColumnPending={budgetInputs.pending.deliverableAssigneeColumn}
        canWrite={canWrite}
      />
      <ProjectRiskAndDecisionLog
        projectId={PROJECT_ID}
        workspaceId={WORKSPACE_ID}
        canWrite={canWrite}
        risks={lanes.risks}
        issues={lanes.issues}
        decisions={lanes.decisions}
        meetings={lanes.meetings}
        assigneeRoster={{ ok: true, members: ROSTER_MEMBERS }}
      />
    </>
  );

  return { projections, budgetInputs };
}

/**
 * The rendered LIST row for one record, found by its visible title.
 *
 * A title can also appear in a summary card at the top of the board ("Next
 * milestone"), so the row is the one occurrence that sits inside a record row —
 * and finding anything other than exactly one is an error rather than a pick.
 */
function recordRow(title: string): HTMLElement {
  const rows = screen
    .getAllByText(title)
    .map((node) => node.closest(".module-record-row"))
    .filter((node): node is HTMLElement => node instanceof HTMLElement);
  if (rows.length !== 1) {
    throw new Error(`Expected exactly one record row for "${title}", found ${rows.length}`);
  }
  return rows[0];
}

const fetchMock = vi.fn();

/** Every PATCH the surface made, in order, with its parsed body. */
function patchCalls(): Array<{ url: string; body: Record<string, unknown> }> {
  return fetchMock.mock.calls
    .filter((call) => (call[1] as RequestInit | undefined)?.method === "PATCH")
    .map((call) => ({
      url: String(call[0]),
      body: JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>,
    }));
}

/** Choose an option in the picker on one row, by its visible text. */
async function chooseAssignee(row: HTMLElement, optionText: string | RegExp) {
  const select = await within(row).findByLabelText("Assignee");
  const option = within(select as HTMLElement).getByText(optionText);
  fireEvent.change(select, { target: { value: option.getAttribute("value") } });
}

describe("reassigning an existing project record", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("/api/workspaces/roster")) {
        return { ok: true, json: async () => ({ members: ROSTER_MEMBERS }) };
      }
      void init;
      return { ok: true, json: async () => ({ recordType: "deliverable", record: {} }) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("offers a picker on every lane the route accepts an assignee for, and on no other", async () => {
    await renderProjectRecordSurfaces();

    for (const title of [
      "Existing Conditions Memo",
      "Environmental clearance",
      "Invoice backup packet",
      "Traffic count package still missing",
    ]) {
      expect(
        await within(recordRow(title)).findByLabelText("Assignee"),
        `${title} must offer a reassignment control`
      ).toBeInTheDocument();
    }

    // Risks carry no assignee column at all; offering one would 400 at the route.
    expect(
      within(recordRow("Schedule compression may weaken review quality")).queryByLabelText("Assignee")
    ).not.toBeInTheDocument();
  });

  it("asks the database for the assignee column each picker is bound to", async () => {
    const { projections } = await renderProjectRecordSurfaces();

    // A mocked client answers any projection, so the projection string itself
    // is the assertion — a column dropped from one of these would render the
    // picker at "Unassigned" over a real assignment.
    for (const table of [
      "project_deliverables",
      "project_milestones",
      "project_submittals",
      "project_issues",
    ]) {
      expect(projections[table], `${table} must project assignee_user_id`).toContain(
        "assignee_user_id"
      );
    }
  });

  it("sends the member the planner chose — a different member and lane produce a different body", async () => {
    await renderProjectRecordSurfaces();

    await chooseAssignee(recordRow("Environmental clearance"), "bob@example.gov (admin)");
    await waitFor(() => expect(patchCalls()).toHaveLength(1));

    await chooseAssignee(recordRow("Invoice backup packet"), "alice@example.gov (member)");
    await waitFor(() => expect(patchCalls()).toHaveLength(2));

    const [milestone, submittal] = patchCalls();
    expect(milestone.url).toBe(`/api/projects/${PROJECT_ID}/records/${MILESTONE_ID}`);
    expect(milestone.body).toEqual({ recordType: "milestone", assigneeUserId: BOB });

    expect(submittal.url).toBe(`/api/projects/${PROJECT_ID}/records/${SUBMITTAL_ID}`);
    expect(submittal.body).toEqual({ recordType: "submittal", assigneeUserId: ALICE });

    // The two bodies differ in BOTH dimensions. A control that hardcoded either
    // the id or the record type would satisfy one of these and not the other.
    expect(milestone.body.assigneeUserId).not.toBe(submittal.body.assigneeUserId);
    expect(milestone.body.recordType).not.toBe(submittal.body.recordType);

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("hands a departed member's work to somebody who is still here", async () => {
    // THE MOTIVATING CASE. The deliverable is assigned to a user who is not on
    // the roster: the record still says so honestly, and until now no screen
    // could move it.
    await renderProjectRecordSurfaces();

    const row = recordRow("Existing Conditions Memo");
    const select = await within(row).findByLabelText("Assignee");
    // The departed value stays SELECTED and selectable, so merely rendering the
    // page does not rewrite the record.
    expect((select as HTMLSelectElement).value).toBe(DEPARTED);
    expect(within(select as HTMLElement).getByText(DEPARTED_ASSIGNEE_SENTENCE)).toBeInTheDocument();

    await chooseAssignee(row, "alice@example.gov (member)");

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0]).toEqual({
      url: `/api/projects/${PROJECT_ID}/records/${DELIVERABLE_ID}`,
      body: { recordType: "deliverable", assigneeUserId: ALICE },
    });
  });

  it("clears an assignee with an explicit null rather than omitting the field", async () => {
    await renderProjectRecordSurfaces();

    await chooseAssignee(recordRow("Traffic count package still missing"), "Unassigned");

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    const [call] = patchCalls();
    expect(call.url).toBe(`/api/projects/${PROJECT_ID}/records/${ISSUE_ID}`);
    // `null` is the planner's answer — "unassign" — and omitting it would leave
    // the old assignee in place while the page claimed it had changed.
    expect(call.body).toEqual({ recordType: "issue", assigneeUserId: null });
    expect(call.body.assigneeUserId).toBeNull();
  });

  it("never re-asserts a status, so reassigning cannot roll back a colleague's transition", async () => {
    await renderProjectRecordSurfaces();

    await chooseAssignee(recordRow("Environmental clearance"), "bob@example.gov (admin)");

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    // The route made `status` optional precisely so this call is possible.
    expect(patchCalls()[0].body).not.toHaveProperty("status");
  });

  it("offers a read-only viewer no picker at all, while still naming who is assigned", async () => {
    await renderProjectRecordSurfaces({ canWrite: false });

    for (const title of [
      "Existing Conditions Memo",
      "Environmental clearance",
      "Invoice backup packet",
      "Traffic count package still missing",
    ]) {
      expect(
        within(recordRow(title)).queryByLabelText("Assignee"),
        `${title} must not offer a viewer a control the route will refuse`
      ).not.toBeInTheDocument();
    }

    // The READ side is untouched: a viewer still sees who owns the work.
    expect(screen.getByText("alice@example.gov")).toBeInTheDocument();
    expect(screen.getByText("bob@example.gov")).toBeInTheDocument();
  });

  it("renders no picker when the projection could not ask who is assigned", async () => {
    // A deployment behind 20260811000006. `undefined` is not `null`: offering
    // "Unassigned" as the current answer to a question never put to the
    // database is how one careless click overwrites a real assignment.
    const { budgetInputs } = await renderProjectRecordSurfaces({
      pendingColumn: { table: "project_deliverables", column: "assignee_user_id" },
    });

    expect(budgetInputs.pending.deliverableAssigneeColumn).toBe(true);
    expect(
      within(recordRow("Existing Conditions Memo")).queryByLabelText("Assignee")
    ).not.toBeInTheDocument();
    // …and the panel says why, rather than leaving a silent gap.
    expect(screen.getByText(/behind migration\s+20260811000006/)).toBeInTheDocument();
  });

  it("surfaces a refusal from the route instead of reporting a reassignment that did not happen", async () => {
    await renderProjectRecordSurfaces();

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/workspaces/roster")) {
        return { ok: true, json: async () => ({ members: ROSTER_MEMBERS }) };
      }
      return {
        ok: false,
        json: async () => ({ error: "The assignee is not a member of this project's workspace" }),
      };
    });

    const row = recordRow("Environmental clearance");
    await chooseAssignee(row, "bob@example.gov (admin)");

    await waitFor(() =>
      expect(
        within(row).getByText("The assignee is not a member of this project's workspace")
      ).toBeInTheDocument()
    );
    expect(within(row).queryByText(/reassigned\./i)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
