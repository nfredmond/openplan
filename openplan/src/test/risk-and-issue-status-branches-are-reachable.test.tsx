import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A planner could log a risk or an issue and then never move it.
 *
 * `POST /api/projects/[projectId]/records` accepted both vocabularies from the
 * day the tables shipped, and the risk/issue panel rendered their status as a
 * badge — but the PATCH route knew only milestones, submittals and
 * deliverables, and no control existed on either lane. So a register filled up
 * with `open` rows that nothing could retire, and the project header counted
 * them as open forever. The capability was complete on the write side and
 * unreachable on every other one.
 *
 * WHAT THIS FILE PROVES, and how it avoids proving nothing:
 *
 * 1. The status vocabularies come from the migrations' own CHECK constraints,
 *    read at test time. A hand-written list here would only prove the list
 *    matches itself; Postgres is the authority and it is consulted directly.
 * 2. The forward path lands on a status the same constraint allows — a typo in
 *    `next` would otherwise reach the database as a 500 that reads like saving
 *    is broken.
 * 3. The route is driven for real, with the risk and issue tables watched, so
 *    the assertion is about the write, not about a schema.
 * 4. Reachability is proved by rendering the REAL panel over rows produced by
 *    the REAL lane loader — not a fixture written here. A fixture describes a
 *    project; only the loader proves the product can produce one. (The stage
 *    gate action that shipped with an unsatisfiable offer condition passed a
 *    reachability test built the other way.)
 */

const MIGRATIONS = path.join(process.cwd(), "supabase/migrations");

/**
 * The values a table's CHECK constraint allows for one column.
 *
 * Scoped to the CREATE TABLE block first, because these migration files define
 * several tables and a file-wide regex for `status` would match whichever came
 * first — silently checking the wrong table's vocabulary.
 */
