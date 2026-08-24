"use client";

import * as React from "react";
import { Pencil, Play } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/state-block";
import { Textarea } from "@/components/ui/textarea";
import {
  GuidedFlow,
  GuidedFlowRow,
  useGuidedFlow,
  type GuidedFlowStep,
} from "@/components/ui/guided-flow";
import { ANALYSIS_QUERY_MAX_CHARS } from "@/lib/analysis/query";
import type { ReportTemplate } from "./_types";

type ProjectOption = { id: string; name: string };

type ExploreStudyBriefControlsProps = {
  queryText: string;
  isQueryTooLong: boolean;
  reportTemplate: ReportTemplate;
  canSubmit: boolean;
  /**
   * Why the run cannot start, or null when it can. Passed in rather than
   * re-derived here so the hint under the button and the wizard's own refusal
   * are the same sentence — they were once two, and they disagreed.
   */
  blockReason: string | null;
  /**
   * Ask whether a run could start with THIS question, right now. Takes the
   * question rather than reading state, so the sheet can judge what it has just
   * collected instead of what the workbench last rendered.
   */
  evaluateRunBlock: (queryText: string) => string | null;
  isSubmitting: boolean;
  analysisRunId: string | null;
  isGeneratingReport: boolean;
  isDownloadingPdf: boolean;
  error: string;
  /** Projects the run can be attributed to. Empty is normal in a new workspace. */
  projects?: ProjectOption[];
  selectedProjectId?: string;
  onSelectedProjectIdChange?: (value: string) => void;
  onQueryTextChange: (value: string) => void;
  onReportTemplateChange: (value: ReportTemplate) => void;
  onRunAnalysis: (queryText?: string) => Promise<void> | void;
  onGenerateReport: () => Promise<void> | void;
  onDownloadPdfReport: () => Promise<void> | void;
};

type BriefValues = {
  queryText: string;
  projectId: string;
  reportTemplate: ReportTemplate;
};

const TEMPLATE_LABEL: Record<ReportTemplate, string> = {
  atp: "ATP — Active Transportation Program",
  ss4a: "SS4A — Safe Streets and Roads for All",
};

/**
 * Setting up a corridor analysis: three questions instead of a permanently
 * open rail of controls.
 *
 * WHAT IS DELIBERATELY *NOT* IN THE FLOW. The corridor itself. A modal over the
 * map is the worst available shape for drawing on the map — it covers the thing
 * being described — so drawing stays on the page and this flow only asks what
 * the drawing is FOR. The flow will not even open until a corridor exists, and
 * the rail says so in words rather than just disabling a button.
 *
 * WHAT DID NOT CHANGE. `onRunAnalysis`, `onGenerateReport` and
 * `onDownloadPdfReport` are called exactly as before, with the same guards
 * (`canSubmit`, `isSubmitting`, `analysisRunId`), and the query still travels
 * through `onQueryTextChange` so the workbench remains the one owner of it.
 */
