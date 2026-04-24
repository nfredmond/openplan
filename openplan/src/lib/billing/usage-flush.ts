import { createHash } from "node:crypto";
import Stripe from "stripe";
import {
  markUsageEventsReported,
  type BillingUsageEventRow,
  type UsageSupabaseLike,
} from "@/lib/billing/usage-events";

type UsageFlushSubscriptionRow = {
  workspace_id: string;
  plan: string | null;
  status: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
};

export type UsageFlushGroupResult = {
  workspaceId: string;
  bucketKey: string;
  periodStart: string | null;
  periodEnd: string;
  eventCount: number;
  totalWeight: number;
  status: "dry_run" | "reported" | "skipped" | "failed" | "reported_mark_failed";
  reason?: string;
  meterEventName?: string;
  stripeReportEventId?: string;
  error?: string;
};

export type UsageFlushSummary = {
  dryRun: boolean;
  closedBefore: string;
  workspaceId: string | null;
  bucketKey: string | null;
  scannedSubscriptions: number;
  scannedEvents: number;
  groups: UsageFlushGroupResult[];
  reportedGroups: number;
  dryRunGroups: number;
  skippedGroups: number;
  failedGroups: number;
  markFailedGroups: number;
  reportedWeight: number;
};

export type StripeMeterEventClient = {
  createMeterEvent: (params: {
    eventName: string;
    payload: Record<string, string>;
    identifier: string;
    timestamp: number;
  }) => Promise<{ id: string | null }>;
};

type FlushUsageEventsInput = {
  supabase: UsageSupabaseLike;
  stripeClient?: StripeMeterEventClient | null;
  dryRun?: boolean;
  closedBefore?: string | null;
  workspaceId?: string | null;
  bucketKey?: string | null;
  limit?: number;
  meterEventNames?: Record<string, string | undefined>;
  now?: Date;
};

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;

function normalizedLimit(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LIMIT;
  }

  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(value)));
}

function asWeight(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
  }

  return 0;
}

function toEpochSeconds(value: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return Math.floor(Date.now() / 1000);
  }

  return Math.floor(parsed / 1000);
}

function meterKeyForBucket(bucketKey: string): string {
  return `OPENPLAN_STRIPE_METER_EVENT_NAME_${bucketKey
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")}`;
}

export function resolveMeterEventName(
  bucketKey: string,
  source: Record<string, string | undefined> = process.env
): string | null {
  const specific = source[meterKeyForBucket(bucketKey)]?.trim();
  if (specific) {
    return specific;
  }

  if (bucketKey === "runs") {
    const runs = source.OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS?.trim();
    if (runs) {
      return runs;
    }
  }

  return source.OPENPLAN_STRIPE_METER_EVENT_NAME?.trim() || null;
}

function reportIdentifier(params: {
  workspaceId: string;
  bucketKey: string;
  periodEnd: string;
  eventIds: string[];
}): string {
  const hash = createHash("sha256")
    .update(`${params.workspaceId}:${params.bucketKey}:${params.periodEnd}:${[...params.eventIds].sort().join(",")}`)
    .digest("hex")
    .slice(0, 32);

  return `openplan_usage_${hash}`;
}

function groupUsageRows(
  subscription: UsageFlushSubscriptionRow,
  rows: BillingUsageEventRow[]
): Array<{
  bucketKey: string;
  periodStart: string | null;
  periodEnd: string;
  eventIds: string[];
  eventCount: number;
  totalWeight: number;
}> {
  const groups = new Map<
    string,
    {
      bucketKey: string;
      periodStart: string | null;
      periodEnd: string;
      eventIds: string[];
      eventCount: number;
      totalWeight: number;
    }
  >();

  const periodEnd = subscription.current_period_end;
  if (!periodEnd) {
    return [];
  }

  for (const row of rows) {
    if (!row.id) {
      continue;
    }

    const bucketKey = row.bucket_key?.trim() || "runs";
    const current =
      groups.get(bucketKey) ??
      {
        bucketKey,
        periodStart: subscription.current_period_start ?? row.period_start ?? null,
        periodEnd,
        eventIds: [],
        eventCount: 0,
        totalWeight: 0,
      };

    current.eventIds.push(row.id);
    current.eventCount += 1;
    current.totalWeight += asWeight(row.weight);
    groups.set(bucketKey, current);
  }

  return [...groups.values()].sort((left, right) => left.bucketKey.localeCompare(right.bucketKey));
}

