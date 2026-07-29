/**
 * Gather the facts `evaluateDeploymentHealth` judges — the one place that reads
 * the environment and the database for this purpose.
 *
 * Kept separate from `deployment-health.ts` on purpose. That module is pure and
 * sees only booleans, which is what makes it structurally unable to leak a
 * secret; the I/O and the `process.env` reads live here, where the conversion
 * from "a token string" to "a boolean" happens exactly once and never travels
 * further.
 *
 * Two of the readers below are used beyond the dashboard. A worker declaration
 * is only worth making if the surface that would otherwise mislead a planner
 * can see it, so the modeling-worker and county-onramp-worker declarations are
 * also read here and handed to the launch controls by the server components
 * that render them. One reader, two readers of it — not two rules.
 */

import {
  hasInvalidPublicMapboxToken,
  resolvePublicMapboxToken,
} from "@/lib/mapbox/public-token";
import { classifyRunLiveness, type LivenessRun } from "@/lib/models/run-liveness";
import {
  MODELING_WORKER_DECLARATION_ENV,
  type DeploymentHealthFacts,
  type ModelingWorkerDeclaration,
} from "./deployment-health";
import {
  describeDispatchConfigurationProblem,
  isPushDispatchConfigured,
} from "@/lib/models/run-dispatch";
import { detectPdfEngineAvailability } from "@/lib/reports/pdf";

/** Minimal structural view of the client, so this is testable with a stub. */
type RunsQueryClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        in: (
          column: string,
          values: string[]
        ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
      };
    };
  };
};

/**
 * Environment-derived facts. `NEXT_PUBLIC_*` values are inlined at build time,
 * so they must be referenced as full literal expressions rather than looked up
 * dynamically — `process.env[name]` would read as undefined in the browser
 * bundle and, more subtly, in a server component of a built app.
 */
export function readDeploymentEnvFacts(): Omit<DeploymentHealthFacts, "modelingWorker"> {
  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
  const legacyToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const validToken = resolvePublicMapboxToken(accessToken, legacyToken);

  return {
    mapbox: {
      hasValidToken: validToken.length > 0,
      // Only meaningful when no usable token was found; a deployment that sets
      // both a good and a bad token is working, and saying otherwise would be
      // a false alarm.
      hasInvalidToken: validToken.length === 0 && hasInvalidPublicMapboxToken(accessToken, legacyToken),
    },
    censusApiKeyPresent: Boolean(process.env.CENSUS_API_KEY?.trim()),
    anthropicApiKeyPresent: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    // Sourced from the renderer itself so the panel and the actual export can
    // never disagree about which engine will be used.
    pdfRendering: { browserEngineAvailable: detectPdfEngineAvailability().chromeAvailable },
  };
}

/**
 * Values an operator may write for the modeling-worker declaration.
 *
 * Two canonical words plus the boolean-ish spellings people actually type. The
 * synonyms are here so a reasonable answer is never thrown away as a typo —
 * but the set is closed on purpose: anything outside it becomes
 * `unrecognized`, which is REPORTED on the dashboard rather than quietly read
 * as either answer. A declaration guessed from a misspelling would be worse
 * than no declaration at all, because it would be trusted.
 */
const DECLARED_DEPLOYED = new Set(["deployed", "running", "true", "yes", "1", "on"]);
const DECLARED_ABSENT = new Set(["absent", "none", "false", "no", "0", "off"]);

/** Pure: what a raw declaration string means. Empty/unset is `undeclared`. */
export function parseModelingWorkerDeclaration(
  raw: string | null | undefined
): ModelingWorkerDeclaration {
  const value = raw?.trim().toLowerCase();
  if (!value) return "undeclared";
  if (DECLARED_DEPLOYED.has(value)) return "deployed";
  if (DECLARED_ABSENT.has(value)) return "absent";
  return "unrecognized";
}

