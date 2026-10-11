import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { MAP_PACKAGE_DELIVERABLES } from "./catalog";
import { MAP_PACKAGE_SKILL } from "./skill";

/** The longest brief the database accepts, in bytes of canonical JSON. */
const MAP_PACKAGE_BRIEF_MAX_BYTES = 2_000_000;
export const MAP_PACKAGE_REQUEST_MAX_CHARS = 4000;

const position = z.array(z.number().finite()).min(2).max(3);
const geometrySchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Point"), coordinates: position }).strict(),
  z.object({ type: z.literal("LineString"), coordinates: z.array(position).min(2) }).strict(),
  z.object({ type: z.literal("MultiLineString"), coordinates: z.array(z.array(position).min(2)).min(1) }).strict(),
  z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(position).min(4)).min(1) }).strict(),
  z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(z.array(z.array(position).min(4)).min(1)).min(1) }).strict(),
]);
const featureSchema = z.object({
  type: z.literal("Feature"),
  properties: z.object({
    role: z.enum(["place_boundary", "corridor", "site"]),
    name: z.string().max(300).nullable(),
  }).strict(),
  geometry: geometrySchema,
}).strict();

export const mapPackageBriefSchema = z.object({
  version: z.literal(1),
  kind: z.literal("openplan.map_package_brief"),
  workspaceId: z.string().uuid(),
  project: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(1000),
    summary: z.string().max(8000).nullable(),
    status: z.string().max(120).nullable(),
    planType: z.string().max(120).nullable(),
    deliveryPhase: z.string().max(120).nullable(),
  }).strict(),
  client: z.string().trim().min(1).max(200),
  deliverable: z.enum(MAP_PACKAGE_DELIVERABLES),
  fundingOpportunity: z.object({
    id: z.string().uuid(),
    title: z.string().min(1).max(1000),
    agencyName: z.string().max(500).nullable(),
    programId: z.string().max(200).nullable(),
    closesAt: z.string().max(40).nullable(),
  }).strict().nullable(),
  place: z.object({
    label: z.string().max(300).nullable(),
    kind: z.string().max(60).nullable(),
    countryCode: z.string().max(8).nullable(),
    subdivisionCode: z.string().max(16).nullable(),
    bbox: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]).nullable(),
  }).strict().nullable(),
  studyArea: z.object({ type: z.literal("FeatureCollection"), features: z.array(featureSchema).max(200) }).strict(),
  placeBoundary: z.enum(["included", "too_large", "none_recorded"]),
  request: z.string().max(MAP_PACKAGE_REQUEST_MAX_CHARS),
  practice: z.boolean(),
  skill: z.object({ name: z.literal(MAP_PACKAGE_SKILL.name), treeHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  capturedAt: z.string().datetime({ offset: true }),
}).strict();
export type MapPackageBrief = z.infer<typeof mapPackageBriefSchema>;
export type MapPackageFeature = z.infer<typeof featureSchema>;

export function canonicalMapPackageBrief(brief: MapPackageBrief): { canonical: string; hash: string } {
  const canonical = canonicalizeActionPayload(mapPackageBriefSchema.parse(brief));
  if (Buffer.byteLength(canonical, "utf8") > MAP_PACKAGE_BRIEF_MAX_BYTES) throw new Error("map_package_brief_too_large");
  return { canonical, hash: createHash("sha256").update(canonical, "utf8").digest("hex") };
}

/** Files a run may deliver. The ZIP is the package; previews and the report are for reading in the app. */
const MAP_PACKAGE_FILE_ROLES = ["package_zip", "figure_preview", "run_report"] as const;
export type MapPackageFileRole = (typeof MAP_PACKAGE_FILE_ROLES)[number];
export const MAP_PACKAGE_FILE_LIMITS: Record<MapPackageFileRole, { maxCount: number; maxBytes: number; contentType: string; extension: string }> = {
  package_zip: { maxCount: 1, maxBytes: 1024 * 1024 * 1024, contentType: "application/zip", extension: ".zip" },
  figure_preview: { maxCount: 60, maxBytes: 25 * 1024 * 1024, contentType: "image/png", extension: ".png" },
  run_report: { maxCount: 1, maxBytes: 1024 * 1024, contentType: "text/markdown", extension: ".md" },
};

