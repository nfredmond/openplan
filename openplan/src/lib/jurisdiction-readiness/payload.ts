import type { JurisdictionReadinessPlace } from "./contracts";
import { resolveAllJurisdictionReadiness } from "./registry";

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
