/**
 * THE ROLLUP HAD NO FAILURE CHANNEL AT ALL, AND IT SITS ON THE SAME SCREEN AS A
 * BOARD THAT DOES.
 *
 * Every lane below is decided from a count, and the page hands it a count of
 * zero whether the read returned nothing or failed outright. So on a failed
 * aerial read the project detail page said four different things at once: the
 * banner named the failure, the crosslink board marked the lane "Could not be
 * read", this rollup said "No aerial mission or evidence package is linked", and
 * the evidence panel invited the planner to log their first mission. The
 * unlinked sentence is a claim about the project, and it is the one a planner
 * acts on.
 *
 * The two new statuses are the same distinction the crosslink board draws, on
 * purpose: `schema_pending` is a known state with a named operator move, and
 * `unreadable` is a read that failed and names none. They are OPT-IN — a caller
 * that passes no maps gets exactly the three statuses this rollup always had.
 */
import type { StatusTone } from "@/lib/ui/status";

export type ProjectSpineReadinessStatus =
  | "ready_current"
  | "stale_needs_review"
  | "missing_not_linked"
  | "schema_pending"
  | "unreadable";

export type ProjectSpineReadinessLaneKey =
  | "rtp"
  | "reports"
  | "grants"
  | "engagement"
  | "analysis"
  | "aerial";

export type ProjectSpineReadinessLane = {
  key: ProjectSpineReadinessLaneKey;
  label: string;
  status: ProjectSpineReadinessStatus;
  tone: StatusTone;
  headline: string;
  detail: string;
  countLabel: string;
  latestSourceUpdatedAt: string | null;
  reviewedAgainstAt: string | null;
};

export type ProjectSpineReadinessRollup = {
  status: ProjectSpineReadinessStatus;
  tone: StatusTone;
  label: string;
  headline: string;
  detail: string;
  readyCount: number;
  staleCount: number;
  missingCount: number;
  /** Lanes waiting on a migration. Not counted as missing — nobody looked yet. */
  schemaPendingCount: number;
  /** Lanes whose read failed. Not counted as missing — the lookup failed. */
  unreadableCount: number;
  /** The failed lanes by label, so a caller can name them without re-deriving. */
  unreadableLaneLabels: string[];
  latestSourceUpdatedAt: string | null;
  reviewedAgainstAt: string | null;
  lanes: ProjectSpineReadinessLane[];
};

type CountedRecordTiming = {
  count: number;
  latestUpdatedAt?: string | null;
};

export type BuildProjectSpineReadinessInput = {
  projectUpdatedAt?: string | null;
  latestPacketGeneratedAt?: string | null;
  rtp: CountedRecordTiming & {
    postureUpdatedAt?: string | null;
  };
  reports: CountedRecordTiming & {
    refreshRecommendedCount: number;
    noPacketCount: number;
    governanceHoldCount?: number;
    evidenceBackedCount: number;
    comparisonBackedCount: number;
  };
  grants: CountedRecordTiming;
  engagement: CountedRecordTiming;
  analysis: CountedRecordTiming & {
    evidenceBackedReportCount: number;
  };
  aerial: CountedRecordTiming & {
    missionCount: number;
    packageCount: number;
    readyPackageCount: number;
    verificationReadiness?: "none" | "pending" | "partial" | "ready" | string | null;
  };
  /** Lanes whose feeding read could not run because the deployment is behind a migration. */
  pendingSchema?: Partial<Record<ProjectSpineReadinessLaneKey, boolean>>;
  /** Lanes whose feeding read FAILED for any other reason. Wins over `pendingSchema`. */
  unreadable?: Partial<Record<ProjectSpineReadinessLaneKey, boolean>>;
};

const READINESS_LABELS: Record<ProjectSpineReadinessStatus, string> = {
  ready_current: "Ready/current",
  stale_needs_review: "Stale/needs review",
  missing_not_linked: "Missing/not linked",
  schema_pending: "Schema setup pending",
  unreadable: "Could not be read",
};

const READINESS_TONES: Record<ProjectSpineReadinessStatus, StatusTone> = {
  ready_current: "success",
  stale_needs_review: "warning",
  missing_not_linked: "neutral",
  schema_pending: "warning",
  unreadable: "danger",
};

function latestDate(...values: Array<string | null | undefined>): string | null {
  const valid = values
    .map((value) => {
      if (!value) return null;
      const time = new Date(value).getTime();
      return Number.isNaN(time) ? null : { value, time };
    })
    .filter((item): item is { value: string; time: number } => Boolean(item));

  if (valid.length === 0) return null;

  valid.sort((left, right) => right.time - left.time);
  return valid[0].value;
}

