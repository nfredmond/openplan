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

// ─────────────────────────────────────────────────────────────────────────────
// Imagery processing jobs (`aerial_processing_jobs`)
//
// THE DEFECT THIS SECTION EXISTS FOR. Every fact below — status, progress,
// message, artifacts, imagery counts, benchmark summary, dispatch_error and the
// callback timestamps — has been written to the database since 20260721000001
// by the processing callback route, and NOTHING read it back. An operator who
// dispatched a flight for processing saw a mission page that rendered as though
// nothing had ever been dispatched.
//
// THE HONESTY CONSTRAINT THAT SHAPES ALL OF IT. OpenPlan does not poll the
// Aerial Intel Platform worker. It learns a job's state ONLY from callbacks the
// worker chooses to deliver. So the strongest true statement about a job that
// stopped sending callbacks is "it stopped reporting" — never "it failed" and
// never "it is still running". These helpers are written so the page cannot
// accidentally claim either.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The values `aerial_processing_jobs.status` may hold, in the order of the CHECK
 * constraint in `20260721000001_aerial_processing_jobs.sql`.
 *
 * Five come from the worker contract (`PROCESSING_CALLBACK_STATUSES`); two are
 * written by OpenPlan itself and exist nowhere in the contract — `requested`,
 * recorded BEFORE the worker is called so a crash cannot orphan an accepted
 * job, and `dispatch_failed`, recorded when the worker never took it at all.
 * That second pair is why this list is not imported from `processing-contract`.
 */
export const AERIAL_PROCESSING_JOB_STATUSES = [
  "requested",
  "accepted",
  "running",
  "succeeded",
  "failed",
  "canceled",
  "dispatch_failed",
] as const;

export type AerialProcessingJobStatus = (typeof AERIAL_PROCESSING_JOB_STATUSES)[number];

/** Statuses after which no further callback is expected. */
const AERIAL_PROCESSING_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "succeeded",
  "failed",
  "canceled",
  "dispatch_failed",
]);

export function isTerminalAerialProcessingJobStatus(status: string): boolean {
  return AERIAL_PROCESSING_TERMINAL_STATUSES.has(status);
}

export function formatAerialProcessingJobStatusLabel(status: string): string {
  switch (status) {
    case "requested":
      return "Requested";
    case "accepted":
      return "Accepted by worker";
    case "running":
      return "Running";
    case "succeeded":
      return "Succeeded";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
    case "dispatch_failed":
      return "Never reached the worker";
    default:
      // A status a later migration adds that this build does not know is still
      // a real recorded value. Printing it verbatim is truer than "Unknown" —
      // the same rule this file already applies to artifact kinds — and it is
      // what an operator would quote at the worker.
      return status.trim() || "No status recorded";
  }
}

export function aerialProcessingJobStatusTone(
  status: string
): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "requested":
    case "accepted":
      return "neutral";
    case "running":
      return "info";
    case "succeeded":
      return "success";
    case "failed":
    case "dispatch_failed":
      return "danger";
    case "canceled":
      return "warning";
    default:
      return "neutral";
  }
}

/**
 * How long a non-terminal job may go without a worker callback before the page
 * stops presenting it as in progress.
 *
 * CONFIGURATION, NOT A CONSTANT WITH A NICE NAME. The right value depends on
 * the deployment's own worker: a `fast-preview` preset reports every few
 * minutes, a `high-quality` reconstruction of a large corridor may be quiet for
 * an hour between progress callbacks. So an operator sets it, and the default
 * is only what a deployment that has said nothing gets.
 *
 * Anything non-positive or unparseable is treated as UNSET rather than as zero:
 * a typo must not make every live job read as abandoned.
 */
export const AERIAL_PROCESSING_SILENCE_MINUTES_ENV = "OPENPLAN_AERIAL_PROCESSING_SILENCE_MINUTES";
export const DEFAULT_AERIAL_PROCESSING_SILENCE_MINUTES = 60;

