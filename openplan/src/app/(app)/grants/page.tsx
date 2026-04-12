import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, CalendarClock, Landmark, ShieldCheck, Sparkles } from "lucide-react";
import { FundingOpportunityCreator } from "@/components/programs/funding-opportunity-creator";
import { FundingOpportunityDecisionControls } from "@/components/programs/funding-opportunity-decision-controls";
import { ProjectFundingAwardCreator } from "@/components/projects/project-funding-award-creator";
import { WorkspaceRuntimeCue } from "@/components/operations/workspace-runtime-cue";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/state-block";
import { WorkspaceMembershipRequired } from "@/components/workspaces/workspace-membership-required";
import {
  loadWorkspaceOperationsSummaryForWorkspace,
  type WorkspaceOperationsSupabaseLike,
} from "@/lib/operations/workspace-summary";
import {
  formatFundingOpportunityDecisionLabel,
  formatFundingOpportunityStatusLabel,
  fundingOpportunityDecisionTone,
  fundingOpportunityStatusTone,
  type FundingOpportunityDecision,
  type FundingOpportunityStatus,
} from "@/lib/programs/catalog";
import { createClient } from "@/lib/supabase/server";
import {
  CURRENT_WORKSPACE_MEMBERSHIP_SELECT,
  type WorkspaceMembershipRow,
  unwrapWorkspaceRecord,
} from "@/lib/workspaces/current";

type GrantsPageSearchParams = Promise<{
  status?: string;
  decision?: string;
}>;

type FundingOpportunityRow = {
  id: string;
  workspace_id: string;
  program_id: string | null;
  project_id: string | null;
  title: string;
  opportunity_status: FundingOpportunityStatus;
  decision_state: FundingOpportunityDecision;
  agency_name: string | null;
  owner_label: string | null;
  cadence_label: string | null;
  expected_award_amount: number | string | null;
  opens_at: string | null;
  closes_at: string | null;
  decision_due_at: string | null;
  fit_notes: string | null;
  readiness_notes: string | null;
  decision_rationale: string | null;
  decided_at: string | null;
  summary: string | null;
  updated_at: string;
  created_at: string;
  programs:
    | {
        id: string;
        title: string;
        funding_classification: string | null;
      }
    | Array<{
        id: string;
        title: string;
        funding_classification: string | null;
      }>
    | null;
  projects:
    | {
        id: string;
        name: string;
      }
    | Array<{
        id: string;
        name: string;
      }>
    | null;
};

type ProjectOption = {
  id: string;
  name: string;
};

type ProgramOption = {
  id: string;
  title: string;
};

type FundingAwardRow = {
  id: string;
  funding_opportunity_id: string | null;
  project_id: string | null;
  program_id: string | null;
  title: string;
  awarded_amount: number | string | null;
  updated_at: string;
};

type StatusFilter = "all" | FundingOpportunityStatus;
type DecisionFilter = "all" | FundingOpportunityDecision;

const STATUS_FILTERS: StatusFilter[] = ["all", "open", "upcoming", "awarded", "closed", "archived"];
const DECISION_FILTERS: DecisionFilter[] = ["all", "pursue", "monitor", "skip"];
const GRANTS_QUEUE_KEYS = new Set([
  "funding-windows-closing",
  "anchor-project-funding-needs",
  "source-project-funding-opportunities",
  "advance-project-funding-decisions",
  "record-awarded-funding",
  "start-project-reimbursement-packets",
  "advance-project-reimbursement-invoicing",
  "close-project-funding-gaps",
]);

function normalizeJoinedRecord<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function normalizeStatusFilter(value: string | undefined): StatusFilter {
  return STATUS_FILTERS.includes(value as StatusFilter) ? (value as StatusFilter) : "all";
}

function normalizeDecisionFilter(value: string | undefined): DecisionFilter {
  return DECISION_FILTERS.includes(value as DecisionFilter) ? (value as DecisionFilter) : "all";
}

function buildGrantsFilterHref(filters: { status: StatusFilter; decision: DecisionFilter }) {
  const params = new URLSearchParams();
  if (filters.status !== "all") {
    params.set("status", filters.status);
  }
  if (filters.decision !== "all") {
    params.set("decision", filters.decision);
  }

  const query = params.toString();
  return query ? `/grants?${query}` : "/grants";
}

