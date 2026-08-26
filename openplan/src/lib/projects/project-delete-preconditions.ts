/**
 * What has to be true before a project can be deleted.
 *
 * THE PROBLEM. `projects` is the spine: 16 tables cascade from it and 17 more
 * hold a nullable `project_id` that `ON DELETE SET NULL` would quietly blank.
 * A single `DELETE` therefore destroys reports, scenario sets, funding awards,
 * BCA screenings, spend entries and the whole delivery record, and orphans every
 * model run, campaign, invoice and crash acquisition that pointed at it. No
 * confirmation dialog is informed enough to authorize that, because the person
 * clicking it cannot see what is attached.
 *
 * THE RULE. A delete succeeds only when the project carries nothing. Anything
 * attached is a blocker, the refusal names it and where to find it, and the
 * offered alternative is a status change — retiring a project is reversible,
 * deleting it is not.
 *
 * There is deliberately NO force flag. A `?confirm=cascade` escape hatch would
 * reintroduce exactly the uninformed bulk destruction this exists to prevent.
 * A planner who genuinely wants a project gone can detach or delete its children
 * through the modules that own them — each step deliberate, audited, and
 * individually reversible — and then delete the empty shell.
 *
 * `blocking` versus `evidence` is about what the refusal SAYS, not about whether
 * it refuses; both do. `blocking` marks records that represent an external
 * commitment — money already claimed from a funder or billed to a client —
 * where "delete the children first" is not honest advice, because those records
 * are supposed to outlive the project. Those say so explicitly.
 *
 * This module is pure so the policy is testable without a database, and so the
 * rule lives in one place instead of being re-derived in a route and a dialog.
 */

export type ProjectDeleteBlockerSeverity = "blocking" | "evidence";

/** How the row behaves if the project is deleted, straight from the FK definition. */
export type ProjectDeleteCascadeBehavior = "cascade" | "orphan" | "restrict";

export type ProjectDeleteRelation = {
  /** Table holding the reference. */
  table: string;
  /** Column holding it. Naming it keeps the inventory and count query checkable. */
  column: string;
  /** What a planner calls these records. */
  label: string;
  severity: ProjectDeleteBlockerSeverity;
  behavior: ProjectDeleteCascadeBehavior;
  /** Where to go to deal with them. `{projectId}` is substituted by the caller. */
  href: string;
  /**
   * Overrides the severity-derived sentence when the generic one understates
   * what is lost. Kept optional so the default stays the rule and an override
   * has to be argued for.
   */
  describeLoss?: (count: number) => string;
};

export type ProjectDeleteBlocker = ProjectDeleteRelation & {
  count: number;
  /** Why this record stops the delete, in one sentence a planner can act on. */
  reason: string;
};

export type ProjectDeleteAssessment = {
  deletable: boolean;
  blockers: ProjectDeleteBlocker[];
  /** True when at least one blocker is an external financial commitment. */
  hasCommitments: boolean;
  /** One-line summary for the refusal body. */
  headline: string;
  /** The reversible alternative, always offered. */
  alternative: string;
};

/**
 * Every foreign key into `projects`, with what losing it would mean.
 *
 * `project-delete-preconditions.test.ts` reads the migrations and fails if a
 * table references `projects` and is missing here — otherwise the next module to
 * hang off a project would be destroyed by a delete that never mentioned it.
 */