export function resolveAerialProcessingSilenceMinutes(raw: string | null | undefined): number {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_AERIAL_PROCESSING_SILENCE_MINUTES;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_AERIAL_PROCESSING_SILENCE_MINUTES;
  return parsed;
}

/**
 * "3 days", "42 minutes" — the elapsed half of a sentence the caller finishes
 * ("… ago", "… of silence"). Returns null when the timestamp is missing or
 * unparseable, so a caller can omit the phrase rather than print "NaN".
 */
export function describeAerialElapsedSince(iso: string | null | undefined, now: Date): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;

  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** One artifact entry as it survived a defensive read of the vendor JSON. */
export type AerialProcessingArtifactEntry = {
  /** The worker's own `kind` string, never normalized away — an unknown kind is shown as itself. */
  kind: string;
  kindLabel: string;
  /** Only set when the entry carried an http(s) URL; never fabricated. */
  downloadUrl: string | null;
  expiresAt: string | null;
  /** null when `expiresAt` is absent or unparseable — "unknown", not "still valid". */
  expired: boolean | null;
  sizeBytes: number | null;
  contentType: string | null;
};

export type AerialProcessingArtifactReading = {
  /** True when the column held an array — distinct from an array that held nothing. */
  recorded: boolean;
  entries: AerialProcessingArtifactEntry[];
  /** Entries present in the JSON that this reader could not make sense of. */
  unreadableEntryCount: number;
  /** Set when the column held something that is not an array at all. */
  malformed: boolean;
};

export function formatArtifactKindLabel(kind: string): string {
  switch (kind) {
    case "orthomosaic":
      return "Orthomosaic";
    case "dsm":
      return "Digital surface model (DSM)";
    case "dtm":
      return "Digital terrain model (DTM)";
    case "point_cloud":
      return "Point cloud";
    case "mesh":
      return "Mesh";
    default:
      // A kind this build does not know is still a real thing the worker made.
      // Showing it verbatim is truer than calling it "Unknown".
      return kind;
  }
}

/**
 * Read `aerial_processing_jobs.artifacts` — VENDOR JSON, written straight from
 * the worker callback — without trusting its shape.
 *
 * Two reasons this is defensive rather than a cast. The column is populated by
 * whatever the platform sent, and the platform owns that schema; and OpenPlan's
 * own artifact-custody work is in flight, so the shape may gain fields at any
 * time. Anything unrecognized is COUNTED and disclosed rather than dropped —
 * silently rendering four of six artifacts would be the same class of defect
 * this whole surface exists to remove.
 */
export function readAerialProcessingArtifacts(
  value: unknown,
  now: Date
): AerialProcessingArtifactReading {
  if (value === null || value === undefined) {
    return { recorded: false, entries: [], unreadableEntryCount: 0, malformed: false };
  }
  if (!Array.isArray(value)) {
    return { recorded: false, entries: [], unreadableEntryCount: 0, malformed: true };
  }

  const entries: AerialProcessingArtifactEntry[] = [];
  let unreadableEntryCount = 0;

  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      unreadableEntryCount += 1;
      continue;
    }
    const record = raw as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind.trim() : "";
    if (!kind) {
      unreadableEntryCount += 1;
      continue;
    }

    const downloadUrl =
      typeof record.downloadUrl === "string" && /^https?:\/\//i.test(record.downloadUrl.trim())
        ? record.downloadUrl.trim()
        : null;

    const expiresAtRaw = typeof record.expiresAt === "string" ? record.expiresAt.trim() : "";
    const expiresAtTime = expiresAtRaw ? new Date(expiresAtRaw).getTime() : Number.NaN;
    const expired = Number.isNaN(expiresAtTime) ? null : expiresAtTime <= now.getTime();

    entries.push({
      kind,
      kindLabel: formatArtifactKindLabel(kind),
      downloadUrl,
      expiresAt: expiresAtRaw || null,
      expired,
      sizeBytes:
        typeof record.sizeBytes === "number" && Number.isFinite(record.sizeBytes)
          ? record.sizeBytes
          : null,
      contentType: typeof record.contentType === "string" && record.contentType.trim()
        ? record.contentType.trim()
        : null,
    });
  }

  return { recorded: true, entries, unreadableEntryCount, malformed: false };
}