async function loadClosedSubscriptions({
  supabase,
  closedBefore,
  workspaceId,
  limit,
}: {
  supabase: UsageSupabaseLike;
  closedBefore: string;
  workspaceId: string | null;
  limit: number;
}): Promise<{ rows: UsageFlushSubscriptionRow[]; error: { message: string } | null }> {
  let query = supabase
    .from("subscriptions")
    .select(
      "workspace_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end"
    )
    .not("stripe_customer_id", "is", null)
    .not("current_period_end", "is", null)
    .lte("current_period_end", closedBefore);

  if (workspaceId) {
    query = query.eq("workspace_id", workspaceId);
  }

  const result = await query.order("current_period_end", { ascending: true }).limit(limit);
  if (result.error) {
    return { rows: [], error: { message: result.error.message } };
  }

  return { rows: (result.data ?? []) as UsageFlushSubscriptionRow[], error: null };
}

async function loadUnreportedUsageForSubscription({
  supabase,
  subscription,
  bucketKey,
  limit,
}: {
  supabase: UsageSupabaseLike;
  subscription: UsageFlushSubscriptionRow;
  bucketKey: string | null;
  limit: number;
}): Promise<{ rows: BillingUsageEventRow[]; error: { message: string } | null }> {
  if (!subscription.current_period_end) {
    return { rows: [], error: null };
  }

  let query = supabase
    .from("usage_events")
    .select(
      "id, workspace_id, event_key, bucket_key, weight, source_route, idempotency_key, period_start, period_end, occurred_at, stripe_reported_at, stripe_report_event_id, metadata_json"
    )
    .eq("workspace_id", subscription.workspace_id)
    .is("stripe_reported_at", null)
    .lt("occurred_at", subscription.current_period_end);

  if (subscription.current_period_start) {
    query = query.gte("occurred_at", subscription.current_period_start);
  }

  if (bucketKey) {
    query = query.eq("bucket_key", bucketKey);
  }

  const result = await query.order("occurred_at", { ascending: true }).limit(limit);
  if (result.error) {
    return { rows: [], error: { message: result.error.message } };
  }

  return { rows: (result.data ?? []) as BillingUsageEventRow[], error: null };
}

export function createStripeMeterEventClient(): StripeMeterEventClient {
  const secretKey = process.env.OPENPLAN_STRIPE_SECRET_KEY ?? process.env.STRIPE_SECRET_KEY;
  if (!secretKey?.trim()) {
    throw new Error("Missing Stripe secret key configuration");
  }

  const stripe = new Stripe(secretKey.trim());
  return {
    async createMeterEvent({ eventName, payload, identifier, timestamp }) {
      const event = await stripe.billing.meterEvents.create({
        event_name: eventName,
        payload,
        identifier,
        timestamp,
      });

      return { id: typeof event.identifier === "string" ? event.identifier : null };
    },
  };
}

