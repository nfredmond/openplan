import {
  ADMIN_PILOT_READINESS_ROUTE,
  FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT,
} from "@/lib/operations/pilot-readiness-proof-paths";
import {
  ACCESS_REQUEST_MANUAL_PROVISIONING_ACKNOWLEDGEMENT,
  accessRequestProvisioningSideEffectLabel,
} from "@/lib/access-request-status";

export type SupervisedOnboardingEvidenceStep = {
  key: string;
  label: string;
  appSurface: string;
  operatorCheckpoint: string;
  proofArtifact: string;
  buyerSafeCaveat: string;
};

export type SupervisedOnboardingManualProvisioningGuard = {
  label: string;
  acknowledgement: typeof ACCESS_REQUEST_MANUAL_PROVISIONING_ACKNOWLEDGEMENT;
  sideEffectSummary: string;
  proofArtifact: string;
  guardrails: readonly string[];
};

export type SupervisedOnboardingEvidenceLedgerEntry = {
  key: string;
  label: string;
  operatorUse: string;
  proofPosture: string;
  proofArtifact: string;
  boundary: string;
};

export const SUPERVISED_ONBOARDING_EVIDENCE_FLOW_PROOF_ARTIFACT =
  "openplan/docs/ops/2026-05-10-supervised-onboarding-evidence-flow-proof.md";

export const ACCESS_REQUEST_MANUAL_PROVISIONING_GUARD_PROOF_ARTIFACT =
  "openplan/docs/ops/2026-05-10-access-request-manual-provisioning-guard-proof.md";

export const ADMIN_OPS_PROD_HEALTH_EVIDENCE_BRIDGE_ARTIFACT =
  "docs/ops/2026-05-10-openplan-admin-ops-to-prod-health-evidence-bridge.md";

export const supervisedOnboardingEvidenceFlow = {
  label: "Supervised onboarding evidence flow",
  summary:
    "Connect request-access intake, allowlisted Admin Operations review, manual pilot workspace invitation, and Pilot Readiness export evidence before any buyer or pilot reliance.",
  boundary:
    "This is an operator-controlled evidence bridge only: no public self-serve activation, no outbound email automation, no schema mutation, and no claim that a pilot is ready without a fresh human-reviewed preflight.",
  sourceProof: SUPERVISED_ONBOARDING_EVIDENCE_FLOW_PROOF_ARTIFACT,
  manualProvisioningGuard: {
    label: "Manual provisioning guard",
    acknowledgement: ACCESS_REQUEST_MANUAL_PROVISIONING_ACKNOWLEDGEMENT,
    sideEffectSummary: accessRequestProvisioningSideEffectLabel(),
    proofArtifact: ACCESS_REQUEST_MANUAL_PROVISIONING_GUARD_PROOF_ARTIFACT,
    guardrails: [
      "No production writes during proof smoke",
      "No autonomous provisioning",
      "No outbound email",
      "Manual invite delivery only",
    ],
  } satisfies SupervisedOnboardingManualProvisioningGuard,
  operatorEvidenceLedger: [
    {
      key: "manual-provisioning-guard",
      label: "Manual provisioning guard",
      operatorUse:
        "Before creating an owner invite, confirm the request is contacted/invited and the manual_provisioning_no_email acknowledgement is explicit.",
      proofPosture: "Code guard plus component/route tests",
      proofArtifact: ACCESS_REQUEST_MANUAL_PROVISIONING_GUARD_PROOF_ARTIFACT,
      boundary: "No email send, billing change, or autonomous account activation is authorized by this proof.",
    },
    {
      key: "prod-health-evidence",
      label: "Production health evidence",
      operatorUse:
        "After an admin-affecting main deploy, pair Admin Operations proof with Vercel Ready state and public /api/health evidence before calling the proof current.",
      proofPosture: "No-write production evidence bridge",
      proofArtifact: ADMIN_OPS_PROD_HEALTH_EVIDENCE_BRIDGE_ARTIFACT,
      boundary:
        "Health evidence is shallow deployment proof only; it does not inspect Supabase rows or validate authenticated workflows.",
    },
    {
      key: "pilot-readiness-handoff",
      label: "Pilot-readiness handoff",
      operatorUse:
        "Before buyer reliance, export/read the Pilot Readiness packet and carry the final checklist caveats into the handoff note.",
      proofPosture: "Operator packet and final checklist sync",
      proofArtifact: FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT,
      boundary:
        "A PASS supports a supervised pilot conversation only; it is not a launch certificate or self-serve provisioning claim.",
    },
  ] satisfies readonly SupervisedOnboardingEvidenceLedgerEntry[],
  stages: [
    {
      key: "public-intake",
      label: "Public request intake captured",
      appSurface: "/request-access → service-role-only access_requests rows",
      operatorCheckpoint:
        "Confirm the request has a named owner, agency/workspace intent, service lane, deployment posture, first workflow, and data-sensitivity classification before review.",
      proofArtifact: "openplan/src/test/access-request-route.test.ts",
      buyerSafeCaveat:
        "A stored request is a prospect signal only; it does not create a workspace, send email, or imply acceptance.",
    },
    {
      key: "admin-operations-review",
      label: "Admin Operations reviewer triages",
      appSurface: "/admin/operations → Recent supervised onboarding requests",
      operatorCheckpoint:
        "Only allowlisted reviewers can render prospect rows; status changes remain explicit triage events and do not provision a workspace by themselves.",
      proofArtifact: "openplan/src/test/admin-operations-page.test.tsx",
      buyerSafeCaveat:
        "The review surface may display prospect PII to allowlisted operators only; do not capture or paste row contents into external proof notes.",
    },
    {
      key: "manual-provisioning-ack",
      label: "Manual provisioning acknowledgement gates invite creation",
      appSurface: "POST /api/admin/access-requests/[accessRequestId]/provision",
      operatorCheckpoint:
        "Provisioning requires contacted/invited status plus the manual_provisioning_no_email acknowledgement before a pilot workspace and owner invitation can be created.",
      proofArtifact: ACCESS_REQUEST_MANUAL_PROVISIONING_GUARD_PROOF_ARTIFACT,
      buyerSafeCaveat:
        "Owner invitations are manual-delivery artifacts; no autonomous onboarding email or instant account activation is claimed.",
    },
    {
      key: "pilot-readiness-sync",
      label: "Pilot Readiness packet carries the caveats",
      appSurface: ADMIN_PILOT_READINESS_ROUTE,
      operatorCheckpoint:
        "Before a buyer call or pilot kickoff, export/read the readiness packet and confirm the final checklist, caveats, and onboarding proof artifacts are still current.",
      proofArtifact: FINAL_PILOT_READINESS_CHECKLIST_ARTIFACT,
      buyerSafeCaveat:
        "PASS supports a supervised pilot-readiness conversation only; it is not a launch certificate or a finished-suite claim.",
    },
  ],
} as const;

export function getSupervisedOnboardingEvidenceFlow() {
  return supervisedOnboardingEvidenceFlow;
}

export function getSupervisedOnboardingEvidenceProofArtifacts() {
  return Array.from(
    new Set([
      supervisedOnboardingEvidenceFlow.sourceProof,
      ...supervisedOnboardingEvidenceFlow.operatorEvidenceLedger.map((entry) => entry.proofArtifact),
      ...supervisedOnboardingEvidenceFlow.stages.map((stage) => stage.proofArtifact),
    ])
  );
}