/**
 * The one sentence that must accompany any artifact list.
 *
 * These are links the WORKER issued against its own storage, and they expire.
 * OpenPlan holds no copy, so an expired link is simply gone until processing is
 * re-requested. Saying so is the difference between reporting an output and
 * implying a file this system has custody of.
 */
export const AERIAL_PROCESSING_ARTIFACT_CUSTODY_NOTE =
  "These are time-limited links the processing worker issued against its own storage. OpenPlan records the list, not the files — once a link expires, the output is only retrievable by re-requesting processing.";

/** Hostname of the imagery source, or null. The full URL is deliberately never rendered: it is
 *  a signed URL supplied by the operator and belongs in nobody's browser history. */
export function describeAerialImagerySourceHost(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).host || null;
  } catch {
    return null;
  }
}

/** The fields of a processing job row this module reasons about. */
export type AerialProcessingJobLike = {
  status: string;
  progress?: number | string | null;
  message?: string | null;
  dispatch_error?: string | null;
  last_callback_at?: string | null;
  created_at?: string | null;
};

/**
 * What the page is entitled to say about whether a job is alive.
 *
 * `silent` is the verdict this whole file was written for: a non-terminal job
 * whose worker has not spoken inside the configured window. It is NOT a
 * failure and NOT a completion, and the copy attached to it says so.
 */
export type AerialProcessingJobLiveness =
  | "reporting"
  | "silent"
  | "succeeded"
  | "failed"
  | "canceled";

export type AerialProcessingJobSummary = {
  status: string;
  statusLabel: string;
  statusTone: "neutral" | "info" | "success" | "warning" | "danger";
  isTerminal: boolean;
  liveness: AerialProcessingJobLiveness;
  livenessLabel: string;
  livenessDetail: string;
  livenessTone: "neutral" | "info" | "success" | "warning" | "danger";
  /** The last moment the WORKER spoke, or null when it never has. */
  lastCallbackAt: string | null;
  /** Which timestamp the liveness verdict was measured from. */
  measuredFrom: "worker_callback" | "request_recorded" | "nothing";
  silentFor: string | null;
  progressPercent: number | null;
  progressLabel: string | null;
  /** Present only for the three unhappy terminal states. */
  failureHeading: string | null;
  failureDetail: string | null;
};

function readProgressPercent(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  // NUMERIC(5,2) can arrive as a string depending on the PostgREST/driver path.
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(100, Math.max(0, parsed));
}

function trimmedOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Turn one job row into the set of statements the page may make about it.
 *
 * `now` and `silenceMinutes` are parameters, not ambient reads, so both sides
 * of the silence boundary are testable without touching the clock or the
 * environment.
 */
