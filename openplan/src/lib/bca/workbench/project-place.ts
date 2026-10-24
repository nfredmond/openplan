import { z } from "zod";
import {
  DRAWN_PLACE_SOURCE, UPLOADED_PLACE_SOURCE, placeHasResolvableIdentity,
  placeIdentityOnly,
} from "@/lib/geographies/place-of-record";
import {
  PROJECT_PLACE_SCOPE_COLUMNS, placeOfRecordFromProject, projectPlaceReference,
  type ProjectPlaceRow,
} from "@/lib/projects/project-place";
import { projectJurisdictionSchema, readProjectJurisdiction } from "@/lib/projects/project-jurisdiction";
import { TIGERWEB_GEOGRAPHY_SOURCE } from "@/lib/workspaces/home-geography";
import { canonicalBcaJson } from "./canonical";

const recordedText = z.string().min(1).max(4000).refine(value => value.trim().length > 0);
const timestamp = z.string().datetime({ offset: true });
const bcaJurisdictionSchema = z.unknown().transform((value, ctx) => {
  const parsed = projectJurisdictionSchema.safeParse(value);
  if (!parsed.success || canonicalBcaJson(parsed.data) !== canonicalBcaJson(value)) {
    ctx.addIssue({ code: "custom", message: "BCA jurisdiction must already match the strict project reader without normalization." });
    return z.NEVER;
  }
  return parsed.data;
});
function placeStatus(source: string | null): "missing" | "drawn" | "uploaded" | "recorded" {
  if (source === null) return "missing";
  if (source === DRAWN_PLACE_SOURCE) return "drawn";
  if (source === UPLOADED_PLACE_SOURCE) return "uploaded";
  return "recorded";
}
const placeSchema = z.object({
  source: recordedText.nullable(), kind: recordedText.nullable(), ref: recordedText.nullable(),
  label: recordedText.nullable(), countryCode: z.string().regex(/^[A-Z]{2}$/).nullable(),
  subdivisionCode: recordedText.nullable(),
  bbox: z.object({ minLon: z.number().min(-180).max(180), minLat: z.number().min(-90).max(90),
    maxLon: z.number().min(-180).max(180), maxLat: z.number().min(-90).max(90) }).strict()
    .refine(box => box.minLat <= box.maxLat).nullable(),
  // Identity/context snapshot only. Boundary bytes remain with the project.
  geometry: z.null(),
}).strict();

export const bcaProjectPlaceSchema = z.object({
  projectId: z.string().uuid(),
  projectUpdatedAt: timestamp,
  placeSetAt: timestamp.nullable(),
  status: z.enum(["recorded", "missing", "drawn", "uploaded"]),
  place: placeSchema,
  jurisdiction: bcaJurisdictionSchema.nullable(),
}).strict().superRefine((snapshot, ctx) => {
  const place = snapshot.place;
  const unresolved = place.source === DRAWN_PLACE_SOURCE || place.source === UPLOADED_PLACE_SOURCE;
  const expected = placeStatus(place.source);
  const invalidMissing = expected === "missing" && (snapshot.placeSetAt !== null || Object.values(place).some(value => value !== null));
  const invalidArea = expected !== "missing" && (snapshot.placeSetAt === null || place.bbox === null);
  const invalidIdentity = unresolved
    ? [place.kind, place.ref, place.countryCode, place.subdivisionCode].some(value => value !== null)
    : expected === "recorded" && (!place.kind || !placeHasResolvableIdentity(place));
  if (snapshot.status !== expected || invalidMissing || invalidArea || invalidIdentity) {
    ctx.addIssue({ code: "custom", message: "Project place source, identity and status disagree." });
  }
  if (place.source === TIGERWEB_GEOGRAPHY_SOURCE && !projectPlaceReference({
    place_source: place.source, place_kind: place.kind, place_ref: place.ref, place_label: place.label,
  })) ctx.addIssue({ code: "custom", message: "The retained project place reference is invalid." });
});
export type BcaProjectPlace = z.infer<typeof bcaProjectPlaceSchema>;
export type BcaProjectPlaceRead = { status: "available"; snapshot: BcaProjectPlace }
  | { status: "unavailable" | "invalid"; message: string };

