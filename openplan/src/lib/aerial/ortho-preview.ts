/**
 * The mission map's orthomosaic preview — what may be drawn, and every reason
 * it may not be.
 *
 * SERVER MODULE: it mints signed URLs with the service-role client, so client
 * components never import it; the mission page calls it and hands the result
 * down as props.
 *
 * WHAT IT LOADS. The one artifact kind a browser can consume directly:
 * `ortho_preview` (contract v1.1), a worker-produced PNG rendering of the
 * orthomosaic, held in OpenPlan's own custody like every other artifact. The
 * GeoTIFF orthomosaic itself stays download-only — Mapbox cannot draw a COG
 * without a tiler, and a tiler is another always-on operator service, which is
 * why tiling was deliberately deferred.
 *
 * EVERY ANSWER IS TYPED, AND ABSENT-IS-REFUSAL IS THE DESIGN. The external
 * worker (contract v1) reports no georeferencing, so the custody columns are
 * NULL and the map must say "held, but the worker did not report where it
 * sits" — never infer a position, never mount a broken layer, and never let a
 * failed read pose as "no preview exists".
 *
 * CREDENTIALS. The signed URL is minted per render with a short TTL (the same
 * 15 minutes as the artifact download route) and returned only so the map can
 * feed it to a Mapbox image source. It is never persisted and never logged.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AERIAL_ARTIFACT_BUCKET,
  AERIAL_ARTIFACT_CUSTODY_COLUMNS,
  AERIAL_ARTIFACT_CUSTODY_COLUMNS_WITHOUT_GEOREF,
  AERIAL_ORTHO_PREVIEW_KIND,
  georefBoundsFromCustodyRecord,
  isMissingCustodyGeorefColumnError,
  type AerialArtifactCustodyRecord,
} from "@/lib/aerial/artifact-custody";

/** Same TTL as the custody download route: a per-render link for an already-authorized reader. */
export const ORTHO_PREVIEW_SIGNED_URL_TTL_SECONDS = 15 * 60;

export type OrthoPreviewRefusalReason =
  | "no_preview_artifact"
  | "preview_not_held"
  | "no_georeference";

export type AerialOrthoPreview = {
  status: "ready";
  /** Short-lived signed URL for the held preview PNG. Never persist it. */
  url: string;
  /** WGS84 [west, south, east, north], validated before it reaches a layer. */
  bounds: [number, number, number, number];
  /** Native CRS of the source GeoTIFF, as provenance — the bounds are already WGS84. */
  crs: string | null;
  pixelSizeM: number | null;
  custodyId: string;
  heldAt: string | null;
};

export type AerialOrthoPreviewRefusal = {
  status: "refused";
  reason: OrthoPreviewRefusalReason;
  /** The sentence the map renders. Planner-voice, closed vocabulary, no URL. */
  detail: string;
};

export type AerialOrthoPreviewUnreadable = {
  status: "unreadable";
  /** The sentence the map renders. Planner-voice: what is off, and what to do. */
  detail: string;
  /**
   * The same failure in the operator's terms — a database message, a missing
   * key. Kept off the planner's line and rendered behind a disclosure, because
   * a planner can neither read nor act on it, and it is the only copy of the
   * fact an operator needs.
   */
  operatorDetail?: string;
};

export type AerialOrthoPreviewResult =
  | AerialOrthoPreview
  | AerialOrthoPreviewRefusal
  | AerialOrthoPreviewUnreadable;

const REFUSAL_DETAIL: Record<OrthoPreviewRefusalReason, string> = {
  no_preview_artifact:
    "No map-displayable preview exists for this mission. The processing worker did not report an ortho_preview artifact — the full orthomosaic, when one is held, remains available as a download from the processing jobs list.",
  preview_not_held:
    "A preview was reported for this mission, but its bytes are not in OpenPlan's custody, so there is nothing to draw. The processing jobs list shows what happened to it and whether a custody retry can still take it.",
  no_georeference:
    "An orthomosaic preview is held, but its georeferencing was not reported by the processing worker, so the map cannot place it. The preview and the full orthomosaic are still available as downloads from the processing jobs list.",
};

type QueryResult = { data: unknown[] | null; error: { message?: string; code?: string } | null };

/** The narrow read seam, so tests can prove the projection and the ordering. */
export type OrthoPreviewSupabaseLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        eq: (
          column: string,
          value: string
        ) => { order: (column: string, options: { ascending: boolean }) => PromiseLike<QueryResult> };
      };
    };
  };
};

/** The narrow signing seam — the only thing the service-role client is used for here. */
export type OrthoPreviewSignerLike = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        ttlSeconds: number
      ) => PromiseLike<{ data: { signedUrl: string } | null; error: { message?: string } | null }>;
    };
  };
};

