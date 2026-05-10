import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AccessRequestActivitySummaryPanel,
  summarizeAccessRequestActivity,
} from "@/components/operations/access-request-activity-summary";
import type { AccessRequestReviewRow } from "@/lib/access-requests";

function buildRequest(overrides: Partial<AccessRequestReviewRow> = {}): AccessRequestReviewRow {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    agency_name: "Nevada County Transportation Commission",
    contact_name: "Nat Ford",
    contact_email: "nat@example.gov",
    role_title: "Planning lead",
    region: "Nevada County",
    organization_type: "rtpa_mpo",
    service_lane: "managed_hosting_admin",
    deployment_posture: "nat_ford_managed",
    data_sensitivity: "public",
    desired_first_workflow: "rtp",
    onboarding_needs: null,
    use_case: "Screen rural transit corridors.",
    expected_workspace_name: "NCTC Pilot",
    status: "new",
    source_path: "/request-access",
    created_at: "2026-04-24T12:00:00.000Z",
    reviewed_at: null,
    provisioned_workspace_id: null,
    review_events: [],
    owner_invitation: null,
    ...overrides,
  };
}

describe("access request activity summary", () => {
  it("flags new requests as awaiting first review", () => {
    const summary = summarizeAccessRequestActivity(buildRequest());

    expect(summary).toEqual(
      expect.objectContaining({
        label: "Awaiting first review",
        needsOperatorAction: true,
      }),
    );
    expect(summary.detail).toMatch(/Submitted Apr 24/);
  });

  it("uses the newest review event for the checkpoint", () => {
    const summary = summarizeAccessRequestActivity(
      buildRequest({
        status: "contacted",
        review_events: [
          {
            id: "older",
            access_request_id: "44444444-4444-4444-8444-444444444444",
            previous_status: "new",
            status: "reviewing",
            created_at: "2026-04-24T12:05:00.000Z",
          },
          {
            id: "newer",
            access_request_id: "44444444-4444-4444-8444-444444444444",
            previous_status: "reviewing",
            status: "contacted",
            created_at: "2026-04-24T12:10:00.000Z",
          },
        ],
      }),
    );

    expect(summary.label).toBe("Latest review");
    expect(summary.detail).toContain("Reviewing → Contacted");
    expect(summary.needsOperatorAction).toBe(true);
  });

  it("marks accepted owner invites as pilot ready", () => {
    const summary = summarizeAccessRequestActivity(
      buildRequest({
        status: "provisioned",
        provisioned_workspace_id: "11111111-1111-4111-8111-111111111111",
        owner_invitation: {
          id: "33333333-3333-4333-8333-333333333333",
          workspace_id: "11111111-1111-4111-8111-111111111111",
          status: "accepted",
          expires_at: "2026-05-08T12:00:00.000Z",
          accepted_at: "2026-04-25T12:00:00.000Z",
          created_at: "2026-04-24T12:00:00.000Z",
          updated_at: "2026-04-25T12:00:00.000Z",
        },
      }),
    );

    expect(summary.label).toBe("Owner accepted");
    expect(summary.needsOperatorAction).toBe(false);
  });

  it("renders the operator handoff badge for pending provisioned invites", () => {
    render(
      <AccessRequestActivitySummaryPanel
        request={buildRequest({
          status: "provisioned",
          provisioned_workspace_id: "11111111-1111-4111-8111-111111111111",
          owner_invitation: {
            id: "33333333-3333-4333-8333-333333333333",
            workspace_id: "11111111-1111-4111-8111-111111111111",
            status: "pending",
            expires_at: "2026-05-08T12:00:00.000Z",
            accepted_at: null,
            created_at: "2026-04-24T12:00:00.000Z",
            updated_at: "2026-04-24T12:00:00.000Z",
          },
        })}
      />,
    );

    expect(screen.getByText("Access activity checkpoint")).toBeInTheDocument();
    expect(screen.getByText("Operator handoff")).toBeInTheDocument();
    expect(screen.getByText("Invite pending")).toBeInTheDocument();
    expect(screen.getByText(/Manual delivery remains the operator handoff item/i)).toBeInTheDocument();
  });
});