export const BCA_PROJECT_PROJECTION = "id, workspace_id, name, updated_at, jurisdiction_context, place_source, place_kind, place_ref, place_label, place_country_code, place_subdivision_code, place_min_lon, place_min_lat, place_max_lon, place_max_lat, place_set_at";

/** Read the actual project scope. Missing columns are never an empty place. */
export function readBcaProjectPlace(projectId: string, row: Partial<ProjectPlaceRow> & {
  id?: string; updated_at?: string | null; jurisdiction_context?: unknown;
}): BcaProjectPlaceRead {
  if (row.id !== projectId || ["updated_at", "jurisdiction_context", ...PROJECT_PLACE_SCOPE_COLUMNS.split(", ")]
    .some(column => !(column in row))) {
    return { status: "unavailable", message: "The project's place and context were not fully read." };
  }
  try {
    if (["updated_at", "jurisdiction_context", ...PROJECT_PLACE_SCOPE_COLUMNS.split(", ")]
      .some(column => Reflect.get(row, column) === undefined)) throw new Error("Undefined projection value");
    const bounds = [row.place_min_lon, row.place_min_lat, row.place_max_lon, row.place_max_lat];
    if (bounds.some(value => value !== null) && bounds.some(value => value === null)) throw new Error("Partial bounds");
    const place = placeIdentityOnly(placeOfRecordFromProject(row));
    const jurisdiction = readProjectJurisdiction(row);
    if (canonicalBcaJson(jurisdiction) !== canonicalBcaJson(row.jurisdiction_context))
      return { status: "invalid", message: "The saved project jurisdiction changes under its strict reader. Review the project context before binding a new analysis." };
    const parsed = bcaProjectPlaceSchema.safeParse({
      projectId, projectUpdatedAt: row.updated_at, placeSetAt: row.place_set_at,
      status: placeStatus(place.source),
      place, jurisdiction,
    });
    if (!parsed.success) throw new Error("Invalid scope");
    return { status: "available", snapshot: parsed.data };
  } catch {
    return { status: "invalid", message: "The project's saved place or jurisdiction context is malformed. Review the project record." };
  }
}

type PlaceDocument = { schemaVersion: number; projectId: string; projectPlace?: BcaProjectPlace };
export type BcaPlaceReview = {
  status: "unbound" | "matched-at-read" | "changed-since-review" | "current-unavailable";
  retained: BcaProjectPlace | null;
  current: BcaProjectPlaceRead;
};

/** Status is an observation alongside the immutable document, never a rewrite. */
export function bcaPlaceReview(doc: PlaceDocument, current: BcaProjectPlaceRead): BcaPlaceReview {
  const retained = doc.schemaVersion === 2 ? doc.projectPlace ?? null : null;
  return { retained, current, status: !retained ? "unbound" : current.status !== "available" ? "current-unavailable"
    : retained.projectId === doc.projectId && canonicalBcaJson(retained) === canonicalBcaJson(current.snapshot)
      ? "matched-at-read" : "changed-since-review" };
}

export function bcaPlaceReviewLabel(status: BcaPlaceReview["status"] | "invalid-document" | undefined): string {
  switch (status) {
    case "unbound": return "Unbound analysis";
    case "matched-at-read": return "Retained place matches the project at last read";
    case "changed-since-review": return "Project changed since place review";
    case "current-unavailable": return "Retained place, current project unavailable";
    case "invalid-document": return "Retained document cannot be assessed";
    default: return "Not assessed";
  }
}

export function bcaPlaceDescription(snapshot: BcaProjectPlace): string {
  const place = snapshot.place;
  return `${snapshot.status}: ${place.label ?? "No place label"}; source ${place.source ?? "none"}; kind ${place.kind ?? "unresolved"}; reference ${place.ref ?? "unresolved"}; country ${place.countryCode ?? "unresolved"}; subdivision ${place.subdivisionCode ?? "unresolved"}.`;
}

export const BCA_PLACE_LIMIT = "This records project place identity and context, without boundary geometry. It does not establish jurisdiction, adopting authority or legal applicability. A new save rechecks the exact project row in the database and holds that row through its insert transaction. A concurrent project change can occur afterward. History and export comparisons describe a read and do not lock the project.";
