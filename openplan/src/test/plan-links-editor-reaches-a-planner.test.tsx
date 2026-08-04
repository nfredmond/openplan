import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentPropsWithoutRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PLAN_LINK_TYPE_OPTIONS } from "@/lib/plans/catalog";

/**
 * THE PATH TO THE UNIT — a plan link a planner can actually attach and detach.
 *
 * `plan_links` has had storage, a validator, replace-with-rollback semantics and
 * route tests since the plans module shipped. It had no editor. The plan detail
 * page said so out loud — "explicit plan links can be added through the API" —
 * which is the shipped-invisible defect stated as product copy: complete,
 * tested, reviewed capability that no person using OpenPlan could reach.
 *
 * So this file refuses to test the picker in isolation. It renders the REAL plan
 * detail page, which renders the REAL controls component, whose fetch is served
 * by the REAL route handler, over a Supabase double that actually filters rows.
 * Nothing between the database and the planner's screen is described by a
 * fixture — a link a planner can select here is a link the route will store.
 *
 * Three properties are asserted, and the second and third are why this is worth
 * more than a snapshot:
 *
 *   1. REACHABILITY — every link type in the catalog gets a control on the page,
 *      populated with this workspace's records, with stored links pre-selected.
 *   2. THE WRITE LANDS — selecting a record and saving makes the real route
 *      write that row into `plan_links`.
 *   3. A FAILED READ MAY NOT DELETE DATA — `links` REPLACES the whole set, so an
 *      editor that could not read the current links must omit the key entirely.
 *      Otherwise saving a title silently detaches every record on the plan.
 */

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const PRIMARY_PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const SCENARIO_ID = "66666666-6666-4666-8666-666666666666";
const CAMPAIGN_ID = "77777777-7777-4777-8777-777777777777";
const REPORT_LINKED_ID = "88888888-8888-4888-8888-888888888888";
const REPORT_UNLINKED_ID = "99999999-9999-4999-8999-999999999999";

type Row = Record<string, unknown>;

type RecordedQuery = {
  table: string;
  columns: string;
  filters: Array<{ op: "eq" | "in"; column: string; value: unknown }>;
  limit: number | null;
};

type SupabaseDouble = {
  client: unknown;
  queries: RecordedQuery[];
  inserts: Array<{ table: string; rows: Row[] }>;
  deletes: Array<{ table: string; filters: Array<{ column: string; value: unknown }> }>;
  updates: Array<{ table: string; values: Row }>;
};

/**
 * A Supabase double that FILTERS. A mock that returns its fixture whatever was
 * asked for would let the workspace scoping, the `IN` resolution and the option
 * limit all be wrong and still pass; this one applies `eq`, `in` and `limit` to
 * a row store, so the assertions below are about the queries the code actually
 * writes.
 */