/**
 * The declaration this deployment has made, for the dashboard AND for the model
 * launch controls — read it in a server component and pass the result down, the
 * way the aerial and county worker declarations are read.
 *
 * Unprefixed on purpose. It is not a secret, but a `NEXT_PUBLIC_` variable is
 * inlined at BUILD time: an operator who deployed a worker and updated the
 * declaration would keep being refused until they rebuilt, which is a fresh way
 * for the product to be confidently wrong. Read server-side per request, a
 * changed declaration takes effect as soon as the process restarts.
 */
export function resolveModelingWorkerDeclaration(
  env: NodeJS.ProcessEnv = process.env
): ModelingWorkerDeclaration {
  return parseModelingWorkerDeclaration(env[MODELING_WORKER_DECLARATION_ENV]);
}

/**
 * Whether a county onramp worker is configured to RECEIVE county jobs.
 *
 * Mirrors `dispatchCountyOnrampJob`'s own test exactly — the URL alone decides,
 * because that is the branch that returns `deliveryMode: "prepared"` without
 * making any request; the token is optional there. Kept in step deliberately:
 * if the dispatcher's rule ever changes, this must change with it, or the
 * county launch control will promise something the dispatcher does not do.
 */
export function isCountyOnrampWorkerConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.OPENPLAN_COUNTY_ONRAMP_WORKER_URL?.trim());
}

/**
 * Observed modeling-worker state for one workspace, plus what the deployment
 * declares about the worker itself.
 *
 * Scoped to the workspace deliberately. Worker liveness is a deployment-wide
 * property, but a workspace-scoped view cannot see it: a worker busy on another
 * tenant's run would look dead here. What IS observable — and is what the viewer
 * actually cares about — is whether THEIR runs are moving. So this reports
 * progress on this workspace's own runs and claims nothing beyond that.
 *
 * `workerLikelyAlive: false` is passed on purpose. `classifyRunLiveness` uses
 * that flag to decide whether a long-queued run counts as abandoned; from a
 * single workspace's runs we have no global signal, so we take the local view —
 * a queued run that nothing in this workspace is progressing past is stale from
 * this workspace's point of view, which is the honest claim to make here.
 *
 * `now` defaults here rather than at the call site: reading the clock during a
 * component's render is an impure call (React's purity rule rejects it), while
 * reading it inside this already-async, already-impure loader is fine. Tests
 * pass an explicit value.
 */
export async function loadModelingWorkerFacts(
  client: RunsQueryClient,
  workspaceId: string,
  now: number = Date.now(),
  env: NodeJS.ProcessEnv = process.env
): Promise<DeploymentHealthFacts["modelingWorker"]> {
  // Read first and carried through every early return: both of these are
  // configuration, so a database problem must not be able to erase them. Losing
  // them here would turn a query failure into "this deployment says nothing" and
  // "this deployment can push nowhere", which are different — and false —
  // statements. `pushDispatch` resolves to booleans and one already-composed
  // sentence, so no URL and no token can travel into the pure judging module.
  const declaration = resolveModelingWorkerDeclaration(env);
  const pushDispatch = {
    configured: isPushDispatchConfigured(env),
    configurationProblem: describeDispatchConfigurationProblem(env),
  };
  const empty = { declaration, pushDispatch, nonTerminalRunCount: 0, stalledRunCount: 0 };
  if (!workspaceId) return empty;

  try {
    const { data, error } = await client
      .from("model_runs")
      .select(
        "status, created_at, started_at, updated_at, stages:model_run_stages(status, started_at, completed_at, updated_at)"
      )
      .eq("workspace_id", workspaceId)
      .in("status", ["queued", "running"]);

    // A health check must never itself become a source of noise: if the query
    // fails (missing table before a migration, RLS, transient error) we report
    // nothing observed rather than inventing a worker outage.
    if (error) return empty;

    const runs = (data ?? []) as LivenessRun[];
    const stalledRunCount = runs.filter(
      (run) => classifyRunLiveness(run, now, { workerLikelyAlive: false }) !== "ok"
    ).length;

    return { declaration, pushDispatch, nonTerminalRunCount: runs.length, stalledRunCount };
  } catch {
    return empty;
  }
}
