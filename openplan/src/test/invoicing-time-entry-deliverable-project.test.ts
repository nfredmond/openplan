import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * A time entry may name a deliverable only from its engagement's project
 * (PR 106). Both write routes read the engagement's project_id and the
 * deliverable's project_id plus its project's workspace, then compare them.
 *
 * The fake below answers from in-memory rows. It honors `.eq()` filters,
 * returns ONLY the selected columns (with the one `projects(...)` embed these
 * routes use) and caps reads at PostgREST's 1,000 rows. So a route that stops
 * selecting `project_id`, filters the wrong id, or skips the comparison gets a
 * different answer here, as it would in production.
 */

type Row = Record<string, unknown>;
type Query = {
  table: string;
  verb: "select" | "insert" | "update" | "delete";
  projection: string | null;
  filters: Array<[string, unknown]>;
  payload: Row | null;
  terminal: "single" | "maybeSingle" | null;
};

const POSTGREST_MAX_ROWS = 1000;

// Embeds the routes use: child table -> embed name -> foreign key and parent.
const RELATIONS: Record<string, Record<string, { fk: string; parent: string }>> = {
  project_deliverables: { projects: { fk: "project_id", parent: "projects" } },
};

let db: Record<string, Row[]> = {};
let queries: Query[] = [];

function splitTopLevel(projection: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of projection) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function project(table: string, row: Row, projection: string | null): Row {
  if (projection === null || projection.trim() === "*") return { ...row };
  const out: Row = {};
  for (const token of splitTopLevel(projection)) {
    const embed = token.match(/^(\w+)\((.*)\)$/);
    if (embed) {
      const relation = RELATIONS[table]?.[embed[1]];
      if (!relation) throw new Error(`Fake has no relation ${table}.${embed[1]}`);
      const parent = (db[relation.parent] ?? []).find((candidate) => candidate.id === row[relation.fk]);
      out[embed[1]] = parent ? project(relation.parent, parent, embed[2]) : null;
    } else {
      out[token] = row[token];
    }
  }
  return out;
}

function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([column, value]) => row[column] === value);
}

function resolve(query: Query): { data: unknown; error: unknown } {
  const rows = db[query.table] ?? (db[query.table] = []);
  let result: Row[];
  if (query.verb === "insert") {
    const inserted = { id: `inserted-${rows.length + 1}`, ...query.payload };
    rows.push(inserted);
    result = [inserted];
  } else if (query.verb === "update") {
    result = rows.filter((row) => matches(row, query.filters));
    for (const row of result) Object.assign(row, query.payload);
  } else {
    result = rows.filter((row) => matches(row, query.filters)).slice(0, POSTGREST_MAX_ROWS);
  }
  const projected = result.map((row) => project(query.table, row, query.projection));
  if (query.terminal === "single") {
    return projected.length === 1
      ? { data: projected[0], error: null }
      : { data: null, error: { code: "PGRST116", message: `${projected.length} rows for single()` } };
  }
  if (query.terminal === "maybeSingle") return { data: projected[0] ?? null, error: null };
  return { data: projected, error: null };
}

function from(table: string) {
  const query: Query = { table, verb: "select", projection: null, filters: [], payload: null, terminal: null };
  queries.push(query);
  const builder = {
    select(projection?: string) {
      query.projection = projection ?? null;
      return builder;
    },
    insert(payload: Row) {
      query.verb = "insert";
      query.payload = payload;
      return builder;
    },
    update(payload: Row) {
      query.verb = "update";
      query.payload = payload;
      return builder;
    },
    eq(column: string, value: unknown) {
      query.filters.push([column, value]);
      return builder;
    },
    single() {
      query.terminal = "single";
      return builder;
    },
    maybeSingle() {
      query.terminal = "maybeSingle";
      return builder;
    },
    then(onFulfilled: (value: { data: unknown; error: unknown }) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve().then(() => resolve(query)).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

function readsOf(table: string): Query[] {
  return queries.filter((query) => query.table === table && query.verb === "select");
}

function writesOf(table: string): Query[] {
  return queries.filter((query) => query.table === table && query.verb !== "select");
}

function columns(projection: string | null): string[] {
  return projection === null ? [] : splitTopLevel(projection);
}

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: USER } } }) },
    from,
  }),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));

import { POST as postTimeEntry } from "@/app/api/invoicing/time-entries/route";
import { PATCH as patchTimeEntry } from "@/app/api/invoicing/time-entries/[timeEntryId]/route";

const WORKSPACE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_WORKSPACE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";
const ENGAGEMENT = "44444444-4444-4444-8444-444444444444";
const TIME_ENTRY = "55555555-5555-4555-8555-555555555555";
const ENGAGEMENT_PROJECT = "66666666-6666-4666-8666-666666666666";
// A second project in the SAME workspace, so only the project comparison can refuse it.
const SIBLING_PROJECT = "77777777-7777-4777-8777-777777777777";
const FOREIGN_PROJECT = "88888888-8888-4888-8888-888888888888";
const SAME_PROJECT_DELIVERABLE = "99999999-9999-4999-8999-999999999991";
const SIBLING_PROJECT_DELIVERABLE = "99999999-9999-4999-8999-999999999992";
const FOREIGN_WORKSPACE_DELIVERABLE = "99999999-9999-4999-8999-999999999993";

const REFUSAL = "Deliverable must belong to the engagement project";

