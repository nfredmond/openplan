import { describe, expect, it, vi } from "vitest";
import {
  loadUsageForCurrentPeriod,
  markUsageEventsReported,
  recordUsageEvent,
  summarizeUsageEventRows,
} from "@/lib/billing/usage-events";

describe("billing usage-event ledger helpers", () => {
  it("summarizes usage by bucket with reported and unreported weights", () => {
    expect(
      summarizeUsageEventRows([
        {
          workspace_id: "workspace-1",
          event_key: "analysis.run",
          bucket_key: "runs",
          weight: 1,
          source_route: "/api/analysis",
          idempotency_key: null,
          period_start: null,
          period_end: null,
          occurred_at: "2026-04-24T04:00:00.000Z",
          stripe_reported_at: null,
          stripe_report_event_id: null,
        },
        {
          workspace_id: "workspace-1",
          event_key: "model_run.launch",
          bucket_key: "runs",
          weight: 5,
          source_route: "/api/models",
          idempotency_key: null,
          period_start: null,
          period_end: null,
          occurred_at: "2026-04-24T05:00:00.000Z",
          stripe_reported_at: "2026-05-01T00:00:00.000Z",
          stripe_report_event_id: "usage_flush_1",
        },
      ])
    ).toEqual([
      {
        bucketKey: "runs",
        eventCount: 2,
        totalWeight: 6,
        reportedWeight: 5,
        unreportedWeight: 1,
        lastOccurredAt: "2026-04-24T05:00:00.000Z",
      },
    ]);
  });

  it("records positive integer usage events", async () => {
    const maybeSingleMock = vi.fn(async () => ({ data: { id: "usage-1" }, error: null }));
    const selectMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
    const insertMock = vi.fn(() => ({ select: selectMock }));
    const client = {
      from: vi.fn((table: string) => {
        if (table === "usage_events") return { insert: insertMock };
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await recordUsageEvent(client as never, {
      workspaceId: "workspace-1",
      eventKey: "report.generate",
      weight: 1.8,
      sourceRoute: "/api/reports/report-1/generate",
      idempotencyKey: "report:report-1:generate:html",
      occurredAt: "2026-04-24T04:00:00.000Z",
    });

    expect(result).toEqual({ ok: true, duplicate: false, id: "usage-1", error: null });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workspace_id: "workspace-1",
        event_key: "report.generate",
        bucket_key: "runs",
        weight: 1,
        source_route: "/api/reports/report-1/generate",
        idempotency_key: "report:report-1:generate:html",
      })
    );
  });

  it("treats idempotency-key conflicts as successful duplicates", async () => {
    const maybeSingleMock = vi.fn(async () => ({
      data: null,
      error: { message: "duplicate key value violates unique constraint", code: "23505" },
    }));
    const selectMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
    const insertMock = vi.fn(() => ({ select: selectMock }));
    const client = {
      from: vi.fn((table: string) => {
        if (table === "usage_events") return { insert: insertMock };
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await expect(
      recordUsageEvent(client as never, {
        workspaceId: "workspace-1",
        eventKey: "analysis.run",
        idempotencyKey: "request-1",
      })
    ).resolves.toEqual({ ok: true, duplicate: true, id: null, error: null });
  });

  it("loads current-period usage through the workspace-scoped query", async () => {
    const limitMock = vi.fn(async () => ({
      data: [
        {
          workspace_id: "workspace-1",
          event_key: "analysis.run",
          bucket_key: "runs",
          weight: 1,
          occurred_at: "2026-04-24T04:00:00.000Z",
          stripe_reported_at: null,
          stripe_report_event_id: null,
        },
      ],
      error: null,
    }));
    const orderMock = vi.fn(() => ({ limit: limitMock }));
    const gteMock = vi.fn(() => ({ order: orderMock }));
    const eqMock = vi.fn(() => ({ gte: gteMock }));
    const selectMock = vi.fn(() => ({ eq: eqMock }));
    const client = {
      from: vi.fn((table: string) => {
        if (table === "usage_events") return { select: selectMock };
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    const result = await loadUsageForCurrentPeriod(client as never, "workspace-1", {
      periodStart: "2026-04-01T00:00:00.000Z",
    });

    expect(result.error).toBeNull();
    expect(result.buckets).toEqual([
      {
        bucketKey: "runs",
        eventCount: 1,
        totalWeight: 1,
        reportedWeight: 0,
        unreportedWeight: 1,
        lastOccurredAt: "2026-04-24T04:00:00.000Z",
      },
    ]);
    expect(eqMock).toHaveBeenCalledWith("workspace_id", "workspace-1");
    expect(gteMock).toHaveBeenCalledWith("occurred_at", "2026-04-01T00:00:00.000Z");
  });

  it("marks usage events reported after Stripe accepts an aggregate report", async () => {
    const inMock = vi.fn(async () => ({ error: null }));
    const updateMock = vi.fn(() => ({ in: inMock }));
    const client = {
      from: vi.fn((table: string) => {
        if (table === "usage_events") return { update: updateMock };
        throw new Error(`Unexpected table: ${table}`);
      }),
    };

    await expect(
      markUsageEventsReported(client as never, ["usage-1", "usage-2"], "stripe-meter-1", new Date("2026-05-01T00:00:00.000Z"))
    ).resolves.toEqual({ error: null });
    expect(updateMock).toHaveBeenCalledWith({
      stripe_reported_at: "2026-05-01T00:00:00.000Z",
      stripe_report_event_id: "stripe-meter-1",
    });
    expect(inMock).toHaveBeenCalledWith("id", ["usage-1", "usage-2"]);
  });
});
