import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildProjectFundingProfileScan, buildProjectFundingStackSummary } from "@/lib/projects/funding";

/**
 * KI-2026-11-16-140: completing an award's obligation milestone recorded no
 * date and left the Funding scan reading "Obligation timing: Overdue". The
 * route now requires the date, and the scan treats an award whose obligation
 * milestone is complete with a date (or whose obligated-on date is recorded)
 * as having met its obligation.
 */
describe("the Funding scan reads a met obligation", () => {
  const overdueAward = {
    id: "award-1",
    awarded_amount: 200_000,
    match_amount: 50_000,
    risk_flag: "none",
    obligation_due_at: "2026-03-31T00:00:00.000Z",
  };
  const now = "2026-11-16T00:00:00.000Z";
  const obligationLane = (award: Record<string, unknown>) =>
    buildProjectFundingProfileScan({
      summary: buildProjectFundingStackSummary({ funding_need_amount: 250_000, local_match_need_amount: 50_000 }, [award], [], []),
      now,
    }).lanes.find((lane) => lane.id === "obligation");

  it("still reads overdue when nothing says the award was obligated", () => {
    expect(obligationLane(overdueAward)).toMatchObject({ status: "blocked", statusLabel: "Overdue" });
  });

  it("reads obligated, with the date, once the obligation milestone is complete", () => {
    expect(obligationLane({ ...overdueAward, obligation_completed_on: "2026-03-15" })).toMatchObject({
      status: "ready",
      statusLabel: "Obligated",
      detail: "Obligated on 2026-03-15.",
    });
  });

  it("reads the award's obligated-on date when both dates are set and differ (review 95)", () => {
    expect(obligationLane({ ...overdueAward, obligated_on: "2026-03-10", obligation_completed_on: "2026-03-15" })).toMatchObject({
      status: "ready",
      detail: "Obligated on 2026-03-10.",
    });
  });

  it("reads obligated from the award's own obligated-on date", () => {
    expect(obligationLane({ ...overdueAward, obligated_on: "2026-03-10" })).toMatchObject({
      status: "ready",
      statusLabel: "Obligated",
      detail: "Obligated on 2026-03-10.",
    });
  });

  it("keeps the next unmet award's deadline when only one of two is obligated", () => {
    const scan = buildProjectFundingProfileScan({
      summary: buildProjectFundingStackSummary(
        { funding_need_amount: 400_000, local_match_need_amount: 0 },
        [
          { ...overdueAward, obligation_completed_on: "2026-03-15" },
          { ...overdueAward, id: "award-2", obligation_due_at: "2027-06-30T00:00:00.000Z" },
        ],
        [],
        []
      ),
      now,
    });
    expect(scan.lanes.find((lane) => lane.id === "obligation")).toMatchObject({ status: "ready", statusLabel: "Scheduled" });
  });
});

