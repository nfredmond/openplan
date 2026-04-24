import type { SupabaseClient } from "@supabase/supabase-js";
import { currentUtcMonthStartIso } from "@/lib/billing/quota";

export type BillingUsageEventRow = {
  id?: string;
  workspace_id: string;
  event_key: string;
  bucket_key: string | null;
  weight: number | string | null;
  source_route: string | null;
  idempotency_key: string | null;
  period_start: string | null;
  period_end: string | null;
  occurred_at: string | null;
  stripe_reported_at: string | null;
  stripe_report_event_id: string | null;
  metadata_json?: Record<string, unknown> | null;
};

export type UsageBucketSummary = {
  bucketKey: string;
  eventCount: number;
  totalWeight: number;
  reportedWeight: number;
  unreportedWeight: number;
  lastOccurredAt: string | null;
};

export type UsageEventRecordInput = {
  workspaceId: string;
  eventKey: string;
  bucketKey?: string;
  weight?: number;
  sourceRoute?: string | null;
  idempotencyKey?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  metadata?: Record<string, unknown> | null;
  occurredAt?: string | null;
};

export type UsageSupabaseLike = Pick<SupabaseClient, "from">;

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
}

function asPositiveInteger(value: number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.trunc(value));
  }

  return 1;
}

function asNumber(value: number | string | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function summarizeUsageEventRows(rows: BillingUsageEventRow[]): UsageBucketSummary[] {
  const summaryByBucket = new Map<string, UsageBucketSummary>();

  for (const row of rows) {
    const bucketKey = row.bucket_key?.trim() || "runs";
    const weight = asNumber(row.weight);
    const current =
      summaryByBucket.get(bucketKey) ??
      {
        bucketKey,
        eventCount: 0,
        totalWeight: 0,
        reportedWeight: 0,
        unreportedWeight: 0,
        lastOccurredAt: null,
      };

    current.eventCount += 1;
    current.totalWeight += weight;
    if (row.stripe_reported_at) {
      current.reportedWeight += weight;
    } else {
      current.unreportedWeight += weight;
    }

    if (
      row.occurred_at &&
      (!current.lastOccurredAt || new Date(row.occurred_at).getTime() > new Date(current.lastOccurredAt).getTime())
    ) {
      current.lastOccurredAt = row.occurred_at;
    }

    summaryByBucket.set(bucketKey, current);
  }

  return [...summaryByBucket.values()].sort((left, right) => left.bucketKey.localeCompare(right.bucketKey));
}

export async function recordUsageEvent(
  supabase: UsageSupabaseLike,
  input: UsageEventRecordInput
): Promise<{
  ok: boolean;
  duplicate: boolean;
  id: string | null;
  error: { message: string; code?: string | null; missingSchema?: boolean } | null;
}> {
  const weight = asPositiveInteger(input.weight);
  const result = await supabase
    .from("usage_events")
    .insert({
      workspace_id: input.workspaceId,
      event_key: input.eventKey,
      bucket_key: input.bucketKey ?? "runs",
      weight,
      source_route: input.sourceRoute ?? null,
      idempotency_key: input.idempotencyKey ?? null,
      period_start: input.periodStart ?? null,
      period_end: input.periodEnd ?? null,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      metadata_json: input.metadata ?? {},
    })
    .select("id")
    .maybeSingle();

  if (result.error) {
    const duplicate = result.error.code === "23505";
    return {
      ok: duplicate,
      duplicate,
      id: null,
      error: duplicate
        ? null
        : {
            message: result.error.message,
            code: result.error.code ?? null,
            missingSchema: looksLikePendingSchema(result.error.message),
          },
    };
  }

  return {
    ok: true,
    duplicate: false,
    id: typeof result.data?.id === "string" ? result.data.id : null,
    error: null,
  };
}

export async function loadUsageForCurrentPeriod(
  supabase: UsageSupabaseLike,
  workspaceId: string,
  options?: {
    periodStart?: string | null;
    periodEnd?: string | null;
    limit?: number;
  }
): Promise<{
  buckets: UsageBucketSummary[];
  error: { message: string; code?: string | null; missingSchema?: boolean } | null;
  periodStart: string;
  periodEnd: string | null;
}> {
  const periodStart = options?.periodStart ?? currentUtcMonthStartIso();
  const periodEnd = options?.periodEnd ?? null;
  const limit = Math.max(1, Math.min(1000, options?.limit ?? 500));

  let query = supabase
    .from("usage_events")
    .select("workspace_id, event_key, bucket_key, weight, occurred_at, stripe_reported_at, stripe_report_event_id")
    .eq("workspace_id", workspaceId)
    .gte("occurred_at", periodStart)
    .order("occurred_at", { ascending: false })
    .limit(limit);

  if (periodEnd) {
    query = query.lt("occurred_at", periodEnd);
  }

  const result = await query;
  if (result.error) {
    return {
      buckets: [],
      error: {
        message: result.error.message,
        code: result.error.code ?? null,
        missingSchema: looksLikePendingSchema(result.error.message),
      },
      periodStart,
      periodEnd,
    };
  }

  return {
    buckets: summarizeUsageEventRows((result.data ?? []) as BillingUsageEventRow[]),
    error: null,
    periodStart,
    periodEnd,
  };
}

export async function markUsageEventsReported(
  supabase: UsageSupabaseLike,
  ids: string[],
  stripeReportEventId: string,
  reportedAt = new Date()
): Promise<{ error: { message: string; code?: string | null } | null }> {
  if (ids.length === 0) {
    return { error: null };
  }

  const result = await supabase
    .from("usage_events")
    .update({
      stripe_reported_at: reportedAt.toISOString(),
      stripe_report_event_id: stripeReportEventId,
    })
    .in("id", ids);

  if (result.error) {
    return { error: { message: result.error.message, code: result.error.code ?? null } };
  }

  return { error: null };
}
