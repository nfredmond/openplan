export type AerialMissionStatus = "planned" | "active" | "complete" | "cancelled";
export type AerialMissionType = "corridor_survey" | "site_inspection" | "aoi_capture" | "general";
export type AerialPackageStatus = "processing" | "qa_pending" | "ready" | "shared";
export type AerialVerificationReadiness = "pending" | "partial" | "ready" | "not_applicable";

export type AerialProjectPosture = {
  missionCount: number;
  activeMissionCount: number;
  completeMissionCount: number;
  readyPackageCount: number;
  verificationReadiness: "none" | "pending" | "partial" | "ready";
};

export type AerialMissionPackagePosture = {
  packageCount: number;
  readyPackageCount: number;
  qaPendingPackageCount: number;
  processingPackageCount: number;
  verificationReadyPackageCount: number;
  attachmentReadyPackageCount: number;
  attachmentReadyLabel: string;
  attachmentReady: boolean;
  label: string;
  tone: "neutral" | "info" | "success" | "warning";
};

export type AerialEvidenceAttachmentReadiness = "ready" | "needs_source_context" | "blocked";

export type AerialEvidenceAttachmentUse = "project" | "grant" | "report" | "public_response";

export type AerialEvidenceAttachmentSummary = {
  readiness: AerialEvidenceAttachmentReadiness;
  label: string;
  detail: string;
  readyUses: AerialEvidenceAttachmentUse[];
  blockedUses: AerialEvidenceAttachmentUse[];
  sourceContext: string;
  attachmentReadyPackageCount: number;
  sourceContextPackageCount: number;
  blockers: string[];
  caveat: string;
};

const AERIAL_EVIDENCE_ATTACHMENT_USES: AerialEvidenceAttachmentUse[] = [
  "project",
  "grant",
  "report",
  "public_response",
];

const AERIAL_EVIDENCE_ATTACHMENT_CAVEAT =
  "Operator-assisted aerial evidence only; attach the cited package and human review notes before using it in a grant, report, or public comment response. No autonomous photogrammetry, regulatory compliance, or survey-grade certification is implied.";

function formatAttachmentUse(use: AerialEvidenceAttachmentUse): string {
  switch (use) {
    case "project":
      return "project record";
    case "grant":
      return "grant support";
    case "report":
      return "report exhibit";
    case "public_response":
      return "public response";
  }
}

function joinUseLabels(uses: AerialEvidenceAttachmentUse[]): string {
  if (uses.length === 0) return "No downstream uses";
  return uses.map(formatAttachmentUse).join(", ");
}

function normalizePackageTitle(title: string | null | undefined, fallbackIndex: number): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : `Package ${fallbackIndex + 1}`;
}

export function formatAerialMissionStatusLabel(status: string): string {
  switch (status) {
    case "planned":
      return "Planned";
    case "active":
      return "Active";
    case "complete":
      return "Complete";
    case "cancelled":
      return "Cancelled";
    default:
      return "Unknown";
  }
}

export function aerialMissionStatusTone(status: string): "neutral" | "info" | "success" | "warning" {
  switch (status) {
    case "planned":
      return "neutral";
    case "active":
      return "info";
    case "complete":
      return "success";
    case "cancelled":
      return "warning";
    default:
      return "neutral";
  }
}

export function formatAerialPackageStatusLabel(status: string): string {
  switch (status) {
    case "processing":
      return "Processing";
    case "qa_pending":
      return "QA pending";
    case "ready":
      return "Ready";
    case "shared":
      return "Shared";
    default:
      return "Unknown";
  }
}

export function aerialPackageStatusTone(status: string): "neutral" | "info" | "success" | "warning" {
  switch (status) {
    case "processing":
      return "neutral";
    case "qa_pending":
      return "info";
    case "ready":
    case "shared":
      return "success";
    default:
      return "neutral";
  }
}

export function formatAerialVerificationReadinessLabel(readiness: string): string {
  switch (readiness) {
    case "pending":
      return "Verification pending";
    case "partial":
      return "Partially verified";
    case "ready":
      return "Verification ready";
    case "not_applicable":
      return "Not applicable";
    default:
      return "Unknown";
  }
}

export function aerialVerificationReadinessTone(readiness: string): "neutral" | "info" | "success" | "warning" {
  switch (readiness) {
    case "pending":
      return "warning";
    case "partial":
      return "info";
    case "ready":
      return "success";
    case "not_applicable":
      return "neutral";
    default:
      return "neutral";
  }
}

