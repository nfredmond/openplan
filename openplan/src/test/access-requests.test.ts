import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ACCESS_REQUEST_REVIEW_EMAILS_ENV,
  buildAccessRequestMetadata,
  canReviewAccessRequests,
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
});