function formatFilterLabel(value: StatusFilter | DecisionFilter) {
  if (value === "all") return "All";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatCurrency(value: number | string | null | undefined) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(numeric) ? numeric : 0);
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function isClosingSoon(value: string | null | undefined) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = Date.now();
  const diffMs = parsed.getTime() - now;
  return diffMs >= 0 && diffMs <= 14 * 24 * 60 * 60 * 1000;
}

function isDecisionSoon(value: string | null | undefined) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = Date.now();
  const diffMs = parsed.getTime() - now;
  return diffMs >= 0 && diffMs <= 14 * 24 * 60 * 60 * 1000;
}

function getOpportunityPriority(opportunity: {
  opportunity_status: FundingOpportunityStatus;
  decision_state: FundingOpportunityDecision;
  closes_at: string | null;
  decision_due_at: string | null;
}) {
  if (isClosingSoon(opportunity.closes_at)) return 0;
  if (opportunity.opportunity_status === "open" && opportunity.decision_state === "pursue") return 1;
  if (isDecisionSoon(opportunity.decision_due_at) && opportunity.decision_state !== "skip") return 2;
  if (opportunity.opportunity_status === "open") return 3;
  if (opportunity.opportunity_status === "upcoming") return 4;
  if (opportunity.opportunity_status === "awarded") return 5;
  return 6;
}