function isAfter(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left || !right) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return false;
  return leftTime > rightTime;
}

function lane(
  key: ProjectSpineReadinessLaneKey,
  label: string,
  status: ProjectSpineReadinessStatus,
  headline: string,
  detail: string,
  countLabel: string,
  latestSourceUpdatedAt: string | null,
  reviewedAgainstAt: string | null
): ProjectSpineReadinessLane {
  return {
    key,
    label,
    status,
    tone: READINESS_TONES[status],
    headline,
    detail,
    countLabel,
    latestSourceUpdatedAt,
    reviewedAgainstAt,
  };
}

/**
 * Rewrite a lane whose feeding read did not answer.
 *
 * `countLabel` is overridden along with the prose, for the same reason the
 * crosslink board overrides `detail`: on a failed read it says "0 linked cycles"
 * or "0 missions · 0 packages", and a zero printed beside "could not be read" is
 * the claim being refused an inch to its right.
 */
function withReadState(
  item: ProjectSpineReadinessLane,
  pendingSchema: Partial<Record<ProjectSpineReadinessLaneKey, boolean>>,
  unreadable: Partial<Record<ProjectSpineReadinessLaneKey, boolean>>
): ProjectSpineReadinessLane {
  // UNREADABLE IS CHECKED FIRST. A pending migration names an operator move; a
  // failed read names none. Letting the known state win would send someone to
  // apply a migration that is not the problem and would mask the failure the
  // page's own banner has already disclosed.
  const status: ProjectSpineReadinessStatus | null = unreadable[item.key]
    ? "unreadable"
    : pendingSchema[item.key]
      ? "schema_pending"
      : null;
  if (!status) return item;

  return {
    ...item,
    status,
    tone: READINESS_TONES[status],
    headline:
      status === "unreadable"
        ? `${item.label} could not be read, so this rollup cannot say whether it is linked.`
        : `${item.label} is waiting on schema setup, so its records cannot be counted yet.`,
    detail:
      status === "unreadable"
        ? "Work the read failure named at the top of this page and reload; a lane that could not be read is not a lane with nothing in it."
        : "Apply or verify the missing migration and reload before deciding this lane is not linked.",
    countLabel: "Count unavailable",
  };
}

export function formatProjectSpineReadinessStatus(status: ProjectSpineReadinessStatus): string {
  return READINESS_LABELS[status];
}

