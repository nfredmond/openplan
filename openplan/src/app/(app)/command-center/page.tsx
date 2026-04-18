import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Compass, FileText, FolderKanban, Landmark, PlaneTakeoff, Radar } from "lucide-react";

import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

export const metadata = {
  title: "Command Center · OpenPlan",
  description:
    "Cross-domain operational view of RTP, grants, aerial, projects, and plans for the active workspace.",
};

export default async function CommandCenterPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in?next=/command-center");
  }

  const { membership, workspace } = await loadCurrentWorkspaceMembership(supabase, user.id);

  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Command Center"
        title="Command Center needs a provisioned workspace"
        description="Command Center surfaces RTP, grants, aerial, projects, and plans state against a single workspace. Join or create a workspace first."
        primaryHref="/projects"
        primaryLabel="Create or open project workspace"
      />
    );
  }

  const workspaceId = membership.workspace_id;
  const summary = await loadWorkspaceOperationsSummaryForWorkspace(
    supabase as unknown as WorkspaceOperationsSupabaseLike,
    workspaceId
  );

  const activeReimbursement = summary.counts.projectFundingReimbursementActiveProjects;
  const openOpportunities = summary.counts.openFundingOpportunities;

  const domainLinks = [
    {
      key: "rtp",
      href: "/rtp",
      title: "RTP",
      description: "Cycle posture, packet freshness, release review.",
      countLabel: `${summary.counts.rtpFundingReviewPackets} funding-review packet${summary.counts.rtpFundingReviewPackets === 1 ? "" : "s"}`,
      icon: Compass,
    },
    {
      key: "grants",
      href: "/grants",
      title: "Grants",
      description: "Opportunities, pursuit decisions, awards, reimbursement.",
      countLabel: `${openOpportunities} open opportunit${openOpportunities === 1 ? "y" : "ies"}`,
      icon: Landmark,
    },
    {
      key: "aerial",
      href: "/aerial",
      title: "Aerial Ops",
      description: "Missions, evidence packages, AOI authoring + DJI export.",
      countLabel: `${summary.counts.aerialReadyPackages} ready package${summary.counts.aerialReadyPackages === 1 ? "" : "s"}`,
      icon: PlaneTakeoff,
    },
    {
      key: "projects",
      href: "/projects",
      title: "Projects",
      description: "Stage gates, funding stack, reimbursement follow-through.",
      countLabel: `${activeReimbursement} reimbursement-active project${activeReimbursement === 1 ? "" : "s"}`,
      icon: FolderKanban,
    },
    {
      key: "reports",
      href: "/reports",
      title: "Reports",
      description: "Packet status, comparison-backed evidence, board exports.",
      countLabel: `${summary.counts.reports} report${summary.counts.reports === 1 ? "" : "s"} · ${summary.counts.reportPacketCurrent} current packet${summary.counts.reportPacketCurrent === 1 ? "" : "s"}`,
      icon: FileText,
    },
  ];

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <div className="module-intro-card">
          <div className="module-intro-kicker">Operations</div>
          <div className="module-intro-body">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge tone="info">
                <Radar className="h-3 w-3" />
                Cross-domain view
              </StatusBadge>
              <StatusBadge tone="neutral">{workspace.name}</StatusBadge>
            </div>
            <h1 className="module-intro-title">Command Center</h1>
            <p className="module-intro-description">
              One operational view of the runtime cue, command queue, and cross-domain counts for the active workspace.
              Dashboard stays your workspace home; Command Center is the operational cut of the same state.
            </p>
          </div>
        </div>
      </header>

      <WorkspaceRuntimeCue summary={summary} className="mt-4" />

      <div className="mt-4">
        <WorkspaceCommandBoard summary={summary}>
          <p className="text-[0.8rem] text-muted-foreground">
            Command Center composes the workspace operations summary — the same source of truth the Dashboard uses.
            Counts and cues update whenever underlying RTP, grants, aerial, project, or report state changes.
          </p>
        </WorkspaceCommandBoard>
      </div>

      <section className="mt-6 module-section-surface">
        <div className="module-section-header">
          <div className="module-section-heading">
            <p className="module-section-label">Domains</p>
            <h2 className="module-section-title">Jump into a lane</h2>
            <p className="module-section-description">
              Each row links to the underlying surface with the current count context.
            </p>
          </div>
        </div>
        <ul className="module-list divide-y divide-border/60">
          {domainLinks.map((domain) => {
            const Icon = domain.icon;
            return (
              <li key={domain.key}>
                <Link
                  href={domain.href}
                  className="flex items-center gap-4 px-4 py-3 transition hover:bg-muted/40"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{domain.title}</p>
                    <p className="text-xs text-muted-foreground">{domain.description}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{domain.countLabel}</span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <StateBlock
        className="mt-6"
        title="What this view does NOT do"
        description="Command Center composes existing widgets; it does not introduce new data sources or derivations. RTP, grants, aerial, and modeling truth-state locks still apply to their upstream surfaces."
        tone="info"
        compact
      />
    </section>
  );
}
