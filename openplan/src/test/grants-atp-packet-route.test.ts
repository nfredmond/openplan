import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createClientMock = vi.fn();
const authGetUserMock = vi.fn();
const loadFundingOpportunityAccessMock = vi.fn();
const mockAudit = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));
vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: () => mockAudit,
}));
vi.mock("@/lib/programs/api", () => ({
  loadFundingOpportunityAccess: (...args: unknown[]) => loadFundingOpportunityAccessMock(...args),
}));

import { GET } from "@/app/api/funding-opportunities/[opportunityId]/application/atp-packet/route";

/**
 * The ATP packet route: who gets a packet, which columns it reads, and that a
 * failed evidence read is an error rather than a packet of "not recorded".
 *
 * Blind category: the chain mock records filters but does not evaluate them,
 * so tenant scoping is asserted as the filters sent, not as rows withheld.
 */

const OPPORTUNITY_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "33333333-3333-4333-8333-333333333333";
const PROJECT_ID = "44444444-4444-4444-8444-444444444444";
const USER_ID = "22222222-2222-4222-8222-222222222222";

type QueryResult = { data: unknown; error: { message: string } | null };
type Call = { method: string; args: unknown[] };

const calls: Record<string, Call[]> = {};

function makeQuery(table: string, result: QueryResult) {
  const chain: Record<string, unknown> = {};
  calls[table] = [];
  for (const method of ["select", "eq", "order", "limit"]) {
    chain[method] = (...args: unknown[]) => {
      calls[table].push({ method, args });
      return chain;
    };
  }
  chain.maybeSingle = async () => result;
  chain.then = (resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function install(results: Record<string, QueryResult>) {
  createClientMock.mockResolvedValue({
    auth: { getUser: authGetUserMock },
    from: (table: string) => {
      const result = results[table];
      if (!result) throw new Error(`Unexpected table: ${table}`);
      return makeQuery(table, result);
    },
  });
}

const ATP_SECTIONS = [
  { section_key: "project-narrative", source: "catalog" },
  { section_key: "disadvantaged-communities", source: "catalog" },
];

const RUN = {
  id: "run-9",
  title: "Main Street corridor",
  created_at: "2026-09-02T17:00:00Z",
  metrics: { safetyScore: 64, equityScore: 71 },
};

function access(projectId: string | null) {
  loadFundingOpportunityAccessMock.mockResolvedValue({
    opportunity: { id: OPPORTUNITY_ID, workspace_id: WORKSPACE_ID, project_id: projectId },
    membership: { workspace_id: WORKSPACE_ID, role: "member" },
    error: null,
    allowed: true,
  });
}

const context = { params: Promise.resolve({ opportunityId: OPPORTUNITY_ID }) };
const url = (query = "") =>
  new NextRequest(`http://localhost/api/funding-opportunities/${OPPORTUNITY_ID}/application/atp-packet${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  for (const key of Object.keys(calls)) delete calls[key];
  authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
  access(PROJECT_ID);
});

describe("GET /api/funding-opportunities/[id]/application/atp-packet", () => {
  it("builds the packet from the project's latest run, reading only the columns it needs", async () => {
    install({
      funding_opportunity_application_sections: { data: ATP_SECTIONS, error: null },
      projects: { data: { id: PROJECT_ID, name: "Main Street safe routes" }, error: null },
      runs: { data: [RUN], error: null },
    });

    const response = await GET(url(), context);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.packet.applications[0]).toMatchObject({
      project_id: PROJECT_ID,
      name: "Main Street safe routes",
      safety_score: 64,
      equity_score: 71,
      total_score: null,
      equity_recorded: false,
    });
    expect(body.scoreRun).toEqual({ id: "run-9", title: "Main Street corridor", createdAt: "2026-09-02T17:00:00Z" });

    expect(calls.funding_opportunity_application_sections).toEqual([
      { method: "select", args: ["section_key, source"] },
      { method: "eq", args: ["opportunity_id", OPPORTUNITY_ID] },
    ]);
    expect(calls.projects).toEqual([
      { method: "select", args: ["id, name"] },
      { method: "eq", args: ["id", PROJECT_ID] },
      { method: "eq", args: ["workspace_id", WORKSPACE_ID] },
    ]);
    expect(calls.runs).toEqual([
      { method: "select", args: ["id, title, created_at, metrics"] },
      { method: "eq", args: ["workspace_id", WORKSPACE_ID] },
      { method: "eq", args: ["project_id", PROJECT_ID] },
      { method: "order", args: ["created_at", { ascending: false }] },
      { method: "limit", args: [1] },
    ]);
    expect(loadFundingOpportunityAccessMock).toHaveBeenCalledWith(expect.anything(), OPPORTUNITY_ID, USER_ID, "programs.read");
  });

  it("refuses an application seeded from another program", async () => {
    install({
      funding_opportunity_application_sections: {
        data: [
          { section_key: "project-overview", source: "catalog" },
          { section_key: "safety-problem-and-impact", source: "catalog" },
        ],
        error: null,
      },
    });

    const response = await GET(url(), context);
    expect(response.status).toBe(404);
    expect(calls.runs).toBeUndefined();
  });

  it("asks for a project when the opportunity has none", async () => {
    access(null);
    install({ funding_opportunity_application_sections: { data: ATP_SECTIONS, error: null } });

    const response = await GET(url(), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ packet: null, missing: "project" });
  });

  it("reports a failed run read as an error, not as unscored", async () => {
    install({
      funding_opportunity_application_sections: { data: ATP_SECTIONS, error: null },
      projects: { data: { id: PROJECT_ID, name: "Main Street safe routes" }, error: null },
      runs: { data: null, error: { message: "boom" } },
    });

    const response = await GET(url(), context);
    expect(response.status).toBe(500);
  });

  it("downloads the rendered packet as Markdown", async () => {
    install({
      funding_opportunity_application_sections: { data: ATP_SECTIONS, error: null },
      projects: { data: { id: PROJECT_ID, name: "Main Street safe routes" }, error: null },
      runs: { data: [RUN], error: null },
    });

    const response = await GET(url("?format=markdown"), context);
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/markdown");
    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="atp-scoring-packet-\d{4}-\d{2}-\d{2}\.md"$/);
    expect(text).toContain("# California ATP Application Packet — run `run-9`");
    expect(text).toContain("| Safety | 64.0 |");
    expect(text).toContain("| Climate | Not recorded |");
    expect(text).toContain("- SB 535 DAC: Not recorded");
  });

  it("denies a caller without read access", async () => {
    loadFundingOpportunityAccessMock.mockResolvedValue({
      opportunity: { id: OPPORTUNITY_ID, workspace_id: WORKSPACE_ID, project_id: PROJECT_ID },
      membership: null,
      error: null,
      allowed: false,
    });
    install({});
    expect((await GET(url(), context)).status).toBe(403);
  });
});