const createClientMock = vi.fn();
const updateMock = vi.fn();
const awardUpdateMock = vi.fn();
let milestoneKind: { milestone_type: string; actual_date: string | null };
/** The award row the route may write; the fake applies the route's filters as PostgREST would. */
let awardRow: { id: string; project_id: string; obligated_on: string | null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
  createServiceRoleClient: vi.fn(),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/assistant/action-approval-server", () => ({ readAssistantExecutionSource: () => "manual" }));

import { PATCH } from "@/app/api/projects/[projectId]/records/[recordId]/route";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MILESTONE_ID = "aaaa1111-3333-4333-8333-333333333333";

function from(table: string) {
  if (table === "projects") {
    return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: PROJECT_ID, workspace_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }, error: null }) }) }) };
  }
  if (table === "workspace_members") {
    return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "member" }, error: null }) }) }) }) };
  }
  if (table === "project_milestones") {
    return {
      select: (columns: string) => {
        const row = columns.includes("milestone_type")
          ? milestoneKind
          : { id: MILESTONE_ID, project_id: PROJECT_ID, funding_award_id: "award-1", handoff_origin_revision_id: null };
        const chain = { eq: () => chain, maybeSingle: async () => ({ data: row, error: null }) };
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        updateMock(payload);
        const chain = {
          eq: () => chain,
          is: () => chain,
          select: () => chain,
          maybeSingle: async () => ({
            data: { id: MILESTONE_ID, milestone_type: milestoneKind.milestone_type, actual_date: milestoneKind.actual_date, ...payload },
            error: null,
          }),
        };
        return chain;
      },
    };
  }
  if (table === "funding_awards") {
    return {
      update: (payload: { obligated_on: string }) => {
        const filters: Array<(row: typeof awardRow) => boolean> = [];
        const chain = {
          eq: (column: "id" | "project_id", value: string) => { filters.push((row) => row[column] === value); return chain; },
          is: (column: "obligated_on", value: null) => { filters.push((row) => row[column] === value); return chain; },
          select: async () => {
            awardUpdateMock(payload);
            const matched = filters.every((test) => test(awardRow));
            if (matched) awardRow = { ...awardRow, ...payload };
            return { data: matched ? [{ id: awardRow.id }] : [], error: null };
          },
        };
        return chain;
      },
    };
  }
  throw new Error(`Unexpected table: ${table}`);
}

function patch(body: Record<string, unknown>) {
  return PATCH(
    new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/records/${MILESTONE_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ projectId: PROJECT_ID, recordId: MILESTONE_ID }) }
  );
}

describe("completing an obligation milestone records the date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: "22222222-2222-4222-8222-222222222222" } } }) },
      from,
    });
    milestoneKind = { milestone_type: "obligation", actual_date: null };
    awardRow = { id: "award-1", project_id: PROJECT_ID, obligated_on: null };
  });

  it("writes the milestone's date to an award with no obligated-on date (review 95)", async () => {
    const response = await patch({ recordType: "milestone", status: "complete", actualDate: "2026-03-15" });
    expect(response.status).toBe(200);
    expect(awardRow.obligated_on).toBe("2026-03-15");
    expect((await response.json()).awardObligatedOn).toEqual({ saved: true, date: "2026-03-15" });
  });

  it("never overwrites an obligated-on date the award already holds", async () => {
    awardRow = { id: "award-1", project_id: PROJECT_ID, obligated_on: "2026-03-10" };
    const response = await patch({ recordType: "milestone", status: "complete", actualDate: "2026-03-15" });
    expect(response.status).toBe(200);
    expect(awardRow.obligated_on).toBe("2026-03-10");
    expect((await response.json()).awardObligatedOn).toEqual({ saved: false, date: "2026-03-15" });
  });

  it("writes no award date for other milestones", async () => {
    milestoneKind = { milestone_type: "authorization", actual_date: null };
    const response = await patch({ recordType: "milestone", status: "complete", actualDate: "2026-03-15" });
    expect(response.status).toBe(200);
    expect(awardUpdateMock).not.toHaveBeenCalled();
    expect(awardRow.obligated_on).toBeNull();
  });

  it("refuses to complete an obligation milestone with no date and saves nothing", async () => {
    const response = await patch({ recordType: "milestone", status: "complete" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Completing an obligation milestone needs the date the award was obligated." });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("completes it with the date", async () => {
    const response = await patch({ recordType: "milestone", status: "complete", actualDate: "2026-03-15" });
    expect(response.status).toBe(200);
    expect(updateMock.mock.calls[0][0]).toMatchObject({ status: "complete", actual_date: "2026-03-15" });
  });

  it("does not ask again when the milestone already holds a date", async () => {
    milestoneKind = { milestone_type: "obligation", actual_date: "2026-03-15" };
    const response = await patch({ recordType: "milestone", status: "complete" });
    expect(response.status).toBe(200);
  });

  it("does not ask for a date on other milestones", async () => {
    milestoneKind = { milestone_type: "authorization", actual_date: null };
    const response = await patch({ recordType: "milestone", status: "complete" });
    expect(response.status).toBe(200);
  });
});
