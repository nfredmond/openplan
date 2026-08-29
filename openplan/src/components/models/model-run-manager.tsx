"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import dynamic from "next/dynamic";
import { ModelRunEvidencePanel } from "@/components/models/model-run-evidence-panel";
import { ModelRunHeadlineAnswer } from "@/components/models/model-run-headline-answer";
import { ModelRunCeqaVmtScreen } from "@/components/models/model-run-ceqa-vmt-screen";
import { ModelRunTripGenScreen } from "@/components/models/model-run-trip-gen-screen";
import { ModelRunEmissionsPanel } from "@/components/models/model-run-emissions-panel";
import { ModelRunZoneResolutionPanel } from "@/components/models/model-run-zone-resolution-panel";
import { ModelRunEquityPanel } from "@/components/models/model-run-equity-panel";
import { ModelRunEngagementPanel } from "@/components/models/model-run-engagement-panel";
import { ModelRunScreeningGradeNote } from "@/components/models/model-run-screening-grade-note";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { formatDurationSeconds, formatFileSize, labelForArtifactType, labelForEngineKey } from "@/lib/models/evidence-packet";
import { MANAGED_RUN_MODE_DEFINITIONS, getManagedRunModeDefinition, type ManagedRunModeKey } from "@/lib/models/run-modes";
import { resolveVmtDeterminationRunEligibility } from "@/lib/planner-pack/vmt-determination-inputs";
import {
  IN_PROCESS_ENGINE_KEYS,
  assessWorkerLaunchReadiness,
  describeWorkerAbsenceEvidence,
  describeWorkerLaunchRefusal,
  describeWorkerQueueRisk,
  evaluateWorkerLaunchGate,
  isWorkerBackedEngineKey,
  type ModelingWorkerDeclaration,
} from "@/lib/models/worker-backed-launch";
import {
  describeModelRunDispatch,
  type ModelRunDispatchOutcome,
  type ModelRunExecutionOutlook,
} from "@/lib/models/run-dispatch";
import { type ModelRunClaimDecision } from "@/lib/models/evidence-backbone";
import { stageLogForDisplay, summarizeRunFailure } from "@/lib/models/run-failure";
import {
  accuracyByClassRows,
  accuracyByClassSvg,
  type RoadClassAccuracy,
} from "@/lib/models/charts/accuracy-by-class";
import {
  accuracyScatterRows,
  accuracyScatterSvg,
  type AccuracyPoint,
} from "@/lib/models/charts/accuracy-scatter";
import { describeElapsed, latestConvergence, summarizeRunProgress } from "@/lib/models/run-progress";
import { useTheme } from "@/components/theme-provider";
import {
  evaluateWorkerHealthLaunchGate,
  reconcileModelRunExecutionOutlook,
  type ModelingWorkerHealth,
} from "@/lib/models/worker-health";

const TrafficVolumeMap = dynamic(
  () => import("@/components/models/traffic-volume-map").then((m) => m.TrafficVolumeMap),
  { ssr: false, loading: () => <div className="h-[520px] w-full animate-pulse rounded-[0.5rem] bg-zinc-800/50" /> }
);
const DemandAgreementMap = dynamic(
  () => import("@/components/models/demand-agreement-map").then((module) => module.DemandAgreementMap),
  { ssr: false },
);

type ScenarioEntryOption = {
  id: string;
  label: string;
  entryType: string;
  status: string;
  assumptionCount: number;
};

/**
 * One of this workspace's ingested transit feeds, as the launch control needs
 * it. Only feeds with an ingest CURRENTLY IN USE belong in this list — a feed
 * whose only ingest failed has nothing to hand the modeling worker, and
 * offering it would produce a run that refuses for a reason the planner could
 * have been told before they clicked.
 */
export type TransitFeedOption = {
  id: string;
  agencyName: string;
  /** ISO `YYYY-MM-DD` from the version in use, or null when it stated none. */
  serviceEndDate: string | null;
  /**
   * How this feed's ingest read the modeled service: trips published as a
   * `frequencies.txt` headway band, and trips published as real departures.
   *
   * DISCLOSURE, NOT A REFUSAL — and that is a correction, not a nuance. Until
   * 2026-08-06 both lanes threw the whole feed away over ANY frequency-based
   * trip. Measured: of 16 sampled US feeds 7 ship `frequencies.txt`, six of them
   * header-only, and the seventh carries 4 rows over 2 of its 18,150 trips — so
   * that agency lost its entire feed over four rows, and a planner who NAMED
   * their own feed got zero transit where naming none would have modeled some.
   * The worker now drops those trips, counts them, and refuses only when nothing
   * scheduled is left on the modeled day. These numbers say what will be left
   * out; nothing here decides that a feed is unusable.
   */
  frequencyTripCount: number | null;
  scheduledTripCount: number | null;
};

/** The coverage answer this control asks the app for, per selected feed. */
type TransitFeedCoverage = {
  coverage: "yes" | "no" | "not_determined";
  reason: string | null;
};

export type ModelRunStage = {
  id: string;
  stage_name: string;
  status: string;
  /**
   * The stage's declared position in the run.
   *
   * Projected because `summarizeRunFailure` picks the FIRST failed stage as the
   * cause, and without this column it was sorting on nothing — falling back to
   * whatever order PostgREST happened to return, on the one decision that
   * separates a cause from a stage blocked by it. Found by a type error, not by
   * a failing test, because the fixtures supplied a field the real query never
   * did.
   */
  sort_order?: number | null;
  started_at: string | null;
  completed_at: string | null;
  error_message?: string | null;
  log_tail?: string | null;
};

export type ModelRunArtifact = {
  id: string;
  artifact_type: string;
  file_url: string;
  file_size_bytes: number | null;
  content_hash?: string | null;
  metadata_json?: Record<string, unknown> | null;
};

type ManagedModelRun = {
  id: string;
  status: string;
  run_title: string;
  engine_key: string;
  source_analysis_run_id: string | null;
  scenario_entry_id: string | null;
  result_summary_json: Record<string, unknown> | null;
  error_message: string | null;
  /** Prior failed attempts this run was relaunched after (migration 20260810000001). */
  failure_count?: number | null;
  /** The previous failed attempt's recorded reason, captured before the relaunch wiped it. */
  last_failure_message?: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  stages: ModelRunStage[];
  artifacts: ModelRunArtifact[];
  /** Real claim tier for this run (from modeling_claim_decisions), resolved
   * server-side in the model page. Null → the panel derives from availability. */
  /** Recorded claim tier AND the reason it was recorded. The reason is what
   *  separates a coverage gap from a coarse zone system from a real
   *  disagreement with the counts — three findings behind one badge. */
  claimDecision?: ModelRunClaimDecision | null;
};

export type ModelRunComparisonCandidate = {
  id: string;
  runTitle: string;
  completedAt: string | null;
  scenarioLabel: string | null;
};

type ModelRunManagerProps = {
  modelId: string;
  modelTitle: string;
  defaultQueryText: string;
  defaultCorridorText: string;
  /**
   * Where `defaultCorridorText` came from — "this project's study area", "this
   * workspace's home geography", and so on.
   *
   * An inherited study area that does not say where it came from is a silent
   * assumption about what is being analysed, so this is shown whenever the area
   * was not picked here. Optional because the value is null when nothing was
   * inherited, which is also the only honest thing to display then.
   */
  studyAreaOriginLabel?: string | null;
  scenarioEntries: ScenarioEntryOption[];
  modelRuns: ManagedModelRun[];
  schemaPending: boolean;
  /**
   * What THIS DEPLOYMENT declares about the AequilibraE worker, read
   * server-side by the page (`resolveModelingWorkerDeclaration`) and handed
   * down — the worker is a poller, so there is nothing to probe and a
   * declaration is the only thing that can be known before the first run.
   *
   * Optional, defaulting to `"undeclared"`, and that default is load-bearing:
   * an un-wired caller behaves exactly as this control did before the
   * declaration existed, inferring from run history and claiming nothing else.
   * Silence from a page must never become a claim that a deployment has no
   * worker.
   */
  modelingWorkerDeclaration?: ModelingWorkerDeclaration;
  modelingWorkerHealth?: ModelingWorkerHealth | null;
  /**
   * The workspace this model belongs to, so the launch control can list the
   * workspace's own ingested transit feeds and ask whether one of them serves
   * this study area.
   *
   * Optional, and its absence simply withholds the transit-feed picker rather
   * than rendering an empty one — a control that cannot name a workspace cannot
   * honestly offer to read that workspace's feeds.
   */
  workspaceId?: string | null;
  /**
   * This workspace's ingested transit feeds, newest first, as the page already
   * reads them. Passed in rather than fetched here so the picker cannot render
   * before it knows whether the list is empty — an empty picker and a picker
   * that has not loaded look identical, and the first is a fact.
   */
  transitFeeds?: TransitFeedOption[];
  /**
   * The method this model record represents. Guided project comparisons use
   * this to open on AequilibraE or ActivitySim instead of the unrelated
   * deterministic corridor screen. Other model records retain that historical
   * default.
   */
  initialEngineKey?: ManagedRunModeKey;
  /** The scenario this model opens ready to run; normally the saved baseline. */
  initialScenarioEntryId?: string;
};

function fmtDateTime(value: string | null | undefined) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

const NON_TERMINAL_RUN_STATUSES = new Set(["queued", "running"]);
const RUN_POLL_INTERVAL_MS = 5000;
const STUCK_RUN_THRESHOLD_MS = 10 * 60 * 1000;

function isNonTerminalRun(run: Pick<ManagedModelRun, "status">): boolean {
  return NON_TERMINAL_RUN_STATUSES.has(run.status);
}

function latestProgressMs(run: ManagedModelRun): number | null {
  const times: number[] = [];
  const push = (value: string | null | undefined) => {
    if (!value) return;
    const t = new Date(value).getTime();
    if (Number.isFinite(t)) times.push(t);
  };
  push(run.created_at);
  push(run.started_at);
  for (const stage of run.stages ?? []) {
    push(stage.started_at);
    push(stage.completed_at);
  }
  return times.length ? Math.max(...times) : null;
}

