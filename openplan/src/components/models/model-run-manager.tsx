"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Loader2, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import dynamic from "next/dynamic";
import { ModelRunEvidencePanel } from "@/components/models/model-run-evidence-panel";
import { ModelRunCeqaVmtScreen } from "@/components/models/model-run-ceqa-vmt-screen";
import { ModelRunTripGenScreen } from "@/components/models/model-run-trip-gen-screen";
import { ModelRunEmissionsPanel } from "@/components/models/model-run-emissions-panel";
import { ModelRunEquityPanel } from "@/components/models/model-run-equity-panel";
import { ModelRunEngagementPanel } from "@/components/models/model-run-engagement-panel";
import { StudyAreaPicker } from "@/components/models/study-area-picker";
import { formatDurationSeconds, formatFileSize, labelForArtifactType, labelForEngineKey } from "@/lib/models/evidence-packet";
import { MANAGED_RUN_MODE_DEFINITIONS, getManagedRunModeDefinition, type ManagedRunModeKey } from "@/lib/models/run-modes";
import {
  IN_PROCESS_ENGINE_KEYS,
  assessWorkerLaunchReadiness,
  describeWorkerAbsenceEvidence,
  isWorkerBackedEngineKey,
} from "@/lib/models/worker-backed-launch";
import type { ModelingClaimStatus } from "@/lib/models/evidence-backbone";

const TrafficVolumeMap = dynamic(
  () => import("@/components/models/traffic-volume-map").then((m) => m.TrafficVolumeMap),
  { ssr: false, loading: () => <div className="h-[520px] w-full animate-pulse rounded-[0.5rem] bg-zinc-800/50" /> }
);

type ScenarioEntryOption = {
  id: string;
  label: string;
  entryType: string;
  status: string;
  assumptionCount: number;
};

