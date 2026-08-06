"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileJson2, Loader2, RefreshCcw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  buildEvidenceHighlights,
  describeEmploymentProvenance,
  employmentUsedSyntheticFallback,
  evidenceTransitStatus,
  formatDurationSeconds,
  labelForEngineKey,
  labelForKpiCategory,
  normalizeEvidencePacket,
  summarizeEvidenceCategories,
  type EvidenceTransitStatus,
  type NormalizedEvidencePacket,
} from "@/lib/models/evidence-packet";
import { modelingClaimStatusLabel } from "@/lib/models/evidence-backbone";
import type { ModelingClaimStatus } from "@/lib/models/evidence-backbone";
import type { StatusTone } from "@/lib/ui/status";
import { ESTIMATED_BADGE_LABEL } from "@/lib/analysis/estimated-source";
import {
  buildModelRunKpiComparisonSummary,
  formatModelRunKpiDelta,
  formatModelRunKpiPercentDelta,
  formatModelRunKpiValue,
} from "@/lib/models/kpi-comparison";
import type { BehavioralDemandComparison } from "@/lib/models/behavioral-kpi-comparison";
import { getManagedRunModeDefinition } from "@/lib/models/run-modes";
import type { ModelRunExecutionOutlook } from "@/lib/models/run-dispatch";

type ModelRunComparisonCandidate = {
  id: string;
  runTitle: string;
  completedAt: string | null;
  scenarioLabel: string | null;
};

/** The KPI route's refusal to diff runs from different engines (same-named
 * KPIs across engines are different estimators, so a delta between them is an
 * estimator artifact, not a scenario finding). Rendered as a refusal with its
 * reason — never as "0 KPI shifts", which would assert the runs agree. */
type CrossEngineComparisonBlock = {
  status: string;
  current_engine_key: string | null;
  baseline_engine_key: string | null;
  message: string;
};

function claimStatusTone(status: ModelingClaimStatus): StatusTone {
  if (status === "calibrated_to_counts" || status === "claim_grade_passed") return "success";
  if (status === "screening_grade") return "warning";
  return "neutral";
}

/** First-class transit-status label so a 0 transit share is never read as "no
 * transit demand" — the honest distinction between "modeled" and a feed
 * limitation.
 *
 * `noFeedReason` refines the label without widening `EvidenceTransitStatus`. The
 * worker reports a run stopped by its wall-clock budget as `feed_unavailable`
 * because that is the only enumerated status that keeps the transit block on
 * screen at all — but the feed in that case was read and is fine, so a badge
 * reading "feed unavailable" states something untrue about it and contradicts the
 * body text two lines below, which says nothing is known to be wrong with the
 * feed. The reason is what actually happened; the badge follows it. */
function transitStatusDisplay(
  status: EvidenceTransitStatus | null,
  noFeedReason?: string | null
): { label: string; tone: StatusTone } | null {
  if (status === "feed_unavailable" && noFeedReason === "transit_skim_timed_out") {
    return { label: "Transit not modeled — time budget exceeded", tone: "warning" };
  }
  switch (status) {
    case "modeled":
      return { label: "Transit modeled (local GTFS)", tone: "info" };
    case "no_local_feed":
      return { label: "Transit not modeled — no local GTFS feed", tone: "warning" };
    case "feed_unavailable":
      return { label: "Transit not modeled — feed unavailable", tone: "warning" };
    case "not_run":
      return { label: "Transit not modeled", tone: "neutral" };
    default:
      return null;
  }
}

/**
 * Feed provenance the AequilibraE worker records beside `transit_status`, in
 * `mode_split.transit_los`. The status badge alone says whether transit was
 * modeled; this says WHICH feed and FROM WHEN — the two things a planner has to
 * be able to state when the resulting VMT number is challenged, because leaving
 * transit out overstates auto and inflates VMT.
 *
 * Read here rather than in `evidence-packet.ts` because there is nothing to
 * normalize: the packet normalizer already carries `mode_split` through
 * verbatim, and every field below is display-only.
 */
type TransitFeedProvenance = {
  /** How the run chose a feed, or that it chose none. */
  origin: string | null;
  /** The feed itself — its URL when fetched, its file name when read from disk. */
  feedRef: string | null;
  /** GTFS calendar window as `YYYYMMDD..YYYYMMDD`, or null when the feed stated none. */
  servicePeriod: string | null;
  /** The weekday, or explicit service date, whose schedule was skimmed. */
  serviceDay: string | null;
  routeCount: number | null;
  servedStopCount: number | null;
  /** Why no feed was applied, when none was. */
  noFeedReason: string | null;
  /** The loader's own message when the feed could not be read at all. */
  error: string | null;
  /** Why per-study-area discovery did not run, when the run used a fallback feed
   * instead. Present even on a SUCCESSFUL run — a fallback that reads as a
   * successful discovery is worse than no fallback, because it lets a planner
   * believe the catalog was consulted for their area when it never answered. */
  discoveryError: string | null;
  /**
   * The workspace feed version the worker actually read, when the run was
   * handed one. Read from the WORKER's echo rather than from the launch stamp:
   * `input_snapshot_json` is member-writable, so a value taken from it would be
   * a claim about what the worker did, authored by whoever could edit the run.
   */
  feedVersionId: string | null;
  /** The checksum the worker VERIFIED against the bytes it read. */
  feedChecksumSha256: string | null;
  /**
   * The version row's calendar window, kept DISTINCT from `servicePeriod`,
   * which the worker's own parser derives from `calendar.txt`. Migration
   * 20260805000006 states these legitimately disagree in real feeds;
   * collapsing them destroys the evidence that they did.
   */
  feedServiceStartDate: string | null;
  feedServiceEndDate: string | null;
  /** Whether that window had already ended when the skim ran. */
  feedScheduleExpired: boolean | null;
  /** "Expired" is a claim about a moment, so the moment is recorded. */
  feedExpiryEvaluatedAt: string | null;
  /** A per-run selection displaced this deployment's GTFS_URL / GTFS_PATH. */
  operatorEnvOverridden: boolean | null;
};

const TRANSIT_FEED_ORIGIN_LABELS: Record<string, string> = {
  discovered_catalog: "Discovered for this study area (Mobility Database catalog)",
  operator_url: "Operator-configured feed URL",
  operator_path: "Operator-configured feed file",
  bundled_default: "Feed bundled with the worker (discovery switched off)",
  // Deliberately worded so it can never be mistaken for a discovery hit: the
  // catalog was never consulted for this area, and the feed that was used is the
  // one that ships with the worker, applied only because its own stops fall
  // inside the study area.
  bundled_after_catalog_unavailable:
    "Feed bundled with the worker (fallback — the feed catalog could not be reached)",
  // The one origin that names a feed a PLANNER put into OpenPlan. It outranks
  // the operator's env feed and every discovery path, so the label says the
  // choice was theirs rather than the deployment's.
  workspace_feed_version: "Chosen for this run from this workspace's own ingested feeds",
  none: "No feed applied",
};

/**
 * Every machine reason the worker can put in `transit_los.no_feed_reason`.
 *
 * EXPORTED SO A GUARD CAN DERIVE THE WORKER'S VOCABULARY AND COMPARE. A reason
 * with no entry here falls through to the generic sentence below, and the
 * generic sentence used to make a COVERAGE CLAIM about the study area — the
 * exact claim both lanes' code takes care never to make for a SELECTION
 * failure. Three reasons the worker emits had no label
 * (`selected_feed_stamp_version_unsupported`, `selected_feed_unavailable`,
 * `feed_publishes_frequencies_only`), so three real outcomes rendered as
 * "no GTFS feed was applied to this study area" — an unchecked assertion about
 * the area sitting underneath a VMT number a planner has to defend.
 */