/**
 * A run is "stuck" when it is queued/running, no stage is actively running
 * (so no worker is mid-execution), and there has been no stage progress for
 * over 10 minutes — the signature of "no worker has picked this up."
 */
function isRunStuck(run: ManagedModelRun, now: number): boolean {
  if (!isNonTerminalRun(run)) return false;
  const stages = run.stages ?? [];
  if (stages.some((stage) => stage.status === "running")) return false;
  const latest = latestProgressMs(run);
  if (latest === null) return false;
  return now - latest > STUCK_RUN_THRESHOLD_MS;
}

function toneForRunStatus(status: string): "info" | "success" | "warning" | "danger" | "neutral" {
  if (status === "succeeded") return "success";
  if (status === "running" || status === "queued") return "info";
  if (status === "failed" || status === "cancelled") return "warning";
  return "neutral";
}

function findScenarioEntryLabel(entries: ScenarioEntryOption[], scenarioEntryId: string | null) {
  if (!scenarioEntryId) return null;
  return entries.find((entry) => entry.id === scenarioEntryId)?.label ?? null;
}

function ManagedRunPromotionControl({
  modelId,
  run,
  scenarioEntries,
}: {
  modelId: string;
  run: ManagedModelRun;
  scenarioEntries: ScenarioEntryOption[];
}) {
  const router = useRouter();
  const [scenarioEntryId, setScenarioEntryId] = useState(run.scenario_entry_id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentLabel = findScenarioEntryLabel(scenarioEntries, run.scenario_entry_id);

  if (run.status !== "succeeded" || !run.source_analysis_run_id || scenarioEntries.length === 0) {
    return null;
  }

  async function handlePromote() {
    if (!scenarioEntryId) {
      setError("Select a scenario entry first.");
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/models/${modelId}/runs/${run.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scenarioEntryId }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Could not attach this run to the scenario entry");
      }

      router.refresh();
    } catch (promotionError) {
      setError(promotionError instanceof Error ? promotionError.message : "Could not attach this run to the scenario entry");
    } finally {
      setIsSubmitting(false);
    }
  }

  const unchanged = scenarioEntryId === (run.scenario_entry_id ?? "");

  return (
    <div className="mt-3 rounded-[0.5rem] border border-border/70 bg-background/70 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Promotion / reassignment</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {currentLabel
              ? `Currently attached to ${currentLabel}. Reassign if the evidence belongs to a different scenario entry.`
              : "This run succeeded but is not attached to a scenario entry yet. Promote it into one now."}
          </p>
        </div>
        {currentLabel ? <StatusBadge tone="neutral">Attached: {currentLabel}</StatusBadge> : null}
      </div>

      <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
        <select
          className="module-select md:max-w-sm"
          value={scenarioEntryId}
          onChange={(event) => setScenarioEntryId(event.target.value)}
          disabled={isSubmitting}
        >
          <option value="">Select scenario entry</option>
          {scenarioEntries.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.label} · {entry.entryType} · {entry.status}
            </option>
          ))}
        </select>
        <Button type="button" variant="outline" size="sm" onClick={() => void handlePromote()} disabled={isSubmitting || !scenarioEntryId || unchanged}>
          {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {currentLabel ? "Reassign to scenario" : "Promote to scenario"}
        </Button>
      </div>

      {error ? <p className="mt-2 text-xs text-red-600 dark:text-red-300">{error}</p> : null}
    </div>
  );
}

