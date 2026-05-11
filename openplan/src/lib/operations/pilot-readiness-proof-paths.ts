export const ADMIN_PILOT_READINESS_ROUTE = "/admin/pilot-readiness";

export const FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT =
  "docs/ops/2026-05-10-openplan-final-pilot-readiness-smoke-checklist.md";

export const PILOT_PREFLIGHT_OPERATOR_PROOF_ARTIFACT =
  "docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md";

export const PHASE1_SHARED_SPINE_PROOF_ARTIFACT = "docs/ops/2026-05-02-openplan-local-spine-smoke.md";

export const ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACTS = [
  "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.md",
  "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.html",
  "docs/sales/2026-05-01-openplan-admin-pilot-readiness-proof-packet.pdf",
] as const;

export function getCanonicalPilotReadinessProofPaths() {
  return {
    readinessRoute: ADMIN_PILOT_READINESS_ROUTE,
    finalChecklistArtifact: FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT,
    pilotPreflightOperatorProofArtifact: PILOT_PREFLIGHT_OPERATOR_PROOF_ARTIFACT,
    phase1SharedSpineProofArtifact: PHASE1_SHARED_SPINE_PROOF_ARTIFACT,
    staticPacketArtifacts: ADMIN_PILOT_READINESS_STATIC_PACKET_ARTIFACTS,
  } as const;
}