export default async function GrantsPage({
  searchParams,
}: {
  searchParams: GrantsPageSearchParams;
}) {
  const filters = await searchParams;
  const selectedStatus = normalizeStatusFilter(filters.status);
  const selectedDecision = normalizeDecisionFilter(filters.decision);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/sign-in");
  }

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select(CURRENT_WORKSPACE_MEMBERSHIP_SELECT)
    .eq("user_id", user.id)
    .limit(1);

  const membership = memberships?.[0] as WorkspaceMembershipRow | undefined;
  const workspace = unwrapWorkspaceRecord(membership?.workspaces);

  if (!membership || !workspace) {
    return (
      <WorkspaceMembershipRequired
        moduleLabel="Grants"
        title="Grants need a provisioned workspace"
        description="Funding opportunities, awards, and reimbursement posture only become meaningful when they are attached to a real OpenPlan workspace."
      />
    );
  }

  const [{ data: opportunitiesData }, { data: projectsData }, { data: programsData }, { data: fundingAwardsData }, operationsSummary] =
    await Promise.all([
      supabase
        .from("funding_opportunities")
        .select(
          "id, workspace_id, program_id, project_id, title, opportunity_status, decision_state, agency_name, owner_label, cadence_label, expected_award_amount, opens_at, closes_at, decision_due_at, fit_notes, readiness_notes, decision_rationale, decided_at, summary, updated_at, created_at, programs(id, title, funding_classification), projects(id, name)"
        )
        .eq("workspace_id", membership.workspace_id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("projects")
        .select("id, name")
        .eq("workspace_id", membership.workspace_id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("programs")
        .select("id, title")
        .eq("workspace_id", membership.workspace_id)
        .order("updated_at", { ascending: false }),
      supabase
        .from("funding_awards")
        .select("id, funding_opportunity_id, project_id, program_id, title, awarded_amount, updated_at")
        .eq("workspace_id", membership.workspace_id)
        .order("updated_at", { ascending: false }),
      loadWorkspaceOperationsSummaryForWorkspace(
        supabase as unknown as WorkspaceOperationsSupabaseLike,
        membership.workspace_id
      ),
    ]);

  const opportunities = ((opportunitiesData ?? []) as FundingOpportunityRow[])
    .map((opportunity) => ({
      ...opportunity,
      program: normalizeJoinedRecord(opportunity.programs),
      project: normalizeJoinedRecord(opportunity.projects),
    }))
    .sort((left, right) => {
      const priorityDifference = getOpportunityPriority(left) - getOpportunityPriority(right);
      if (priorityDifference !== 0) return priorityDifference;
      return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
    });

  const fundingAwards = (fundingAwardsData ?? []) as FundingAwardRow[];
  const fundingAwardOpportunityIds = new Set(
    fundingAwards.map((award) => award.funding_opportunity_id).filter((value): value is string => Boolean(value))
  );

  const filteredOpportunities = opportunities.filter((opportunity) => {
    if (selectedStatus !== "all" && opportunity.opportunity_status !== selectedStatus) {
      return false;
    }
    if (selectedDecision !== "all" && opportunity.decision_state !== selectedDecision) {
      return false;
    }
    return true;
  });

  const trackedCount = opportunities.length;
  const openCount = opportunities.filter((opportunity) => opportunity.opportunity_status === "open").length;
  const pursueCount = opportunities.filter((opportunity) => opportunity.decision_state === "pursue").length;
  const monitorCount = opportunities.filter((opportunity) => opportunity.decision_state === "monitor").length;
  const skipCount = opportunities.filter((opportunity) => opportunity.decision_state === "skip").length;
  const closingSoonCount = opportunities.filter((opportunity) => isClosingSoon(opportunity.closes_at)).length;
  const awardedCount = opportunities.filter((opportunity) => opportunity.opportunity_status === "awarded").length;
  const distinctProjectCount = new Set(opportunities.map((opportunity) => opportunity.project?.id).filter(Boolean)).size;
  const distinctProgramCount = new Set(opportunities.map((opportunity) => opportunity.program?.id).filter(Boolean)).size;
  const awardedOpportunitiesMissingRecords = opportunities.filter(
    (opportunity) =>
      opportunity.opportunity_status === "awarded" && !fundingAwardOpportunityIds.has(opportunity.id)
  );
  const leadAwardConversionOpportunity =
    awardedOpportunitiesMissingRecords.find((opportunity) => Boolean(opportunity.project?.id)) ?? null;
  const grantsQueue = operationsSummary.commandQueue.filter((item) => GRANTS_QUEUE_KEYS.has(item.key));
  const leadGrantsCommand = grantsQueue[0] ?? null;

  return (
    <section className="module-page">
      <header className="module-header-grid">
        <article className="module-intro-card">
          <div className="module-intro-kicker">
            <Landmark className="h-3.5 w-3.5" />
            Shared grants operating lane
          </div>
          <div className="module-intro-body">
            <h1 className="module-intro-title">Grants</h1>
            <p className="module-intro-description">
              Manage funding opportunities, pursue decisions, award posture, and reimbursement follow-through as one shared operating surface instead of scattered project notes.
            </p>
          </div>

          <div className="module-summary-grid cols-6">
            <div className="module-summary-card">
              <p className="module-summary-label">Tracked</p>
              <p className="module-summary-value">{trackedCount}</p>
              <p className="module-summary-detail">Funding opportunities visible in this workspace.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Open now</p>
              <p className="module-summary-value">{openCount}</p>
              <p className="module-summary-detail">Calls that can move immediately into packaging or decision review.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Pursue</p>
              <p className="module-summary-value">{pursueCount}</p>
              <p className="module-summary-detail">Opportunities already carrying a real pursue posture.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Closing soon</p>
              <p className="module-summary-value">{closingSoonCount}</p>
              <p className="module-summary-detail">Open opportunities whose deadline lands in the next 14 days.</p>
            </div>
            <div className="module-summary-card">
              <p className="module-summary-label">Awarded</p>
              <p className="module-summary-value">{awardedCount}</p>
              <p className="module-summary-detail">Awarded opportunities that should feed awards and reimbursement truth.</p>
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
            <span className="module-inline-item"><strong>{operationsSummary.counts.projectFundingAwardRecordProjects}</strong> award records missing</span>
            <span className="module-inline-item"><strong>{fundingAwards.length}</strong> award records recorded</span>
            <span className="module-inline-item"><strong>{operationsSummary.counts.projectFundingReimbursementStartProjects + operationsSummary.counts.projectFundingReimbursementActiveProjects}</strong> reimbursement follow-through</span>
            <span className="module-inline-item"><strong>{operationsSummary.counts.projectFundingGapProjects}</strong> funding gap projects</span>
          </div>
        </article>

        <article className="module-operator-card">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
            </span>
            <div>
              <p className="module-operator-eyebrow">Grants OS</p>
              <h2 className="module-operator-title">Keep grant posture connected to project and RTP truth</h2>
            </div>
          </div>
          <p className="module-operator-copy">
            OpenPlan already knows funding need anchors, opportunities, awards, and reimbursement state. This page turns those records into one workspace lane planners can actually run.
          </p>
          <div className="module-operator-list">
            <div className="module-operator-item">Use one opportunity registry instead of re-entering grant posture across projects and programs.</div>
            <div className="module-operator-item">Move opportunities from monitor to pursue with explicit fit, readiness, and rationale notes.</div>
            <div className="module-operator-item">Treat awarded dollars and reimbursement follow-through as operational truth, not afterthoughts.</div>
          </div>
          <div className="mt-4">
            <WorkspaceRuntimeCue summary={operationsSummary} className="border-white/10 bg-white/[0.06] text-emerald-50/82" />
          </div>
          {leadGrantsCommand ? (
            <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-emerald-50/82">
              <p className="font-semibold text-emerald-50">Lead workspace grant command</p>
              <p className="mt-1">{leadGrantsCommand.detail}</p>
              <Link href={leadGrantsCommand.href} className="mt-3 inline-flex items-center gap-2 font-semibold text-emerald-100 transition hover:text-white">
                Open next grants action
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : null}
        </article>
      </header>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          <FundingOpportunityCreator
            programs={(programsData ?? []) as ProgramOption[]}
            projects={(projectsData ?? []) as ProjectOption[]}
            title="Log a funding opportunity"
            description="Create a shared grant record tied to a project or program so pursue, monitor, skip, award, and reimbursement work all point back to the same workspace truth."
          />

          <article className="module-section-surface">
            <div className="module-section-header">
              <div className="module-section-heading">
                <p className="module-section-label">Workspace queue</p>
                <h2 className="module-section-title">What should move next on the grants lane</h2>
                <p className="module-section-description">
                  These commands come from the same workspace runtime already feeding the assistant and RTP surfaces, but filtered here to the grants operating lane.
                </p>
              </div>
              <StatusBadge tone={grantsQueue.length > 0 ? "warning" : "success"}>
                {grantsQueue.length > 0 ? `${grantsQueue.length} queued` : "Queue clear"}
              </StatusBadge>
            </div>

            <div className="mt-5 grid gap-3">
              {grantsQueue.length > 0 ? (
                grantsQueue.map((item) => (
                  <Link key={item.key} href={item.href} className="module-subpanel block transition-colors hover:border-primary/35">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{item.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                      </div>
                      <StatusBadge tone={item.tone}>{item.tone === "warning" ? "Next" : "Queue"}</StatusBadge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {item.badges.map((badge) => (
                        <StatusBadge key={`${item.key}-${badge.label}`} tone="neutral">
                          {badge.label}
                          {badge.value !== null && badge.value !== undefined ? `: ${badge.value}` : ""}
                        </StatusBadge>
                      ))}
                    </div>
                  </Link>
                ))
              ) : (
                <div className="module-subpanel text-sm text-muted-foreground">
                  No immediate grants-specific queue pressure is visible from the current workspace snapshot.
                </div>
              )}
            </div>
          </article>

          <article id="grants-award-conversion-lane" className="module-section-surface">
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

            {leadAwardConversionOpportunity ? (
              <div className="mt-5">
                <ProjectFundingAwardCreator
                  projectId={leadAwardConversionOpportunity.project?.id ?? ""}
                  opportunityOptions={[{ id: leadAwardConversionOpportunity.id, title: leadAwardConversionOpportunity.title }]}
                  defaultOpportunityId={leadAwardConversionOpportunity.id}
                  defaultProgramId={leadAwardConversionOpportunity.program?.id ?? null}
                  defaultTitle={`${leadAwardConversionOpportunity.title} award`}
                  titleLabel="Create the lead award record now"
                  description={`Convert ${leadAwardConversionOpportunity.title} into a committed award record here so reimbursement and invoice truth can start from the shared grants lane.`}
                />
              </div>
            ) : null}

            <div className="mt-5 grid gap-3">
              {awardedOpportunitiesMissingRecords.length > 0 ? (
                awardedOpportunitiesMissingRecords.map((opportunity) => {
                  const projectHref = opportunity.project ? `/projects/${opportunity.project.id}#project-funding-opportunities` : null;
                  const programHref = opportunity.program ? `/programs/${opportunity.program.id}#program-funding-opportunities` : null;

                  return (
                    <div key={`award-gap-${opportunity.id}`} className="module-subpanel">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap gap-2">
                            <StatusBadge tone="warning">Award record missing</StatusBadge>
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
        </div>

        <article className="module-section-surface">
          <div className="module-section-header">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[color:var(--pine)]/10 text-[color:var(--pine)]">
                <CalendarClock className="h-5 w-5" />
              </span>
              <div className="module-section-heading">
                <p className="module-section-label">Registry</p>
                <h2 className="module-section-title">Funding opportunities across the workspace</h2>
                <p className="module-section-description">
                  Review deadlines, decision posture, linked project/program context, and editable decision notes without hopping record-by-record first.
                </p>
              </div>
            </div>
            <span className="module-inline-item">
              <Sparkles className="h-3.5 w-3.5" />
              <strong>{filteredOpportunities.length}</strong> shown
            </span>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((status) => {
                const active = status === selectedStatus;
                return (
                  <Link
                    key={`status-${status}`}
                    href={buildGrantsFilterHref({ status, decision: selectedDecision })}
                    className={[
                      "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                      active
                        ? "border-[color:var(--pine)] bg-[color:var(--pine)]/10 text-[color:var(--pine-deep)]"
                        : "border-border/70 bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground",
                    ].join(" ")}
                  >
                    Status: {formatFilterLabel(status)}
                  </Link>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              {DECISION_FILTERS.map((decision) => {
                const active = decision === selectedDecision;
                return (
                  <Link
                    key={`decision-${decision}`}
                    href={buildGrantsFilterHref({ status: selectedStatus, decision })}
                    className={[
                      "rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors",
                      active
                        ? "border-[color:var(--pine)] bg-[color:var(--pine)]/10 text-[color:var(--pine-deep)]"
                        : "border-border/70 bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground",
                    ].join(" ")}
                  >
                    Decision: {formatFilterLabel(decision)}
                  </Link>
                );
              })}
            </div>
          </div>

          {opportunities.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No funding opportunities yet"
                description="Create the first funding opportunity so OpenPlan can start carrying real pursue, monitor, skip, award, and reimbursement posture in the shared workspace lane."
              />
            </div>
          ) : filteredOpportunities.length === 0 ? (
            <div className="mt-5">
              <EmptyState
                title="No opportunities match these filters"
                description="Try a broader status or decision filter to bring the workspace grants registry back into view."
              />
            </div>
          ) : (
            <div className="mt-5 module-record-list">
              {filteredOpportunities.map((opportunity) => {
                const projectHref = opportunity.project ? `/projects/${opportunity.project.id}#project-funding-opportunities` : null;
                const programHref = opportunity.program ? `/programs/${opportunity.program.id}#program-funding-opportunities` : null;
                const closesSoon = isClosingSoon(opportunity.closes_at);
                const decisionSoon = isDecisionSoon(opportunity.decision_due_at);

                return (
                  <div key={opportunity.id} className="module-record-row">
                    <div className="module-record-main">
                      <div className="module-record-kicker">
                        <StatusBadge tone={fundingOpportunityStatusTone(opportunity.opportunity_status)}>
                          {formatFundingOpportunityStatusLabel(opportunity.opportunity_status)}
                        </StatusBadge>
                        <StatusBadge tone={fundingOpportunityDecisionTone(opportunity.decision_state)}>
                          {formatFundingOpportunityDecisionLabel(opportunity.decision_state)}
                        </StatusBadge>
                        {closesSoon ? <StatusBadge tone="warning">Closing soon</StatusBadge> : null}
                        {decisionSoon ? <StatusBadge tone="warning">Decision due soon</StatusBadge> : null}
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

                      {(projectHref || programHref) ? (
                        <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
                          {projectHref ? (
                            <Link href={projectHref} className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]">
                              Open project funding lane
                              <ArrowRight className="h-4 w-4" />
                            </Link>
                          ) : null}
                          {programHref ? (
                            <Link href={programHref} className="inline-flex items-center gap-2 text-[color:var(--pine)] transition hover:text-[color:var(--pine-deep)]">
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
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </article>
      </div>
    </section>
  );
}