export const PROJECT_DELETE_RELATIONS: readonly ProjectDeleteRelation[] = [
  // External commitments. These outlive the project by design.
  {
    table: "billing_invoice_records",
    column: "project_id",
    label: "reimbursement invoices",
    severity: "blocking",
    behavior: "orphan",
    href: "/invoicing",
  },
  {
    table: "client_invoices",
    column: "project_id",
    label: "client invoices",
    severity: "blocking",
    behavior: "orphan",
    href: "/invoicing",
  },
  {
    table: "funding_awards",
    column: "project_id",
    label: "funding awards",
    severity: "blocking",
    behavior: "cascade",
    href: "/grants",
  },

  // Work products destroyed outright by the cascade.
  { table: "reports", column: "project_id", label: "reports", severity: "evidence", behavior: "cascade", href: "/reports" },
  { table: "scenario_sets", column: "project_id", label: "scenario sets", severity: "evidence", behavior: "cascade", href: "/scenarios" },
  { table: "safety_road_context_features", column: "project_id", label: "cached Safety road context", severity: "evidence", behavior: "cascade", href: "/safety" },
  { table: "project_bca_screenings", column: "project_id", label: "BCA screenings", severity: "evidence", behavior: "cascade", href: "/projects/{projectId}" },
  { table: "project_spend_entries", column: "project_id", label: "spend entries", severity: "evidence", behavior: "cascade", href: "/projects/{projectId}" },
  { table: "project_funding_profiles", column: "project_id", label: "funding profile", severity: "evidence", behavior: "cascade", href: "/projects/{projectId}" },
  {
    table: "project_rtp_cycle_links",
    column: "project_id",
    label: "RTP portfolio placements",
    severity: "evidence",
    behavior: "cascade",
    href: "/rtp",
    // Since 20260805000003 this row carries the project's COST in a plan's
    // fiscally constrained programme, so the cascade can remove a line item
    // from a financial element a board has already adopted. The generic
    // "would be deleted along with the project" does not say that.
    //
    // The severity here is the DEFAULT, not the rule. The rule — recorded on
    // 2026-08-05 and implemented 2026-08-10 — is "blocking only when the
    // placement is constrained AND costed": blanket `blocking` would make
    // every project linked to any cycle undeletable, including uncosted
    // candidates, which is most of them. `assessProjectDelete` upgrades this
    // relation when the caller supplies `constrainedCostedPlacementCount > 0`
    // (a filtered count over portfolio_role = 'constrained' AND
    // estimated_cost NOT NULL); a caller that cannot supply it degrades to
    // this evidence copy — the refusal itself happens either way.
    describeLoss: (count) =>
      `${pluralize(count, "RTP portfolio placements")} would be deleted along with the project. Where a placement carries a cost in a fiscally constrained plan, that line item disappears from the plan's financial element.`,
  },
  { table: "project_milestones", column: "project_id", label: "milestones", severity: "evidence", behavior: "cascade", href: "/projects/{projectId}" },
  { table: "project_submittals", column: "project_id", label: "submittals", severity: "evidence", behavior: "cascade", href: "/projects/{projectId}" },
  { table: "project_deliverables", column: "project_id", label: "deliverables", severity: "evidence", behavior: "cascade", href: "/projects/{projectId}" },
  { table: "project_risks", column: "project_id", label: "risks", severity: "evidence", behavior: "cascade", href: "/projects/{projectId}" },
  { table: "project_issues", column: "project_id", label: "issues", severity: "evidence", behavior: "cascade", href: "/projects/{projectId}" },
  { table: "project_decisions", column: "project_id", label: "decisions", severity: "evidence", behavior: "cascade", href: "/projects/{projectId}" },
  // Stage-gate decisions are append-only by design — there is no route that
  // deletes one, because a verdict is superseded by recording the next one, not
  // by erasing it. So a project that has ever been formally gated is, in
  // practice, permanently undeletable. That is the intended reading of "a delete
  // succeeds only when the project carries nothing": the reversible alternative
  // (retire the project) is the right answer for a project with a governance
  // record, and the refusal now names those decisions instead of cascading them
  // away unmentioned.
  { table: "stage_gate_decisions", column: "project_id", label: "stage-gate decisions", severity: "evidence", behavior: "cascade", href: "/projects/{projectId}#project-governance" },
  { table: "project_meetings", column: "project_id", label: "meetings", severity: "evidence", behavior: "cascade", href: "/projects/{projectId}" },
  { table: "data_dataset_project_links", column: "project_id", label: "linked datasets", severity: "evidence", behavior: "cascade", href: "/data-hub" },
  { table: "aerial_project_posture", column: "project_id", label: "aerial posture", severity: "evidence", behavior: "cascade", href: "/aerial" },
  // A coverage row records that a campaign's public input was ABOUT this
  // project; deleting the project silently disconnects that input from it.
  { table: "engagement_campaign_projects", column: "project_id", label: "engagement campaign coverage links", severity: "evidence", behavior: "cascade", href: "/engagement" },
  // A reminder is the record that a named person WAS TOLD a deadline on this
  // project was coming (20260811000007). `evidence` rather than `blocking`:
  // nothing outside OpenPlan relies on it, so it must not stop a delete — but
  // it is exactly the kind of row whose disappearance nobody notices, and "were
  // we warned?" is a question that gets asked after a deadline is missed rather
  // than before.
  { table: "work_notifications", column: "project_id", label: "deadline reminders", severity: "evidence", behavior: "cascade", href: "/my-work" },
  {
    table: "project_portfolio_import_rows",
    column: "created_project_id",
    label: "portfolio import audit rows",
    severity: "evidence",
    behavior: "restrict",
    href: "/projects#import-project-list",
    describeLoss: (count) =>
      `${pluralize(count, "portfolio import audit rows")} permanently identifies this project as the result of a reviewed source row. The immutable source history prevents deletion; mark the project complete instead.`,
  },

  // Work that survives but loses its attribution.
  { table: "models", column: "project_id", label: "models", severity: "evidence", behavior: "orphan", href: "/models" },
  { table: "model_runs", column: "project_id", label: "model runs", severity: "evidence", behavior: "orphan", href: "/models" },
  { table: "runs", column: "project_id", label: "analysis runs", severity: "evidence", behavior: "orphan", href: "/explore" },
  { table: "county_runs", column: "project_id", label: "county runs", severity: "evidence", behavior: "orphan", href: "/county-runs" },
  { table: "engagement_campaigns", column: "project_id", label: "engagement campaigns", severity: "evidence", behavior: "orphan", href: "/engagement" },
  { table: "funding_opportunities", column: "project_id", label: "funding opportunities", severity: "evidence", behavior: "orphan", href: "/grants" },
  { table: "safety_crash_ingests", column: "project_id", label: "crash acquisitions", severity: "evidence", behavior: "orphan", href: "/safety" },
  { table: "kb_documents", column: "project_id", label: "knowledge-base documents", severity: "evidence", behavior: "orphan", href: "/knowledge-base" },
  // A workspace GIS layer scoped to a project (20260812000015). ON DELETE SET
  // NULL, so the layer and every shape in it survive — what is lost is the
  // statement that this bike network or this parcel extract was uploaded FOR
  // this project, after which it reads as agency-wide data of unknown origin.
  { table: "workspace_gis_layers", column: "project_id", label: "map layers", severity: "evidence", behavior: "orphan", href: "/data-hub" },
  { table: "land_use_plan_implementation_actions", column: "project_id", label: "land-use plan implementation actions", severity: "evidence", behavior: "orphan", href: "/land-use-plans" },
  { table: "project_corridors", column: "project_id", label: "corridors", severity: "evidence", behavior: "orphan", href: "/projects/{projectId}" },
  { table: "aerial_missions", column: "project_id", label: "aerial missions", severity: "evidence", behavior: "orphan", href: "/aerial" },
  { table: "aerial_evidence_packages", column: "project_id", label: "aerial evidence packages", severity: "evidence", behavior: "orphan", href: "/aerial" },
  { table: "aerial_processing_jobs", column: "project_id", label: "aerial processing jobs", severity: "evidence", behavior: "orphan", href: "/aerial" },
  { table: "invoicing_engagements", column: "project_id", label: "invoicing engagements", severity: "evidence", behavior: "orphan", href: "/invoicing" },
  { table: "plans", column: "project_id", label: "plans", severity: "evidence", behavior: "orphan", href: "/plans" },
  { table: "programs", column: "project_id", label: "programs", severity: "evidence", behavior: "orphan", href: "/programs" },
];

