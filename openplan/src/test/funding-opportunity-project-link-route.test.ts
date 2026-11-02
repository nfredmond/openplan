import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Linking a project to a funding opportunity through the opportunity PATCH.
 *
 * The real `loadFundingOpportunityAccess` and role matrix run here (only the
 * Supabase client is faked), so the viewer refusal comes from the policy table
 * rather than from a mocked `allowed: false`. The fake evaluates every filter
 * the route sends against in-memory rows, so a dropped `.eq(...)` changes the
 * answer instead of passing silently.
 */

const createClientMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const audit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: () => audit }));

import { PATCH } from "@/app/api/funding-opportunities/[opportunityId]/route";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const WORKSPACE_A = "aaaaaaaa-0000-4000-8000-000000000001";
const WORKSPACE_B = "bbbbbbbb-0000-4000-8000-000000000002";
const OPPORTUNITY_ID = "0aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROJECT_A1 = "a1a1a1a1-0000-4000-8000-0000000000a1";
const PROJECT_A2 = "a2a2a2a2-0000-4000-8000-0000000000a2";
const PROJECT_B1 = "b1b1b1b1-0000-4000-8000-0000000000b1";
const PROJECT_UNKNOWN = "ffffffff-0000-4000-8000-0000000000ff";

type Row = Record<string, unknown>;
type Filter = { method: "eq" | "neq" | "is" | "or"; column: string; value: unknown };
type Call = {
  table: string;
  op: "select" | "update";
  projection: string | null;
  options: Record<string, unknown> | null;
  payload: Row | null;
  filters: Filter[];
};

const DEPENDENT_TABLES = [
  "funding_awards",
  "funding_award_handoff_revisions",
  "funding_opportunity_application_sections",
  "funding_opportunity_section_drafts",
  "funding_opportunity_narrative_drafts",
  "funding_opportunity_application_exports",
  "funding_opportunity_safety_seeds",
  "project_map_packages",
  "funding_opportunity_attachments",
] as const;

let tables: Record<string, Row[]>;
let calls: Call[];
let countFailure: string | null;
let concurrentRelinkTo: string | null | undefined;

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((filter) => {
    if (filter.method === "eq") return row[filter.column] === filter.value;
    if (filter.method === "neq") return row[filter.column] !== filter.value;
    if (filter.method === "is") return (row[filter.column] ?? null) === filter.value;
    // Only the shape the route sends: "a.not.is.null,b.not.is.null".
    return String(filter.value)
      .split(",")
      .some((clause) => {
        const [column, not, is, value] = clause.split(".");
        if (not !== "not" || is !== "is" || value !== "null") throw new Error(`Unsupported or clause: ${clause}`);
        return (row[column] ?? null) !== null;
      });
  });
}

function project(row: Row, projection: string | null): Row {
  if (!projection || projection === "*") return { ...row };
  return Object.fromEntries(
    projection.split(",").map((column) => column.trim()).map((column) => [column, row[column] ?? null])
  );
}

/** What RLS lets this user read: rows in workspaces where they hold any role. */
function visible(table: string): Row[] {
  const memberOf = new Set(
    tables.workspace_members.filter((member) => member.user_id === USER_ID).map((member) => member.workspace_id)
  );
  return (tables[table] ?? []).filter((row) => table === "workspace_members" || memberOf.has(row.workspace_id));
}

