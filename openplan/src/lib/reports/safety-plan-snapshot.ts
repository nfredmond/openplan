import { createHash } from "node:crypto";
import { z } from "zod";
import type { SafetyActionPlanSectionDraft } from "./safety-action-plan";
import { PROJECT_PLACE_SCOPE_COLUMNS } from "@/lib/projects/project-place";

export const SAFETY_PLAN_SNAPSHOT_VERSION = "openplan.safety-plan-snapshot.v1";
const text = z.string().min(1).max(20000);
const count = z.number().int().nonnegative();
const nullableMeasure = z.number().finite().nonnegative().nullable();
const figure = z.object({ label: text, value: nullableMeasure, absentBecause: text.nullable() }).strict()
  .refine((v) => v.value !== null || v.absentBecause !== null);
export const safetyPlanDraftSchema = z.object({
  title: text,
  crashSummary: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("present"), sourceLabel: text, years: text, figures: z.array(figure).min(1).max(50), caveats: z.array(text).max(100), sourceLine: text }).strict(),
    z.object({ kind: z.literal("absent"), reason: text }).strict(),
  ]),
  network: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("computed"), measureLabel: text, method: text, coverage: text, years: text, sourceLine: text,
      rows: z.array(z.object({ rank: count.positive(), tied: z.boolean(), segmentId: text, label: text, lengthMiles: nullableMeasure,
        crashCount: count, fatalCrashCount: count, seriousInjuryCrashCount: count.nullable(), crashesPerMile: nullableMeasure,
        countermeasureNames: z.array(text).max(10) }).strict()).max(5000) }).strict(),
    z.object({ kind: z.literal("unavailable"), reason: text }).strict(),
  ]),
  treatments: z.array(z.object({ segmentId: text, segmentLabel: text, rank: count.positive().nullable(),
    countermeasures: z.array(z.object({ name: text, addresses: text, crashTypes: z.array(text), sourceUrl: z.string().url(), cmfNote: text }).strict()).max(10),
  }).strict()).max(50),
  countermeasureSourceLine: text,
  components: z.array(z.object({ component: text, status: z.enum(["not_covered", "partial"]), gap: text }).strict()).min(1).max(30),
  componentSourceLine: text,
  draftNotice: text,
}).strict();

// Frozen v1 projection. New acquisition fields must never invalidate retained bytes.
export const SAFETY_SNAPSHOT_V1_ACQUISITION_PROJECTION = "id, project_id, min_lon, min_lat, max_lon, max_lat, status, source_id, source_label, attribution, severity_completeness, crash_count, geocoded_count, stored_count, truncated, years_requested, created_at, dimension_coverage, party_completeness, party_count, involvement_basis, published_through, published_through_provenance";
const acquisitionKeys = SAFETY_SNAPSHOT_V1_ACQUISITION_PROJECTION.split(", ");
const acquisition = z.record(z.string(), z.unknown()).refine((row) =>
  acquisitionKeys.every((key) => Object.hasOwn(row, key)) && Object.keys(row).length === acquisitionKeys.length &&
  typeof row.id === "string" && typeof row.project_id === "string" && row.status === "ready" &&
  typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at)), "Incomplete acquisition projection");
/**
 * The Safety sources a seed compares, frozen at generation. The project's
 * `updated_at` is an aggregate bundle revision that also moves when a funding
 * opportunity is logged or exported (KI-2026-11-02-022), so it cannot tell a
 * seed whether the Safety evidence changed. The acquisition's
 * `evidence_revision` moves with every write to the acquisition row and its
 * crash and party rows; the place hash moves with the project's place.
 * Optional so retained v1 bytes stay valid: a snapshot without it keeps the
 * aggregate project check.
 */
