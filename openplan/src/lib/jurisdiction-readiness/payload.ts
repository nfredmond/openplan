import { createHash } from "node:crypto";
import { canonicalizeActionPayload } from "@/lib/runtime/action-metadata";
import { readProjectJurisdiction, type ProjectJurisdictionRow } from "@/lib/projects/project-jurisdiction";
import type { JurisdictionReadinessPlace } from "./contracts";
import { JURISDICTION_READINESS_REGISTRY, resolveAllJurisdictionReadiness } from "./registry";

export type JurisdictionReadinessPayload = ReturnType<typeof buildJurisdictionReadinessPayload>;

export function buildJurisdictionReadinessPayload(
  place: JurisdictionReadinessPlace,
  registrySha256: string,
) {
  const reports = resolveAllJurisdictionReadiness(place, { registrySha256 });
  return {
    schema: "openplan.jurisdiction-readiness-response.v1" as const,
    registryVersion: reports[0]?.registryVersion ?? null,
    registrySha256,
    jurisdiction: reports[0]?.jurisdiction ?? {
      id: null,
      label: place.label?.trim() || "Jurisdiction not identified",
      country: place.countryCode,
      subdivision: place.subdivisionCode,
      assessmentKind: null,
    },
    reports,
  };
}

export type ProjectJurisdictionReadinessPayload = ReturnType<typeof buildProjectJurisdictionReadinessPayload>;

/** Keep declarations separate and disclose the registry's administrative assessment scale. */
export function buildProjectJurisdictionReadinessPayload(project: ProjectJurisdictionRow, registrySha256: string) {
  const context = readProjectJurisdiction(project);
  const legacy = context === null;
  const payload = {
    schema: "openplan.project-jurisdiction-readiness-response.v2" as const,
    projectId: project.id ?? null,
    projectRevision: project.updated_at ?? null,
    registrySha256,
    context,
    contextSource: legacy ? "legacy_study_place" as const : "project_declaration" as const,
    disclosure: legacy
      ? "Legacy study-place context only. No separate jurisdiction has been declared. Adopting authority and legal applicability remain unresolved."
      : "Human-declared project context. Resolved identity does not establish adopting authority or legal applicability. Registry guidance assesses administrative state-level scope only.",
    entries: legacy ? [{ declaration: null, assessmentScope: "legacy study-place context", assessment: buildJurisdictionReadinessPayload({
      countryCode: project.place_country_code ?? null, subdivisionCode: project.place_subdivision_code ?? null, label: project.place_label ?? null,
    }, registrySha256), administrativeGuidance: null }] : context.entries.map(declaration => {
      const administrative = declaration.scope === "administrative";
      const place = { countryCode: declaration.countryCode, subdivisionCode: declaration.subdivisionCode, label: declaration.label };
      const resolved = declaration.identity === "server_resolved" && administrative;
      return {
        declaration,
        assessmentScope: resolved ? "Administrative state-level guidance only; no local or authority-specific assessment" : "Unverified staff declaration; jurisdiction-specific support is unassessed",
        assessment: buildJurisdictionReadinessPayload(resolved ? place : { countryCode: null, subdivisionCode: null, label: declaration.label }, registrySha256),
        administrativeGuidance: !resolved && administrative && place.countryCode && place.subdivisionCode
          ? buildJurisdictionReadinessPayload(place, registrySha256) : null,
      };
    }),
  };
  return { ...payload, payloadSha256: createHash("sha256").update(canonicalizeActionPayload(payload)).digest("hex") };
}

export type ProjectJurisdictionReadinessExportPayload = ReturnType<typeof buildProjectJurisdictionReadinessExportPayload>;

/** Validate trusted storage first, then hash the versioned external representation. */
export function buildProjectJurisdictionReadinessExportPayload(project: ProjectJurisdictionRow, registrySha256: string) {
  const internal = buildProjectJurisdictionReadinessPayload(project, registrySha256);
  const context = internal.context === null ? null : {
    schema: "openplan.project-jurisdiction-context-export.v1" as const,
    state: internal.context.state,
    recordedAt: internal.context.recordedAt,
    entries: internal.context.entries,
  };
  const payload = {
    schema: "openplan.project-jurisdiction-readiness-export.v3" as const,
    scope: "external_handoff" as const,
    attribution: "Recorded time and source attribution retained; internal actor identifier omitted." as const,
    projectId: internal.projectId,
    projectRevision: internal.projectRevision,
    registryVersion: JURISDICTION_READINESS_REGISTRY.registryVersion,
    registrySha256: internal.registrySha256,
    context,
    contextSource: internal.contextSource,
    disclosure: internal.disclosure,
    entries: internal.entries,
  };
  return { ...payload, payloadSha256: createHash("sha256").update(canonicalizeActionPayload(payload)).digest("hex") };
}
