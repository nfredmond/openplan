/**
 * Pursuit kind for a funding opportunity: a GRANT application (the default,
 * and everything the module did before migration 20260727000015) or a
 * PROPOSAL — an RFP/RFQ response run through the same registry, application
 * workspace, and export pipeline.
 *
 * The loader here is deliberately SEPARATE from `loadFundingOpportunityAccess`
 * and tolerant of the pending schema: on a deployment that predates the
 * migration, the pursuit columns do not exist, no proposal rows can exist
 * either, so everything truthfully resolves to 'grant' — disclosed via
 * `schemaPending`, never guessed.
 */

export const PURSUIT_KINDS = ["grant", "proposal"] as const;
export type PursuitKind = (typeof PURSUIT_KINDS)[number];

export const PURSUIT_MIGRATION = "20260727000015_pursuit_kind_and_solicitation";

export type OpportunityPursuitContext = {
  pursuitKind: PursuitKind;
  solicitationNumber: string | null;
  submissionFormatNote: string | null;
  questionsDueAt: string | null;
  /**
   * True when the deployment's database predates the pursuit migration. All
   * fields then carry their grant defaults — truthful, because a proposal row
   * cannot exist without the column.
   */
  schemaPending: boolean;
};

export function parsePursuitKind(value: unknown): PursuitKind {
  return value === "proposal" ? "proposal" : "grant";
}

const GRANT_DEFAULT_CONTEXT: OpportunityPursuitContext = {
  pursuitKind: "grant",
  solicitationNumber: null,
  submissionFormatNote: null,
  questionsDueAt: null,
  schemaPending: false,
};

/** Postgres/PostgREST shapes for "the pursuit columns are not migrated yet". */
export function looksLikePendingPursuitSchema(message: string | null | undefined): boolean {
  return /column .* does not exist|could not find the .* column|schema cache/i.test(message ?? "");
}

type QueryError = { message: string } | null;
type MaybeSingleResult = PromiseLike<{ data: unknown; error: QueryError }>;
type PursuitQueryClientLike = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: unknown) => { maybeSingle: () => MaybeSingleResult };
    };
  };
};

function asOptionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Load one opportunity's pursuit context through the caller's RLS-scoped
 * client. A pending schema resolves to the grant defaults with
 * `schemaPending: true`; any other read failure is returned as an error for
 * the route to surface — a proposal must never silently degrade to a grant
 * because of a transient failure.
 */
export async function loadOpportunityPursuitContext(
  supabase: unknown,
  opportunityId: string
): Promise<{ context: OpportunityPursuitContext; error: { message: string } | null }> {
  const client = supabase as PursuitQueryClientLike;
  const { data, error } = await client
    .from("funding_opportunities")
    .select("id, pursuit_kind, solicitation_number, submission_format_note, questions_due_at")
    .eq("id", opportunityId)
    .maybeSingle();

  if (error) {
    if (looksLikePendingPursuitSchema(error.message)) {
      return { context: { ...GRANT_DEFAULT_CONTEXT, schemaPending: true }, error: null };
    }
    return { context: GRANT_DEFAULT_CONTEXT, error };
  }

  const record = (data ?? null) as Record<string, unknown> | null;
  if (!record) {
    // The caller has already authorized the opportunity; a vanished row reads
    // as the grant default rather than a second not-found path.
    return { context: GRANT_DEFAULT_CONTEXT, error: null };
  }

  return {
    context: {
      pursuitKind: parsePursuitKind(record.pursuit_kind),
      solicitationNumber: asOptionalString(record.solicitation_number),
      submissionFormatNote: asOptionalString(record.submission_format_note),
      questionsDueAt: asOptionalString(record.questions_due_at),
      schemaPending: false,
    },
    error: null,
  };
}

/**
 * Put the pursuit columns back onto an opportunity row before it is drafted from.
 *
 * ============================================== THE DEFECT THIS CLOSES
 *
 * `loadFundingOpportunityAccess` selects a FIXED column list that does not
 * include `pursuit_kind`, `solicitation_number`, `submission_format_note` or
 * `questions_due_at`. Every drafting path that used its row directly therefore
 * saw `pursuit_kind: undefined`, so `isProposal` was PERMANENTLY FALSE: a
 * planner answering an RFP got a draft with no solicitation number, no
 * submission-format note, no questions-due date and no past-performance
 * grounding, with nothing anywhere saying something had been dropped.
 *
 * The per-section drafter had already worked around it by loading the pursuit
 * context and spreading it over the row by hand. The standalone narrative
 * drafter had not. Two doors into one feature, disagreeing silently — the seam
 * defect CLAUDE.md names, and found by the 2026-08-06 foundation audit
 * (SWEEP_A3).
 *
 * ============================ WHY NOT JUST WIDEN THE SHARED PROJECTION
 *
 * Because it would break every funding route on a deployment that predates
 * migration 20260727000015. `loadFundingOpportunityAccess` returns any read
 * error to its caller, so adding a column that does not exist yet turns a
 * working opportunity page into a 500. The tolerance lives HERE, deliberately —
 * see this module's header — and this helper is how a caller gets the columns
 * without giving up that tolerance.
 *
 * PURE, and it takes the context rather than loading it. The loading stays at
 * the call site — each route already has to decide what to do with a read
 * error, and a proposal must never degrade into a grant because of a transient
 * failure. What is shared here is the MERGE, because the merge is what the two
 * doors disagreed about.
 */
export function withPursuitColumns<T extends object>(
  opportunity: T,
  context: OpportunityPursuitContext
): T & {
  pursuit_kind: PursuitKind;
  solicitation_number: string | null;
  submission_format_note: string | null;
  questions_due_at: string | null;
} {
  return {
    ...opportunity,
    pursuit_kind: context.pursuitKind,
    solicitation_number: context.solicitationNumber,
    submission_format_note: context.submissionFormatNote,
    questions_due_at: context.questionsDueAt,
  };
}
