import { canAccessWorkspaceAction } from "@/lib/auth/role-matrix";

type QueryError = {
  message: string;
  code?: string | null;
} | null;

type MembershipRow = {
  workspace_id: string;
  role: string;
};

type ProgramRow = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  title?: string | null;
  program_type?: string | null;
  status?: string | null;
  cycle_name?: string | null;
  funding_classification?: string | null;
  sponsor_agency?: string | null;
  owner_label?: string | null;
  cadence_label?: string | null;
  fiscal_year_start?: number | null;
  fiscal_year_end?: number | null;
  nomination_due_at?: string | null;
  adoption_target_at?: string | null;
  summary?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type FundingOpportunityRow = {
  id: string;
  workspace_id: string;
  program_id: string | null;
  project_id: string | null;
  title?: string | null;
  opportunity_status?: string | null;
  decision_state?: string | null;
  agency_name?: string | null;
  owner_label?: string | null;
  cadence_label?: string | null;
  opens_at?: string | null;
  closes_at?: string | null;
  decision_due_at?: string | null;
  fit_notes?: string | null;
  readiness_notes?: string | null;
  decision_rationale?: string | null;
  decided_at?: string | null;
  summary?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type QueryEqBuilder<T> = {
  eq: (column: string, value: string) => QueryEqBuilder<T>;
  maybeSingle: () => PromiseLike<{ data: T | null; error: QueryError }>;
};

type QueryClientLike = {
  from: (table: string) => {
    select: (columns: string) => QueryEqBuilder<unknown>;
  };
};

function asQueryClient(value: unknown): QueryClientLike {
  return value as QueryClientLike;
}

export async function loadProgramAccess(
  supabase: unknown,
  programId: string,
  userId: string,
  action: "programs.read" | "programs.write"
) {
  const client = asQueryClient(supabase);
  const { data: program, error: programError } = (await client
    .from("programs")
    .select(
      "id, workspace_id, project_id, title, program_type, status, cycle_name, funding_classification, sponsor_agency, owner_label, cadence_label, fiscal_year_start, fiscal_year_end, nomination_due_at, adoption_target_at, summary, created_at, updated_at"
    )
    .eq("id", programId)
    .maybeSingle()) as Awaited<{ data: ProgramRow | null; error: QueryError }>;

  if (programError) {
    return { supabase, program: null, membership: null, error: programError };
  }

  if (!program) {
    return { supabase, program: null, membership: null, error: null };
  }

  const { data: membership, error: membershipError } = (await client
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", program.workspace_id)
    .eq("user_id", userId)
    .maybeSingle()) as Awaited<{ data: MembershipRow | null; error: QueryError }>;

  if (membershipError) {
    return { supabase, program, membership: null, error: membershipError };
  }

  return {
    supabase,
    program,
    membership,
    error: null,
    allowed: Boolean(membership && canAccessWorkspaceAction(action, membership.role)),
  };
}

export async function loadFundingOpportunityAccess(
  supabase: unknown,
  opportunityId: string,
  userId: string,
  action: "programs.read" | "programs.write"
) {
  const client = asQueryClient(supabase);
  const { data: opportunity, error: opportunityError } = (await client
    .from("funding_opportunities")
    .select(
      "id, workspace_id, program_id, project_id, title, opportunity_status, decision_state, agency_name, owner_label, cadence_label, opens_at, closes_at, decision_due_at, fit_notes, readiness_notes, decision_rationale, decided_at, summary, created_at, updated_at"
    )
    .eq("id", opportunityId)
    .maybeSingle()) as Awaited<{ data: FundingOpportunityRow | null; error: QueryError }>;

  if (opportunityError) {
    return { supabase, opportunity: null, membership: null, error: opportunityError };
  }

  if (!opportunity) {
    return { supabase, opportunity: null, membership: null, error: null };
  }

  const { data: membership, error: membershipError } = (await client
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", opportunity.workspace_id)
    .eq("user_id", userId)
    .maybeSingle()) as Awaited<{ data: MembershipRow | null; error: QueryError }>;

  if (membershipError) {
    return { supabase, opportunity, membership: null, error: membershipError };
  }

  return {
    supabase,
    opportunity,
    membership,
    error: null,
    allowed: Boolean(membership && canAccessWorkspaceAction(action, membership.role)),
  };
}
