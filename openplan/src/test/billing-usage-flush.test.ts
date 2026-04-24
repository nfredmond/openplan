import { describe, expect, it, vi } from "vitest";
import {
  flushUsageEventsToStripe,
  resolveMeterEventName,
  type StripeMeterEventClient,
} from "@/lib/billing/usage-flush";

type TestSubscription = {
  workspace_id: string;
  plan: string | null;
  status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
};

type TestUsageRow = {
  id: string;
  workspace_id: string;
  event_key: string;
  bucket_key: string | null;
  weight: number;
  source_route: string | null;
  idempotency_key: string | null;
  period_start: string | null;
  period_end: string | null;
  occurred_at: string;
  stripe_reported_at: string | null;
  stripe_report_event_id: string | null;
  metadata_json: Record<string, unknown>;
};

function createFlushClient({
  subscriptions,
  usageRows,
  markError,
}: {
  subscriptions: TestSubscription[];
  usageRows: TestUsageRow[];
  markError?: { message: string; code?: string | null } | null;
}) {
  const markCalls: Array<{ payload: Record<string, unknown>; ids: string[] }> = [];

  class Query {
    private filters: Array<{ column: string; op: string; value: unknown }> = [];
    private updatePayload: Record<string, unknown> | null = null;

    constructor(private readonly table: string) {}

    select() {
      return this;
    }

    not(column: string, op: string, value: unknown) {
      this.filters.push({ column, op: `not.${op}`, value });
      return this;
    }

    lte(column: string, value: unknown) {
      this.filters.push({ column, op: "lte", value });
      return this;
    }

    lt(column: string, value: unknown) {
      this.filters.push({ column, op: "lt", value });
      return this;
    }

    gte(column: string, value: unknown) {
      this.filters.push({ column, op: "gte", value });
      return this;
    }

    eq(column: string, value: unknown) {
      this.filters.push({ column, op: "eq", value });
      return this;
    }

    is(column: string, value: unknown) {
      this.filters.push({ column, op: "is", value });
      return this;
    }

    order() {
      return this;
    }

    update(payload: Record<string, unknown>) {
      this.updatePayload = payload;
      return this;
    }

    async in(column: string, ids: string[]) {
      expect(this.table).toBe("usage_events");
      expect(column).toBe("id");
      markCalls.push({ payload: this.updatePayload ?? {}, ids });
      return { error: markError ?? null };
    }

    async limit(limit: number) {
      if (this.table === "subscriptions") {
        const workspaceFilter = this.filters.find((filter) => filter.column === "workspace_id" && filter.op === "eq");
        const closedBefore = this.filters.find((filter) => filter.column === "current_period_end" && filter.op === "lte")
          ?.value as string;
        return {
          data: subscriptions
            .filter((row) => row.stripe_customer_id)
            .filter((row) => row.current_period_end && row.current_period_end <= closedBefore)
            .filter((row) => !workspaceFilter || row.workspace_id === workspaceFilter.value)
            .slice(0, limit),
          error: null,
        };
      }

      const workspaceId = this.filters.find((filter) => filter.column === "workspace_id" && filter.op === "eq")?.value;
      const bucketKey = this.filters.find((filter) => filter.column === "bucket_key" && filter.op === "eq")?.value;
      const periodStart = this.filters.find((filter) => filter.column === "occurred_at" && filter.op === "gte")?.value as
        | string
        | undefined;
      const periodEnd = this.filters.find((filter) => filter.column === "occurred_at" && filter.op === "lt")?.value as
        | string
        | undefined;

      return {
        data: usageRows
          .filter((row) => row.workspace_id === workspaceId)
          .filter((row) => !row.stripe_reported_at)
          .filter((row) => !bucketKey || row.bucket_key === bucketKey)
          .filter((row) => !periodStart || row.occurred_at >= periodStart)
          .filter((row) => !periodEnd || row.occurred_at < periodEnd)
          .slice(0, limit),
        error: null,
      };
    }
  }

  return {
    client: {
      from: vi.fn((table: string) => new Query(table)),
    },
    markCalls,
  };
}

const closedSubscription: TestSubscription = {
  workspace_id: "11111111-1111-4111-8111-111111111111",
  plan: "starter",
  status: "active",
  stripe_customer_id: "cus_123",
  stripe_subscription_id: "sub_123",
  current_period_start: "2026-04-01T00:00:00.000Z",
  current_period_end: "2026-05-01T00:00:00.000Z",
};

const usageRows: TestUsageRow[] = [
  {
    id: "usage-1",
    workspace_id: closedSubscription.workspace_id,
    event_key: "analysis.run",
    bucket_key: "runs",
    weight: 1,
    source_route: "/api/analysis",
    idempotency_key: "analysis:1",
    period_start: null,
    period_end: null,
    occurred_at: "2026-04-20T00:00:00.000Z",
    stripe_reported_at: null,
    stripe_report_event_id: null,
    metadata_json: {},
  },
  {
    id: "usage-2",
    workspace_id: closedSubscription.workspace_id,
    event_key: "model_run.launch",
    bucket_key: "runs",
    weight: 5,
    source_route: "/api/models",
    idempotency_key: "model_run:1",
    period_start: null,
    period_end: null,
    occurred_at: "2026-04-21T00:00:00.000Z",
    stripe_reported_at: null,
    stripe_report_event_id: null,
    metadata_json: {},
  },
];

