import type { SupabaseClient } from "@supabase/supabase-js";
import {
  entitlementsForPlan,
  runLimitMessage,
  type WorkspacePlan,
} from "@/lib/billing/limits";

export type MonthlyRunTable = "runs" | "model_runs";

/**
 * Binary weight table for quota-gated actions. Model-run launches represent
 * minutes of AequilibraE / ActivitySim compute and are weighted 5x; every
 * other quota-gated action (analysis, report generation, scenario writes,
 * engagement submit, funding-award creation, assistant) is the default 1x.
 */
export const QUOTA_WEIGHTS = {
  MODEL_RUN_LAUNCH: 5,
  DEFAULT: 1,
} as const;

export type QuotaOk = {
  ok: true;
  plan: WorkspacePlan;
  monthlyLimit: number | null;
  usedRuns: number;
  remaining: number | null;
  unlimited: boolean;
};

export type QuotaExceeded = {
  ok: false;
  plan: WorkspacePlan;
  monthlyLimit: number;
  usedRuns: number;
  message: string;
};

export type QuotaLookupError = {
  ok: false;
  lookupError: true;
  message: string;
  code: string | null;
};

export type QuotaResult = QuotaOk | QuotaExceeded | QuotaLookupError;

export function currentUtcMonthStart(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function currentUtcMonthStartIso(now?: Date): string {
  return currentUtcMonthStart(now).toISOString();
}

/**
 * Allow local/staging environments to bypass quota without accidentally
 * disabling enforcement in production. DEV_UNLIMITED_QUOTA=1 is honored
 * only when NODE_ENV !== "production".
 */
export function isDevUnlimitedQuotaEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const flag = env.DEV_UNLIMITED_QUOTA;
  const enabled = flag === "1" || flag === "true";
  return enabled && env.NODE_ENV !== "production";
}

/**
 * Pre-execution gate for run-launch endpoints. Counts rows in the given
 * monthly-run table for the workspace since the start of the current UTC
 * month and compares against the plan's monthlyRunLimit.
 *
 * Returns:
 *  - { ok: true, unlimited: true } — plan has no limit (enterprise) or DEV_UNLIMITED_QUOTA
 *  - { ok: true, unlimited: false, remaining, usedRuns, monthlyLimit } — workspace is within quota
 *  - { ok: false, message, usedRuns, monthlyLimit } — workspace has exhausted quota (emit 429)
 *  - { ok: false, lookupError: true, message } — the count query itself failed (emit 500)
 */
export async function checkMonthlyRunQuota(
  supabase: SupabaseClient,
  params: {
    workspaceId: string;
    plan: WorkspacePlan;
    tableName: MonthlyRunTable;
    weight?: number;
    now?: Date;
  }
): Promise<QuotaResult> {
  const { workspaceId, plan, tableName, now } = params;
  const weight = Math.max(1, params.weight ?? QUOTA_WEIGHTS.DEFAULT);

  if (isDevUnlimitedQuotaEnabled()) {
    return {
      ok: true,
      plan,
      monthlyLimit: null,
      usedRuns: 0,
      remaining: null,
      unlimited: true,
    };
  }

  const entitlements = entitlementsForPlan(plan);
  const monthlyLimit = entitlements.monthlyRunLimit;

  if (monthlyLimit === null) {
    return {
      ok: true,
      plan,
      monthlyLimit: null,
      usedRuns: 0,
      remaining: null,
      unlimited: true,
    };
  }

  const monthStart = currentUtcMonthStartIso(now);
  const { count, error } = await supabase
    .from(tableName)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", monthStart);

  if (error) {
    return {
      ok: false,
      lookupError: true,
      message: error.message,
      code: error.code ?? null,
    };
  }

  const usedRuns = count ?? 0;
  if (usedRuns + weight > monthlyLimit) {
    return {
      ok: false,
      plan,
      monthlyLimit,
      usedRuns,
      message: runLimitMessage(plan, usedRuns, monthlyLimit),
    };
  }

  return {
    ok: true,
    plan,
    monthlyLimit,
    usedRuns,
    remaining: Math.max(0, monthlyLimit - usedRuns),
    unlimited: false,
  };
}

/**
 * Narrow type guard: true when the count query failed (500-class).
 */
export function isQuotaLookupError(result: QuotaResult): result is QuotaLookupError {
  return result.ok === false && "lookupError" in result && result.lookupError === true;
}

/**
 * Narrow type guard: true when quota is exhausted (429-class).
 */
export function isQuotaExceeded(result: QuotaResult): result is QuotaExceeded {
  return result.ok === false && !("lookupError" in result);
}
