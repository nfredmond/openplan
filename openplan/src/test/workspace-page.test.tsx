import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authGetUser = vi.fn();
const loadMembership = vi.fn();
const workspaceMaybeSingle = vi.fn();
const workspaceEq = vi.fn(() => ({ maybeSingle: workspaceMaybeSingle }));
const workspaceSelect = vi.fn(() => ({ eq: workspaceEq }));
const loadWorkerFacts = vi.fn();
const loadWorkerHealth = vi.fn();
const storageRpc = vi.fn();
const serviceRoleClient = vi.fn(() => ({ rpc: storageRpc }));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(() => {
    throw new Error("redirect");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: authGetUser },
    from: (table: string) => {
      if (table !== "workspaces") throw new Error(`Unexpected table ${table}`);
      return { select: workspaceSelect };
    },
  }),
  createServiceRoleClient: () => serviceRoleClient(),
}));

vi.mock("@/lib/workspaces/current", () => ({
  loadCurrentWorkspaceMembership: (...args: unknown[]) => loadMembership(...args),
}));

vi.mock("@/lib/config/deployment-health", () => ({
  evaluateDeploymentHealth: () => ({ status: "ready", problems: [] }),
}));

vi.mock("@/lib/config/deployment-health-facts", () => ({
  readDeploymentEnvFacts: () => ({}),
  resolveModelingWorkerDeclaration: () => "declared",
  loadModelingWorkerFacts: (...args: unknown[]) => loadWorkerFacts(...args),
}));

vi.mock("@/lib/models/worker-health-server", () => ({
  loadModelingWorkerHealth: (...args: unknown[]) => loadWorkerHealth(...args),
}));

vi.mock("@/lib/stage-gates/rebind", () => ({
  STAGE_GATE_BINDING_WORKSPACE_COLUMNS: "id, home_subdivision_code, stage_gate_template_id",
  buildStageGateRebindChoices: () => ({ kind: "bound", options: [] }),
}));

vi.mock("@/components/dashboard/build-identity-line", () => ({
  BuildIdentityLine: () => <div data-testid="build-identity" />,
}));
vi.mock("@/components/dashboard/deployment-health-panel", () => ({
  DeploymentHealthPanel: () => <div data-testid="deployment-health" />,
}));
vi.mock("@/components/workspaces/workspace-geography-panel", () => ({
  WorkspaceGeographyPanel: ({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) => (
    <div data-testid="workspace-geography" data-workspace-id={workspaceId} data-can-manage={String(canManage)} />
  ),
}));
vi.mock("@/components/workspaces/workspace-stage-gate-panel", () => ({
  WorkspaceStageGatePanel: ({ canManage }: { canManage: boolean }) => (
    <div data-testid="workspace-stage-gates" data-can-manage={String(canManage)} />
  ),
}));
vi.mock("@/components/workspaces/workspace-team-panel", () => ({
  WorkspaceTeamPanel: ({ canManage }: { canManage: boolean }) => (
    <div data-testid="workspace-team" data-can-manage={String(canManage)} />
  ),
}));
vi.mock("@/components/workspaces/workspace-integration-keys-panel", () => ({
  WorkspaceIntegrationKeysPanel: ({ canManage }: { canManage: boolean }) => (
    <div data-testid="workspace-integrations" data-can-manage={String(canManage)} />
  ),
}));
vi.mock("@/components/workspaces/workspace-membership-required", () => ({
  WorkspaceMembershipRequired: () => <div data-testid="workspace-required" />,
}));

import WorkspacePage from "@/app/(app)/workspace/page";

describe("WorkspacePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authGetUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    loadMembership.mockResolvedValue({
      membership: { workspace_id: "workspace-1", role: "owner" },
      workspace: { id: "workspace-1", name: "OpenPlan QA" },
    });
    workspaceMaybeSingle.mockResolvedValue({ data: { id: "workspace-1" }, error: null });
    loadWorkerFacts.mockResolvedValue({ declared: true });
    storageRpc.mockResolvedValue({ data: 1288490189, error: null });
    serviceRoleClient.mockImplementation(() => ({ rpc: storageRpc }));
    vi.unstubAllEnvs();
    loadWorkerHealth.mockResolvedValue({
      aequilibrae: { kind: "aequilibrae", state: "fresh", reason: "fresh" },
      activitysim: { kind: "activitysim", state: "fresh", reason: "fresh" },
    });
  });

  it("puts shared setup and deployment health on one workspace-scoped page", async () => {
    render(await WorkspacePage());

    // The page is named for its rail label; the workspace it describes is
    // stated under that name.
    expect(screen.getByRole("heading", { level: 1, name: "Workspace setup & health" })).toBeInTheDocument();
    expect(screen.getByText("OpenPlan QA")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-geography")).toHaveAttribute("data-workspace-id", "workspace-1");
    expect(screen.getByTestId("workspace-team")).toHaveAttribute("data-can-manage", "true");
    expect(screen.getByTestId("workspace-integrations")).toHaveAttribute("data-can-manage", "true");
    expect(screen.getByTestId("workspace-stage-gates")).toHaveAttribute("data-can-manage", "true");
    expect(screen.getByTestId("deployment-health")).toBeInTheDocument();
    expect(loadWorkerFacts).toHaveBeenCalled();
    expect(loadWorkerHealth).toHaveBeenCalledWith("declared");
  });

  it("shows shared facts read-only to a member and withholds operator health", async () => {
    loadMembership.mockResolvedValueOnce({
      membership: { workspace_id: "workspace-1", role: "member" },
      workspace: { id: "workspace-1", name: "OpenPlan QA" },
    });

    render(await WorkspacePage());

    expect(screen.getByTestId("workspace-geography")).toHaveAttribute("data-can-manage", "false");
    expect(screen.getByTestId("workspace-team")).toHaveAttribute("data-can-manage", "false");
    expect(screen.getByTestId("workspace-integrations")).toHaveAttribute("data-can-manage", "false");
    expect(screen.queryByTestId("deployment-health")).not.toBeInTheDocument();
    expect(loadWorkerFacts).not.toHaveBeenCalled();
    expect(loadWorkerHealth).not.toHaveBeenCalled();
  });

  it("states the workspace's storage use and limit in one plain line", async () => {
    vi.stubEnv("OPENPLAN_WORKSPACE_STORAGE_QUOTA_BYTES", String(10 * 1024 ** 3));

    render(await WorkspacePage());

    expect(screen.getByText("Storage: 1.2 GiB of 10 GiB used.")).toBeInTheDocument();
    // Only the workspace this person was confirmed to belong to.
    expect(storageRpc).toHaveBeenCalledWith("workspace_storage_bytes", { p_workspace_id: "workspace-1" });
  });

  it("says so when storage use cannot be read, rather than showing zero", async () => {
    storageRpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });

    render(await WorkspacePage());

    expect(screen.getByText("Storage use could not be read.")).toBeInTheDocument();
    expect(screen.queryByText(/^Storage: /)).not.toBeInTheDocument();
  });

  it("says so when the service role is not configured, and still renders the page", async () => {
    // Every service-role call on the page fails, as with a missing key.
    serviceRoleClient.mockImplementation(() => {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
    });

    render(await WorkspacePage());

    expect(screen.getByText("Storage use could not be read.")).toBeInTheDocument();
    expect(screen.getByTestId("workspace-team")).toBeInTheDocument();
  });

  it("reads no storage use for someone with no workspace", async () => {
    loadMembership.mockResolvedValueOnce({ membership: null, workspace: null });

    render(await WorkspacePage());

    expect(storageRpc).not.toHaveBeenCalled();
  });
});
