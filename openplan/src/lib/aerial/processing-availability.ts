/**
 * Whether THIS deployment can dispatch imagery to the Aerial Intel Platform
 * worker, and what the mission page is allowed to say about it.
 *
 * WHY THIS EXISTS. The mission detail page used to state, unconditionally, that
 * imagery processing "ships in a future release" and that
 * `POST /api/aerial/missions/[id]/process` "returns HTTP 501". That was only
 * ever true of an unconfigured deployment: the dispatch route answers 501 with
 * the integration boundary ONLY when the worker env vars are unset, and
 * otherwise records a job in `aerial_processing_jobs`, dispatches to the worker,
 * and answers 202. Any deployment that had actually wired up the worker was
 * being told, on a live surface, that its working capability did not exist.
 *
 * So the condition is named once, here, instead of being restated in prose. A
 * page that re-derived the rule would drift the first time the route's rule
 * changed, and the failure mode of that drift is a false statement in the UI —
 * which this repo treats as worse than a missing feature.
 *
 * WHY NOT `catalog.ts`. That module is imported by client components
 * (`aerial-mission-creator`, `aerial-mission-status-editor`,
 * `aerial-evidence-package-creator`), and these env vars are unprefixed —
 * they must never be reachable from a browser bundle. This module is
 * server-only: call it from a server component or a route handler.
 */

/**
 * True when both halves of the worker credential pair are present.
 *
 * Mirrors the dispatch route's own test (`workerUrl && workerToken`, each
 * trimmed) deliberately: a deployment that sets the URL but not the token is
 * NOT configured, and the route will still answer 501 for it, so the UI must
 * not promise otherwise. Read as literal property accesses rather than
 * `process.env[name]` so the values survive Next's build-time env handling.
 */
import {
  AERIAL_ARTIFACT_MAX_BYTES_ENV,
  resolveAerialArtifactMaxBytes,
} from "@/lib/aerial/artifact-custody";

export function isAerialProcessingWorkerConfigured(): boolean {
  const workerUrl = process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_URL?.trim();
  const workerToken = process.env.OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN?.trim();
  return Boolean(workerUrl && workerToken);
}

export type AerialProcessingAvailabilityNotice = {
  title: string;
  description: string;
};

/**
 * The two truths the mission page can honestly tell about imagery processing.
 *
 * Pure and parameterised so both branches are testable without touching the
 * environment; the caller supplies the answer from
 * `isAerialProcessingWorkerConfigured()`.
 *
 * The configured branch says plainly that the page has no request button and no
 * job-status view yet. Naming a real gap is the honest thing to do here —
 * describing a button that does not exist would be the same class of defect
 * this function was written to remove.
 */
function formatCeiling(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb < 1024 ? `${mb.toFixed(0)} MB` : `${(mb / 1024).toFixed(2)} GB`;
}

export function describeAerialProcessingAvailability(
  workerConfigured: boolean,
  /**
   * This deployment's per-artifact custody ceiling. Parameterised for the same
   * reason `workerConfigured` is — so both branches are testable without
   * touching the environment — and defaulted so the page needs no new argument.
   */
  maxArtifactBytes: number = resolveAerialArtifactMaxBytes()
): AerialProcessingAvailabilityNotice {
  if (!workerConfigured) {
    return {
      title: "Imagery processing is not configured on this deployment",
      description:
        "Missions, AOIs, and evidence packages are tracked here today. Imagery-to-ortho/DSM processing runs on a separate Aerial Intel Platform worker, and this deployment has not set OPENPLAN_AERIAL_PROCESSING_WORKER_URL and OPENPLAN_AERIAL_PROCESSING_WORKER_TOKEN — so POST /api/aerial/missions/[id]/process answers HTTP 501 with an integration-boundary payload describing what to provision. No simulated outputs are produced.",
    };
  }

  return {
    title: "Imagery processing is configured — request it through the API",
    description:
      `This deployment has an Aerial Intel Platform worker configured, so POST /api/aerial/missions/[id]/process accepts a signed imagery ZIP URL, records the job, dispatches it, and answers HTTP 202; a succeeded worker callback writes an evidence package. On that callback OpenPlan also downloads each artifact — orthomosaic, DSM, point cloud — into its own private storage, up to ${formatCeiling(maxArtifactBytes)} per artifact (${AERIAL_ARTIFACT_MAX_BYTES_ENV}), so the deliverables outlive the worker's time-limited links; anything it could not take is recorded against the job with the reason, and an evidence package whose bytes are not held stays verification-pending rather than claiming partial verification.`,
  };
}
