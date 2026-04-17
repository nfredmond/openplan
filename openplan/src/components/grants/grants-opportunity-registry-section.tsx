import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarClock, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/ui/state-block";
import { GrantsOpportunityRegistryCard } from "@/components/grants/grants-opportunity-registry-card";
import type { ProjectGrantModelingEvidence } from "@/lib/grants/modeling-evidence";
import {
  type DecisionFilter,
  type FundingOpportunityRow,
  type StatusFilter,
  buildGrantsFilterHref,
  DECISION_FILTERS,
  formatFilterLabel,
  STATUS_FILTERS,
} from "@/lib/grants/page-helpers";

type NormalizedOpportunity = FundingOpportunityRow & {
  program: { id: string; title: string; funding_classification: string | null } | null;
  project: { id: string; name: string } | null;
};

export function GrantsOpportunityRegistrySection({
  filteredOpportunities,
  opportunitiesCount,
  selectedStatus,
  selectedDecision,
  showModelingCaveat,
  activeFocusedOpportunityId,
  projectGrantModelingEvidenceByProjectId,
  decisionCommandCallout,
}: {
  filteredOpportunities: NormalizedOpportunity[];
  opportunitiesCount: number;
  selectedStatus: StatusFilter;
  selectedDecision: DecisionFilter;
  showModelingCaveat: boolean;
  activeFocusedOpportunityId: string | null;
  projectGrantModelingEvidenceByProjectId: Map<string, ProjectGrantModelingEvidence>;
  decisionCommandCallout: ReactNode | null;
}) {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div className="module-section-heading">
            <p className="module-section-label">Registry</p>
            <h2 className="module-section-title">Funding opportunities across the workspace</h2>
            <p className="module-section-description">
              Review deadlines, decision posture, linked project/program context, and editable decision notes without hopping record-by-record first.
            </p>
          </div>
        </div>
        <span className="module-inline-item">
          <Sparkles className="h-3.5 w-3.5" />
          <strong>{filteredOpportunities.length}</strong> shown
        </span>
      </div>

      {decisionCommandCallout}

      <div className="mt-5 flex flex-wrap gap-3">
        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((status) => {
            const active = status === selectedStatus;
            return (
              <Link
                key={`status-${status}`}
                href={buildGrantsFilterHref({ status, decision: selectedDecision })}
                className={[
                  "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                  active
                    ? "border-[color:var(--pine)] bg-[color:var(--pine)]/10 text-[color:var(--pine-deep)]"
                    : "border-border/70 bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground",
                ].join(" ")}
              >
                Status: {formatFilterLabel(status)}
              </Link>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          {DECISION_FILTERS.map((decision) => {
            const active = decision === selectedDecision;
            return (
              <Link
                key={`decision-${decision}`}
                href={buildGrantsFilterHref({ status: selectedStatus, decision })}
                className={[
                  "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                  active
                    ? "border-[color:var(--pine)] bg-[color:var(--pine)]/10 text-[color:var(--pine-deep)]"
                    : "border-border/70 bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground",
                ].join(" ")}
              >
                Decision: {formatFilterLabel(decision)}
              </Link>
            );
          })}
        </div>
      </div>

      {showModelingCaveat ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Within the same grant timing and decision posture, opportunities with modeling support that appears decision-ready rise ahead of refresh-recommended, thin, or unsupported work. Treat that as planning support only, not proof of award likelihood or a replacement for funding-source review.
        </p>
      ) : null}

      {opportunitiesCount === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No funding opportunities yet"
            description="Create the first funding opportunity so OpenPlan can start carrying real pursue, monitor, skip, award, and reimbursement posture in the shared workspace lane."
          />
        </div>
      ) : filteredOpportunities.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No opportunities match these filters"
            description="Try a broader status or decision filter to bring the workspace grants registry back into view."
          />
        </div>
      ) : (
        <div className="mt-5 module-record-list">
          {filteredOpportunities.map((opportunity) => (
            <GrantsOpportunityRegistryCard
              key={opportunity.id}
              opportunity={opportunity}
              activeFocusedOpportunityId={activeFocusedOpportunityId}
              projectGrantModelingEvidence={
                opportunity.project?.id
                  ? projectGrantModelingEvidenceByProjectId.get(opportunity.project.id) ?? null
                  : null
              }
            />
          ))}
        </div>
      )}
    </article>
  );
}