export function buildProjectSpineReadinessRollup(
  input: BuildProjectSpineReadinessInput
): ProjectSpineReadinessRollup {
  const latestPacketGeneratedAt = input.latestPacketGeneratedAt ?? null;
  const latestProjectSourceUpdatedAt = latestDate(
    input.projectUpdatedAt,
    input.rtp.latestUpdatedAt,
    input.reports.latestUpdatedAt,
    input.grants.latestUpdatedAt,
    input.engagement.latestUpdatedAt,
    input.analysis.latestUpdatedAt,
    input.aerial.latestUpdatedAt
  );

  const rawLanes: ProjectSpineReadinessLane[] = [];

  const rtpStale =
    input.rtp.count > 0 &&
    Boolean(input.rtp.postureUpdatedAt) &&
    isAfter(input.rtp.latestUpdatedAt, input.rtp.postureUpdatedAt);
  rawLanes.push(
    lane(
      "rtp",
      "RTP portfolio",
      input.rtp.count === 0 ? "missing_not_linked" : rtpStale ? "stale_needs_review" : "ready_current",
      input.rtp.count === 0
        ? "No RTP cycle link is on the project spine."
        : rtpStale
          ? "RTP links changed after the saved project RTP posture."
          : "RTP cycle links are visible on the project spine.",
      input.rtp.count === 0
        ? "Attach this project to the relevant RTP cycle before treating it as part of a regional portfolio."
        : rtpStale
          ? "Operator review is needed so the saved posture reflects the latest cycle link record."
          : "Operators can see which regional plan cycle currently reuses this project record.",
      `${input.rtp.count} linked cycle${input.rtp.count === 1 ? "" : "s"}`,
      input.rtp.latestUpdatedAt ?? null,
      input.rtp.postureUpdatedAt ?? null
    )
  );

  const reportStatus: ProjectSpineReadinessStatus =
    input.reports.count === 0
      ? "missing_not_linked"
      : input.reports.refreshRecommendedCount > 0 ||
          input.reports.noPacketCount > 0 ||
          (input.reports.governanceHoldCount ?? 0) > 0
        ? "stale_needs_review"
        : "ready_current";
  const reportNeedsReview = [
    input.reports.refreshRecommendedCount > 0
      ? `${input.reports.refreshRecommendedCount} refresh recommended`
      : null,
    input.reports.noPacketCount > 0
      ? `${input.reports.noPacketCount} without a generated packet`
      : null,
    (input.reports.governanceHoldCount ?? 0) > 0
      ? `${input.reports.governanceHoldCount} governance hold${(input.reports.governanceHoldCount ?? 0) === 1 ? "" : "s"}`
      : null,
  ].filter((item): item is string => Boolean(item));
  const reportHeadline =
    reportStatus === "missing_not_linked"
      ? "No report packet is linked yet."
      : reportStatus === "stale_needs_review"
        ? (input.reports.governanceHoldCount ?? 0) > 0 &&
          input.reports.refreshRecommendedCount === 0 &&
          input.reports.noPacketCount === 0
          ? "At least one report packet has a governance hold to review."
          : "At least one report packet needs freshness, packet-generation, or governance review."
        : "Linked report packets look current from recorded freshness checks.";
  rawLanes.push(
    lane(
      "reports",
      "Report packets",
      reportStatus,
      reportHeadline,
      reportStatus === "missing_not_linked"
        ? "Create the first project report before relying on this project for packet assembly."
        : reportStatus === "stale_needs_review"
          ? `${reportNeedsReview.join("; ")}.`
          : `${input.reports.evidenceBackedCount} evidence-backed and ${input.reports.comparisonBackedCount} comparison-backed report records are visible.`,
      `${input.reports.count} report${input.reports.count === 1 ? "" : "s"}`,
      input.reports.latestUpdatedAt ?? null,
      latestPacketGeneratedAt
    )
  );

  const grantsStale = input.grants.count > 0 && isAfter(input.grants.latestUpdatedAt, latestPacketGeneratedAt);
  rawLanes.push(
    lane(
      "grants",
      "Grant/funding records",
      input.grants.count === 0 ? "missing_not_linked" : grantsStale ? "stale_needs_review" : "ready_current",
      input.grants.count === 0
        ? "No grant or funding record is linked to this project."
        : grantsStale
          ? "Funding records changed after the latest generated packet."
          : "Grant and funding records are linked to this project.",
      input.grants.count === 0
        ? "Add a funding profile, opportunity, award, or invoice record when grant readiness should be visible."
        : grantsStale
          ? "Review the report language before reusing it for grant planning or prioritization framing."
          : "Operators can review funding context here without treating it as award-likelihood proof.",
      `${input.grants.count} funding record${input.grants.count === 1 ? "" : "s"}`,
      input.grants.latestUpdatedAt ?? null,
      latestPacketGeneratedAt
    )
  );

  const engagementStale = input.engagement.count > 0 && isAfter(input.engagement.latestUpdatedAt, latestPacketGeneratedAt);
  rawLanes.push(
    lane(
      "engagement",
      "Engagement signal",
      input.engagement.count === 0 ? "missing_not_linked" : engagementStale ? "stale_needs_review" : "ready_current",
      input.engagement.count === 0
        ? "No engagement campaign is linked to this project."
        : engagementStale
          ? "Engagement records changed after the latest generated packet."
          : "Project engagement records are connected to the spine.",
      input.engagement.count === 0
        ? "Link a campaign before describing public input as part of this project record."
        : engagementStale
          ? "Review the latest campaign status before reusing packet narrative."
          : "Operators can trace engagement context from this project without leaving the workbench.",
      `${input.engagement.count} campaign${input.engagement.count === 1 ? "" : "s"}`,
      input.engagement.latestUpdatedAt ?? null,
      latestPacketGeneratedAt
    )
  );

  const analysisLinkedCount = Math.max(input.analysis.count, input.analysis.evidenceBackedReportCount);
  const analysisStale = analysisLinkedCount > 0 && isAfter(input.analysis.latestUpdatedAt, latestPacketGeneratedAt);
  rawLanes.push(
    lane(
      "analysis",
      "Analysis evidence",
      analysisLinkedCount === 0 ? "missing_not_linked" : analysisStale ? "stale_needs_review" : "ready_current",
      analysisLinkedCount === 0
        ? "No linked analysis evidence is visible."
        : analysisStale
          ? "Analysis run evidence is newer than the latest generated packet."
          : "Analysis evidence is visible through linked runs or evidence-backed reports.",
      analysisLinkedCount === 0
        ? "Attach saved run evidence or generate an evidence-backed packet before citing analysis support."
        : analysisStale
          ? "Refresh or review packet evidence before using analysis findings in client-facing material."
          : "This is a supervised evidence trail, not a validated forecasting claim.",
      `${input.analysis.count} linked run${input.analysis.count === 1 ? "" : "s"}`,
      input.analysis.latestUpdatedAt ?? null,
      latestPacketGeneratedAt
    )
  );

  const aerialMissing = input.aerial.missionCount === 0 && input.aerial.packageCount === 0;
  const aerialNeedsReview =
    !aerialMissing &&
    (input.aerial.packageCount === 0 ||
      input.aerial.readyPackageCount === 0 ||
      input.aerial.verificationReadiness === "pending" ||
      input.aerial.verificationReadiness === "partial" ||
      isAfter(input.aerial.latestUpdatedAt, latestPacketGeneratedAt));
  rawLanes.push(
    lane(
      "aerial",
      "Aerial evidence",
      aerialMissing ? "missing_not_linked" : aerialNeedsReview ? "stale_needs_review" : "ready_current",
      aerialMissing
        ? "No aerial mission or evidence package is linked."
        : aerialNeedsReview
          ? "Aerial evidence exists but needs package or verification review."
          : "Aerial evidence packages look ready for supervised review.",
      aerialMissing
        ? "Add mission evidence only when aerial context belongs in the project record."
        : aerialNeedsReview
          ? `${input.aerial.readyPackageCount}/${input.aerial.packageCount} packages are ready; verification is ${input.aerial.verificationReadiness ?? "unknown"}.`
          : "Ready packages can support packet review while operators keep verification context explicit.",
      `${input.aerial.missionCount} mission${input.aerial.missionCount === 1 ? "" : "s"} · ${input.aerial.packageCount} package${input.aerial.packageCount === 1 ? "" : "s"}`,
      input.aerial.latestUpdatedAt ?? null,
      latestPacketGeneratedAt
    )
  );

  const lanes = rawLanes.map((item) => withReadState(item, input.pendingSchema ?? {}, input.unreadable ?? {}));

  const readyCount = lanes.filter((item) => item.status === "ready_current").length;
  const staleCount = lanes.filter((item) => item.status === "stale_needs_review").length;
  const missingCount = lanes.filter((item) => item.status === "missing_not_linked").length;
  const schemaPendingCount = lanes.filter((item) => item.status === "schema_pending").length;
  const unreadableLaneLabels = lanes.filter((item) => item.status === "unreadable").map((item) => item.label);
  // Ahead of stale AND of missing: until a lane can be read, no other lane's
  // verdict on this project is worth acting on, and "missing" is precisely the
  // claim a failed read must not produce.
  const status: ProjectSpineReadinessStatus =
    unreadableLaneLabels.length > 0
      ? "unreadable"
      : schemaPendingCount > 0
        ? "schema_pending"
        : staleCount > 0
          ? "stale_needs_review"
          : missingCount > 0
            ? "missing_not_linked"
            : "ready_current";

  return {
    status,
    tone: READINESS_TONES[status],
    label: READINESS_LABELS[status],
    headline:
      status === "unreadable"
        ? "Part of the shared planning spine could not be read."
        : status === "schema_pending"
          ? "Part of the shared planning spine is waiting on schema setup."
          : status === "ready_current"
            ? "The shared planning spine looks current across the visible lanes."
            : status === "stale_needs_review"
              ? "Some connected project outputs need operator review before reuse."
              : "The project spine is still missing one or more linked planning lanes.",
    detail:
      status === "unreadable"
        ? `${unreadableLaneLabels.join(", ")} could not be read, so ${unreadableLaneLabels.length === 1 ? "it is" : "they are"} shown as unavailable rather than as not linked — an unlinked lane here would not mean the records are absent.`
        : status === "schema_pending"
          ? "Lanes waiting on a migration are shown as setup work rather than as not linked, so nobody reads a missing table as a project with nothing attached."
          : status === "ready_current"
            ? "RTP, reporting, grants, engagement, analysis, and aerial context are linked or explicitly current where present."
            : status === "stale_needs_review"
              ? "OpenPlan is surfacing changed records; it is not automatically certifying packet language, forecasts, legal posture, or grant readiness."
              : "Missing lanes are shown as not linked so operators know what has not yet been connected to this project record.",
    readyCount,
    staleCount,
    missingCount,
    schemaPendingCount,
    unreadableCount: unreadableLaneLabels.length,
    unreadableLaneLabels,
    latestSourceUpdatedAt: latestProjectSourceUpdatedAt,
    reviewedAgainstAt: latestPacketGeneratedAt,
    lanes,
  };
}
