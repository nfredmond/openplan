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
