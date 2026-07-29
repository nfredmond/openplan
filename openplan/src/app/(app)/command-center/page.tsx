import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Compass,
  Database,
  FileText,
  FolderKanban,
  Gauge,
  GitCompare,
  Landmark,
  LineChart,
  MapPinned,
  PlaneTakeoff,
  Radar,
  ReceiptText,
  ShieldAlert,
} from "lucide-react";

import { RecentActionActivity } from "@/components/operations/recent-action-activity";
import { WorkspaceCommandBoard } from "@/components/operations/workspace-command-board";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import {
  loadRecentActionExecutionsForWorkspace,
  type RecentActionActivitySupabaseLike,
} from "@/lib/operations/action-activity";
import { createClient } from "@/lib/supabase/server";
import { loadCurrentWorkspaceMembership } from "@/lib/workspaces/current";

export const metadata = {
  title: "Command Center · OpenPlan",
  description:
    "Operational view of the workspace lanes the shared operations summary reads: RTP, grants, projects, reports, invoicing, engagement, safety, modeling, data and knowledge, and aerial.",
};

/**
 * A jump-lane count that never turns an unmeasured number into a zero.
 *
 * The counts on this page come from two places with different guarantees:
 * `summary.counts` is always computed, while `summary.moduleObservations` is
 * `number | null` where null means the read failed or the workspace holds more
 * rows than one screening read summarizes. A "0 datasets" chip on a lane whose
 * read failed would be a confident sentence about the world.
 */
function laneCountLabel(
  value: number | null | undefined,
  singular: string,
  plural = `${singular}s`
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return `${plural} not measured`;
  }

  return `${value} ${value === 1 ? singular : plural}`;
}

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
        description="Command Center surfaces delivery, funding, engagement, safety, modeling, evidence, invoicing, and aerial state against a single workspace. Join or create a workspace first."
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
  const actionActivity = await loadRecentActionExecutionsForWorkspace(
    supabase as unknown as RecentActionActivitySupabaseLike,
    workspaceId
  );

  const activeReimbursement = summary.counts.projectFundingReimbursementActiveProjects;
  const openOpportunities = summary.counts.openFundingOpportunities;
  const observations = summary.moduleObservations;

  /*
   * One row per module the workspace operations summary actually reads.
   *
   * This list used to hold five rows on a page whose own badge says
   * "Cross-domain view", while the summary behind it read seven of nineteen nav
   * modules — so Engagement, Safety, Models, Scenarios, County Validation, the
   * Data Hub, the Knowledge Base and client invoicing were absent from a page
   * claiming to be the view across domains. The rule this list now follows: a
   * module appears here when the summary reads it, with a count that says
   * "not measured" rather than "0" when the read did not land. Adding a row for
   * a module nothing reads would put the claim back.
   */
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
    {
      key: "invoicing",
      href: "/invoicing",
      title: "Invoicing",
      description: "Grant-reimbursement register and client invoices this workspace issues.",
      countLabel: laneCountLabel(observations?.receivables.draftClientInvoices, "draft client invoice"),
      icon: ReceiptText,
    },
    {
      key: "engagement",
      href: "/engagement",
      title: "Engagement",
      description: "Campaigns, public comment intake, moderation, handoff.",
      countLabel: laneCountLabel(
        observations?.engagement.moderationActionableItems,
        "comment awaiting moderation",
        "comments awaiting moderation"
      ),
      icon: MapPinned,
    },
    {
      key: "safety",
      href: "/safety",
      title: "Safety",
      description: "Crash data pulls, coverage limits, screening evidence.",
      countLabel: laneCountLabel(observations?.safety.readyCrashIngests, "ready crash data pull"),
      icon: ShieldAlert,
    },
    {
      key: "models",
      href: "/models",
      title: "Models",
      description: "Travel-demand models and the runs behind analysis evidence.",
      countLabel: laneCountLabel(observations?.modeling.modelRuns, "model run"),
      icon: LineChart,
    },
    {
      key: "scenarios",
      href: "/scenarios",
      title: "Scenarios",
      description: "Scenario sets, baselines, and comparison snapshots.",
      countLabel: laneCountLabel(observations?.modeling.scenarioSets, "scenario set"),
      icon: GitCompare,
    },
    {
      key: "county-runs",
      href: "/county-runs",
      title: "County Validation",
      description: "Screening onramp runs and their validation stage.",
      countLabel: laneCountLabel(observations?.modeling.countyRuns, "validation run"),
      icon: Gauge,
    },
    {
      key: "data-hub",
      href: "/data-hub",
      title: "Data Hub",
      description: "Registered datasets, refresh state, geometry attachment.",
      countLabel: laneCountLabel(observations?.evidence.datasets, "dataset"),
      icon: Database,
    },
    {
      key: "knowledge-base",
      href: "/knowledge-base",
      title: "Knowledge Base",
      description: "Uploaded documents grounded citations are drawn from.",
      countLabel: laneCountLabel(observations?.evidence.readyKnowledgeDocuments, "ready document"),
      icon: BookOpen,
    },
    {
      key: "aerial",
      href: "/aerial",
      title: "Aerial Ops",
      description: "Missions, evidence packages, AOI authoring + DJI export.",
      countLabel: `${summary.counts.aerialReadyPackages} ready package${summary.counts.aerialReadyPackages === 1 ? "" : "s"}`,
      icon: PlaneTakeoff,
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
              One operational view of the runtime cue, command queue, and lane counts for the active workspace —
              delivery and funding, engagement, safety, modeling, evidence supply, invoicing, and aerial. Dashboard
              stays your workspace home; Command Center is the operational cut of the same state.
            </p>
          </div>
        </div>
      </header>

      <WorkspaceRuntimeCue summary={summary} className="mt-4" />

      <div className="mt-4">
        <WorkspaceCommandBoard summary={summary}>
          <p className="text-[0.8rem] text-muted-foreground">
            Counts and cues come from the shared workspace operations summary. The action activity lane reads completed
            operator actions from the same workspace audit log.
          </p>
        </WorkspaceCommandBoard>
      </div>

      <RecentActionActivity
        className="mt-6"
        executions={actionActivity.executions}
        error={actionActivity.error}
        description="Recent audited actions from this workspace, including packet generation, funding decisions, and project-record operations."
        emptyDescription="No audited operator actions have run in this workspace yet. Packet generation, funding decisions, and project-record operations will appear here after completion."
      />


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
                  className="flex flex-col gap-3 px-4 py-3 transition hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-4"
                >
                  <span className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-foreground">{domain.title}</p>
                    <p className="text-xs text-muted-foreground">{domain.description}</p>
                  </div>
                  <span className="text-xs text-muted-foreground sm:whitespace-nowrap">{domain.countLabel}</span>
                  <ArrowRight className="hidden h-4 w-4 text-muted-foreground sm:block" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <StateBlock
        className="mt-6"
        title="Operational scope"
        description="Every lane above comes from the shared workspace operations summary, and the activity ledger comes from this workspace's audit log. Analysis Studio corridor runs are the one registered surface the summary does not read yet, so they are absent from this page rather than shown as empty. A lane the summary could not read says so instead of reporting zero. Per-record truth-state locks in RTP, grants, safety, and modeling still apply on their own surfaces."
        tone="info"
        compact
      />
    </section>
  );
}