export const TRANSIT_NO_FEED_REASON_LABELS: Record<string, string> = {
  discovery_found_no_covering_feed:
    "No published GTFS feed in the Mobility Database catalog covers this study area.",
  // Distinct from the line above on purpose: a catalog that answered and listed
  // nothing is a coverage fact, whereas a catalog we could not reach settles
  // nothing at all. Collapsing the two would tell a planner their area has no
  // transit when only a download failed.
  feed_catalog_unavailable:
    "The published-feed catalog could not be reached, so whether a feed covers this study area is unknown.",
  feed_has_no_stops_in_study_area:
    "The feed this run loaded has no stops inside the study area, so it was not skimmed.",
  feed_load_failed: "The feed could not be read.",
  // Separate from `feed_load_failed` because the two send a planner to different
  // places: a feed that could not be read is the publisher's problem, whereas a
  // feed that read fine and then broke the skim is ours. Telling someone their
  // feed is unreadable when it is not costs them a day chasing a file that is
  // fine.
  transit_skim_failed:
    "The feed named above was read, but the transit skim did not complete, so transit was not modeled.",
  // Ran out of time, not out of data. Kept separate from the two failures above
  // because nothing about the feed is wrong here — the fix is the operator's
  // (a larger budget, or a smaller zone system), not the transit agency's, and
  // saying "your feed could not be read" would send a planner to the wrong door.
  transit_skim_timed_out:
    "The transit stage exceeded this deployment's wall-clock budget and was stopped, so transit was not modeled. " +
    "Nothing is known to be wrong with the feed itself.",

  // ── The selection refusals ────────────────────────────────────────────────
  // Every one of these follows a PLANNER naming a feed, so each says what they
  // can do about it. None of them falls back to another feed: a run that
  // silently skimmed something other than the feed named on screen is the exact
  // camouflage this whole handoff was built to prevent.
  selected_feed_not_found:
    "The transit feed chosen for this run is no longer one of this workspace's feeds, so nothing was skimmed.",
  selected_feed_not_ready:
    "The transit feed chosen for this run has no completed ingest in use, so there was nothing to read. " +
    "Bring the feed in again from the Data Hub, then relaunch.",
  selected_feed_bytes_unavailable:
    "The archive behind the chosen feed's ingest could not be read, so the modeling worker was not given " +
    "the bytes OpenPlan parsed. Bring the feed in again from the Data Hub, then relaunch.",
  // The one refusal that is about INTEGRITY rather than availability, and it is
  // deliberately not a fallback: bytes that do not match the recorded checksum
  // are not this feed, whatever else they may be.
  selected_feed_checksum_mismatch:
    "The archive stored for the chosen feed did not match the checksum OpenPlan recorded when it parsed " +
    "the feed, so it was not skimmed. Bring the feed in again from the Data Hub, then relaunch.",
  selected_feed_has_no_stops_in_study_area:
    "The transit feed chosen for this run has no stops inside this study area, so it was not skimmed. " +
    "That is a fact about this feed, not about the area — another agency may serve it.",
  // NARROWED 2026-08-06. This no longer means "the feed contains a
  // frequencies.txt row" — both lanes stopped throwing a whole feed away over
  // that. It now means EVERY trip on the modeled service day was published as a
  // headway band, so dropping them left the skim nothing to measure.
  selected_feed_uses_frequencies:
    "Every trip on the modeled service day of the transit feed chosen for this run is published as a " +
    "headway range (frequencies.txt) rather than individual departures, so the transit skim had nothing " +
    "to measure. Re-ingesting will not change it — it is how the agency publishes.",
  selected_feed_handoff_failed:
    "OpenPlan could not resolve the transit feed chosen for this run, so none was handed to the modeling " +
    "worker.",
  // The app declined to hand the chosen feed over and said why in the stamp; the
  // worker repeats that sentence verbatim beside this label rather than
  // second-guessing a decision it cannot see the inputs to.
  selected_feed_unavailable:
    "The transit feed chosen for this run could not be handed to the modeling worker. The reason " +
    "recorded when the run was launched is shown with this run's transit feed selection.",
  // A VERSION SKEW, not a feed problem, and the two send a planner to completely
  // different people. The worker refuses a handoff format it does not recognise
  // instead of guessing — guessing is how a run skims a feed nobody chose while
  // every surface names the one the planner picked.
  selected_feed_stamp_version_unsupported:
    "The modeling worker is older than the app that launched this run and does not understand how the " +
    "chosen transit feed was handed over, so it skimmed none rather than guess which feed was meant. " +
    "Whoever operates this deployment needs to upgrade the worker; then relaunch.",
  // Reached when the worker's OWN feed — operator-configured, discovered, or
  // bundled — turned out to publish nothing but headway bands. Named apart from
  // "the feed could not be read" so nobody is sent to fix a feed that is fine.
  feed_publishes_frequencies_only:
    "The feed this run loaded publishes its service as headway ranges (frequencies.txt) rather than " +
    "individual departures, so the transit skim had nothing to measure. Nothing is wrong with the feed; " +
    "it is how that agency publishes.",
};

