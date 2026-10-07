import { z } from "zod";
import { placeKindSchema, type PlaceBoundaryResponse } from "@/lib/api/place-geographies";
import { studyAreaCaptureSchema } from "@/lib/geographies/study-area-capture";
import { TIGERWEB_GEOGRAPHY_SOURCE } from "@/lib/workspaces/home-geography";
import { planAuthorityAssessmentSchema, type SavedPlanContext } from "./plan-context";
import { planContextSaveSchema, type PlanContextSave } from "./plan-context-command";

const field = z.string().max(6000);
export const planContextDraftSchema = z.object({
  place: z.object({ mode: z.enum(["retained", "place", "drawn", "uploaded"]), label: field,
    geometryText: z.string().max(2_000_000), kind: placeKindSchema.nullable(), geoid: z.string().max(120) }).strict(),
  authorities: z.array(z.object({ id: z.string().uuid(), label: field, role: field, kind: field,
    jurisdictionUnknown: z.boolean(), country: field, subdivision: field, sourceText: z.string().max(62_000) }).strict()).min(1).max(30),
  applicability: z.object({ status: z.enum(["unresolved", "staff_assessed"]), explanation: field,
    sourceText: z.string().max(62_000), authorityIds: z.array(z.string().uuid()).max(30) }).strict(),
}).strict();
export type PlanContextDraft = z.infer<typeof planContextDraftSchema>;
export type PlanAuthorityDraft = PlanContextDraft["authorities"][number];
const sources = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);

/** Existing labels do not establish jurisdiction, authority type or applicability. */
export function emptyPlanAuthority(label = ""): PlanAuthorityDraft {
  return { id: crypto.randomUUID(), label, role: "", kind: "", jurisdictionUnknown: true, country: "", subdivision: "", sourceText: "" };
}

export function planContextDraft(context: SavedPlanContext | null, labels: { authority: string; geography: string }): PlanContextDraft {
  if (!context) return { place: { mode: "drawn", label: labels.geography, geometryText: "", kind: null, geoid: "" },
    authorities: [emptyPlanAuthority(labels.authority)], applicability: { status: "unresolved", explanation: "", sourceText: "", authorityIds: [] } };
  return { place: { mode: "retained", label: context.place.label, geometryText: JSON.stringify(context.place.geometry),
    kind: context.place.source === TIGERWEB_GEOGRAPHY_SOURCE && placeKindSchema.safeParse(context.place.kind).success ? context.place.kind as z.infer<typeof placeKindSchema> : null,
    geoid: context.place.ref ?? "" },
    authorities: context.assessment.authorities.map(authority => ({ id: authority.id, label: authority.label, role: authority.role, kind: authority.kind,
      jurisdictionUnknown: authority.jurisdiction === null, country: authority.jurisdiction?.country ?? "", subdivision: authority.jurisdiction?.subdivision ?? "", sourceText: authority.sourceUrls.join("\n") })),
    applicability: { status: context.assessment.applicability.status, explanation: context.assessment.applicability.explanation,
      sourceText: context.assessment.applicability.status === "staff_assessed" ? context.assessment.applicability.sourceUrls.join("\n") : "",
      authorityIds: context.assessment.applicability.status === "staff_assessed" ? [...context.assessment.applicability.authorityIds] : [] },
  };
}

export function assessmentFromDraft(draft: PlanContextDraft) {
  return planAuthorityAssessmentSchema.parse({ authorities: draft.authorities.map(authority => ({ id: authority.id, label: authority.label,
    role: authority.role, kind: authority.kind, jurisdiction: authority.jurisdictionUnknown ? null : { country: authority.country.trim().toUpperCase(), subdivision: authority.subdivision.trim().toUpperCase() || null },
    sourceUrls: sources(authority.sourceText) })),
    applicability: draft.applicability.status === "unresolved" ? { status: "unresolved", explanation: draft.applicability.explanation }
      : { status: "staff_assessed", explanation: draft.applicability.explanation, sourceUrls: sources(draft.applicability.sourceText), authorityIds: draft.applicability.authorityIds } });
}

export function contextCommandFromDraft(draft: PlanContextDraft, preconditions: Pick<PlanContextSave, "commandId" | "versionId" | "expectedContextHash" | "descriptorId" | "planKindKey">): PlanContextSave {
  const place = draft.place.mode === "retained" ? { mode: "retained" as const }
    : draft.place.mode === "place" ? studyAreaCaptureSchema.parse({ mode: "place", kind: draft.place.kind, geoid: draft.place.geoid, label: draft.place.label })
      : studyAreaCaptureSchema.parse({ mode: draft.place.mode, geometry: JSON.parse(draft.place.geometryText), label: draft.place.label });
  return planContextSaveSchema.parse({ ...preconditions, place, assessment: assessmentFromDraft(draft) });
}

/** The picker may replace study geometry, but never staff-stated authorities. */
export function withResolvedStudyPlace(draft: PlanContextDraft, place: PlaceBoundaryResponse | null): PlanContextDraft {
  return { ...draft, place: place ? { mode: "place", label: place.label ?? "", geometryText: JSON.stringify(place.geojson), kind: place.kind, geoid: place.geoid }
    : { ...draft.place, mode: "drawn", kind: null, geoid: "" } };
}
