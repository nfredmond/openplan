import { FundingOpportunityCreator } from "@/components/programs/funding-opportunity-creator";
import { formatCurrency } from "@/lib/grants/page-helpers";
import type { ProgramOption, ProjectOption } from "@/lib/grants/page-helpers";

export type OpportunityCreatorMode = "sourcing" | "gap" | "default";

export type FundingGapProjectContext = {
  summary: {
    unfundedAfterLikelyAmount: number;
    likelyFundingAmount: number;
    fundingNeedAmount: number;
  };
};

export type FundingSourcingProjectContext = {
  fundingNeedAmount: number;
  localMatchNeedAmount: number;
};

export function GrantsOpportunityCreatorSection({
  fundingOpportunityCreatorProject,
  fundingOpportunityCreatorMode,
  focusedFundingGapProject,
  focusedFundingSourcingProject,
  activeFocusedProjectId,
  programOptions,
  projectOptions,
}: {
  fundingOpportunityCreatorProject: ProjectOption | null;
  fundingOpportunityCreatorMode: OpportunityCreatorMode;
  focusedFundingGapProject: FundingGapProjectContext | null;
  focusedFundingSourcingProject: FundingSourcingProjectContext | null;
  activeFocusedProjectId: string | null;
  programOptions: ProgramOption[];
  projectOptions: ProjectOption[];
}) {
  const isFocused =
    fundingOpportunityCreatorProject !== null &&
    activeFocusedProjectId === fundingOpportunityCreatorProject.id;

  const title =
    fundingOpportunityCreatorMode === "gap" && fundingOpportunityCreatorProject
      ? `Close funding gap for ${fundingOpportunityCreatorProject.name}`
      : fundingOpportunityCreatorProject
        ? `Source a funding opportunity for ${fundingOpportunityCreatorProject.name}`
        : "Log a funding opportunity";

  const description =
    fundingOpportunityCreatorMode === "gap" && fundingOpportunityCreatorProject
      ? `Focused from the workspace queue so you can source additional grant coverage for ${fundingOpportunityCreatorProject.name} without leaving the shared grants lane.`
      : fundingOpportunityCreatorProject
        ? `Focused from the workspace queue so you can source candidate grants for ${fundingOpportunityCreatorProject.name} without leaving the shared grants lane.`
        : "Create a shared grant record tied to a project or program so pursue, monitor, skip, award, and reimbursement work all point back to the same workspace truth.";

  return (
    <div
      id="grants-opportunity-creator"
      className={
        isFocused
          ? "rounded-[1.7rem] ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]"
          : ""
      }
    >
      <FundingOpportunityCreator
        programs={programOptions}
        projects={projectOptions}
        defaultProjectId={fundingOpportunityCreatorProject?.id ?? null}
        title={title}
        description={description}
      />
      {isFocused && fundingOpportunityCreatorProject ? (
        <div className="mt-3 rounded-2xl border border-sky-400/35 bg-sky-400/10 px-4 py-3 text-sm text-sky-950 dark:text-sky-100">
          <p className="font-semibold">Focused from workspace queue</p>
          <p className="mt-1">
            {fundingOpportunityCreatorMode === "gap" && focusedFundingGapProject
              ? `${fundingOpportunityCreatorProject.name} still carries an uncovered funding gap after current pursued dollars. Source another realistic grant here so the gap can shrink on the shared grants spine.`
              : `${fundingOpportunityCreatorProject.name} still needs sourced opportunities. Start with the highest-fit grant record here so pursue, award, and reimbursement work can stay on the shared grants spine.`}
          </p>
          {fundingOpportunityCreatorMode === "gap" && focusedFundingGapProject ? (
            <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-sky-700/80 dark:text-sky-200/80">
              Remaining gap {formatCurrency(focusedFundingGapProject.summary.unfundedAfterLikelyAmount)}
              {focusedFundingGapProject.summary.likelyFundingAmount > 0
                ? ` · Pursued ${formatCurrency(focusedFundingGapProject.summary.likelyFundingAmount)}`
                : ""}
              {focusedFundingGapProject.summary.fundingNeedAmount > 0
                ? ` · Need ${formatCurrency(focusedFundingGapProject.summary.fundingNeedAmount)}`
                : ""}
            </p>
          ) : focusedFundingSourcingProject ? (
            <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-sky-700/80 dark:text-sky-200/80">
              Funding need {formatCurrency(focusedFundingSourcingProject.fundingNeedAmount)}
              {focusedFundingSourcingProject.localMatchNeedAmount > 0
                ? ` · Local match ${formatCurrency(focusedFundingSourcingProject.localMatchNeedAmount)}`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
