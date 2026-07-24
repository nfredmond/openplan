import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import {
  ACCESS_REQUEST_MAX_PER_WINDOW,
  buildAccessRequestBodyFingerprint,
  buildAccessRequestClientFingerprint,
  buildAccessRequestMetadata,
  buildAccessRequestSupportMetadata,
  evaluateAccessRequestSafety,
  normalizeAccessRequestEmail,
} from "@/lib/access-requests";

// The operator REVIEW console (canReviewAccessRequests, triage/provision state
// machine, operator source proof, review-row loaders) was deleted with /admin.
// What remains — and what these tests cover — is the contact-form intake safety:
// email normalization, IP-free metadata, content fingerprinting, and
// rate/duplicate detection.
describe("access request intake helpers", () => {
  it("normalizes contact emails consistently", () => {
    expect(normalizeAccessRequestEmail("  Planner@Agency.GOV ")).toBe("planner@agency.gov");
  });

  it("stores request metadata without persisting raw IP address", () => {
    const request = new NextRequest("http://localhost/contact", {
      headers: {
        "user-agent": "Vitest Access Request",
        "x-forwarded-for": "203.0.113.99",
        referer: "https://openplan.test/contact?source=campaign",
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
    const request = new NextRequest("http://localhost/contact", {
      headers: {
        "user-agent": "Vitest Access Request",
        "x-forwarded-for": "203.0.113.99",
      },
    });

    const input = {
      agencyName: "Nevada County Transportation Commission",
      contactEmail: "Nat.Ford@Agency.GOV",
      useCase: "Screen rural transit corridors and prepare grant support material.",
      expectedWorkspaceName: "NCTC Pilot",
    };
    const metadata = buildAccessRequestSupportMetadata(request, input, "2026-04-24T12:00:00.000Z", {
      product: "openplan",
      source: "public landing",
      intent: "question",
    });

    expect(metadata.body_fingerprint).toBe(buildAccessRequestBodyFingerprint(input));
    expect(metadata.source_fingerprint).toBe(buildAccessRequestClientFingerprint(request));
    expect(metadata.source_context).toEqual(
      expect.objectContaining({ product: "openplan", intent: "question" }),
    );
    expect(JSON.stringify(metadata)).not.toContain(input.useCase);
    expect(JSON.stringify(metadata)).not.toContain(input.contactEmail);
  });

  it("detects recent source rate limits and duplicate request content", () => {
    const request = new NextRequest("http://localhost/contact", {
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
});
