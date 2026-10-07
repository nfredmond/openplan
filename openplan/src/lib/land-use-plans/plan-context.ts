import { z } from "zod";
import { studyAreaGeometrySchema } from "@/lib/geographies/study-area-capture";
import type { JurisdictionPlanDescriptor } from "./contracts";

const label = z.string().trim().min(1).max(240);
const sourceUrls = z.array(z.url({ protocol: /^https?$/ }).max(2000)).max(30);
const jurisdiction = z.object({
  country: z.string().regex(/^[A-Z]{2}$/),
  subdivision: z.string().regex(/^[A-Z0-9-]{1,12}$/).nullable(),
}).strict();

/** An authority is a staff-stated responsible body, not a Census boundary. */
export const planAuthoritySchema = z.object({
  id: z.string().uuid(),
  label,
  role: label,
  kind: label,
  jurisdiction: jurisdiction.nullable(),
  sourceUrls,
}).strict();

export const planAuthorityAssessmentSchema = z.object({
  authorities: z.array(planAuthoritySchema).min(1).max(30),
  applicability: z.discriminatedUnion("status", [
    z.object({ status: z.literal("unresolved"), explanation: z.string().trim().min(1).max(6000) }).strict(),
    z.object({ status: z.literal("staff_assessed"), explanation: z.string().trim().min(1).max(6000),
      sourceUrls: sourceUrls.min(1), authorityIds: z.array(z.string().uuid()).min(1).max(30) }).strict(),
  ]),
}).strict().superRefine((value, ctx) => {
  const ids = new Set(value.authorities.map(authority => authority.id));
  if (ids.size !== value.authorities.length) ctx.addIssue({ code: "custom", message: "Authority references must be unique", path: ["authorities"] });
  if (value.applicability.status === "staff_assessed") {
    const selected = value.applicability.authorityIds;
    if (new Set(selected).size !== selected.length || selected.some(id => !ids.has(id))) {
      ctx.addIssue({ code: "custom", message: "The assessment must name distinct saved authorities", path: ["applicability", "authorityIds"] });
    }
  }
});

export type PlanAuthorityAssessment = z.infer<typeof planAuthorityAssessmentSchema>;

/** Check the adapter's declared coverage; this never certifies the staff assessment. */
export function planApplicabilityBlocker(assessment: PlanAuthorityAssessment, descriptor: JurisdictionPlanDescriptor): string | null {
  if (!descriptor.configured) return null;
  if (assessment.applicability.status !== "staff_assessed") return "Assess this plan's responsible authority and sources before choosing a configured checklist.";
  const coverage = descriptor.jurisdictionCoverage;
  const kinds = descriptor.authorityKinds;
  if (!coverage || !kinds?.length) return "This checklist has no configured authority scope. Use the neutral workflow.";
  const selected = assessment.authorities.filter(authority => assessment.applicability.status === "staff_assessed" && assessment.applicability.authorityIds.includes(authority.id));
  if (!selected.length || selected.some(authority => !authority.sourceUrls.length || !kinds.includes(authority.kind)
    || authority.jurisdiction?.country !== coverage.country
    || (coverage.subdivision !== undefined && authority.jurisdiction?.subdivision !== coverage.subdivision))) {
    return "The selected responsible bodies are outside this checklist's supported authority scope. Preserve their context with the neutral workflow.";
  }
  return null;
}

const placeBbox = z.object({ minLon: z.number().min(-180).max(180), minLat: z.number().min(-90).max(90),
  maxLon: z.number().min(-180).max(180), maxLat: z.number().min(-90).max(90) }).strict()
  .refine(value => value.minLat <= value.maxLat, "Latitude bounds are reversed");
const savedPlace = z.object({
  source: z.string().min(1), kind: z.string().nullable(), ref: z.string().nullable(), label,
  countryCode: z.string().regex(/^[A-Z]{2}$/).nullable(), subdivisionCode: z.string().nullable(),
  bbox: placeBbox, geometry: studyAreaGeometrySchema,
}).strict().superRefine((place, ctx) => {
  if (["drawn", "uploaded_file"].includes(place.source) && (place.kind !== null || place.ref !== null || place.countryCode !== null || place.subdivisionCode !== null)) {
    ctx.addIssue({ code: "custom", message: "An unresolved boundary cannot carry a legal or resolver identity" });
  }
});

export const savedPlanContextSchema = z.object({
  schemaVersion: z.literal(1), place: savedPlace, assessment: planAuthorityAssessmentSchema,
  savedBy: z.string().uuid(), savedAt: z.iso.datetime(),
}).strict();
export type SavedPlanContext = z.infer<typeof savedPlanContextSchema>;

/** Validate a retained context without repairing it from a mutable draft. */
export function readSavedPlanContext(value: unknown):
  { status: "retained"; context: SavedPlanContext } | { status: "legacy" | "invalid" } {
  if (value === null) return { status: "legacy" };
  const parsed = savedPlanContextSchema.safeParse(value);
  return parsed.success ? { status: "retained", context: parsed.data } : { status: "invalid" };
}