function createSupabaseDouble(store: Record<string, Row[]>, failingTables: string[] = []): SupabaseDouble {
  const queries: RecordedQuery[] = [];
  const inserts: SupabaseDouble["inserts"] = [];
  const deletes: SupabaseDouble["deletes"] = [];
  const updates: SupabaseDouble["updates"] = [];
  const failing = new Set(failingTables);

  function selectBuilder(table: string, columns: string) {
    const filters: RecordedQuery["filters"] = [];
    let limitValue: number | null = null;

    function resolve() {
      queries.push({ table, columns, filters: [...filters], limit: limitValue });

      if (failing.has(table)) {
        return { data: null, error: { message: `${table} is unavailable`, code: "42501" } };
      }

      let rows = [...(store[table] ?? [])];
      for (const filter of filters) {
        rows =
          filter.op === "eq"
            ? rows.filter((row) => row[filter.column] === filter.value)
            : rows.filter((row) => (filter.value as unknown[]).includes(row[filter.column]));
      }
      if (limitValue !== null) rows = rows.slice(0, limitValue);

      return { data: rows, error: null };
    }

    const builder = {
      eq(column: string, value: unknown) {
        filters.push({ op: "eq", column, value });
        return builder;
      },
      in(column: string, value: unknown[]) {
        filters.push({ op: "in", column, value });
        return builder;
      },
      order() {
        return builder;
      },
      limit(value: number) {
        limitValue = value;
        return builder;
      },
      async maybeSingle() {
        const result = resolve();
        return { data: result.error ? null : ((result.data ?? [])[0] ?? null), error: result.error };
      },
      then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
        return Promise.resolve(resolve()).then(onFulfilled, onRejected);
      },
    };

    return builder;
  }

  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
    },
    from(table: string) {
      return {
        select: (columns: string) => selectBuilder(table, columns),
        insert: async (rows: Row[]) => {
          inserts.push({ table, rows });
          store[table] = [...(store[table] ?? []), ...rows];
          return { error: null };
        },
        delete: () => ({
          eq: async (column: string, value: unknown) => {
            deletes.push({ table, filters: [{ column, value }] });
            store[table] = (store[table] ?? []).filter((row) => row[column] !== value);
            return { error: null };
          },
        }),
        update: (values: Row) => ({
          eq: async () => {
            updates.push({ table, values });
            return { error: null };
          },
        }),
      };
    },
  };

  return { client, queries, inserts, deletes, updates };
}

function baseStore(): Record<string, Row[]> {
  return {
    plans: [
      {
        id: PLAN_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PRIMARY_PROJECT_ID,
        title: "Countywide Active Transportation Plan",
        plan_type: "atp",
        status: "active",
        geography_label: "Planning area",
        horizon_year: 2045,
        summary: "Network gaps and crossing upgrades.",
        created_at: "2026-03-28T18:00:00.000Z",
        updated_at: "2026-03-28T21:10:00.000Z",
      },
    ],
    workspace_members: [{ workspace_id: WORKSPACE_ID, user_id: USER_ID, role: "admin" }],
    projects: [
      {
        id: PRIMARY_PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        name: "Main Street Complete Streets",
        summary: null,
        status: "active",
        plan_type: null,
        delivery_phase: null,
        updated_at: "2026-03-27T10:00:00.000Z",
      },
      {
        id: OTHER_PROJECT_ID,
        workspace_id: WORKSPACE_ID,
        name: "River Trail Extension",
        summary: null,
        status: "active",
        plan_type: null,
        delivery_phase: null,
        updated_at: "2026-03-26T10:00:00.000Z",
      },
    ],
    scenario_sets: [
      {
        id: SCENARIO_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PRIMARY_PROJECT_ID,
        title: "Bikeway build-out alternatives",
        summary: null,
        planning_question: null,
        status: "draft",
        baseline_entry_id: null,
        updated_at: "2026-03-25T10:00:00.000Z",
      },
    ],
    engagement_campaigns: [
      {
        id: CAMPAIGN_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PRIMARY_PROJECT_ID,
        title: "Where do you feel unsafe walking?",
        summary: null,
        status: "open",
        engagement_type: "map_comment",
        updated_at: "2026-03-24T10:00:00.000Z",
      },
    ],
    reports: [
      {
        id: REPORT_LINKED_ID,
        workspace_id: WORKSPACE_ID,
        project_id: PRIMARY_PROJECT_ID,
        title: "Existing conditions memo",
        report_type: "existing_conditions",
        status: "draft",
        summary: null,
        generated_at: null,
        latest_artifact_kind: null,
        updated_at: "2026-03-23T10:00:00.000Z",
      },
      {
        id: REPORT_UNLINKED_ID,
        workspace_id: WORKSPACE_ID,
        project_id: null,
        title: "Public review draft",
        report_type: "public_draft",
        status: "draft",
        summary: null,
        generated_at: null,
        latest_artifact_kind: null,
        updated_at: "2026-03-22T10:00:00.000Z",
      },
    ],
    // One stored link of each editable type EXCEPT the second report, which the
    // planner attaches during the test.
    plan_links: [
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        plan_id: PLAN_ID,
        link_type: "scenario_set",
        linked_id: SCENARIO_ID,
        label: "Bikeway build-out alternatives",
        created_at: "2026-03-20T10:00:00.000Z",
        updated_at: "2026-03-20T10:00:00.000Z",
      },
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        plan_id: PLAN_ID,
        link_type: "report",
        linked_id: REPORT_LINKED_ID,
        label: "Existing conditions memo",
        created_at: "2026-03-20T10:00:00.000Z",
        updated_at: "2026-03-20T10:00:00.000Z",
      },
    ],
    models: [],
    model_links: [],
    scenario_entries: [],
    engagement_categories: [],
    engagement_items: [],
    report_runs: [],
    report_sections: [],
    report_artifacts: [],
  };
}

