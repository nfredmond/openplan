import type { ReactNode } from "react";
import { Landmark, ShieldCheck } from "lucide-react";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
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
    <header className="module-header-grid">
      <article className="module-intro-card">
        <div className="module-intro-kicker">
          <Landmark className="h-3.5 w-3.5" />
          Grant management
        </div>
        <div className="module-intro-body">
          <h1 className="module-intro-title">Grants</h1>
          <p className="module-intro-description">
            Every grant you are watching, chasing, or already won — with the money you are still owed — in one place instead of a spreadsheet and a folder of emails.
          </p>
        </div>

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
      </article>

      <article className="module-operator-card">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
            <ShieldCheck className="h-5 w-5 text-emerald-200" />
          </span>
          <div>
            <p className="module-operator-eyebrow">Grant management</p>
            <h2 className="module-operator-title">Grant decisions stay attached to the project</h2>
          </div>
        </div>
        <p className="module-operator-copy">
          What a project needs, what is open, what you won, and what has been reimbursed — all in one view, tied to the projects and programs the money pays for.
        </p>
        <div className="module-operator-list">
          <div className="module-operator-item">Enter a grant once. Every project and program that applies for it reads the same record.</div>
          <div className="module-operator-item">When you decide to go after one, write down why — the fit, how ready you are, and the reasoning.</div>
          <div className="module-operator-item">Awarded dollars and reimbursement claims are tracked here too, not left to whoever remembers.</div>
        </div>
        <div className="mt-4">
          <WorkspaceRuntimeCue summary={operationsSummary} className="border-white/10 bg-white/[0.06] text-emerald-50/82" />
        </div>
        {workspaceCommandCallout}
      </article>
    </header>
  );
}
