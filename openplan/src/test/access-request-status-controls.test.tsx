import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { AccessRequestStatusControls } from "@/components/operations/access-request-status-controls";

describe("AccessRequestStatusControls", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        request: {
          id: "44444444-4444-4444-8444-444444444444",
          status: "reviewing",
          reviewedAt: "2026-04-24T12:00:00.000Z",
        },
        sideEffects: {
          reviewEventRecorded: true,
          outboundEmailSent: false,
          workspaceProvisioned: false,
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts a status transition and refreshes the admin surface", async () => {
    render(
      <AccessRequestStatusControls
        requestId="44444444-4444-4444-8444-444444444444"
        status="new"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mark reviewing/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/access-requests/44444444-4444-4444-8444-444444444444",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "reviewing" }),
      }),
    );
    expect(await screen.findByText("Updated to Reviewing. Review event recorded.")).toBeInTheDocument();
    expect(screen.getByText(/no outbound email or workspace is created/i)).toBeInTheDocument();
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("renders terminal statuses without mutation buttons", () => {
    render(
      <AccessRequestStatusControls
        requestId="44444444-4444-4444-8444-444444444444"
        status="declined"
      />,
    );

    expect(screen.getByText(/No further triage transition/i)).toBeInTheDocument();
    expect(screen.getByText(/no outbound email or workspace is created/i)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