export type ModelRunStage = {
  id: string;
  stage_name: string;
  status: string;
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
  started_at: string | null;
  completed_at: string | null;
  created_at: string | null;
  stages: ModelRunStage[];
  artifacts: ModelRunArtifact[];
  /** Real claim tier for this run (from modeling_claim_decisions), resolved
   * server-side in the model page. Null → the panel derives from availability. */
  claimStatus?: ModelingClaimStatus | null;
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
        throw new Error(payload.error || "Failed to promote managed run");
      }

      router.refresh();
    } catch (promotionError) {
      setError(promotionError instanceof Error ? promotionError.message : "Failed to promote managed run");
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
              : "This succeeded run is not attached to a scenario entry yet. Promote it into one now."}
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
}: ModelRunManagerProps) {
  const router = useRouter();
  const [title, setTitle] = useState(`${modelTitle} managed run`);
  // Non-ITE engines require BOTH a study area AND non-empty query text, so a
  // brand-new model (empty template) must not default the query box to "" —
  // that produced a launch 400 that read like a study-area error. Prefill a
  // sensible screening label; the operator can edit it.
  const [queryText, setQueryText] = useState(defaultQueryText || `Screening run — ${modelTitle}`);
  const [corridorText, setCorridorText] = useState(defaultCorridorText);
  const [scenarioEntryId, setScenarioEntryId] = useState("");
  const [attachToScenarioEntry, setAttachToScenarioEntry] = useState(true);
  const [engineKey, setEngineKey] = useState<ManagedRunModeKey>("deterministic_corridor_v1");
  const [zoneGeography, setZoneGeography] = useState<"tract" | "block_group">("tract");
  // Per-run count-calibration opt-in (aequilibrae / behavioral_demand). Default
  // off — OpenPlan ships an uncalibrated screening model.
  const [calibrate, setCalibrate] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Non-silent handoff notice — e.g. a large sketch study area rerouted to the
  // async AequilibraE worker. Surfaced immediately so the operator knows why a
  // "fast" run is now queued on the worker. `queuedOnWorker` records that the
  // run left this app's process, because that changes what the notice means:
  // it is now waiting on infrastructure the app cannot see.
  const [launchNotice, setLaunchNotice] = useState<{ message: string; queuedOnWorker: boolean } | null>(null);
  // Set only by the planner, and only from the refusal below. The app cannot
  // observe a worker being started — it can only be told — so the person who
  // did it is the one who clears the refusal.
  const [workerStartedSinceThoseRuns, setWorkerStartedSinceThoseRuns] = useState(false);

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

  async function handleLaunch() {
    setError(null);
    setLaunchNotice(null);
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
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        notice?: string;
        reroutedFrom?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to launch managed model run");
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
   */
  const workerReadiness = useMemo(
    () => assessWorkerLaunchReadiness(modelRuns, now > 0 ? now : null),
    [modelRuns, now]
  );
  const workerAbsenceEvidence = describeWorkerAbsenceEvidence(workerReadiness);
  const workerRefusesLaunch = engineNeedsWorker && workerAbsenceEvidence !== null;
  // "preflight" is launchable (it runs an honest input-validation / runtime-staging
  // preflight); only "prototype" keeps the launch button disabled outright. The
  // worker refusal is the other block, and unlike a prototype it is clearable by
  // the one person who can know the thing this app cannot observe.
  const launchDisabled =
    isLaunching ||
    schemaPending ||
    selectedRunMode.availability === "prototype" ||
    (workerRefusesLaunch && !workerStartedSinceThoseRuns);

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Execution</p>
          <h2 className="module-section-title">Managed scenario → run execution</h2>
          <p className="module-section-description">
            Launch a managed run with immutable input snapshots, then promote or reassign the resulting analysis run into the right scenario entry.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.5rem] bg-sky-500/12 text-sky-700 dark:text-sky-300">
          <Play className="h-5 w-5" />
        </span>
      </div>

        <div className="module-summary-grid cols-4 mt-5">
        <div className="module-summary-card">
          <p className="module-summary-label">Managed runs</p>
          <p className="module-summary-value">{modelRuns.length}</p>
          <p className="module-summary-detail">Execution records tied to this model.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Latest status</p>
          <p className="module-summary-value text-base">{latestRun ? latestRun.status : "None"}</p>
          <p className="module-summary-detail">{latestRun ? latestRun.run_title : "No managed runs launched yet."}</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Scenario attach</p>
          <p className="module-summary-value">{scenarioEntries.length}</p>
          <p className="module-summary-detail">Scenario entries available for direct evidence promotion.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Run modes available</p>
          <p className="module-summary-value text-base">{MANAGED_RUN_MODE_DEFINITIONS.length}</p>
          <p className="module-summary-detail">{MANAGED_RUN_MODE_DEFINITIONS.map((mode) => mode.shortLabel).join(" · ")}</p>
        </div>
      </div>

      {schemaPending ? (
        <div className="module-empty-state mt-5 text-sm">
          The `model_runs` table is not live yet. Apply the newest database migration to activate managed execution.
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
        <div className="rounded-[0.5rem] border border-border/70 bg-background/75 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Launch run</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Use model defaults, then optionally bind the result back into a specific scenario entry.
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
                      ? "Preflight"
                      : "Prototype surface"}
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
                  this deployment has to be running for it to finish.
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
                  <span className="text-foreground">Where it runs:</span> in-process for study areas
                  within the sketch lane&apos;s zone cap. A larger area — a mid-size city or a metro —
                  is handed to the AequilibraE worker queue instead, so it depends on a processing
                  worker the same way Fast Screening does. The launch tells you when that happens.
                </p>
              ) : null}
              {engineKey === "ite_trip_generation" ? (
                <p className="mt-2 text-muted-foreground">
                  <span className="text-foreground">Input:</span> this engine ignores query text and
                  corridor GeoJSON. It reads a land-use program from the selected scenario
                  entry&apos;s assumptions JSON (<code>tripGenProgram</code>); launching without one
                  fails with a clear error.
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
                  Attempt count calibration (where local observed counts exist) — produces the
                  disclosed <span className="font-semibold">calibrated_to_counts</span> tier; leaves
                  the CEQA VMT input unchanged.
                </span>
              </label>
              <p className="text-xs text-muted-foreground">
                When observed traffic counts are available for the study area, the assignment is
                tuned toward them and reports held-out (out-of-sample) accuracy. Where no counts
                match, the run stays screening-grade. Calibrated VMT publishes under distinct KPI
                names — it never becomes the CEQA §15064.3 determination input.
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
              <option value="">No direct scenario attach</option>
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
              placeholder="Describe what this managed run is analyzing."
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
                launchNotice.queuedOnWorker && workerAbsenceEvidence
                  ? "rounded-[0.5rem] border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200"
                  : "rounded-[0.5rem] border border-sky-300/80 bg-sky-50 px-4 py-3 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200"
              }
            >
              <p>{launchNotice.message}</p>
              {launchNotice.queuedOnWorker ? (
                <p className="mt-2">
                  That queue is served by the AequilibraE worker, not by this app.{" "}
                  {workerAbsenceEvidence
                    ? `${workerAbsenceEvidence} Unless a worker has been started on this deployment since then, this run will sit queued and then be failed rather than finishing.`
                    : "It finishes only while a worker is polling this deployment."}
                </p>
              ) : null}
            </div>
          ) : null}

          {selectedRunMode.availability === "prototype" ? (
            <div className="rounded-[0.5rem] border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              {selectedRunMode.label} is a prototype surface — managed launch from this form is not enabled for it yet. {selectedRunMode.runtimeExpectation} {selectedRunMode.caveatSummary}
            </div>
          ) : selectedRunMode.availability === "preflight" ? (
            <div className="rounded-[0.5rem] border border-amber-300/70 bg-amber-50/80 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200">
              Launching {selectedRunMode.label} runs an input-validation & runtime-staging <span className="font-semibold">preflight</span> — it is <span className="font-semibold">NOT a behavioral forecast</span>. {selectedRunMode.caveatSummary}
            </div>
          ) : null}

          {/* The refusal. It fires BEFORE the enqueue, because after it there is
              nothing left to say that is not either a false success or a
              fifteen-minute-late failure. It names what was observed, names the
              deployment operator as the party who acts — never a plan, a tier
              or an upgrade, none of which exist here — and hands over the lanes
              that do run, so a refusal is never a dead end. */}
          {workerRefusesLaunch ? (
            <div
              data-testid="worker-launch-refusal"
              className="rounded-[0.5rem] border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
            >
              {/* The heading may claim no more than the rows underneath it do.
                  Whether a worker process exists is unobservable from here — the
                  worker polls and has no heartbeat — so the heading states the
                  observation (nothing picked these runs up) rather than the
                  conclusion (there is no worker), which would be the same
                  confidently-wrong answer in the opposite direction. */}
              <p className="font-semibold">
                {selectedRunMode.label} needs a processing worker, and nothing has been picking up
                the worker-backed runs on this model
              </p>
              <p className="mt-2">
                {selectedRunMode.label} does not run inside OpenPlan. Launching it puts stages on a
                queue that a separate AequilibraE worker polls and executes. {workerAbsenceEvidence}{" "}
                That is what an absent worker looks like: this launch would report success, the run
                would sit queued, and it would be failed some minutes later with nothing to show.
              </p>
              <p className="mt-2">
                Nothing about this workspace, this account or this study area is blocking it, and
                there is nothing to buy — OpenPlan is free. Whoever operates this deployment starts
                the worker; the steps are in <code>workers/aequilibrae_worker/DEPLOY.md</code>.
              </p>
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
                One caveat on the sketch lane: it runs in-process only up to its zone cap. A study
                area above that cap is handed to this same worker queue, so a metro-scale sketch run
                depends on the worker too.
              </p>
              <label className="mt-3 flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-border"
                  checked={workerStartedSinceThoseRuns}
                  onChange={(event) => setWorkerStartedSinceThoseRuns(event.target.checked)}
                />
                <span>
                  A modeling worker has been started on this deployment since those runs — queue this
                  one anyway. (The worker is a poller with no heartbeat, so OpenPlan cannot see that
                  for itself; only you can tell it.)
                </span>
              </label>
            </div>
          ) : null}

          <Button type="button" onClick={() => void handleLaunch()} disabled={launchDisabled}>
            {isLaunching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {workerRefusesLaunch && !workerStartedSinceThoseRuns
              ? "Launch refused — nothing has been picking these runs up"
              : selectedRunMode.availability === "launchable"
                ? "Launch managed run"
                : selectedRunMode.availability === "preflight"
                  ? "Launch preflight run"
                  : `${selectedRunMode.label} launch not yet available`}
          </Button>
        </div>

        <div className="rounded-[0.5rem] border border-border/70 bg-background/75 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Run history</p>
              <p className="mt-1 text-sm text-muted-foreground">Latest orchestrated executions tied to this model.</p>
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
              No managed runs yet. The first successful launch will persist an orchestration record and point to the resulting analysis run.
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {modelRuns.map((run) => {
                const resultSummary = run.result_summary_json ?? {};
                const overallScore = typeof resultSummary.overallScore === "number" ? resultSummary.overallScore : null;
                const runLink = run.source_analysis_run_id ? `/explore?runId=${run.source_analysis_run_id}#analysis-run-history` : null;
                const scenarioLabel = findScenarioEntryLabel(scenarioEntries, run.scenario_entry_id);
                const runMode = getManagedRunModeDefinition(run.engine_key);
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
                        {runMode.availability !== "launchable" ? <StatusBadge tone="warning">{runMode.availability === "preflight" ? "Preflight" : "Prototype / preflight"}</StatusBadge> : null}
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <h3 className="module-record-title">{run.run_title}</h3>
                          <p className="module-record-stamp">{fmtDateTime(run.completed_at ?? run.started_at ?? run.created_at)}</p>
                        </div>
                        <p className="module-record-summary">
                          {run.error_message ||
                            (run.source_analysis_run_id
                              ? `Backed by analysis run ${run.source_analysis_run_id}.`
                              : "Managed execution record created without a linked analysis run yet.")}
                        </p>
                        <p className="text-sm text-muted-foreground">{runMode.runtimeExpectation}</p>
                        <p className="text-sm text-muted-foreground">{runMode.caveatSummary}</p>
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

  return (
    <div className="mt-4 border-t pt-4">
      {(stages?.length > 0 || artifacts?.length > 0) ? (
        <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
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
                    {stage.log_tail ? <pre className="mt-2 max-h-32 overflow-auto rounded-[12px] bg-zinc-950/90 p-2 text-[11px] leading-5 text-zinc-100">{stage.log_tail}</pre> : null}
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

      {(run.status === "succeeded" || run.engine_key === "aequilibrae") ? (
        <ModelRunEvidencePanel
          modelId={modelId}
          modelRunId={run.id}
          runTitle={run.run_title}
          runStatus={run.status}
          engineKey={run.engine_key}
          comparisonCandidates={comparisonCandidates}
          claimStatus={run.claimStatus ?? null}
        />
      ) : null}

      {run.status === "succeeded" && run.engine_key === "aequilibrae" ? (
        <ModelRunCeqaVmtScreen modelId={modelId} modelRunId={run.id} runTitle={run.run_title} />
      ) : null}

      {run.status === "succeeded" && run.engine_key === "ite_trip_generation" ? (
        <ModelRunTripGenScreen modelId={modelId} modelRunId={run.id} runTitle={run.run_title} />
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
