/**
 * The project lists — the part of an RTP a board actually turns to.
 *
 * Grouped by PERIOD first and portfolio role second, because that is the
 * question being asked of the document: what are we committing to in the next
 * ten years, what comes later, and what is on the illustrative list if more
 * money appears. A flat list sorted by priority score answers a different
 * question, and answers this one badly.
 *
 * Three things this deliberately does NOT do:
 *
 *   - It does not sum unpriced projects as zero. A group with an unpriced
 *     project reports its subtotal as PARTIAL and says how many are missing,
 *     because a subtotal that silently omits a project reads as complete.
 *   - It does not put illustrative projects in the same total as constrained
 *     ones. They are outside the fiscally constrained programme by regulation,
 *     and adding them would misstate what the plan commits to.
 *   - It does not present the project's programmed cost and its funding gap as
 *     the same kind of number. The cost is what this plan programmes; the
 *     funding figures come from `project_funding_profiles` and are about
 *     raising money for the project generally. Two different questions, so
 *     they are labelled rather than merged.
 */
import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { EmptyState, StateBlock } from "@/components/ui/state-block";
import { StatusBadge } from "@/components/ui/status-badge";
import { parseOptionalAmount } from "@/lib/money/optional-amount";
import {
  formatRtpPortfolioRoleLabel,
  rtpPortfolioRoleTone,
} from "@/lib/rtp/catalog";
import { priorityTierLabel, priorityTierTone } from "@/lib/rtp/priority-scoring";
import { projectFundingStackTone } from "@/lib/projects/funding";
import { formatMoney } from "@/lib/money/format";

type FundingPipelineStatus = Parameters<typeof projectFundingStackTone>[0];

export type RtpProgrammeListBand = {
  id: string;
  label: string;
  startYear: number;
  endYear: number;
};

export type RtpProgrammeListEntry = {
  id: string;
  portfolioRole: string;
  horizonBandId: string | null;
  estimatedCost: number | string | null;
  costBasisYear: number | null;
  priorityRationale: string | null;
  project: { id: string; name: string; status: string | null; summary: string | null } | null;
  priority: {
    summary: { composite: number; scoredCriteria: number; tier: "high" | "medium" | "low" | "unscored" };
    narrative: string;
  };
  funding: {
    pipelineLabel: string;
    pipelineStatus: FundingPipelineStatus;
    committedFundingAmount: number;
    unfundedAfterLikelyAmount: number;
  };
};

/** Roles in the order a plan presents them. Candidate last: it is not in the plan yet. */
const ROLE_ORDER = ["constrained", "illustrative", "candidate"] as const;

type Group = {
  key: string;
  bandLabel: string;
  bandYears: string | null;
  role: string;
  entries: RtpProgrammeListEntry[];
  pricedTotal: number;
  unpricedCount: number;
};

function buildGroups(
  entries: readonly RtpProgrammeListEntry[],
  bands: readonly RtpProgrammeListBand[]
): Group[] {
  const bandById = new Map(bands.map((band) => [band.id, band]));
  const groups = new Map<string, Group>();

  for (const entry of entries) {
    const band = entry.horizonBandId ? bandById.get(entry.horizonBandId) : undefined;
    // A project in no period is not hidden — it gets its own group, because a
    // costed project belonging to no period is a gap a planner has to close.
    const bandKey = band?.id ?? "__unassigned__";
    const key = `${bandKey}::${entry.portfolioRole}`;

    const group =
      groups.get(key) ??
      ({
        key,
        bandLabel: band?.label ?? "No period assigned",
        bandYears: band ? `${band.startYear}–${band.endYear}` : null,
        role: entry.portfolioRole,
        entries: [],
        pricedTotal: 0,
        unpricedCount: 0,
      } satisfies Group);

    group.entries.push(entry);
    const cost = parseOptionalAmount(entry.estimatedCost);
    if (cost === null) group.unpricedCount += 1;
    else group.pricedTotal += cost;

    groups.set(key, group);
  }

  const bandOrder = new Map(bands.map((band, index) => [band.id, index]));
  return [...groups.values()].sort((a, b) => {
    const aBand = a.key.split("::")[0];
    const bBand = b.key.split("::")[0];
    const aIndex = bandOrder.get(aBand) ?? Number.MAX_SAFE_INTEGER;
    const bIndex = bandOrder.get(bBand) ?? Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return (
      ROLE_ORDER.indexOf(a.role as (typeof ROLE_ORDER)[number]) -
      ROLE_ORDER.indexOf(b.role as (typeof ROLE_ORDER)[number])
    );
  });
}

