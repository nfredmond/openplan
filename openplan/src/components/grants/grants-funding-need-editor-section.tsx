import { ProjectFundingProfileEditor } from "@/components/projects/project-funding-profile-editor";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatCurrency } from "@/lib/grants/page-helpers";

export type FundingNeedEditorProjectContext = {
  project: { id: string; name: string };
  opportunityCount: number;
  localMatchNeedAmount: number;
  notes: string | null;
};

export function GrantsFundingNeedEditorSection({
  fundingNeedEditorProject,
  fundingNeedAnchorProjectsCount,
  activeFocusedProjectId,
}: {
  fundingNeedEditorProject: FundingNeedEditorProjectContext;
  fundingNeedAnchorProjectsCount: number;
  activeFocusedProjectId: string | null;
}) {
  const isFocused = activeFocusedProjectId === fundingNeedEditorProject.project.id;
  const anchorLabel =
    fundingNeedAnchorProjectsCount === 1 ? "1 missing anchor" : `${fundingNeedAnchorProjectsCount} missing anchors`;

  return (
    <div
      id="grants-funding-need-editor"
      className={
        isFocused
          ? "scroll-mt-24 rounded-[1.7rem] ring-2 ring-sky-400/80 ring-offset-2 ring-offset-background shadow-[0_0_0_1px_rgba(56,189,248,0.15)]"
          : "scroll-mt-24"
      }
    >
      <article className="module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Funding need anchor</p>
            <h2 className="module-section-title">{`Anchor funding need for ${fundingNeedEditorProject.project.name}`}</h2>
            <p className="module-section-description">
              Record the target funding need and local match so grant sourcing, gap review, and award coverage can run against honest project math.
            </p>
          </div>
          <StatusBadge tone="warning">{anchorLabel}</StatusBadge>
        </div>
        <ProjectFundingProfileEditor
          projectId={fundingNeedEditorProject.project.id}
          initialFundingNeedAmount={null}
          initialLocalMatchNeedAmount={fundingNeedEditorProject.localMatchNeedAmount}
          initialNotes={fundingNeedEditorProject.notes}
        />
        {isFocused ? (
          <div className="mt-3 rounded-2xl border border-sky-400/35 bg-sky-400/10 px-4 py-3 text-sm text-sky-950 dark:text-sky-100">
            <p className="font-semibold">Focused from workspace queue</p>
            <p className="mt-1">
              {fundingNeedEditorProject.project.name} already has linked opportunities but still needs a recorded
              funding-need anchor before gap and award posture can be trusted.
            </p>
            <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-sky-700/80 dark:text-sky-200/80">
              {fundingNeedEditorProject.opportunityCount} linked opportunit
              {fundingNeedEditorProject.opportunityCount === 1 ? "y" : "ies"}
              {fundingNeedEditorProject.localMatchNeedAmount > 0
                ? ` · Local match ${formatCurrency(fundingNeedEditorProject.localMatchNeedAmount)}`
                : ""}
            </p>
          </div>
        ) : null}
      </article>
    </div>
  );
}
