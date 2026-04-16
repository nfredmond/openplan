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
