"use client";

import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/state-block";
import { Textarea } from "@/components/ui/textarea";
import { ANALYSIS_QUERY_MAX_CHARS } from "@/lib/analysis/query";
import type { ReportTemplate } from "./_types";

type ExploreStudyBriefControlsProps = {
  queryText: string;
  isQueryTooLong: boolean;
  reportTemplate: ReportTemplate;
  canSubmit: boolean;
  isSubmitting: boolean;
  analysisRunId: string | null;
  isGeneratingReport: boolean;
  isDownloadingPdf: boolean;
  error: string;
  onQueryTextChange: (value: string) => void;
  onReportTemplateChange: (value: ReportTemplate) => void;
  onRunAnalysis: () => Promise<void> | void;
  onGenerateReport: () => Promise<void> | void;
  onDownloadPdfReport: () => Promise<void> | void;
};

export function ExploreStudyBriefControls({
  queryText,
  isQueryTooLong,
  reportTemplate,
  canSubmit,
  isSubmitting,
  analysisRunId,
  isGeneratingReport,
  isDownloadingPdf,
  error,
  onQueryTextChange,
  onReportTemplateChange,
  onRunAnalysis,
  onGenerateReport,
  onDownloadPdfReport,
}: ExploreStudyBriefControlsProps) {
  return (
    <section className="analysis-studio-surface">
      <div className="analysis-studio-header">
        <div className="analysis-studio-heading">
          <p className="analysis-studio-label">Study brief</p>
          <h3 className="analysis-studio-title">Question and outputs</h3>
          <p className="analysis-studio-description">Frame the planning question, choose the reporting lane, then run or export the analysis from the same rail.</p>
        </div>
      </div>

      <div className="analysis-studio-body">
        <div className="analysis-studio-input-stack">
          <Textarea
            value={queryText}
            onChange={(event) => onQueryTextChange(event.target.value)}
            placeholder="Example: Evaluate transit accessibility, safety risk, and equity implications for this corridor."
            rows={4}
            maxLength={ANALYSIS_QUERY_MAX_CHARS}
          />
          <p className="analysis-studio-note">
            Query length: {queryText.length}/{ANALYSIS_QUERY_MAX_CHARS} characters.
          </p>
          {isQueryTooLong ? (
            <p className="text-[0.72rem] text-destructive">
              Trim the prompt before running analysis.
            </p>
          ) : null}
        </div>

        <div className="analysis-sidepanel-row is-muted">
          <div className="analysis-sidepanel-head">
            <div className="analysis-sidepanel-main">
              <p className="analysis-sidepanel-title">Report template</p>
              <p className="analysis-sidepanel-body">Keep the current grant or program framing visible while you generate HTML or PDF outputs.</p>
            </div>
            <div className="analysis-sidepanel-actions">
              <Button
                type="button"
                size="sm"
                variant={reportTemplate === "atp" ? "secondary" : "outline"}
                onClick={() => onReportTemplateChange("atp")}
              >
                ATP
              </Button>
              <Button
                type="button"
                size="sm"
                variant={reportTemplate === "ss4a" ? "secondary" : "outline"}
                onClick={() => onReportTemplateChange("ss4a")}
              >
                SS4A
              </Button>
            </div>
          </div>
          <p className="analysis-studio-note">Current template: {reportTemplate.toUpperCase()}</p>
        </div>

        <div className="space-y-2">
          <Button
            type="button"
            className="w-full"
            onClick={() => void onRunAnalysis()}
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting ? "Running analysis..." : "Run Analysis"}
          </Button>
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
    </section>
  );
}
