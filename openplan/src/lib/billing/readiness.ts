import type { SupabaseClient } from "@supabase/supabase-js";
import type { UsageFlushSummary } from "@/lib/billing/usage-flush";
import { resolveMeterEventName } from "@/lib/billing/usage-flush";

export type BillingReadinessStatus = "ready" | "blocked";
export type BillingReadinessCheckStatus = "pass" | "warn" | "fail";

export type BillingReadinessCheck = {
  key: string;
  label: string;
  status: BillingReadinessCheckStatus;
  detail: string;
};

export type BillingReadinessFacts = {
  workspace?: {
    requested: boolean;
    workspaceId: string | null;
    found: boolean;
    name?: string | null;
    subscriptionStatus?: string | null;
    subscriptionPlan?: string | null;
    stripeCustomerIdPresent?: boolean;
    stripeSubscriptionIdPresent?: boolean;
    currentPeriodEnd?: string | null;
    error?: string | null;
    missingSchema?: boolean;
  };
  subscriptionLedger?: {
    accessible: boolean;
    rowCount?: number;
    activeLikeCount?: number;
    error?: string | null;
    missingSchema?: boolean;
  };
  usageLedger?: {
    accessible: boolean;
    unreportedEventCount?: number;
    unreportedWeight?: number;
    error?: string | null;
    missingSchema?: boolean;
  };
  usageDryRun?: {
    attempted: boolean;
    ok: boolean;
    closedBefore?: string | null;
    scannedSubscriptions?: number;
    scannedEvents?: number;
    dryRunGroups?: number;
    skippedGroups?: number;
    failedGroups?: number;
    markFailedGroups?: number;
    error?: string | null;
  };
};

export type BillingReadinessSummary = {
  generatedAt: string;
  status: BillingReadinessStatus;
  readyForPaidCanary: boolean;
  blockers: string[];
  warnings: string[];
  checks: BillingReadinessCheck[];
};

export type BillingReadinessSupabaseLike = Pick<SupabaseClient, "from">;

type BuildBillingReadinessSummaryInput = {
  env?: Record<string, string | undefined>;
  facts?: BillingReadinessFacts;
  generatedAt?: Date;
};

type EnvCheck = {
  key: string;
  label: string;
  names: string[];
  required: boolean;
  detailWhenMissing: string;
};

const ACTIVE_LIKE_STATUSES = new Set(["active", "trialing", "pilot"]);

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function configuredEnvName(names: string[], env: Record<string, string | undefined>): string | null {
  return names.find((name) => Boolean(env[name]?.trim())) ?? null;
}

function envCheck({
  key,
  label,
  names,
  required,
  detailWhenMissing,
  env,
}: EnvCheck & { env: Record<string, string | undefined> }): BillingReadinessCheck {
  const configuredName = configuredEnvName(names, env);
  if (configuredName) {
    return {
      key,
      label,
      status: "pass",
      detail: `Configured via ${configuredName}.`,
    };
  }

  return {
    key,
    label,
    status: required ? "fail" : "warn",
    detail: detailWhenMissing,
  };
}

function warningCheck(key: string, label: string, detail: string): BillingReadinessCheck {
  return { key, label, status: "warn", detail };
}

function failCheck(key: string, label: string, detail: string): BillingReadinessCheck {
  return { key, label, status: "fail", detail };
}

