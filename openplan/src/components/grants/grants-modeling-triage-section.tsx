import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { WorkspaceCommandQueueItem } from "@/lib/operations/workspace-summary";
import {
  buildFocusedOpportunityCardHref,
  type GrantsModelingTriageProject,
} from "@/lib/grants/page-helpers";

export function GrantsModelingTriageSection({
  opportunityLinkedModelingProjects,
  decisionReadyModelingProjects,
  staleModelingProjects,
  thinModelingProjects,
  missingModelingProjects,
  strongestModelingProject,
  stalestModelingProject,
  thinnestModelingProject,
  missingModelingProject,
  leadModelingCommand,
}: {
  opportunityLinkedModelingProjects: GrantsModelingTriageProject[];
  decisionReadyModelingProjects: GrantsModelingTriageProject[];
  staleModelingProjects: GrantsModelingTriageProject[];
  thinModelingProjects: GrantsModelingTriageProject[];
  missingModelingProjects: GrantsModelingTriageProject[];
  strongestModelingProject: GrantsModelingTriageProject | null;
  stalestModelingProject: GrantsModelingTriageProject | null;
  thinnestModelingProject: GrantsModelingTriageProject | null;
  missingModelingProject: GrantsModelingTriageProject | null;
  leadModelingCommand: WorkspaceCommandQueueItem | null;
}) {
  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Modeling triage</p>
          <h2 className="module-section-title">See where grant modeling support looks strongest, thin, or stale</h2>
          <p className="module-section-description">
            Saved scenario comparison context stays visible here before operators open a funding opportunity or change grant posture. Treat it as planning support only, not proof of award likelihood or a replacement for funding-source review.
          </p>
        </div>
        <StatusBadge tone={opportunityLinkedModelingProjects.length > 0 ? "info" : "neutral"}>
          {opportunityLinkedModelingProjects.length === 1
            ? "1 linked project"
            : `${opportunityLinkedModelingProjects.length} linked projects`}
        </StatusBadge>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="module-subpanel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Appears decision-ready</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Current packets with ready saved comparisons and visible indicator deltas.
              </p>
            </div>
            <StatusBadge tone="success">{decisionReadyModelingProjects.length}</StatusBadge>
          </div>
          {strongestModelingProject ? (
            <div className="mt-3 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">{strongestModelingProject.project.name}</p>
              <p className="mt-1">{strongestModelingProject.modelingReadiness?.detail}</p>
              <Link
                href={strongestModelingProject.modelingEvidence?.leadComparisonReport.href ?? "/reports?posture=comparison-backed"}
                className="mt-3 inline-flex items-center gap-2 font-semibold text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]"
              >
                Open strongest packet
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No linked project currently shows current comparison-backed support that appears decision-ready.
            </p>
          )}
        </div>

        <div className="module-subpanel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Refresh recommended</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Comparison-backed packets exist, but the saved grant support is stale against the report record.
              </p>
            </div>
            <StatusBadge tone="warning">{staleModelingProjects.length}</StatusBadge>
          </div>
          {stalestModelingProject ? (
            <div className="mt-3 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">{stalestModelingProject.project.name}</p>
              <p className="mt-1">{stalestModelingProject.modelingReadiness?.detail}</p>
              <Link
                href={stalestModelingProject.modelingEvidence?.leadComparisonReport.href ?? "/reports?posture=comparison-backed"}
                className="mt-3 inline-flex items-center gap-2 font-semibold text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]"
              >
                Refresh supporting packet
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No linked project is currently calling for a packet refresh from the grant lane.
            </p>
          )}
        </div>

        <div className="module-subpanel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Appears thin</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Comparison-backed support exists, but the signal is still light for grant triage.
              </p>
            </div>
            <StatusBadge tone="neutral">{thinModelingProjects.length}</StatusBadge>
          </div>
          {thinnestModelingProject ? (
            <div className="mt-3 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">{thinnestModelingProject.project.name}</p>
              <p className="mt-1">{thinnestModelingProject.modelingReadiness?.detail}</p>
              <Link
                href={thinnestModelingProject.modelingEvidence?.leadComparisonReport.href ?? "/reports?posture=comparison-backed"}
                className="mt-3 inline-flex items-center gap-2 font-semibold text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]"
              >
                Review thin support
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              No linked project currently looks comparison-backed but thin from this grants snapshot.
            </p>
          )}
        </div>

        <div className="module-subpanel">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">No visible modeling support</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Opportunity-linked projects without a comparison-backed packet visible yet.
              </p>
            </div>
            <StatusBadge tone="warning">{missingModelingProjects.length}</StatusBadge>
          </div>
          {missingModelingProject ? (
            <div className="mt-3 text-sm text-muted-foreground">
              <p className="font-semibold text-foreground">{missingModelingProject.project.name}</p>
              <p className="mt-1">
                {missingModelingProject.opportunityCount} linked opportunit{missingModelingProject.opportunityCount === 1 ? "y is" : "ies are"} visible here, but no comparison-backed packet is attached yet.
              </p>
              <Link
                href={buildFocusedOpportunityCardHref(missingModelingProject.leadOpportunityId)}
                className="mt-3 inline-flex items-center gap-2 font-semibold text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]"
              >
                Open linked opportunity
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Every linked project in the visible grant lane has at least one comparison-backed packet.
            </p>
          )}
        </div>
      </div>

      {leadModelingCommand ? (
        <Link href={leadModelingCommand.href} className="module-subpanel mt-3 block transition-colors hover:border-primary/35">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap gap-2">
                <StatusBadge tone="info">Modeling-backed</StatusBadge>
                <StatusBadge tone="neutral">Reports → Grants</StatusBadge>
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">{leadModelingCommand.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{leadModelingCommand.detail}</p>
            </div>
            <Sparkles className="mt-1 h-5 w-5 text-[color:var(--pine)]" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {leadModelingCommand.badges.map((badge) => (
              <StatusBadge key={`modeling-grants-${badge.label}`} tone="neutral">
                {badge.label}
                {badge.value !== null && badge.value !== undefined ? `: ${badge.value}` : ""}
              </StatusBadge>
            ))}
          </div>
          <div className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]">
            Review packet evidence before grant posture changes
            <ArrowRight className="h-4 w-4" />
          </div>
        </Link>
      ) : null}
    </article>
  );
}