function checkConstraintValues(migrationFile: string, table: string, column: string): string[] {
  const sql = readFileSync(path.join(MIGRATIONS, migrationFile), "utf8");
  const tableStart = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  if (tableStart < 0) throw new Error(`No CREATE TABLE for ${table} in ${migrationFile}`);

  const blockEnd = sql.indexOf("\n);", tableStart);
  if (blockEnd < 0) throw new Error(`Unterminated CREATE TABLE for ${table} in ${migrationFile}`);

  const block = sql.slice(tableStart, blockEnd);
  const match = block.match(new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`, "is"));
  if (!match) throw new Error(`No CHECK constraint on ${table}.${column} in ${migrationFile}`);

  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((entry) => entry[1]);
}

// ---------------------------------------------------------------------------
// 1 + 2. The registry against the database.
// ---------------------------------------------------------------------------

import {
  PROJECT_RECORD_STATUS_LANES,
  PROJECT_RECORD_STATUS_TYPES,
  nextProjectRecordStatus,
  projectRecordAdvanceLabel,
  type ProjectRecordStatusType,
} from "@/lib/projects/record-status-transitions";

const MIGRATION_FOR_LANE: Record<ProjectRecordStatusType, string> = {
  milestone: "20260321000033_lane_c_lapm_pm_invoicing.sql",
  submittal: "20260321000033_lane_c_lapm_pm_invoicing.sql",
  deliverable: "20260313000012_project_subrecords.sql",
  risk: "20260313000012_project_subrecords.sql",
  issue: "20260313000013_project_issues_meetings.sql",
};

describe("project record status transitions", () => {
  it.each(PROJECT_RECORD_STATUS_TYPES)(
    "offers %s exactly the statuses the database will accept",
    (recordType) => {
      const lane = PROJECT_RECORD_STATUS_LANES[recordType];
      const allowed = checkConstraintValues(MIGRATION_FOR_LANE[recordType], lane.table, "status");

      expect([...lane.statuses].sort()).toEqual([...allowed].sort());
    }
  );

  it.each(PROJECT_RECORD_STATUS_TYPES)(
    "only ever advances %s to a status the database will accept",
    (recordType) => {
      const lane = PROJECT_RECORD_STATUS_LANES[recordType];

      for (const [from, step] of Object.entries(lane.advance)) {
        expect(lane.statuses, `${recordType}.advance is keyed on an unknown status`).toContain(from);
        expect(lane.statuses, `${recordType}: ${from} advances to an unknown status`).toContain(step.next);
        expect(step.next, `${recordType}: ${from} advances to itself`).not.toBe(from);
        expect(step.label.trim().length).toBeGreaterThan(0);
      }
    }
  );

  // The whole point of the risk and issue lanes: a planner opening a register
  // must have a way out of the state every record starts in.
  it("gives a risk and an issue a forward move from the state they are created in", () => {
    // `open` is the create route's default for both, and both tables DEFAULT to it.
    expect(nextProjectRecordStatus("risk", "open")).toBe("watch");
    expect(projectRecordAdvanceLabel("risk", "open")).toBe("Move to watch");
    expect(nextProjectRecordStatus("issue", "open")).toBe("in_progress");
    expect(projectRecordAdvanceLabel("issue", "open")).toBe("Start work");
  });

  it("walks a risk and an issue all the way to their terminal state", () => {
    const walk = (recordType: ProjectRecordStatusType, from: string) => {
      const seen: string[] = [from];
      let current: string | null = from;
      while (current) {
        const next: string | null = nextProjectRecordStatus(recordType, current);
        if (!next) break;
        expect(seen, `${recordType} transitions cycle at ${next}`).not.toContain(next);
        seen.push(next);
        current = next;
      }
      return seen;
    };

    expect(walk("risk", "open")).toEqual(["open", "watch", "mitigated", "closed"]);
    expect(walk("issue", "open")).toEqual(["open", "in_progress", "resolved"]);
    // A blocked issue is not a dead end — it rejoins the path.
    expect(walk("issue", "blocked")).toEqual(["blocked", "in_progress", "resolved"]);
  });

  /**
   * EVERY lane in the registry must have a control somewhere a planner can see.
   *
   * This is the defect the registry was extracted to close, one level up. Risk
   * and issue shipped read-only for months because the transition tables lived
   * inside the button that rendered them and adding a lane meant copying a
   * switch statement. Now adding a lane costs one object literal — which makes
   * it cheap to add a lane that renders NOWHERE, and the vocabulary tests above
   * would pass for it happily, because they only ask whether the statuses match
   * the migration.
   *
   * The two reachability suites below prove the risk and issue controls render;
   * the delivery board and deliverable suites prove the other three. Nothing
   * proved the SIXTH lane would, so this scans the product surface for a
   * `RecordStatusAdvanceButton` bound to each registered recordType. It catches
   * "no control at all" only — a control behind the wrong permission, or one no
   * planner can navigate to, needs a rendering test like those below.
   */
  it("renders a control for every lane the registry declares", () => {
    const sourceRoots = ["src/app", "src/components"].map((dir) => path.join(process.cwd(), dir));

    const componentSources: string[] = [];
    const collect = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) collect(full);
        else if (entry.name.endsWith(".tsx")) componentSources.push(readFileSync(full, "utf8"));
      }
    };
    sourceRoots.forEach(collect);

    // Without this, a wrong root would find nothing and every assertion below
    // would fail as "no control" rather than as "the scan is broken".
    expect(componentSources.length, "the component scan found no .tsx files").toBeGreaterThan(50);

    const rendering = componentSources.filter((source) => source.includes("RecordStatusAdvanceButton"));

    for (const recordType of PROJECT_RECORD_STATUS_TYPES) {
      expect(
        rendering.some((source) => source.includes(`recordType="${recordType}"`)),
        `no surface renders a status control for the "${recordType}" lane — it is registered and unreachable`
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The route, driven for real.
// ---------------------------------------------------------------------------

const createClientMock = vi.fn();
const createApiAuditLoggerMock = vi.fn();
const authGetUserMock = vi.fn();
const projectsSingleMock = vi.fn();

function updateChain() {
  const maybeSingle = vi.fn();
  const select = vi.fn(() => ({ maybeSingle }));
  const eqProject = vi.fn(() => ({ select }));
  const eqId = vi.fn(() => ({ eq: eqProject }));
  const update = vi.fn(() => ({ eq: eqId }));
  return { maybeSingle, select, eqProject, eqId, update };
}

const risksChain = updateChain();
const issuesChain = updateChain();

const projectsSelectEqMock = vi.fn(() => ({ single: projectsSingleMock }));
const projectsSelectMock = vi.fn(() => ({ eq: projectsSelectEqMock }));

const membershipMaybeSingleMock = vi.fn();
const membershipSelectMock = vi.fn(() => ({
  eq: () => ({ eq: () => ({ maybeSingle: membershipMaybeSingleMock }) }),
}));

const fromMock = vi.fn((table: string) => {
  if (table === "projects") return { select: projectsSelectMock };
  if (table === "workspace_members") return { select: membershipSelectMock };
  if (table === "project_risks") return { update: risksChain.update };
  if (table === "project_issues") return { update: issuesChain.update };
  throw new Error(`Unexpected table: ${table}`);
});

const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

// The control is a client component; only the router is doubled, never the
// control itself — a test that stubs the thing it is named for proves nothing.
const routerRefreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: routerRefreshMock }),
}));

import { PATCH as patchRecord } from "@/app/api/projects/[projectId]/records/[recordId]/route";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const RISK_ID = "dddd1111-3333-4333-8333-333333333333";
const ISSUE_ID = "eeee1111-3333-4333-8333-333333333333";

function patch(recordId: string, payload: unknown) {
  return patchRecord(
    new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/records/${recordId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ projectId: PROJECT_ID, recordId }) }
  );
}

describe("PATCH /api/projects/[projectId]/records/[recordId] — risks and issues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);

    authGetUserMock.mockResolvedValue({
      data: { user: { id: "22222222-2222-4222-8222-222222222222" } },
    });
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "member" }, error: null });
    projectsSingleMock.mockResolvedValue({
      data: { id: PROJECT_ID, workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Corridor program" },
      error: null,
    });

    risksChain.maybeSingle.mockResolvedValue({
      data: {
        id: RISK_ID,
        title: "Right-of-way acquisition may slip",
        description: null,
        severity: "high",
        status: "watch",
        mitigation: null,
        created_at: "2026-03-13T07:00:00.000Z",
        updated_at: "2026-08-03T07:00:00.000Z",
      },
      error: null,
    });

    issuesChain.maybeSingle.mockResolvedValue({
      data: {
        id: ISSUE_ID,
        title: "Utility relocation drawings missing",
        description: null,
        severity: "medium",
        status: "in_progress",
        owner_label: "Delivery team",
        created_at: "2026-03-13T07:00:00.000Z",
        updated_at: "2026-08-03T07:00:00.000Z",
      },
      error: null,
    });

    createClientMock.mockResolvedValue({ auth: { getUser: authGetUserMock }, from: fromMock });
  });

  it("moves a risk to its next status", async () => {
    const response = await patch(RISK_ID, { recordType: "risk", status: "watch" });

    expect(response.status).toBe(200);
    expect(risksChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "watch", updated_at: expect.any(String) })
    );
    expect(risksChain.eqId).toHaveBeenCalledWith("id", RISK_ID);
    expect(risksChain.eqProject).toHaveBeenCalledWith("project_id", PROJECT_ID);
    expect(await response.json()).toMatchObject({ recordType: "risk", record: { id: RISK_ID, status: "watch" } });
  });

  it("moves an issue to its next status", async () => {
    const response = await patch(ISSUE_ID, { recordType: "issue", status: "in_progress" });

    expect(response.status).toBe(200);
    expect(issuesChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in_progress", updated_at: expect.any(String) })
    );
    expect(issuesChain.eqId).toHaveBeenCalledWith("id", ISSUE_ID);
    expect(issuesChain.eqProject).toHaveBeenCalledWith("project_id", PROJECT_ID);
    expect(await response.json()).toMatchObject({ recordType: "issue", record: { id: ISSUE_ID, status: "in_progress" } });
  });

  // Every status either lane can hold has to be settable, or the select offers a
  // value the route refuses and the planner gets "Invalid input" for a state the
  // database would have accepted.
  it("accepts every status the control can offer, and no other", async () => {
    for (const recordType of ["risk", "issue"] as const) {
      const chain = recordType === "risk" ? risksChain : issuesChain;
      const recordId = recordType === "risk" ? RISK_ID : ISSUE_ID;

      for (const status of PROJECT_RECORD_STATUS_LANES[recordType].statuses) {
        chain.update.mockClear();
        const response = await patch(recordId, { recordType, status });
        expect(response.status, `${recordType} -> ${status}`).toBe(200);
        expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ status }));
      }

      chain.update.mockClear();
      const refused = await patch(recordId, { recordType, status: "archived" });
      expect(refused.status, `${recordType} accepted a status the database would reject`).toBe(400);
      expect(chain.update).not.toHaveBeenCalled();
    }
  });

  // A transition route is narrow on purpose. Severity, mitigation text and the
  // issue owner are editing, and the register's severity is what a stage gate
  // and the project header read — a status control must not be able to change it.
  it("writes only the status, even when the body carries more", async () => {
    await patch(RISK_ID, {
      recordType: "risk",
      status: "closed",
      severity: "low",
      mitigation: "handled",
      title: "renamed",
    });

    const payload = (risksChain.update.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(["status", "updated_at"]);
  });

  it("answers 404 rather than 200 when the record is not in this project", async () => {
    risksChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const missing = await patch(RISK_ID, { recordType: "risk", status: "closed" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ error: "No such risk" });

    issuesChain.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const missingIssue = await patch(ISSUE_ID, { recordType: "issue", status: "resolved" });
    expect(missingIssue.status).toBe(404);
    expect(await missingIssue.json()).toMatchObject({ error: "No such issue" });
  });

  it("refuses a viewer and writes nothing", async () => {
    membershipMaybeSingleMock.mockResolvedValue({ data: { role: "viewer" }, error: null });

    const risk = await patch(RISK_ID, { recordType: "risk", status: "closed" });
    expect(risk.status).toBe(403);
    expect(risksChain.update).not.toHaveBeenCalled();

    const issue = await patch(ISSUE_ID, { recordType: "issue", status: "resolved" });
    expect(issue.status).toBe(403);
    expect(issuesChain.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Reachability, over rows the real loader produced.
// ---------------------------------------------------------------------------

import { loadProjectRecordLanes } from "@/app/(app)/projects/[projectId]/_components/_record-lanes";
import { ProjectRiskAndDecisionLog } from "@/app/(app)/projects/[projectId]/_components/project-risk-decision-log";
import { ReadFailureLog } from "@/lib/ui/read-failures";

/**
 * A Supabase double that answers the loader's own chain and hands back only the
 * columns the loader asked for. The projection is applied, not ignored: a column
 * dropped from `_record-lanes.ts` arrives here as `undefined`, exactly as it
 * would from PostgREST — which is what makes this able to catch a missing
 * `status` in the projection, where a fixture-fed render could not.
 */
function laneSupabase(
  rowsByTable: Record<string, Record<string, unknown>[]>,
  projections: Record<string, string> = {}
) {
  return {
    from(table: string) {
      return {
        select(columns: string) {
          projections[table] = columns;
          const requested = columns.split(",").map((column) => column.trim());
          return {
            eq() {
              return {
                order() {
                  return {
                    limit() {
                      const rows = (rowsByTable[table] ?? []).map((row) =>
                        Object.fromEntries(requested.map((column) => [column, row[column]]))
                      );
                      return Promise.resolve({ data: rows, error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

describe("a planner can move a risk and an issue from the project page", () => {
  const projections: Record<string, string> = {};

  async function renderPanelFromTheLoader() {
    const lanes = await loadProjectRecordLanes(
      laneSupabase({
        project_risks: [
          {
            id: RISK_ID,
            title: "Right-of-way acquisition may slip",
            description: "Two parcels are unappraised.",
            severity: "high",
            status: "open",
            mitigation: null,
            created_at: "2026-03-13T07:00:00.000Z",
          },
        ],
        project_issues: [
          {
            id: ISSUE_ID,
            title: "Utility relocation drawings missing",
            description: "Waiting on the utility.",
            severity: "medium",
            status: "open",
            owner_label: "Delivery team",
            created_at: "2026-03-13T07:00:00.000Z",
          },
        ],
        project_decisions: [],
        project_meetings: [],
      }, projections),
      PROJECT_ID,
      new ReadFailureLog()
    );

    // If the loader stopped returning either lane, the render below would show
    // an empty register and every assertion after it would fail for the wrong
    // reason. Say so here instead.
    expect(lanes.risks, "the real loader returned no risks").toHaveLength(1);
    expect(lanes.issues, "the real loader returned no issues").toHaveLength(1);

    render(
      <ProjectRiskAndDecisionLog
        projectId={PROJECT_ID}
        risks={lanes.risks}
        issues={lanes.issues}
        decisions={lanes.decisions}
        meetings={lanes.meetings}
        risksReadFailed={lanes.risksReadFailed}
        issuesReadFailed={lanes.issuesReadFailed}
        decisionsReadFailed={lanes.decisionsReadFailed}
        meetingsReadFailed={lanes.meetingsReadFailed}
      />
    );

    return lanes;
  }

  /**
   * The control's whole state is `currentStatus`. A `.select()` string is never
   * checked against the schema in this repo, so dropping `status` or `id` from
   * the lane projection would leave every assertion below green against a
   * fixture-fed render while the real page rendered a control wired to
   * `undefined`. Assert on the projection the loader actually asked for.
   */
  it("asks the database for the id and status the control needs", async () => {
    await renderPanelFromTheLoader();

    for (const table of ["project_risks", "project_issues"]) {
      const columns = (projections[table] ?? "").split(",").map((column) => column.trim());
      expect(columns, `${table} projection`).toContain("id");
      expect(columns, `${table} projection`).toContain("status");
    }
  });

  it("renders a forward action and the full vocabulary on the risk register", async () => {
    await renderPanelFromTheLoader();

    const register = document.querySelector("#project-risks") as HTMLElement;
    expect(register).toBeTruthy();

    expect(within(register).getByRole("button", { name: "Move to watch" })).toBeInTheDocument();

    const select = within(register).getByLabelText("Set risk status") as HTMLSelectElement;
    expect(select.value).toBe("open");
    expect([...select.options].map((option) => option.value).sort()).toEqual(
      [...PROJECT_RECORD_STATUS_LANES.risk.statuses].sort()
    );
  });

  it("renders a forward action and the full vocabulary on the issue log", async () => {
    await renderPanelFromTheLoader();

    const log = document.querySelector("#project-issues") as HTMLElement;
    expect(log).toBeTruthy();

    expect(within(log).getByRole("button", { name: "Start work" })).toBeInTheDocument();

    const select = within(log).getByLabelText("Set issue status") as HTMLSelectElement;
    expect(select.value).toBe("open");
    expect([...select.options].map((option) => option.value).sort()).toEqual(
      [...PROJECT_RECORD_STATUS_LANES.issue.statuses].sort()
    );
  });

  /**
   * The join between the two halves. Everything above proves the control exists
   * and the route accepts the write; only this proves the control talks to that
   * route — the seam where a capability with both ends built still goes nowhere.
   */
  it("sends the forward move to the record route when a planner clicks it", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ recordType: "risk", record: {} }) })
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await renderPanelFromTheLoader();

      const register = document.querySelector("#project-risks") as HTMLElement;
      fireEvent.click(within(register).getByRole("button", { name: "Move to watch" }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(`/api/projects/${PROJECT_ID}/records/${RISK_ID}`);
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(String(init.body))).toEqual({ recordType: "risk", status: "watch" });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not offer a status control where there is nothing to move", async () => {
    const lanes = await loadProjectRecordLanes(
      laneSupabase({ project_risks: [], project_issues: [], project_decisions: [], project_meetings: [] }),
      PROJECT_ID,
      new ReadFailureLog()
    );

    render(
      <ProjectRiskAndDecisionLog
        projectId={PROJECT_ID}
        risks={lanes.risks}
        issues={lanes.issues}
        decisions={lanes.decisions}
        meetings={lanes.meetings}
      />
    );

    expect(screen.queryByLabelText("Set risk status")).toBeNull();
    expect(screen.queryByLabelText("Set issue status")).toBeNull();
  });

  /**
   * The panel takes `projectId` as a REQUIRED prop, so `tsc` already refuses a
   * page that forgets it. This asserts the same thing against the page source
   * because a later change could make the prop optional to quiet the compiler,
   * and the failure mode of that — controls that render and PATCH `undefined` —
   * is silent at build time and invisible until a planner clicks.
   */
  it("is handed a project id by the project detail page", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/(app)/projects/[projectId]/page.tsx"),
      "utf8"
    );
    const openingTag = source.slice(source.indexOf("<ProjectRiskAndDecisionLog"));
    const props = openingTag.slice(0, openingTag.indexOf("/>"));

    expect(openingTag.startsWith("<ProjectRiskAndDecisionLog"), "the page no longer renders the panel").toBe(true);
    expect(props).toMatch(/projectId=\{/);
  });
});
