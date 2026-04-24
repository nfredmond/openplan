import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const createApiAuditLoggerMock = vi.fn();
const createServiceRoleClientMock = vi.fn();
const createStripeMeterEventClientMock = vi.fn();
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
  isMissingEnvironmentVariableError: (error: unknown) =>
    error instanceof Error && error.name === "MissingEnvironmentVariableError",
}));

vi.mock("@/lib/billing/usage-flush", () => ({
  createStripeMeterEventClient: (...args: unknown[]) => createStripeMeterEventClientMock(...args),
  flushUsageEventsToStripe: (...args: unknown[]) => flushUsageEventsToStripeMock(...args),
}));

import { POST as postUsageFlush } from "@/app/api/billing/usage/flush/route";

function flushRequest(payload: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/billing/usage/flush", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });
}

describe("POST /api/billing/usage/flush", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createApiAuditLoggerMock.mockReturnValue(mockAudit);
    createServiceRoleClientMock.mockReturnValue({ from: vi.fn() });
    createStripeMeterEventClientMock.mockReturnValue({ createMeterEvent: vi.fn() });
    flushUsageEventsToStripeMock.mockResolvedValue({
      dryRun: true,
      closedBefore: "2026-05-02T00:00:00.000Z",
      workspaceId: null,
      bucketKey: null,
      scannedSubscriptions: 1,
      scannedEvents: 2,
      groups: [],
      reportedGroups: 0,
      dryRunGroups: 1,
      skippedGroups: 0,
      failedGroups: 0,
      markFailedGroups: 0,
      reportedWeight: 0,
    });

    process.env.OPENPLAN_BILLING_USAGE_FLUSH_SECRET = "flush-secret";
  });

  it("returns 503 when the dedicated ops secret is not configured", async () => {
    delete process.env.OPENPLAN_BILLING_USAGE_FLUSH_SECRET;

    const response = await postUsageFlush(flushRequest({}, { authorization: "Bearer flush-secret" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "Billing usage flush is not configured" });
    expect(flushUsageEventsToStripeMock).not.toHaveBeenCalled();
  });

  it("returns 401 when the request secret is wrong", async () => {
    const response = await postUsageFlush(flushRequest({}, { authorization: "Bearer wrong-secret" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "Unauthorized" });
    expect(flushUsageEventsToStripeMock).not.toHaveBeenCalled();
  });

  it("runs a dry run by default through the service-role client", async () => {
    const response = await postUsageFlush(
      flushRequest(
        {
          closedBefore: "2026-04-02T00:00:00.000Z",
          workspaceId: "11111111-1111-4111-8111-111111111111",
          bucketKey: "runs",
          limit: 25,
        },
        { "x-openplan-billing-usage-flush-secret": "flush-secret" }
      )
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, dryRun: true, dryRunGroups: 1 });
    expect(createStripeMeterEventClientMock).not.toHaveBeenCalled();
    expect(flushUsageEventsToStripeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        supabase: expect.any(Object),
        stripeClient: null,
        dryRun: true,
        closedBefore: "2026-04-02T00:00:00.000Z",
        workspaceId: "11111111-1111-4111-8111-111111111111",
        bucketKey: "runs",
        limit: 25,
      })
    );
  });

  it("creates a Stripe client for live flushes and returns 207 on partial failures", async () => {
    flushUsageEventsToStripeMock.mockResolvedValueOnce({
      dryRun: false,
      closedBefore: "2026-05-02T00:00:00.000Z",
      workspaceId: null,
      bucketKey: null,
      scannedSubscriptions: 1,
      scannedEvents: 2,
      groups: [
        {
          workspaceId: "11111111-1111-4111-8111-111111111111",
          bucketKey: "runs",
          periodStart: "2026-04-01T00:00:00.000Z",
          periodEnd: "2026-05-01T00:00:00.000Z",
          eventCount: 2,
          totalWeight: 6,
          status: "failed",
          reason: "stripe_meter_event_failed",
        },
      ],
      reportedGroups: 0,
      dryRunGroups: 0,
      skippedGroups: 0,
      failedGroups: 1,
      markFailedGroups: 0,
      reportedWeight: 0,
    });

    const response = await postUsageFlush(
      flushRequest({ dryRun: false }, { authorization: "Bearer flush-secret" })
    );

    expect(response.status).toBe(207);
    expect(await response.json()).toMatchObject({ ok: false, dryRun: false, failedGroups: 1 });
    expect(createStripeMeterEventClientMock).toHaveBeenCalledTimes(1);
    expect(flushUsageEventsToStripeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        dryRun: false,
        stripeClient: expect.any(Object),
      })
    );
  });

  it("rejects invalid payloads before opening Stripe", async () => {
    const response = await postUsageFlush(
      flushRequest({ bucketKey: "bad bucket" }, { authorization: "Bearer flush-secret" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid usage flush payload" });
    expect(createStripeMeterEventClientMock).not.toHaveBeenCalled();
  });

  it("rejects future cutoffs so open periods cannot be flushed accidentally", async () => {
    const response = await postUsageFlush(
      flushRequest({ closedBefore: "2999-01-01T00:00:00.000Z" }, { authorization: "Bearer flush-secret" })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Usage flush cutoff cannot be in the future" });
    expect(createStripeMeterEventClientMock).not.toHaveBeenCalled();
    expect(flushUsageEventsToStripeMock).not.toHaveBeenCalled();
  });
});