function builder(table: string) {
  const call: Call = { table, op: "select", projection: null, options: null, payload: null, filters: [] };
  calls.push(call);
  const resolveMany = () => visible(table).filter((row) => matches(row, call.filters));
  const api = {
    select(projection: string, options?: Record<string, unknown>) {
      if (call.op === "select") {
        call.projection = projection;
        call.options = options ?? null;
      } else {
        call.projection = projection;
      }
      return api;
    },
    update(payload: Row) {
      call.op = "update";
      call.payload = payload;
      return api;
    },
    eq(column: string, value: unknown) { call.filters.push({ method: "eq", column, value }); return api; },
    neq(column: string, value: unknown) { call.filters.push({ method: "neq", column, value }); return api; },
    is(column: string, value: unknown) { call.filters.push({ method: "is", column, value }); return api; },
    or(value: string) { call.filters.push({ method: "or", column: "", value }); return api; },
    filter(column: string, operator: string, value: unknown) {
      if (operator !== "eq" && operator !== "is") throw new Error(`Unsupported filter operator: ${operator}`);
      call.filters.push({ method: operator, column, value });
      return api;
    },
    async maybeSingle() {
      const rows = resolveMany();
      return { data: rows[0] ? project(rows[0], call.projection) : null, error: null };
    },
    async single() {
      if (call.op === "update") {
        if (concurrentRelinkTo !== undefined) {
          tables.funding_opportunities[0].project_id = concurrentRelinkTo;
        }
        const rows = resolveMany();
        if (rows.length !== 1) {
          return { data: null, error: { code: "PGRST116", details: "The result contains 0 rows", message: "no rows" } };
        }
        Object.assign(rows[0], call.payload);
        return { data: project(rows[0], call.projection), error: null };
      }
      const rows = resolveMany();
      return { data: rows[0] ? project(rows[0], call.projection) : null, error: null };
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      if (!(call.options && call.options.head === true && call.options.count === "exact")) {
        return Promise.reject(new Error(`Unexpected awaited query on ${table}`)).then(resolve, reject);
      }
      if (countFailure === table) {
        return Promise.resolve({ data: null, count: null, error: { message: "permission denied" } }).then(resolve, reject);
      }
      return Promise.resolve({ data: null, count: resolveMany().length, error: null }).then(resolve, reject);
    },
  };
  return api;
}