function jsonRequest(url: string, method: string, payload: unknown) {
  return new NextRequest(url, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queries = [];
  db = {
    workspace_members: [{ workspace_id: WORKSPACE, user_id: USER, role: "owner" }],
    invoicing_staff: [{ id: STAFF, workspace_id: WORKSPACE, default_labor_category: "Senior Planner" }],
    invoicing_engagements: [{ id: ENGAGEMENT, workspace_id: WORKSPACE, project_id: ENGAGEMENT_PROJECT }],
    projects: [
      { id: ENGAGEMENT_PROJECT, workspace_id: WORKSPACE },
      { id: SIBLING_PROJECT, workspace_id: WORKSPACE },
      { id: FOREIGN_PROJECT, workspace_id: OTHER_WORKSPACE },
    ],
    project_deliverables: [
      { id: SAME_PROJECT_DELIVERABLE, project_id: ENGAGEMENT_PROJECT },
      { id: SIBLING_PROJECT_DELIVERABLE, project_id: SIBLING_PROJECT },
      { id: FOREIGN_WORKSPACE_DELIVERABLE, project_id: FOREIGN_PROJECT },
    ],
    invoicing_time_entries: [
      {
        id: TIME_ENTRY,
        workspace_id: WORKSPACE,
        staff_id: STAFF,
        engagement_id: ENGAGEMENT,
        deliverable_id: null,
        hours: 2,
        billed_line_item_id: null,
      },
    ],
  };
});

function expectDeliverableLookup(deliverableId: string) {
  const [lookup] = readsOf("project_deliverables");
  expect(lookup.filters).toEqual([["id", deliverableId]]);
  expect(columns(lookup.projection)).toEqual(expect.arrayContaining(["project_id", "projects(workspace_id)"]));
}

function expectEngagementLookup() {
  const [lookup] = readsOf("invoicing_engagements");
  expect(lookup.filters).toEqual([["id", ENGAGEMENT]]);
  expect(columns(lookup.projection)).toEqual(expect.arrayContaining(["workspace_id", "project_id"]));
}

describe("POST /api/invoicing/time-entries deliverable attribution", () => {
  const post = (deliverableId: string) =>
    postTimeEntry(
      jsonRequest("http://localhost/api/invoicing/time-entries", "POST", {
        workspaceId: WORKSPACE,
        staffId: STAFF,
        engagementId: ENGAGEMENT,
        deliverableId,
        entryDate: "2026-11-02",
        hours: 3,
      })
    );

  it("refuses a deliverable from another project in the same workspace", async () => {
    const response = await post(SIBLING_PROJECT_DELIVERABLE);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: REFUSAL });
    expect(writesOf("invoicing_time_entries")).toEqual([]);
    expect(mockAudit.warn).toHaveBeenCalledWith(
      "deliverable_workspace_mismatch",
      expect.objectContaining({ deliverableId: SIBLING_PROJECT_DELIVERABLE })
    );
    expectEngagementLookup();
    expectDeliverableLookup(SIBLING_PROJECT_DELIVERABLE);
  });

  it("refuses a deliverable whose project is in another workspace", async () => {
    const response = await post(FOREIGN_WORKSPACE_DELIVERABLE);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: REFUSAL });
    expect(writesOf("invoicing_time_entries")).toEqual([]);
  });

  it("accepts a deliverable from the engagement's project and records it", async () => {
    const response = await post(SAME_PROJECT_DELIVERABLE);

    expect(response.status).toBe(201);
    const [insert] = writesOf("invoicing_time_entries");
    expect(insert.payload).toMatchObject({ engagement_id: ENGAGEMENT, deliverable_id: SAME_PROJECT_DELIVERABLE });
    expectEngagementLookup();
    expectDeliverableLookup(SAME_PROJECT_DELIVERABLE);
  });
});

describe("PATCH /api/invoicing/time-entries/[timeEntryId] deliverable attribution", () => {
  const context = { params: Promise.resolve({ timeEntryId: TIME_ENTRY }) };
  const patch = (deliverableId: string) =>
    patchTimeEntry(
      jsonRequest(`http://localhost/api/invoicing/time-entries/${TIME_ENTRY}`, "PATCH", {
        workspaceId: WORKSPACE,
        deliverableId,
      }),
      context
    );

  it("refuses a deliverable from another project in the same workspace", async () => {
    const response = await patch(SIBLING_PROJECT_DELIVERABLE);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: REFUSAL });
    expect(writesOf("invoicing_time_entries")).toEqual([]);
    expect(db.invoicing_time_entries[0].deliverable_id).toBeNull();
    expectEngagementLookup();
    expectDeliverableLookup(SIBLING_PROJECT_DELIVERABLE);
  });

  it("refuses a deliverable whose project is in another workspace", async () => {
    const response = await patch(FOREIGN_WORKSPACE_DELIVERABLE);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: REFUSAL });
    expect(writesOf("invoicing_time_entries")).toEqual([]);
  });

  it("accepts a deliverable from the engagement's project, found through the stored entry", async () => {
    const response = await patch(SAME_PROJECT_DELIVERABLE);

    expect(response.status).toBe(200);
    // The engagement comes from the stored time entry, so its lookup needs engagement_id.
    const [entryLookup] = readsOf("invoicing_time_entries");
    expect(entryLookup.filters).toEqual([["id", TIME_ENTRY]]);
    expect(columns(entryLookup.projection)).toContain("engagement_id");
    expectEngagementLookup();
    expectDeliverableLookup(SAME_PROJECT_DELIVERABLE);
    const [update] = writesOf("invoicing_time_entries");
    expect(update.payload).toEqual({ deliverable_id: SAME_PROJECT_DELIVERABLE });
    expect(update.filters).toEqual([["id", TIME_ENTRY]]);
    expect(db.invoicing_time_entries[0].deliverable_id).toBe(SAME_PROJECT_DELIVERABLE);
  });
});