const createClientMock = vi.fn();
const routerRefreshMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
  useRouter: () => ({ refresh: routerRefreshMock }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: ComponentPropsWithoutRef<"a"> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/operations/workspace-summary", async () => {
  const actual = await vi.importActual<typeof import("@/lib/operations/workspace-summary")>(
    "@/lib/operations/workspace-summary"
  );

  return {
    ...actual,
    loadWorkspaceOperationsSummaryForWorkspace: vi.fn(async () => null),
  };
});

vi.mock("@/components/operations/workspace-runtime-cue", () => ({
  WorkspaceRuntimeCue: () => <div data-testid="workspace-runtime-cue" />,
}));

vi.mock("@/components/operations/workspace-command-board", () => ({
  WorkspaceCommandBoard: () => <div data-testid="workspace-command-board" />,
}));

// NOT mocked, deliberately: `@/components/plans/plan-detail-controls` is the
// surface under test, and the page test that mocks it cannot prove a planner
// reaches anything inside it.

import PlanDetailPage from "@/app/(app)/plans/[planId]/page";
import { GET as getPlanDetail, PATCH as patchPlanDetail } from "@/app/api/plans/[planId]/route";

const patchBodies: Array<Record<string, unknown>> = [];

/** The component's own `fetch`, served by the real route handlers. */
function installRouteBackedFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      const absolute = url.startsWith("http") ? url : `http://localhost${url}`;
      const method = (init?.method ?? "GET").toUpperCase();
      const context = { params: Promise.resolve({ planId: PLAN_ID }) };

      if (method === "GET") {
        return (await getPlanDetail(new NextRequest(absolute), context)) as unknown as Response;
      }

      patchBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return (await patchPlanDetail(
        new NextRequest(absolute, {
          method,
          headers: init?.headers as HeadersInit,
          body: init?.body as string,
        }),
        context
      )) as unknown as Response;
    })
  );
}

async function renderPlanDetailPage() {
  render(await PlanDetailPage({ params: Promise.resolve({ planId: PLAN_ID }) }));
}

function selectFor(labelText: string): HTMLSelectElement {
  return screen.getByLabelText(labelText) as HTMLSelectElement;
}

function setSelected(select: HTMLSelectElement, values: string[]) {
  for (const option of Array.from(select.options)) {
    option.selected = values.includes(option.value);
  }
  fireEvent.change(select);
}

function submitPlanForm() {
  fireEvent.click(screen.getByRole("button", { name: /save plan record/i }));
}

