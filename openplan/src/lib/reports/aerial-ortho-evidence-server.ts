import { createHash } from "node:crypto";
import {
  AERIAL_ARTIFACT_BUCKET,
  AERIAL_ARTIFACT_CUSTODY_COLUMNS,
} from "@/lib/aerial/artifact-custody";
import {
  buildAerialOrthoCatalog,
  verifyAerialOrthoCatalogRow,
  type AerialOrthoCatalog,
  type AerialOrthoCatalogRow,
} from "@/lib/aerial/ortho-map-layers";
import {
  freezeReportAerialOrthoSnapshot,
  REPORT_AERIAL_ORTHO_BUCKET,
  type FrozenReportAerialOrthoSnapshotV1,
} from "@/lib/reports/aerial-ortho-evidence";
export { readReportAerialOrthoSelections } from "@/lib/reports/aerial-ortho-evidence";

export const REPORT_AERIAL_ORTHO_CUSTODY_SELECT =
  `${AERIAL_ARTIFACT_CUSTODY_COLUMNS}, workspace_id, mission_id, created_at, aerial_missions!inner(id, workspace_id, project_id, title, collected_at, projects(name))`;

type QueryResult<T> = Promise<{ data: T | null; error: { message: string; code?: string } | null }>;
type Query<T> = {
  eq(column: string, value: unknown): Query<T>;
  order(column: string, options: { ascending: boolean }): Query<T>;
  limit(count: number): Query<T>;
  maybeSingle(): QueryResult<T>;
  then<TResult1 = { data: T | null; error: { message: string; code?: string } | null }>(
    onfulfilled?: ((value: { data: T | null; error: { message: string; code?: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
  ): Promise<TResult1>;
};

export type AerialOrthoEvidenceSupabaseLike = {
  from(table: string): { select(columns: string): Query<unknown> };
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
      upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): Promise<{ error: { message: string } | null }>;
    };
  };
};

export async function loadReportAerialOrthoCatalog(input: {
  supabase: unknown;
  workspaceId: string;
  projectId: string;
}): Promise<AerialOrthoCatalog> {
  const client = input.supabase as AerialOrthoEvidenceSupabaseLike;
  const result = await client
    .from("aerial_artifact_custody")
    .select(REPORT_AERIAL_ORTHO_CUSTODY_SELECT)
    .eq("workspace_id", input.workspaceId)
    .eq("kind", "ortho_preview")
    .eq("aerial_missions.project_id", input.projectId)
    .order("held_at", { ascending: false })
    .limit(100);
  if (result.error) {
    return { state: "unreadable", layers: [], notes: ["Held aerial previews could not be read."] };
  }
  const catalog = buildAerialOrthoCatalog((result.data ?? []) as AerialOrthoCatalogRow[], input.workspaceId);
  const layers = catalog.layers.filter((layer) => layer.projectId === input.projectId);
  return layers.length > 0
    ? { ...catalog, state: "verified", layers }
    : { state: catalog.state === "absent" ? "absent" : "unavailable", layers: [], notes: catalog.notes };
}

export async function verifySelectedReportAerialOrtho(input: {
  supabase: unknown;
  workspaceId: string;
  projectId: string;
  custodyId: string;
}): Promise<
  | { status: "verified"; row: AerialOrthoCatalogRow; layer: ReturnType<typeof verifyAerialOrthoCatalogRow> & { state: "verified" } }
  | { status: "absent" | "unreadable" | "invalid"; reason: string }
> {
  const client = input.supabase as AerialOrthoEvidenceSupabaseLike;
  const result = await client
    .from("aerial_artifact_custody")
    .select(REPORT_AERIAL_ORTHO_CUSTODY_SELECT)
    .eq("id", input.custodyId)
    .eq("workspace_id", input.workspaceId)
    .maybeSingle();
  if (result.error) return { status: "unreadable", reason: "The selected held aerial preview could not be read." };
  if (!result.data) return { status: "absent", reason: "The selected held aerial preview no longer exists." };
  const row = result.data as AerialOrthoCatalogRow;
  const verified = verifyAerialOrthoCatalogRow(row, input.workspaceId);
  if (verified.state !== "verified") return { status: "invalid", reason: verified.reason };
  if (verified.layer.projectId !== input.projectId) {
    return { status: "invalid", reason: "The selected held aerial preview belongs to another project." };
  }
  if (!verified.layer.collectedAt || !verified.layer.heldAt) {
    return { status: "invalid", reason: "The selected held aerial preview is missing its capture or custody date." };
  }
  if (verified.layer.pixelSizeM === null || verified.layer.pixelSizeM <= 0) {
    return { status: "invalid", reason: "The selected held aerial preview is missing a valid ground resolution." };
  }
  return { status: "verified", row, layer: verified };
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

export async function freezeSelectedReportAerialOrtho(input: {
  supabase: unknown;
  serviceSupabase: unknown;
  workspaceId: string;
  projectId: string;
  reportId: string;
  artifactId: string;
  custodyId: string;
  frozenAt: string;
}): Promise<
  | { status: "verified"; snapshot: FrozenReportAerialOrthoSnapshotV1; bytes: Uint8Array }
  | { status: "absent" | "unreadable" | "invalid"; reason: string }
> {
  const selected = await verifySelectedReportAerialOrtho(input);
  if (selected.status !== "verified") return selected;
  const service = input.serviceSupabase as AerialOrthoEvidenceSupabaseLike;
  const source = await service.storage.from(AERIAL_ARTIFACT_BUCKET).download(selected.layer.storagePath);
  if (source.error || !source.data) return { status: "unreadable", reason: "The selected held aerial preview bytes could not be read." };
  const bytes = new Uint8Array(await source.data.arrayBuffer());
  if (bytes.byteLength !== selected.layer.layer.byteSize) {
    return { status: "invalid", reason: "The selected preview byte count no longer matches its custody record." };
  }
  if (!isPng(bytes)) return { status: "invalid", reason: "The selected preview bytes are not a PNG image." };
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== selected.layer.layer.checksumSha256) {
    return { status: "invalid", reason: "The selected preview bytes no longer match their custody hash." };
  }
  const snapshot = freezeReportAerialOrthoSnapshot({
    layer: selected.layer.layer,
    reportId: input.reportId,
    artifactId: input.artifactId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
    frozenAt: input.frozenAt,
    frozenChecksumSha256: checksum,
  });
  const upload = await service.storage.from(REPORT_AERIAL_ORTHO_BUCKET).upload(
    snapshot.storagePath,
    bytes,
    { contentType: snapshot.contentType, upsert: false },
  );
  if (upload.error) return { status: "unreadable", reason: "The selected preview could not be frozen into the report packet." };
  return { status: "verified", snapshot, bytes };
}