export function summarizeAerialProcessingJob(
  job: AerialProcessingJobLike,
  options: { now: Date; silenceMinutes: number }
): AerialProcessingJobSummary {
  const status = job.status;
  const isTerminal = isTerminalAerialProcessingJobStatus(status);
  const lastCallbackAt = trimmedOrNull(job.last_callback_at);
  const measuredFromIso = lastCallbackAt ?? trimmedOrNull(job.created_at);
  const measuredFrom: AerialProcessingJobSummary["measuredFrom"] = lastCallbackAt
    ? "worker_callback"
    : measuredFromIso
      ? "request_recorded"
      : "nothing";
  const elapsed = describeAerialElapsedSince(measuredFromIso, options.now);
  const progressPercent = readProgressPercent(job.progress);
  const message = trimmedOrNull(job.message);
  const dispatchError = trimmedOrNull(job.dispatch_error);

  let liveness: AerialProcessingJobLiveness;
  let livenessLabel: string;
  let livenessDetail: string;
  let livenessTone: AerialProcessingJobSummary["livenessTone"];
  let failureHeading: string | null = null;
  let failureDetail: string | null = null;

  if (status === "succeeded") {
    liveness = "succeeded";
    livenessLabel = "Finished";
    livenessDetail = elapsed
      ? `The worker reported success ${elapsed} ago.`
      : "The worker reported success.";
    livenessTone = "success";
  } else if (status === "canceled") {
    liveness = "canceled";
    livenessLabel = "Canceled";
    livenessDetail = elapsed ? `Canceled ${elapsed} ago.` : "Canceled.";
    livenessTone = "warning";
    failureHeading = "Why it stopped";
    failureDetail = message ?? "No reason was recorded with the cancellation.";
  } else if (status === "failed" || status === "dispatch_failed") {
    liveness = "failed";
    livenessLabel = status === "dispatch_failed" ? "Never started" : "Failed";
    livenessDetail =
      status === "dispatch_failed"
        ? elapsed
          ? `The dispatch attempt ${elapsed} ago did not reach the worker, so no processing was ever performed.`
          : "The dispatch attempt did not reach the worker, so no processing was ever performed."
        : elapsed
          ? `The worker reported failure ${elapsed} ago.`
          : "The worker reported failure.";
    livenessTone = "danger";
    failureHeading = status === "dispatch_failed" ? "What OpenPlan recorded" : "What the worker reported";
    failureDetail =
      status === "dispatch_failed"
        ? (dispatchError ??
          message ??
          "No detail was recorded. The job row exists because OpenPlan writes it before calling the worker, so the request was made — nothing came back to describe why it was refused.")
        : (message ??
          dispatchError ??
          "The worker reported a failure without a message. Its own logs are the only place the reason exists.");
  } else {
    // Non-terminal: requested / accepted / running, plus any status a future
    // migration adds that this build does not know.
    const silenceMs = options.silenceMinutes * 60_000;
    const measuredTime = measuredFromIso ? new Date(measuredFromIso).getTime() : Number.NaN;
    const isSilent =
      Number.isNaN(measuredTime) || options.now.getTime() - measuredTime > silenceMs;

    if (isSilent) {
      liveness = "silent";
      livenessLabel = "Stopped reporting";
      livenessTone = "warning";
      const silenceSince =
        measuredFrom === "worker_callback"
          ? elapsed
            ? `The worker last sent a callback ${elapsed} ago`
            : "The worker's last callback has no usable timestamp"
          : measuredFrom === "request_recorded"
            ? elapsed
              ? `The request was recorded ${elapsed} ago and the worker has never called back`
              : "The request was recorded and the worker has never called back"
            : "This job carries no timestamp at all";
      livenessDetail =
        `${silenceSince}, which is longer than this deployment's ${options.silenceMinutes}-minute reporting window. ` +
        `OpenPlan cannot poll the worker — it only learns a job's state from callbacks — so this job may still be running there, or may have died. ` +
        `Nothing here has observed it finish. Its recorded status is still "${formatAerialProcessingJobStatusLabel(status)}".`;
    } else {
      liveness = "reporting";
      livenessLabel = "In progress";
      livenessTone = "info";
      livenessDetail =
        measuredFrom === "worker_callback"
          ? `The worker last reported ${elapsed} ago.`
          : `Requested ${elapsed} ago; waiting for the worker's first callback.`;
    }
  }

  const progressLabel =
    progressPercent === null
      ? null
      : liveness === "succeeded"
        ? `${progressPercent}% complete`
        : liveness === "reporting"
          ? `${progressPercent}% reported`
          : `${progressPercent}% when it last reported`;

  return {
    status,
    statusLabel: formatAerialProcessingJobStatusLabel(status),
    statusTone: aerialProcessingJobStatusTone(status),
    isTerminal,
    liveness,
    livenessLabel,
    livenessDetail,
    livenessTone,
    lastCallbackAt,
    measuredFrom,
    silentFor: liveness === "silent" ? elapsed : null,
    progressPercent,
    progressLabel,
    failureHeading,
    failureDetail,
  };
}

