import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCESS_REQUEST_MAX_PER_WINDOW,
  ACCESS_REQUEST_PROVISIONING_SIDE_EFFECTS,
  ACCESS_REQUEST_REVIEW_EMAILS_ENV,
  ACCESS_REQUEST_TRIAGE_SIDE_EFFECTS,
  accessRequestProvisioningSideEffectLabel,
  buildAccessRequestBodyFingerprint,
  buildAccessRequestClientFingerprint,
  buildAccessRequestMetadata,
  buildAccessRequestSupportMetadata,
  canProvisionAccessRequestStatus,
  canTransitionAccessRequestStatus,
  canReviewAccessRequests,
  evaluateAccessRequestSafety,
  accessRequestTriageSideEffectLabel,
  getAccessRequestTransitionOptions,
  loadRecentAccessRequestsForReview,
  normalizeAccessRequestEmail,
  parseAccessRequestReviewerEmails,
  type AccessRequestReviewClient,
} from "@/lib/access-requests";

describe("access request helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes contact and reviewer emails consistently", () => {
    expect(normalizeAccessRequestEmail("  Planner@Agency.GOV ")).toBe("planner@agency.gov");
    expect(parseAccessRequestReviewerEmails("one@test.dev, TWO@test.dev ,")).toEqual(
      new Set(["one@test.dev", "two@test.dev"]),
    );
  });

  it("allows review only for explicitly allowlisted operator emails", () => {
    vi.stubEnv(ACCESS_REQUEST_REVIEW_EMAILS_ENV, "operator@openplan.test, admin@openplan.test");

    expect(canReviewAccessRequests("OPERATOR@openplan.test")).toBe(true);
    expect(canReviewAccessRequests("other@openplan.test")).toBe(false);
    expect(canReviewAccessRequests(null)).toBe(false);
  });

  it("stores request metadata without persisting raw IP address", () => {
    const request = new NextRequest("http://localhost/request-access", {
      headers: {
        "user-agent": "Vitest Access Request",
        "x-forwarded-for": "203.0.113.99",
        referer: "https://openplan.test/pricing?source=campaign",
      },
    });

    const metadata = buildAccessRequestMetadata(request, "2026-04-24T12:00:00.000Z");

    expect(metadata).toEqual(
      expect.objectContaining({
        submitted_via: "request_access_form",
        source_fingerprint: expect.stringMatching(/^[a-f0-9]{24}$/),
        user_agent: "Vitest Access Request",
        referer_host: "openplan.test",
        received_at: "2026-04-24T12:00:00.000Z",
      }),
    );
    expect(JSON.stringify(metadata)).not.toContain("203.0.113.99");
  });

  it("adds a stable request-content fingerprint without storing raw body in metadata", () => {
    const request = new NextRequest("http://localhost/request-access", {
      headers: {
        "user-agent": "Vitest Access Request",
        "x-forwarded-for": "203.0.113.99",
      },
    });

    const input = {
      agencyName: "Nevada County Transportation Commission",
      contactName: "Nat Ford",
      contactEmail: "Nat.Ford@Agency.GOV",
      useCase: "Screen rural transit corridors and prepare grant support material.",
      expectedWorkspaceName: "NCTC Pilot",
    };
    const metadata = buildAccessRequestSupportMetadata(request, input, "2026-04-24T12:00:00.000Z");

    expect(metadata.body_fingerprint).toBe(buildAccessRequestBodyFingerprint(input));
    expect(metadata.source_fingerprint).toBe(buildAccessRequestClientFingerprint(request));
    expect(JSON.stringify(metadata)).not.toContain(input.useCase);
    expect(JSON.stringify(metadata)).not.toContain(input.contactEmail);
  });

  it("detects recent source rate limits and duplicate request content", () => {
    const request = new NextRequest("http://localhost/request-access", {
      headers: {
        "user-agent": "Vitest Access Request",
        "x-forwarded-for": "203.0.113.99",
      },
    });
    const accessRequest = {
      agencyName: "Nevada County Transportation Commission",
      contactEmail: "Nat.Ford@Agency.GOV",
      useCase: "Screen rural transit corridors and prepare grant support material.",
      expectedWorkspaceName: "NCTC Pilot",
    };
    const sourceFingerprint = buildAccessRequestClientFingerprint(request);
    const bodyFingerprint = buildAccessRequestBodyFingerprint(accessRequest);
    const recentRequests = Array.from({ length: ACCESS_REQUEST_MAX_PER_WINDOW }, (_, index) => ({
      id: `recent-${index}`,
      created_at: "2026-04-24T12:00:00.000Z",
      metadata_json: {
        source_fingerprint: sourceFingerprint,
        body_fingerprint: index === 0 ? bodyFingerprint : `other-${index}`,
      },
    }));

    const safety = evaluateAccessRequestSafety({
      request,
      accessRequest,
      recentRequests,
      now: new Date("2026-04-24T12:05:00.000Z"),
    });

    expect(safety).toEqual(
      expect.objectContaining({
        isRateLimited: true,
        isDuplicate: true,
        recentFromClientCount: ACCESS_REQUEST_MAX_PER_WINDOW,
        duplicateRecentRequestId: "recent-0",
      }),
    );
  });

  it("keeps triage transitions explicit and terminal statuses closed", () => {
    expect(getAccessRequestTransitionOptions("new")).toEqual(["reviewing", "deferred", "declined"]);
    expect(canTransitionAccessRequestStatus("reviewing", "contacted")).toBe(true);
    expect(canTransitionAccessRequestStatus("contacted", "reviewing")).toBe(false);
    expect(getAccessRequestTransitionOptions("invited")).toEqual(["deferred", "declined"]);
    expect(getAccessRequestTransitionOptions("declined")).toEqual([]);
    expect(getAccessRequestTransitionOptions("provisioned")).toEqual([]);
  });

  it("keeps reviewer triage side effects explicit and audit-only", () => {
    expect(ACCESS_REQUEST_TRIAGE_SIDE_EFFECTS).toEqual({
      reviewEventRecorded: true,
      outboundEmailSent: false,
      workspaceProvisioned: false,
    });
    expect(accessRequestTriageSideEffectLabel()).toMatch(/no outbound email or workspace/i);
  });

  it("allows workspace provisioning only after contacted or invited review", () => {
    expect(canProvisionAccessRequestStatus("new")).toBe(false);
    expect(canProvisionAccessRequestStatus("reviewing")).toBe(false);
    expect(canProvisionAccessRequestStatus("contacted")).toBe(true);
    expect(canProvisionAccessRequestStatus("invited")).toBe(true);
    expect(canProvisionAccessRequestStatus("provisioned")).toBe(false);
    expect(ACCESS_REQUEST_PROVISIONING_SIDE_EFFECTS).toEqual({
      reviewEventRecorded: true,
      outboundEmailSent: false,
      workspaceProvisioned: true,
      ownerInvitationCreated: true,
    });
    expect(accessRequestProvisioningSideEffectLabel()).toMatch(/pilot workspace and owner invite/i);
    expect(accessRequestProvisioningSideEffectLabel()).toMatch(/no outbound email/i);
  });

  it("attaches compact review events to recent access request rows", async () => {
    const requestLimitMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: "44444444-4444-4444-8444-444444444444",
          agency_name: "Nevada County Transportation Commission",
          contact_name: "Nat Ford",
          contact_email: "nat@example.gov",
          role_title: "Planning lead",
          region: "Nevada County",
          use_case: "Screen rural transit corridors.",
          expected_workspace_name: "NCTC Pilot",
          status: "contacted",
          source_path: "/request-access",
          created_at: "2026-04-24T12:00:00.000Z",
          reviewed_at: "2026-04-24T12:05:00.000Z",
          provisioned_workspace_id: "22222222-2222-4222-8222-222222222222",
        },
      ],
      error: null,
    });
    const requestOrderMock = vi.fn(() => ({ limit: requestLimitMock }));
    const requestSelectMock = vi.fn(() => ({ order: requestOrderMock }));

    const eventLimitMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          access_request_id: "44444444-4444-4444-8444-444444444444",
          previous_status: "reviewing",
          status: "contacted",
          created_at: "2026-04-24T12:05:00.000Z",
        },
      ],
      error: null,
    });
    const eventOrderMock = vi.fn(() => ({ limit: eventLimitMock }));
    const eventInMock = vi.fn(() => ({ order: eventOrderMock }));
    const eventSelectMock = vi.fn(() => ({ in: eventInMock }));

    const invitationLimitMock = vi.fn().mockResolvedValue({
      data: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          workspace_id: "22222222-2222-4222-8222-222222222222",
          email_normalized: "nat@example.gov",
          role: "owner",
          status: "pending",
          expires_at: "2026-05-01T12:00:00.000Z",
          accepted_at: null,
          created_at: "2026-04-24T12:06:00.000Z",
          updated_at: "2026-04-24T12:06:00.000Z",
        },
      ],
      error: null,
    });
    const invitationOrderMock = vi.fn(() => ({ limit: invitationLimitMock }));
    const invitationInMock = vi.fn(() => ({ order: invitationOrderMock }));
    const invitationSelectMock = vi.fn(() => ({ in: invitationInMock }));

    const client = {
      from: vi.fn((table: string) => {
        if (table === "access_requests") return { select: requestSelectMock };
        if (table === "access_request_review_events") return { select: eventSelectMock };
        if (table === "workspace_invitations") return { select: invitationSelectMock };
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await loadRecentAccessRequestsForReview(client as unknown as AccessRequestReviewClient, 1);

    expect(result.error).toBeNull();
    expect(result.requests[0]?.review_events).toEqual([
      {
        id: "55555555-5555-4555-8555-555555555555",
        access_request_id: "44444444-4444-4444-8444-444444444444",
        previous_status: "reviewing",
        status: "contacted",
        created_at: "2026-04-24T12:05:00.000Z",
      },
    ]);
    expect(result.requests[0]?.owner_invitation).toEqual({
      id: "66666666-6666-4666-8666-666666666666",
      workspace_id: "22222222-2222-4222-8222-222222222222",
      status: "pending",
      expires_at: "2026-05-01T12:00:00.000Z",
      accepted_at: null,
      created_at: "2026-04-24T12:06:00.000Z",
      updated_at: "2026-04-24T12:06:00.000Z",
    });
    expect(eventInMock).toHaveBeenCalledWith("access_request_id", ["44444444-4444-4444-8444-444444444444"]);
    expect(eventLimitMock).toHaveBeenCalledWith(8);
    expect(invitationInMock).toHaveBeenCalledWith("workspace_id", ["22222222-2222-4222-8222-222222222222"]);
    expect(invitationLimitMock).toHaveBeenCalledWith(4);
  });
});
