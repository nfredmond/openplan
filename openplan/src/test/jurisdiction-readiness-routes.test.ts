import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const authGetUserMock = vi.fn();
const membershipMock = vi.fn();
const workspaceReadMock = vi.fn();
const projectReadMock = vi.fn();
const selectMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: authGetUserMock },
    from: (table: string) => ({
      select: (columns: string) => {
        selectMock(table, columns);
        return {
          eq: () => ({ maybeSingle: table === "workspaces" ? workspaceReadMock : projectReadMock }),
        };
      },
    }),
  }),
}));

vi.mock("@/lib/workspaces/membership", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/membership")>(
    "@/lib/workspaces/membership",
  );
  return {
    ...actual,
    checkWorkspaceMembership: (...args: unknown[]) => membershipMock(...args),
  };
});

import { GET as getWorkspaceReadiness } from "@/app/api/workspaces/jurisdiction-readiness/route";
import { GET as getProjectReadiness } from "@/app/api/projects/[projectId]/jurisdiction-readiness/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "33333333-3333-4333-8333-333333333333";

describe("jurisdiction readiness APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authGetUserMock.mockResolvedValue({ data: { user: { id: USER_ID } } });
    membershipMock.mockResolvedValue({ ok: true, role: "member" });
    workspaceReadMock.mockResolvedValue({
      data: {
        home_geography_source: "tigerweb",
        home_geography_kind: "county",
        home_geography_ref: "41017",
        home_geography_label: "Deschutes County, Oregon",
        home_country_code: "US",
        home_subdivision_code: "OR",
      },
      error: null,
    });
    projectReadMock.mockResolvedValue({
      data: {
        id: PROJECT_ID,
        place_label: "Puerto Rico",
        place_country_code: "US",
        place_subdivision_code: "PR",
      },
      error: null,
    });
  });

  it("returns the same evidence-backed Oregon cells with an exact registry hash", async () => {
    const request = new NextRequest(
      `http://localhost/api/workspaces/jurisdiction-readiness?workspaceId=${WORKSPACE_ID}&download=1`,
    );
    const response = await getWorkspaceReadiness(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toContain("jurisdiction-readiness-");
    expect(membershipMock).toHaveBeenCalledWith(expect.anything(), USER_ID, WORKSPACE_ID);
    expect(selectMock).toHaveBeenCalledWith(
      "workspaces",
      expect.stringContaining("home_subdivision_code"),
    );
    expect(body.registrySha256).toMatch(/^[0-9a-f]{64}$/);
    expect(body.jurisdiction.id).toBe("US-OR");
    expect(body.reports.find((report: { job: { id: string } }) => report.job.id === "grants-and-reimbursement"))
      .toMatchObject({ status: "partial", adapterIds: ["us-federal", "us-or"] });
  });

  it("uses the project place and keeps Puerto Rico's unavailable claims visible", async () => {
    const request = new NextRequest(
      `http://localhost/api/projects/${PROJECT_ID}/jurisdiction-readiness?download=1`,
    );
    const response = await getProjectReadiness(request, {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.jurisdiction.id).toBe("US-PR");
    expect(body.reports.find((report: { job: { id: string } }) => report.job.id === "land-use-plan"))
      .toMatchObject({ status: "unavailable", adapterIds: [] });
  });

  it("does not reveal a workspace to a non-member", async () => {
    membershipMock.mockResolvedValueOnce({ ok: false, kind: "not_member" });
    const response = await getWorkspaceReadiness(
      new NextRequest(`http://localhost/api/workspaces/jurisdiction-readiness?workspaceId=${WORKSPACE_ID}`),
    );

    expect(response.status).toBe(404);
    expect(workspaceReadMock).not.toHaveBeenCalled();
  });

  it("does not turn a failed project read into an unassessed jurisdiction", async () => {
    projectReadMock.mockResolvedValueOnce({ data: null, error: { message: "database unavailable" } });
    const response = await getProjectReadiness(
      new NextRequest(`http://localhost/api/projects/${PROJECT_ID}/jurisdiction-readiness`),
      { params: Promise.resolve({ projectId: PROJECT_ID }) },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Project jurisdiction could not be read" });
  });
});