function readTransitProvenance(packet: NormalizedEvidencePacket): TransitFeedProvenance | null {
  const engineSummary = packet.outputs.engine_summary;
  if (!engineSummary) return null;
  const modeSplit = engineSummary.mode_split;
  if (!modeSplit || typeof modeSplit !== "object") return null;
  const los = (modeSplit as Record<string, unknown>).transit_los;
  if (!los || typeof los !== "object") return null;

  const text = (key: string): string | null => {
    const value = (los as Record<string, unknown>)[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  };
  const count = (key: string): number | null => {
    const value = (los as Record<string, unknown>)[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };
  // Strictly boolean. A missing key means the worker that ran this predates the
  // handoff and said nothing — which must render as "not recorded", never as
  // `false`, because `false` here is a positive claim (the schedule had not
  // expired; no operator feed was displaced).
  const flag = (key: string): boolean | null => {
    const value = (los as Record<string, unknown>)[key];
    return typeof value === "boolean" ? value : null;
  };

  return {
    origin: text("feed_origin"),
    feedRef: text("source_url") ?? text("source_name"),
    servicePeriod: text("service_period"),
    serviceDay: text("service_day"),
    routeCount: count("n_routes"),
    servedStopCount: count("n_served_stops"),
    noFeedReason: text("no_feed_reason"),
    error: text("error"),
    discoveryError: text("discovery_error"),
    feedVersionId: text("feed_version_id"),
    feedChecksumSha256: text("feed_checksum_sha256"),
    feedServiceStartDate: text("feed_service_start_date"),
    feedServiceEndDate: text("feed_service_end_date"),
    feedScheduleExpired: flag("feed_schedule_expired"),
    feedExpiryEvaluatedAt: text("feed_expiry_evaluated_at"),
    operatorEnvOverridden: flag("operator_env_overridden"),
  };
}

/**
 * The transit-feed selection stamped into the run at launch, as a surface needs
 * it.
 *
 * READ SEPARATELY FROM THE WORKER'S ECHO, AND NEVER MERGED WITH IT. This is
 * what OpenPlan ASKED FOR; `TransitFeedProvenance` is what the worker DID. On a
 * healthy run they agree, and on the runs that matter — a queued run nothing
 * picked up, a selection the worker refused — only one of the two exists. A
 * panel that merged them would present a request as an outcome.
 */
type TransitFeedSelection = {
  status: string | null;
  agencyName: string | null;
  sourceKind: string | null;
  serviceEndDate: string | null;
  scheduleExpiredAtLaunch: boolean | null;
  coversStudyArea: string | null;
  reason: string | null;
};

const TRANSIT_SELECTION_STATUS_LABELS: Record<string, string> = {
  selected: "A feed from this workspace was handed to the modeling worker",
  not_selected: "No workspace feed was named; the worker chose one itself",
  unavailable: "A workspace feed was named but could not be handed over",
  // NO LONGER PRODUCED (2026-08-06). Kept because runs launched before that date
  // carry it, and dropping the label would render those stamps as a bare status
  // code. It meant "this feed's ingest saw a frequencies.txt trip" — a rule that
  // cost a 18,150-trip agency its whole feed over 4 rows and is gone from both
  // lanes. The wording says when it applied so nobody reads an old run as a
  // statement about how OpenPlan behaves now.
  unsupported_by_skim:
    "A workspace feed was named and withheld by a build that refused frequency-based feeds (before 2026-08-06)",
  handoff_failed: "A workspace feed was named but OpenPlan could not resolve it",
};

function readTransitSelection(packet: NormalizedEvidencePacket): TransitFeedSelection | null {
  const stamp = packet.inputs.input_snapshot?.transitFeed;
  if (!stamp || typeof stamp !== "object" || Array.isArray(stamp)) return null;
  const record = stamp as Record<string, unknown>;

  const text = (key: string): string | null => {
    const value = record[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  };

  return {
    status: text("status"),
    agencyName: text("agencyName"),
    sourceKind: text("sourceKind"),
    serviceEndDate: text("serviceEndDate"),
    scheduleExpiredAtLaunch:
      typeof record.scheduleExpiredAtLaunch === "boolean" ? record.scheduleExpiredAtLaunch : null,
    coversStudyArea: text("coversStudyArea"),
    reason: text("reason"),
  };
}

/** GTFS calendar dates are `YYYYMMDD`. Rendered as ISO `YYYY-MM-DD` rather than a
 * locale date on purpose: `new Date("20260301")` resolves against UTC and would
 * shift a day backwards for most viewers. A feed's service window is a fact
 * printed in the feed, not a moment in the reader's timezone. */
function formatGtfsDate(value: string): string {
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value;
}

function formatServiceWindow(servicePeriod: string | null): string {
  if (!servicePeriod) return "Not stated in the feed calendar";
  const [start, end] = servicePeriod.split("..");
  if (!start || !end) return servicePeriod;
  return `${formatGtfsDate(start)} → ${formatGtfsDate(end)}`;
}

function formatServiceDay(serviceDay: string | null): string {
  if (!serviceDay || serviceDay === "unknown") return "Not determined from the feed calendar";
  if (serviceDay.startsWith("date:")) return `Service date ${formatGtfsDate(serviceDay.slice(5))}`;
  return serviceDay.charAt(0).toUpperCase() + serviceDay.slice(1);
}

function formatServiceFound(provenance: TransitFeedProvenance): string | null {
  if (provenance.routeCount === null && provenance.servedStopCount === null) return null;
  const parts: string[] = [];
  if (provenance.routeCount !== null) {
    parts.push(`${provenance.routeCount.toLocaleString()} route${provenance.routeCount === 1 ? "" : "s"}`);
  }
  if (provenance.servedStopCount !== null) {
    parts.push(
      `${provenance.servedStopCount.toLocaleString()} served stop${provenance.servedStopCount === 1 ? "" : "s"}`
    );
  }
  return parts.join(" · ");
}

function shortHash(hash: string | null): string | null {
  if (!hash) return null;
  return hash.length > 12 ? `${hash.slice(0, 12)}…` : hash;
}

type ModelRunEvidencePanelProps = {
  modelId: string;
  modelRunId: string;
  runTitle: string;
  runStatus: string;
  engineKey: string;
  comparisonCandidates: ModelRunComparisonCandidate[];
  /** The run's REAL claim tier, read from modeling_claim_decisions server-side.
   * Null when no claim row exists (e.g. a preflight/uncalibrated run) — the panel
   * then falls back to the engine-availability posture. */
  claimStatus?: ModelingClaimStatus | null;
};

export function ModelRunEvidencePanel({
  modelId,
  modelRunId,
  runTitle,
  runStatus,
  engineKey,
  comparisonCandidates,
  claimStatus: claimStatusProp = null,
}: ModelRunEvidencePanelProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRelaunching, setIsRelaunching] = useState(false);
  const [isComparisonLoading, setIsComparisonLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [selectedBaselineRunId, setSelectedBaselineRunId] = useState("");
  const [evidence, setEvidence] = useState<NormalizedEvidencePacket | null>(null);
  // What, if anything, took the run this panel just relaunched. Null until a
  // relaunch answers — the panel makes no claim about a run it did not just
  // dispatch.
  const [executionOutlook, setExecutionOutlook] = useState<ModelRunExecutionOutlook | null>(null);
  // Why the transit feed named on this run still did not travel, after the
  // relaunch that was supposed to fix it. Null when it did, or when none was
  // named — an unconditional notice would train people to ignore it.
  const [transitRelaunchNotice, setTransitRelaunchNotice] = useState<string | null>(null);
  const [comparisonRows, setComparisonRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [behavioralComparison, setBehavioralComparison] = useState<BehavioralDemandComparison | null>(null);
  const [crossEngineBlock, setCrossEngineBlock] = useState<CrossEngineComparisonBlock | null>(null);

  const canInspect = runStatus === "succeeded";
  const canRelaunch = engineKey === "aequilibrae" && runStatus !== "running" && runStatus !== "succeeded";
  const packetHref = `/api/models/${modelId}/runs/${modelRunId}/evidence-packet`;
  const runMode = useMemo(() => getManagedRunModeDefinition(engineKey), [engineKey]);

  const highlights = useMemo(() => (evidence ? buildEvidenceHighlights(evidence) : []), [evidence]);
  const categories = useMemo(() => (evidence ? summarizeEvidenceCategories(evidence) : []), [evidence]);
  const transitStatus = useMemo(() => (evidence ? evidenceTransitStatus(evidence) : null), [evidence]);
  const transitProvenance = useMemo(() => (evidence ? readTransitProvenance(evidence) : null), [evidence]);
  const transitSelection = useMemo(() => (evidence ? readTransitSelection(evidence) : null), [evidence]);
  const transitDisplay = useMemo(
    () => transitStatusDisplay(transitStatus, transitProvenance?.noFeedReason),
    [transitStatus, transitProvenance]
  );
  // Honest run posture. Prefer the run's REAL recorded claim tier (from
  // modeling_claim_decisions) — so a run the worker genuinely promoted to
  // calibrated_to_counts renders as such, not as bare screening_grade. Only when
  // no claim row exists (preflight / uncalibrated / pre-evidence run) fall back
  // to deriving the tier from the engine's availability. This panel still never
  // fabricates claim_grade_passed — that tier only comes from a real claim row.
  const availabilityClaimStatus: ModelingClaimStatus =
    runMode.availability === "launchable" ? "screening_grade" : "prototype_only";
  const claimStatus: ModelingClaimStatus = claimStatusProp ?? availabilityClaimStatus;
  const comparisonSummary = useMemo(
    () => (comparisonRows ? buildModelRunKpiComparisonSummary(comparisonRows) : null),
    [comparisonRows]
  );
  const selectedBaselineRun = useMemo(
    () => comparisonCandidates.find((candidate) => candidate.id === selectedBaselineRunId) ?? null,
    [comparisonCandidates, selectedBaselineRunId]
  );

  async function loadEvidence(force = false) {
    if (!canInspect) {
      return;
    }
    if (evidence && !force) {
      return;
    }

    setError(null);
    setIsLoading(true);
    try {
      const response = await fetch(packetHref, { cache: "no-store" });
      const payload = (await response.json()) as Record<string, unknown> & { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load evidence packet");
      }

      setEvidence(
        normalizeEvidencePacket({
          rawPacket: payload,
          modelId,
          modelRunId,
          modelTitle: typeof payload.model_title === "string" ? payload.model_title : "OpenPlan model",
          runRecord: {
            id: modelRunId,
            engine_key: engineKey,
            status: runStatus,
          },
          artifacts: [],
          stages: [],
          kpis: [],
        })
      );
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load evidence packet");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadComparison(baselineRunId: string) {
    if (!baselineRunId) {
      setComparisonRows(null);
      setBehavioralComparison(null);
      setCrossEngineBlock(null);
      setComparisonError(null);
      return;
    }

    setComparisonError(null);
    setIsComparisonLoading(true);
    try {
      const response = await fetch(
        `/api/models/${modelId}/runs/${modelRunId}/kpis?baseline_run_id=${baselineRunId}`,
        { cache: "no-store" }
      );
      const payload = (await response.json()) as {
        comparison?: Array<Record<string, unknown>>;
        behavioral_comparison?: BehavioralDemandComparison;
        cross_engine_comparison?: CrossEngineComparisonBlock;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load KPI comparison");
      }

      if (payload.cross_engine_comparison) {
        // A blocked pair renders the refusal alone: setting rows would produce
        // a summary grid reading "0 changed / 0 flat", which asserts agreement
        // between two estimators that were never compared.
        setComparisonRows(null);
        setBehavioralComparison(null);
        setCrossEngineBlock(payload.cross_engine_comparison);
        return;
      }

      setComparisonRows(payload.comparison ?? []);
      setBehavioralComparison(payload.behavioral_comparison ?? null);
      setCrossEngineBlock(null);
    } catch (comparisonLoadError) {
      setComparisonRows(null);
      setBehavioralComparison(null);
      setCrossEngineBlock(null);
      setComparisonError(
        comparisonLoadError instanceof Error ? comparisonLoadError.message : "Failed to load KPI comparison"
      );
    } finally {
      setIsComparisonLoading(false);
    }
  }

  async function handleToggle() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      await loadEvidence();
    }
  }

  async function handleRelaunch() {
    setError(null);
    setExecutionOutlook(null);
    setTransitRelaunchNotice(null);
    setIsRelaunching(true);
    try {
      const response = await fetch(`/api/models/${modelId}/runs/${modelRunId}/launch`, {
        method: "POST",
      });
      const payload = (await response.json()) as {
        error?: string;
        executionOutlook?: ModelRunExecutionOutlook;
        transitFeed?: { status?: string; reason?: string | null };
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to relaunch worker run");
      }

      // THE OTHER ANSWER THIS BUTTON OWES. "Bring the feed in again from the
      // Data Hub, then relaunch" is an instruction OpenPlan gives, and until
      // this line the planner who followed it learned whether it worked from
      // the worker's transit stage minutes later — or never, on a deployment
      // whose worker is not running. The relaunch re-resolves the selection
      // server-side, so the answer exists at the moment of the click.
      setTransitRelaunchNotice(
        payload.transitFeed &&
          payload.transitFeed.status !== "selected" &&
          payload.transitFeed.status !== "not_selected" &&
          payload.transitFeed.reason
          ? payload.transitFeed.reason
          : null
      );

      // THE ANSWER THIS BUTTON OWES. This panel is where a planner arrives after
      // a run died for want of a worker — and until now pressing "Relaunch"
      // requeued the run and said nothing at all about whether the second
      // attempt would fare any better than the first, which is the only question
      // being asked. The route resolves the outlook server-side (it knows the
      // deployment's worker declaration; this component does not), so what is
      // kept here is a sentence, not a decision.
      if (payload.executionOutlook) {
        setExecutionOutlook(payload.executionOutlook);
      }

      router.refresh();
      setIsOpen(false);
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : "Failed to relaunch worker run");
    } finally {
      setIsRelaunching(false);
    }
  }

  return (
    <div className="mt-4 rounded-[0.5rem] border border-border/70 bg-background/70 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Evidence packet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {canInspect
              ? "Inspect the normalized planner-safe packet and refresh it after worker reruns."
              : canRelaunch
                ? "This worker run can be reset and queued again without leaving the model page."
                : "Evidence becomes available after the run completes successfully."}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">{runMode.runtimeExpectation}</p>
        </div>

        <div className="flex flex-wrap gap-2">
          {canInspect ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleToggle()}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileJson2 className="h-4 w-4" />}
              {isOpen ? "Hide evidence" : "Inspect evidence"}
            </Button>
          ) : null}

          {canRelaunch ? (
            <Button type="button" variant="outline" size="sm" onClick={() => void handleRelaunch()} disabled={isRelaunching}>
              {isRelaunching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {runStatus === "queued" ? "Reset queue" : "Relaunch worker run"}
            </Button>
          ) : null}
        </div>
      </div>

      {error ? <p className="mt-3 text-xs text-red-600 dark:text-red-300">{error}</p> : null}

      {/* WHETHER THE RELAUNCH WILL FARE ANY BETTER. Deliberately outside the
          collapsible evidence section: a run that never produced evidence has
          nothing to expand, and this is the surface a planner reaches precisely
          when there is none. The wording comes from the route, so the launch
          form and this button cannot describe the same deployment differently. */}
      {executionOutlook ? (
        <div
          data-testid="model-run-execution-outlook"
          data-outlook-state={executionOutlook.state}
          className={
            executionOutlook.state === "accepted"
              ? "mt-3 rounded-[0.5rem] border border-emerald-300/80 bg-emerald-50 px-4 py-3 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
              : executionOutlook.state === "unattended"
                ? "mt-3 rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-xs text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
                : executionOutlook.state === "waiting_for_poller"
                  ? "mt-3 rounded-[0.5rem] border border-sky-300/80 bg-sky-50 px-4 py-3 text-xs text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200"
                  : "mt-3 rounded-[0.5rem] border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
          }
        >
          <p className="font-semibold">{executionOutlook.headline}</p>
          <p className="mt-2">{executionOutlook.detail}</p>
        </div>
      ) : null}

      {/* Outside the collapsible section for the same reason as the outlook: a
          run that produced no evidence has nothing to expand, and this is
          precisely the run whose feed handoff failed. */}
      {transitRelaunchNotice ? (
        <div
          data-testid="model-run-transit-relaunch-notice"
          className="mt-3 rounded-[0.5rem] border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-xs text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
        >
          <p className="font-semibold">
            The transit feed chosen for this run still did not reach the modeling worker
          </p>
          <p className="mt-2">{transitRelaunchNotice}</p>
        </div>
      ) : null}

      {isOpen ? (
        <div className="mt-4 space-y-4 border-t border-border/60 pt-4">
          {evidence ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone="info">{labelForEngineKey(evidence.engine || engineKey)}</StatusBadge>
                <StatusBadge tone="neutral">Packet {evidence.packet_version}</StatusBadge>
                <StatusBadge tone="neutral">{evidence.provenance.source_packet_format}</StatusBadge>
                {evidence.provenance.fallback_reason ? <StatusBadge tone="warning">Synthesized fallback</StatusBadge> : null}
                {runMode.availability !== "launchable" ? <StatusBadge tone="warning">Prototype / preflight</StatusBadge> : null}
              </div>

              <div
                className="rounded-[0.5rem] border border-amber-300/60 bg-amber-50/70 p-4 dark:border-amber-900/50 dark:bg-amber-950/20"
                data-testid="evidence-run-honesty"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-900/80 dark:text-amber-200/80">
                  Run honesty &amp; reproducibility
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <StatusBadge tone={claimStatusTone(claimStatus)}>
                    {modelingClaimStatusLabel(claimStatus)}
                  </StatusBadge>
                  {claimStatus === "screening_grade" ? (
                    <StatusBadge tone="neutral">Uncalibrated by default</StatusBadge>
                  ) : null}
                  {transitDisplay ? (
                    <StatusBadge tone={transitDisplay.tone}>{transitDisplay.label}</StatusBadge>
                  ) : null}
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-xs text-amber-950/90 dark:text-amber-100/90 sm:grid-cols-2">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-amber-900/70 dark:text-amber-200/70">Engine version</dt>
                    <dd className="text-right font-medium">{evidence.provenance.engine_version || "—"}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-amber-900/70 dark:text-amber-200/70">Zones</dt>
                    <dd className="text-right font-medium">
                      {evidence.inputs.zone_count !== null ? evidence.inputs.zone_count.toLocaleString() : "—"}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-amber-900/70 dark:text-amber-200/70">Run window</dt>
                    <dd className="text-right font-medium">
                      {evidence.provenance.run_started_at
                        ? new Date(evidence.provenance.run_started_at).toLocaleString()
                        : "—"}
                      {evidence.provenance.run_completed_at
                        ? ` → ${new Date(evidence.provenance.run_completed_at).toLocaleString()}`
                        : ""}
                    </dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-amber-900/70 dark:text-amber-200/70">Corridor hash</dt>
                    <dd className="text-right font-mono font-medium">
                      {shortHash(evidence.assumptions.corridor_geojson_hash) || "—"}
                    </dd>
                  </div>
                </dl>

                {/* Which feed, from when. The badge above says whether transit was
                    modeled; this names the evidence behind that answer — and when
                    there was no feed, states the coverage limit as a fact instead
                    of leaving a 0% transit share to read as a measurement. */}
                {transitDisplay || transitSelection ? (
                  <div
                    className="mt-3 rounded-[14px] border border-amber-300/50 bg-amber-100/40 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/30"
                    data-testid="evidence-transit-provenance"
                  >
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-900/80 dark:text-amber-200/80">
                      Transit feed
                    </p>

                    {/* WHAT OPENPLAN ASKED FOR, above what the worker did.
                        Kept as its own block rather than folded into the
                        provenance list below, because a request and an outcome
                        are different things and the runs where they differ are
                        exactly the runs worth reading carefully. */}
                    {transitSelection ? (
                      <div
                        className="mt-2 text-xs text-amber-950/90 dark:text-amber-100/90"
                        data-testid="evidence-transit-selection"
                      >
                        <p>
                          <span className="font-semibold">Chosen at launch:</span>{" "}
                          {(transitSelection.status
                            ? TRANSIT_SELECTION_STATUS_LABELS[transitSelection.status]
                            : null) ??
                            transitSelection.status ??
                            "Not recorded"}
                          {transitSelection.agencyName ? ` — ${transitSelection.agencyName}` : ""}
                        </p>
                        {transitSelection.reason ? <p className="mt-1">{transitSelection.reason}</p> : null}
                        {/* An expired schedule does NOT refuse the run — three
                            of four real Sacramento-area feeds measured on
                            2026-08-05 had already expired, and the last one an
                            agency published is usually the right thing to model
                            from. What it must not be is silent. */}
                        {transitSelection.scheduleExpiredAtLaunch ? (
                          <p className="mt-1" data-testid="evidence-transit-schedule-expired">
                            Its published schedule had already ended
                            {transitSelection.serviceEndDate
                              ? ` on ${transitSelection.serviceEndDate}`
                              : ""}{" "}
                            when this run was launched. That is normal — it is usually the last schedule
                            the agency published — but the service modeled here is that schedule, not
                            today&apos;s.
                          </p>
                        ) : null}
                        {transitSelection.coversStudyArea === "no" ? (
                          <p className="mt-1">
                            OpenPlan&apos;s own pre-check found none of this feed&apos;s stops inside the
                            study area&apos;s bounding box.
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    {transitProvenance ? (
                      <dl className="mt-2 space-y-1.5 text-xs text-amber-950/90 dark:text-amber-100/90">
                        <div className="flex items-start justify-between gap-3">
                          <dt className="shrink-0 text-amber-900/70 dark:text-amber-200/70">Feed</dt>
                          <dd className="min-w-0 break-all text-right font-medium">
                            {transitProvenance.feedRef ?? "None applied"}
                          </dd>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <dt className="shrink-0 text-amber-900/70 dark:text-amber-200/70">How it was selected</dt>
                          <dd className="min-w-0 text-right font-medium">
                            {(transitProvenance.origin
                              ? TRANSIT_FEED_ORIGIN_LABELS[transitProvenance.origin]
                              : null) ??
                              transitProvenance.origin ??
                              "Not recorded by this run"}
                          </dd>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <dt className="shrink-0 text-amber-900/70 dark:text-amber-200/70">Service window</dt>
                          <dd className="min-w-0 text-right font-medium">
                            {transitStatus === "modeled"
                              ? formatServiceWindow(transitProvenance.servicePeriod)
                              : "No feed was skimmed"}
                          </dd>
                        </div>
                        {transitStatus === "modeled" ? (
                          <>
                            <div className="flex items-start justify-between gap-3">
                              <dt className="shrink-0 text-amber-900/70 dark:text-amber-200/70">Schedule day used</dt>
                              <dd className="min-w-0 text-right font-medium">
                                {formatServiceDay(transitProvenance.serviceDay)}
                              </dd>
                            </div>
                            {formatServiceFound(transitProvenance) ? (
                              <div className="flex items-start justify-between gap-3">
                                <dt className="shrink-0 text-amber-900/70 dark:text-amber-200/70">Service found</dt>
                                <dd className="min-w-0 text-right font-medium">
                                  {formatServiceFound(transitProvenance)}
                                </dd>
                              </div>
                            ) : null}
                            {/* THE PROOF, not a restatement of the request.
                                This checksum is the one the worker computed
                                over the bytes it actually read and compared
                                against the value OpenPlan recorded when it
                                parsed the feed. It is what makes "the model ran
                                on the feed on that card" a checkable claim
                                rather than an assurance. */}
                            {transitProvenance.feedChecksumSha256 ? (
                              <div
                                className="flex items-start justify-between gap-3"
                                data-testid="evidence-transit-checksum"
                              >
                                <dt className="shrink-0 text-amber-900/70 dark:text-amber-200/70">
                                  Archive checksum (verified)
                                </dt>
                                <dd className="min-w-0 break-all text-right font-mono font-medium">
                                  {shortHash(transitProvenance.feedChecksumSha256)}
                                </dd>
                              </div>
                            ) : null}
                            {/* DELIBERATELY BESIDE "Service window" AND NOT
                                MERGED WITH IT. That one is derived by the
                                worker's parser from calendar.txt; this one is
                                the window OpenPlan recorded on the ingest.
                                Migration 20260805000006 states they disagree in
                                real feeds more often than not, and showing one
                                number would destroy the evidence that they did. */}
                            {transitProvenance.feedServiceEndDate ? (
                              <div className="flex items-start justify-between gap-3">
                                <dt className="shrink-0 text-amber-900/70 dark:text-amber-200/70">
                                  Ingest&apos;s recorded window
                                </dt>
                                <dd className="min-w-0 text-right font-medium">
                                  {transitProvenance.feedServiceStartDate ?? "—"} →{" "}
                                  {transitProvenance.feedServiceEndDate}
                                </dd>
                              </div>
                            ) : null}
                          </>
                        ) : null}
                      </dl>
                    ) : (
                      <p className="mt-2 text-xs text-amber-950/90 dark:text-amber-100/90">
                        This run recorded no transit-feed provenance, so its transit share cannot be traced to a
                        feed. Treat it as unattributed rather than as a measurement.
                      </p>
                    )}

                    {/* Disclosed on EVERY outcome, including a run that went on to
                        model transit successfully from the fallback feed. Without
                        this line a bundled-feed fallback reads as a discovery hit,
                        and a planner would believe the catalog was searched for
                        their area when it never answered — a confident claim about
                        coverage nobody established. */}
                    {transitProvenance?.discoveryError ? (
                      <p
                        className="mt-2 text-xs text-amber-950/90 dark:text-amber-100/90"
                        data-testid="evidence-transit-discovery-fallback"
                      >
                        Per-study-area feed discovery did not run: the published-feed catalog could not be
                        reached ({transitProvenance.discoveryError}). This run fell back to the feed bundled
                        with the worker, so a published feed covering this study area may exist and was not
                        looked for.
                      </p>
                    ) : null}

                    {/* THE FALLBACK SENTENCE BELOW MAY NOT CLAIM COVERAGE. It
                        used to read "No GTFS feed was applied to this study
                        area", which asserts something about the AREA — and it is
                        the sentence shown for exactly the reasons nobody wrote a
                        label for, which in practice were three SELECTION
                        failures. When a planner named a feed and it could not be
                        used, nothing whatever was established about the area,
                        and the claim would then sit underneath a VMT number they
                        have to defend. It is a fact about THIS RUN, so that is
                        all it says. */}
                    {transitStatus !== "modeled" ? (
                      <p className="mt-2 text-xs text-amber-950/90 dark:text-amber-100/90">
                        {(transitProvenance?.noFeedReason
                          ? TRANSIT_NO_FEED_REASON_LABELS[transitProvenance.noFeedReason]
                          : null) ?? "No GTFS feed was applied to this run."}{" "}
                        Transit share is 0 because no feed was applied — a limit of what this run was given,
                        not a finding that transit demand here is zero.
                      </p>
                    ) : null}

                    {/* The worker's own verdict on the schedule's age, from the
                        moment it ran — kept separate from the launch stamp
                        above because the two are minutes apart and a schedule
                        can expire between them. */}
                    {transitProvenance?.feedScheduleExpired === true ? (
                      <p
                        className="mt-2 text-xs text-amber-950/90 dark:text-amber-100/90"
                        data-testid="evidence-transit-worker-schedule-expired"
                      >
                        When the transit skim ran
                        {transitProvenance.feedExpiryEvaluatedAt
                          ? ` (${new Date(transitProvenance.feedExpiryEvaluatedAt).toLocaleString()})`
                          : ""}
                        , this feed&apos;s published schedule had already ended. The service modeled here
                        is that schedule.
                      </p>
                    ) : null}

                    {/* THE POSITIVE HALF, and the reason `flag()` returns null
                        rather than false. A worker that checked and found the
                        schedule current is saying something a planner can rely
                        on; a worker that predates this handoff said nothing at
                        all. Rendering only the expiry notice would collapse the
                        two into one silence, and the stronger of them — an
                        affirmative "this was checked" — would be unavailable to
                        anyone defending the run. */}
                    {transitProvenance?.feedScheduleExpired === false ? (
                      <p
                        className="mt-2 text-xs text-amber-950/90 dark:text-amber-100/90"
                        data-testid="evidence-transit-worker-schedule-current"
                      >
                        This feed&apos;s published schedule was still current when the transit skim ran
                        {transitProvenance.feedExpiryEvaluatedAt
                          ? ` (${new Date(transitProvenance.feedExpiryEvaluatedAt).toLocaleString()})`
                          : ""}
                        .
                      </p>
                    ) : null}

                    {/* A per-run choice beat a deployment-wide setting, which is
                        a reversal of the worker's documented precedence and is
                        therefore stated rather than assumed. Whoever operates
                        this installation set GTFS_URL/GTFS_PATH and has a right
                        to know when a run did not use it. */}
                    {transitProvenance?.operatorEnvOverridden ? (
                      <p
                        className="mt-2 text-xs text-amber-950/90 dark:text-amber-100/90"
                        data-testid="evidence-transit-operator-override"
                      >
                        This installation configures a transit feed of its own, and the feed chosen for
                        this run was used instead of it — a choice made on this run outranks a default
                        set for every run.
                      </p>
                    ) : null}

                    {transitProvenance?.error ? (
                      <p className="mt-2 text-xs text-amber-950/90 dark:text-amber-100/90">
                        Reported by the feed reader: {transitProvenance.error}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => void loadEvidence(true)} disabled={isLoading}>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                  Refresh evidence
                </Button>
                <Button asChild type="button" variant="outline" size="sm">
                  <a href={packetHref} target="_blank" rel="noopener noreferrer">
                    <FileJson2 className="h-4 w-4" />
                    Open packet JSON
                  </a>
                </Button>
              </div>

              {highlights.length > 0 ? (
                <div className="module-summary-grid cols-4 mt-1">
                  {highlights.map((highlight) => (
                    <div key={highlight.label} className="module-summary-card">
                      <p className="module-summary-label">{highlight.label}</p>
                      <p className="module-summary-value text-base">{highlight.value}</p>
                      <p className="module-summary-detail">{highlight.detail}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                <div className="rounded-[0.5rem] border border-border/65 bg-background/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">Packet posture</p>
                    <StatusBadge tone="neutral">{labelForEngineKey(evidence.engine || engineKey)}</StatusBadge>
                  </div>
                  <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <div className="flex items-start justify-between gap-3">
                      <dt>Generated</dt>
                      <dd className="text-right text-foreground">{new Date(evidence.generated_at).toLocaleString()}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt>Run status</dt>
                      <dd className="text-right text-foreground">{evidence.provenance.run_status || runStatus}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt>Engine version</dt>
                      <dd className="text-right text-foreground">{evidence.provenance.engine_version}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt>Artifacts</dt>
                      <dd className="text-right text-foreground">{evidence.outputs.artifacts.length}</dd>
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <dt>Stages</dt>
                      <dd className="text-right text-foreground">{evidence.outputs.stages.length}</dd>
                    </div>
                  </dl>

                  {evidence.inputs.query_text ? (
                    <div className="mt-4 rounded-[0.5rem] border border-border/60 bg-background/90 p-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Query text</p>
                      <p className="mt-2 text-sm text-foreground">{evidence.inputs.query_text}</p>
                    </div>
                  ) : null}

                  {evidence.employment ? (
                    <div className="mt-4 rounded-[0.5rem] border border-border/60 bg-background/90 p-3" data-testid="evidence-employment-inputs">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Employment inputs</p>
                      <p className="mt-2 text-sm text-foreground">{describeEmploymentProvenance(evidence.employment)}</p>
                      {employmentUsedSyntheticFallback(evidence.employment) ? (
                        <div className="mt-2 flex items-start gap-2">
                          <StatusBadge tone="warning">{ESTIMATED_BADGE_LABEL}</StatusBadge>
                          {typeof evidence.employment.caveat === "string" ? (
                            <p className="text-xs text-muted-foreground">{evidence.employment.caveat}</p>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {evidence.benchmark_fit ? (
                    <div className="mt-4 rounded-[0.5rem] border border-border/60 bg-background/90 p-3" data-testid="evidence-benchmark-fit">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Benchmark fit</p>
                        {typeof evidence.benchmark_fit.fit_score_0_100 === "number" ? (
                          // Tone thresholds on the same rounded value shown in the
                          // label and aligns with the recommendation ladder's
                          // strict >60 floor, so a "Large deviation" run (score
                          // <= 60) never shows a non-warning badge.
                          <StatusBadge
                            tone={Math.round(evidence.benchmark_fit.fit_score_0_100) <= 60 ? "warning" : "info"}
                          >
                            Fit {Math.round(evidence.benchmark_fit.fit_score_0_100)}/100
                          </StatusBadge>
                        ) : null}
                      </div>
                      <dl className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                        <div className="flex items-start justify-between gap-3">
                          <dt>VMT component</dt>
                          <dd className="text-right text-foreground">
                            {typeof evidence.benchmark_fit.components.vmt_score === "number"
                              ? `${Math.round(evidence.benchmark_fit.components.vmt_score)}/100`
                              : "Unavailable"}
                          </dd>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <dt>Mode-split component</dt>
                          <dd className="text-right text-foreground">
                            {typeof evidence.benchmark_fit.components.mode_split_score === "number"
                              ? `${Math.round(evidence.benchmark_fit.components.mode_split_score)}/100`
                              : "Unavailable"}
                          </dd>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <dt>VMT vs reference</dt>
                          <dd className="text-right text-foreground">
                            {typeof evidence.benchmark_fit.vmt_percent_error === "number"
                              ? `${evidence.benchmark_fit.vmt_percent_error >= 0 ? "+" : ""}${evidence.benchmark_fit.vmt_percent_error.toFixed(1)}%`
                              : "Unavailable"}
                          </dd>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <dt>Mode-split RMSE</dt>
                          <dd className="text-right text-foreground">
                            {typeof evidence.benchmark_fit.mode_split_rmse === "number"
                              ? `${evidence.benchmark_fit.mode_split_rmse.toFixed(1)} pct-pts`
                              : "Unavailable"}
                          </dd>
                        </div>
                      </dl>
                      {evidence.benchmark_fit.recommendation ? (
                        <p className="mt-2 text-sm text-foreground">{evidence.benchmark_fit.recommendation}</p>
                      ) : null}
                      {evidence.benchmark_fit.sources.length > 0 ? (
                        <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                          {evidence.benchmark_fit.sources.map((source) => (
                            <li key={source}>{source}</li>
                          ))}
                        </ul>
                      ) : null}
                      <p className="mt-2 text-xs text-muted-foreground">
                        County-run validation compares against observed traffic counts, while sketch benchmark fit
                        compares against reference benchmarks only.
                      </p>
                    </div>
                  ) : null}

                  {evidence.caveats.length > 0 ? (
                    <div className="mt-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Caveats</p>
                      <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                        {evidence.caveats.map((caveat) => (
                          <li key={caveat} className="rounded-[14px] border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                            {caveat}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>

                <div className="space-y-4">
                  {evidence.scenario_basis ? (
                    <div className="rounded-[0.5rem] border border-border/65 bg-background/80 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-foreground">Scenario basis</p>
                        {evidence.scenario_basis.shared_spine ? (
                          <StatusBadge tone={evidence.scenario_basis.shared_spine.schema_pending ? "warning" : "info"}>
                            {evidence.scenario_basis.shared_spine.schema_pending ? "Spine pending" : "Spine linked"}
                          </StatusBadge>
                        ) : null}
                      </div>

                      <dl className="mt-3 space-y-2 text-sm text-muted-foreground">
                        <div className="flex items-start justify-between gap-3">
                          <dt>Scenario set</dt>
                          <dd className="text-right text-foreground">
                            {evidence.scenario_basis.scenario_set?.title ?? "Not linked"}
                          </dd>
                        </div>
                        <div className="flex items-start justify-between gap-3">
                          <dt>Scenario entry</dt>
                          <dd className="text-right text-foreground">
                            {evidence.scenario_basis.scenario_entry?.label ?? "Not attached"}
                          </dd>
                        </div>
                        {evidence.scenario_basis.shared_spine ? (
                          <>
                            <div className="flex items-start justify-between gap-3">
                              <dt>Assumption sets</dt>
                              <dd className="text-right text-foreground">
                                {evidence.scenario_basis.shared_spine.schema_pending
                                  ? "Pending"
                                  : evidence.scenario_basis.shared_spine.assumption_set_count}
                              </dd>
                            </div>
                            <div className="flex items-start justify-between gap-3">
                              <dt>Data packages</dt>
                              <dd className="text-right text-foreground">
                                {evidence.scenario_basis.shared_spine.schema_pending
                                  ? "Pending"
                                  : evidence.scenario_basis.shared_spine.data_package_count}
                              </dd>
                            </div>
                            <div className="flex items-start justify-between gap-3">
                              <dt>Indicator snapshots</dt>
                              <dd className="text-right text-foreground">
                                {evidence.scenario_basis.shared_spine.schema_pending
                                  ? "Pending"
                                  : evidence.scenario_basis.shared_spine.indicator_snapshot_count}
                              </dd>
                            </div>
                          </>
                        ) : null}
                      </dl>

                      {evidence.scenario_basis.shared_spine?.latest_indicator_snapshot_at ? (
                        <p className="mt-3 text-xs text-muted-foreground">
                          Latest indicator snapshot {new Date(evidence.scenario_basis.shared_spine.latest_indicator_snapshot_at).toLocaleString()}.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="rounded-[0.5rem] border border-border/65 bg-background/80 p-4">
                    <p className="text-sm font-semibold text-foreground">KPI categories</p>
                    {categories.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">No KPI categories were registered for this run.</p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        {categories.map((category) => (
                          <div key={category.category} className="rounded-[0.5rem] border border-border/60 bg-background/90 p-3">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-foreground">{labelForKpiCategory(category.category)}</p>
                              <StatusBadge tone="neutral">{category.count} KPI{category.count === 1 ? "" : "s"}</StatusBadge>
                            </div>
                            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
                              {category.topItems.map((item, index) => (
                                <li key={`${category.category}-${item.name ?? item.label ?? index}`}>
                                  <span className="text-foreground">{item.label ?? item.name ?? "Metric"}</span>
                                  {typeof item.value === "number" ? ` · ${formatModelRunKpiValue(item.value, item.unit)}` : ""}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-[0.5rem] border border-border/65 bg-background/80 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Run-to-run KPI comparison</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Pick another completed managed run as the baseline and review KPI deltas without leaving the model page.
                        </p>
                      </div>
                      {crossEngineBlock ? (
                        <StatusBadge tone="warning">Cross-engine comparison blocked</StatusBadge>
                      ) : comparisonSummary ? (
                        <StatusBadge
                          tone={
                            behavioralComparison?.support.status === "behavioral_comparison_blocked"
                              ? "warning"
                              : comparisonSummary.changedCount > 0
                                ? "info"
                                : "neutral"
                          }
                        >
                          {behavioralComparison?.support.status === "behavioral_comparison_blocked"
                            ? "Behavioral comparison blocked"
                            : behavioralComparison?.support.status === "behavioral_comparison_partial_only"
                              ? "Partial-output comparison"
                              : comparisonSummary.changedCount > 0
                                ? `${comparisonSummary.changedCount} KPI shifts`
                                : comparisonSummary.comparableCount > 0
                                  ? "All compared KPIs flat"
                                  : "Awaiting comparable KPIs"}
                        </StatusBadge>
                      ) : null}
                    </div>

                    {comparisonCandidates.length === 0 ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        {runMode.key === "behavioral_demand"
                          ? runMode.comparisonMessage
                          : "Launch or retain at least one other succeeded managed run to unlock direct KPI comparison here."}
                      </p>
                    ) : (
                      <>
                        {runMode.key === "behavioral_demand" ? (
                          <div className="mt-3 rounded-[0.5rem] border border-amber-300/60 bg-amber-50/70 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                            {runMode.comparisonMessage}
                          </div>
                        ) : null}
                        <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
                          <select
                            className="module-select md:max-w-sm"
                            value={selectedBaselineRunId}
                            onChange={(event) => {
                              const nextBaselineRunId = event.target.value;
                              setSelectedBaselineRunId(nextBaselineRunId);
                              void loadComparison(nextBaselineRunId);
                            }}
                          >
                            <option value="">Select baseline run</option>
                            {comparisonCandidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.runTitle}
                                {candidate.scenarioLabel ? ` · ${candidate.scenarioLabel}` : ""}
                              </option>
                            ))}
                          </select>

                          {selectedBaselineRun ? (
                            <StatusBadge tone="warning">Baseline: {selectedBaselineRun.runTitle}</StatusBadge>
                          ) : null}
                        </div>

                        {selectedBaselineRun?.completedAt ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            Comparing <span className="text-foreground">{runTitle}</span> against baseline run from{" "}
                            <span className="text-foreground">{new Date(selectedBaselineRun.completedAt).toLocaleString()}</span>.
                          </p>
                        ) : null}

                        {behavioralComparison ? (
                          <div className="mt-3 rounded-[0.5rem] border border-amber-300/60 bg-amber-50/70 px-3 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
                            <p className="font-semibold">
                              {behavioralComparison.support.status === "behavioral_comparison_available"
                                ? "Behavioral comparison available"
                                : behavioralComparison.support.status === "behavioral_comparison_partial_only"
                                  ? "Partial-output behavioral comparison only"
                                  : "Behavioral comparison blocked"}
                            </p>
                            <p className="mt-1">{behavioralComparison.support.message}</p>
                            {behavioralComparison.exclusions.length > 0 ? (
                              <ul className="mt-2 space-y-1 text-xs">
                                {behavioralComparison.exclusions.map((exclusion) => (
                                  <li key={exclusion}>{exclusion}</li>
                                ))}
                              </ul>
                            ) : null}
                            {behavioralComparison.caveats.length > 0 ? (
                              <ul className="mt-2 space-y-1 text-xs">
                                {behavioralComparison.caveats.slice(0, 3).map((caveat) => (
                                  <li key={caveat}>{caveat}</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        ) : null}

                        {crossEngineBlock ? (
                          <div
                            className="mt-3 rounded-[0.5rem] border border-amber-300/60 bg-amber-50/70 px-3 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
                            data-testid="cross-engine-comparison-blocked"
                          >
                            <p className="font-semibold">Cross-engine KPI comparison blocked</p>
                            <p className="mt-1">{crossEngineBlock.message}</p>
                          </div>
                        ) : null}

                        {comparisonError ? <p className="mt-3 text-xs text-red-600 dark:text-red-300">{comparisonError}</p> : null}

                        {isComparisonLoading ? (
                          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Loading KPI comparison…
                          </div>
                        ) : comparisonSummary ? (
                          <div className="mt-4 space-y-4">
                            <div className="module-summary-grid cols-4 mt-1">
                              <div className="module-summary-card">
                                <p className="module-summary-label">Comparable KPIs</p>
                                <p className="module-summary-value text-base">{comparisonSummary.comparableCount}</p>
                                <p className="module-summary-detail">
                                  {runMode.key === "behavioral_demand"
                                    ? "Shared behavioral KPI rows discovered on both prototype runs."
                                    : "Metrics with values on both the current and baseline runs."}
                                </p>
                              </div>
                              <div className="module-summary-card">
                                <p className="module-summary-label">Changed KPIs</p>
                                <p className="module-summary-value text-base">{comparisonSummary.changedCount}</p>
                                <p className="module-summary-detail">Rows where the absolute delta is non-zero.</p>
                              </div>
                              <div className="module-summary-card">
                                <p className="module-summary-label">Flat KPIs</p>
                                <p className="module-summary-value text-base">{comparisonSummary.flatCount}</p>
                                <p className="module-summary-detail">Comparable rows with no measured movement.</p>
                              </div>
                              <div className="module-summary-card">
                                <p className="module-summary-label">Missing baseline match</p>
                                <p className="module-summary-value text-base">{comparisonSummary.missingBaselineCount}</p>
                                <p className="module-summary-detail">
                                  {runMode.key === "behavioral_demand"
                                    ? "Behavioral KPI rows excluded because they were not shared across both runs."
                                    : "Current-run KPIs that did not find a matching baseline row."}
                                </p>
                              </div>
                            </div>

                            {comparisonSummary.highlights.length > 0 ? (
                              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                {comparisonSummary.highlights.map((item) => (
                                  <div key={item.key} className="rounded-[0.5rem] border border-border/60 bg-background/90 p-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{item.label}</p>
                                      <StatusBadge tone="info">{formatModelRunKpiDelta(item.absoluteDelta, item.unit)}</StatusBadge>
                                    </div>
                                    <div className="mt-3 space-y-1 text-sm">
                                      <p className="font-semibold text-foreground">{formatModelRunKpiValue(item.currentValue, item.unit)}</p>
                                      <p className="text-muted-foreground">Baseline {formatModelRunKpiValue(item.baselineValue, item.unit)}</p>
                                      {item.percentDelta !== null ? (
                                        <p className="text-muted-foreground">Percent change {formatModelRunKpiPercentDelta(item.percentDelta)}</p>
                                      ) : null}
                                      {item.geometryRef ? <p className="text-xs text-muted-foreground">Ref {item.geometryRef}</p> : null}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="rounded-[0.5rem] border border-border/60 bg-background/90 px-3 py-2.5 text-sm text-muted-foreground">
                                {comparisonSummary.comparableCount > 0
                                  ? "Compared KPI rows are currently flat versus the selected baseline."
                                  : runMode.key === "behavioral_demand"
                                    ? behavioralComparison?.support.message ??
                                      "No comparison-ready behavioral KPI rows were registered for this run pair yet. Review the prototype artifacts and caveats before treating the pair as analytically comparable."
                                    : "No comparable KPI rows were available for this run pair yet."}
                              </div>
                            )}

                            <div className="space-y-3">
                              {comparisonSummary.categories
                                .filter((category) => category.changedCount > 0)
                                .map((category) => (
                                  <div key={category.category} className="rounded-[0.5rem] border border-border/60 bg-background/90 p-3">
                                    <div className="flex items-center justify-between gap-3">
                                      <p className="text-sm font-semibold text-foreground">{labelForKpiCategory(category.category)}</p>
                                      <StatusBadge tone="neutral">
                                        {category.changedCount}/{category.comparableCount || category.totalCount} moved
                                      </StatusBadge>
                                    </div>
                                    <div className="mt-3 space-y-2 text-sm">
                                      {category.topChanges.map((item) => (
                                        <div key={item.key} className="rounded-[14px] border border-border/50 bg-background/80 px-3 py-2.5">
                                          <div className="flex items-start justify-between gap-3">
                                            <div>
                                              <p className="font-medium text-foreground">{item.label}</p>
                                              <p className="text-muted-foreground">
                                                Current {formatModelRunKpiValue(item.currentValue, item.unit)} · Baseline{" "}
                                                {formatModelRunKpiValue(item.baselineValue, item.unit)}
                                              </p>
                                            </div>
                                            <div className="text-right">
                                              <p className="font-medium text-foreground">{formatModelRunKpiDelta(item.absoluteDelta, item.unit)}</p>
                                              {item.percentDelta !== null ? (
                                                <p className="text-xs text-muted-foreground">{formatModelRunKpiPercentDelta(item.percentDelta)}</p>
                                              ) : null}
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        ) : (
                          <p className="mt-3 text-sm text-muted-foreground">
                            Select a baseline run above to load the model-run KPI comparison board.
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  <div className="rounded-[0.5rem] border border-border/65 bg-background/80 p-4">
                    <p className="text-sm font-semibold text-foreground">Execution timing</p>
                    {evidence.outputs.stages.length === 0 ? (
                      <p className="mt-2 text-sm text-muted-foreground">No stage timing was recorded for this packet.</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {evidence.outputs.stages.map((stage) => (
                          <div key={`${stage.name}-${stage.status}`} className="flex items-center justify-between gap-3 rounded-[14px] border border-border/60 bg-background/90 px-3 py-2.5 text-sm">
                            <div>
                              <p className="font-medium text-foreground">{stage.name}</p>
                              <p className="text-muted-foreground">{formatDurationSeconds(stage.duration_s) ?? "Duration unavailable"}</p>
                            </div>
                            <StatusBadge tone={stage.status === "succeeded" ? "success" : stage.status === "failed" ? "warning" : "neutral"}>
                              {stage.status}
                            </StatusBadge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading evidence packet…
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Evidence packet unavailable.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