/** The ZIP ceiling for this deployment: OPENPLAN_MAP_PACKAGE_MAX_BYTES, never above the role limit. */
export function mapPackageZipMaxBytes(env: Record<string, string | undefined> = process.env): number {
  const ceiling = MAP_PACKAGE_FILE_LIMITS.package_zip.maxBytes;
  const raw = env.OPENPLAN_MAP_PACKAGE_MAX_BYTES?.trim();
  if (!raw) return ceiling;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, ceiling) : ceiling;
}

export const mapPackageFileDeclarationSchema = z.object({
  role: z.enum(MAP_PACKAGE_FILE_ROLES),
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type MapPackageFileDeclaration = z.infer<typeof mapPackageFileDeclarationSchema>;

/** Refuse a file list the bucket or the page could not hold, before any URL is issued. */
export function checkedMapPackageFiles(files: MapPackageFileDeclaration[], zipMaxBytes = mapPackageZipMaxBytes()): MapPackageFileDeclaration[] {
  const parsed = z.array(mapPackageFileDeclarationSchema).min(1).max(62).parse(files);
  const names = new Set<string>();
  for (const role of MAP_PACKAGE_FILE_ROLES) {
    const limit = MAP_PACKAGE_FILE_LIMITS[role];
    const ofRole = parsed.filter((file) => file.role === role);
    if (ofRole.length > limit.maxCount) throw new Error("map_package_files_invalid");
    for (const file of ofRole) {
      const maxBytes = role === "package_zip" ? zipMaxBytes : limit.maxBytes;
      if (file.bytes > maxBytes || !file.name.toLowerCase().endsWith(limit.extension)) throw new Error("map_package_files_invalid");
    }
  }
  if (parsed.filter((file) => file.role === "package_zip").length !== 1) throw new Error("map_package_files_invalid");
  for (const file of parsed) {
    if (names.has(file.name)) throw new Error("map_package_files_invalid");
    names.add(file.name);
  }
  return parsed;
}

const mapPackageFigureSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  figure: z.string().max(80).nullable(),
  title: z.string().max(300),
  alt: z.string().max(1000).nullable(),
  preview: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/).nullable(),
}).strict();

/** What the connector reports about one finished run. The server re-hashes every stored file. */
export const mapPackageReceiptSchema = z.object({
  schemaVersion: z.literal(1),
  provider: z.literal("claude"),
  authMode: z.literal("claude_subscription"),
  model: z.string().min(1).max(160),
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
  modelsUsed: z.array(z.string().min(1).max(160)).min(1).max(10),
  cliVersion: z.string().min(1).max(80),
  skillTreeHash: z.string().regex(/^[a-f0-9]{64}$/),
  kitChanged: z.boolean(),
  sessionId: z.string().min(1).max(160).nullable(),
  durationMs: z.number().int().nonnegative(),
  numTurns: z.number().int().nonnegative().nullable(),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheReadInputTokens: z.number().int().nonnegative(),
    cacheCreationInputTokens: z.number().int().nonnegative(),
  }).strict().nullable(),
  packageName: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/),
  qa: z.object({
    checks: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    notes: z.number().int().nonnegative(),
  }).strict().nullable(),
  gates: z.record(z.string().regex(/^[a-z_]{1,40}$/), z.string().max(40)).nullable(),
  figures: z.array(mapPackageFigureSchema).max(200),
}).strict();

export const mapPackageProgressSchema = z.object({
  phase: z.enum(["starting", "working", "uploading"]),
  message: z.string().max(300),
  steps: z.number().int().nonnegative(),
  recent: z.array(z.string().max(200)).max(20),
}).strict();
