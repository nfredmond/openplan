import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ProjectFundingAwardCreator } from "@/components/projects/project-funding-award-creator";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatFundingOpportunityDecisionLabel } from "@/lib/programs/catalog";
import {
  type FundingOpportunityRow,
  formatCurrency,
  formatDateTime,
} from "@/lib/grants/page-helpers";

type AwardedOpportunity = FundingOpportunityRow & {
  program: { id: string; title: string; funding_classification: string | null } | null;
  project: { id: string; name: string } | null;
};

export function GrantsAwardConversionSection({
  awardedOpportunitiesMissingRecords,
  awardConversionOpportunity,
  activeFocusedOpportunityId,
  awardCommandCallout,
}: {
  awardedOpportunitiesMissingRecords: AwardedOpportunity[];
  awardConversionOpportunity: AwardedOpportunity | null;
  activeFocusedOpportunityId: string | null;
  awardCommandCallout: ReactNode | null;
}) {
  return (
    <article id="grants-award-conversion-lane" className="module-section-surface">
      {awardCommandCallout}
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Award conversion</p>
          <h2 className="module-section-title">Awarded opportunities still missing committed award records</h2>
          <p className="module-section-description">
            This is the downstream grants seam that closes the gap between an opportunity marked awarded and the actual award record needed for reimbursement and invoice truth.
          </p>
        </div>
        <StatusBadge tone={awardedOpportunitiesMissingRecords.length > 0 ? "warning" : "success"}>
          {awardedOpportunitiesMissingRecords.length > 0 ? `${awardedOpportunitiesMissingRecords.length} missing` : "Award records current"}
        </StatusBadge>
      </div>

      {awardConversionOpportunity ? (
        <div
          id="grants-award-conversion-composer"
          className={`mt-5 scroll-mt-24 rounded-3xl ${
            activeFocusedOpportunityId === awardConversionOpportunity.id
              ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]"
              : ""
          }`}
        >
          {activeFocusedOpportunityId === awardConversionOpportunity.id ? (
            <div className="mb-3 rounded-2xl border border-sky-300/70 bg-sky-50/80 px-4 py-3 text-sm text-sky-950 dark:border-sky-700/60 dark:bg-sky-950/25 dark:text-sky-100">
              <p className="font-semibold tracking-tight">Focused from workspace queue</p>
              <p className="mt-1">This award conversion creator is pre-targeted to {awardConversionOpportunity.title} so the grants command board can record the exact committed award it flagged next.</p>
            </div>
          ) : null}
          <ProjectFundingAwardCreator
            projectId={awardConversionOpportunity.project?.id ?? ""}
            opportunityOptions={[{ id: awardConversionOpportunity.id, title: awardConversionOpportunity.title }]}
            defaultOpportunityId={awardConversionOpportunity.id}
            defaultProgramId={awardConversionOpportunity.program?.id ?? null}
            defaultTitle={`${awardConversionOpportunity.title} award`}
            titleLabel="Create the lead award record now"
            description={`Convert ${awardConversionOpportunity.title} into a committed award record here so reimbursement and invoice truth can start from the shared grants lane.`}
          />
        </div>
      ) : null}

      <div className="mt-5 grid gap-3">
        {awardedOpportunitiesMissingRecords.length > 0 ? (
          awardedOpportunitiesMissingRecords.map((opportunity) => {
            const projectHref = opportunity.project ? `/projects/${opportunity.project.id}#project-funding-opportunities` : null;
            const programHref = opportunity.program ? `/programs/${opportunity.program.id}#program-funding-opportunities` : null;

            return (
              <div
                key={`award-gap-${opportunity.id}`}
                id={`award-opportunity-${opportunity.id}`}
                className={`module-subpanel scroll-mt-24 ${
                  activeFocusedOpportunityId === opportunity.id
                    ? "ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]"
                    : ""
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap gap-2">
                      <StatusBadge tone="warning">Award record missing</StatusBadge>
                      {activeFocusedOpportunityId === opportunity.id ? <StatusBadge tone="info">Focused from workspace queue</StatusBadge> : null}
                      {opportunity.project ? <StatusBadge tone="info">{opportunity.project.name}</StatusBadge> : null}
                      {opportunity.program ? <StatusBadge tone="info">{opportunity.program.title}</StatusBadge> : null}
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-foreground">{opportunity.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {opportunity.summary || "This opportunity is marked awarded, but the committed award record has not been logged yet."}
                    </p>
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-semibold text-foreground">{formatCurrency(opportunity.expected_award_amount)}</p>
                    <p className="text-muted-foreground">Likely award</p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2 text-sm text-muted-foreground">
                  <span className="module-inline-item">Updated {formatDateTime(opportunity.updated_at)}</span>
                  <span className="module-inline-item">Decision {formatFundingOpportunityDecisionLabel(opportunity.decision_state)}</span>
                  <span className="module-inline-item">Agency {opportunity.agency_name ?? "Not set"}</span>
                </div>

                <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
                  {projectHref ? (
                    <Link href={projectHref} className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]">
                      Open project award lane
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  ) : null}
                  {programHref ? (
                    <Link href={programHref} className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]">
                      Open program funding lane
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  ) : null}
                  {!projectHref ? (
                    <span className="text-muted-foreground">
                      Link this opportunity to a project before recording the committed award.
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })
        ) : (
          <div className="module-subpanel text-sm text-muted-foreground">
            No awarded opportunities are currently missing committed award records in this workspace.
          </div>
        )}
      </div>
    </article>
  );
}
