import registryJson from "./registry.v1.json";
import type {
  JurisdictionReadinessJob,
  JurisdictionReadinessPlace,
  JurisdictionReadinessRegistry,
  JurisdictionReadinessReport,
  JurisdictionReadinessStatus,
} from "./contracts";

export const JURISDICTION_READINESS_REGISTRY = registryJson as JurisdictionReadinessRegistry;

export const JURISDICTION_READINESS_JOBS = JURISDICTION_READINESS_REGISTRY.jobs;

const STATUS_LABELS: Record<JurisdictionReadinessStatus, string> = {
  supported: "Supported here",
  partial: "Partly supported",
  unavailable: "Unavailable here",
  unassessed: "Not assessed here",
};

/** What a place with no single state, DC or territory on record reads for every job. */
const NO_SUBDIVISION_APPLICABILITY =
  "This place has no single state, DC or territory on record. OpenPlan records none for a tribal area, even one inside one state, and assesses readiness only for states, DC and territories, so this job is not assessed for this place.";

function normalizedCode(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}

function jobById(jobId: string): JurisdictionReadinessJob | null {
  return JURISDICTION_READINESS_REGISTRY.jobs.find((job) => job.id === jobId) ?? null;
}

function unassessedReport(
  place: JurisdictionReadinessPlace,
  job: JurisdictionReadinessJob,
  registrySha256: string | null,
  reason: string,
): JurisdictionReadinessReport {
  const country = normalizedCode(place.countryCode);
  const subdivision = normalizedCode(place.subdivisionCode);
  return {
    schema: "openplan.jurisdiction-readiness-report.v1",
    registryVersion: JURISDICTION_READINESS_REGISTRY.registryVersion,
    registrySha256,
    reviewedAt: JURISDICTION_READINESS_REGISTRY.reviewedAt,
    reviewBy: JURISDICTION_READINESS_REGISTRY.reviewBy,
    jurisdiction: {
      id: country && subdivision ? `${country}-${subdivision}` : null,
      label: place.label?.trim() || "Jurisdiction not identified",
      country,
      subdivision,
      assessmentKind: null,
    },
    job,
    status: "unassessed",
    statusLabel: STATUS_LABELS.unassessed,
    applicability: reason,
    sources: [],
    adapterIds: [],
    authorities: [],
    limitations: [
      "OpenPlan has no evidence-backed readiness claim for this exact jurisdiction and job. No other jurisdiction's rules or coverage were substituted.",
    ],
  };
}

/** Resolve one sparse evidence-backed cell. Missing cells remain unassessed. */
export function resolveJurisdictionReadiness(
  place: JurisdictionReadinessPlace,
  jobId: string,
  options?: { registrySha256?: string | null },
): JurisdictionReadinessReport | null {
  const job = jobById(jobId);
  if (!job) return null;

  const registrySha256 = options?.registrySha256 ?? null;
  const country = normalizedCode(place.countryCode);
  const subdivision = normalizedCode(place.subdivisionCode);
  if (!country) {
    return unassessedReport(
      place,
      job,
      registrySha256,
      "The selected place has no country identity, so OpenPlan cannot choose a jurisdiction claim.",
    );
  }
  // A tribal area always lands here: its Census id carries no state, even when
  // the area lies in one state. The registry has rows for states, DC and
  // territories only (docs/reviews/product-direction/tribal-area-readiness-design-2026-11-14.md).
  if (!subdivision) {
    return unassessedReport(place, job, registrySha256, NO_SUBDIVISION_APPLICABILITY);
  }

  const jurisdiction = JURISDICTION_READINESS_REGISTRY.jurisdictions.find(
    (candidate) =>
      normalizedCode(candidate.country) === country &&
      normalizedCode(candidate.subdivision) === subdivision,
  );
  if (!jurisdiction) {
    return unassessedReport(
      place,
      job,
      registrySha256,
      "This jurisdiction and job have not been assessed in the current registry.",
    );
  }

  const claim = JURISDICTION_READINESS_REGISTRY.claims.find(
    (candidate) => candidate.jurisdictionId === jurisdiction.id && candidate.jobId === job.id,
  );
  if (!claim) {
    return unassessedReport(
      place,
      job,
      registrySha256,
      "This jurisdiction exists in the registry, but this job has not been assessed.",
    );
  }

  const sourcesById = new Map(
    JURISDICTION_READINESS_REGISTRY.sources.map((source) => [source.id, source]),
  );
  return {
    schema: "openplan.jurisdiction-readiness-report.v1",
    registryVersion: JURISDICTION_READINESS_REGISTRY.registryVersion,
    registrySha256,
    reviewedAt: JURISDICTION_READINESS_REGISTRY.reviewedAt,
    reviewBy: JURISDICTION_READINESS_REGISTRY.reviewBy,
    jurisdiction: {
      id: jurisdiction.id,
      label: place.label?.trim() || jurisdiction.label,
      country,
      subdivision,
      assessmentKind: jurisdiction.assessmentKind,
    },
    job,
    status: claim.status,
    statusLabel: STATUS_LABELS[claim.status],
    applicability: claim.applicability,
    sources: claim.sourceIds.flatMap((sourceId) => {
      const source = sourcesById.get(sourceId);
      return source ? [source] : [];
    }),
    adapterIds: [...claim.adapterIds],
    authorities: claim.authorities.map((authority) => ({ ...authority })),
    limitations: [...claim.limitations],
  };
}

export function resolveAllJurisdictionReadiness(
  place: JurisdictionReadinessPlace,
  options?: { registrySha256?: string | null },
): JurisdictionReadinessReport[] {
  return JURISDICTION_READINESS_REGISTRY.jobs.flatMap((job) => {
    const report = resolveJurisdictionReadiness(place, job.id, options);
    return report ? [report] : [];
  });
}
