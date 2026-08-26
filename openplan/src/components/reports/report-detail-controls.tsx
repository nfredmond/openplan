"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileCog, Loader2, Save, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getManagedRunModeDefinition } from "@/lib/models/run-modes";
import type { ReportArtifactFormat } from "@/lib/reports/client";
import { titleize } from "@/lib/reports/catalog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  describeReportSourceReviewPosture,
  formatDriftLabelList,
  type ReportSourceReviewPosture,
} from "@/lib/reports/source-review-posture";
import type { AgreementCorridorSelection, ReportAgreementEvidence } from "@/lib/reports/dual-demand-agreement";
import type { AerialOrthoCatalog } from "@/lib/aerial/ortho-map-layers";
import type { ReportAerialOrthoSelection } from "@/lib/reports/aerial-ortho-evidence";
import type { ReportSafetyIngestSelection } from "@/lib/reports/safety-evidence-selection";

/** A succeeded worker model run the report may cite as typed evidence. */
export type ReportModelRunOption = {
  id: string;
  title: string;
  engineKey: string;
  status: string;
};

export type ReportSafetyIngestOption = {
  id: string;
  sourceLabel: string;
  createdAt: string;
  crashCount: number;
  geocodedCount: number;
};

function sameSelections(left: AgreementCorridorSelection[], right: AgreementCorridorSelection[]) {
  if (left.length !== right.length) return false;
  const keys = new Set(right.map((row) => `${row.modelRunId}\u0000${row.corridor}`));
  return left.every((row) => keys.has(`${row.modelRunId}\u0000${row.corridor}`));
}

