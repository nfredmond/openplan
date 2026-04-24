import type { SupabaseClient } from "@supabase/supabase-js";
import type { BillingPlan, BillingSubscriptionStatus, BillingWebhookMutation } from "@/lib/billing/webhook";

export type BillingSubscriptionRow = {
  workspace_id: string;
  plan: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  quota_buckets: Record<string, unknown> | null;
  metadata_json?: Record<string, unknown> | null;
  updated_at: string | null;
};

export type BillingSubscriptionSnapshot = {
  workspaceId: string;
  plan: BillingPlan | string;
  status: BillingSubscriptionStatus | string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  quotaBuckets: Record<string, unknown>;
  updatedAt: string | null;
  source: "subscriptions" | "workspaces_fallback";
};

export type BillingSubscriptionMutation = BillingWebhookMutation & {
  currentPeriodStart?: string | null;
  quotaBuckets?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type BillingSubscriptionApplyResult = {
  error: { message: string; code?: string | null } | null;
  ledgerMissing: boolean;
};

export type BillingSupabaseLike = Pick<SupabaseClient, "from">;

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
}

function normalizePlanForLedger(plan: string | null | undefined): string {
  const normalized = plan?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "starter";
}

function normalizeStatusForLedger(status: string | null | undefined): string {
  const normalized = status?.trim().toLowerCase();
  return normalized && normalized.length > 0 ? normalized : "inactive";
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

export function subscriptionSnapshotFromRow(row: BillingSubscriptionRow): BillingSubscriptionSnapshot {
  return {
    workspaceId: row.workspace_id,
    plan: normalizePlanForLedger(row.plan),
    status: normalizeStatusForLedger(row.status),
    stripeCustomerId: row.stripe_customer_id ?? null,
    stripeSubscriptionId: row.stripe_subscription_id ?? null,
    currentPeriodStart: row.current_period_start ?? null,
    currentPeriodEnd: row.current_period_end ?? null,
    quotaBuckets: normalizeJsonObject(row.quota_buckets),
    updatedAt: row.updated_at ?? null,
    source: "subscriptions",
  };
}

export async function loadWorkspaceSubscriptionSnapshot(
  supabase: BillingSupabaseLike,
  workspaceId: string
): Promise<{
  subscription: BillingSubscriptionSnapshot | null;
  error: { message: string; code?: string | null; missingSchema?: boolean } | null;
}> {
  const result = await supabase
    .from("subscriptions")
    .select(
      "workspace_id, plan, status, stripe_customer_id, stripe_subscription_id, current_period_start, current_period_end, quota_buckets, updated_at"
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (result.error) {
    return {
      subscription: null,
      error: {
        message: result.error.message,
        code: result.error.code ?? null,
        missingSchema: looksLikePendingSchema(result.error.message),
      },
    };
  }

  return {
    subscription: result.data ? subscriptionSnapshotFromRow(result.data as BillingSubscriptionRow) : null,
    error: null,
  };
}

export async function upsertSubscriptionFromStripeMutation(
  supabase: BillingSupabaseLike,
  mutation: BillingSubscriptionMutation
): Promise<{ error: { message: string; code?: string | null } | null; missingSchema: boolean }> {
  const result = await supabase.from("subscriptions").upsert(
    {
      workspace_id: mutation.workspaceId,
      plan: normalizePlanForLedger(mutation.subscriptionPlan),
      status: normalizeStatusForLedger(mutation.subscriptionStatus),
      stripe_customer_id: mutation.stripeCustomerId ?? null,
      stripe_subscription_id: mutation.stripeSubscriptionId ?? null,
      current_period_start: mutation.currentPeriodStart ?? null,
      current_period_end: mutation.currentPeriodEnd ?? null,
      quota_buckets: mutation.quotaBuckets ?? {},
      metadata_json: mutation.metadata ?? {},
    },
    { onConflict: "workspace_id" }
  );

  if (result.error) {
    return {
      error: { message: result.error.message, code: result.error.code ?? null },
      missingSchema: looksLikePendingSchema(result.error.message),
    };
  }

  return { error: null, missingSchema: false };
}

export async function syncWorkspaceBillingSnapshot(
  supabase: BillingSupabaseLike,
  mutation: BillingSubscriptionMutation,
  now = new Date()
): Promise<{ error: { message: string; code?: string | null } | null }> {
  const result = await supabase
    .from("workspaces")
    .update({
      plan: normalizePlanForLedger(mutation.subscriptionPlan),
      subscription_plan: normalizePlanForLedger(mutation.subscriptionPlan),
      subscription_status: normalizeStatusForLedger(mutation.subscriptionStatus),
      stripe_customer_id: mutation.stripeCustomerId ?? null,
      stripe_subscription_id: mutation.stripeSubscriptionId ?? null,
      subscription_current_period_end: mutation.currentPeriodEnd ?? null,
      billing_updated_at: now.toISOString(),
    })
    .eq("id", mutation.workspaceId);

  if (result.error) {
    return { error: { message: result.error.message, code: result.error.code ?? null } };
  }

  return { error: null };
}

export async function applyBillingSubscriptionMutation(
  supabase: BillingSupabaseLike,
  mutation: BillingSubscriptionMutation,
  now = new Date()
): Promise<BillingSubscriptionApplyResult> {
  const subscriptionResult = await upsertSubscriptionFromStripeMutation(supabase, mutation);

  if (subscriptionResult.error && !subscriptionResult.missingSchema) {
    return {
      error: subscriptionResult.error,
      ledgerMissing: false,
    };
  }

  const workspaceResult = await syncWorkspaceBillingSnapshot(supabase, mutation, now);
  if (workspaceResult.error) {
    return {
      error: workspaceResult.error,
      ledgerMissing: subscriptionResult.missingSchema,
    };
  }

  return {
    error: null,
    ledgerMissing: subscriptionResult.missingSchema,
  };
}