export function ExploreStudyBriefControls({
  queryText,
  isQueryTooLong,
  reportTemplate,
  canSubmit,
  blockReason,
  evaluateRunBlock,
  isSubmitting,
  analysisRunId,
  isGeneratingReport,
  isDownloadingPdf,
  error,
  projects = [],
  selectedProjectId = "",
  onSelectedProjectIdChange,
  onQueryTextChange,
  onReportTemplateChange,
  onRunAnalysis,
  onGenerateReport,
  onDownloadPdfReport,
}: ExploreStudyBriefControlsProps) {
  const steps = React.useMemo<GuidedFlowStep<BriefValues>[]>(
    () => [
      {
        id: "question",
        title: "What do you want to know about this corridor?",
        hint: "Write it as a question a colleague would understand. The analysis answers this, and the report repeats it back.",
        fields: [
          {
            name: "queryText",
            label: "a question",
            required: true,
            requiredMessage: "Write the question you want answered before you run the analysis.",
          },
        ],
        check: (values) =>
          values.queryText.length > ANALYSIS_QUERY_MAX_CHARS
            ? {
                field: "queryText",
                message: `That is ${values.queryText.length} characters and the limit is ${ANALYSIS_QUERY_MAX_CHARS}. Shorten it and run again.`,
              }
            : null,
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="queryText" label="Your question">
              <Textarea
                {...flow.text("queryText")}
                placeholder="Example: Evaluate transit accessibility, safety risk, and equity implications for this corridor."
                rows={5}
                maxLength={ANALYSIS_QUERY_MAX_CHARS}
              />
            </GuidedFlowRow>
            <p className="text-[0.78rem] text-muted-foreground">
              {String(flow.values.queryText).length} of {ANALYSIS_QUERY_MAX_CHARS} characters used.
            </p>
          </>
        ),
      },
      {
        id: "project",
        title: "Which project is this for?",
        hint: "Optional. Attaching it means the run shows up on that project's page instead of only here.",
        fields: [{ name: "projectId", label: "a project" }],
        render: (flow) => (
          <GuidedFlowRow flow={flow} name="projectId" label="Project">
            <select className="module-select" {...flow.text("projectId")}>
              <option value="">Not attached to a project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            {projects.length === 0 ? (
              <p className="text-[0.78rem] text-muted-foreground">
                This workspace has no projects yet, so there is nothing to attach it to. The run is
                still saved here.
              </p>
            ) : null}
          </GuidedFlowRow>
        ),
      },
      {
        id: "template",
        // "program", not "programme": the option labels directly beneath this
        // sentence are the funders' own names — "Active Transportation Program",
        // "Safe Streets and Roads for All" — and two spellings of the same word
        // on one screen reads as a mistake to the planner who has to trust it.
        title: "Which program should the report be written for?",
        hint: "This only changes how the written report is framed. The analysis itself is the same either way.",
        fields: [{ name: "reportTemplate", label: "a report template" }],
        render: (flow) => (
          <>
            <GuidedFlowRow flow={flow} name="reportTemplate" label="Report style">
              <select className="module-select" {...flow.text("reportTemplate")}>
                <option value="atp">{TEMPLATE_LABEL.atp}</option>
                <option value="ss4a">{TEMPLATE_LABEL.ss4a}</option>
              </select>
            </GuidedFlowRow>
            <div className="rounded-[0.5rem] border border-border/70 bg-muted/25 p-3 text-sm">
              <p className="font-semibold">Ready to run</p>
              <p className="mt-1 text-muted-foreground">
                Asking: “{String(flow.values.queryText).trim() || "—"}”
              </p>
              <p className="mt-1 text-muted-foreground">
                Report style: {TEMPLATE_LABEL[flow.values.reportTemplate]}
              </p>
              <p className="mt-1 text-muted-foreground">
                This uses the corridor you drew on the map. It takes a moment.
              </p>
            </div>
          </>
        ),
      },
    ],
    [projects]
  );

  const flow = useGuidedFlow<BriefValues>({
    id: "corridor-analysis-brief",
    title: "Set up the analysis",
    submitLabel: "Run the analysis",
    initialValues: { queryText: "", projectId: "", reportTemplate: "atp" },
    steps,
    onSubmit: async (values) => {
      // The workbench owns all three values; the flow only collects them. They
      // are handed over BEFORE the run so the request and the rail agree about
      // what was asked, even if the run fails.
      onQueryTextChange(values.queryText);
      onSelectedProjectIdChange?.(values.projectId);
      onReportTemplateChange(values.reportTemplate);

      /*
        JUDGE THE VALUES THIS SHEET COLLECTED, not the props from the last render.

        `canSubmit` and `blockReason` are computed by the workbench from ITS
        state, and the line above has only just handed the question over —
        React has not re-rendered, so both props still describe a workbench that
        has never seen it. Reading them here made the FIRST submit always
        conclude the question was empty, refuse with "write the question" while
        the question sat visibly in the sheet, and then succeed on the second
        click once the state had caught up. Two testers hit it independently and
        both described the error as contradicting the summary directly above it.

        Yesterday's fix, which made the refusal name the missing input, made this
        WORSE rather than better: the sentence became specific about something
        that was not true. An accurate description of stale state is still wrong.
      */
      const blockedNow = evaluateRunBlock(values.queryText);
      if (blockedNow) {
        // Belt to the disabled trigger's braces: the study area can be cleared
        // from the map while the sheet is open. The reason comes from the same
        // function the hint below uses, so the two cannot name different
        // missing things — which is exactly how a planner was once told to draw
        // an area they had already set.
        return blockedNow;
      }
      await onRunAnalysis(values.queryText);
    },
  });

  const openBrief = () => {
    flow.openWith({ queryText, projectId: selectedProjectId, reportTemplate });
  };

  const hasQuestion = queryText.trim().length > 0;

  return (
    <section className="analysis-studio-surface">
      <div className="analysis-studio-header">
        <div className="analysis-studio-heading">
          <p className="analysis-studio-label">Study brief</p>
          <h3 className="analysis-studio-title">What are you asking about this corridor?</h3>
          <p className="analysis-studio-description">
            Draw the corridor on the map, then set up the question you want answered. The report is
            written from that question.
          </p>
        </div>
      </div>

      <div className="analysis-studio-body">
        <div className="analysis-sidepanel-row is-muted">
          <div className="analysis-sidepanel-head">
            <div className="analysis-sidepanel-main">
              <p className="analysis-sidepanel-title">
                {hasQuestion ? "Your question" : "No question set yet"}
              </p>
              <p className="analysis-sidepanel-body">
                {hasQuestion
                  ? queryText
                  : "Press Set up the analysis and write what you want to know."}
              </p>
              <p className="analysis-studio-note">
                Report style: {TEMPLATE_LABEL[reportTemplate]}
              </p>
              {isQueryTooLong ? (
                <p className="text-[0.72rem] text-destructive">
                  That question is too long to run. Open the setup and shorten it.
                </p>
              ) : null}
            </div>
            <div className="analysis-sidepanel-actions">
              <Button type="button" size="sm" variant="outline" onClick={openBrief}>
                <Pencil className="mr-1.5 h-4 w-4" />
                {hasQuestion ? "Change the question" : "Set up the analysis"}
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            className="w-full"
            onClick={() => void onRunAnalysis()}
            disabled={!canSubmit || isSubmitting}
          >
            <Play className="mr-1.5 h-4 w-4" />
            {isSubmitting ? "Running analysis..." : "Run Analysis"}
          </Button>
          {!canSubmit && !isSubmitting ? (
            <p className="analysis-studio-note">{blockReason}</p>
          ) : null}
          {analysisRunId ? (
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => void onGenerateReport()}
                disabled={isGeneratingReport}
              >
                {isGeneratingReport ? "Generating..." : `${reportTemplate.toUpperCase()} Report`}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="flex-1"
                onClick={() => void onDownloadPdfReport()}
                disabled={isDownloadingPdf}
              >
                {isDownloadingPdf ? "Preparing..." : "PDF"}
              </Button>
            </div>
          ) : null}
        </div>

        {error ? <ErrorState compact title="Please review" description={error} /> : null}
      </div>

      <GuidedFlow flow={flow} />
    </section>
  );
}
