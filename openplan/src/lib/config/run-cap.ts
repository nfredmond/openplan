/**
 * OPTIONAL, OPERATOR-SET CAP on expensive runs. There is no plan, no tier, and
 * no default limit.
 *
 * WHAT THIS REPLACED, AND WHY
 *   OpenPlan is free and open source with no paid tier, but its six most
 *   important actions — corridor analysis, report generation, model-run
 *   creation and launch, scenario comparison, network ingest — were gated by a
 *   per-plan monthly quota. `workspaces.plan` defaults to 'free', which was not
 *   a case in the plan enum, so every self-serve workspace normalized to
 *   "unknown" and inherited a 100-run cap. The refusal read "Monthly analysis
 *   run limit reached for the current plan", and the only route to a larger
 *   plan was a checkout deliberately disabled BECAUSE the product is free.
 *
 *   That was a wall with no door, and it stayed invisible until an agency had
 *   done a month of real work. A free product may not ration its own core
 *   features.
 *
 * WHAT REPLACED IT
 *   One number an operator may set, and by default does not. Unset — the
 *   default, and what any self-hosting agency gets — means genuinely unlimited,
 *   and the counter is never even queried. Someone running a public deployment
 *   on their own compute can set a cap to protect it; that is CONFIGURATION,
 *   the same posture as every other deployment setting, not a tier of service.
 *
 *   The refusal names the operator, never a "plan", because on a hosted
 *   deployment the person reading it cannot buy anything — they need to know
 *   who to ask.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Tables whose rows count as a run for the month. */
export type MonthlyRunTable = "runs" | "model_runs";

/**
 * Weight table for capped actions. A model-run launch is minutes of
 * AequilibraE / ActivitySim compute and counts 5×; everything else counts 1×.
 *
 * Weighting survived the removal of plans because it was never about billing —
 * it is about compute cost, which is real whoever is paying for it.
 */
export const RUN_WEIGHTS = {
  MODEL_RUN_LAUNCH: 5,
  DEFAULT: 1,
} as const;

export const MONTHLY_RUN_CAP_ENV = "OPENPLAN_MONTHLY_RUN_CAP";

export type RunCapOk = {
  ok: true;
  /** False when no cap is configured — the normal case. */
  capped: boolean;
  cap: number | null;
  usedRuns: number;
  remaining: number | null;
};

export type RunCapExceeded = {
  ok: false;
  exceeded: true;
  cap: number;
  usedRuns: number;
  message: string;
};

export type RunCapLookupError = {
  ok: false;
  lookupError: true;
  message: string;
  code: string | null;
};

export type RunCapResult = RunCapOk | RunCapExceeded | RunCapLookupError;

/**
 * The configured cap, or null for unlimited.
 *
 * Anything that is not a positive integer is treated as UNSET rather than as
 * zero. A malformed value must never become a cap of 0, which would lock every
 * workspace out of the product on a typo.
 */
export function resolveMonthlyRunCap(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env[MONTHLY_RUN_CAP_ENV]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Local/staging bypass, honored only outside production so a cap set for a
 * public deployment cannot be switched off by an env var in that deployment.
 */
export function isDevUnlimitedRunsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = env.DEV_UNLIMITED_QUOTA;
  return (flag === "1" || flag === "true") && env.NODE_ENV !== "production";
}

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
 * The refusal a user sees. It names the deployment's operator and says nothing
 * about plans, upgrades, or payment — there is nothing to buy, and implying
 * otherwise in a free product is the defect this module exists to remove.
 */
export function monthlyRunCapMessage(cap: number, usedRuns: number): string {
  return (
    `This OpenPlan deployment limits analysis runs to ${cap} per month, and this workspace has used ${usedRuns}. ` +
    `Contact whoever operates this deployment to raise or remove the limit — OpenPlan itself is free and has no usage tiers.`
  );
}

/**
 * Pre-execution check for a capped action.
 *
 * When no cap is configured the counting query is SKIPPED entirely — the
 * default path costs nothing, which is what makes "unlimited by default"
 * honest rather than merely nominal.
 */
export async function checkMonthlyRunCap(
  supabase: SupabaseClient,
  params: {
    workspaceId: string;
    tableName: MonthlyRunTable;
    weight?: number;
    now?: Date;
    env?: NodeJS.ProcessEnv;
  }
): Promise<RunCapResult> {
  const { workspaceId, tableName, now } = params;
  const env = params.env ?? process.env;
  const weight = Math.max(1, params.weight ?? RUN_WEIGHTS.DEFAULT);

  const unlimited: RunCapOk = {
    ok: true,
    capped: false,
    cap: null,
    usedRuns: 0,
    remaining: null,
  };

  if (isDevUnlimitedRunsEnabled(env)) return unlimited;

  const cap = resolveMonthlyRunCap(env);
  if (cap === null) return unlimited;

  const { count, error } = await supabase
    .from(tableName)
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", currentUtcMonthStartIso(now));

  if (error) {
    return {
      ok: false,
      lookupError: true,
      message: error.message,
      code: error.code ?? null,
    };
  }

  const usedRuns = count ?? 0;
  if (usedRuns + weight > cap) {
    return {
      ok: false,
      exceeded: true,
      cap,
      usedRuns,
      message: monthlyRunCapMessage(cap, usedRuns),
    };
  }

  return {
    ok: true,
    capped: true,
    cap,
    usedRuns,
    remaining: Math.max(0, cap - usedRuns),
  };
}

/** Narrow: the counting query itself failed (500-class). */
export function isRunCapLookupError(result: RunCapResult): result is RunCapLookupError {
  return result.ok === false && "lookupError" in result;
}

/** Narrow: the configured cap is exhausted (429-class). */
export function isRunCapExceeded(result: RunCapResult): result is RunCapExceeded {
  return result.ok === false && "exceeded" in result;
}
