/**
 * Gather the facts `evaluateDeploymentHealth` judges — the one place that reads
 * the environment and the database for this purpose.
 *
 * Kept separate from `deployment-health.ts` on purpose. That module is pure and
 * sees only booleans, which is what makes it structurally unable to leak a
 * secret; the I/O and the `process.env` reads live here, where the conversion
 * from "a token string" to "a boolean" happens exactly once and never travels
 * further.
 */

import {
  hasInvalidPublicMapboxToken,
  resolvePublicMapboxToken,
} from "@/lib/mapbox/public-token";
import { classifyRunLiveness, type LivenessRun } from "@/lib/models/run-liveness";
import type { DeploymentHealthFacts } from "./deployment-health";
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
 * Observed modeling-worker state for one workspace.
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
  now: number = Date.now()
): Promise<DeploymentHealthFacts["modelingWorker"]> {
  const empty = { nonTerminalRunCount: 0, stalledRunCount: 0 };
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

    return { nonTerminalRunCount: runs.length, stalledRunCount };
  } catch {
    return empty;
  }
}
