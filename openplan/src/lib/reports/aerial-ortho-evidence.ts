import type { VerifiedAerialOrthoLayer } from "@/lib/aerial/ortho-map-layers";

export const REPORT_AERIAL_ORTHO_SELECTIONS_VERSION = 1 as const;
export const REPORT_AERIAL_ORTHO_SNAPSHOT_SCHEMA = "openplan.report_aerial_ortho.v1" as const;
export const REPORT_AERIAL_ORTHO_BUCKET = "report-artifacts" as const;
export const REPORT_AERIAL_ORTHO_CAVEAT =
  "This orientation-only preview is derived from a held orthomosaic. It is not survey-grade, does not establish property boundaries or legal location, and must not replace review of the full-resolution source and its custody record.";

export type ReportAerialOrthoSelection = { custodyId: string };

export type FrozenReportAerialOrthoSnapshotV1 = {
  schemaVersion: typeof REPORT_AERIAL_ORTHO_SNAPSHOT_SCHEMA;
  reportId: string;
  artifactId: string;
  workspaceId: string;
  projectId: string;
  custodyId: string;
  missionId: string;
  missionTitle: string;
  projectName: string | null;
  sourceChecksumSha256: string;
  frozenChecksumSha256: string;
  byteSize: number;
  collectedAt: string | null;
  heldAt: string | null;
  frozenAt: string;
  bounds: [number, number, number, number];
  nativeCrs: string | null;
  pixelSizeM: number | null;
  storageBucket: typeof REPORT_AERIAL_ORTHO_BUCKET;
  storagePath: string;
  contentType: "image/png";
  caveat: typeof REPORT_AERIAL_ORTHO_CAVEAT;
};

export type FrozenReportAerialOrthoState =
  | { status: "absent"; reason: string }
  | { status: "invalid"; reason: string }
  | { status: "verified"; snapshots: FrozenReportAerialOrthoSnapshotV1[] };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validDateOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function validBounds(value: unknown): value is [number, number, number, number] {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) return false;
  const [west, south, east, north] = value as number[];
  return west >= -180 && east <= 180 && south >= -90 && north <= 90 && west < east && south < north;
}

export function readReportAerialOrthoSelections(metadata: unknown): ReportAerialOrthoSelection[] {
  const rows = record(metadata)?.aerialOrthoSelections;
  if (!Array.isArray(rows)) return [];
  const custodyIds = rows
    .map((value) => record(value)?.custodyId)
    .filter(validId);
  return [...new Set(custodyIds)].slice(0, 1).map((custodyId) => ({ custodyId }));
}

export function writeReportAerialOrthoSelections(
  metadata: unknown,
  selections: readonly ReportAerialOrthoSelection[],
): Record<string, unknown> {
  return {
    ...(record(metadata) ?? {}),
    aerialOrthoSelectionsVersion: REPORT_AERIAL_ORTHO_SELECTIONS_VERSION,
    aerialOrthoSelections: selections.slice(0, 1).map(({ custodyId }) => ({ custodyId })),
  };
}

export function reportAerialOrthoStoragePath(input: {
  workspaceId: string;
  reportId: string;
  artifactId: string;
  custodyId: string;
}): string {
  return `${input.workspaceId}/${input.reportId}/${input.artifactId}/aerial/${input.custodyId}.png`;
}

/** Authenticated in-app URL for the image frozen under one report artifact. */
export function reportAerialOrthoPreviewHref(input: {
  reportId: string;
  artifactId: string;
  custodyId: string;
}): string {
  return `/api/reports/${input.reportId}/artifacts/${input.artifactId}/aerial/${input.custodyId}`;
}

export function freezeReportAerialOrthoSnapshot(input: {
  layer: VerifiedAerialOrthoLayer;
  reportId: string;
  artifactId: string;
  workspaceId: string;
  projectId: string;
  frozenAt: string;
  frozenChecksumSha256: string;
}): FrozenReportAerialOrthoSnapshotV1 {
  return {
    schemaVersion: REPORT_AERIAL_ORTHO_SNAPSHOT_SCHEMA,
    reportId: input.reportId,
    artifactId: input.artifactId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    custodyId: input.layer.custodyId,
    missionId: input.layer.missionId,
    missionTitle: input.layer.missionTitle,
    projectName: input.layer.projectName,
    sourceChecksumSha256: input.layer.checksumSha256,
    frozenChecksumSha256: input.frozenChecksumSha256,
    byteSize: input.layer.byteSize,
    collectedAt: input.layer.collectedAt,
    heldAt: input.layer.heldAt,
    frozenAt: input.frozenAt,
    bounds: input.layer.bounds,
    nativeCrs: input.layer.nativeCrs,
    pixelSizeM: input.layer.pixelSizeM,
    storageBucket: REPORT_AERIAL_ORTHO_BUCKET,
    storagePath: reportAerialOrthoStoragePath({
      workspaceId: input.workspaceId,
      reportId: input.reportId,
      artifactId: input.artifactId,
      custodyId: input.layer.custodyId,
    }),
    contentType: "image/png",
    caveat: REPORT_AERIAL_ORTHO_CAVEAT,
  };
}