function pluralize(count: number, label: string): string {
  // Labels are already plural nouns; a count of one reads better singularized on
  // the simple cases and is left alone otherwise.
  if (count !== 1) return `${count} ${label}`;
  const singular = label.endsWith("ies")
    ? `${label.slice(0, -3)}y`
    : label.endsWith("s")
      ? label.slice(0, -1)
      : label;
  return `1 ${singular}`;
}

function reasonFor(relation: ProjectDeleteRelation, count: number): string {
  if (relation.describeLoss) return relation.describeLoss(count);

  if (relation.severity === "blocking") {
    return relation.behavior === "cascade"
      ? `${pluralize(count, relation.label)} would be destroyed. A funding commitment is a record of what was awarded; it is meant to outlive the project.`
      : relation.behavior === "orphan"
        ? `${pluralize(count, relation.label)} would lose the project they were raised against, leaving a financial record that no longer names what it paid for.`
        : `${pluralize(count, relation.label)} prevents the project from being deleted.`;
  }

  return relation.behavior === "cascade"
    ? `${pluralize(count, relation.label)} would be deleted along with the project.`
    : relation.behavior === "orphan"
      ? `${pluralize(count, relation.label)} would survive but stop being attributed to any project.`
      : `${pluralize(count, relation.label)} prevents the project from being deleted.`;
}