function passCheck(key: string, label: string, detail: string): BillingReadinessCheck {
  return { key, label, status: "pass", detail };
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

function looksLikePendingSchema(message: string | null | undefined): boolean {
  return /relation .* does not exist|could not find the table|schema cache/i.test(message ?? "");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "unknown";
}

export function summarizeUsageDryRun(summary: UsageFlushSummary): BillingReadinessFacts["usageDryRun"] {
  return {
    attempted: true,
    ok: summary.failedGroups === 0 && summary.markFailedGroups === 0,
    closedBefore: summary.closedBefore,
    scannedSubscriptions: summary.scannedSubscriptions,
    scannedEvents: summary.scannedEvents,
    dryRunGroups: summary.dryRunGroups,
    skippedGroups: summary.skippedGroups,
    failedGroups: summary.failedGroups,
    markFailedGroups: summary.markFailedGroups,
  };
}

export function buildBillingReadinessSummary({
  env = process.env,
  facts = {},
  generatedAt = new Date(),
}: BuildBillingReadinessSummaryInput = {}): BillingReadinessSummary {
  const checks: BillingReadinessCheck[] = [
    envCheck({
      env,
      key: "stripe_secret_key",
      label: "Stripe API key",
      names: ["OPENPLAN_STRIPE_SECRET_KEY", "STRIPE_SECRET_KEY"],
      required: true,
      detailWhenMissing: "Missing OPENPLAN_STRIPE_SECRET_KEY or STRIPE_SECRET_KEY.",
    }),
    envCheck({
      env,
      key: "stripe_starter_price",
      label: "Starter checkout price",
      names: ["OPENPLAN_STRIPE_PRICE_ID_STARTER"],
      required: true,
      detailWhenMissing: "Missing OPENPLAN_STRIPE_PRICE_ID_STARTER.",
    }),
    envCheck({
      env,
      key: "stripe_professional_price",
      label: "Professional checkout price",
      names: ["OPENPLAN_STRIPE_PRICE_ID_PROFESSIONAL"],
      required: false,
      detailWhenMissing: "OPENPLAN_STRIPE_PRICE_ID_PROFESSIONAL is not configured; Starter canary can still run.",
    }),
    envCheck({
      env,
      key: "stripe_webhook_secret",
      label: "Stripe webhook signing secret",
      names: ["OPENPLAN_STRIPE_WEBHOOK_SECRET"],
      required: true,
      detailWhenMissing: "Missing OPENPLAN_STRIPE_WEBHOOK_SECRET.",
    }),
    envCheck({
      env,
      key: "billing_readiness_secret",
      label: "Billing readiness ops secret",
      names: ["OPENPLAN_BILLING_READINESS_SECRET", "OPENPLAN_BILLING_USAGE_FLUSH_SECRET"],
      required: true,
      detailWhenMissing: "Missing OPENPLAN_BILLING_READINESS_SECRET or OPENPLAN_BILLING_USAGE_FLUSH_SECRET.",
    }),
    envCheck({
      env,
      key: "usage_flush_secret",
      label: "Usage flush ops secret",
      names: ["OPENPLAN_BILLING_USAGE_FLUSH_SECRET"],
      required: true,
      detailWhenMissing: "Missing OPENPLAN_BILLING_USAGE_FLUSH_SECRET.",
    }),
    envCheck({
      env,
      key: "supabase_public_url",
      label: "Supabase project URL",
      names: ["NEXT_PUBLIC_SUPABASE_URL"],
      required: true,
      detailWhenMissing: "Missing NEXT_PUBLIC_SUPABASE_URL.",
    }),
    envCheck({
      env,
      key: "supabase_anon_key",
      label: "Supabase anon key",
      names: ["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
      required: true,
      detailWhenMissing: "Missing NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    }),
    envCheck({
      env,
      key: "supabase_service_role_key",
      label: "Supabase service-role key",
      names: ["SUPABASE_SERVICE_ROLE_KEY"],
      required: true,
      detailWhenMissing: "Missing SUPABASE_SERVICE_ROLE_KEY.",
    }),
  ];

  const runsMeter = resolveMeterEventName("runs", env);
  checks.push(
    runsMeter
      ? passCheck("stripe_runs_meter", "Stripe runs meter event", "Configured for the runs usage bucket.")
      : failCheck(
          "stripe_runs_meter",
          "Stripe runs meter event",
          "Missing OPENPLAN_STRIPE_METER_EVENT_NAME_RUNS or OPENPLAN_STRIPE_METER_EVENT_NAME."
        )
  );

  const subscriptionLedger = facts.subscriptionLedger;
  if (!subscriptionLedger) {
    checks.push(
      warningCheck(
        "subscription_ledger",
        "Subscription ledger",
        "Not checked; call the service-backed readiness route to verify subscriptions table access."
      )
    );
  } else if (subscriptionLedger.accessible) {
    checks.push(
      passCheck(
        "subscription_ledger",
        "Subscription ledger",
        `${subscriptionLedger.rowCount ?? 0} subscription row(s), ${subscriptionLedger.activeLikeCount ?? 0} active-like row(s).`
      )
    );
  } else {
    checks.push(
      failCheck(
        "subscription_ledger",
        "Subscription ledger",
        subscriptionLedger.missingSchema
          ? "subscriptions table is not visible; apply the billing ledger migration before paid access."
          : `subscriptions table check failed: ${subscriptionLedger.error ?? "unknown"}.`
      )
    );
  }

  const usageLedger = facts.usageLedger;
  if (!usageLedger) {
    checks.push(
      warningCheck(
        "usage_ledger",
        "Usage-event ledger",
        "Not checked; call the service-backed readiness route to verify usage_events table access."
      )
    );
  } else if (usageLedger.accessible) {
    checks.push(
      passCheck(
        "usage_ledger",
        "Usage-event ledger",
        `${usageLedger.unreportedEventCount ?? 0} unreported event(s), ${usageLedger.unreportedWeight ?? 0} unreported weighted unit(s).`
      )
    );
  } else {
    checks.push(
      failCheck(
        "usage_ledger",
        "Usage-event ledger",
        usageLedger.missingSchema
          ? "usage_events table is not visible; apply the billing ledger migration before paid access."
          : `usage_events table check failed: ${usageLedger.error ?? "unknown"}.`
      )
    );
  }

  const workspace = facts.workspace;
  if (!workspace || !workspace.requested) {
    checks.push(
      warningCheck(
        "workspace_billing_snapshot",
        "Workspace billing snapshot",
        "No workspaceId supplied; canary-specific workspace billing state was not checked."
      )
    );
  } else if (workspace.found) {
    const customer = workspace.stripeCustomerIdPresent ? "Stripe customer present" : "no Stripe customer yet";
    const subscription = workspace.stripeSubscriptionIdPresent
      ? "Stripe subscription present"
      : "no Stripe subscription yet";
    checks.push(
      passCheck(
        "workspace_billing_snapshot",
        "Workspace billing snapshot",
        `${workspace.name ?? workspace.workspaceId ?? "Workspace"} status=${workspace.subscriptionStatus ?? "n/a"} plan=${workspace.subscriptionPlan ?? "n/a"}; ${customer}; ${subscription}.`
      )
    );
  } else {
    checks.push(
      failCheck(
        "workspace_billing_snapshot",
        "Workspace billing snapshot",
        workspace.missingSchema
          ? "workspaces table is not visible from service-role readiness checks."
          : `Workspace ${workspace.workspaceId ?? "unknown"} was not found or could not be read: ${workspace.error ?? "not found"}.`
      )
    );
  }

  const usageDryRun = facts.usageDryRun;
  if (!usageDryRun || !usageDryRun.attempted) {
    checks.push(
      warningCheck(
        "usage_flush_dry_run",
        "Usage flush dry run",
        "Not executed; pass includeUsageDryRun=true to rehearse closed-period grouping without Stripe writes."
      )
    );
  } else if (usageDryRun.ok) {
    checks.push(
      passCheck(
        "usage_flush_dry_run",
        "Usage flush dry run",
        `${usageDryRun.scannedSubscriptions ?? 0} subscription(s), ${usageDryRun.scannedEvents ?? 0} event(s), ${usageDryRun.dryRunGroups ?? 0} dry-run group(s), ${usageDryRun.skippedGroups ?? 0} skipped group(s).`
      )
    );
  } else {
    checks.push(
      failCheck(
        "usage_flush_dry_run",
        "Usage flush dry run",
        usageDryRun.error
          ? `Dry run failed: ${usageDryRun.error}.`
          : `Dry run found ${usageDryRun.failedGroups ?? 0} failed group(s) and ${usageDryRun.markFailedGroups ?? 0} mark-failed group(s).`
      )
    );
  }

  const blockers = checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.label}: ${check.detail}`);
  const warnings = checks
    .filter((check) => check.status === "warn")
    .map((check) => `${check.label}: ${check.detail}`);

  return {
    generatedAt: generatedAt.toISOString(),
    status: blockers.length ? "blocked" : "ready",
    readyForPaidCanary: blockers.length === 0,
    blockers: unique(blockers),
    warnings: unique(warnings),
    checks,
  };
}

async function loadSubscriptionLedgerFact(
  supabase: BillingReadinessSupabaseLike
): Promise<NonNullable<BillingReadinessFacts["subscriptionLedger"]>> {
  try {
    const result = await supabase
      .from("subscriptions")
      .select("workspace_id, status", { count: "exact" })
      .limit(1000);

    if (result.error) {
      return {
        accessible: false,
        error: result.error.message,
        missingSchema: looksLikePendingSchema(result.error.message),
      };
    }

    const rows = (result.data ?? []) as Array<{ status?: string | null }>;
    return {
      accessible: true,
      rowCount: result.count ?? rows.length,
      activeLikeCount: rows.filter((row) => ACTIVE_LIKE_STATUSES.has(row.status?.trim().toLowerCase() ?? "")).length,
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      accessible: false,
      error: message,
      missingSchema: looksLikePendingSchema(message),
    };
  }
}

async function loadUsageLedgerFact(
  supabase: BillingReadinessSupabaseLike
): Promise<NonNullable<BillingReadinessFacts["usageLedger"]>> {
  try {
    const result = await supabase
      .from("usage_events")
      .select("workspace_id, weight, stripe_reported_at", { count: "exact" })
      .is("stripe_reported_at", null)
      .limit(1000);

    if (result.error) {
      return {
        accessible: false,
        error: result.error.message,
        missingSchema: looksLikePendingSchema(result.error.message),
      };
    }

    const rows = (result.data ?? []) as Array<{ weight?: number | string | null }>;
    return {
      accessible: true,
      unreportedEventCount: result.count ?? rows.length,
      unreportedWeight: rows.reduce((total, row) => total + asWeight(row.weight), 0),
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      accessible: false,
      error: message,
      missingSchema: looksLikePendingSchema(message),
    };
  }
}

async function loadWorkspaceFact(
  supabase: BillingReadinessSupabaseLike,
  workspaceId: string
): Promise<NonNullable<BillingReadinessFacts["workspace"]>> {
  try {
    const result = await supabase
      .from("workspaces")
      .select(
        "id, name, subscription_status, subscription_plan, stripe_customer_id, stripe_subscription_id, subscription_current_period_end"
      )
      .eq("id", workspaceId)
      .maybeSingle();

    if (result.error) {
      return {
        requested: true,
        workspaceId,
        found: false,
        error: result.error.message,
        missingSchema: looksLikePendingSchema(result.error.message),
      };
    }

    const row = result.data as
      | {
          id: string;
          name?: string | null;
          subscription_status?: string | null;
          subscription_plan?: string | null;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          subscription_current_period_end?: string | null;
        }
      | null
      | undefined;

    if (!row) {
      return {
        requested: true,
        workspaceId,
        found: false,
        error: "not found",
      };
    }

    return {
      requested: true,
      workspaceId,
      found: true,
      name: row.name ?? null,
      subscriptionStatus: row.subscription_status ?? null,
      subscriptionPlan: row.subscription_plan ?? null,
      stripeCustomerIdPresent: Boolean(row.stripe_customer_id?.trim()),
      stripeSubscriptionIdPresent: Boolean(row.stripe_subscription_id?.trim()),
      currentPeriodEnd: row.subscription_current_period_end ?? null,
    };
  } catch (error) {
    const message = errorMessage(error);
    return {
      requested: true,
      workspaceId,
      found: false,
      error: message,
      missingSchema: looksLikePendingSchema(message),
    };
  }
}

export async function loadBillingReadinessFacts(
  supabase: BillingReadinessSupabaseLike,
  options: { workspaceId?: string | null } = {}
): Promise<BillingReadinessFacts> {
  const workspaceId = options.workspaceId?.trim() || null;
  const [subscriptionLedger, usageLedger, workspace] = await Promise.all([
    loadSubscriptionLedgerFact(supabase),
    loadUsageLedgerFact(supabase),
    workspaceId
      ? loadWorkspaceFact(supabase, workspaceId)
      : Promise.resolve({ requested: false, workspaceId: null, found: false }),
  ]);

  return {
    subscriptionLedger,
    usageLedger,
    workspace,
  };
}
