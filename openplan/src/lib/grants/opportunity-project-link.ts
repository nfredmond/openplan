import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which records tie a funding opportunity to the project it is linked to.
 *
 * An opportunity's `project_id` decides which project's evidence its
 * application drafts, Safety seed, exports, map packages and award handoff are
 * built from. Once one of those records exists, it was built against THAT
 * project. Moving the opportunity to another project (or unlinking it) would
 * leave each record claiming evidence from a project the opportunity no longer
 * names, and the award handoff would stop matching its award. So the lifecycle
 * rule is:
 *
 * - First link (no project yet): allowed, unless an award recorded against this
 *   opportunity sits on a different project. Nothing project-bound can exist
 *   yet: the Safety seed, map packages and handoff all require a linked project.
 * - Relink or unlink: allowed only while nothing in the list below exists.
 *   There is no override. The planner tracks a new opportunity for the other
 *   project, which keeps the old records intact and readable.
 *
 * The database does not enforce this rule or the same-workspace rule (no
 * trigger or composite key covers `funding_opportunities.project_id`), so the
 * opportunity PATCH route enforces both before it writes.
 */

/** Anchor of the project link control; the ATP panel's "Link a project" prompt points at it. */
export function projectLinkAnchorId(opportunityId: string): string {
  return `funding-opportunity-${opportunityId}-project`;
}

export type OpportunityProjectLinkBlocker =
  | "awarded_status"
  | "award"
  | "award_on_other_project"
  | "award_handoff"
  | "final_section"
  | "section_draft"
  | "narrative_draft"
  | "application_export"
  | "safety_seed"
  | "map_package"
  | "attached_evidence";

/** Plain words for each blocker, as they appear in the refusal sentence. */
const OPPORTUNITY_PROJECT_LINK_BLOCKER_LABELS: Record<OpportunityProjectLinkBlocker, string> = {
  awarded_status: "an awarded status",
  award: "a recorded award",
  award_on_other_project: "an award recorded on a different project",
  award_handoff: "an award handoff",
  final_section: "a finalized application section",
  section_draft: "an application section draft",
  narrative_draft: "a narrative draft",
  application_export: "an exported application",
  safety_seed: "a Safety plan seed",
  map_package: "a map package",
  attached_evidence: "attached project evidence",
};

type CountQuery = {
  table: string;
  blocker: OpportunityProjectLinkBlocker;
  /** Column holding the opportunity id on that table. */
  opportunityColumn: string;
  narrow?: (query: CountFilter, targetProjectId: string | null) => CountFilter;
};

/** The filter surface the checks use; a PostgREST builder satisfies it. */
type CountFilter = {
  eq(column: string, value: string): CountFilter;
  neq(column: string, value: string): CountFilter;
  or(filters: string): CountFilter;
} & PromiseLike<{ count: number | null; error: { message?: string | null } | null }>;

/** Records built against the linked project. Any one of them blocks a relink or unlink. */
const RELINK_DEPENDENTS: CountQuery[] = [
  { table: "funding_awards", blocker: "award", opportunityColumn: "funding_opportunity_id" },
  { table: "funding_award_handoff_revisions", blocker: "award_handoff", opportunityColumn: "opportunity_id" },
  {
    table: "funding_opportunity_application_sections",
    blocker: "final_section",
    opportunityColumn: "opportunity_id",
    narrow: (query) => query.eq("status", "final"),
  },
  { table: "funding_opportunity_section_drafts", blocker: "section_draft", opportunityColumn: "opportunity_id" },
  { table: "funding_opportunity_narrative_drafts", blocker: "narrative_draft", opportunityColumn: "opportunity_id" },
  { table: "funding_opportunity_application_exports", blocker: "application_export", opportunityColumn: "opportunity_id" },
  { table: "funding_opportunity_safety_seeds", blocker: "safety_seed", opportunityColumn: "opportunity_id" },
  { table: "project_map_packages", blocker: "map_package", opportunityColumn: "funding_opportunity_id" },
  {
    table: "funding_opportunity_attachments",
    blocker: "attached_evidence",
    opportunityColumn: "opportunity_id",
    narrow: (query) => query.or("kb_document_id.not.is.null,report_artifact_id.not.is.null"),
  },
];

/** On a first link, only an award already recorded on another project conflicts. */
const FIRST_LINK_AWARD_CHECK: CountQuery = {
  table: "funding_awards",
  blocker: "award_on_other_project",
  opportunityColumn: "funding_opportunity_id",
  narrow: (query, targetProjectId) => (targetProjectId ? query.neq("project_id", targetProjectId) : query),
};

export type OpportunityProjectLinkCheck =
  | { kind: "allowed" }
  | { kind: "refused"; blockers: OpportunityProjectLinkBlocker[] }
  | { kind: "failed"; table: string; message: string };

async function countRows(client: SupabaseClient, check: CountQuery, opportunityId: string, targetProjectId: string | null) {
  let query = client
    .from(check.table)
    .select("*", { count: "exact", head: true })
    .eq(check.opportunityColumn, opportunityId) as unknown as CountFilter;
  if (check.narrow) query = check.narrow(query, targetProjectId);
  const { count, error } = await query;
  return { check, count, error };
}

/**
 * Decide whether an opportunity may move from `currentProjectId` to
 * `targetProjectId`. Reads through the caller's own client; the caller has
 * already passed the opportunity's write gate, so every row read here is in
 * the opportunity's workspace. A count the database did not report is a
 * failure, never a zero.
 */
export async function checkOpportunityProjectLinkChange(
  client: SupabaseClient,
  opportunity: { id: string; project_id: string | null; opportunity_status?: string | null },
  targetProjectId: string | null
): Promise<OpportunityProjectLinkCheck> {
  if (opportunity.project_id === targetProjectId) return { kind: "allowed" };

  const checks: CountQuery[] =
    opportunity.project_id === null
      ? [FIRST_LINK_AWARD_CHECK]
      : RELINK_DEPENDENTS;

  const results = await Promise.all(
    checks.map((check) => countRows(client, check, opportunity.id, targetProjectId))
  );

  for (const result of results) {
    if (result.error || typeof result.count !== "number") {
      return {
        kind: "failed",
        table: result.check.table,
        message: result.error?.message?.trim() || "count not reported",
      };
    }
  }

  const blockers: OpportunityProjectLinkBlocker[] = [];
  if (opportunity.project_id !== null && opportunity.opportunity_status === "awarded") blockers.push("awarded_status");
  for (const result of results) {
    if ((result.count ?? 0) > 0) blockers.push(result.check.blocker);
  }

  return blockers.length > 0 ? { kind: "refused", blockers } : { kind: "allowed" };
}

/** The refusal sentence a planner reads, listing what holds the current link. */
export function describeOpportunityProjectLinkRefusal(blockers: OpportunityProjectLinkBlocker[]): string {
  const labels = blockers.map((blocker) => OPPORTUNITY_PROJECT_LINK_BLOCKER_LABELS[blocker]);
  const list =
    labels.length <= 1
      ? labels.join("")
      : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  if (blockers.includes("award_on_other_project") && blockers.length === 1) {
    return `This opportunity has ${list}. Link that project, or track a new opportunity.`;
  }
  return `This opportunity has ${list} built from its current project. Track a new opportunity for the other project.`;
}