export async function flushUsageEventsToStripe({
  supabase,
  stripeClient = null,
  dryRun = true,
  closedBefore,
  workspaceId = null,
  bucketKey = null,
  limit,
  meterEventNames = process.env,
  now = new Date(),
}: FlushUsageEventsInput): Promise<UsageFlushSummary> {
  const closedBeforeIso = closedBefore ?? now.toISOString();
  const eventLimit = normalizedLimit(limit);
  let remainingEvents = eventLimit;
  const groups: UsageFlushGroupResult[] = [];

  const subscriptions = await loadClosedSubscriptions({
    supabase,
    closedBefore: closedBeforeIso,
    workspaceId,
    limit: eventLimit,
  });

  if (subscriptions.error) {
    return {
      dryRun,
      closedBefore: closedBeforeIso,
      workspaceId,
      bucketKey,
      scannedSubscriptions: 0,
      scannedEvents: 0,
      groups: [
        {
          workspaceId: workspaceId ?? "unknown",
          bucketKey: bucketKey ?? "all",
          periodStart: null,
          periodEnd: closedBeforeIso,
          eventCount: 0,
          totalWeight: 0,
          status: "failed",
          reason: "subscriptions_lookup_failed",
          error: subscriptions.error.message,
        },
      ],
      reportedGroups: 0,
      dryRunGroups: 0,
      skippedGroups: 0,
      failedGroups: 1,
      markFailedGroups: 0,
      reportedWeight: 0,
    };
  }

  let scannedEvents = 0;
  for (const subscription of subscriptions.rows) {
    if (remainingEvents <= 0) {
      break;
    }

    const usageRows = await loadUnreportedUsageForSubscription({
      supabase,
      subscription,
      bucketKey,
      limit: remainingEvents,
    });

    if (usageRows.error) {
      groups.push({
        workspaceId: subscription.workspace_id,
        bucketKey: bucketKey ?? "all",
        periodStart: subscription.current_period_start,
        periodEnd: subscription.current_period_end ?? closedBeforeIso,
        eventCount: 0,
        totalWeight: 0,
        status: "failed",
        reason: "usage_lookup_failed",
        error: usageRows.error.message,
      });
      continue;
    }

    scannedEvents += usageRows.rows.length;
    remainingEvents -= usageRows.rows.length;

    for (const group of groupUsageRows(subscription, usageRows.rows)) {
      const meterEventName = resolveMeterEventName(group.bucketKey, meterEventNames);
      const base = {
        workspaceId: subscription.workspace_id,
        bucketKey: group.bucketKey,
        periodStart: group.periodStart,
        periodEnd: group.periodEnd,
        eventCount: group.eventCount,
        totalWeight: group.totalWeight,
        meterEventName: meterEventName ?? undefined,
      };

      if (group.totalWeight <= 0) {
        groups.push({ ...base, status: "skipped", reason: "zero_weight" });
        continue;
      }

      if (!meterEventName) {
        groups.push({ ...base, status: "skipped", reason: "missing_meter_event_name" });
        continue;
      }

      if (dryRun) {
        groups.push({ ...base, status: "dry_run" });
        continue;
      }

      if (!stripeClient) {
        groups.push({ ...base, status: "failed", reason: "missing_stripe_client" });
        continue;
      }

      const identifier = reportIdentifier({
        workspaceId: subscription.workspace_id,
        bucketKey: group.bucketKey,
        periodEnd: group.periodEnd,
        eventIds: group.eventIds,
      });

      let stripeReportEventId: string;
      try {
        const meterEvent = await stripeClient.createMeterEvent({
          eventName: meterEventName,
          identifier,
          timestamp: toEpochSeconds(group.periodEnd),
          payload: {
            stripe_customer_id: subscription.stripe_customer_id ?? "",
            value: String(group.totalWeight),
            workspace_id: subscription.workspace_id,
            stripe_subscription_id: subscription.stripe_subscription_id ?? "",
            bucket_key: group.bucketKey,
            period_start: group.periodStart ?? "",
            period_end: group.periodEnd,
          },
        });
        stripeReportEventId = meterEvent.id ?? `meter_event:${identifier}`;
      } catch (error) {
        groups.push({
          ...base,
          status: "failed",
          reason: "stripe_meter_event_failed",
          error: error instanceof Error ? error.message : "unknown",
        });
        continue;
      }

      const mark = await markUsageEventsReported(supabase, group.eventIds, stripeReportEventId, now);
      if (mark.error) {
        groups.push({
          ...base,
          status: "reported_mark_failed",
          reason: "usage_mark_reported_failed",
          stripeReportEventId,
          error: mark.error.message,
        });
        continue;
      }

      groups.push({ ...base, status: "reported", stripeReportEventId });
    }
  }

  return {
    dryRun,
    closedBefore: closedBeforeIso,
    workspaceId,
    bucketKey,
    scannedSubscriptions: subscriptions.rows.length,
    scannedEvents,
    groups,
    reportedGroups: groups.filter((group) => group.status === "reported").length,
    dryRunGroups: groups.filter((group) => group.status === "dry_run").length,
    skippedGroups: groups.filter((group) => group.status === "skipped").length,
    failedGroups: groups.filter((group) => group.status === "failed").length,
    markFailedGroups: groups.filter((group) => group.status === "reported_mark_failed").length,
    reportedWeight: groups
      .filter((group) => group.status === "reported")
      .reduce((total, group) => total + group.totalWeight, 0),
  };
}
