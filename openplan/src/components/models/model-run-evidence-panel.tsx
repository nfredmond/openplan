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
import { formatModelingClaimStatusLabel } from "@/lib/reports/modeling-evidence";
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

type ModelRunComparisonCandidate = {
  id: string;
  runTitle: string;
  completedAt: string | null;
  scenarioLabel: string | null;
};

function claimStatusTone(status: ModelingClaimStatus): StatusTone {
  if (status === "calibrated_to_counts" || status === "claim_grade_passed") return "success";
  if (status === "screening_grade") return "warning";
  return "neutral";
}

/** First-class transit-status label so a 0 transit share is never read as "no
 * transit demand" — the honest distinction between "modeled" and a feed
 * limitation. */
function transitStatusDisplay(status: EvidenceTransitStatus | null): { label: string; tone: StatusTone } | null {
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
};

export function ModelRunEvidencePanel({
  modelId,
  modelRunId,
  runTitle,
  runStatus,
  engineKey,
  comparisonCandidates,
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
  const [comparisonRows, setComparisonRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [behavioralComparison, setBehavioralComparison] = useState<BehavioralDemandComparison | null>(null);

  const canInspect = runStatus === "succeeded";
  const canRelaunch = engineKey === "aequilibrae" && runStatus !== "running" && runStatus !== "succeeded";
  const packetHref = `/api/models/${modelId}/runs/${modelRunId}/evidence-packet`;
  const runMode = useMemo(() => getManagedRunModeDefinition(engineKey), [engineKey]);

  const highlights = useMemo(() => (evidence ? buildEvidenceHighlights(evidence) : []), [evidence]);
  const categories = useMemo(() => (evidence ? summarizeEvidenceCategories(evidence) : []), [evidence]);
  const transitStatus = useMemo(() => (evidence ? evidenceTransitStatus(evidence) : null), [evidence]);
  // Honest run posture, derived from the engine's availability tier — never
  // claims calibrated/claim-grade here (those stay the county-lane spine's job).
  const claimStatus: ModelingClaimStatus =
    runMode.availability === "launchable" ? "screening_grade" : "prototype_only";
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
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load KPI comparison");
      }

      setComparisonRows(payload.comparison ?? []);
      setBehavioralComparison(payload.behavioral_comparison ?? null);
    } catch (comparisonLoadError) {
      setComparisonRows(null);
      setBehavioralComparison(null);
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
    setIsRelaunching(true);
    try {
      const response = await fetch(`/api/models/${modelId}/runs/${modelRunId}/launch`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to relaunch worker run");
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
                    {formatModelingClaimStatusLabel(claimStatus)}
                  </StatusBadge>
                  {claimStatus === "screening_grade" ? (
                    <StatusBadge tone="neutral">Uncalibrated by default</StatusBadge>
                  ) : null}
                  {transitStatusDisplay(transitStatus) ? (
                    <StatusBadge tone={transitStatusDisplay(transitStatus)!.tone}>
                      {transitStatusDisplay(transitStatus)!.label}
                    </StatusBadge>
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
                      {comparisonSummary ? (
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
