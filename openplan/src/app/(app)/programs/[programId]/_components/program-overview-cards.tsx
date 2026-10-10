import { FolderKanban, ShieldCheck } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { StateBlock } from "@/components/ui/state-block";
import {
  formatFiscalWindow,
  formatProgramDateTime,
  formatProgramFundingClassificationLabel,
  type ProgramReadinessSummary,
  type ProgramWorkflowSummary,
} from "@/lib/programs/catalog";

/**
 * The two cards on the program record's Overview tab. They live here only to
 * keep the page under its line limit; the page still owns every read and
 * decides whether the readiness basis can be trusted.
 */

/**
 * Readiness checks and the workflow verdict.
 *
 * Both are computed from the program's linked records. When any of those reads
 * failed, `basisUnreadable` withholds the checklist and the verdict, because a
 * missing check would describe the failed read and not the package.
 */
export function ProgramReadinessCard({
  readiness,
  workflow,
  basisUnreadable,
}: {
  readiness: ProgramReadinessSummary;
  workflow: ProgramWorkflowSummary;
  basisUnreadable: boolean;
}) {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Readiness</p>
          <h2 className="module-section-title">Package basis and timing</h2>
          <p className="module-section-description">
            {basisUnreadable
              ? "Package posture is withheld on this page load — see the disclosure at the top of the page."
              : workflow.packageDetail}
          </p>
        </div>
        <span className="module-inline-item">
          <ShieldCheck className="h-3.5 w-3.5" />
          {basisUnreadable ? "Readiness unavailable" : readiness.label}
        </span>
      </div>

      {basisUnreadable ? (
        <div className="mt-5">
          <StateBlock
            tone="danger"
            title="Readiness cannot be assessed right now"
            description="Part of this program's linked basis could not be read, and every check below is derived from those links. They are withheld rather than shown as gaps you would then go and try to fill — a missing check here would be a fact about the failed read, not about the package."
            compact
          />
        </div>
      ) : (
        <>
          <div className="mt-5 space-y-3">
            {readiness.checks.map((check) => (
              <div key={check.key} className="rounded-[0.5rem] border border-border/70 bg-background/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{check.label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{check.detail}</p>
                  </div>
                  <StatusBadge tone={check.ready ? "success" : "warning"}>{check.ready ? "Ready" : "Missing"}</StatusBadge>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-[0.5rem] border border-border/70 bg-background/80 p-4">
            <p className="text-label font-semibold text-muted-foreground">Workflow summary</p>
            <p className="mt-2 text-base font-semibold text-foreground">{workflow.label}</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{workflow.reason}</p>
            <div className="mt-4 space-y-2">
              {workflow.actionItems.length > 0 ? (
                workflow.actionItems.map((item) => (
                  <div key={item} className="rounded-xl border border-border/60 bg-card px-3 py-2 text-sm text-muted-foreground">
                    {item}
                  </div>
                ))
              ) : (
                <div className="rounded-xl border border-border/60 bg-card px-3 py-2 text-sm text-muted-foreground">
                  No immediate action items surfaced by the current metadata and linked records.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </article>
  );
}

/** Cycle identity and timing, straight from the program row. */
export function ProgramCycleMetadataCard({
  program,
  linkedProjectCount,
}: {
  program: {
    funding_classification: string | null;
    sponsor_agency: string | null;
    owner_label: string | null;
    cadence_label: string | null;
    fiscal_year_start: number | null;
    fiscal_year_end: number | null;
    nomination_due_at: string | null;
    adoption_target_at: string | null;
    created_at: string | null;
    updated_at: string | null;
  };
  linkedProjectCount: number;
}) {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Identity</p>
          <h2 className="module-section-title">Cycle metadata</h2>
          <p className="module-section-description">Timing and package posture that should travel with the funding record.</p>
        </div>
        <span className="module-inline-item">
          <FolderKanban className="h-3.5 w-3.5" />
          <strong>{linkedProjectCount}</strong> project link{linkedProjectCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-[0.5rem] border border-border/70 bg-background/80 px-4 py-3">
          <p className="text-label font-semibold text-muted-foreground">Funding classification</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {formatProgramFundingClassificationLabel(program.funding_classification)}
          </p>
        </div>
        <div className="rounded-[0.5rem] border border-border/70 bg-background/80 px-4 py-3">
          <p className="text-label font-semibold text-muted-foreground">Sponsor</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{program.sponsor_agency || "Not set"}</p>
        </div>
        <div className="rounded-[0.5rem] border border-border/70 bg-background/80 px-4 py-3">
          <p className="text-label font-semibold text-muted-foreground">Owner</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{program.owner_label || "Unassigned"}</p>
        </div>
        <div className="rounded-[0.5rem] border border-border/70 bg-background/80 px-4 py-3">
          <p className="text-label font-semibold text-muted-foreground">Cadence</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{program.cadence_label || "Not set"}</p>
        </div>
        <div className="rounded-[0.5rem] border border-border/70 bg-background/80 px-4 py-3">
          <p className="text-label font-semibold text-muted-foreground">Fiscal window</p>
          <p className="mt-1 text-sm font-semibold text-foreground">
            {formatFiscalWindow(program.fiscal_year_start, program.fiscal_year_end)}
          </p>
        </div>
        <div className="rounded-[0.5rem] border border-border/70 bg-background/80 px-4 py-3">
          <p className="text-label font-semibold text-muted-foreground">Nomination due</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{formatProgramDateTime(program.nomination_due_at)}</p>
        </div>
        <div className="rounded-[0.5rem] border border-border/70 bg-background/80 px-4 py-3">
          <p className="text-label font-semibold text-muted-foreground">Adoption target</p>
          <p className="mt-1 text-sm font-semibold text-foreground">{formatProgramDateTime(program.adoption_target_at)}</p>
        </div>
      </div>

      <div className="module-inline-list mt-5">
        <span className="module-inline-item">Created {formatProgramDateTime(program.created_at)}</span>
        <span className="module-inline-item">Updated {formatProgramDateTime(program.updated_at)}</span>
      </div>
    </article>
  );
}