function formatAgreementNumber(value: number | null, style: "percent" | "number" = "number") {
  if (value === null) return "Not available";
  return style === "percent"
    ? new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 }).format(value)
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function sameIdSet(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

export { describeReportSourceReviewPosture } from "@/lib/reports/source-review-posture";

function sourceReviewPostureClassName(state: ReportSourceReviewPosture["state"]) {
  if (state === "ready") {
    return "border-emerald-300/70 bg-emerald-50 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100";
  }
  if (state === "needs-review") {
    return "border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100";
  }
  return "border-slate-300/80 bg-slate-50 text-slate-950 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-100";
}

export function ReportDetailControls({
  report,
  driftSummary,
  evidenceSummary,
  fundingSummary,
  reviewSummary,
  modelRunOptions = [],
  citedModelRunIds = [],
  agreementEvidence = [],
  agreementCorridorSelections = [],
  aerialOrthoCatalog,
  aerialOrthoSelections = [],
  safetyIngestOptions = [],
  safetyIngestSelections = [],
  initialSafetyIngestId = null,
}: {
  report: {
    id: string;
    title: string;
    summary: string | null;
    status: string;
    hasGeneratedArtifact: boolean;
  };
  driftSummary?: {
    changedCount: number;
    totalCount: number;
    labels: string[];
  };
  evidenceSummary?: {
    headline: string;
    detail: string;
    blockedGateDetail?: string | null;
    hasEvidence?: boolean;
  } | null;
  fundingSummary?: {
    headline: string;
    detail: string;
    timingDetail?: string | null;
  } | null;
  reviewSummary?: {
    headline: string;
    detail: string;
    nextActionLabel?: string | null;
  } | null;
  modelRunOptions?: ReportModelRunOption[];
  citedModelRunIds?: string[];
  agreementEvidence?: ReportAgreementEvidence[];
  agreementCorridorSelections?: AgreementCorridorSelection[];
  aerialOrthoCatalog?: AerialOrthoCatalog;
  aerialOrthoSelections?: ReportAerialOrthoSelection[];
  safetyIngestOptions?: ReportSafetyIngestOption[];
  safetyIngestSelections?: ReportSafetyIngestSelection[];
  initialSafetyIngestId?: string | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(report.title);
  const [summary, setSummary] = useState(report.summary ?? "");
  const [status, setStatus] = useState(report.status);
  const [selectedModelRunIds, setSelectedModelRunIds] = useState<string[]>(citedModelRunIds);
  const [selectedAgreementCorridors, setSelectedAgreementCorridors] =
    useState<AgreementCorridorSelection[]>(agreementCorridorSelections);
  const [selectedAerialCustodyId, setSelectedAerialCustodyId] = useState<string | null>(
    aerialOrthoSelections[0]?.custodyId ?? null,
  );
  const requestedSafetyIngestId = safetyIngestOptions.some(
    (option) => option.id === initialSafetyIngestId,
  ) ? initialSafetyIngestId : null;
  const [selectedSafetyIngestId, setSelectedSafetyIngestId] = useState<string | null>(
    requestedSafetyIngestId ?? safetyIngestSelections[0]?.ingestId ?? null,
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  // The generate route has accepted "pdf" since the module shipped; the UI
  // hardcoded "html", so the PDF path was unreachable from the app.
  const [artifactFormat, setArtifactFormat] = useState<ReportArtifactFormat>("pdf");
  const [error, setError] = useState<string | null>(null);
  const [warningCount, setWarningCount] = useState(0);
  const driftedSources = driftSummary?.labels ?? [];
  const hasDrift = (driftSummary?.changedCount ?? 0) > 0;
  const sourceReviewPosture = describeReportSourceReviewPosture({
    hasGeneratedArtifact: report.hasGeneratedArtifact,
    evidenceSummary,
    driftSummary,
  });

  async function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    try {
      // Only send modelRunIds when the citation set actually changed, so a
      // deployment without the typed-evidence migration keeps saving metadata
      // exactly as before.
      const modelRunSelectionChanged = !sameIdSet(selectedModelRunIds, citedModelRunIds);
      const finalAgreementSelections = selectedAgreementCorridors.filter((selection) =>
        selectedModelRunIds.includes(selection.modelRunId)
      );
      const agreementSelectionChanged = !sameSelections(
        finalAgreementSelections,
        agreementCorridorSelections,
      );
      const aerialOrthoSelectionChanged =
        selectedAerialCustodyId !== (aerialOrthoSelections[0]?.custodyId ?? null);
      const safetySelectionChanged =
        selectedSafetyIngestId !== (safetyIngestSelections[0]?.ingestId ?? null);

      const response = await fetch(`/api/reports/${report.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title,
          summary: summary.trim() ? summary : null,
          status,
          ...(modelRunSelectionChanged ? { modelRunIds: selectedModelRunIds } : {}),
          ...(agreementSelectionChanged || modelRunSelectionChanged
            ? { agreementCorridorSelections: finalAgreementSelections }
            : {}),
          ...(aerialOrthoSelectionChanged
            ? { aerialOrthoSelections: selectedAerialCustodyId ? [{ custodyId: selectedAerialCustodyId }] : [] }
            : {}),
          ...(safetySelectionChanged
            ? { safetyIngestSelections: selectedSafetyIngestId ? [{ ingestId: selectedSafetyIngestId }] : [] }
            : {}),
        }),
      });

      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error || "Failed to update report");
      }

      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to update report"
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleGenerate() {
    setError(null);
    setIsGenerating(true);

    try {
      const response = await fetch(
        `/api/reports/${report.id}/generate`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ format: artifactFormat }),
        }
      );

      const payload = (await response.json()) as {
        error?: string;
        warnings?: Array<unknown>;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to generate report");
      }

      setWarningCount(payload.warnings?.length ?? 0);
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to generate report"
      );
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <article className="rounded-[0.75rem] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.5rem] bg-sky-500/10 text-sky-700 dark:text-sky-300">
          <FileCog className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Controls
          </p>
          <h2 className="text-xl font-semibold tracking-tight">
            Edit and generate
          </h2>
        </div>
      </div>

      <form className="mt-5 space-y-4" onSubmit={handleSave}>
        {/* Title */}
        <div className="space-y-1.5">
          <label
            htmlFor="detail-title"
            className="text-[0.82rem] font-semibold"
          >
            Title
          </label>
          <Input
            id="detail-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </div>

        {/* Summary */}
        <div className="space-y-1.5">
          <label
            htmlFor="detail-summary"
            className="text-[0.82rem] font-semibold"
          >
            Summary
          </label>
          <Textarea
            id="detail-summary"
            rows={3}
            placeholder="Describe the purpose and scope of this report."
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        </div>

        {/* Status */}
        <div className="space-y-1.5">
          <label
            htmlFor="detail-status"
            className="text-[0.82rem] font-semibold"
          >
            Status
          </label>
          <select
            id="detail-status"
            className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            {status === "generated" ? (
              <option value="generated">Generated from artifact output</option>
            ) : null}
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Artifact generation moves a report into the generated state.
            Metadata edits can keep it in draft or archive it after review.
            {report.hasGeneratedArtifact
              ? " Existing artifact history remains attached to this record."
              : ""}
          </p>
        </div>

        {/* Cited model runs */}
        {safetyIngestOptions.length > 0 ? (
          <div className="space-y-2" data-testid="report-safety-evidence-selection">
            <label htmlFor="report-safety-ingest" className="text-[0.82rem] font-semibold">
              Crash evidence
            </label>
            <select
              id="report-safety-ingest"
              value={selectedSafetyIngestId ?? ""}
              onChange={(event) => setSelectedSafetyIngestId(event.target.value || null)}
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm"
            >
              <option value="">Do not include crash evidence</option>
              {safetyIngestOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.sourceLabel} · {option.crashCount.toLocaleString()} reported · {new Date(option.createdAt).toLocaleDateString()}
                </option>
              ))}
            </select>
            <p className="text-xs leading-relaxed text-muted-foreground">
              This is an explicit evidence choice. Save it before generating; the report
              freezes only this acquisition and discloses its mappable count and limits.
            </p>
          </div>
        ) : null}

        {/* Cited model runs */}
        {modelRunOptions.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-[0.82rem] font-semibold">
                Cited model runs
              </label>
              <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {selectedModelRunIds.length} cited
              </span>
            </div>
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-border/70 bg-background/70 p-2.5">
              {modelRunOptions.map((option) => {
                const isSelected = selectedModelRunIds.includes(option.id);
                return (
                  <label
                    key={option.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors ${
                      isSelected
                        ? "border-primary/30 bg-primary/5"
                        : "border-border/70 bg-card/70 hover:border-border hover:bg-card"
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition-colors ${
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input bg-background"
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={isSelected}
                      onChange={() =>
                        setSelectedModelRunIds((current) =>
                          current.includes(option.id)
                            ? current.filter((id) => id !== option.id)
                            : [...current, option.id]
                        )
                      }
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {option.title}
                      </span>
                      <span className="block text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                        {getManagedRunModeDefinition(option.engineKey).engineLabel} · {titleize(option.status)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Cited worker runs appear in the generated packet with their engine,
              status, and screening-grade caveats. Save metadata to apply the
              citation change.
            </p>
          </div>
        ) : null}

        {agreementEvidence.length > 0 ? (
          <div
            className="space-y-3 rounded-xl border border-border/70 bg-background/70 p-4"
            data-testid="dual-demand-agreement-panel"
          >
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Dual-model agreement evidence
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Aggregate evidence is included whenever the cited run is verified. Choose named corridors only when they belong in this report; none are chosen automatically.
              </p>
            </div>
            {agreementEvidence.map(({ modelRunId, state }) => {
              const option = modelRunOptions.find((candidate) => candidate.id === modelRunId);
              if (state.status !== "verified") {
                return (
                  <div key={modelRunId} className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                    <span className="font-semibold">{option?.title ?? "Cited model run"}: </span>
                    {state.status === "absent" ? "No agreement results are attached." : state.reason}
                  </div>
                );
              }
              const agreement = state.agreement;
              return (
                <section key={modelRunId} className="space-y-2 rounded-lg border border-border/70 bg-card/80 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{option?.title ?? "Cited model run"}</p>
                      <p className="text-xs text-muted-foreground">
                        {agreement.methods.first} vs. {agreement.methods.second} · {agreement.permittedAttributionScale}-level attribution
                      </p>
                    </div>
                    <span className="text-xs font-medium text-muted-foreground">
                      {formatAgreementNumber(agreement.aggregate.agreeShareMeaningfulLinks, "percent")} agree on meaningful links
                    </span>
                  </div>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Agreement measures methodological sensitivity, not accuracy. The two model volumes are never averaged.
                  </p>
                  {agreement.namedCorridors.length > 0 ? (
                    <div className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
                      {agreement.namedCorridors.map((corridor) => {
                        const checked = selectedAgreementCorridors.some(
                          (selection) => selection.modelRunId === modelRunId && selection.corridor === corridor.corridor,
                        );
                        return (
                          <label key={corridor.corridor} className="flex cursor-pointer gap-3 rounded-lg border border-border/60 px-3 py-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setSelectedAgreementCorridors((current) =>
                                  checked
                                    ? current.filter((selection) => !(selection.modelRunId === modelRunId && selection.corridor === corridor.corridor))
                                    : [...current, { modelRunId, corridor: corridor.corridor }]
                                )
                              }
                            />
                            <span className="min-w-0 text-xs">
                              <span className="block font-semibold text-foreground">{corridor.corridor}</span>
                              <span className="text-muted-foreground">
                                {agreement.methods.first} {formatAgreementNumber(corridor.firstVolume)} · {agreement.methods.second} {formatAgreementNumber(corridor.secondVolume)} · GEH {formatAgreementNumber(corridor.geh)} · {titleize(corridor.classification)}
                              </span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">No named corridors are present in these verified results.</p>
                  )}
                </section>
              );
            })}
          </div>
        ) : null}

        {aerialOrthoCatalog ? (
          <div className="space-y-3 rounded-xl border border-border/70 bg-background/70 p-4" data-testid="report-aerial-ortho-panel">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Held orthophoto evidence</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Choose one held preview only when it belongs in this report. Nothing is selected automatically, and generation does not publish the image publicly.
              </p>
            </div>
            <label className="flex cursor-pointer gap-3 rounded-lg border border-border/60 px-3 py-2">
              <input type="radio" name="aerial-ortho" checked={selectedAerialCustodyId === null} onChange={() => setSelectedAerialCustodyId(null)} />
              <span className="text-xs"><span className="block font-semibold text-foreground">Do not include aerial imagery</span><span className="text-muted-foreground">The generated report will contain no orthophoto preview.</span></span>
            </label>
            {aerialOrthoCatalog.layers.map((layer) => (
              <label key={layer.custodyId} className="flex cursor-pointer gap-3 rounded-lg border border-border/60 px-3 py-2">
                <input type="radio" name="aerial-ortho" checked={selectedAerialCustodyId === layer.custodyId} onChange={() => setSelectedAerialCustodyId(layer.custodyId)} />
                <span className="min-w-0 text-xs">
                  <span className="block font-semibold text-foreground">{layer.missionTitle}</span>
                  <span className="block text-muted-foreground">
                    {layer.collectedAt ? `Captured ${new Date(layer.collectedAt).toLocaleDateString()} · ` : "Capture date not recorded · "}
                    {layer.pixelSizeM ? `${layer.pixelSizeM.toLocaleString()} m/pixel · ` : "Resolution not recorded · "}
                    SHA-256 {layer.checksumSha256.slice(0, 12)}…
                  </span>
                </span>
              </label>
            ))}
            {aerialOrthoCatalog.state !== "verified" ? (
              <p className="rounded-lg border border-amber-300/70 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
                {aerialOrthoCatalog.notes[0] ?? "No verified held preview is available for this project."}
              </p>
            ) : null}
            <p className="text-xs leading-relaxed text-muted-foreground">Orientation only; not survey-grade and not evidence of property boundaries or legal location.</p>
          </div>
        ) : null}

        <div
          className={`rounded-xl border px-4 py-3 text-sm ${sourceReviewPostureClassName(
            sourceReviewPosture.state
          )}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] opacity-75">
                Does this packet need rebuilding?
              </p>
              <p className="mt-1 font-semibold">{sourceReviewPosture.headline}</p>
            </div>
            <span className="rounded-full border border-current/20 px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.12em] opacity-90">
              {sourceReviewPosture.label}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed opacity-85">
            {sourceReviewPosture.detail}
          </p>
          {sourceReviewPosture.changedSourceText ? (
            <p className="mt-2 text-xs leading-relaxed opacity-85">
              Changed sources: {sourceReviewPosture.changedSourceText}.
            </p>
          ) : null}
        </div>

        {evidenceSummary ? (
          <div className="rounded-xl border border-border/70 bg-background/80 px-4 py-3 text-sm text-foreground">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              What this report rests on
            </p>
            <p className="mt-1 font-semibold">{evidenceSummary.headline}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {evidenceSummary.detail}
            </p>
            {evidenceSummary.blockedGateDetail ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {evidenceSummary.blockedGateDetail}
              </p>
            ) : null}
          </div>
        ) : null}

        {fundingSummary ? (
          <div className="rounded-xl border border-border/70 bg-background/80 px-4 py-3 text-sm text-foreground">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Funding
            </p>
            <p className="mt-1 font-semibold">{fundingSummary.headline}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {fundingSummary.detail}
            </p>
            {fundingSummary.timingDetail ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {fundingSummary.timingDetail}
              </p>
            ) : null}
          </div>
        ) : null}

        {reviewSummary ? (
          <div className="rounded-xl border border-border/70 bg-background/80 px-4 py-3 text-sm text-foreground">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Ready to release?
            </p>
            <p className="mt-1 font-semibold">{reviewSummary.headline}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {reviewSummary.detail}
            </p>
            {reviewSummary.nextActionLabel ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Next step: {reviewSummary.nextActionLabel}.
              </p>
            ) : null}
          </div>
        ) : null}

        {hasDrift ? (
          <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0" />
              <div>
                <p className="font-semibold">
                  {driftSummary?.changedCount} live source change{driftSummary?.changedCount === 1 ? "" : "s"} detected since the current packet was generated.
                </p>
                <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                  Regeneration is recommended so the packet reflects the latest evidence chain.
                  {driftedSources.length > 0
                    ? ` Changed sources: ${formatDriftLabelList(driftedSources)}.`
                    : ""}
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Error banner */}
        {error ? (
          <p className="rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        {/* Warning banner */}
        {warningCount > 0 ? (
          <p className="rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Latest generation completed with {warningCount} audit warning
            {warningCount === 1 ? "" : "s"} on linked runs.
          </p>
        ) : null}

        {/* Actions */}
        <div className="flex flex-wrap gap-3 border-t border-border/50 pt-4">
          <Button type="submit" disabled={isSaving}>
            {isSaving ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Save className="h-4 w-4" />
                Save metadata
              </span>
            )}
          </Button>

          <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <span>Format</span>
            <select
              className="module-select h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
              value={artifactFormat}
              onChange={(event) => setArtifactFormat(event.target.value as ReportArtifactFormat)}
              disabled={isGenerating}
              aria-label="Packet format"
            >
              <option value="pdf">PDF (downloadable)</option>
              <option value="html">HTML</option>
            </select>
          </label>

          <Button
            type="button"
            variant="secondary"
            disabled={isGenerating}
            onClick={handleGenerate}
          >
            {isGenerating ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <WandSparkles className="h-4 w-4" />
                {hasDrift && report.hasGeneratedArtifact ? "Regenerate" : "Generate"}{" "}
                {artifactFormat === "pdf" ? "PDF" : "HTML"} packet
              </span>
            )}
          </Button>
        </div>
      </form>
    </article>
  );
}