describe("billing usage period-close flush", () => {
  it("resolves bucket-specific meter event names", () => {
    expect(resolveMeterEventName("runs", { OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS: "openplan_runs" })).toBe(
      "openplan_runs"
    );
    expect(resolveMeterEventName("scenario.snapshots", { OPENPLAN_STRIPE_METER_EVENT_NAME_SCENARIO_SNAPSHOTS: "snapshots" })).toBe(
      "snapshots"
    );
    expect(resolveMeterEventName("unknown", { OPENPLAN_STRIPE_METER_EVENT_NAME: "fallback" })).toBe("fallback");
  });

  it("groups closed-period usage without marking rows during a dry run", async () => {
    const { client, markCalls } = createFlushClient({
      subscriptions: [closedSubscription],
      usageRows,
    });
    const stripeClient: StripeMeterEventClient = { createMeterEvent: vi.fn() };

    const summary = await flushUsageEventsToStripe({
      supabase: client as never,
      stripeClient,
      dryRun: true,
      closedBefore: "2026-05-02T00:00:00.000Z",
      meterEventNames: { OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS: "openplan_runs" },
    });

    expect(summary).toMatchObject({
      dryRun: true,
      scannedSubscriptions: 1,
      scannedEvents: 2,
      dryRunGroups: 1,
      reportedGroups: 0,
      failedGroups: 0,
    });
    expect(summary.groups[0]).toMatchObject({
      bucketKey: "runs",
      eventCount: 2,
      totalWeight: 6,
      status: "dry_run",
      meterEventName: "openplan_runs",
    });
    expect(stripeClient.createMeterEvent).not.toHaveBeenCalled();
    expect(markCalls).toHaveLength(0);
  });

  it("reports one Stripe meter event per bucket and marks accepted rows", async () => {
    const { client, markCalls } = createFlushClient({
      subscriptions: [closedSubscription],
      usageRows,
    });
    const createMeterEvent = vi.fn(async () => ({ id: "mtr_evt_123" }));

    const summary = await flushUsageEventsToStripe({
      supabase: client as never,
      stripeClient: { createMeterEvent },
      dryRun: false,
      closedBefore: "2026-05-02T00:00:00.000Z",
      meterEventNames: { OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS: "openplan_runs" },
      now: new Date("2026-05-02T01:00:00.000Z"),
    });

    expect(summary.reportedGroups).toBe(1);
    expect(summary.reportedWeight).toBe(6);
    expect(createMeterEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "openplan_runs",
        timestamp: 1777593600,
        payload: expect.objectContaining({
          stripe_customer_id: "cus_123",
          value: "6",
          workspace_id: closedSubscription.workspace_id,
          bucket_key: "runs",
        }),
      })
    );
    expect(markCalls).toEqual([
      {
        ids: ["usage-1", "usage-2"],
        payload: {
          stripe_reported_at: "2026-05-02T01:00:00.000Z",
          stripe_report_event_id: "mtr_evt_123",
        },
      },
    ]);
  });

  it("skips closed usage when no meter event is configured for the bucket", async () => {
    const { client, markCalls } = createFlushClient({
      subscriptions: [closedSubscription],
      usageRows,
    });
    const createMeterEvent = vi.fn(async () => ({ id: "mtr_evt_123" }));

    const summary = await flushUsageEventsToStripe({
      supabase: client as never,
      stripeClient: { createMeterEvent },
      dryRun: false,
      closedBefore: "2026-05-02T00:00:00.000Z",
      meterEventNames: {},
    });

    expect(summary.skippedGroups).toBe(1);
    expect(summary.groups[0]).toMatchObject({ status: "skipped", reason: "missing_meter_event_name" });
    expect(createMeterEvent).not.toHaveBeenCalled();
    expect(markCalls).toHaveLength(0);
  });

  it("leaves usage unmarked when Stripe rejects a meter event", async () => {
    const { client, markCalls } = createFlushClient({
      subscriptions: [closedSubscription],
      usageRows,
    });

    const summary = await flushUsageEventsToStripe({
      supabase: client as never,
      stripeClient: {
        createMeterEvent: vi.fn(async () => {
          throw new Error("Stripe rejected meter event");
        }),
      },
      dryRun: false,
      closedBefore: "2026-05-02T00:00:00.000Z",
      meterEventNames: { OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS: "openplan_runs" },
    });

    expect(summary.failedGroups).toBe(1);
    expect(summary.groups[0]).toMatchObject({
      status: "failed",
      reason: "stripe_meter_event_failed",
      error: "Stripe rejected meter event",
    });
    expect(markCalls).toHaveLength(0);
  });

  it("surfaces accepted Stripe reports when marking local rows fails", async () => {
    const { client, markCalls } = createFlushClient({
      subscriptions: [closedSubscription],
      usageRows,
      markError: { message: "database timeout", code: "57014" },
    });

    const summary = await flushUsageEventsToStripe({
      supabase: client as never,
      stripeClient: { createMeterEvent: vi.fn(async () => ({ id: "mtr_evt_123" })) },
      dryRun: false,
      closedBefore: "2026-05-02T00:00:00.000Z",
      meterEventNames: { OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS: "openplan_runs" },
    });

    expect(summary.markFailedGroups).toBe(1);
    expect(summary.groups[0]).toMatchObject({
      status: "reported_mark_failed",
      reason: "usage_mark_reported_failed",
      stripeReportEventId: "mtr_evt_123",
      error: "database timeout",
    });
    expect(markCalls).toHaveLength(1);
  });
});
