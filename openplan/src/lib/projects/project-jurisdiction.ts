import { z } from "zod";
import { placeKindSchema, type PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import { projectPlaceFromPlaceBoundary } from "./project-place";

const label = z.string().trim().min(1).max(200);
const countryCode = z.string().regex(/^[A-Z]{2}$/).nullable();
const subdivisionCode = z.string().regex(/^[A-Z0-9-]{1,16}$/).nullable();
const reference = z.string().regex(/^[a-z][a-z0-9._-]*:[^\s]{1,180}$/).nullable();
const descriptorFields = {
  label,
  countryCode,
  subdivisionCode,
  kind: z.string().trim().min(1).max(80),
  reference,
  scope: z.enum(["administrative", "sovereign", "overlap", "other"]),
};
export const jurisdictionDescriptorSchema = z.object({
  ...descriptorFields,
  identity: z.enum(["staff_declared", "server_resolved"]),
}).strict().superRefine((entry, ctx) => {
  if (entry.identity === "server_resolved") {
    const matched = /^tigerweb:([^:]+):(\d{5,7})$/.exec(entry.reference ?? "");
    const kind = placeKindSchema.safeParse(matched?.[1]);
    if (!matched || !kind.success || entry.kind !== `tigerweb:${kind.data}` || entry.scope !== "administrative") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Resolved identity does not match the recorded source reference." });
    }
  }
});
export const jurisdictionEntryInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("staff"), ...descriptorFields }).strict(),
  z.object({ mode: z.literal("resolved"), kind: placeKindSchema, geoid: z.string().regex(/^\d{5,7}$/) }).strict(),
]);
export const projectJurisdictionInputSchema = z.discriminatedUnion("state", [
  z.object({ version: z.literal(1), state: z.literal("unresolved"), entries: z.array(jurisdictionEntryInputSchema).max(0) }).strict(),
  z.object({ version: z.literal(1), state: z.literal("declared"), entries: z.array(jurisdictionEntryInputSchema).min(1).max(12) }).strict(),
]);
export const projectJurisdictionSchema = z.object({
  version: z.literal(1),
  state: z.enum(["unresolved", "declared"]),
  entries: z.array(jurisdictionDescriptorSchema).max(12),
  recordedBy: z.string().uuid(),
  recordedAt: z.string().datetime({ offset: true }),
}).strict().refine(value => value.state === "declared" ? value.entries.length > 0 : value.entries.length === 0);
export type ProjectJurisdiction = z.infer<typeof projectJurisdictionSchema>;
export type JurisdictionEntryInput = z.infer<typeof jurisdictionEntryInputSchema>;
export type ProjectJurisdictionRow = {
  id?: string;
  updated_at?: string | null;
  jurisdiction_context?: unknown;
  place_label?: string | null;
  place_country_code?: string | null;
  place_subdivision_code?: string | null;
};
export const PROJECT_JURISDICTION_COLUMNS = "id, updated_at, jurisdiction_context, place_label, place_country_code, place_subdivision_code";
export class ProjectJurisdictionError extends Error {}

/** Missing projection is an error. Only an explicit database null permits legacy fallback. */
export function readProjectJurisdiction(row: ProjectJurisdictionRow) {
  if (!("jurisdiction_context" in row)) throw new ProjectJurisdictionError("Project jurisdiction was not read.");
  if (row.jurisdiction_context === null) return null;
  const parsed = projectJurisdictionSchema.safeParse(row.jurisdiction_context);
  if (!parsed.success) throw new ProjectJurisdictionError("Saved project jurisdiction is invalid.");
  return parsed.data;
}

/** Resolve identity through the existing adapter; geometry never enters the declaration. */
export async function resolveProjectJurisdiction(
  input: z.infer<typeof projectJurisdictionInputSchema>,
  actorId: string,
  resolve: (kind: z.infer<typeof placeKindSchema>, geoid: string) => Promise<PlaceBoundaryResponse | null>,
): Promise<ProjectJurisdiction> {
  const entries: ProjectJurisdiction["entries"] = [];
  for (const entry of input.entries) {
    if (entry.mode === "staff") {
      const { mode: _mode, ...fields } = entry;
      entries.push({ ...fields, identity: "staff_declared" });
    } else {
      const boundary = await resolve(entry.kind, entry.geoid);
      const resolvedLabel = boundary?.label?.trim();
      if (!boundary || !resolvedLabel || boundary.kind !== entry.kind || boundary.geoid !== entry.geoid) {
        throw new ProjectJurisdictionError("That identity could not be resolved. Keep your draft and retry the search.");
      }
      const place = projectPlaceFromPlaceBoundary(boundary);
      entries.push({ label: resolvedLabel, countryCode: place.place_country_code,
        subdivisionCode: place.place_subdivision_code, kind: `tigerweb:${boundary.kind}`,
        reference: `tigerweb:${boundary.kind}:${boundary.geoid}`, scope: "administrative", identity: "server_resolved" });
    }
  }
  return projectJurisdictionSchema.parse({ ...input, entries, recordedBy: actorId, recordedAt: new Date().toISOString() });
}

export function jurisdictionDraft(context: ProjectJurisdiction | null): JurisdictionEntryInput[] {
  return context?.entries.map(({ identity, ...fields }): JurisdictionEntryInput => {
    const matched = /^tigerweb:([^:]+):(\d{5,7})$/.exec(fields.reference ?? "");
    const kind = placeKindSchema.safeParse(matched?.[1]);
    if (identity === "server_resolved" && matched && kind.success) return { mode: "resolved", kind: kind.data, geoid: matched[2] };
    return { mode: "staff", ...fields };
  }) ?? [];
}
