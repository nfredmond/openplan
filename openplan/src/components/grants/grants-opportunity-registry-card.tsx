import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FundingOpportunityDecisionControls } from "@/components/programs/funding-opportunity-decision-controls";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  formatFundingOpportunityDecisionLabel,
  formatFundingOpportunityStatusLabel,
  fundingOpportunityDecisionTone,
  fundingOpportunityStatusTone,
} from "@/lib/programs/catalog";
import {
  buildGrantDecisionModelingSupport,
  describeProjectGrantModelingReadiness,
  type ProjectGrantModelingEvidence,
} from "@/lib/grants/modeling-evidence";
import {
  type FundingOpportunityRow,
  formatCurrency,
  formatDateTime,
  isClosingSoon,
  isDecisionSoon,
} from "@/lib/grants/page-helpers";

type NormalizedOpportunity = FundingOpportunityRow & {
  program: { id: string; title: string; funding_classification: string | null } | null;
  project: { id: string; name: string } | null;
};

export function GrantsOpportunityRegistryCard({
  opportunity,
  activeFocusedOpportunityId,
  projectGrantModelingEvidence,
}: {
  opportunity: NormalizedOpportunity;
  activeFocusedOpportunityId: string | null;
  projectGrantModelingEvidence: ProjectGrantModelingEvidence | null;
}) {
  const projectHref = opportunity.project
    ? `/projects/${opportunity.project.id}#project-funding-opportunities`
    : null;
  const programHref = opportunity.program
    ? `/programs/${opportunity.program.id}#program-funding-opportunities`
    : null;
  const closesSoon = isClosingSoon(opportunity.closes_at);
  const decisionSoon = isDecisionSoon(opportunity.decision_due_at);
  const modelingReadiness = describeProjectGrantModelingReadiness(projectGrantModelingEvidence);
  const decisionModelingSupport = buildGrantDecisionModelingSupport(
    projectGrantModelingEvidence,
    opportunity.project?.name ?? null
  );
  const isFocused =
    activeFocusedOpportunityId === opportunity.id && opportunity.opportunity_status !== "awarded";

  return (
    <div
      id={`funding-opportunity-${opportunity.id}`}
      className={`module-record-row scroll-mt-24 ${
        isFocused
          ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]"
          : ""
      }`}
    >
      <div className="module-record-main">
        <div className="module-record-kicker">
          <StatusBadge tone={fundingOpportunityStatusTone(opportunity.opportunity_status)}>
            {formatFundingOpportunityStatusLabel(opportunity.opportunity_status)}
          </StatusBadge>
          <StatusBadge tone={fundingOpportunityDecisionTone(opportunity.decision_state)}>
            {formatFundingOpportunityDecisionLabel(opportunity.decision_state)}
          </StatusBadge>
          {isFocused ? <StatusBadge tone="info">Focused from workspace queue</StatusBadge> : null}
          {closesSoon ? <StatusBadge tone="warning">Closing soon</StatusBadge> : null}
          {decisionSoon ? <StatusBadge tone="warning">Decision due soon</StatusBadge> : null}
          {projectGrantModelingEvidence ? <StatusBadge tone="info">Modeling-backed</StatusBadge> : null}
          {opportunity.program ? <StatusBadge tone="info">{opportunity.program.title}</StatusBadge> : null}
        </div>

        <div className="space-y-1.5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h3 className="module-record-title">{opportunity.title}</h3>
            <p className="module-record-stamp">Updated {formatDateTime(opportunity.updated_at)}</p>
          </div>
          <p className="module-record-summary">
            {opportunity.summary || "No summary recorded yet for this funding opportunity."}
          </p>
        </div>

        <div className="module-record-meta">
          <span className="module-record-chip">Agency {opportunity.agency_name ?? "Not set"}</span>
          <span className="module-record-chip">Owner {opportunity.owner_label ?? "Unassigned"}</span>
          <span className="module-record-chip">Cadence {opportunity.cadence_label ?? "Not set"}</span>
          <span className="module-record-chip">Likely {formatCurrency(opportunity.expected_award_amount)}</span>
          <span className="module-record-chip">Opens {formatDateTime(opportunity.opens_at)}</span>
          <span className="module-record-chip">Closes {formatDateTime(opportunity.closes_at)}</span>
          <span className="module-record-chip">Decision due {formatDateTime(opportunity.decision_due_at)}</span>
          <span className="module-record-chip">Project {opportunity.project?.name ?? "Not linked"}</span>
          {projectGrantModelingEvidence ? (
            <>
              <span className="module-record-chip">
                Modeling {projectGrantModelingEvidence.leadComparisonReport.comparisonDigest.headline}
              </span>
              {modelingReadiness ? (
                <span className="module-record-chip">{modelingReadiness.label}</span>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground">Fit notes</p>
            <p className="mt-2">{opportunity.fit_notes || "No fit notes recorded yet."}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground">Readiness notes</p>
            <p className="mt-2">{opportunity.readiness_notes || "No readiness notes recorded yet."}</p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/70 px-4 py-3 text-sm text-muted-foreground">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-foreground">Decision rationale</p>
            <p className="mt-2">{opportunity.decision_rationale || "No decision rationale recorded yet."}</p>
          </div>
        </div>

        {projectGrantModelingEvidence ? (
          <div className="module-note mt-4 text-sm">
            <p className="font-semibold text-foreground">Project modeling evidence</p>
            <p className="mt-1 text-muted-foreground">
              {modelingReadiness?.detail ??
                `Saved comparison context from ${projectGrantModelingEvidence.leadComparisonReport.title} can support readiness and prioritization language for this opportunity. ${projectGrantModelingEvidence.leadComparisonReport.comparisonDigest.detail}`}{" "}
              Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {modelingReadiness ? (
                <StatusBadge tone={modelingReadiness.tone}>{modelingReadiness.label}</StatusBadge>
              ) : null}
              <StatusBadge tone={projectGrantModelingEvidence.leadComparisonReport.packetFreshness.tone}>
                {projectGrantModelingEvidence.leadComparisonReport.packetFreshness.label}
              </StatusBadge>
              <StatusBadge tone="neutral">
                {projectGrantModelingEvidence.leadComparisonReport.comparisonAggregate.readyComparisonSnapshotCount} ready comparison
                {projectGrantModelingEvidence.leadComparisonReport.comparisonAggregate.readyComparisonSnapshotCount === 1 ? "" : "s"}
              </StatusBadge>
              <StatusBadge tone="neutral">
                {projectGrantModelingEvidence.leadComparisonReport.comparisonAggregate.indicatorDeltaCount} indicator delta
                {projectGrantModelingEvidence.leadComparisonReport.comparisonAggregate.indicatorDeltaCount === 1 ? "" : "s"}
              </StatusBadge>
              {projectGrantModelingEvidence.comparisonBackedCount > 1 ? (
                <StatusBadge tone="neutral">
                  {projectGrantModelingEvidence.comparisonBackedCount} comparison-backed packets
                </StatusBadge>
              ) : null}
            </div>
          </div>
        ) : null}

        {projectHref || programHref || projectGrantModelingEvidence ? (
          <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
            {projectGrantModelingEvidence ? (
              <Link
                href={projectGrantModelingEvidence.leadComparisonReport.href}
                className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]"
              >
                Open supporting packet
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
            {projectHref ? (
              <Link
                href={projectHref}
                className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]"
              >
                Open project funding lane
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
            {programHref ? (
              <Link
                href={programHref}
                className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]"
              >
                Open program funding lane
                <ArrowRight className="h-4 w-4" />
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4">
          <FundingOpportunityDecisionControls
            opportunityId={opportunity.id}
            initialDecisionState={opportunity.decision_state}
            initialExpectedAwardAmount={opportunity.expected_award_amount}
            initialFitNotes={opportunity.fit_notes}
            initialReadinessNotes={opportunity.readiness_notes}
            initialDecisionRationale={opportunity.decision_rationale}
            modelingSupport={decisionModelingSupport}
          />
        </div>
      </div>
    </div>
  );
}