export function formatAerialMissionTypeLabel(type: string): string {
  switch (type) {
    case "corridor_survey":
      return "Corridor survey";
    case "site_inspection":
      return "Site inspection";
    case "aoi_capture":
      return "AOI capture";
    case "general":
      return "General";
    default:
      return "Unknown";
  }
}

export function buildAerialProjectPosture(
  missions: Array<{ status: string }>,
  packages: Array<{ status: string; verification_readiness: string }>
): AerialProjectPosture {
  const missionCount = missions.length;
  const activeMissionCount = missions.filter((m) => m.status === "active").length;
  const completeMissionCount = missions.filter((m) => m.status === "complete").length;
  const readyPackageCount = packages.filter((p) => p.status === "ready" || p.status === "shared").length;

  let verificationReadiness: AerialProjectPosture["verificationReadiness"] = "none";
  if (packages.length > 0) {
    const readyCount = packages.filter((p) => p.verification_readiness === "ready").length;
    const partialCount = packages.filter((p) => p.verification_readiness === "partial").length;
    if (readyCount === packages.length) {
      verificationReadiness = "ready";
    } else if (readyCount > 0 || partialCount > 0) {
      verificationReadiness = "partial";
    } else {
      verificationReadiness = "pending";
    }
  }

  return {
    missionCount,
    activeMissionCount,
    completeMissionCount,
    readyPackageCount,
    verificationReadiness,
  };
}

export function summarizeAerialMissionPackagePosture(
  packages: Array<{ status: string; verification_readiness?: string | null }>
): AerialMissionPackagePosture {
  const packageCount = packages.length;
  const readyPackageCount = packages.filter((p) => p.status === "ready" || p.status === "shared").length;
  const qaPendingPackageCount = packages.filter((p) => p.status === "qa_pending").length;
  const processingPackageCount = packages.filter((p) => p.status === "processing").length;
  const verificationReadyPackageCount = packages.filter((p) => p.verification_readiness === "ready").length;
  const attachmentReadyPackageCount = packages.filter(
    (p) => (p.status === "ready" || p.status === "shared") && p.verification_readiness === "ready"
  ).length;
  const attachmentReady = packageCount > 0 && attachmentReadyPackageCount === packageCount;
  const attachmentReadyLabel = attachmentReady
    ? "Report attachment ready"
    : packageCount === 0
      ? "No report attachments"
      : `${attachmentReadyPackageCount}/${packageCount} attachment-ready`;

  if (packageCount === 0) {
    return {
      packageCount,
      readyPackageCount,
      qaPendingPackageCount,
      processingPackageCount,
      verificationReadyPackageCount,
      attachmentReadyPackageCount,
      attachmentReadyLabel,
      attachmentReady,
      label: "No packages",
      tone: "neutral",
    };
  }

  if (readyPackageCount === packageCount && verificationReadyPackageCount === packageCount) {
    return {
      packageCount,
      readyPackageCount,
      qaPendingPackageCount,
      processingPackageCount,
      verificationReadyPackageCount,
      attachmentReadyPackageCount,
      attachmentReadyLabel,
      attachmentReady,
      label: `${readyPackageCount}/${packageCount} verification-ready`,
      tone: "success",
    };
  }

  if (qaPendingPackageCount > 0) {
    return {
      packageCount,
      readyPackageCount,
      qaPendingPackageCount,
      processingPackageCount,
      verificationReadyPackageCount,
      attachmentReadyPackageCount,
      attachmentReadyLabel,
      attachmentReady,
      label: `${readyPackageCount}/${packageCount} ready · ${qaPendingPackageCount} QA pending`,
      tone: "info",
    };
  }

  if (processingPackageCount > 0) {
    return {
      packageCount,
      readyPackageCount,
      qaPendingPackageCount,
      processingPackageCount,
      verificationReadyPackageCount,
      attachmentReadyPackageCount,
      attachmentReadyLabel,
      attachmentReady,
      label: `${readyPackageCount}/${packageCount} ready · ${processingPackageCount} processing`,
      tone: "neutral",
    };
  }

  return {
    packageCount,
    readyPackageCount,
    qaPendingPackageCount,
    processingPackageCount,
    verificationReadyPackageCount,
    attachmentReadyPackageCount,
    attachmentReadyLabel,
    attachmentReady,
    label: `${readyPackageCount}/${packageCount} ready`,
    tone: readyPackageCount > 0 ? "warning" : "neutral",
  };
}

