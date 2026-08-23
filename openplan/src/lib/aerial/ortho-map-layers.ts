import {
  AERIAL_ARTIFACT_BUCKET,
  AERIAL_ORTHO_PREVIEW_KIND,
  georefBoundsFromCustodyRecord,
} from "@/lib/aerial/artifact-custody";

/**
 * A held orthomosaic preview that may be offered on authenticated workspace maps.
 *
 * This is an aerial-custody record, not a workspace GIS upload. The image stays
 * in the aerial artifact bucket and every map reads the same custody facts. No
 * place, jurisdiction, or country-specific field belongs in this contract.
 */
export type VerifiedAerialOrthoLayer = {
  custodyId: string;
  missionId: string;
  projectId: string | null;
  missionTitle: string;
  projectName: string | null;
  collectedAt: string | null;
  heldAt: string | null;
  checksumSha256: string;
  byteSize: number;
  bounds: [number, number, number, number];
  nativeCrs: string | null;
  pixelSizeM: number | null;
};

export type AerialOrthoCatalogState = "absent" | "unavailable" | "verified" | "unreadable";

export type AerialOrthoCatalog = {
  state: AerialOrthoCatalogState;
  layers: VerifiedAerialOrthoLayer[];
  notes: string[];
};

export type ResolvedAerialOrthoLayer = VerifiedAerialOrthoLayer & {
  url: string;
  expiresAt: string;
};

export type AerialOrthoCatalogRow = {
  id?: unknown;
  workspace_id?: unknown;
  mission_id?: unknown;
  kind?: unknown;
  state?: unknown;
  storage_bucket?: unknown;
  storage_path?: unknown;
  byte_size?: unknown;
  checksum_sha256?: unknown;
  content_type?: unknown;
  held_at?: unknown;
  created_at?: unknown;
  bounds_west?: unknown;
  bounds_south?: unknown;
  bounds_east?: unknown;
  bounds_north?: unknown;
  crs?: unknown;
  pixel_size_m?: unknown;
  aerial_missions?: unknown;
};

type MissionRow = {
  id?: unknown;
  workspace_id?: unknown;
  project_id?: unknown;
  title?: unknown;
  collected_at?: unknown;
  projects?: unknown;
};

function record(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return record(value[0]);
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp(value: unknown): number {
  const parsed = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export type VerifyAerialOrthoRowResult =
  | { state: "verified"; layer: VerifiedAerialOrthoLayer; storagePath: string }
  | { state: "unavailable"; reason: string };

/**
 * Verify one custody row before its metadata or storage path reaches a map.
 *
 * The database proves that held rows have a checksum and byte count, but this
 * function repeats the checks at the read boundary. A forged bucket/path,
 * cross-workspace mission, missing checksum, or implausible rectangle remains
 * unavailable even if a caller selected the row directly by id.
 */
export function verifyAerialOrthoCatalogRow(
  row: AerialOrthoCatalogRow,
  workspaceId: string,
): VerifyAerialOrthoRowResult {
  const mission = record(row.aerial_missions) as MissionRow | null;
  const project = record(mission?.projects);
  const custodyId = text(row.id);
  const missionId = text(row.mission_id);
  const missionWorkspaceId = text(mission?.workspace_id);
  const custodyWorkspaceId = text(row.workspace_id);
  const checksumSha256 = text(row.checksum_sha256);
  const storagePath = text(row.storage_path);
  const byteSize = finite(row.byte_size);

  if (!custodyId || !missionId || text(mission?.id) !== missionId) {
    return { state: "unavailable", reason: "The preview does not resolve to one mission." };
  }
  if (custodyWorkspaceId !== workspaceId || missionWorkspaceId !== workspaceId) {
    return { state: "unavailable", reason: "The preview and mission do not belong to this workspace." };
  }
  if (row.kind !== AERIAL_ORTHO_PREVIEW_KIND || row.state !== "held") {
    return { state: "unavailable", reason: "The preview is not a held orthophoto preview." };
  }
  if (
    row.storage_bucket !== AERIAL_ARTIFACT_BUCKET ||
    !storagePath ||
    storagePath.includes("..") ||
    !storagePath.startsWith(`${workspaceId}/${missionId}/`)
  ) {
    return { state: "unavailable", reason: "The preview storage reference is not safe to sign." };
  }
  if (!checksumSha256 || !/^[0-9a-f]{64}$/.test(checksumSha256) || byteSize === null || byteSize < 1) {
    return { state: "unavailable", reason: "The preview has no complete custody proof." };
  }
  if (row.content_type !== "image/png") {
    return { state: "unavailable", reason: "The held preview is not a browser-displayable PNG." };
  }

  const bounds = georefBoundsFromCustodyRecord({
    bounds_west: finite(row.bounds_west),
    bounds_south: finite(row.bounds_south),
    bounds_east: finite(row.bounds_east),
    bounds_north: finite(row.bounds_north),
  });
  if (!bounds) {
    return { state: "unavailable", reason: "The worker did not report a usable map position." };
  }

  return {
    state: "verified",
    storagePath,
    layer: {
      custodyId,
      missionId,
      projectId: text(mission?.project_id),
      missionTitle: text(mission?.title) ?? "Untitled aerial mission",
      projectName: text(project?.name),
      collectedAt: text(mission?.collected_at),
      heldAt: text(row.held_at),
      checksumSha256,
      byteSize,
      bounds,
      nativeCrs: text(row.crs),
      pixelSizeM: finite(row.pixel_size_m),
    },
  };
}

/** Newest verified preview per mission, with exclusions counted rather than hidden. */
export function buildAerialOrthoCatalog(
  rows: AerialOrthoCatalogRow[],
  workspaceId: string,
): AerialOrthoCatalog {
  if (rows.length === 0) {
    return {
      state: "absent",
      layers: [],
      notes: ["No processed aerial preview is recorded for this workspace."],
    };
  }

  const sorted = [...rows].sort(
    (left, right) =>
      Math.max(timestamp(right.held_at), timestamp(right.created_at)) -
      Math.max(timestamp(left.held_at), timestamp(left.created_at)),
  );
  const seenMissions = new Set<string>();
  const layers: VerifiedAerialOrthoLayer[] = [];
  let unavailableCount = 0;

  for (const row of sorted) {
    const missionId = text(row.mission_id);
    if (!missionId || seenMissions.has(missionId)) continue;
    const verified = verifyAerialOrthoCatalogRow(row, workspaceId);
    if (verified.state === "verified") {
      seenMissions.add(missionId);
      layers.push(verified.layer);
    } else {
      unavailableCount += 1;
    }
  }

  const notes = [
    "These are browser previews for orientation. Measure against the full orthomosaic in GIS.",
  ];
  if (unavailableCount > 0) {
    notes.push(
      `${unavailableCount.toLocaleString()} preview ${unavailableCount === 1 ? "record is" : "records are"} not offered because custody or map placement could not be verified.`,
    );
  }

  return {
    state: layers.length > 0 ? "verified" : "unavailable",
    layers,
    notes,
  };
}
