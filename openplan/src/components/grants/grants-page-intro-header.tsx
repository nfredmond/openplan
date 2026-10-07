import type { ReactNode } from "react";
import { navLabel } from "@/components/nav/nav-registry";
import { PageHeader } from "@/components/ui/page-header";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

export function GrantsPageIntroHeader({
  scenarioComparisonIndicatorCount,
  scenarioComparisonReadyCount,
  scenarioComparisonProjectsWithSignal,
  trackedCount,
  openCount,
  pursueCount,
  closingSoonCount,
  awardedCount,
  distinctProjectCount,
  distinctProgramCount,
  monitorCount,
  skipCount,
  fundingAwardsCount,
  decisionReadyModelingCount,
  staleModelingCount,
  thinModelingCount,
  missingModelingCount,
  operationsSummary,
  workspaceCommandCallout,
}: {
  scenarioComparisonIndicatorCount: number;
  scenarioComparisonReadyCount: number;
  scenarioComparisonProjectsWithSignal: number;
  trackedCount: number;
  openCount: number;
  pursueCount: number;
  closingSoonCount: number;
  awardedCount: number;
  distinctProjectCount: number;
  distinctProgramCount: number;
  monitorCount: number;
  skipCount: number;
  fundingAwardsCount: number;
  decisionReadyModelingCount: number;
  staleModelingCount: number;
  thinModelingCount: number;
  missingModelingCount: number;
  operationsSummary: WorkspaceOperationsSummary;
  workspaceCommandCallout: ReactNode | null;
}) {
  const reimbursementFollowThrough =
    operationsSummary.counts.projectFundingReimbursementStartProjects +
    operationsSummary.counts.projectFundingReimbursementActiveProjects;

  return (
    <PageHeader
      title={navLabel("/grants")}
      actions={<a className="inline-flex min-h-11 items-center rounded-md border border-input px-4 py-2 text-sm font-medium" href="#grants-benefit-cost">Prepare a benefit-cost analysis</a>}
      description="Every grant you are watching, chasing, or already won — with the money you are still owed — in one place instead of a spreadsheet and a folder of emails."
    >
      <div className="module-summary-grid cols-6">
        <div className="module-summary-card">
          <p className="module-summary-label">Scenario signals</p>
          <p className="module-summary-value">{scenarioComparisonIndicatorCount}</p>
          <p className="module-summary-detail">
            {scenarioComparisonIndicatorCount === 0
              ? "No ready scenario comparisons linked to opportunity projects yet."
              : `${scenarioComparisonReadyCount} ready comparison snapshot${scenarioComparisonReadyCount === 1 ? "" : "s"} across ${scenarioComparisonProjectsWithSignal} project${scenarioComparisonProjectsWithSignal === 1 ? "" : "s"}.`}
          </p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Tracked</p>
          <p className="module-summary-value">{trackedCount}</p>
          <p className="module-summary-detail">Funding opportunities visible in this workspace.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Open now</p>
          <p className="module-summary-value">{openCount}</p>
          <p className="module-summary-detail">Accepting applications right now.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Pursue</p>
          <p className="module-summary-value">{pursueCount}</p>
          <p className="module-summary-detail">Opportunities the team has decided to pursue.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Closing soon</p>
          <p className="module-summary-value">{closingSoonCount}</p>
          <p className="module-summary-detail">Open opportunities whose deadline lands in the next 14 days.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Awarded</p>
          <p className="module-summary-value">{awardedCount}</p>
          <p className="module-summary-detail">Won. Add the award so you can start claiming money back.</p>
        </div>
        <div className="module-summary-card">
          <p className="module-summary-label">Linked scope</p>
          <p className="module-summary-value">{distinctProjectCount + distinctProgramCount}</p>
          <p className="module-summary-detail">{distinctProjectCount} projects and {distinctProgramCount} programs currently linked.</p>
        </div>
      </div>

      <div className="module-inline-list">
        <span className="module-inline-item"><strong>{monitorCount}</strong> monitor</span>
        <span className="module-inline-item"><strong>{skipCount}</strong> skip</span>
        <span className="module-inline-item"><strong>{operationsSummary.counts.projectFundingDecisionProjects}</strong> decision gap projects</span>
        <span className="module-inline-item"><strong>{operationsSummary.counts.overdueDecisionFundingOpportunities}</strong> overdue decisions</span>
        <span className="module-inline-item"><strong>{operationsSummary.counts.projectFundingAwardRecordProjects}</strong> award records missing</span>
        <span className="module-inline-item"><strong>{fundingAwardsCount}</strong> award records recorded</span>
        <span className="module-inline-item"><strong>{reimbursementFollowThrough}</strong> reimbursement follow-through</span>
        <span className="module-inline-item"><strong>{operationsSummary.counts.projectFundingGapProjects}</strong> funding gap projects</span>
        <span className="module-inline-item"><strong>{operationsSummary.counts.comparisonBackedReports}</strong> comparison-backed packets</span>
        <span className="module-inline-item"><strong>{decisionReadyModelingCount}</strong> appears decision-ready</span>
        <span className="module-inline-item"><strong>{staleModelingCount}</strong> refresh recommended</span>
        <span className="module-inline-item"><strong>{thinModelingCount}</strong> appears thin</span>
        <span className="module-inline-item"><strong>{missingModelingCount}</strong> without visible modeling support</span>
      </div>
      {/* The next step this workspace's own grant queue recommends, when it has one. */}
      {workspaceCommandCallout}
    </PageHeader>
  );
}