export function summarizeAerialEvidenceAttachmentReadiness(input: {
  missionTitle?: string | null;
  missionStatus?: string | null;
  missionType?: string | null;
  hasProjectLink: boolean;
  hasAoi?: boolean;
  packages: Array<{
    title?: string | null;
    status: string;
    verification_readiness?: string | null;
    notes?: string | null;
    updated_at?: string | null;
  }>;
}): AerialEvidenceAttachmentSummary {
  const packagePosture = summarizeAerialMissionPackagePosture(input.packages);
  const sourceContextPackages = input.packages.filter(
    (p) => (p.status === "ready" || p.status === "shared") && p.verification_readiness === "ready" && Boolean(p.notes?.trim())
  );
  const hasAttachmentReadyPackage = packagePosture.attachmentReadyPackageCount > 0;
  const hasSourceContextPackage = sourceContextPackages.length > 0;
  const blockers: string[] = [];

  if (!input.hasProjectLink) {
    blockers.push("Link the mission to a project before using aerial evidence for project, grant, report, or public-response support.");
  }
  if (input.packages.length === 0) {
    blockers.push("Record at least one evidence package before claiming downstream attachment readiness.");
  } else if (!hasAttachmentReadyPackage) {
    blockers.push("At least one package must be ready/shared and verification-ready before it can support downstream materials.");
  }
  if (hasAttachmentReadyPackage && !hasSourceContextPackage) {
    blockers.push("Add package notes or source-context text so reviewers can cite what the aerial evidence actually supports.");
  }
  if (input.hasAoi === false) {
    blockers.push("Draw or attach an AOI before using the package as a map exhibit.");
  }

  const hasStructuralBlocker = !input.hasProjectLink || !hasAttachmentReadyPackage || input.hasAoi === false;
  const downstreamReady = !hasStructuralBlocker && hasSourceContextPackage;
  const readyUses = downstreamReady ? AERIAL_EVIDENCE_ATTACHMENT_USES : [];
  const blockedUses = downstreamReady ? [] : AERIAL_EVIDENCE_ATTACHMENT_USES;
  const readiness: AerialEvidenceAttachmentReadiness = downstreamReady
    ? "ready"
    : hasAttachmentReadyPackage && !hasStructuralBlocker
      ? "needs_source_context"
      : "blocked";
  const label = downstreamReady
    ? "Ready for project/report/grant attachment"
    : readiness === "needs_source_context"
      ? "Source context needed before attachment"
      : "Not ready for downstream attachment";
  const missionLabel = input.missionTitle?.trim() || "Aerial mission";
  const sourceContextPackageText = sourceContextPackages
    .map((pkg, index) => `${normalizePackageTitle(pkg.title, index)} (${formatAerialPackageStatusLabel(pkg.status)}; ${formatAerialVerificationReadinessLabel(pkg.verification_readiness ?? "pending")})`)
    .join("; ");
  const sourceContext = sourceContextPackageText
    ? `${missionLabel} source context: ${sourceContextPackageText}. ${AERIAL_EVIDENCE_ATTACHMENT_CAVEAT}`
    : `${missionLabel} source context is incomplete. ${AERIAL_EVIDENCE_ATTACHMENT_CAVEAT}`;
  const detail = downstreamReady
    ? `${packagePosture.attachmentReadyPackageCount} verified package${packagePosture.attachmentReadyPackageCount === 1 ? "" : "s"} can support ${joinUseLabels(readyUses)} after operator review.`
    : blockers[0] ?? "Complete the evidence package and source context before downstream use.";

  return {
    readiness,
    label,
    detail,
    readyUses,
    blockedUses,
    sourceContext,
    attachmentReadyPackageCount: packagePosture.attachmentReadyPackageCount,
    sourceContextPackageCount: sourceContextPackages.length,
    blockers,
    caveat: AERIAL_EVIDENCE_ATTACHMENT_CAVEAT,
  };
}

export function describeAerialProjectPosture(posture: AerialProjectPosture): string | null {
  if (posture.missionCount === 0) {
    return null;
  }
  if (posture.verificationReadiness === "ready") {
    return `${posture.readyPackageCount} evidence package${posture.readyPackageCount === 1 ? "" : "s"} ready for field verification support.`;
  }
  if (posture.verificationReadiness === "partial") {
    return `${posture.completeMissionCount} of ${posture.missionCount} mission${posture.missionCount === 1 ? "" : "s"} complete. Some evidence packages are partially verified.`;
  }
  if (posture.activeMissionCount > 0) {
    return `${posture.activeMissionCount} mission${posture.activeMissionCount === 1 ? "" : "s"} active. Evidence packages pending QA and verification.`;
  }
  return `${posture.missionCount} mission${posture.missionCount === 1 ? "" : "s"} planned. No evidence packages are ready yet.`;
}
