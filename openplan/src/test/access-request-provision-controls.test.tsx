import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { AccessRequestProvisionControls } from "@/components/operations/access-request-provision-controls";

describe("AccessRequestProvisionControls", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        request: {
          id: "44444444-4444-4444-8444-444444444444",
          status: "provisioned",
          reviewedAt: "2026-04-24T12:00:00.000Z",
          reviewEventId: "55555555-5555-4555-8555-555555555555",
          provisionedWorkspaceId: "11111111-1111-4111-8111-111111111111",
        },
        sideEffects: {
          reviewEventRecorded: true,
          outboundEmailSent: false,
          workspaceProvisioned: true,
          ownerInvitationCreated: true,
        },
        workspace: {
          id: "11111111-1111-4111-8111-111111111111",
          slug: "nctc-pilot",
          name: "NCTC Pilot Workspace",
          plan: "pilot",
        },
        ownerInvitation: {
          id: "33333333-3333-4333-8333-333333333333",
          expiresAt: "2026-05-08T12:00:00.000Z",
          invitationUrl: "http://localhost/sign-up?invite=test-token&redirect=%2Fdashboard",
          delivery: "manual",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a pilot workspace invite and surfaces the manual invitation URL", async () => {
    render(
      <AccessRequestProvisionControls
        requestId="44444444-4444-4444-8444-444444444444"
        status="contacted"
        provisionedWorkspaceId={null}
        workspaceName="NCTC Pilot"
      />,
    );

    fireEvent.change(screen.getByLabelText("Workspace name"), {
      target: { value: "NCTC Pilot Workspace" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Create invite/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/access-requests/44444444-4444-4444-8444-444444444444/provision",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceName: "NCTC Pilot Workspace" }),
      }),
    );
    expect(await screen.findByDisplayValue("http://localhost/sign-up?invite=test-token&redirect=%2Fdashboard")).toBeInTheDocument();
    expect(screen.getByText("Pilot workspace and owner invite created. No email was sent.")).toBeInTheDocument();
    expect(screen.getByText(/Creates a pilot workspace and owner invite/i)).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("waits until the request has been contacted or invited", () => {
    render(
      <AccessRequestProvisionControls
        requestId="44444444-4444-4444-8444-444444444444"
        status="reviewing"
        provisionedWorkspaceId={null}
        workspaceName="NCTC Pilot"
      />,
    );

    expect(screen.getByText(/Available after the request is marked contacted or invited/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create invite/i })).not.toBeInTheDocument();
  });

  it("renders already-linked access requests without another provisioning action", () => {
    render(
      <AccessRequestProvisionControls
        requestId="44444444-4444-4444-8444-444444444444"
        status="provisioned"
        provisionedWorkspaceId="11111111-1111-4111-8111-111111111111"
        workspaceName="NCTC Pilot"
      />,
    );

    expect(screen.getByText("Workspace 11111111 linked.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Create invite/i })).not.toBeInTheDocument();
  });
});
