import { Clock3, Hash, Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { getManagedRunModeDefinition } from "@/lib/models/run-modes";
import { formatDateTime, titleize } from "@/lib/reports/catalog";
import type { LinkedRunRow, ReportArtifact, ReportSectionRow, TypedRunCitation } from "./_types";

type Props = {
  reportId: string;
  sectionList: ReportSectionRow[];
  enabledSectionsCount: number;
  runs: LinkedRunRow[];
  typedCitations?: TypedRunCitation[];
  artifactList: ReportArtifact[];
};

export function ReportCompositionAudit({
  reportId,
  sectionList,
  enabledSectionsCount,
  runs,
  typedCitations = [],
  artifactList,
}: Props) {
  return (
    <article className="module-section-surface space-y-6">
      {/* Sections */}
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.5rem] bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Composition
            </p>
            <h2 className="text-xl font-semibold tracking-tight">
              Packet sections
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                {enabledSectionsCount}/{sectionList.length} enabled
              </span>
            </h2>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {sectionList.map((section, index) => (
            <div
              key={section.id}
              className="flex items-center gap-3 rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3 transition-colors"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-card text-[0.7rem] font-semibold tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold tracking-tight">
                  {section.title}
                </h3>
                <p className="text-[0.68rem] uppercase tracking-[0.1em] text-muted-foreground">
                  {titleize(section.section_key)}
                </p>
              </div>
              <StatusBadge
                tone={section.enabled ? "success" : "neutral"}
                className="shrink-0"
              >
                {section.enabled ? "Enabled" : "Hidden"}
              </StatusBadge>
            </div>
          ))}
        </div>
      </div>

      {/* Linked runs */}
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.5rem] bg-sky-500/10 text-sky-700 dark:text-sky-300">
            <Hash className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Source data
            </p>
            <h2 className="text-xl font-semibold tracking-tight">Linked runs</h2>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {runs.length === 0 && typedCitations.length === 0 ? (
            <EmptyState
              title="No linked runs"
              description="Attach analysis runs when creating a report to include their results in the generated packet."
              compact
            />
          ) : (
            <>
              {runs.map((run) => (
                <div
                  key={run.id}
                  className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3"
                >
                  <h4 className="text-sm font-semibold tracking-tight">
                    {run.title}
                  </h4>
                  <p className="mt-1 line-clamp-2 text-[0.82rem] leading-relaxed text-muted-foreground">
                    {run.summary_text || "No run summary available."}
                  </p>
                  <p className="mt-2 text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                    Created {formatDateTime(run.created_at)}
                  </p>
                </div>
              ))}
              {typedCitations.map((citation) => (
                <div
                  key={citation.id}
                  className="rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <h4 className="text-sm font-semibold tracking-tight">
                      {citation.title}
                    </h4>
                    <StatusBadge tone="info" className="shrink-0">
                      {citation.kind === "model" ? "Model run" : "County run"}
                    </StatusBadge>
                  </div>
                  <p className="mt-2 text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                    {citation.kind === "model" && citation.engineKey
                      ? `${getManagedRunModeDefinition(citation.engineKey).engineLabel} · ${titleize(citation.status ?? "unknown")}`
                      : titleize(citation.status ?? "unknown")}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Artifact history */}
      <div>
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[0.5rem] bg-[color:var(--copper)]/10 text-[color:var(--copper)]">
            <Clock3 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              History
            </p>
            <h2 className="text-xl font-semibold tracking-tight">
              Generated artifacts
            </h2>
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {artifactList.length === 0 ? (
            <EmptyState
              title="No artifacts yet"
              description="Use the generation control to produce the first packet for this report."
              compact
            />
          ) : (
            artifactList.map((artifact) => (
              <div
                id={`artifact-${artifact.id}`}
                key={artifact.id}
                className="flex items-center justify-between gap-3 rounded-[0.5rem] border border-border/80 bg-background/80 px-4 py-3"
              >
                <div className="min-w-0">
                  <h4 className="text-sm font-semibold tracking-tight">
                    {artifact.artifact_kind.toUpperCase()} artifact
                  </h4>
                  <p className="text-[0.68rem] uppercase tracking-[0.12em] text-muted-foreground">
                    Generated {formatDateTime(artifact.generated_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  {/*
                    A real anchor, not a fetch: the download route answers with a
                    307 to a short-lived signed URL, and the browser has to be
                    the thing that follows it. Until this existed, a generated
                    PDF sat in private storage with no way to retrieve it.
                  */}
                  <a
                    className="text-xs font-medium underline underline-offset-2 hover:text-foreground"
                    href={`/api/reports/${reportId}/artifacts/${artifact.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download {artifact.artifact_kind.toUpperCase()}
                  </a>
                  <StatusBadge tone="info" className="shrink-0">
                    {artifact.id.slice(0, 8)}
                  </StatusBadge>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </article>
  );
}
