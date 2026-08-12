/**
 * The operator setting this lane has, in the `run-cap.ts` mould: optional,
 * unset by default, never a tier, and its refusal names the operator rather
 * than implying there is something to buy.
 *
 * WHY A FEATURE CAP EXISTS AT ALL in a product with no plans. A county parcel
 * fabric is a quarter of a million rows, and OpenPlan is meant to be run by an
 * agency on hardware they chose. Someone hosting a shared deployment on their
 * own compute needs a way to bound what one upload can do to it. Someone
 * running it for their own agency does not, and gets no limit — which is the
 * default, and the only default that lets a planner load their real data.
 *
 * SERVER-ONLY. These read unprefixed env vars; importing this into a client
 * component would put deployment configuration into a browser bundle.
 */

export const WORKSPACE_LAYER_FEATURE_CAP_ENV = "OPENPLAN_WORKSPACE_LAYER_FEATURE_CAP";

/**
 * The per-layer feature cap, or null for unlimited (the default).
 *
 * Anything that is not a positive integer is treated as UNSET, never as zero —
 * a malformed value must not become a cap of 0 that refuses every upload.
 */
export function resolveWorkspaceLayerFeatureCap(
  env: NodeJS.ProcessEnv = process.env
): number | null {
  const raw = env[WORKSPACE_LAYER_FEATURE_CAP_ENV]?.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/** The refusal when an upload holds more shapes than this deployment stores. */
export function workspaceLayerFeatureCapMessage(cap: number, featureCount: number): string {
  return (
    `This OpenPlan deployment stores at most ${cap.toLocaleString()} shapes in one map layer, and this file holds ` +
    `${featureCount.toLocaleString()}. Nothing was stored. Contact whoever operates this deployment to raise or remove the ` +
    `limit (${WORKSPACE_LAYER_FEATURE_CAP_ENV}), or upload an extract clipped to your study area — OpenPlan itself is free and has no usage tiers.`
  );
}