export type AerialMissionProcessingPosture = {
  jobCount: number;
  inProgressCount: number;
  silentCount: number;
  succeededCount: number;
  failedCount: number;
  canceledCount: number;
  /** True while at least one job could still produce a callback — what the page polls on. */
  hasOpenJob: boolean;
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
};

/**
 * The one chip that heads the processing section.
 *
 * Precedence is deliberate: silence outranks progress, because a job nobody has
 * heard from is the thing an operator has to act on, and a header that read
 * "1 in progress" while the worker had been quiet for three days would be the
 * defect restated as a summary.
 */
export function summarizeAerialMissionProcessingPosture(
  summaries: Array<Pick<AerialProcessingJobSummary, "liveness">>
): AerialMissionProcessingPosture {
  const count = (liveness: AerialProcessingJobLiveness) =>
    summaries.filter((summary) => summary.liveness === liveness).length;

  const inProgressCount = count("reporting");
  const silentCount = count("silent");
  const succeededCount = count("succeeded");
  const failedCount = count("failed");
  const canceledCount = count("canceled");
  const jobCount = summaries.length;

  const base = {
    jobCount,
    inProgressCount,
    silentCount,
    succeededCount,
    failedCount,
    canceledCount,
    hasOpenJob: inProgressCount + silentCount > 0,
  };

  if (jobCount === 0) {
    return { ...base, label: "No processing jobs", tone: "neutral" };
  }
  if (silentCount > 0) {
    return { ...base, label: `${silentCount} not reporting`, tone: "warning" };
  }
  if (inProgressCount > 0) {
    return { ...base, label: `${inProgressCount} in progress`, tone: "info" };
  }
  if (failedCount > 0) {
    return { ...base, label: `${failedCount} failed`, tone: "danger" };
  }
  if (succeededCount > 0) {
    return { ...base, label: `${succeededCount} succeeded`, tone: "success" };
  }
  return { ...base, label: `${canceledCount} canceled`, tone: "warning" };
}

/**
 * What the mission page may say about requesting processing, given what this
 * deployment is configured for and what this member is allowed to do.
 *
 * WHY IT IS NOT `describeAerialProcessingAvailability`. That function's
 * configured branch ends with "There is no request button or job-status view on
 * this page yet, so the request has to be made against that endpoint directly."
 * That sentence was true when it was written and is now false in both halves.
 * It lives in `processing-availability.ts`, which belongs to another lane, so
 * the page composes its own configured-branch copy here rather than rendering a
 * stale claim. The unconfigured branch of that function is still accurate —
 * every word of it — and the page still renders it verbatim.
 */
export function describeAerialProcessingRequestSurface(input: {
  workerConfigured: boolean;
  canRequest: boolean;
}): { title: string; description: string; tone: "neutral" | "info" | "warning" } {
  if (!input.workerConfigured) {
    // The caller renders describeAerialProcessingAvailability(false) instead;
    // this branch exists so the function is total rather than partial.
    return {
      title: "Imagery processing is not configured on this deployment",
      description:
        "No processing can be requested until this deployment sets its Aerial Intel Platform worker credentials.",
      tone: "warning",
    };
  }

  if (!input.canRequest) {
    return {
      title: "Imagery processing is configured — viewers cannot request it",
      description:
        "This deployment has an Aerial Intel Platform worker configured. Requesting processing changes workspace content, so it needs member access or above; jobs already dispatched are listed below either way.",
      tone: "neutral",
    };
  }

  return {
    title: "Imagery processing is configured",
    description:
      "Give the worker a link it can fetch the imagery ZIP from. OpenPlan records the job before dispatching it, then advances it as the worker calls back — it never polls, so everything below is as of the worker's last callback.",
    tone: "info",
  };
}