describe("plan links reach a planner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    patchBodies.length = 0;
    installRouteBackedFetch();
  });

  it("offers a control for every catalog link type, filled with this workspace's records", async () => {
    const store = baseStore();
    const supabase = createSupabaseDouble(store);
    createClientMock.mockResolvedValue(supabase.client);

    await renderPlanDetailPage();

    // 1. Every link type the catalog defines is editable — a new link type
    //    cannot be added to the vocabulary and silently stay unreachable.
    await waitFor(() => {
      expect(selectFor("Linked scenario sets")).toBeInTheDocument();
    });
    for (const option of PLAN_LINK_TYPE_OPTIONS) {
      expect(document.querySelector(`#plan-control-links-${option.value}`)).not.toBeNull();
    }

    // 2. The options are this workspace's real records, by the title a planner
    //    would recognise — not ids, and not a placeholder.
    const reportSelect = selectFor("Linked reports");
    expect(within(reportSelect).getByRole("option", { name: "Existing conditions memo" })).toBeInTheDocument();
    expect(within(reportSelect).getByRole("option", { name: "Public review draft" })).toBeInTheDocument();
    expect(
      within(selectFor("Linked scenario sets")).getByRole("option", { name: "Bikeway build-out alternatives" })
    ).toBeInTheDocument();
    expect(
      within(selectFor("Related project records")).getByRole("option", { name: "River Trail Extension" })
    ).toBeInTheDocument();

    // 3. What is ALREADY stored comes back selected, so saving is an edit of the
    //    plan's link set rather than a replacement of it.
    expect(Array.from(reportSelect.selectedOptions).map((option) => option.value)).toEqual([REPORT_LINKED_ID]);
    expect(
      Array.from(selectFor("Linked scenario sets").selectedOptions).map((option) => option.value)
    ).toEqual([SCENARIO_ID]);
    expect(Array.from(selectFor("Related project records").selectedOptions)).toHaveLength(0);

    // 4. The option query asks the database for the column the label is drawn
    //    from, per link type. An untyped `.select()` cannot catch this, and a
    //    dropped column renders every option as "Untitled record".
    const optionQueries = supabase.queries.filter((query) => query.limit === 201);
    expect(optionQueries.map((query) => query.table).sort()).toEqual([
      "engagement_campaigns",
      "projects",
      "reports",
      "scenario_sets",
    ]);
    expect(optionQueries.find((query) => query.table === "projects")?.columns).toContain("name");
    expect(optionQueries.find((query) => query.table === "reports")?.columns).toContain("title");
    // Every option list is scoped to this plan's workspace.
    for (const query of optionQueries) {
      expect(query.filters).toContainEqual({ op: "eq", column: "workspace_id", value: WORKSPACE_ID });
    }
  });

  it("attaches and detaches links through the real route when the planner saves", async () => {
    const store = baseStore();
    const supabase = createSupabaseDouble(store);
    createClientMock.mockResolvedValue(supabase.client);

    await renderPlanDetailPage();
    await waitFor(() => expect(selectFor("Linked reports")).toBeInTheDocument());

    // Attach the second report, keep the first, and detach the scenario set.
    setSelected(selectFor("Linked reports"), [REPORT_LINKED_ID, REPORT_UNLINKED_ID]);
    setSelected(selectFor("Linked scenario sets"), []);
    setSelected(selectFor("Related project records"), [OTHER_PROJECT_ID]);

    submitPlanForm();

    await waitFor(() => expect(routerRefreshMock).toHaveBeenCalled());

    // The request the planner's click produced.
    expect(patchBodies).toHaveLength(1);
    expect(patchBodies[0].links).toEqual([
      { linkType: "report", linkedId: REPORT_LINKED_ID },
      { linkType: "report", linkedId: REPORT_UNLINKED_ID },
      { linkType: "project_record", linkedId: OTHER_PROJECT_ID },
    ]);

    // And what the REAL route wrote: the link rows, with the labels it resolved
    // from the target records itself.
    const linkInsert = supabase.inserts.find((insert) => insert.table === "plan_links");
    expect(linkInsert?.rows).toEqual([
      {
        plan_id: PLAN_ID,
        link_type: "report",
        linked_id: REPORT_LINKED_ID,
        label: "Existing conditions memo",
        created_by: USER_ID,
      },
      {
        plan_id: PLAN_ID,
        link_type: "report",
        linked_id: REPORT_UNLINKED_ID,
        label: "Public review draft",
        created_by: USER_ID,
      },
      {
        plan_id: PLAN_ID,
        link_type: "project_record",
        linked_id: OTHER_PROJECT_ID,
        label: "River Trail Extension",
        created_by: USER_ID,
      },
    ]);
    // The detached scenario link is gone from the stored set.
    expect(store.plan_links.some((row) => row.link_type === "scenario_set")).toBe(false);
  });

  it("omits links entirely when the stored link set could not be read, so saving cannot delete them", async () => {
    const store = baseStore();
    // `plan_links` unreadable: the editor cannot know what is attached.
    const supabase = createSupabaseDouble(store, ["plan_links"]);
    createClientMock.mockResolvedValue(supabase.client);

    await renderPlanDetailPage();

    await waitFor(() => {
      expect(screen.getByText(/this plan's links could not be read/i)).toBeInTheDocument();
    });
    // A failed read is not an answer: no picker claims the plan has no links.
    expect(document.querySelector("#plan-control-links-report")).toBeNull();

    submitPlanForm();

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).not.toHaveProperty("links");
    // `replaceLinkSet` starts by deleting the owner's rows. It must not have run.
    expect(supabase.deletes.filter((entry) => entry.table === "plan_links")).toHaveLength(0);
  });

  it("discloses a truncated option list and keeps links to records beyond it", async () => {
    const store = baseStore();
    // A workspace with more reports than the picker returns. The plan's stored
    // report link is to the OLDEST one, which falls outside the window — the
    // case where a naive editor silently detaches it on the next save.
    const overflowReports = Array.from({ length: 205 }, (_, index) => ({
      id: `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`,
      workspace_id: WORKSPACE_ID,
      project_id: null,
      title: `Corridor memo ${index}`,
      report_type: "existing_conditions",
      status: "draft",
      summary: null,
      generated_at: null,
      latest_artifact_kind: null,
      updated_at: "2026-03-30T10:00:00.000Z",
    }));
    // `.limit()` on the double slices in store order, so the linked report is
    // placed after the window rather than relying on ORDER BY.
    store.reports = [...overflowReports, ...store.reports];

    const supabase = createSupabaseDouble(store);
    createClientMock.mockResolvedValue(supabase.client);

    await renderPlanDetailPage();
    await waitFor(() => expect(selectFor("Linked reports")).toBeInTheDocument());

    expect(selectFor("Linked reports").options).toHaveLength(200);
    expect(screen.getByText(/showing the 200 most recently updated/i)).toBeInTheDocument();

    submitPlanForm();

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0].links).toContainEqual({ linkType: "report", linkedId: REPORT_LINKED_ID });
  });

  /**
   * The editor can offer 200 records per type across four types, while PATCH
   * accepts `links` as `z.array(...).max(40)`. Before this, no UI could build an
   * over-cap payload — only an API caller could, and they could read the schema.
   * A picker makes it one Ctrl+A away, and the route's refusal for it is a bare
   * "Invalid plan update payload" that names no cap and no count.
   *
   * The two assertions pin the editor's number to the ROUTE's number from both
   * sides: raise the route's cap without the editor and "the route refuses 41"
   * fails; raise the editor's without the route and "the editor refuses before
   * sending" fails.
   */
  it("refuses an over-cap link set in the editor, naming the limit, instead of posting it for a bare 400", async () => {
    const store = baseStore();
    store.projects = [
      ...store.projects,
      ...Array.from({ length: 45 }, (_, index) => ({
        id: `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, "0")}`,
        workspace_id: WORKSPACE_ID,
        name: `Sidewalk infill package ${index}`,
        summary: null,
        status: "active",
        plan_type: null,
        delivery_phase: null,
        updated_at: "2026-03-21T10:00:00.000Z",
      })),
    ];

    const supabase = createSupabaseDouble(store);
    createClientMock.mockResolvedValue(supabase.client);

    await renderPlanDetailPage();
    await waitFor(() => expect(selectFor("Related project records")).toBeInTheDocument());

    const projectSelect = selectFor("Related project records");
    setSelected(
      projectSelect,
      Array.from(projectSelect.options).map((option) => option.value)
    );

    submitPlanForm();

    // The planner is told the cap and the overage — not handed the route's
    // generic validation refusal.
    await waitFor(() => {
      expect(screen.getByText(/can carry up to 40 linked records/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/deselect 9/i)).toBeInTheDocument();
    // And nothing was sent: an over-cap PATCH would have been refused whole,
    // losing the title and status edits made alongside it.
    expect(patchBodies).toHaveLength(0);
    expect(supabase.updates.filter((entry) => entry.table === "plans")).toHaveLength(0);
  });

  it("uses the cap the route actually enforces", async () => {
    const store = baseStore();
    store.projects = [
      ...store.projects,
      ...Array.from({ length: 45 }, (_, index) => ({
        id: `cccccccc-cccc-4ccc-8ccc-${String(index).padStart(12, "0")}`,
        workspace_id: WORKSPACE_ID,
        name: `Sidewalk infill package ${index}`,
        summary: null,
        status: "active",
        plan_type: null,
        delivery_phase: null,
        updated_at: "2026-03-21T10:00:00.000Z",
      })),
    ];

    const supabase = createSupabaseDouble(store);
    createClientMock.mockResolvedValue(supabase.client);

    const projectIds = (store.projects as Array<{ id: string }>).map((project) => project.id);
    const context = { params: Promise.resolve({ planId: PLAN_ID }) };

    async function patchWithLinkCount(count: number) {
      return patchPlanDetail(
        new NextRequest(`http://localhost/api/plans/${PLAN_ID}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            links: projectIds
              .slice(0, count)
              .map((linkedId) => ({ linkType: "project_record", linkedId })),
          }),
        }),
        context
      );
    }

    // Exactly at the editor's cap the route stores the set...
    const atCap = await patchWithLinkCount(40);
    expect(atCap.status).toBe(200);

    // ...and one over it is refused by schema validation, which is why the
    // editor must stop first. Asserted on the message so a refusal for an
    // unrelated reason (an unresolvable record) cannot pass this as a cap check.
    const overCap = await patchWithLinkCount(41);
    expect(overCap.status).toBe(400);
    expect((await overCap.json()).error).toMatch(/invalid plan update payload/i);
  });

  it("keeps links of a type whose option list failed to read, and says so instead of showing none", async () => {
    const store = baseStore();
    // The reports list alone is unreadable; the other three lists are fine.
    const supabase = createSupabaseDouble(store, ["reports"]);
    createClientMock.mockResolvedValue(supabase.client);

    await renderPlanDetailPage();

    await waitFor(() => expect(selectFor("Linked scenario sets")).toBeInTheDocument());
    // No empty report picker — that would read as "this plan links no reports".
    expect(document.querySelector("#plan-control-links-report")).toBeNull();
    expect(screen.getByText(/this list could not be read/i)).toBeInTheDocument();

    submitPlanForm();

    await waitFor(() => expect(patchBodies).toHaveLength(1));
    // The stored report link is resubmitted untouched rather than dropped.
    expect(patchBodies[0].links).toContainEqual({ linkType: "report", linkedId: REPORT_LINKED_ID });
  });

  /**
   * COPY THAT NAMES A WAY IN IS A CLAIM ABOUT THE PRODUCT, AND IT GOES STALE.
   *
   * The empty state said explicit plan links "can be added through the API" —
   * true while only a route could write them, and false the moment this editor
   * shipped. A planner reading it concludes the screen in front of them cannot
   * do the thing it can now do, and goes looking for a developer. Nothing but
   * a person noticing would have caught it, which is why it is a test.
   */
  it("does not tell a planner to use the API for links this page can now edit", async () => {
    const store = baseStore();
    store.plan_links = [];
    createClientMock.mockResolvedValue(createSupabaseDouble(store).client);

    await renderPlanDetailPage();

    expect(screen.queryByText(/added through the API/i)).not.toBeInTheDocument();
    expect(screen.getByText(/No explicit links yet/i)).toBeInTheDocument();
  });
});