export function ModelRunManager({
  modelId,
  modelTitle,
  defaultQueryText,
  defaultCorridorText,
  studyAreaOriginLabel = null,
  scenarioEntries,
  modelRuns,
  schemaPending,
  modelingWorkerDeclaration = "undeclared",
  modelingWorkerHealth = null,
  workspaceId = null,
  transitFeeds = [],
  initialEngineKey = "deterministic_corridor_v1",
  initialScenarioEntryId = "",
}: ModelRunManagerProps) {
  const router = useRouter();
  const [title, setTitle] = useState(`${modelTitle} run`);
  // Non-ITE engines require BOTH a study area AND non-empty query text, so a
  // brand-new model (empty template) must not default the query box to "" —
  // that produced a launch 400 that read like a study-area error. Prefill a
  // sensible screening label; the operator can edit it.
  const [queryText, setQueryText] = useState(defaultQueryText || `Screening run — ${modelTitle}`);
  const [corridorText, setCorridorText] = useState(defaultCorridorText);
  const [scenarioEntryId, setScenarioEntryId] = useState(initialScenarioEntryId);
  const [attachToScenarioEntry, setAttachToScenarioEntry] = useState(true);
  const [engineKey, setEngineKey] = useState<ManagedRunModeKey>(initialEngineKey);
  const [zoneGeography, setZoneGeography] = useState<"tract" | "block_group">("tract");
  // Per-run count-calibration opt-in (aequilibrae / behavioral_demand). Default
  // off — OpenPlan ships an uncalibrated screening model.
  const [calibrate, setCalibrate] = useState(false);
  // Which of this workspace's ingested feeds this run models transit from.
  // Empty = leave the worker's own feed selection alone, which is what every
  // run did before this control existed.
  const [transitFeedId, setTransitFeedId] = useState("");
  const [transitCoverage, setTransitCoverage] = useState<TransitFeedCoverage | null>(null);
  const [isCheckingCoverage, setIsCheckingCoverage] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-silent handoff notice — e.g. a large sketch study area rerouted to the
  // async AequilibraE worker. Surfaced immediately so the operator knows why a
  // "fast" run is now queued on the worker. `queuedOnWorker` records that the
  // run left this app's process, because that changes what the notice means:
  // it is now waiting on infrastructure the app cannot see.
  const [launchNotice, setLaunchNotice] = useState<{ message: string; queuedOnWorker: boolean } | null>(null);
  // What, if anything, took the run that was just queued. Before this the three
  // possible futures — a worker has it, a poller might get it, nothing will ever
  // look at it — were rendered identically as "queued", and the planner learned
  // which one it had been fifteen minutes later from the reaper, or never.
  const [executionOutlook, setExecutionOutlook] = useState<ModelRunExecutionOutlook | null>(null);
  const displayedExecutionOutlook = useMemo(
    () => reconcileModelRunExecutionOutlook({ engineKey, health: modelingWorkerHealth, outlook: executionOutlook }),
    [engineKey, executionOutlook, modelingWorkerHealth],
  );
  // Set only by the planner, and only from the refusal below. The app cannot
  // observe a worker being started — it can only be told — so the person who
  // did it is the one who clears the refusal.
  //
  // It stores WHICH evidence was acknowledged rather than a bare "yes", because
  // a bare yes outlived the thing it answered: once ticked, a later abandonment
  // could not re-refuse, and the planner kept queueing runs into a queue that
  // had just eaten another one. Holding the key makes the acknowledgement
  // expire the moment fresh evidence arrives, with no effect and no reset to
  // forget — the comparison below simply stops matching.
  const [acknowledgedWorkerEvidenceKey, setAcknowledgedWorkerEvidenceKey] = useState<string | null>(
    null
  );
  const [acknowledgedHeartbeatKey, setAcknowledgedHeartbeatKey] = useState<string | null>(null);

  const selectedScenarioEntry = useMemo(
    () => scenarioEntries.find((entry) => entry.id === scenarioEntryId) ?? null,
    [scenarioEntries, scenarioEntryId]
  );
  const selectedRunMode = useMemo(() => getManagedRunModeDefinition(engineKey), [engineKey]);
  // Count calibration runs in the AequilibraE screening stages, so it applies to
  // the aequilibrae engine and the behavioral_demand preflight (whose screening
  // stages are AequilibraE-run).
  const supportsCalibration = engineKey === "aequilibrae" || engineKey === "behavioral_demand";
  const engineNeedsWorker = isWorkerBackedEngineKey(engineKey);
  // The transit skim runs in the AequilibraE worker, so only the two engines
  // that reach it may name a feed. Offering the control on an engine whose run
  // never skims transit would be a setting with no effect.
  const supportsTransitFeed = engineKey === "aequilibrae" || engineKey === "behavioral_demand";
  const selectedTransitFeed = useMemo(
    () => transitFeeds.find((feed) => feed.id === transitFeedId) ?? null,
    [transitFeeds, transitFeedId]
  );

  /**
   * Ask whether the chosen feed has any stops inside the study area, BEFORE the
   * run is queued.
   *
   * A DISCLOSURE, NEVER A GATE — the launch is not blocked on the answer and
   * the answer is allowed to be `not_determined`. The worker's own
   * `feed_covers` is the authority; this exists so a planner who picked the
   * wrong agency out of a list of four finds out now rather than from a
   * finished run with no transit in it.
   */
  useEffect(() => {
    if (!supportsTransitFeed || !workspaceId || !transitFeedId) {
      setTransitCoverage(null);
      setIsCheckingCoverage(false);
      return;
    }

    let corridor: unknown;
    try {
      corridor = corridorText.trim() ? JSON.parse(corridorText) : null;
    } catch {
      corridor = null;
    }
    if (!corridor) {
      setTransitCoverage(null);
      setIsCheckingCoverage(false);
      return;
    }

    let cancelled = false;
    setIsCheckingCoverage(true);
    void (async () => {
      try {
        const response = await fetch("/api/gtfs/feeds/study-area-coverage", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId, feedId: transitFeedId, corridorGeojson: corridor }),
        });
        const payload = (await response.json()) as TransitFeedCoverage & { error?: string };
        if (cancelled) return;
        // A failed check is `not_determined` with the reason, never a silent
        // nothing and never a "no": "we could not ask" and "this agency does
        // not serve here" are different facts.
        setTransitCoverage(
          response.ok
            ? { coverage: payload.coverage, reason: payload.reason ?? null }
            : {
                coverage: "not_determined",
                reason:
                  payload.error ??
                  "Whether this feed serves the study area could not be checked.",
              }
        );
      } catch (coverageError) {
        if (cancelled) return;
        setTransitCoverage({
          coverage: "not_determined",
          reason:
            coverageError instanceof Error
              ? `Whether this feed serves the study area could not be checked: ${coverageError.message}`
              : "Whether this feed serves the study area could not be checked.",
        });
      } finally {
        if (!cancelled) setIsCheckingCoverage(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supportsTransitFeed, workspaceId, transitFeedId, corridorText]);

  async function handleLaunch() {
    setError(null);
    setLaunchNotice(null);
    setExecutionOutlook(null);
    setIsLaunching(true);

    try {
      let parsedCorridorGeojson: unknown;
      try {
        parsedCorridorGeojson = corridorText.trim() ? JSON.parse(corridorText) : null;
      } catch {
        throw new Error("Corridor GeoJSON must be valid JSON");
      }

      const response = await fetch(`/api/models/${modelId}/runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          queryText: queryText.trim() || undefined,
          corridorGeojson: parsedCorridorGeojson || undefined,
          scenarioEntryId: scenarioEntryId || undefined,
          attachToScenarioEntry: attachToScenarioEntry && Boolean(scenarioEntryId),
          engineKey,
          zoneGeography: engineKey === "aequilibrae" ? zoneGeography : undefined,
          // Sent for the worker-backed engines that can calibrate; other engines
          // ignore it (and the route only stamps it for those two).
          calibrate: supportsCalibration ? calibrate : undefined,
          // Only the engines that reach a transit skim may name a feed. Sent
          // only when one was picked; an omitted field leaves the worker's own
          // feed precedence exactly as it has always been.
          transitFeedId: supportsTransitFeed && transitFeedId ? transitFeedId : undefined,
          workerHealthAcknowledgement: acknowledgedHeartbeatKey ?? undefined,
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        notice?: string;
        reroutedFrom?: string;
        dispatch?: ModelRunDispatchOutcome;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to launch managed model run");
      }

      // Only the lanes that leave this process carry a dispatch outcome. Its
      // absence therefore means "this ran here", not "we could not tell" — an
      // in-process run needs no statement about who will execute it.
      if (payload.dispatch) {
        setExecutionOutlook(describeModelRunDispatch(payload.dispatch, modelingWorkerDeclaration));
      }

      if (typeof payload.notice === "string" && payload.notice.trim()) {
        setLaunchNotice({
          message: payload.notice.trim(),
          // A reroute is the server telling us it moved this run onto the
          // worker queue. Whatever the planner picked, the run is now worker-
          // backed, and the notice has to say so rather than read as a routine
          // "this will take a bit longer".
          queuedOnWorker: Boolean(payload.reroutedFrom),
        });
      }

      router.refresh();
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : "Failed to launch managed model run");
    } finally {
      setIsLaunching(false);
    }
  }

  const latestRun = modelRuns[0] ?? null;
  const latestBehavioralAgreementRun = modelRuns.find(
    (run) =>
      run.status === "succeeded" &&
      run.engine_key === "behavioral_demand" &&
      run.artifacts.some((artifact) => artifact.artifact_type === "demand_model_agreement_geojson"),
  );
  const hasActiveRun = useMemo(() => modelRuns.some(isNonTerminalRun), [modelRuns]);
  const [now, setNow] = useState(0);

  // Poll while any run is non-terminal so the UI reflects worker progress
  // without a manual refresh. Pause when the tab is hidden; stop when terminal.
  // `now` advances only inside the timer, keeping stuck-run detection live
  // without any setState during render/effect body.
  useEffect(() => {
    if (!hasActiveRun) return;
    const id = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      setNow(Date.now());
      router.refresh();
    }, RUN_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [hasActiveRun, router]);

  const stuckRuns = useMemo(
    () => (now ? modelRuns.filter((run) => isRunStuck(run, now)) : []),
    [modelRuns, now]
  );

  /**
   * Refuse-before-enqueue for the worker-backed engines.
   *
   * `modelRuns` arrives newest-first and already reflects the reap, so the same
   * rows that tell the history tell whether anything has been executing it.
   * `now` is 0 until the poll timer runs (React render may not read a clock),
   * and null means "no clock yet" to the assessment rather than "epoch".
   *
   * Two sources, in the order the gate defines: what the deployment declares,
   * and what its runs show. A deployment that declares no worker refuses the
   * FIRST launch — there is no history to infer from on a new model, which is
   * exactly the case history could never cover.
   */
  const workerGate = useMemo(
    () =>
      evaluateWorkerLaunchGate({
        engineKey,
        declaration: modelingWorkerDeclaration,
        runs: modelRuns,
        now: now > 0 ? now : null,
      }),
    [engineKey, modelingWorkerDeclaration, modelRuns, now]
  );
  const workerRefusesLaunch = workerGate.refused;
  const workerRefusalCopy = workerGate.reason
    ? describeWorkerLaunchRefusal(workerGate.reason, selectedRunMode.label, workerGate.evidence)
    : null;
  // The acknowledgement holds only against the evidence it was given for.
  const workerAcknowledged =
    workerGate.acknowledgementKey !== null &&
    acknowledgedWorkerEvidenceKey === workerGate.acknowledgementKey;
  const heartbeatGate = modelingWorkerHealth
    ? evaluateWorkerHealthLaunchGate(engineKey, modelingWorkerHealth)
    : { blocked: false, acknowledgementKey: null, reason: null, states: [] };
  const heartbeatAcknowledged =
    heartbeatGate.acknowledgementKey !== null &&
    acknowledgedHeartbeatKey === heartbeatGate.acknowledgementKey;

  /**
   * Engine-independent, because the reroute notice needs it for `sketch_abm` —
   * a lane that is not worker-backed at the button but can be handed to the
   * worker queue server-side.
   */
  const workerReadiness = useMemo(
    () => assessWorkerLaunchReadiness(modelRuns, now > 0 ? now : null),
    [modelRuns, now]
  );
  const workerAbsenceEvidence = describeWorkerAbsenceEvidence(workerReadiness);
  // "preflight" is launchable (it runs an honest input-validation / runtime-staging
  // preflight); only "prototype" keeps the launch button disabled outright. The
  // worker refusal is the other block. An inference-based one is clearable by the
  // one person who can know the thing this app cannot observe; one the deployment
  // itself declared is not, because that answer was already given by the only
  // party who can change it.
  const launchDisabled =
    isLaunching ||
    schemaPending ||
    selectedRunMode.availability === "prototype" ||
    (heartbeatGate.blocked && !heartbeatAcknowledged) ||
    (workerRefusesLaunch && !workerAcknowledged);

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Runs</p>
          <h2 className="module-section-title">Launch and track this model&apos;s runs</h2>
          <p className="module-section-description">
            Each launch keeps an exact copy of its inputs, so a run can always be traced back to what went into it. Attach the results to the right scenario entry when they arrive.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Play className="h-5 w-5" />
        </span>
      </div>

        <div className="module-summary-grid cols-4 mt-5">
        <div className="module-summary-card">
          <p className="module-summary-label">Runs</p>
          <p className="module-summary-value">{modelRuns.length}</p>
          <p className="module-summary-detail">Runs recorded for this model.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Latest status</p>
          <p className="module-summary-value text-base">{latestRun ? latestRun.status : "None"}</p>
          <p className="module-summary-detail">{latestRun ? latestRun.run_title : "No runs launched yet."}</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Scenario entries</p>
          <p className="module-summary-value">{scenarioEntries.length}</p>
          <p className="module-summary-detail">Scenario entries a run&apos;s results can be attached to.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Run modes available</p>
          <p className="module-summary-value text-base">{MANAGED_RUN_MODE_DEFINITIONS.length}</p>
          <p className="module-summary-detail">{MANAGED_RUN_MODE_DEFINITIONS.map((mode) => mode.shortLabel).join(" · ")}</p>
        </div>
      </div>

      {schemaPending ? (
        <div className="module-empty-state mt-5 text-sm">
          This OpenPlan installation&apos;s database has not been updated for model runs yet (the `model_runs` table is missing). Whoever operates this installation applies the newest database migration; runs cannot be launched until then.
        </div>
      ) : null}

      {latestBehavioralAgreementRun ? (
        <section
          aria-labelledby={`agreement-map-${latestBehavioralAgreementRun.id}`}
          className="mt-5 space-y-2"
          data-agreement-run-id={latestBehavioralAgreementRun.id}
        >
          <h3
            className="text-sm font-semibold text-foreground"
            id={`agreement-map-${latestBehavioralAgreementRun.id}`}
          >
            Demand-method sensitivity from {latestBehavioralAgreementRun.run_title}
          </h3>
          <DemandAgreementMap
            geojsonUrl={`/api/models/${modelId}/runs/${latestBehavioralAgreementRun.id}/agreement`}
          />
        </section>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
        <div className="rounded-[0.5rem] border border-border/70 bg-background/75 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Launch run</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Use the model&apos;s defaults, then optionally attach the results to a specific scenario entry.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="managed-run-engine" className="text-[0.82rem] font-semibold">
              Run mode
            </label>
            <select
              id="managed-run-engine"
              className="module-select"
              value={engineKey}
              onChange={(event) => setEngineKey(event.target.value as ManagedRunModeKey)}
            >
              {MANAGED_RUN_MODE_DEFINITIONS.map((mode) => (
                <option key={mode.key} value={mode.key}>
                  {mode.launchLabel}
                </option>
              ))}
            </select>
            <div className="rounded-[0.5rem] border border-border/60 bg-background/80 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-foreground">{selectedRunMode.label}</p>
                <StatusBadge tone={selectedRunMode.availability === "launchable" ? "info" : "warning"}>
                  {selectedRunMode.availability === "launchable"
                    ? "Launchable"
                    : selectedRunMode.availability === "preflight"
                      ? "Readiness check"
                      : "Prototype"}
                </StatusBadge>
              </div>
              <p className="mt-2 text-muted-foreground">{selectedRunMode.summaryDetail}</p>
              <p className="mt-2 text-muted-foreground">
                <span className="text-foreground">Expected runtime:</span> {selectedRunMode.runtimeExpectation}
              </p>
              <p className="mt-2 text-muted-foreground">
                <span className="text-foreground">Caveat:</span> {selectedRunMode.caveatSummary}
              </p>
              {engineNeedsWorker ? (
                <p className="mt-2 text-muted-foreground">
                  <span className="text-foreground">Where it runs:</span> not in this app. Launching
                  queues the run for a separate AequilibraE processing worker, which whoever operates
                  this OpenPlan installation has to be running for it to finish.
                </p>
              ) : null}
              {engineKey === "sketch_abm" ? (
                /* The in-app lane is only in-app up to a point. Above the launch
                   route's zone cap a sketch run is handed to the same worker
                   queue, which for a mid-size city is the normal case, not an
                   edge case — so the dependency is stated before the click. The
                   cap itself is deliberately not repeated here: the route owns
                   that number and states it in the reroute notice, and a second
                   copy in the UI is a number that can silently drift. */
                <p className="mt-2 text-muted-foreground">
                  <span className="text-foreground">Where it runs:</span> in this app for study areas
                  within the sketch model&apos;s size limit. A larger area — a mid-size city or a metro —
                  is sent to the same modeling worker queue Fast Screening uses, so it needs that
                  worker running to finish. The launch tells you when that happens.
                </p>
              ) : null}
              {engineKey === "ite_trip_generation" ? (
                <p className="mt-2 text-muted-foreground">
                  <span className="text-foreground">Input:</span> Trip Generation ignores the query
                  text and study area. It uses the land-use program saved on the selected scenario
                  entry (its <code>tripGenProgram</code> assumption); launching without one stops
                  with an error saying what to add.
                </p>
              ) : null}
            </div>
          </div>

          {engineKey === "aequilibrae" ? (
            <div className="space-y-1.5">
              <label htmlFor="managed-run-zone-geography" className="text-[0.82rem] font-semibold">
                Zone geography (TAZ resolution)
              </label>
              <select
                id="managed-run-zone-geography"
                className="module-select"
                value={zoneGeography}
                onChange={(event) => setZoneGeography(event.target.value as "tract" | "block_group")}
              >
                <option value="tract">Census tracts (default)</option>
                <option value="block_group">Block groups (~3x finer zones)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Block groups lower the intrazonal trip share, so trip lengths and screening VMT
                resolve finer. Population and households are tract ACS totals disaggregated by
                LODES residence weights. Both resolutions are screening-grade.
              </p>
            </div>
          ) : null}

          {supportsTransitFeed && workspaceId ? (
            <div className="space-y-1.5" data-testid="managed-run-transit-feed">
              <label htmlFor="managed-run-transit-feed" className="text-[0.82rem] font-semibold">
                Transit feed (optional)
              </label>
              {transitFeeds.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  This workspace has no transit feed in use yet. Bring your agency&apos;s GTFS feed in
                  from the{" "}
                  <Link href="/data-hub" className="underline underline-offset-2">
                    Data Hub
                  </Link>{" "}
                  to model transit from it. Without one, the modeling worker picks a feed the way it
                  always has — one the deployment&apos;s operator configured, one discovered in the
                  published-feed catalog for this study area, or the feed bundled with the worker.
                </p>
              ) : (
                <>
                  <select
                    id="managed-run-transit-feed"
                    className="module-select"
                    value={transitFeedId}
                    onChange={(event) => setTransitFeedId(event.target.value)}
                  >
                    <option value="">
                      Let the modeling worker choose (catalog discovery, or the operator&apos;s feed)
                    </option>
                    {transitFeeds.map((feed) => (
                      <option key={feed.id} value={feed.id}>
                        {feed.agencyName}
                        {feed.serviceEndDate ? ` · schedule through ${feed.serviceEndDate}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Naming a feed hands the modeling worker the exact archive OpenPlan parsed —
                    verified against its checksum — instead of letting it fetch an address that may
                    have been republished since. It overrides the worker&apos;s own feed selection for
                    this run.
                  </p>
                  {/* Both disclosures are about the SELECTED feed, and both are
                      stated before the click rather than discovered from a
                      finished run that quietly modeled no transit. */}
                  {selectedTransitFeed?.frequencyTripCount ? (
                    <p
                      className="text-xs text-amber-700 dark:text-amber-300"
                      data-testid="managed-run-transit-feed-frequencies"
                    >
                      {selectedTransitFeed.frequencyTripCount.toLocaleString()} of this feed&apos;s
                      trips are published as a headway range (<code>frequencies.txt</code>) rather
                      than individual departures. The modeling worker leaves those out of the transit
                      skim and says how many it left out
                      {selectedTransitFeed.scheduledTripCount
                        ? `, so this run's transit comes from the other ${selectedTransitFeed.scheduledTripCount.toLocaleString()} scheduled trip(s)`
                        : ""}
                      . The feed is still handed over. Re-ingesting will not change the split; it is
                      how the agency publishes.
                    </p>
                  ) : null}
                  {selectedTransitFeed?.serviceEndDate ? (
                    <p className="text-xs text-muted-foreground">
                      Its published schedule runs through {selectedTransitFeed.serviceEndDate}. An
                      expired schedule is usually the last one the agency published and is normally
                      the right thing to model from — the run records that it was expired so nobody
                      has to guess later.
                    </p>
                  ) : null}
                  {isCheckingCoverage ? (
                    <p className="text-xs text-muted-foreground">
                      Checking whether this feed has stops in the study area…
                    </p>
                  ) : null}
                  {!isCheckingCoverage && transitCoverage?.coverage === "no" ? (
                    <p
                      className="text-xs text-amber-700 dark:text-amber-300"
                      data-testid="managed-run-transit-feed-coverage-no"
                    >
                      None of this feed&apos;s stops fall inside this study area&apos;s bounding box. The
                      run can still be launched — the modeling worker makes the final judgement
                      against the resolved zone system — but this usually means a different agency
                      serves the area.
                    </p>
                  ) : null}
                  {!isCheckingCoverage && transitCoverage?.coverage === "not_determined" ? (
                    <p className="text-xs text-muted-foreground">
                      {transitCoverage.reason ??
                        "Whether this feed serves the study area could not be checked."}
                    </p>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {supportsCalibration ? (
            <div className="space-y-1.5">
              <label className="module-note flex items-start gap-3 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-border"
                  checked={calibrate}
                  onChange={(event) => setCalibrate(event.target.checked)}
                />
                <span>
                  Tune the assignment to local traffic counts, where you have them. The CEQA VMT
                  input is unchanged either way.
                </span>
              </label>
              <p className="text-xs text-muted-foreground">
                The held-out counts choose and reject calibration steps; they are candidate-selection
                evidence, not an independent accuracy test. A calibrated-to-counts claim requires a
                separate untouched validation result. Where no counts match, calibration does not run.
                Calibrated VMT publishes under distinct KPI names — it never becomes the CEQA
                §15064.3 determination input.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label htmlFor="managed-run-title" className="text-[0.82rem] font-semibold">
              Run title
            </label>
            <Input id="managed-run-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="managed-run-scenario" className="text-[0.82rem] font-semibold">
              Scenario entry (optional)
            </label>
            <select
              id="managed-run-scenario"
              className="module-select"
              value={scenarioEntryId}
              onChange={(event) => setScenarioEntryId(event.target.value)}
            >
              <option value="">Not attached to a scenario entry</option>
              {scenarioEntries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label} · {entry.entryType} · {entry.assumptionCount} assumptions
                </option>
              ))}
            </select>
            {selectedScenarioEntry ? (
              <p className="text-xs text-muted-foreground">
                Selected entry is currently {selectedScenarioEntry.status}. If attach is enabled, the completed run will become its attached evidence.
              </p>
            ) : null}
          </div>

          <label className="module-note flex items-center gap-3 text-sm text-foreground">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border"
              checked={attachToScenarioEntry}
              onChange={(event) => setAttachToScenarioEntry(event.target.checked)}
              disabled={!scenarioEntryId}
            />
            Attach completed run to selected scenario entry
          </label>

          <div className="space-y-1.5">
            <label htmlFor="managed-run-query" className="text-[0.82rem] font-semibold">
              Query text
            </label>
            <Textarea
              id="managed-run-query"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              rows={5}
              placeholder="Describe what this run is analyzing."
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-[0.82rem] font-semibold">Study area</label>
            <StudyAreaPicker
              corridorText={corridorText}
              onCorridorChange={setCorridorText}
              // Only while the inherited area is still the one in the box. The
              // moment a planner changes it, saying where the OLD one came from
              // would be describing something that is no longer on screen.
              externalLabel={corridorText === defaultCorridorText ? studyAreaOriginLabel : null}
            />
            {studyAreaOriginLabel && corridorText === defaultCorridorText ? (
              <p className="text-xs text-muted-foreground">
                Starting from {studyAreaOriginLabel}. Change it here to run somewhere else — this
                does not alter the source.
              </p>
            ) : null}
            <details className="mt-1 rounded-[0.5rem] border border-border/60 bg-background/60 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                Advanced: edit raw corridor GeoJSON
              </summary>
              <Textarea
                id="managed-run-corridor"
                value={corridorText}
                onChange={(event) => setCorridorText(event.target.value)}
                rows={8}
                placeholder='{"type":"Polygon","coordinates":[...]}'
                className="mt-2 font-mono text-xs"
              />
            </details>
          </div>

          {error ? (
            <p className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </p>
          ) : null}

          {launchNotice ? (
            <div
              className={
                // Amber whenever the run has landed on a queue there is reason to
                // doubt — abandoned runs, or a deployment that says it runs no
                // worker at all. Calm blue there would be false reassurance.
                launchNotice.queuedOnWorker &&
                (workerAbsenceEvidence !== null || modelingWorkerDeclaration === "absent")
                  ? "rounded-[0.5rem] border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
                  : "rounded-[0.5rem] border border-sky-300/80 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200"
              }
            >
              <p>{launchNotice.message}</p>
              {launchNotice.queuedOnWorker ? (
                <p className="mt-2">
                  That queue is served by the AequilibraE worker, not by this app.{" "}
                  {/* Superseded by the execution outlook below when there is
                      one, and this is not a preference. That block is computed
                      from strictly more information — it knows whether a worker
                      OpenPlan pushed to actually answered — so keeping this
                      sentence alongside it would let the panel contradict
                      itself: on a deployment that declares nothing, this one
                      says the run "finishes only while a modeling worker is
                      checking this installation for runs", which is plainly
                      false about a run a pushed worker has already accepted. It still renders when no outlook exists,
                      which is the pre-push behaviour, unchanged. */}
                  {displayedExecutionOutlook
                    ? null
                    : describeWorkerQueueRisk(modelingWorkerDeclaration, workerAbsenceEvidence)}
                </p>
              ) : null}
            </div>
          ) : null}

          {/* WHAT IS GOING TO RUN THIS. The single most-felt gap in the worker
              lane: every queued run looked the same whether a worker had taken
              it, a poller might, or nothing on the deployment ever would. The
              copy lives in run-dispatch.ts so each sentence can be tested for
              what it claims without rendering anything. */}
          {displayedExecutionOutlook ? (
            <div
              data-testid="model-run-execution-outlook"
              data-outlook-state={displayedExecutionOutlook.state}
              className={
                displayedExecutionOutlook.state === "accepted"
                  ? "rounded-[0.5rem] border border-emerald-300/80 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
                  : displayedExecutionOutlook.state === "unattended"
                    ? "rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
                    : displayedExecutionOutlook.state === "waiting_for_poller"
                      ? "rounded-[0.5rem] border border-sky-300/80 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200"
                      : "rounded-[0.5rem] border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
              }
            >
              <p className="font-semibold">{displayedExecutionOutlook.headline}</p>
              <p className="mt-2">{displayedExecutionOutlook.detail}</p>
              {/* Run history is evidence the dispatch result cannot see, so it
                  is added rather than replaced — a worker that accepted this run
                  does not explain the ones nothing ever started. */}
              {workerAbsenceEvidence && displayedExecutionOutlook.state !== "accepted" ? (
                <p className="mt-2">{workerAbsenceEvidence}</p>
              ) : null}
            </div>
          ) : null}

          {selectedRunMode.availability === "prototype" ? (
            <div className="rounded-[0.5rem] border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              {selectedRunMode.label} is a prototype — it cannot be launched from this form yet. {selectedRunMode.runtimeExpectation} {selectedRunMode.caveatSummary}
            </div>
          ) : selectedRunMode.availability === "preflight" ? (
            <div className="rounded-[0.5rem] border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              Launching {selectedRunMode.label} runs a <span className="font-semibold">readiness check</span> — it checks your inputs and prepares the model, and it is <span className="font-semibold">NOT a behavioral forecast</span>. {selectedRunMode.caveatSummary}
            </div>
          ) : null}

          {heartbeatGate.states.length > 0 ? (
            <div
              data-testid="worker-heartbeat-health"
              className={`rounded-[0.5rem] border px-4 py-3 text-sm ${heartbeatGate.blocked ? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200" : "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200"}`}
            >
              <p className="font-semibold">Modeling worker health</p>
              {heartbeatGate.states.map((state) => (
                <p key={state.kind} className="mt-1" data-worker-kind={state.kind} data-worker-state={state.state}>
                  {state.kind === "aequilibrae" ? "AequilibraE" : "ActivitySim"}: {state.reason}
                </p>
              ))}
              {heartbeatGate.acknowledgementKey ? (
                <label className="mt-3 flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={heartbeatAcknowledged}
                    onChange={(event) => setAcknowledgedHeartbeatKey(event.target.checked ? heartbeatGate.acknowledgementKey : null)}
                  />
                  <span>I understand this exact stale observation. Queue the run without treating heartbeat loss as proof that existing work stopped.</span>
                </label>
              ) : null}
            </div>
          ) : null}

          {/* The refusal. It fires BEFORE the enqueue, because after it there is
              nothing left to say that is not either a false success or a
              fifteen-minute-late failure. It names what was observed OR what
              this deployment declared — and which of the two it is, since they
              carry different weight — names the deployment operator as the
              party who acts (never a plan, a tier or an upgrade, none of which
              exist here), and hands over the lanes that do run, so a refusal is
              never a dead end. */}
          {workerRefusesLaunch && workerRefusalCopy ? (
            <div
              data-testid="worker-launch-refusal"
              className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
            >
              {/* The heading may claim no more than the rows underneath it do.
                  An older worker or pending heartbeat migration may still leave
                  process health unknown, so an inference-based heading states
                  the observation (nothing picked these runs up)
                  rather than the conclusion (there is no worker). Where the
                  deployment has declared the answer itself, the heading may say
                  so, and attributes it: the deployment said this, OpenPlan did
                  not discover it. `describeWorkerLaunchRefusal` owns which of
                  those is on screen. */}
              <p className="font-semibold">{workerRefusalCopy.heading}</p>
              <p className="mt-2">{workerRefusalCopy.body}</p>
              <p className="mt-2">{workerRefusalCopy.operatorAction}</p>
              <p className="mt-3 font-semibold">These run modes execute in this app right now:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {IN_PROCESS_ENGINE_KEYS.map((inProcessKey) => (
                  <Button
                    key={inProcessKey}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEngineKey(inProcessKey)}
                  >
                    Switch to {getManagedRunModeDefinition(inProcessKey).label}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs">
                One caveat on the sketch model: it runs in this app only up to its study-area size
                limit. A larger study area is sent to this same modeling worker queue, so a
                metro-scale sketch run depends on the worker too.
              </p>
              {/* Offered only where the refusal rests on inference. A deployment
                  that declares no worker has been answered by the person who
                  would have to start one, and a planner ticking a box does not
                  make that false — so there is no box, and the paragraph above
                  says who changes it instead. */}
              {workerGate.acknowledgementKey !== null ? (
                <label className="mt-3 flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-border"
                    checked={workerAcknowledged}
                    onChange={(event) =>
                      setAcknowledgedWorkerEvidenceKey(
                        event.target.checked ? workerGate.acknowledgementKey : null
                      )
                    }
                  />
                  <span>
                    A modeling worker has been started on this OpenPlan installation since those
                    runs — queue this one anyway. (OpenPlan has no way to check this on its own —
                    only you can tell it. If another run is abandoned after this, the refusal comes
                    back — the tick answers the runs on screen now, not every run from here on.)
                  </span>
                </label>
              ) : null}
            </div>
          ) : null}

          <Button type="button" onClick={() => void handleLaunch()} disabled={launchDisabled}>
            {isLaunching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {heartbeatGate.blocked && !heartbeatAcknowledged
              ? "Launch blocked — required worker health is not current"
              : workerRefusesLaunch && !workerAcknowledged
              ? workerGate.reason === "deployment_declares_no_worker"
                ? "Launch refused — this installation declares no modeling worker"
                : workerGate.reason === "declared_worker_never_started"
                  ? "Launch refused — the declared worker has not been picking these runs up"
                  : "Launch refused — nothing has been picking these runs up"
              : selectedRunMode.availability === "launchable"
                ? "Launch run"
                : selectedRunMode.availability === "preflight"
                  ? "Run readiness check"
                  : `${selectedRunMode.label} launch not yet available`}
          </Button>
        </div>

        <div className="rounded-[0.5rem] border border-border/70 bg-background/75 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Run history</p>
              <p className="mt-1 text-sm text-muted-foreground">The latest runs launched from this model.</p>
            </div>
            <StatusBadge tone={modelRuns.length > 0 ? "info" : "neutral"}>{modelRuns.length} stored</StatusBadge>
          </div>

          {/* Show map for the latest succeeded AequilibraE run */}
          {modelRuns.some((r) => r.status === "succeeded" && r.engine_key === "aequilibrae") && (() => {
            const latestAeqRun = modelRuns.find((r) => r.status === "succeeded" && r.engine_key === "aequilibrae")!;
            const geojsonUrl = `/api/models/${modelId}/runs/${latestAeqRun.id}/volumes`;
            return (
              <div className="mt-4">
                <TrafficVolumeMap geojsonUrl={geojsonUrl} />
              </div>
            );
          })()}

          {hasActiveRun ? (
            <div className="mt-3 flex items-center gap-2 rounded-[0.5rem] border border-sky-200/80 bg-sky-50/60 px-4 py-2.5 text-sm text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
              <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
              <span>One or more runs are in progress. This view auto-refreshes every few seconds while runs are active (paused when the tab is hidden).</span>
            </div>
          ) : null}

          {stuckRuns.length > 0 ? (
            <div className="mt-3 flex items-start gap-2 rounded-[0.5rem] border border-amber-300/80 bg-amber-50/70 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                {stuckRuns.length === 1
                  ? `Run "${stuckRuns[0].run_title}" has been ${stuckRuns[0].status} for over 10 minutes with no stage progress.`
                  : `${stuckRuns.length} runs have been queued/running for over 10 minutes with no stage progress.`}{" "}
                No worker has picked this up — check that the modeling worker is running (see
                {" "}<code>workers/aequilibrae_worker/DEPLOY.md</code>).
              </span>
            </div>
          ) : null}

          {modelRuns.length === 0 ? (
            <div className="module-empty-state mt-5 text-sm">
              No runs yet. Every launch is recorded here, with a link to its results once they exist.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {modelRuns.map((run) => {
                const resultSummary = run.result_summary_json ?? {};
                const overallScore = typeof resultSummary.overallScore === "number" ? resultSummary.overallScore : null;
                const runLink = run.source_analysis_run_id ? `/explore?runId=${run.source_analysis_run_id}#analysis-run-history` : null;
                const scenarioLabel = findScenarioEntryLabel(scenarioEntries, run.scenario_entry_id);
                const runMode = getManagedRunModeDefinition(run.engine_key);
                // Null for anything that has not terminally failed.
                const failureSummary = summarizeRunFailure({
                  status: run.status,
                  errorMessage: run.error_message,
                  stages: run.stages,
                  failureCount: run.failure_count,
                  lastFailureMessage: run.last_failure_message,
                });
                const comparisonCandidates = modelRuns
                  .filter((candidate) => candidate.id !== run.id && candidate.status === "succeeded")
                  .map((candidate) => ({
                    id: candidate.id,
                    runTitle: candidate.run_title,
                    completedAt: candidate.completed_at ?? candidate.started_at ?? candidate.created_at,
                    scenarioLabel: findScenarioEntryLabel(scenarioEntries, candidate.scenario_entry_id),
                  }));

                return (
                  <div key={run.id} className="module-record-row">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={toneForRunStatus(run.status)}>{run.status}</StatusBadge>
                        <StatusBadge tone="neutral">{labelForEngineKey(run.engine_key)}</StatusBadge>
                        {scenarioLabel ? <StatusBadge tone="neutral">{scenarioLabel}</StatusBadge> : null}
                        {overallScore !== null ? <StatusBadge tone="success">Overall {overallScore}/100</StatusBadge> : null}
                        {runMode.availability !== "launchable" ? <StatusBadge tone="warning">{runMode.availability === "preflight" ? "Readiness check" : "Prototype"}</StatusBadge> : null}
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title">{run.run_title}</h3>
                          <p className="module-record-stamp">{fmtDateTime(run.completed_at ?? run.started_at ?? run.created_at)}</p>
                        </div>
                        {/*
                          A FAILED RUN MUST NOT DESCRIBE ITSELF AS A RECORDED ONE.
                          The worker writes its reason to the failing STAGE and
                          patches only `{status: "failed"}` onto the run, so
                          `run.error_message` is null for the whole AequilibraE
                          lane and this line used to fall through to "Run
                          recorded — no linked analysis results yet." on a run
                          that had crashed. `summarizeRunFailure` returns null
                          for every non-failed run, so the copy below is
                          untouched for them.
                        */}
                        {failureSummary ? (
                          <p
                            className="module-record-summary text-red-700 dark:text-red-300"
                            data-testid="run-failure-summary"
                          >
                            {failureSummary.headline}
                          </p>
                        ) : null}
                        {/*
                          A REPEAT FAILURE SAYS SO. A relaunch resets the run
                          row in place, so before failure_count existed a third
                          failure rendered exactly like a first and the copy
                          above could suggest retrying forever. Same-error
                          repeats are the case that matters: they tell the
                          planner the relaunch button is not the fix.
                        */}
                        {failureSummary?.repeat ? (
                          <p
                            className="text-sm text-red-700/80 dark:text-red-300/80"
                            data-testid="run-repeat-failure"
                          >
                            {failureSummary.repeat.sameAsLast
                              ? `This run has now failed ${failureSummary.repeat.priorFailures + 1} times with the same recorded reason — relaunching again without changing something is unlikely to end differently.`
                              : `This run failed ${failureSummary.repeat.priorFailures} ${failureSummary.repeat.priorFailures === 1 ? "time" : "times"} before, with a different recorded reason.`}
                          </p>
                        ) : null}
                        {failureSummary ? null : (
                          <p className="module-record-summary">
                            {run.error_message ||
                              (run.source_analysis_run_id
                                ? `Backed by analysis run ${run.source_analysis_run_id}.`
                                : "Run recorded — no linked analysis results yet.")}
                          </p>
                        )}
                        {/*
                          A RUN THAT HAS STOPPED MAKES NO PROMISES ABOUT WHAT
                          HAPPENS NEXT. `runtimeExpectation` reads "Keeps
                          working after you leave the page — expect results in a
                          few minutes", and rendering it unconditionally put
                          that directly beneath the sentence explaining the run
                          had failed — making a terminal failure look transient
                          and already being retried. `failureSummary` is non-null
                          exactly when the run stopped for good, so it is the
                          predicate rather than a second opinion about one.

                          `caveatSummary` STAYS: it describes what the engine IS
                          ("Screening-grade prototype output…"), which is as true
                          of a failed run as a finished one. Only the
                          forward-looking claim is withheld.
                        */}
                        {failureSummary ? null : (
                          <p
                            className="text-sm text-muted-foreground"
                            data-testid="run-runtime-expectation"
                          >
                            {runMode.runtimeExpectation}
                          </p>
                        )}
                        <p className="text-sm text-muted-foreground">{runMode.caveatSummary}</p>
                        {/*
                          The caveat above states a grade; this is where a
                          planner finds out what that grade permits — and this
                          run's own zone-resolution and benchmark figures, which
                          the general explanation cannot know.
                        */}
                        <ModelRunScreeningGradeNote
                          modelId={modelId}
                          modelRunId={run.id}
                          engineKey={run.engine_key}
                          runStatus={run.status}
                        />
                      </div>
                      {runLink ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Link href={runLink} className="inline-flex">
                            <Button type="button" variant="outline" size="sm">
                              Open in Studio
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </Link>
                        </div>
                      ) : null}
                      <ModelRunStagingAndArtifacts
                        modelId={modelId}
                        run={run}
                        stages={run.stages}
                        artifacts={run.artifacts}
                        comparisonCandidates={comparisonCandidates}
                      />
                      <ManagedRunPromotionControl modelId={modelId} run={run} scenarioEntries={scenarioEntries} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * How far along a run is, for runs that legitimately take hours or days.
 *
 * The percentage is stages finished over stages declared at launch — a known
 * denominator, not a guess. There is deliberately no time estimate: stage
 * durations differ by an order of magnitude and an equilibrium assignment's
 * length is unknowable until it converges, so minutes-remaining would be a
 * fabrication wearing a progress bar's authority. Elapsed time IS shown,
 * because it is a fact and because "4h 12m in this stage" is the difference
 * between confidence and a support request.
 */
/**
 * How accurate this run is, road type by road type.
 *
 * A SINGLE MEDIAN ERROR IS TRUE OF NO ROAD IN PARTICULAR. Measured across 24
 * counties, a screening run's error on freeways and on collectors differ by a
 * factor of three, so a planner reading one overall figure cannot tell which
 * corridor numbers the run can support. This is the same chart the funder-facing
 * provenance document embeds, from the same module, so the screen and the
 * document can never disagree about what the model said.
 *
 * The table is not decoration: it is the channel for a reader who cannot see
 * the chart, and it carries the station counts that decide whether a figure is
 * evidence at all.
 */
function RunAccuracyByClass({
  rows,
  stations,
}: {
  rows: RoadClassAccuracy[];
  stations: AccuracyPoint[];
}) {
  // THE CHART MUST WEAR THE PAGE'S THEME. Found by looking, not by a test: a
  // light-surfaced SVG injected into the dark app read as a pasted screenshot,
  // and jsdom applies no stylesheet so nothing in the suite could ever see it.
  // The palette's dark steps were validated for the dark surface separately —
  // this is a selection, never an automatic inversion.
  const { resolvedTheme } = useTheme();
  const mode = resolvedTheme === "dark" ? "dark" : "light";
  const ordered = useMemo(() => accuracyByClassRows(rows), [rows]);
  // The scatter is the picture a modeller reads first — bias, spread and
  // outliers at once, where a median shows none of them. Drawn only when the
  // run actually recorded per-station comparisons.
  const scatter = useMemo(
    () =>
      stations.length
        ? accuracyScatterSvg(stations, {
            mode,
            title: "Modelled volume against observed count",
            subtitle: `${stations.length} matched station${stations.length === 1 ? "" : "s"} · each dot is one count location`,
          })
        : null,
    [stations, mode]
  );
  const worst = useMemo(() => accuracyScatterRows(stations).slice(0, 5), [stations]);
  const svg = useMemo(
    () =>
      accuracyByClassSvg(rows, {
        mode,
        title: "Accuracy by road type",
        subtitle: `${rows.reduce((total, row) => total + row.stations, 0)} matched count stations`,
      }),
    [rows, mode]
  );

  return (
    <div className="mt-4 border-t pt-4" data-testid="run-accuracy-by-class">
      <h4 className="mb-2 font-semibold">Accuracy by road type</h4>
      <div
        className="overflow-x-auto rounded-[12px] border border-border/60"
        // The chart is generated by the same tested module the report uses; it
        // contains no interpolated user input beyond escaped labels.
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {scatter ? (
        <div className="mt-4" data-testid="run-accuracy-scatter">
          <div
            className="overflow-x-auto rounded-[12px] border border-border/60"
            dangerouslySetInnerHTML={{ __html: scatter }}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Points above the line are roads the model gives more traffic than the count recorded;
            below it, less. The dashed lines are twice and half the observed volume. Red points are
            outside that band.
          </p>
          {worst.length ? (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-muted-foreground">
                The {worst.length} least-matched stations
              </summary>
              <ul className="mt-1 space-y-0.5">
                {worst.map((row) => (
                  <li key={row.label} className="text-muted-foreground">
                    <span className="text-foreground">{row.label}</span>: observed{" "}
                    {Math.round(row.observed).toLocaleString()}, modelled{" "}
                    {Math.round(row.modelled).toLocaleString()} ({row.ratio.toFixed(2)}×)
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <table className="mt-3 w-full text-xs">
        <thead>
          <tr className="text-left text-muted-foreground">
            <th className="py-1 font-medium">Road type</th>
            <th className="py-1 text-right font-medium">Stations</th>
            <th className="py-1 text-right font-medium">Median error</th>
            <th className="py-1 text-right font-medium">Model ÷ observed</th>
          </tr>
        </thead>
        <tbody>
          {ordered.map((row) => (
            <tr key={row.roadClass} className="border-t border-border/40">
              <td className="py-1 text-foreground">{row.roadClass}</td>
              <td className="py-1 text-right tabular-nums">{row.stations}</td>
              <td className="py-1 text-right tabular-nums">{row.medianAbsolutePercentError.toFixed(1)}%</td>
              <td className="py-1 text-right tabular-nums">
                {row.medianModelOverObserved === null || row.medianModelOverObserved === undefined
                  ? "—"
                  : row.medianModelOverObserved.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">
        A road type with only a handful of stations is shown faded. Its figure is not evidence about
        that road type however good it looks — a 1% error over one station is one station.
      </p>
    </div>
  );
}

function RunProgressBar({ stages }: { stages: ModelRunStage[] }) {
  const progress = useMemo(() => summarizeRunProgress(stages), [stages]);
  const running = useMemo(
    () => stages.find((stage) => (stage.status ?? "").toLowerCase() === "running") ?? null,
    [stages]
  );
  // `now` is state rather than a Date.now() call during render: reading the
  // clock while rendering is impure, and on a run that lasts a day the elapsed
  // figure has to advance on its own rather than only when the poll happens to
  // return changed data.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [running]);

  const elapsed = describeElapsed(running?.started_at ?? null, now);
  const convergence = latestConvergence(running?.log_tail ?? null);

  if (progress.percent === null) return null;

  return (
    <div className="mb-4" data-testid="run-progress">
      <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium text-foreground">{progress.label}</span>
        <span className="tabular-nums text-muted-foreground" data-testid="run-progress-percent">
          {progress.percent}%
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={progress.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Model run progress by stage"
      >
        <div
          className="h-full rounded-full bg-foreground/70 transition-[width] duration-500"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      {elapsed || convergence ? (
        <p className="mt-1 text-[11px] text-muted-foreground" data-testid="run-progress-detail">
          {elapsed ? `${elapsed} in this stage` : null}
          {elapsed && convergence ? " · " : null}
          {convergence
            ? `convergence gap ${convergence.gap.toPrecision(3)}, aiming for ${convergence.target.toPrecision(3)}`
            : null}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The stage's console output, which follows new lines as the worker writes them.
 *
 * FOLLOWING STOPS WHEN THE READER SCROLLS UP, and says so. During a long
 * assignment the worker appends a progress line every few seconds; a box that
 * always jumped to the bottom would yank the text away from someone who had
 * scrolled back to read an earlier warning — and one that never scrolled would
 * leave the newest line permanently out of sight. So it follows while the
 * reader is at the bottom, releases when they leave it, and resumes when they
 * come back.
 */
function StageLogView({ log, isRunning }: { log: string; isRunning: boolean }) {
  const boxRef = useRef<HTMLPreElement | null>(null);
  const [isFollowing, setIsFollowing] = useState(true);

  // "At the bottom" needs slack: a fractional scroll height means an exact
  // comparison is false on a box the reader has scrolled fully down.
  const AT_BOTTOM_SLACK_PX = 16;

  const handleScroll = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const distanceFromBottom = box.scrollHeight - box.scrollTop - box.clientHeight;
    setIsFollowing(distanceFromBottom <= AT_BOTTOM_SLACK_PX);
  }, []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !isFollowing) return;
    box.scrollTop = box.scrollHeight;
  }, [log, isFollowing]);

  return (
    <div>
      <pre
        ref={boxRef}
        onScroll={handleScroll}
        data-testid="stage-log-output"
        data-following={isFollowing ? "true" : "false"}
        className={`${isRunning ? "max-h-64" : "max-h-32"} overflow-auto rounded-[12px] bg-zinc-950/90 p-2 text-[11px] leading-5 text-zinc-100`}
      >
        {log}
      </pre>
      {isRunning && !isFollowing ? (
        <p className="mt-1 text-[11px] text-muted-foreground" data-testid="stage-log-paused">
          Paused following — scroll to the bottom to keep up with new output.
        </p>
      ) : null}
    </div>
  );
}

function ModelRunStagingAndArtifacts({
  modelId,
  run,
  stages,
  artifacts,
  comparisonCandidates,
}: {
  modelId: string;
  run: ManagedModelRun;
  stages: ModelRunStage[];
  artifacts: ModelRunArtifact[];
  comparisonCandidates: ModelRunComparisonCandidate[];
}) {
  if (
    !stages?.length &&
    !artifacts?.length &&
    run.status !== "succeeded" &&
    !["aequilibrae", "behavioral_demand"].includes(run.engine_key)
  ) {
    return null;
  }

  const assessmentArtifact = artifacts.find((artifact) => artifact.artifact_type === "model_validation_assessment");
  const diagnosisArtifact = artifacts.find(
    (artifact) => artifact.artifact_type === "model_validation_structural_diagnosis",
  );
  const structuralInputAuditArtifact = artifacts.find(
    (artifact) => artifact.artifact_type === "model_structural_input_audit_v1",
  );
  const structuralDemandDiagnosisArtifact = artifacts.find(
    (artifact) => artifact.artifact_type === "model_validation_structural_diagnosis_v3",
  );
  const assessment = assessmentArtifact?.metadata_json ?? null;
  const diagnosis = diagnosisArtifact?.metadata_json ?? null;
  const scientificOutcome =
    typeof assessment?.scientific_outcome === "string" ? assessment.scientific_outcome : null;
  const assessmentReasons = Array.isArray(assessment?.reasons)
    ? assessment.reasons.filter((reason): reason is string => typeof reason === "string")
    : [];
  const coverage =
    assessment?.coverage && typeof assessment.coverage === "object" && !Array.isArray(assessment.coverage)
      ? (assessment.coverage as Record<string, unknown>)
      : null;
  const exactInputs =
    assessment?.exact_inputs && typeof assessment.exact_inputs === "object" && !Array.isArray(assessment.exact_inputs)
      ? (assessment.exact_inputs as Record<string, unknown>)
      : null;
  const networkStateHashes =
    exactInputs?.network_state_hashes &&
    typeof exactInputs.network_state_hashes === "object" &&
    !Array.isArray(exactInputs.network_state_hashes)
      ? (exactInputs.network_state_hashes as Record<string, unknown>)
      : null;
  const evidenceWriteFailed = run.claimDecision?.reason?.toLowerCase().includes("validation evidence write failed") ?? false;
  const diagnosisFindings = Array.isArray(diagnosis?.findings)
    ? diagnosis.findings.flatMap((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return [];
        const finding = value as Record<string, unknown>;
        if (typeof finding.statement !== "string" || !finding.statement.trim()) return [];
        return [{
          category: typeof finding.category === "string" ? finding.category : "finding",
          statement: finding.statement,
          count: typeof finding.count === "number" && Number.isFinite(finding.count) ? finding.count : null,
        }];
      })
    : [];
  const diagnosisUnknownFacts = Array.isArray(diagnosis?.unknown_facts)
    ? diagnosis.unknown_facts.filter((value): value is string => typeof value === "string")
    : [];

  return (
    <div className="mt-4 min-w-0 max-w-full border-t pt-4">
      {assessment ? (
        <section
          aria-label="Scientific model validation assessment"
          className="mb-4 min-w-0 max-w-full rounded-[0.75rem] border border-border/70 bg-background/80 p-4"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Rules v{String(assessment.rules_version ?? "unknown")} · scientific validation
              </p>
              <h4 className="mt-1 font-semibold text-foreground">Observed-count comparability assessment</h4>
            </div>
            <StatusBadge
              tone={scientificOutcome === "pass" ? "success" : scientificOutcome === "fail" ? "danger" : "warning"}
            >
              {scientificOutcome ?? "inconclusive"}
            </StatusBadge>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            {scientificOutcome === "pass"
              ? "The decisive observations were comparable to this exact model output under the frozen rule."
              : scientificOutcome === "fail"
                ? "Comparable decisive observations did not meet the exact frozen rule. The negative result is retained."
                : "OpenPlan could not establish that the observations and model output represent the same quantity. No validation claim is allowed."}
          </p>
          {assessmentReasons.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {assessmentReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          ) : null}
          <dl className="mt-4 grid min-w-0 grid-cols-1 gap-3 text-xs">
            <div>
              <dt className="font-semibold text-foreground">Planning use</dt>
              <dd className="mt-1 break-words text-muted-foreground">{String(assessment.planning_use ?? "unknown")}</dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">Partition</dt>
              <dd className="mt-1 break-words text-muted-foreground">
                {typeof assessment.partition === "string" ? assessment.partition : JSON.stringify(assessment.partition ?? "unknown")}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">Coverage</dt>
              <dd className="mt-1 break-words text-muted-foreground">
                {coverage
                  ? Object.entries(coverage).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")
                  : "unknown"}
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-foreground">Exact hashes</dt>
              <dd className="mt-1 break-all text-muted-foreground">
                Basis {String(exactInputs?.comparison_basis_sha256 ?? "unknown").slice(0, 12)}… · model {String(exactInputs?.model_output_sha256 ?? "unknown").slice(0, 12)}…
                {networkStateHashes ? (
                  <>
                    {" · network "}{String(networkStateHashes.network ?? "unknown").slice(0, 12)}…
                    {" · observations "}{String(networkStateHashes.observation_package ?? "unknown").slice(0, 12)}…
                    {" · pre-volume audit "}{String(networkStateHashes.pre_volume_match_audit ?? "unknown").slice(0, 12)}…
                  </>
                ) : null}
              </dd>
            </div>
          </dl>
          {run.engine_key === "behavioral_demand" ? (
            <p className="mt-3 text-xs text-muted-foreground">
              AequilibraE assignment and ActivitySim behavioral-demand evidence remain separate; neither method is averaged into the other.
            </p>
          ) : null}
          {scientificOutcome === "inconclusive" && diagnosisArtifact && diagnosis ? (
            <section
              aria-label="Why this model validation is inconclusive"
              className="mt-4 rounded-[0.5rem] border border-amber-300/60 bg-amber-50/70 p-3 text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
              data-testid="model-validation-structural-diagnosis"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h5 className="font-semibold">Why this is inconclusive</h5>
                  <p className="mt-1 text-xs">
                    This diagnosis explains the frozen evidence. It does not repair matches, average methods,
                    calibrate a model, or change the scientific outcome.
                  </p>
                </div>
                <StatusBadge tone="warning">diagnosis only</StatusBadge>
              </div>
              {diagnosisFindings.length > 0 ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs">
                  {diagnosisFindings.map((finding, index) => (
                    <li key={`${finding.category}-${finding.statement}-${index}`}>
                      {finding.count === null ? "" : `${finding.count.toLocaleString()} · `}
                      {finding.statement}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs">The exact diagnosis is available for review below.</p>
              )}
              {diagnosisUnknownFacts.length > 0 ? (
                <p className="mt-3 text-xs">
                  Evidence ledger still unknown: {diagnosisUnknownFacts.join(", ")}.
                </p>
              ) : null}
              <p className="mt-3 break-all font-mono text-[11px]" data-testid="diagnosis-sha256">
                SHA-256 {diagnosisArtifact.content_hash ?? String(diagnosis.diagnosis_sha256 ?? "unknown")}
              </p>
              <a
                href={`/api/models/${modelId}/runs/${run.id}/artifacts/${diagnosisArtifact.id}/download`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 inline-flex text-xs font-semibold underline hover:text-foreground"
              >
                Download exact structural diagnosis
              </a>
            </section>
          ) : null}
        </section>
      ) : evidenceWriteFailed ? (
        <section aria-label="Scientific model validation assessment" className="mb-4 rounded-[0.75rem] border border-destructive/40 bg-destructive/5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h4 className="font-semibold text-foreground">Validation evidence write failed</h4>
            <StatusBadge tone="danger">scientifically unchecked</StatusBadge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            The computation may still be available, but its source material and result were not placed in immutable custody. It cannot support a validation claim.
          </p>
        </section>
      ) : null}
      {structuralInputAuditArtifact && structuralDemandDiagnosisArtifact ? (
        <section aria-label="Structural demand and loading diagnosis" className="mb-4 rounded-[0.75rem] border border-amber-300/60 bg-amber-50/70 p-4 dark:border-amber-900/60 dark:bg-amber-950/20" data-testid="model-structural-demand-diagnosis">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="font-semibold text-foreground">Structural demand and loading diagnosis</h4>
              <p className="mt-1 text-sm text-muted-foreground">Structural coverage and diagnosed limitations only. This does not show improved accuracy. AequilibraE and ActivitySim remain separate.</p>
            </div>
            <StatusBadge tone="warning">inconclusive</StatusBadge>
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
            <a href={`/api/models/${modelId}/runs/${run.id}/artifacts/${structuralInputAuditArtifact.id}/download`} target="_blank" rel="noopener noreferrer" className="underline">Download exact before-output check</a>
            <a href={`/api/models/${modelId}/runs/${run.id}/artifacts/${structuralDemandDiagnosisArtifact.id}/download`} target="_blank" rel="noopener noreferrer" className="underline">Download exact v3 diagnosis</a>
          </div>
        </section>
      ) : structuralInputAuditArtifact || structuralDemandDiagnosisArtifact ? (
        <section aria-label="Structural demand custody failure" className="mb-4 rounded-[0.75rem] border border-destructive/40 bg-destructive/5 p-4">
          <StatusBadge tone="danger">scientifically unchecked</StatusBadge>
          <p className="mt-2 text-sm text-muted-foreground">The before-output check and diagnosis did not enter immutable custody together. This run cannot support a structural diagnosis claim.</p>
        </section>
      ) : null}
      {stages?.length > 0 ? <RunProgressBar stages={stages} /> : null}
      {(stages?.length > 0 || artifacts?.length > 0) ? (
        <div className="grid min-w-0 grid-cols-1 gap-4 text-sm">
          {stages?.length > 0 && (
            <div>
              <h4 className="mb-2 font-semibold">Execution stages</h4>
              <ul className="space-y-2">
                {stages.map((stage) => (
                  <li key={stage.id} className="rounded-[0.5rem] border border-border/60 bg-background/80 px-3 py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{stage.stage_name}</p>
                        <p className="text-xs text-muted-foreground">{formatDurationSeconds((() => {
                          if (!stage.started_at || !stage.completed_at) return null;
                          const started = new Date(stage.started_at).getTime();
                          const completed = new Date(stage.completed_at).getTime();
                          return Number.isFinite(started) && Number.isFinite(completed) ? Math.max(0, Math.round((completed - started) / 1000)) : null;
                        })()) ?? "Duration unavailable"}</p>
                      </div>
                      <StatusBadge tone={toneForRunStatus(stage.status)}>{stage.status}</StatusBadge>
                    </div>
                    {stage.error_message ? <p className="mt-2 text-xs text-red-600 dark:text-red-300">{stage.error_message}</p> : null}
                    {/*
                      A FAILED STAGE MUST NOT SHOW A LOG SAYING IT IS STARTING.
                      The worker stamps `log_tail` with "Starting <stage>..." on
                      claim and never clears it on failure, so an early failure —
                      no study area, no Census key, study area too large, the
                      failures a planner can actually fix — rendered that line in
                      a console box directly under the red error.
                      `stageLogForDisplay` drops the placeholder and labels a
                      genuine partial log as reaching only the point of failure.
                    */}
                    {(() => {
                      const shown = stageLogForDisplay(stage);
                      if (!shown) return null;
                      return (
                        <div className="mt-2" data-testid="stage-log">
                          {shown.isPartial ? (
                            <p className="mb-1 text-[11px] text-muted-foreground">
                              Log up to the point of failure — the stage did not finish, so it stops
                              here rather than at the end.
                            </p>
                          ) : null}
                          <StageLogView log={shown.log} isRunning={stage.status === "running"} />
                        </div>
                      );
                    })()}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {artifacts?.length > 0 && (
            <div>
              <h4 className="mb-2 font-semibold">Run artifacts</h4>
              <ul className="space-y-2">
                {artifacts.map((art) => (
                  <li key={art.id} className="flex items-center justify-between gap-3 rounded-[0.5rem] border border-border/60 bg-background/80 px-3 py-2.5 text-muted-foreground">
                    <div>
                      <p className="font-medium text-foreground">{labelForArtifactType(art.artifact_type)}</p>
                      {formatFileSize(art.file_size_bytes) ? <p className="text-xs">{formatFileSize(art.file_size_bytes)}</p> : null}
                    </div>
                    <a
                      href={`/api/models/${modelId}/runs/${run.id}/artifacts/${art.id}/download`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-foreground"
                    >
                      View / Download
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : null}

      {/* THE ANSWER FIRST, ABOVE THE APPARATUS. A tester ran a corridor
          analysis to completion and the finished run never stated the traffic
          or the driving they ran it for — those KPIs existed but only rendered
          inside the ITE screen (one engine) and the CEQA screen (a different
          question). This panel gives the plain answer a home; it prints nothing
          the run did not measure. */}
      {run.status === "succeeded" ? (
        <ModelRunHeadlineAnswer modelId={modelId} modelRunId={run.id} />
      ) : null}

      {run.claimDecision?.roadClassAccuracy?.length ? (
        <RunAccuracyByClass
          rows={run.claimDecision.roadClassAccuracy}
          stations={run.claimDecision.stationComparisons ?? []}
        />
      ) : null}

      {(run.status === "succeeded" || run.engine_key === "aequilibrae") ? (
        <ModelRunEvidencePanel
          modelId={modelId}
          modelRunId={run.id}
          runTitle={run.run_title}
          runStatus={run.status}
          engineKey={run.engine_key}
          comparisonCandidates={comparisonCandidates}
          claimStatus={run.claimDecision?.status ?? null}
          claimStatusReason={run.claimDecision?.reason ?? null}
        />
      ) : null}

      {/* Mounting is a courtesy filter; the panel re-checks eligibility itself
          (and the save route enforces it again server-side), so this condition
          drifting can hide the screen but can never show a determination from
          an ineligible run. */}
      {resolveVmtDeterminationRunEligibility({ status: run.status, engineKey: run.engine_key }).ok ? (
        <ModelRunCeqaVmtScreen
          modelId={modelId}
          modelRunId={run.id}
          runTitle={run.run_title}
          runStatus={run.status}
          engineKey={run.engine_key}
        />
      ) : null}

      {run.status === "succeeded" && run.engine_key === "ite_trip_generation" ? (
        <ModelRunTripGenScreen modelId={modelId} modelRunId={run.id} runTitle={run.run_title} />
      ) : null}

      {/*
        Both engines that measure it. The sketch engine counts it from its trip
        table; the AequilibraE worker counts the OD matrix diagonal — the same
        measurement, under the same KPI name, so a planner comparing two runs
        never meets two names for one thing.
        AequilibraE matters most here: it is the engine whose link volumes people
        actually compare to traffic counts, which is the comparison this
        diagnostic exists to qualify. The panel renders nothing when the KPI is
        absent, so an older run is unaffected.
      */}
      {run.status === "succeeded" &&
      (run.engine_key === "sketch_abm" || run.engine_key === "aequilibrae") ? (
        <ModelRunZoneResolutionPanel modelId={modelId} modelRunId={run.id} />
      ) : null}

      {run.status === "succeeded" && run.engine_key === "aequilibrae" ? (
        <ModelRunEmissionsPanel modelId={modelId} modelRunId={run.id} />
      ) : null}

      {run.status === "succeeded" && run.engine_key === "aequilibrae" ? (
        <ModelRunEquityPanel modelId={modelId} modelRunId={run.id} />
      ) : null}

      {run.status === "succeeded" && run.engine_key === "aequilibrae" ? (
        <ModelRunEngagementPanel modelId={modelId} modelRunId={run.id} />
      ) : null}
    </div>
  );
}
