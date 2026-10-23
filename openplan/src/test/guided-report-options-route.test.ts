import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  client: vi.fn(), options: vi.fn(), auditFactory: vi.fn(),
  audit: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/observability/audit", () => ({ createApiAuditLogger: mocks.auditFactory }));
vi.mock("@/lib/reports/guided-comparison-server", () => ({ loadGuidedReportOptions: mocks.options }));
import { GET } from "@/app/api/reports/guided-comparisons/route";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const WORKSPACE = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
type Result = { data: Record<string, unknown> | null; error: { message: string } | null };
let project: Result;
let membership: Result;
let user: { id: string } | null;
let authError: { message: string } | null;
let reads: Array<{ table: string; columns: string; filters: Array<[string, unknown]> }>;

const request = () => new NextRequest(`http://localhost/api/reports/guided-comparisons?projectId=${PROJECT}`);

beforeEach(() => {
  vi.clearAllMocks();
  user = { id: USER }; authError = null; reads = [];
  project = { data: { id: PROJECT, workspace_id: WORKSPACE }, error: null };
  membership = { data: { workspace_id: WORKSPACE, role: "viewer" }, error: null };
  mocks.auditFactory.mockReturnValue(mocks.audit);
  mocks.options.mockResolvedValue([{ id: "snapshot", projectId: PROJECT, label: "Saved comparison" }]);
  mocks.client.mockImplementation(async () => ({
    auth: { getUser: async () => ({ data: { user }, error: authError }) },
    from: (table: string) => ({ select: (columns: string) => {
      const read = { table, columns, filters: [] as Array<[string, unknown]> }; reads.push(read);
      const query = {
        eq(column: string, value: unknown) { read.filters.push([column, value]); return query; },
        async maybeSingle() {
          if (table === "projects") return project;
          if (table === "workspace_members") return membership;
          throw new Error(`Unexpected table ${table}`);
        },
      };
      return query;
    } }),
  }));
});

describe("guided report comparison discovery audit", () => {
  it("audits a scoped viewer read without logging comparison labels", async () => {
    const incoming = request(); const response = await GET(incoming);
    expect(response.status).toBe(200);
    expect(mocks.auditFactory).toHaveBeenCalledWith("reports.guided-comparisons", incoming);
    expect(reads).toEqual([
      { table: "projects", columns: "id, workspace_id", filters: [["id", PROJECT]] },
      { table: "workspace_members", columns: "workspace_id, role", filters: [["workspace_id", WORKSPACE], ["user_id", USER]] },
    ]);
    expect(mocks.options).toHaveBeenCalledWith(expect.anything(), WORKSPACE, PROJECT);
    expect(await response.json()).toEqual({ options: [{ id: "snapshot", projectId: PROJECT, label: "Saved comparison" }] });
    expect(mocks.audit.info).toHaveBeenCalledWith("guided_comparisons_read_succeeded", { optionCount: 1 });
    expect(JSON.stringify(mocks.audit.info.mock.calls)).not.toContain("Saved comparison");
  });

  it("audits invalid input before creating a client", async () => {
    expect((await GET(new NextRequest("http://localhost/api/reports/guided-comparisons?projectId=bad"))).status).toBe(400);
    expect(mocks.audit.warn).toHaveBeenCalledWith("validation_failed");
    expect(mocks.client).not.toHaveBeenCalled();
  });

  it.each(["no user", "auth error"])("refuses %s before project reads", async (failure) => {
    if (failure === "no user") user = null;
    else authError = { message: "Private auth detail" };
    expect((await GET(request())).status).toBe(401);
    expect(mocks.audit.warn).toHaveBeenCalledWith("authentication_required");
    expect(reads).toEqual([]);
    expect(mocks.options).not.toHaveBeenCalled();
  });

  it.each([
    ["project error", 503, "project_read_failed"],
    ["missing project", 404, "project_not_found"],
    ["membership error", 503, "workspace_access_read_failed"],
    ["missing membership", 403, "workspace_access_denied"],
    ["unknown role", 403, "workspace_access_denied"],
  ] as const)("audits %s and refuses discovery", async (failure, status, event) => {
    if (failure === "project error") project = { data: null, error: { message: "Private detail" } };
    if (failure === "missing project") project.data = null;
    if (failure === "membership error") membership = { data: null, error: { message: "Private detail" } };
    if (failure === "missing membership") membership.data = null;
    if (failure === "unknown role") membership.data = { workspace_id: WORKSPACE, role: "unknown" };
    const response = await GET(request());
    expect(response.status).toBe(status);
    expect(status === 503 ? mocks.audit.error : mocks.audit.warn).toHaveBeenCalledWith(event);
    expect(mocks.options).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain("Private detail");
  });

  it.each(["client", "options"])("audits a rejected %s read without private details", async (failure) => {
    (failure === "client" ? mocks.client : mocks.options).mockRejectedValueOnce(new Error("Private transport detail"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(mocks.audit.error).toHaveBeenCalledWith("guided_comparisons_read_failed");
    expect(JSON.stringify(await response.json())).not.toContain("Private transport detail");
    expect(JSON.stringify(mocks.audit.error.mock.calls)).not.toContain("Private transport detail");
  });
});
