import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCESS_REQUEST_MAX_PER_WINDOW,
  ACCESS_REQUEST_REVIEW_EMAILS_ENV,
  buildAccessRequestBodyFingerprint,
  buildAccessRequestClientFingerprint,
  buildAccessRequestMetadata,
  buildAccessRequestSupportMetadata,
  canTransitionAccessRequestStatus,
  canReviewAccessRequests,
  evaluateAccessRequestSafety,
  getAccessRequestTransitionOptions,
  normalizeAccessRequestEmail,
  parseAccessRequestReviewerEmails,
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
});