export function verifyFrozenReportAerialOrthoSnapshots(
  metadata: unknown,
  expected?: Partial<Pick<FrozenReportAerialOrthoSnapshotV1, "workspaceId" | "projectId" | "reportId" | "artifactId">>,
): FrozenReportAerialOrthoState {
  const rows = record(metadata)?.aerialOrthoSnapshotsV1;
  if (rows === undefined) return { status: "absent", reason: "This report packet contains no frozen aerial preview." };
  if (!Array.isArray(rows) || rows.length > 1) {
    return { status: "invalid", reason: "The frozen aerial preview list is malformed." };
  }
  if (rows.length === 0) return { status: "absent", reason: "This report packet contains no frozen aerial preview." };
  const row = record(rows[0]);
  if (!row) return { status: "invalid", reason: "The frozen aerial preview record is malformed." };

  const requiredIds = [row.reportId, row.artifactId, row.workspaceId, row.projectId, row.custodyId, row.missionId];
  if (!requiredIds.every(validId)) return { status: "invalid", reason: "The frozen aerial preview has an invalid identity." };
  if (
    (expected?.workspaceId && row.workspaceId !== expected.workspaceId) ||
    (expected?.projectId && row.projectId !== expected.projectId) ||
    (expected?.reportId && row.reportId !== expected.reportId) ||
    (expected?.artifactId && row.artifactId !== expected.artifactId)
  ) return { status: "invalid", reason: "The frozen aerial preview belongs to another packet, project, or workspace." };
  if (!validHash(row.sourceChecksumSha256) || !validHash(row.frozenChecksumSha256) || row.sourceChecksumSha256 !== row.frozenChecksumSha256) {
    return { status: "invalid", reason: "The frozen aerial preview hash does not preserve the held source bytes." };
  }
  if (typeof row.byteSize !== "number" || !Number.isInteger(row.byteSize) || row.byteSize < 1) {
    return { status: "invalid", reason: "The frozen aerial preview has no valid byte count." };
  }
  if (!validDateOrNull(row.collectedAt) || !validDateOrNull(row.heldAt) || !validDateOrNull(row.frozenAt) || row.collectedAt === null || row.heldAt === null || row.frozenAt === null) {
    return { status: "invalid", reason: "The frozen aerial preview dates are malformed." };
  }
  if (!validBounds(row.bounds)) return { status: "invalid", reason: "The frozen aerial preview has no valid map placement." };
  if (typeof row.pixelSizeM !== "number" || !Number.isFinite(row.pixelSizeM) || row.pixelSizeM <= 0) {
    return { status: "invalid", reason: "The frozen aerial preview resolution is malformed." };
  }
  if (row.storageBucket !== REPORT_AERIAL_ORTHO_BUCKET || row.contentType !== "image/png") {
    return { status: "invalid", reason: "The frozen aerial preview storage contract is invalid." };
  }
  const expectedPath = reportAerialOrthoStoragePath({
    workspaceId: row.workspaceId as string,
    reportId: row.reportId as string,
    artifactId: row.artifactId as string,
    custodyId: row.custodyId as string,
  });
  if (row.storagePath !== expectedPath || row.caveat !== REPORT_AERIAL_ORTHO_CAVEAT) {
    return { status: "invalid", reason: "The frozen aerial preview path or mandatory caveat was altered." };
  }
  if (typeof row.missionTitle !== "string" || !row.missionTitle.trim() || (row.projectName !== null && typeof row.projectName !== "string") || (row.nativeCrs !== null && typeof row.nativeCrs !== "string")) {
    return { status: "invalid", reason: "The frozen aerial preview labels are malformed." };
  }
  return { status: "verified", snapshots: [row as FrozenReportAerialOrthoSnapshotV1] };
}