const evidenceFenceSchema = z.object({
  acquisitionEvidenceRevision: z.string().regex(/^[1-9]\d*$/),
  projectPlaceHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type SafetyPlanEvidenceFence = z.infer<typeof evidenceFenceSchema>;
const payloadSchema = z.object({
  version: z.literal(SAFETY_PLAN_SNAPSHOT_VERSION),
  artifactId: z.string().uuid(), reportId: z.string().uuid(), workspaceId: z.string().uuid(), projectId: z.string().uuid(),
  generatedAt: z.string().datetime({ offset: true }), reportUpdatedAt: z.string().datetime({ offset: true }),
  projectUpdatedAt: z.string().datetime({ offset: true }),
  acquisition,
  selection: z.object({ ingestId: z.string().uuid(), attachments: z.array(z.object({ segmentId: text, segmentLabel: text, countermeasureIds: z.array(text).min(1).max(10) }).strict()).max(50) }).strict(),
  draft: safetyPlanDraftSchema,
  evidenceFence: evidenceFenceSchema.optional(),
}).strict();
export type SafetyPlanSnapshotPayload = z.infer<typeof payloadSchema>;
export type SafetyPlanSnapshot = SafetyPlanSnapshotPayload & { hash: string };

/** Stable JSON binds PostgREST objects without depending on object key order. */
export function safetySeedHash(value: unknown): string {
  function stable(item: unknown): string {
    if (Array.isArray(item)) return `[${item.map(stable).join(",")}]`;
    if (item && typeof item === "object") return `{${Object.entries(item).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
    const encoded = JSON.stringify(item);
    if (encoded === undefined) throw new Error("Safety seed requires complete JSON values");
    return encoded;
  }
  return createHash("sha256").update(stable(value)).digest("hex");
}

/** Freeze the exact builder result. A failed or incomplete source never becomes a seed. */
export function buildSafetyPlanSnapshot(input: Omit<SafetyPlanSnapshotPayload, "version" | "draft"> & { draft: SafetyActionPlanSectionDraft }): SafetyPlanSnapshot {
  const { evidenceFence, ...rest } = input;
  const payload = payloadSchema.parse({ version: SAFETY_PLAN_SNAPSHOT_VERSION, ...rest, ...(evidenceFence ? { evidenceFence } : {}) });
  if (payload.acquisition.project_id !== payload.projectId || payload.selection.ingestId !== payload.acquisition.id) throw new Error("Safety acquisition belongs to another project");
  return { ...payload, hash: safetySeedHash(payload) };
}

const FENCE_PLACE_COLUMNS = PROJECT_PLACE_SCOPE_COLUMNS.split(", ");

/** Hash of the project's place columns (not the boundary bytes). Null when any column was not read. */
export function safetyProjectPlaceHash(project: Record<string, unknown>): string | null {
  if (FENCE_PLACE_COLUMNS.some((column) => !Object.hasOwn(project, column) || project[column] === undefined)) return null;
  return safetySeedHash(Object.fromEntries(FENCE_PLACE_COLUMNS.map((column) => [column, project[column]])));
}

/** PostgREST returns bigint as a JSON number, or as text when cast. Anything else is unread. */
export function readAcquisitionEvidenceRevision(value: unknown): string | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : null;
}

export const SAFETY_PLAN_FENCE_INGEST_SELECT = "id, evidence_revision";
type FenceQuery = { eq(column: string, value: string): FenceQuery; maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> };
export type SafetyPlanFenceClient = { from(table: "safety_crash_ingests"): { select(columns: string): FenceQuery } };

/**
 * Read the fence after the project row the snapshot cites. Any crash write
 * after that read moves the project revision, so the persistence RPC refuses
 * the generation and a fence recorded here cannot be older than the evidence.
 * A failed read records no fence; the seed then keeps the aggregate check.
 */
export async function readSafetyPlanEvidenceFence(client: SafetyPlanFenceClient, input: {
  workspaceId: string; projectId: string; ingestId: string; project: Record<string, unknown>;
}): Promise<SafetyPlanEvidenceFence | null> {
  const projectPlaceHash = safetyProjectPlaceHash(input.project);
  if (!projectPlaceHash) return null;
  try {
    const { data, error } = await client.from("safety_crash_ingests").select(SAFETY_PLAN_FENCE_INGEST_SELECT)
      .eq("workspace_id", input.workspaceId).eq("project_id", input.projectId).eq("id", input.ingestId).maybeSingle();
    const row = data as { id?: unknown; evidence_revision?: unknown } | null;
    const acquisitionEvidenceRevision = error || row?.id !== input.ingestId ? null : readAcquisitionEvidenceRevision(row.evidence_revision);
    return acquisitionEvidenceRevision ? { acquisitionEvidenceRevision, projectPlaceHash } : null;
  } catch {
    return null;
  }
}

/** Legacy/malformed artifacts must be regenerated. HTML is never a seed source. */
export function readSafetyPlanSnapshot(value: unknown): SafetyPlanSnapshot | null {
  const parsed = payloadSchema.extend({ hash: z.string().regex(/^[a-f0-9]{64}$/) }).safeParse(value);
  if (!parsed.success) return null;
  const { hash, ...payload } = parsed.data;
  if (payload.acquisition.project_id !== payload.projectId || payload.selection.ingestId !== payload.acquisition.id || safetySeedHash(payload) !== hash) return null;
  return { ...payload, hash };
}