/**
 * Decide whether a project may be deleted, given how many rows reference it.
 *
 * `counts` is keyed by table name; a table missing from the map counts as zero,
 * so a caller that cannot query a table (schema not yet applied) does not
 * accidentally read as "nothing attached". Callers that cannot count a relation
 * at all should pass it explicitly rather than omit it — see the route.
 */
export function assessProjectDelete(
  counts: Readonly<Record<string, number>>,
  options: {
    projectId: string;
    /**
     * How many of the project's RTP placements are CONSTRAINED AND COSTED
     * (portfolio_role = 'constrained' with a non-null estimated_cost) — the
     * filtered count the 2026-08-05 decision record asked for. Positive
     * upgrades the `project_rtp_cycle_links` blocker to `blocking`, because
     * deleting the project then removes a priced line item from a plan's
     * fiscally constrained programme — a record with standing beyond the
     * project, exactly like a funding award. Null/undefined means the caller
     * could not count (old caller, failed read) and the blocker keeps its
     * evidence copy; the refusal happens either way, so degrading the COPY is
     * the safe direction.
     */
    constrainedCostedPlacementCount?: number | null;
  }
): ProjectDeleteAssessment {
  const constrainedCosted = options.constrainedCostedPlacementCount ?? 0;

  const blockers = PROJECT_DELETE_RELATIONS.flatMap((relation) => {
    const count = counts[relation.table] ?? 0;
    if (count <= 0) return [];

    if (relation.table === "project_rtp_cycle_links" && constrainedCosted > 0) {
      return [
        {
          ...relation,
          severity: "blocking" as const,
          href: relation.href.replace("{projectId}", options.projectId),
          count,
          reason:
            `${pluralize(constrainedCosted, "RTP portfolio placements")} of this project's ${pluralize(count, "RTP portfolio placements")} ` +
            `${constrainedCosted === 1 ? "is" : "are"} constrained AND costed: deleting the project removes ` +
            `${constrainedCosted === 1 ? "a priced line item" : "priced line items"} from a plan's fiscally ` +
            "constrained programme, which a board may already have adopted.",
        },
      ];
    }

    return [
      {
        ...relation,
        href: relation.href.replace("{projectId}", options.projectId),
        count,
        reason: reasonFor(relation, count),
      },
    ];
  }).sort((left, right) => {
    // Commitments first, then the largest losses.
    if (left.severity !== right.severity) return left.severity === "blocking" ? -1 : 1;
    return right.count - left.count;
  });

  const hasCommitments = blockers.some((blocker) => blocker.severity === "blocking");

  if (blockers.length === 0) {
    return {
      deletable: true,
      blockers,
      hasCommitments,
      headline: "Nothing is attached to this project, so deleting it removes only the project record.",
      alternative: "",
    };
  }

  return {
    deletable: false,
    blockers,
    hasCommitments,
    headline: hasCommitments
      ? "This project carries records that are meant to outlive it — funding, invoicing, or a costed placement in a fiscally constrained plan — so it cannot be deleted."
      : `This project has ${pluralize(
          blockers.reduce((total, blocker) => total + blocker.count, 0),
          "attached records"
        )} across ${pluralize(blockers.length, "modules")}, so deleting it would take real work with it.`,
    alternative: hasCommitments
      ? "Set the project's status to complete to retire it. Its funding and invoicing history stays intact and attributable."
      : "Set the project's status to complete to retire it — that is reversible — or remove the attached records from the modules listed above and delete the empty project afterwards.",
  };
}
