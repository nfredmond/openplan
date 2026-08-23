import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarClock, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/ui/state-block";
import { GrantsOpportunityRegistryCard } from "@/components/grants/grants-opportunity-registry-card";
import type { FundingOpportunityNarrativeDraftRow } from "@/components/grants/funding-opportunity-narrative-draft-panel";
import type { ProjectBcaScreeningSummary } from "@/lib/grants/bca-evidence";
import type { ProjectEngagementEvidence } from "@/lib/grants/engagement-evidence";
import type {
  ProjectGrantDualDemandAgreementEvidence,
  ProjectGrantModelingEvidence,
} from "@/lib/grants/modeling-evidence";
import {
  type DecisionFilter,
  type FundingOpportunityRow,
  type KindFilter,
  type StatusFilter,
  buildGrantsFilterHref,
  DECISION_FILTERS,
  formatFilterLabel,
  KIND_FILTERS,
  PURSUIT_KIND_LABELS,
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
  selectedKind = "all",
  showModelingCaveat,
  activeFocusedOpportunityId,
  projectGrantModelingEvidenceByProjectId,
  projectGrantDualDemandAgreementEvidenceByProjectId,
  latestBcaScreeningByProjectId,
  engagementEvidenceByProjectId,
  decisionCommandCallout,
  focusedOpportunityNarrativeDraft = null,
}: {
  filteredOpportunities: NormalizedOpportunity[];
  opportunitiesCount: number;
  selectedStatus: StatusFilter;
  selectedDecision: DecisionFilter;
  selectedKind?: KindFilter;
  showModelingCaveat: boolean;
  activeFocusedOpportunityId: string | null;
  projectGrantModelingEvidenceByProjectId: Map<string, ProjectGrantModelingEvidence>;
  projectGrantDualDemandAgreementEvidenceByProjectId: Map<string, ProjectGrantDualDemandAgreementEvidence>;
  latestBcaScreeningByProjectId: Map<string, ProjectBcaScreeningSummary>;
  engagementEvidenceByProjectId: Map<string, ProjectEngagementEvidence>;
  decisionCommandCallout: ReactNode | null;
  focusedOpportunityNarrativeDraft?: FundingOpportunityNarrativeDraftRow | null;
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
              Review deadlines, decision status, linked project/program context, and editable decision notes without hopping record-by-record first.
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
                href={buildGrantsFilterHref({ status, decision: selectedDecision, kind: selectedKind })}
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
                href={buildGrantsFilterHref({ status: selectedStatus, decision, kind: selectedKind })}
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
        <div className="flex flex-wrap gap-2">
          {KIND_FILTERS.map((kind) => {
            const active = kind === selectedKind;
            return (
              <Link
                key={`kind-${kind}`}
                href={buildGrantsFilterHref({ status: selectedStatus, decision: selectedDecision, kind })}
                className={[
                  "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                  active
                    ? "border-[color:var(--pine)] bg-[color:var(--pine)]/10 text-[color:var(--pine-deep)]"
                    : "border-border/70 bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground",
                ].join(" ")}
              >
                Pursuit: {kind === "all" ? "All" : PURSUIT_KIND_LABELS[kind]}
              </Link>
            );
          })}
        </div>
      </div>

      {showModelingCaveat ? (
        <p className="mt-3 text-sm text-muted-foreground">
          Within the same grant timing and decision status, opportunities with modeling support that appears decision-ready rise ahead of refresh-recommended, thin, or unsupported work. Treat that as planning support only, not proof of award likelihood or a replacement for funding-source review.
        </p>
      ) : null}

      {opportunitiesCount === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="No funding opportunities yet"
            description="Grants tracks the funding your agency pursues — which programs are open, what you decided about each, what you won, and what has been reimbursed. Add the first opportunity you are watching or pursuing."
            action={
              <a href="#grants-gap-resolution-lane" className="inline-flex items-center rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/40">
                Add a funding opportunity
              </a>
            }
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
              projectGrantDualDemandAgreementEvidence={
                opportunity.project?.id
                  ? projectGrantDualDemandAgreementEvidenceByProjectId.get(opportunity.project.id) ?? null
                  : null
              }
              latestBcaScreening={
                opportunity.project?.id
                  ? latestBcaScreeningByProjectId.get(opportunity.project.id) ?? null
                  : null
              }
              engagementEvidence={
                opportunity.project?.id
                  ? engagementEvidenceByProjectId.get(opportunity.project.id) ?? null
                  : null
              }
              latestNarrativeDraft={
                opportunity.id === activeFocusedOpportunityId ? focusedOpportunityNarrativeDraft : null
              }
            />
          ))}
        </div>
      )}
    </article>
  );
}
