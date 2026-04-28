import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequestAccessForm } from "@/components/request-access/request-access-form";

describe("RequestAccessForm", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        message: "Request received. The OpenPlan team will review it before any workspace is provisioned.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits the public access request payload", async () => {
    render(<RequestAccessForm />);

    fireEvent.change(screen.getByLabelText(/Agency or organization/i), {
      target: { value: "Nevada County Transportation Commission" },
    });
    fireEvent.change(screen.getByLabelText(/Region/i), {
      target: { value: "Nevada County" },
    });
    fireEvent.change(screen.getByLabelText(/Organization type/i), {
      target: { value: "rtpa_mpo" },
    });
    fireEvent.change(screen.getByLabelText(/Expected workspace name/i), {
      target: { value: "NCTC Pilot" },
    });
    fireEvent.change(screen.getByLabelText(/Contact name/i), {
      target: { value: "Nat Ford" },
    });
    fireEvent.change(screen.getByLabelText(/Work email/i), {
      target: { value: "nat@example.gov" },
    });
    fireEvent.change(screen.getByLabelText(/Role or title/i), {
      target: { value: "Planning lead" },
    });
    fireEvent.change(screen.getByLabelText(/Which service lane do you need/i), {
      target: { value: "managed_hosting_admin" },
    });
    fireEvent.change(screen.getByLabelText(/First workflow to stand up/i), {
      target: { value: "rtp" },
    });
    fireEvent.change(screen.getByLabelText(/Deployment posture/i), {
      target: { value: "nat_ford_managed" },
    });
    fireEvent.change(screen.getByLabelText(/Data sensitivity/i), {
      target: { value: "internal_planning" },
    });
    fireEvent.change(screen.getByLabelText(/Onboarding needs/i), {
      target: { value: "Import existing RTP project tables and brief staff leads." },
    });
    fireEvent.change(screen.getByLabelText(/What should OpenPlan help with first/i), {
      target: { value: "Screen rural transit corridors and prepare grant support material." },
    });

    fireEvent.click(screen.getByRole("button", { name: /request access/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/request-access",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.any(String),
      }),
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(
      expect.objectContaining({
        agencyName: "Nevada County Transportation Commission",
        contactName: "Nat Ford",
        contactEmail: "nat@example.gov",
        roleTitle: "Planning lead",
        region: "Nevada County",
        organizationType: "rtpa_mpo",
        expectedWorkspaceName: "NCTC Pilot",
        serviceLane: "managed_hosting_admin",
        desiredFirstWorkflow: "rtp",
        deploymentPosture: "nat_ford_managed",
        dataSensitivity: "internal_planning",
        onboardingNeeds: "Import existing RTP project tables and brief staff leads.",
        useCase: "Screen rural transit corridors and prepare grant support material.",
        sourcePath: "/request-access",
      }),
    );
    expect(await screen.findByText(/Request received/i)).toBeInTheDocument();
  });

  it("shows an error when the request route rejects the submission", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Invalid access request" }),
    });

    render(<RequestAccessForm />);

    fireEvent.change(screen.getByLabelText(/Agency or organization/i), { target: { value: "Agency" } });
    fireEvent.change(screen.getByLabelText(/Contact name/i), { target: { value: "Planner" } });
    fireEvent.change(screen.getByLabelText(/Work email/i), { target: { value: "planner@example.gov" } });
    fireEvent.change(screen.getByLabelText(/Which service lane do you need/i), {
      target: { value: "planning_services" },
    });
    fireEvent.change(screen.getByLabelText(/First workflow to stand up/i), {
      target: { value: "grants" },
    });
    fireEvent.change(screen.getByLabelText(/What should OpenPlan help with first/i), {
      target: { value: "Prepare a first corridor screening workflow for review." },
    });
    fireEvent.click(screen.getByRole("button", { name: /request access/i }));

    expect(await screen.findByText("Invalid access request")).toBeInTheDocument();
  });
});
