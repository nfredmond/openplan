"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatRunTimestamp, formatSourceToken } from "./_helpers";
import type { AnalysisResult } from "./_types";
import type { GeospatialSourceCard, PlanningSignal } from "./explore-results-types";

type ExploreGeospatialBriefingProps = {
  planningSignals: PlanningSignal[];
  geospatialSourceCards: GeospatialSourceCard[];
  sourceSnapshots: AnalysisResult["metrics"]["sourceSnapshots"];
};

export function ExploreGeospatialBriefing({
  planningSignals,
  geospatialSourceCards,
  sourceSnapshots,
}: ExploreGeospatialBriefingProps) {
  return (
    <Card className="analysis-explore-surface">
      <CardHeader className="gap-3 border-b border-white/8 px-6 py-5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="neutral">Supporting briefing</StatusBadge>
          <StatusBadge tone="info">Corridor context</StatusBadge>
        </div>
        <div className="space-y-2">
          <CardTitle className="text-[1.02rem] font-semibold tracking-[-0.02em] text-white">Geospatial Intelligence Briefing</CardTitle>
          <CardDescription className="max-w-xl text-sm leading-6 text-slate-300/76">
            Real corridor-context signals and source posture for planning, grant, and engagement workflows.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 px-6 py-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {planningSignals.map((signal) => (
            <div key={signal.label} className="rounded-[0.5rem] border border-border/80 bg-background p-3.5 shadow-[0_8px_24px_rgba(15,23,42,0.04)]">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{signal.label}</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{signal.value}</p>
              <p className="mt-2 text-xs text-muted-foreground">{signal.note}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <div className="rounded-[0.75rem] border border-border/80 bg-[linear-gradient(180deg,rgba(11,19,27,0.98),rgba(15,24,33,0.94))] p-5 text-slate-100 shadow-[0_20px_48px_rgba(0,0,0,0.16)]">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-cyan-200/80">Data fabric status</p>
            <div className="mt-4 space-y-3">
              {geospatialSourceCards.map((item) => (
                <div key={item.label} className="rounded-[0.5rem] border border-white/10 bg-white/[0.04] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium text-white">{item.label}</p>
                    <StatusBadge tone={item.tone}>{item.status}</StatusBadge>
                  </div>
                  <p className="mt-2 text-xs text-slate-300/82">{item.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[0.75rem] border border-border/80 bg-background p-5 shadow-[0_12px_36px_rgba(15,23,42,0.06)]">
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Citations & next geospatial lanes</p>
            <div className="mt-4 space-y-3">
              <div className="rounded-[0.5rem] border border-border/80 bg-card p-3.5">
                <p className="text-sm font-medium text-foreground">Census retrieval</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {sourceSnapshots?.census?.retrievalUrl ?? "Census retrieval URL not captured for this run."}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Fetched: {sourceSnapshots?.census?.fetchedAt ? formatRunTimestamp(sourceSnapshots.census.fetchedAt) : "Unknown"}
                </p>
              </div>
              <div className="rounded-[0.5rem] border border-border/80 bg-card p-3.5">
                <p className="text-sm font-medium text-foreground">Crash lane posture</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Current crash source: {formatSourceToken(sourceSnapshots?.crashes?.source)}.
                  {sourceSnapshots?.crashes?.source !== "switrs-local"
                    ? " SWITRS remains the preferred California-grade upgrade path for richer safety layers."
                    : " SWITRS-backed safety coverage is active for this corridor run."}
                </p>
              </div>
              <div className="rounded-[0.5rem] border border-border/80 bg-card p-3.5">
                <p className="text-sm font-medium text-foreground">Next layer buildout</p>
                <ul className="mt-2 list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
                  <li>Census tract geometry + choropleth overlays</li>
                  <li>SWITRS collision point layer + severity filters</li>
                  <li>Project and engagement overlays tied into the workspace</li>
                  <li>CARTO workflow lane for derived spatial products and scheduled refreshes</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
