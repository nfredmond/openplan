"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FilePlus2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/state-block";
import {
  REPORT_TYPE_OPTIONS,
  defaultReportTitle,
  type ReportType,
} from "@/lib/reports/catalog";

type ProjectOption = {
  id: string;
  workspace_id: string;
  name: string;
};

type RunOption = {
  id: string;
  workspace_id: string;
  title: string;
  created_at: string;
};

type CreateResponse = {
  reportId: string;
};

type ProjectReportGuidance = {
  reportCount: number;
  refreshRecommendedCount: number;
  noPacketCount: number;
  comparisonBackedCount: number;
  recommendedReportId: string | null;
  recommendedReportTitle: string | null;
};

function formatReportCountLabel(count: number) {
  return `${count} report record${count === 1 ? "" : "s"}`;
}

function formatGuidanceCounts({
  refreshRecommendedCount,
  noPacketCount,
  comparisonBackedCount,
}: Pick<
  ProjectReportGuidance,
  "refreshRecommendedCount" | "noPacketCount" | "comparisonBackedCount"
>) {
  const parts: string[] = [];

  if (refreshRecommendedCount > 0) {
    parts.push(`${refreshRecommendedCount} refresh recommended`);
  }

  if (noPacketCount > 0) {
    parts.push(`${noPacketCount} without packet`);
  }

  if (comparisonBackedCount > 0) {
    parts.push(`${comparisonBackedCount} comparison-backed`);
  }

  if (parts.length === 0) {
    return "Latest packet looks current.";
  }

  if (parts.length === 1) {
    return `${parts[0]}.`;
  }

  return `${parts[0]} and ${parts[1]}.`;
}

export function ReportCreator({
  projects,
  runs,
  reportGuidanceByProject = {},
}: {
  projects: ProjectOption[];
  runs: RunOption[];
  reportGuidanceByProject?: Record<string, ProjectReportGuidance>;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [reportType, setReportType] = useState<ReportType>("project_status");
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProject =
    projects.find((project) => project.id === projectId) ?? null;
  const selectedWorkspaceId = selectedProject?.workspace_id ?? null;
  const availableRuns = selectedProject
    ? runs.filter((run) => run.workspace_id === selectedProject.workspace_id)
    : [];
  const selectedProjectGuidance = projectId
    ? reportGuidanceByProject[projectId] ?? null
    : null;
  const suggestedTitle = selectedProject
    ? defaultReportTitle(selectedProject.name, reportType)
    : "Select a project first";

  useEffect(() => {
    setSelectedRunIds((current) =>
      current.filter((runId) =>
        runs.some(
          (run) =>
            run.id === runId &&
            (!selectedWorkspaceId ||
              run.workspace_id === selectedWorkspaceId)
        )
      )
    );
  }, [selectedWorkspaceId, runs]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId,
          title,
          summary,
          reportType,
          runIds: selectedRunIds,
        }),
      });

      const payload = (await response.json()) as CreateResponse & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to create report");
      }

      router.refresh();
      router.push(`/reports/${payload.reportId}`);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Failed to create report"
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  function toggleRun(runId: string) {
    setSelectedRunIds((current) =>
      current.includes(runId)
        ? current.filter((id) => id !== runId)
        : [...current, runId]
    );
  }

  return (
    <article className="rounded-[28px] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-700 dark:text-amber-300">
          <FilePlus2 className="h-5 w-5" />
        </span>
        <div>
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Create
          </p>
          <h2 className="text-xl font-semibold tracking-tight">
            New report packet
          </h2>
        </div>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        Select a project, choose a report type, and optionally attach analysis
        runs. The report will open with a preconfigured section set and an
        audit-ready artifact history.
      </p>

      {projects.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No projects available"
            description="Create a project before opening a report packet. Reports stay tied to project records and workspace audit history."
            compact
          />
        </div>
      ) : (
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
        {/* Project selector */}
        <div className="space-y-1.5">
          <label
            htmlFor="report-project"
            className="text-[0.82rem] font-semibold"
          >
            Project
          </label>
          <select
            id="report-project"
            className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            required
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {selectedProjectGuidance ? (
            <div
              className={`rounded-2xl border px-4 py-3 text-sm ${
                selectedProjectGuidance.refreshRecommendedCount > 0 ||
                selectedProjectGuidance.noPacketCount > 0
                  ? "border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
                  : selectedProjectGuidance.comparisonBackedCount > 0
                    ? "border-sky-300/70 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
                  : "border-border/70 bg-muted/35 text-foreground"
              }`}
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0" />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold">
                    This project already has {formatReportCountLabel(selectedProjectGuidance.reportCount)}.
                  </p>
                  <p className="text-xs leading-relaxed text-current/80">
                    {formatGuidanceCounts(selectedProjectGuidance)}
                    {selectedProjectGuidance.recommendedReportTitle
                      ? ` Review ${selectedProjectGuidance.recommendedReportTitle} before creating another packet unless you need a separate report record.`
                      : " Review the latest report before creating another packet unless you need a separate record."}
                  </p>
                  {selectedProjectGuidance.recommendedReportId ? (
                    <Link
                      href={`/reports/${selectedProjectGuidance.recommendedReportId}`}
                      className="inline-flex items-center gap-1 rounded-full border border-current/20 bg-background/70 px-3 py-1 text-[0.72rem] font-medium text-current transition-colors hover:border-current/35"
                    >
                      Open existing report
                    </Link>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Title + type row */}
        <div className="grid gap-4 md:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-1.5">
            <label
              htmlFor="report-title"
              className="text-[0.82rem] font-semibold"
            >
              Title
              <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">
                optional
              </span>
            </label>
            <Input
              id="report-title"
              placeholder={suggestedTitle}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank to use <span className="font-medium">{suggestedTitle}</span>.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="report-type"
              className="text-[0.82rem] font-semibold"
            >
              Report type
            </label>
            <select
              id="report-type"
              className="flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35"
              value={reportType}
              onChange={(event) =>
                setReportType(event.target.value as ReportType)
              }
            >
              {REPORT_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Summary */}
        <div className="space-y-1.5">
          <label
            htmlFor="report-summary"
            className="text-[0.82rem] font-semibold"
          >
            Summary
            <span className="ml-1.5 text-[0.72rem] font-normal text-muted-foreground">
              optional
            </span>
          </label>
          <Textarea
            id="report-summary"
            placeholder="Describe what this packet covers and what reviewers should focus on."
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={3}
          />
        </div>

        {/* Run selector */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className="text-[0.82rem] font-semibold">
              Linked analysis runs
            </label>
            <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {selectedRunIds.length} selected
            </span>
          </div>
          <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-border/70 bg-background/70 p-2.5">
            {availableRuns.length === 0 ? (
              <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                No runs available for the selected project.
              </p>
            ) : (
              availableRuns.map((run) => {
                const isSelected = selectedRunIds.includes(run.id);
                return (
                  <label
                    key={run.id}
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
                      onChange={() => toggleRun(run.id)}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        {run.title}
                      </span>
                      <span className="block text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                        {new Date(run.created_at).toLocaleString()}
                      </span>
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {/* Error */}
        {error ? (
          <p className="rounded-xl border border-red-300/80 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </p>
        ) : null}

        {/* Submit */}
        <Button
          type="submit"
          disabled={isSubmitting || !projectId}
          className="w-full sm:w-auto"
        >
          {isSubmitting ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating…
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <FilePlus2 className="h-4 w-4" />
              Create report
            </span>
          )}
        </Button>
        </form>
      )}
    </article>
  );
}
