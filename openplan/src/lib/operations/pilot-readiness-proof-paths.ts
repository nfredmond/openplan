export const ADMIN_PILOT_READINESS_ROUTE = "/admin/pilot-readiness";

export const FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT =
  "docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md";

export const PILOT_PREFLIGHT_OPERATOR_PROOF_ARTIFACT =
  "docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md";

export const PHASE1_SHARED_SPINE_PROOF_ARTIFACT = "docs/ops/2026-05-02-openplan-local-spine-smoke.md";

export const ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACT_BY_FORMAT = {
  markdown: "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md",
  html: "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.html",
  pdf: "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.pdf",
} as const;

export const ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACTS = [
  ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACT_BY_FORMAT.markdown,
  ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACT_BY_FORMAT.html,
  ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACT_BY_FORMAT.pdf,
] as const;

export const PILOT_READINESS_CANONICAL_PROOF_PATH_VALUES = [
  ADMIN_PILOT_READINESS_ROUTE,
  FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT,
  PILOT_PREFLIGHT_OPERATOR_PROOF_ARTIFACT,
  PHASE1_SHARED_SPINE_PROOF_ARTIFACT,
  ...ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACTS,
] as const;

export function getCanonicalPilotReadinessProofPaths() {
  return {
    readinessRoute: ADMIN_PILOT_READINESS_ROUTE,
    finalChecklistArtifact: FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT,
    pilotPreflightOperatorProofArtifact: PILOT_PREFLIGHT_OPERATOR_PROOF_ARTIFACT,
    phase1SharedSpineProofArtifact: PHASE1_SHARED_SPINE_PROOF_ARTIFACT,
    staticPacketArtifacts: ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACTS,
    allPathValues: PILOT_READINESS_CANONICAL_PROOF_PATH_VALUES,
  } as const;
}

export function getCanonicalPilotReadinessProofPathValues() {
  return PILOT_READINESS_CANONICAL_PROOF_PATH_VALUES;
}