function patch(body: Row) {
  return PATCH(
    new NextRequest(`http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }) }
  );
}

function setOpportunity(fields: Row) {
  Object.assign(tables.funding_opportunities[0], fields);
}

function addDependent(table: (typeof DEPENDENT_TABLES)[number], row: Row) {
  tables[table].push({ id: `${table}-${tables[table].length}`, workspace_id: WORKSPACE_A, ...row });
}

const updateCalls = () => calls.filter((call) => call.op === "update");
const countCalls = () => calls.filter((call) => call.options?.head === true);

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
  countFailure = null;
  concurrentRelinkTo = undefined;
  tables = {
    funding_opportunities: [
      {
        id: OPPORTUNITY_ID,
        workspace_id: WORKSPACE_A,
        program_id: null,
        project_id: null,
        title: "California ATP",
        opportunity_status: "upcoming",
        decision_state: "monitor",
      },
    ],
    workspace_members: [
      { workspace_id: WORKSPACE_A, user_id: USER_ID, role: "member" },
      { workspace_id: WORKSPACE_B, user_id: USER_ID, role: "owner" },
    ],
    projects: [
      { id: PROJECT_A1, workspace_id: WORKSPACE_A, name: "Main Street sidewalk gap" },
      { id: PROJECT_A2, workspace_id: WORKSPACE_A, name: "School crossing" },
      { id: PROJECT_B1, workspace_id: WORKSPACE_B, name: "Other workspace project" },
    ],
    ...Object.fromEntries(DEPENDENT_TABLES.map((table) => [table, [] as Row[]])),
  };
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: (table: string) => builder(table),
  });
  createServiceRoleClientMock.mockImplementation(() => {
    throw new Error("a project link is not an assistant decision and needs no service client");
  });
});

describe("PATCH /api/funding-opportunities/[id] project link", () => {
  it("links an unlinked opportunity to a project in its own workspace", async () => {
    const response = await patch({ projectId: PROJECT_A1 });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.opportunity).toMatchObject({ id: OPPORTUNITY_ID, workspace_id: WORKSPACE_A, project_id: PROJECT_A1 });
    expect(tables.funding_opportunities[0].project_id).toBe(PROJECT_A1);

    const projectRead = calls.find((call) => call.table === "projects");
    expect(projectRead).toMatchObject({ projection: "id, workspace_id", filters: [{ method: "eq", column: "id", value: PROJECT_A1 }] });

    const [update] = updateCalls();
    expect(update.payload).toEqual({ project_id: PROJECT_A1 });
    expect(update.filters).toEqual([
      { method: "eq", column: "id", value: OPPORTUNITY_ID },
      { method: "is", column: "project_id", value: null },
    ]);
    expect(update.projection).toContain("project_id");
    expect(update.projection).toContain("workspace_id");

    // A first link only asks whether an award sits on a different project.
    expect(countCalls().map((call) => call.table)).toEqual(["funding_awards"]);
    expect(countCalls()[0].filters).toEqual([
      { method: "eq", column: "funding_opportunity_id", value: OPPORTUNITY_ID },
      { method: "neq", column: "project_id", value: PROJECT_A1 },
    ]);
  });

  it("refuses a project from another workspace the caller also belongs to, as not found", async () => {
    const response = await patch({ projectId: PROJECT_B1 });

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Project not found in this workspace");
    expect(updateCalls()).toHaveLength(0);
    expect(tables.funding_opportunities[0].project_id).toBeNull();
  });

  it("refuses an unknown project with the same 404", async () => {
    const response = await patch({ projectId: PROJECT_UNKNOWN });

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("Project not found in this workspace");
    expect(updateCalls()).toHaveLength(0);
  });

  it("refuses a viewer before reading the project or writing", async () => {
    tables.workspace_members[0].role = "viewer";

    const response = await patch({ projectId: PROJECT_A1 });

    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("Workspace access denied");
    expect(calls.some((call) => call.table === "projects")).toBe(false);
    expect(updateCalls()).toHaveLength(0);
  });

  it("refuses a Planner Agent request that carries a project link", async () => {
    const response = await PATCH(
      new NextRequest(`http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-openplan-assistant-execution-source": "planner_agent_quick_link" },
        body: JSON.stringify({ decisionState: "pursue", projectId: PROJECT_A1 }),
      }),
      { params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }) }
    );

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("relinks when nothing was built from the current project, guarded by compare-and-set", async () => {
    setOpportunity({ project_id: PROJECT_A1 });
    // Work in progress that is not bound to the project does not block.
    addDependent("funding_opportunity_application_sections", { opportunity_id: OPPORTUNITY_ID, status: "drafting" });
    addDependent("funding_opportunity_attachments", { opportunity_id: OPPORTUNITY_ID, kb_document_id: null, report_artifact_id: null });

    const response = await patch({ projectId: PROJECT_A2 });

    expect(response.status).toBe(200);
    expect(tables.funding_opportunities[0].project_id).toBe(PROJECT_A2);
    expect(updateCalls()[0].filters).toEqual([
      { method: "eq", column: "id", value: OPPORTUNITY_ID },
      { method: "eq", column: "project_id", value: PROJECT_A1 },
    ]);
    expect(countCalls().map((call) => call.table).sort()).toEqual([...DEPENDENT_TABLES].sort());
    for (const call of countCalls()) {
      expect(call.projection).toBe("*");
      expect(call.options).toEqual({ count: "exact", head: true });
    }
    expect(countCalls().find((call) => call.table === "funding_opportunity_application_sections")!.filters).toContainEqual({
      method: "eq",
      column: "status",
      value: "final",
    });
  });

  it("unlinks when nothing was built from the current project", async () => {
    setOpportunity({ project_id: PROJECT_A1 });

    const response = await patch({ projectId: null });

    expect(response.status).toBe(200);
    expect(tables.funding_opportunities[0].project_id).toBeNull();
    expect(updateCalls()[0].payload).toEqual({ project_id: null });
    expect(calls.some((call) => call.table === "projects")).toBe(false);
  });

  it.each([
    ["funding_opportunity_application_sections", { status: "final" }, "final_section"],
    ["funding_opportunity_application_exports", {}, "application_export"],
    ["funding_opportunity_safety_seeds", {}, "safety_seed"],
    ["funding_opportunity_section_drafts", {}, "section_draft"],
    ["funding_awards", { funding_opportunity_id: OPPORTUNITY_ID, project_id: PROJECT_A1 }, "award"],
    ["project_map_packages", { funding_opportunity_id: OPPORTUNITY_ID }, "map_package"],
    ["funding_opportunity_attachments", { report_artifact_id: "report-artifact-1", kb_document_id: null }, "attached_evidence"],
  ] as const)("refuses a relink once %s holds the current project", async (table, extra, blocker) => {
    setOpportunity({ project_id: PROJECT_A1 });
    addDependent(table, { opportunity_id: OPPORTUNITY_ID, ...extra });

    const response = await patch({ projectId: PROJECT_A2 });

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("The project link was not changed");
    expect(body.blockers).toEqual([blocker]);
    expect(body.details).toContain("Track a new opportunity");
    expect(updateCalls()).toHaveLength(0);
    expect(tables.funding_opportunities[0].project_id).toBe(PROJECT_A1);
  });

  it("refuses an unlink of an awarded opportunity", async () => {
    setOpportunity({ project_id: PROJECT_A1, opportunity_status: "awarded" });

    const response = await patch({ projectId: null });

    expect(response.status).toBe(409);
    expect((await response.json()).blockers).toEqual(["awarded_status"]);
    expect(updateCalls()).toHaveLength(0);
  });

  it("does not count another opportunity's records against this one", async () => {
    setOpportunity({ project_id: PROJECT_A1 });
    addDependent("funding_opportunity_application_exports", { opportunity_id: "0bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });

    const response = await patch({ projectId: PROJECT_A2 });

    expect(response.status).toBe(200);
  });

  it("refuses a first link to a project other than the one an existing award names", async () => {
    addDependent("funding_awards", { funding_opportunity_id: OPPORTUNITY_ID, project_id: PROJECT_A2 });

    const refused = await patch({ projectId: PROJECT_A1 });
    expect(refused.status).toBe(409);
    expect((await refused.json()).blockers).toEqual(["award_on_other_project"]);
    expect(updateCalls()).toHaveLength(0);

    const allowed = await patch({ projectId: PROJECT_A2 });
    expect(allowed.status).toBe(200);
    expect(tables.funding_opportunities[0].project_id).toBe(PROJECT_A2);
  });

  it("answers 500, not a zero, when a dependency count is not reported", async () => {
    setOpportunity({ project_id: PROJECT_A1 });
    countFailure = "funding_opportunity_application_exports";

    const response = await patch({ projectId: PROJECT_A2 });

    expect(response.status).toBe(500);
    expect(updateCalls()).toHaveLength(0);
    expect(audit.error).toHaveBeenCalledWith(
      "funding_opportunity_project_link_check_failed",
      expect.objectContaining({ table: "funding_opportunity_application_exports" })
    );
  });

  it("answers 409 when someone else changed the link between the check and the write", async () => {
    setOpportunity({ project_id: PROJECT_A1 });
    concurrentRelinkTo = PROJECT_A2;

    const response = await patch({ projectId: null });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("changed while you were saving");
  });

  it("writes nothing to project_id when the request repeats the current link", async () => {
    setOpportunity({ project_id: PROJECT_A1, opportunity_status: "awarded" });

    const response = await patch({ projectId: PROJECT_A1, summary: "Cycle 8" });

    expect(response.status).toBe(200);
    expect(updateCalls()[0].payload).toEqual({ summary: "Cycle 8" });
    expect(updateCalls()[0].filters).toEqual([{ method: "eq", column: "id", value: OPPORTUNITY_ID }]);
    expect(countCalls()).toHaveLength(0);
  });
});