function subtotalLine(group: Group): string {
  if (group.entries.length === 0) return "No projects";
  if (group.unpricedCount === 0) {
    return `${formatMoney(group.pricedTotal, { precision: "whole" })} across ${group.entries.length} project${group.entries.length === 1 ? "" : "s"}`;
  }
  if (group.unpricedCount === group.entries.length) {
    // Never "$0" — that is the misreading this whole lane guards against.
    return `No costs recorded for ${group.entries.length === 1 ? "this project" : `these ${group.entries.length} projects`}`;
  }
  // The plural belongs to the TOTAL and the verb agrees with the count:
  // "1 of 2 projects has", "2 of 3 projects have".
  return `${formatMoney(group.pricedTotal, { precision: "whole" })} so far — ${group.unpricedCount} of ${group.entries.length} projects ${group.unpricedCount === 1 ? "has" : "have"} no cost recorded`;
}

export function RtpProgrammeLists({
  entries,
  bands,
  readFailed,
}: {
  entries: readonly RtpProgrammeListEntry[];
  bands: readonly RtpProgrammeListBand[];
  readFailed: boolean;
}) {
  const groups = buildGroups(entries, bands);

  return (
    <article className="module-section-surface">
      <div className="module-section-header">
        <div className="module-section-heading">
          <p className="module-section-label">Project lists</p>
          <h2 className="module-section-title">What this plan commits to, and when</h2>
          <p className="module-section-description">
            Grouped by the period that pays for them, then by whether they are in the fiscally
            constrained programme or on the illustrative list.
          </p>
        </div>
        <span className="flex h-11 w-11 items-center justify-center rounded-[0.6rem] border border-border/70 bg-muted/40 text-muted-foreground">
          <FolderKanban className="h-5 w-5" />
        </span>
      </div>

      {readFailed ? (
        <StateBlock
          tone="danger"
          title="The project lists could not be read"
          description="The projects attached to this cycle could not be loaded, so no lists are shown. This is not a finding that the plan has no projects."
        />
      ) : groups.length === 0 ? (
        <EmptyState
          title="No projects are in this plan yet"
          description="Attach projects to this cycle from a project's own page. Once attached, record what each one costs in this plan and which period pays for it, and the lists below fill in."
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <section key={group.key} className="rounded-[0.5rem] border border-border/60">
              <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/50 px-4 py-2.5">
                <div>
                  <h3 className="text-sm font-semibold tracking-tight">
                    {group.bandLabel}
                    {group.bandYears ? (
                      <span className="ml-1.5 font-normal text-muted-foreground">{group.bandYears}</span>
                    ) : null}
                  </h3>
                  <StatusBadge tone={rtpPortfolioRoleTone(group.role)}>
                    {formatRtpPortfolioRoleLabel(group.role)}
                  </StatusBadge>
                </div>
                <p className="text-xs text-muted-foreground">{subtotalLine(group)}</p>
              </header>

              <ul className="divide-y divide-border/40">
                {group.entries.map((entry) => {
                  const cost = parseOptionalAmount(entry.estimatedCost);
                  return (
                    <li key={entry.id} className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h4 className="text-sm font-medium">
                          {entry.project?.id ? (
                            <Link href={`/projects/${entry.project.id}`} className="module-inline-action">
                              {entry.project.name}
                            </Link>
                          ) : (
                            (entry.project?.name ?? "Linked project")
                          )}
                        </h4>
                        <span className="text-sm tabular-nums">
                          {cost === null ? (
                            <span className="text-muted-foreground">No cost recorded</span>
                          ) : (
                            <>
                              {formatMoney(cost, { precision: "whole" })}
                              {entry.costBasisYear ? (
                                <span className="ml-1 text-xs text-muted-foreground">
                                  ({entry.costBasisYear} dollars)
                                </span>
                              ) : null}
                            </>
                          )}
                        </span>
                      </div>

                      <p className="mt-1 text-xs text-muted-foreground">
                        {entry.priority.summary.scoredCriteria > 0
                          ? entry.priority.narrative
                          : entry.priorityRationale?.trim() ||
                            entry.project?.summary?.trim() ||
                            "No prioritization rationale recorded yet."}
                      </p>

                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        {entry.priority.summary.scoredCriteria > 0 ? (
                          <StatusBadge tone={priorityTierTone(entry.priority.summary.tier)}>
                            Priority {entry.priority.summary.composite}/100 ·{" "}
                            {priorityTierLabel(entry.priority.summary.tier)}
                          </StatusBadge>
                        ) : null}
                        <StatusBadge tone={projectFundingStackTone(entry.funding.pipelineStatus)}>
                          {entry.funding.pipelineLabel}
                        </StatusBadge>
                        {/*
                          Labelled as the project's OWN funding, not as this
                          plan's cost. They answer different questions and a
                          reader who merges them will think the plan is funded.
                        */}
                        <span className="text-[0.7rem] text-muted-foreground">
                          Project funding: {formatMoney(entry.funding.committedFundingAmount, { precision: "whole" })} committed ·{" "}
                          {formatMoney(entry.funding.unfundedAfterLikelyAmount, { precision: "whole" })} still to raise
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </article>
  );
}
