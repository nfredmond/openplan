import type { ReactNode } from "react";
import { navLabel } from "@/components/nav/nav-registry";
import { FigureRow } from "@/components/ui/figure-row";
import { PageHeader } from "@/components/ui/page-header";
import type { WorkspaceOperationsSummary } from "@/lib/operations/workspace-summary";

/**
 * The Grants header: four figures and the one next step the workspace's grant
 * queue recommends. It carried seven boxed tiles and fifteen count chips
 * ("0 appears thin", "1 without visible modeling support") until October 10,
 * 2026; those counts now live in the tabs whose work they describe.
 */
export function GrantsPageIntroHeader({
  trackedCount,
  openCount,
  pursueCount,
  monitorCount,
  closingSoonCount,
  awardedCount,
  fundingAwardsCount,
  operationsSummary,
  workspaceCommandCallout,
}: {
  trackedCount: number;
  openCount: number;
  pursueCount: number;
  monitorCount: number;
  closingSoonCount: number;
  awardedCount: number;
  fundingAwardsCount: number;
  operationsSummary: WorkspaceOperationsSummary;
  workspaceCommandCallout: ReactNode | null;
}) {
  const missingAwardRecords = operationsSummary.counts.projectFundingAwardRecordProjects;
  return (
    <PageHeader
      title={navLabel("/grants")}
      actions={
        <a
          className="inline-flex min-h-11 items-center rounded-md border border-input px-4 py-2 text-sm font-medium"
          href="/grants?tab=gaps#grants-benefit-cost"
        >
          Prepare a benefit-cost analysis
        </a>
      }
      description="Grants you are watching, chasing or have won, and the money still owed."
    >
      <FigureRow
        label="Grant figures"
        figures={[
          { label: "Tracked", value: trackedCount, note: `${openCount} open now` },
          { label: "Closing in 14 days", value: closingSoonCount },
          { label: "Pursuing", value: pursueCount, note: `${monitorCount} being watched` },
          {
            label: "Awarded",
            value: awardedCount,
            note:
              missingAwardRecords > 0
                ? `${missingAwardRecords} project${missingAwardRecords === 1 ? "" : "s"} missing an award record`
                : `${fundingAwardsCount} award record${fundingAwardsCount === 1 ? "" : "s"}`,
          },
        ]}
      />
      {/* The next step this workspace's own grant queue recommends, when it has one. */}
      {workspaceCommandCallout}
    </PageHeader>
  );
}
