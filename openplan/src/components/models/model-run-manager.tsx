"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Map as MapIcon, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import dynamic from "next/dynamic";

const TrafficVolumeMap = dynamic(
  () => import("@/components/models/traffic-volume-map").then((m) => m.TrafficVolumeMap),
  { ssr: false, loading: () => <div className="h-[520px] w-full animate-pulse rounded-2xl bg-zinc-800/50" /> }
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
};

type ModelRunManagerProps = {
  modelId: string;
  modelTitle: string;
  defaultQueryText: string;
  defaultCorridorText: string;
  scenarioEntries: ScenarioEntryOption[];
  modelRuns: ManagedModelRun[];
  schemaPending: boolean;
};

function fmtDateTime(value: string | null | undefined) {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
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
    <div className="mt-3 rounded-2xl border border-border/70 bg-background/70 p-3">
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
  scenarioEntries,
  modelRuns,
  schemaPending,
}: ModelRunManagerProps) {
  const router = useRouter();
  const [title, setTitle] = useState(`${modelTitle} managed run`);
  const [queryText, setQueryText] = useState(defaultQueryText);
  const [corridorText, setCorridorText] = useState(defaultCorridorText);
  const [scenarioEntryId, setScenarioEntryId] = useState("");
  const [attachToScenarioEntry, setAttachToScenarioEntry] = useState(true);
  const [engineKey, setEngineKey] = useState("deterministic_corridor_v1");
  const [isLaunching, setIsLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedScenarioEntry = useMemo(
    () => scenarioEntries.find((entry) => entry.id === scenarioEntryId) ?? null,
    [scenarioEntries, scenarioEntryId]
  );

  async function handleLaunch() {
    setError(null);
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
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to launch managed model run");
      }

      router.refresh();
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : "Failed to launch managed model run");
    } finally {
      setIsLaunching(false);
    }
  }

  const latestRun = modelRuns[0] ?? null;

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
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/12 text-sky-700 dark:text-sky-300">
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
          <p className="module-summary-label">Engines available</p>
          <p className="module-summary-value text-base">2</p>
          <p className="module-summary-detail">Deterministic Corridor (sync) · AequilibraE (async worker)</p>
        </div>
      </div>

      {schemaPending ? (
        <div className="module-empty-state mt-5 text-sm">
          The `model_runs` table is not live yet. Apply the newest database migration to activate managed execution.
        </div>
      ) : null}

      <div className="mt-5 grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
        <div className="rounded-[24px] border border-border/70 bg-background/75 p-5 space-y-4">
          <div>
            <p className="text-sm font-semibold text-foreground">Launch run</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Use model defaults, then optionally bind the result back into a specific scenario entry.
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="managed-run-engine" className="text-[0.82rem] font-semibold">
              Execution Engine
            </label>
            <select
              id="managed-run-engine"
              className="module-select"
              value={engineKey}
              onChange={(event) => setEngineKey(event.target.value)}
            >
              <option value="deterministic_corridor_v1">Deterministic Corridor (Synchronous)</option>
              <option value="aequilibrae">AequilibraE (Asynchronous Worker Prototype)</option>
            </select>
          </div>

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
            <label htmlFor="managed-run-corridor" className="text-[0.82rem] font-semibold">
              Corridor GeoJSON
            </label>
            <Textarea
              id="managed-run-corridor"
              value={corridorText}
              onChange={(event) => setCorridorText(event.target.value)}
              rows={10}
              placeholder='{"type":"Polygon","coordinates":[...]}'
              className="font-mono text-xs"
            />
          </div>

          {error ? (
            <p className="rounded-2xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </p>
          ) : null}

          <Button type="button" onClick={() => void handleLaunch()} disabled={isLaunching || schemaPending}>
            {isLaunching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Launch managed run
          </Button>
        </div>

        <div className="rounded-[24px] border border-border/70 bg-background/75 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Run history</p>
              <p className="mt-1 text-sm text-muted-foreground">Latest orchestrated executions tied to this model.</p>
            </div>
            <StatusBadge tone={modelRuns.length > 0 ? "info" : "neutral"}>{modelRuns.length} stored</StatusBadge>
          </div>

          {/* Show map for the latest succeeded AequilibraE run */}
          {modelRuns.some((r) => r.status === "succeeded" && r.engine_key === "aequilibrae") && (
            <div className="mt-4">
              <TrafficVolumeMap
                modelRunId={modelRuns.find((r) => r.status === "succeeded" && r.engine_key === "aequilibrae")!.id}
              />
            </div>
          )}

          {modelRuns.some((r) => r.status === "queued" || r.status === "running") ? (
            <div className="mt-3 flex items-center gap-2 rounded-2xl border border-sky-200/80 bg-sky-50/60 px-4 py-2.5 text-sm text-sky-800 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200">
              <Loader2 className="h-4 w-4 animate-spin flex-shrink-0" />
              <span>One or more runs are in progress. Refresh the page to check for updates.</span>
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

                return (
                  <div key={run.id} className="module-record-row">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={toneForRunStatus(run.status)}>{run.status}</StatusBadge>
                        <StatusBadge tone="neutral">{run.engine_key === "aequilibrae" ? "AequilibraE" : "Deterministic"}</StatusBadge>
                        {scenarioLabel ? <StatusBadge tone="neutral">{scenarioLabel}</StatusBadge> : null}
                        {overallScore !== null ? <StatusBadge tone="success">Overall {overallScore}/100</StatusBadge> : null}
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
                      <ModelRunStagingAndArtifacts stages={run.stages} artifacts={run.artifacts} />
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

function ModelRunStagingAndArtifacts({ stages, artifacts }: { stages: ModelRunStage[]; artifacts: ModelRunArtifact[] }) {
  if (!stages?.length && !artifacts?.length) return null;

  return (
    <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm border-t pt-4">
      {stages?.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2">Execution Stages</h4>
          <ul className="space-y-2">
            {stages.map((stage) => (
              <li key={stage.id} className="flex items-center justify-between">
                <span className="capitalize">{stage.stage_name}</span>
                <StatusBadge tone={toneForRunStatus(stage.status)}>{stage.status}</StatusBadge>
              </li>
            ))}
          </ul>
        </div>
      )}
      {artifacts?.length > 0 && (
        <div>
          <h4 className="font-semibold mb-2">Run Artifacts</h4>
          <ul className="space-y-2">
            {artifacts.map((art) => (
              <li key={art.id} className="flex items-center justify-between text-muted-foreground">
                <span>{art.artifact_type}</span>
                <a href={art.file_url} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                  View / Download
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
