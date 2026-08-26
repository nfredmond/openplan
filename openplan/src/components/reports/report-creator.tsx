"use client";

/**
 * Making a new report packet, as three questions instead of a wall of fields.
 *
 * WHY THIS IS A SHEET AND NOT A FORM ON THE PAGE. `/reports` is a place you go
 * to READ your reports. Until this change the first thing on that page was a
 * ten-control form for making another one — project, title, type, summary, a
 * modelling-evidence select, and a scrolling list of analysis runs — painted
 * open whether or not anybody came to make anything. Creating a report is
 * episodic: you do it, it ends, and it hands you back to the list. That is
 * exactly the shape `GuidedFlow` exists for.
 *
 * WHAT SURVIVED THE MOVE, DELIBERATELY. Every field, every default, and every
 * disclosure the old form carried:
 *   - the stale-packet guidance for the chosen project, including the link to
 *     the report it suggests you read first — the whole point of that panel is
 *     to talk somebody OUT of creating a duplicate, so it has to be beside the
 *     project picker, on the first step, before anything is typed;
 *   - the county-run default (the newest run in this workspace that carries a
 *     claim decision) and the claim-status label, reason and validation
 *     tally beside it. A report that cites a screening-grade run must say so
 *     while it is being attached, not afterwards;
 *   - the suggested title, shown live, and the promise that leaving the box
 *     blank sends that exact title rather than an empty one;
 *   - the workspace filter on both run lists, and the pruning of a chosen run
 *     when the project moves to another workspace.
 *
 * WHY THE PRUNING MOVED FROM AN EFFECT TO THE onChange. The old component
 * pruned run selections in a `useEffect` on the derived workspace id. The flow
 * owns its answers, so the pruning happens where the project actually changes —
 * one place, no render-loop, and nothing to keep in sync.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { withPlanningContext } from "@/lib/projects/planning-context";
import { AlertTriangle, Check, FilePlus2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/state-block";
import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowController,
} from "@/components/ui/guided-flow";
import {
  REPORT_TYPE_OPTIONS,
  defaultReportTitle,
  type ReportType,
} from "@/lib/reports/catalog";
import { selectInitialPlanningProjectId } from "@/lib/projects/planning-context";
import { modelingClaimStatusLabel } from "@/lib/models/evidence-backbone";
import type { ModelingClaimStatus } from "@/lib/models/evidence-backbone";

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

export type ModelingCountyRunOption = {
  id: string;
  workspace_id: string;
  runName: string;
  geographyLabel: string | null;
  stage: string | null;
  updatedAt: string | null;
  claimStatus: ModelingClaimStatus | null;
  statusReason: string | null;
  validationSummary: Record<string, unknown> | null;
  decidedAt: string | null;
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

const SELECT_CLASS =
  "flex h-11 w-full rounded-xl border border-input bg-background px-3.5 text-sm shadow-xs transition-[color,box-shadow,border-color] outline-none focus-visible:border-[color:var(--focus-ring-light)] focus-visible:ring-3 focus-visible:ring-[color:var(--focus-ring-light)]/35";

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

function pickDefaultModelingCountyRunId(
  workspaceId: string | null,
  modelingCountyRuns: ModelingCountyRunOption[]
) {
  if (!workspaceId) {
    return "";
  }

  return (
    modelingCountyRuns.find(
      (run) => run.workspace_id === workspaceId && run.claimStatus
    )?.id ?? ""
  );
}

function formatModelingRunOptionText(option: ModelingCountyRunOption) {
  const posture = option.claimStatus
    ? modelingClaimStatusLabel(option.claimStatus)
    : "No claim decision";
  const geography = option.geographyLabel ? `, ${option.geographyLabel}` : "";
  return `${option.runName} — ${posture}${geography}`;
}

function formatValidationSummary(value: Record<string, unknown> | null) {
  if (!value) {
    return null;
  }

  const passed = typeof value.passed === "number" ? value.passed : null;
  const warned = typeof value.warned === "number" ? value.warned : null;
  const failed = typeof value.failed === "number" ? value.failed : null;
  const parts: string[] = [];

  if (passed !== null) parts.push(`${passed} pass`);
  if (warned !== null) parts.push(`${warned} warn`);
  if (failed !== null) parts.push(`${failed} fail`);

  return parts.length > 0 ? parts.join(" / ") : null;
}

type ReportFlowValues = {
  projectId: string;
  reportType: ReportType;
  title: string;
  summary: string;
  modelingCountyRunId: string;
  runIds: string[];
};

export function ReportCreator({
  projects,
  runs,
  modelingCountyRuns = [],
  reportGuidanceByProject = {},
  initialProjectId,
}: {
  projects: ProjectOption[];
  runs: RunOption[];
  modelingCountyRuns?: ModelingCountyRunOption[];
  reportGuidanceByProject?: Record<string, ProjectReportGuidance>;
  initialProjectId?: string | null;
}) {
  const router = useRouter();
  const selectedInitialProjectId = selectInitialPlanningProjectId(projects, initialProjectId, "first");
  const initialProject = projects.find((project) => project.id === selectedInitialProjectId) ?? null;

  const initialValues = useMemo<ReportFlowValues>(
    () => ({
      projectId: initialProject?.id ?? "",
      reportType: "project_status",
      title: "",
      summary: "",
      modelingCountyRunId: pickDefaultModelingCountyRunId(
        initialProject?.workspace_id ?? null,
        modelingCountyRuns
      ),
      runIds: [],
    }),
    [initialProject, modelingCountyRuns]
  );

  function projectFor(values: ReportFlowValues) {
    return projects.find((project) => project.id === values.projectId) ?? null;
  }

  function suggestedTitleFor(values: ReportFlowValues) {
    const project = projectFor(values);
    return project ? defaultReportTitle(project.name, values.reportType) : "Select a project first";
  }

  /**
   * Moving the project moves the workspace, and a run belongs to exactly one.
   * Anything chosen for the old workspace is dropped rather than sent to a
   * server that would refuse it — and the county-run default is re-picked for
   * the new one, so the honest default follows the project.
   */
  function chooseProject(flow: GuidedFlowController<ReportFlowValues>, nextProjectId: string) {
    const workspaceId = projects.find((project) => project.id === nextProjectId)?.workspace_id ?? null;
    flow.setValues({
      projectId: nextProjectId,
      runIds: flow.values.runIds.filter((runId) =>
        runs.some((run) => run.id === runId && (!workspaceId || run.workspace_id === workspaceId))
      ),
      modelingCountyRunId: pickDefaultModelingCountyRunId(workspaceId, modelingCountyRuns),
    });
  }

  const flow = useGuidedFlow<ReportFlowValues>({
    id: "report-creator",
    title: "New report",
    description: "A report packet gathers what you have decided and what backs it up, in one place.",
    submitLabel: "Create report",
    initialValues,
    steps: [
      {
        id: "project",
        title: "Which project is this report about?",
        hint: "Reports live on a project, so the packet and its history stay with the work.",
        fields: [
          {
            name: "projectId",
            label: "Project",
            required: true,
            requiredMessage: "Pick the project this report is about.",
          },
        ],
        render: (flowState) => {
          const guidance = flowState.values.projectId
            ? reportGuidanceByProject[flowState.values.projectId] ?? null
            : null;

          return (
            <>
              <GuidedFlowRow flow={flowState} name="projectId" label="Project">
                <select
                  {...flowState.fieldProps("projectId")}
                  className={SELECT_CLASS}
                  value={flowState.values.projectId}
                  onChange={(event) => chooseProject(flowState, event.target.value)}
                >
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </GuidedFlowRow>

              {guidance ? (
                <div
                  className={`rounded-[0.5rem] border px-4 py-3 text-sm ${
                    guidance.refreshRecommendedCount > 0 || guidance.noPacketCount > 0
                      ? "border-amber-300/70 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"
                      : guidance.comparisonBackedCount > 0
                        ? "border-sky-300/70 bg-sky-50 text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100"
                        : "border-border/70 bg-muted/35 text-foreground"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="font-semibold">
                        This project already has {formatReportCountLabel(guidance.reportCount)}.
                      </p>
                      <p className="text-xs leading-relaxed text-current/80">
                        {formatGuidanceCounts(guidance)}
                        {guidance.recommendedReportTitle
                          ? ` Review ${guidance.recommendedReportTitle} before creating another packet unless you need a separate report record.`
                          : " Review the latest report before creating another packet unless you need a separate record."}
                      </p>
                      {guidance.recommendedReportId ? (
                        <Link
                          href={`/reports/${guidance.recommendedReportId}`}
                          className="inline-flex items-center gap-1 rounded-full border border-current/20 bg-background/70 px-3 py-1 text-[0.72rem] font-medium text-current transition-colors hover:border-current/35"
                        >
                          Open existing report
                        </Link>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          );
        },
      },
      {
        id: "about",
        title: "What kind of report, and what should it be called?",
        hint: "The type decides which sections the packet starts with. You can leave the name to us.",
        fields: [
          { name: "reportType", label: "Report type", required: true },
          { name: "title", label: "Title" },
          { name: "summary", label: "Summary" },
        ],
        render: (flowState) => {
          const suggested = suggestedTitleFor(flowState.values);
          return (
            <>
              <GuidedFlowRow
                flow={flowState}
                name="reportType"
                label="Report type"
                hint="Pick the closest one — you can add or remove sections later."
              >
                <select {...flowState.text("reportType")} className={SELECT_CLASS}>
                  {REPORT_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </GuidedFlowRow>

              <GuidedFlowRow
                flow={flowState}
                name="title"
                label="Title (optional)"
                hint={`Leave it blank and the report is called “${suggested}”.`}
              >
                <Input {...flowState.text("title")} placeholder={suggested} />
              </GuidedFlowRow>

              <GuidedFlowRow
                flow={flowState}
                name="summary"
                label="Summary (optional)"
                hint="One or two sentences for whoever opens this next: what it covers, what to look at."
              >
                <Textarea {...flowState.text("summary")} rows={3} />
              </GuidedFlowRow>
            </>
          );
        },
      },
      {
        id: "evidence",
        title: "What analysis should this report cite?",
        hint: "Optional. You can attach analysis later, and a report with nothing attached simply makes no modelling claims.",
        fields: [
          { name: "modelingCountyRunId", label: "Modeling evidence" },
          { name: "runIds", label: "Linked analysis runs" },
        ],
        render: (flowState) => {
          const project = projectFor(flowState.values);
          const workspaceId = project?.workspace_id ?? null;
          const availableRuns = workspaceId
            ? runs.filter((run) => run.workspace_id === workspaceId)
            : [];
          const availableModelingCountyRuns = workspaceId
            ? modelingCountyRuns.filter((run) => run.workspace_id === workspaceId)
            : [];
          const selectedModelingCountyRun =
            availableModelingCountyRuns.find(
              (run) => run.id === flowState.values.modelingCountyRunId
            ) ?? null;
          const selectedValidationSummary = formatValidationSummary(
            selectedModelingCountyRun?.validationSummary ?? null
          );

          function toggleRun(runId: string) {
            flowState.setValue(
              "runIds",
              flowState.values.runIds.includes(runId)
                ? flowState.values.runIds.filter((id) => id !== runId)
                : [...flowState.values.runIds, runId]
            );
          }

          return (
            <>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label
                    htmlFor={flowState.fieldProps("modelingCountyRunId").id}
                    className="text-[0.82rem] font-semibold"
                  >
                    Modeling evidence
                  </label>
                  {selectedModelingCountyRun?.claimStatus ? (
                    <span className="inline-flex items-center gap-1 text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      {modelingClaimStatusLabel(selectedModelingCountyRun.claimStatus)}
                    </span>
                  ) : (
                    <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Optional
                    </span>
                  )}
                </div>
                <select {...flowState.text("modelingCountyRunId")} className={SELECT_CLASS}>
                  <option value="">Do not attach modeling evidence</option>
                  {availableModelingCountyRuns.map((run) => (
                    <option key={run.id} value={run.id}>
                      {formatModelingRunOptionText(run)}
                    </option>
                  ))}
                </select>
                {selectedModelingCountyRun ? (
                  <div className="rounded-[0.5rem] border border-border/70 bg-muted/25 px-4 py-3 text-sm">
                    <p className="font-medium text-foreground">
                      {selectedModelingCountyRun.geographyLabel ?? "County run"} ·{" "}
                      {selectedModelingCountyRun.stage ?? "stage not recorded"}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {selectedModelingCountyRun.statusReason ??
                        "No structured assignment claim decision is recorded for this run yet."}
                      {selectedValidationSummary ? ` Validation: ${selectedValidationSummary}.` : ""}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {availableModelingCountyRuns.length > 0
                      ? "Choose the county-run evidence this packet should cite, or leave it unattached when the report should not make assignment-model claims."
                      : "No county-run modeling evidence is available for this project workspace yet."}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[0.82rem] font-semibold">Linked analysis runs</p>
                  <span className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {flowState.values.runIds.length} selected
                  </span>
                </div>
                <div
                  {...flowState.fieldProps("runIds")}
                  tabIndex={-1}
                  className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-border/70 bg-background/70 p-2.5 outline-none"
                >
                  {availableRuns.length === 0 ? (
                    <p className="px-2 py-3 text-center text-sm text-muted-foreground">
                      No runs available for the selected project.
                    </p>
                  ) : (
                    availableRuns.map((run) => {
                      const isSelected = flowState.values.runIds.includes(run.id);
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
            </>
          );
        },
      },
    ],
    onSubmit: async (values) => {
      const project = projects.find((entry) => entry.id === values.projectId) ?? null;
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          projectId: values.projectId,
          // A blank title sends the suggested one, never an empty string the
          // API would refuse — this is the promise the hint above makes.
          title:
            values.title.trim() ||
            (project ? defaultReportTitle(project.name, values.reportType) : values.title),
          summary: values.summary,
          reportType: values.reportType,
          runIds: values.runIds,
          ...(values.modelingCountyRunId
            ? { modelingCountyRunId: values.modelingCountyRunId }
            : {}),
        }),
      });

      const payload = (await response.json()) as CreateResponse & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Failed to create report");
      }

      // After the await, so the sheet closes before the page moves under it.
      router.refresh();
      router.push(withPlanningContext(`/reports/${payload.reportId}`, values.projectId));
    },
  });

  return (
    <article className="rounded-[0.75rem] border border-border/70 bg-card/90 p-6 shadow-[0_24px_60px_rgba(4,12,20,0.08)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.5rem] bg-amber-500/12 text-amber-700 dark:text-amber-300">
            <FilePlus2 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Create
            </p>
            <h2 className="text-xl font-semibold tracking-tight">New report packet</h2>
          </div>
        </div>
        {projects.length > 0 ? (
          <Button type="button" onClick={flow.open}>
            <FilePlus2 className="mr-1.5 h-4 w-4" />
            New report
          </Button>
        ) : null}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        A report packet is one place to put what you decided and what backs it up. Answer three
        questions and it opens with its sections already set up.
      </p>

      {projects.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No projects available"
            description="Create a project before opening a report packet. Reports stay tied to project records and workspace audit history."
            compact
          />
        </div>
      ) : null}

      <GuidedFlow flow={flow} />
    </article>
  );
}