/**
 * Load the newest held, georeferenced ortho_preview for a mission and mint its
 * signed URL — or say exactly which condition failed.
 *
 * READS WITH THE CALLER'S OWN CLIENT. The custody table's RLS member-SELECT
 * policy is the access control here, exactly as on the mission page's other
 * custody read; the service-role client is used ONLY to sign the storage URL,
 * after the row has already been read under the user's own authorization.
 */
export async function loadAerialOrthoPreview(input: {
  supabase: Pick<SupabaseClient, "from">;
  signer: Pick<SupabaseClient, "storage">;
  missionId: string;
}): Promise<AerialOrthoPreviewResult> {
  const supabase = input.supabase as unknown as OrthoPreviewSupabaseLike;
  const signer = input.signer as unknown as OrthoPreviewSignerLike;

  let result = await supabase
    .from("aerial_artifact_custody")
    .select(AERIAL_ARTIFACT_CUSTODY_COLUMNS)
    .eq("mission_id", input.missionId)
    .eq("kind", AERIAL_ORTHO_PREVIEW_KIND)
    .order("created_at", { ascending: false });

  // Deploy-window degrade (database predates 20260811000003): the ledger can
  // still answer whether a preview exists; placement reads back as undefined,
  // which lands on the honest no_georeference refusal below.
  if (isMissingCustodyGeorefColumnError(result.error)) {
    result = await supabase
      .from("aerial_artifact_custody")
      .select(AERIAL_ARTIFACT_CUSTODY_COLUMNS_WITHOUT_GEOREF)
      .eq("mission_id", input.missionId)
      .eq("kind", AERIAL_ORTHO_PREVIEW_KIND)
      .order("created_at", { ascending: false });
  }

  if (result.error) {
    // A FAILED READ IS NOT A MISSING PREVIEW. "No preview" tells a planner to
    // go re-process a flight whose preview may be sitting right there.
    return {
      status: "unreadable",
      detail:
        "Whether this mission has a map-displayable preview could not be established, because the custody read failed. This is not a finding that no preview exists.",
      operatorDetail: `The custody read failed: ${result.error.message ?? "unknown database error"}`,
    };
  }

  const records = (result.data ?? []) as Array<
    Partial<AerialArtifactCustodyRecord> & { created_at?: string }
  >;

  if (records.length === 0) {
    return { status: "refused", reason: "no_preview_artifact", detail: REFUSAL_DETAIL.no_preview_artifact };
  }

  const held = records.filter((record) => record.state === "held");
  if (held.length === 0) {
    return { status: "refused", reason: "preview_not_held", detail: REFUSAL_DETAIL.preview_not_held };
  }

  // Newest held preview whose bounds pass validation. The row is untrusted
  // input to a map layer: a rectangle that could not have come from a single
  // flight must not mount however it got stored, so the same validator that
  // gated the callback gates the read.
  const placeable = held
    .map((record) => ({
      record,
      bounds: georefBoundsFromCustodyRecord({
        bounds_west: record.bounds_west ?? null,
        bounds_south: record.bounds_south ?? null,
        bounds_east: record.bounds_east ?? null,
        bounds_north: record.bounds_north ?? null,
      }),
    }))
    .find((entry) => entry.bounds !== null);

  if (!placeable || !placeable.bounds) {
    return { status: "refused", reason: "no_georeference", detail: REFUSAL_DETAIL.no_georeference };
  }

  const record = placeable.record;
  const storagePath = typeof record.storage_path === "string" ? record.storage_path : "";
  if (record.storage_bucket !== AERIAL_ARTIFACT_BUCKET || !storagePath || storagePath.includes("..")) {
    // A held row whose object reference this module will not sign for. Same
    // refusal shape as the download route: never dereference a forged path.
    return {
      status: "unreadable",
      detail:
        "A held preview row exists but its storage reference is not one OpenPlan will sign for, so the map cannot draw it. The processing jobs list still shows the artifact's custody record.",
    };
  }

  const { data: signed, error: signError } = await signer.storage
    .from(AERIAL_ARTIFACT_BUCKET)
    .createSignedUrl(storagePath, ORTHO_PREVIEW_SIGNED_URL_TTL_SECONDS);

  if (signError || !signed?.signedUrl) {
    return {
      status: "unreadable",
      detail:
        "The preview is held and placeable, but a display link could not be minted. Reload to try again — the bytes themselves are safe in custody.",
      operatorDetail: `Signing the storage object failed: ${signError?.message ?? "no signed URL was returned"}`,
    };
  }

  return {
    status: "ready",
    url: signed.signedUrl,
    bounds: placeable.bounds,
    crs: record.crs ?? null,
    pixelSizeM: record.pixel_size_m ?? null,
    custodyId: record.id ?? "",
    heldAt: record.held_at ?? null,
  };
}
