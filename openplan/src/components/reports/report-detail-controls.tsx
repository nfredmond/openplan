"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileCog, Loader2, Save, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

function formatDriftLabelList(labels: string[]) {
  if (labels.length <= 1) {
    return labels[0] ?? "";
  }

  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }

  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

type DriftSummary = {
  changedCount: number;
  totalCount: number;
  labels: string[];
};

type EvidenceSummary = {
  headline: string;
  detail: string;
  blockedGateDetail?: string | null;
} | null;

type SourceReviewPosture = {
  state: "ready" | "needs-review" | "missing";
  label: string;
  headline: string;
  detail: string;
  changedSourceText: string | null;
};

export function describeReportSourceReviewPosture({
  hasGeneratedArtifact,
  evidenceSummary,
  driftSummary,
}: {
  hasGeneratedArtifact: boolean;
  evidenceSummary?: EvidenceSummary;
  driftSummary?: DriftSummary;
}): SourceReviewPosture {
  const changedCount = driftSummary?.changedCount ?? 0;
  const changedSourceText =
    driftSummary && driftSummary.labels.length > 0
      ? formatDriftLabelList(driftSummary.labels)
      : null;

  if (!hasGeneratedArtifact) {
    return {
      state: "missing",
      label: "Missing evidence",
      headline: "No generated packet yet",
      detail:
        "Generate the first packet before treating this report as release-review evidence. The generation step captures the compact source context that reviewers need.",
      changedSourceText,
    };
  }

  if (!evidenceSummary) {
    return {
      state: "missing",
      label: "Missing evidence",
      headline: "No evidence chain captured",
      detail:
        "This packet does not expose a structured evidence-chain snapshot yet. Regenerate it before citing the packet externally or using it for grant triage.",
      changedSourceText,
    };
  }

  if (changedCount > 0) {
    return {
      state: "needs-review",
      label: "Changed source context",
      headline: `${changedCount} source ${changedCount === 1 ? "area needs" : "areas need"} review`,
      detail:
        "The packet still has linked evidence, but live source context has changed since generation. Review the changed source areas and regenerate before relying on this packet outside supervised draft review.",
      changedSourceText,
    };
  }

  return {
    state: "ready",
    label: "Current / ready",
    headline: "Evidence chain current",
    detail:
      "A structured evidence-chain snapshot is linked and no live source drift is currently visible. Keep normal human review and caveat checks in place before external use.",
    changedSourceText: null,
  };
}

function sourceReviewPostureClassName(state: SourceReviewPosture["state"]) {
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
}) {
  const router = useRouter();
  const [title, setTitle] = useState(report.title);
  const [summary, setSummary] = useState(report.summary ?? "");
  const [status, setStatus] = useState(report.status);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
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
      const response = await fetch(`/api/reports/${report.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title,
          summary: summary.trim() ? summary : null,
          status,
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
          body: JSON.stringify({ format: "html" }),
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

        <div
          className={`rounded-xl border px-4 py-3 text-sm ${sourceReviewPostureClassName(
            sourceReviewPosture.state
          )}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] opacity-75">
                Regeneration posture
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
              Evidence chain posture
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
              Funding posture
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
              Release review posture
            </p>
            <p className="mt-1 font-semibold">{reviewSummary.headline}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {reviewSummary.detail}
            </p>
            {reviewSummary.nextActionLabel ? (
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Next operator move: {reviewSummary.nextActionLabel}.
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
                {hasDrift && report.hasGeneratedArtifact
                  ? "Regenerate HTML packet"
                  : "Generate HTML packet"}
              </span>
            )}
          </Button>
        </div>
      </form>
    </article>
  );
}
