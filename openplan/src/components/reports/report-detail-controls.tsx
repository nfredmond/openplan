"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileCog, Loader2, Save, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ReportDetailControls({
  report,
}: {
  report: {
    id: string;
    title: string;
    summary: string | null;
    status: string;
    hasGeneratedArtifact: boolean;
  };
}) {
  const router = useRouter();
  const [title, setTitle] = useState(report.title);
  const [summary, setSummary] = useState(report.summary ?? "");
  const [status, setStatus] = useState(report.status);
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warningCount, setWarningCount] = useState(0);

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
    <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-700 dark:text-sky-300">
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
                Generate HTML packet
              </span>
            )}
          </Button>
        </div>
      </form>
    </article>
  );
}
