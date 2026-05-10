import type { SmokeStatus } from "@/lib/operations/pilot-readiness";
import {
  finalPilotReadinessChecklistSync,
  releaseProofPosture,
} from "@/lib/operations/release-proof-packet";

export type PilotReadinessControlTone = "success" | "danger" | "warning" | "neutral";

export type PilotReadinessControlSummary = {
  label: string;
  detail: string;
  tone: PilotReadinessControlTone;
  latestEvidenceDate: string;
  counts: {
    total: number;
    pass: number;
    fail: number;
    pending: number;
    unknown: number;
  };
  openProofLaneLabels: string[];
  preflightCommand: string;
  preflightProofArtifact: string;
  preflightProofScope: string;
  preflightOperatorInstruction: string;
  preflightPosture: string;
  proofPacketHref: string;
  proofPacketCaveat: string;
  proofArtifactCount: number;
  requiredCaveatCount: number;
  supervisedBoundary: string;
};

const PILOT_PREFLIGHT_COMMAND =
  "pnpm ops:check-pilot-preflight";

const PILOT_PREFLIGHT_PROOF_ARTIFACT = "docs/ops/2026-05-10-openplan-pilot-preflight-operator-proof.md";

const PILOT_PREFLIGHT_PROOF_SCOPE =
  "Read-only pre-conversation readiness bundle covering local guard posture, migration inventory, production health, and Vercel deployment readiness.";

const PILOT_PREFLIGHT_OPERATOR_INSTRUCTION =
  "Run this in a terminal immediately before a buyer call, public demo, supervised pilot kickoff, sales-packet refresh, or post-deploy confidence check; this browser surface only points to the command and proof note.";

const PILOT_PREFLIGHT_BASE = {
  preflightCommand: PILOT_PREFLIGHT_COMMAND,
  preflightProofArtifact: PILOT_PREFLIGHT_PROOF_ARTIFACT,
  preflightProofScope: PILOT_PREFLIGHT_PROOF_SCOPE,
  preflightOperatorInstruction: PILOT_PREFLIGHT_OPERATOR_INSTRUCTION,
};

function resolveLatestEvidenceDate(statusList: SmokeStatus[]): string {
  return statusList
    .map((item) => item.lastRun)
    .filter((value) => value !== "N/A" && value !== "Unknown")
    .sort()
    .reverse()[0] ?? "No dated proof yet";
}

export function buildPilotReadinessControlSummary(statusList: SmokeStatus[]): PilotReadinessControlSummary {
  const counts = statusList.reduce(
    (acc, item) => {
      acc.total += 1;
      if (item.status === "PASS") acc.pass += 1;
      if (item.status === "FAIL") acc.fail += 1;
      if (item.status === "PENDING") acc.pending += 1;
      if (item.status === "UNKNOWN") acc.unknown += 1;
      return acc;
    },
    { total: 0, pass: 0, fail: 0, pending: 0, unknown: 0 },
  );

  const openProofLaneLabels = statusList
    .filter((item) => item.status !== "PASS")
    .map((item) => item.lane);

  if (counts.fail > 0) {
    return {
      label: "Hold for proof repair",
      detail: `${counts.fail} readiness lane${counts.fail === 1 ? " is" : "s are"} failing. Repair proof before a buyer-facing readiness claim.`,
      tone: "danger",
      latestEvidenceDate: resolveLatestEvidenceDate(statusList),
      counts,
      openProofLaneLabels,
      ...PILOT_PREFLIGHT_BASE,
      preflightPosture: "Read-only preflight only; do not provision workspaces or imply automated activation from this surface.",
      proofPacketHref: "/admin/pilot-readiness",
      proofPacketCaveat: finalPilotReadinessChecklistSync.supervisedOnboardingCaveat,
      proofArtifactCount: releaseProofPosture.proofItems.length,
      requiredCaveatCount: releaseProofPosture.caveats.length,
      supervisedBoundary: releaseProofPosture.wedge,
    };
  }

  if (counts.pending > 0 || counts.unknown > 0) {
    const openCount = counts.pending + counts.unknown;
    return {
      label: "Current with open proof gaps",
      detail: `${counts.pass} lane${counts.pass === 1 ? " has" : "s have"} passing evidence; ${openCount} still need fresh proof before external reliance.`,
      tone: "warning",
      latestEvidenceDate: resolveLatestEvidenceDate(statusList),
      counts,
      openProofLaneLabels,
      ...PILOT_PREFLIGHT_BASE,
      preflightPosture: "Run the read-only preflight before demos, then resolve open proof lanes manually.",
      proofPacketHref: "/admin/pilot-readiness",
      proofPacketCaveat: finalPilotReadinessChecklistSync.supervisedOnboardingCaveat,
      proofArtifactCount: releaseProofPosture.proofItems.length,
      requiredCaveatCount: releaseProofPosture.caveats.length,
      supervisedBoundary: releaseProofPosture.wedge,
    };
  }

  if (counts.pass > 0) {
    return {
      label: "Ready for supervised review",
      detail: "All tracked readiness lanes have passing proof artifacts. Use the packet as an internal diligence snapshot, not an autonomous launch certificate.",
      tone: "success",
      latestEvidenceDate: resolveLatestEvidenceDate(statusList),
      counts,
      openProofLaneLabels,
      ...PILOT_PREFLIGHT_BASE,
      preflightPosture: "Run the read-only preflight immediately before buyer conversations to catch deployment drift.",
      proofPacketHref: "/admin/pilot-readiness",
      proofPacketCaveat: finalPilotReadinessChecklistSync.supervisedOnboardingCaveat,
      proofArtifactCount: releaseProofPosture.proofItems.length,
      requiredCaveatCount: releaseProofPosture.caveats.length,
      supervisedBoundary: releaseProofPosture.wedge,
    };
  }

  return {
    label: "Evidence still forming",
    detail: "No passing proof artifacts are available yet for the tracked readiness lanes.",
    tone: "neutral",
    latestEvidenceDate: resolveLatestEvidenceDate(statusList),
    counts,
    openProofLaneLabels,
    ...PILOT_PREFLIGHT_BASE,
    preflightPosture: "Collect proof first; this control strip does not start deployments or enable self-serve activation.",
    proofPacketHref: "/admin/pilot-readiness",
    proofPacketCaveat: finalPilotReadinessChecklistSync.supervisedOnboardingCaveat,
    proofArtifactCount: releaseProofPosture.proofItems.length,
    requiredCaveatCount: releaseProofPosture.caveats.length,
    supervisedBoundary: releaseProofPosture.wedge,
  };
}
