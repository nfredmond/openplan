import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createApiAuditLoggerMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const loadBillingReadinessFactsMock = vi.fn();
const flushUsageEventsToStripeMock = vi.fn();

const mockAudit = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

vi.mock("@/lib/observability/audit", () => ({
  createApiAuditLogger: (...args: unknown[]) => createApiAuditLoggerMock(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: (...args: unknown[]) => createServiceRoleClientMock(...args),
}));

vi.mock("@/lib/billing/readiness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/readiness")>();
  return {
    ...actual,
    loadBillingReadinessFacts: (...args: unknown[]) => loadBillingReadinessFactsMock(...args),
  };
});

vi.mock("@/lib/billing/usage-flush", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/billing/usage-flush")>();
  return {
    ...actual,
    flushUsageEventsToStripe: (...args: unknown[]) => flushUsageEventsToStripeMock(...args),
  };
});

import { POST as postBillingReadiness } from "@/app/api/billing/readiness/route";

const workspaceId = "11111111-1111-4111-8111-111111111111";

function readinessRequest(payload: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/billing/readiness", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

function stubReadyEnv() {
  vi.stubEnv("OPENPLAN_STRIPE_SECRET_KEY", "sk_live_test");
  vi.stubEnv("OPENPLAN_STRIPE_PRICE_ID_STARTER", "price_starter");
  vi.stubEnv("OPENPLAN_STRIPE_PRICE_ID_PROFESSIONAL", "price_professional");
  vi.stubEnv("OPENPLAN_STRIPE_WEBHOOK_SECRET", "whsec_test");
  vi.stubEnv("OPENPLAN_BILLING_USAGE_FLUSH_SECRET", "flush-secret");
  vi.stubEnv("OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS", "openplan_runs");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role");
}

function readyFacts() {
  return {
    subscriptionLedger: {
      accessible: true,
      rowCount: 101,
      activeLikeCount: 1,
    },
    usageLedger: {
      accessible: true,
      unreportedEventCount: 0,
      unreportedWeight: 0,
    },
    workspace: {
      requested: true,
      workspaceId,
      found: true,
      name: "NCTC Demo",
      subscriptionStatus: "pilot",
      subscriptionPlan: "starter",
      stripeCustomerIdPresent: false,
      stripeSubscriptionIdPresent: false,
    },
  };
}

describe("POST /api/billing/readiness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    stubReadyEnv();

    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createServiceRoleClientMock.mockReturnValue({ from: vi.fn() });
    loadBillingReadinessFactsMock.mockResolvedValue(readyFacts());
    flushUsageEventsToStripeMock.mockResolvedValue({
      dryRun: true,
      closedBefore: "2026-05-02T00:00:00.000Z",
      workspaceId,
      bucketKey: "runs",
      scannedSubscriptions: 1,
      scannedEvents: 0,
      groups: [],
      reportedGroups: 0,
      dryRunGroups: 0,
      skippedGroups: 0,
      failedGroups: 0,
      markFailedGroups: 0,
      reportedWeight: 0,
    });
  });

  it("returns 503 when no readiness or usage-flush secret is configured", async () => {
    vi.stubEnv("OPENPLAN_BILLING_READINESS_SECRET", "");
    vi.stubEnv("OPENPLAN_BILLING_USAGE_FLUSH_SECRET", "");

    const response = await postBillingReadiness(
      readinessRequest({}, { authorization: "Bearer flush-secret" })
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "Billing readiness is not configured" });
    expect(loadBillingReadinessFactsMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the request secret is wrong", async () => {
    const response = await postBillingReadiness(
      readinessRequest({}, { authorization: "Bearer wrong-secret" })
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
    expect(loadBillingReadinessFactsMock).not.toHaveBeenCalled();
  });

  it("returns the service-backed readiness summary without requiring a dry run", async () => {
    const serviceClient = { from: vi.fn() };
    createServiceRoleClientMock.mockReturnValueOnce(serviceClient);

    const response = await postBillingReadiness(
      readinessRequest({ workspaceId }, { "x-openplan-billing-readiness-secret": "flush-secret" })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      status: "ready",
      readyForPaidCanary: true,
    });
    expect(loadBillingReadinessFactsMock).toHaveBeenCalledWith(serviceClient, { workspaceId });
    expect(flushUsageEventsToStripeMock).not.toHaveBeenCalled();
  });

  it("runs usage flush in dry-run mode when requested", async () => {
    const serviceClient = { from: vi.fn() };
    createServiceRoleClientMock.mockReturnValueOnce(serviceClient);

    const response = await postBillingReadiness(
      readinessRequest(
        {
          workspaceId,
          includeUsageDryRun: true,
          closedBefore: "2026-04-02T00:00:00.000Z",
          bucketKey: "runs",
          limit: 25,
        },
        { authorization: "Bearer flush-secret" }
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      status: "ready",
      checks: expect.arrayContaining([
        expect.objectContaining({
          key: "usage_flush_dry_run",
          status: "pass",
        }),
      ]),
    });
    expect(flushUsageEventsToStripeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: serviceClient,
        stripeClient: null,
        dryRun: true,
        closedBefore: "2026-04-02T00:00:00.000Z",
        workspaceId,
        bucketKey: "runs",
        limit: 25,
      })
    );
  });

  it("rejects future dry-run cutoffs before opening the service-role client", async () => {
    const response = await postBillingReadiness(
      readinessRequest(
        { includeUsageDryRun: true, closedBefore: "2999-01-01T00:00:00.000Z" },
        { authorization: "Bearer flush-secret" }
      )
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "Billing readiness cutoff cannot be in the future",
    });
    expect(createServiceRoleClientMock).not.toHaveBeenCalled();
  });

  it("returns a blocked readiness summary when service-role access is unavailable", async () => {
    createServiceRoleClientMock.mockImplementationOnce(() => {
      throw new Error("Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY");
    });

    const response = await postBillingReadiness(
      readinessRequest({ workspaceId, includeUsageDryRun: true }, { authorization: "Bearer flush-secret" })
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      status: "blocked",
      readyForPaidCanary: false,
    });
    expect(payload.blockers.join(" ")).toContain("Subscription ledger");
    expect(payload.blockers.join(" ")).toContain("Usage flush dry run");
    expect(loadBillingReadinessFactsMock).not.toHaveBeenCalled();
  });
});
