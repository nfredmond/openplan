import { beforeEach, describe, expect, it, vi } from "vitest";

const createClientMock = vi.fn();
const loadCurrentWorkspaceMembershipMock = vi.fn();
const loadBehavioralOnrampKpisForWorkspaceMock = vi.fn();
const redirectMock = vi.fn();
const authGetUserMock = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (...args: unknown[]) => {
    redirectMock(...args);
    throw new Error("REDIRECT");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) =>
    loadCurrentWorkspaceMembershipMock(...args),
}));

vi.mock("@/lib/models/behavioral-onramp-kpis", () => ({
  loadBehavioralOnrampKpisForWorkspace: (...args: unknown[]) =>
    loadBehavioralOnrampKpisForWorkspaceMock(...args),
}));

vi.mock("@/components/county-runs/county-run-detail-client", () => ({
  CountyRunDetailClient: () => null,
}));

vi.mock("@/components/workspaces/workspace-membership-required", () => ({
  WorkspaceMembershipRequired: () => null,
}));

vi.mock(
  "@/app/(app)/county-runs/[countyRunId]/_components/county-run-behavioral-kpis",
  () => ({
    CountyRunBehavioralKpisSection: () => null,
  })
);

import CountyRunDetailPage from "@/app/(app)/county-runs/[countyRunId]/page";

const COUNTY_RUN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";

function emptyKpiResult() {
  return {
    kpis: [],
    rejectedCountyRunIds: [],
    caveatGateReason: null,
    error: null,
  };
}

describe("CountyRunDetailPage — modeling caveat page consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    authGetUserMock.mockResolvedValue({
      data: { user: { id: "11111111-1111-4111-8111-111111111111" } },
    });
    createClientMock.mockResolvedValue({
      auth: { getUser: authGetUserMock },
    });
    loadCurrentWorkspaceMembershipMock.mockResolvedValue({
      membership: { workspace_id: WORKSPACE_ID, role: "owner" },
    });
    loadBehavioralOnrampKpisForWorkspaceMock.mockResolvedValue(emptyKpiResult());
  });

  it("passes acceptScreeningGrade=false when ?includeScreening is absent", async () => {
    await CountyRunDetailPage({
      params: Promise.resolve({ countyRunId: COUNTY_RUN_ID }),
      searchParams: Promise.resolve({}),
    });

    expect(loadBehavioralOnrampKpisForWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(loadBehavioralOnrampKpisForWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        consent: { acceptScreeningGrade: false },
      })
    );
  });

  it("passes acceptScreeningGrade=true when ?includeScreening=1", async () => {
    await CountyRunDetailPage({
      params: Promise.resolve({ countyRunId: COUNTY_RUN_ID }),
      searchParams: Promise.resolve({ includeScreening: "1" }),
    });

    expect(loadBehavioralOnrampKpisForWorkspaceMock).toHaveBeenCalledTimes(1);
    expect(loadBehavioralOnrampKpisForWorkspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        consent: { acceptScreeningGrade: true },
      })
    );
  });

  it("fails closed for any value other than the literal string \"1\"", async () => {
    const failClosedValues = ["true", "yes", "on", "0", "", " 1", "1 "];

    for (const value of failClosedValues) {
      loadBehavioralOnrampKpisForWorkspaceMock.mockClear();

      await CountyRunDetailPage({
        params: Promise.resolve({ countyRunId: COUNTY_RUN_ID }),
        searchParams: Promise.resolve({ includeScreening: value }),
      });

      expect(loadBehavioralOnrampKpisForWorkspaceMock).toHaveBeenCalledTimes(1);
      expect(loadBehavioralOnrampKpisForWorkspaceMock).toHaveBeenCalledWith(
        expect.objectContaining({
          consent: { acceptScreeningGrade: false },
        })
      );
    }
  });

  it("redirects to /sign-in when there is no authenticated user", async () => {
    authGetUserMock.mockResolvedValueOnce({ data: { user: null } });

    await expect(
      CountyRunDetailPage({
        params: Promise.resolve({ countyRunId: COUNTY_RUN_ID }),
        searchParams: Promise.resolve({}),
      })
    ).rejects.toThrow("REDIRECT");

    expect(redirectMock).toHaveBeenCalledWith(`/sign-in?next=/county-runs/${COUNTY_RUN_ID}`);
    expect(loadBehavioralOnrampKpisForWorkspaceMock).not.toHaveBeenCalled();
  });
});
