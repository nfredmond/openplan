import type { ReadFailureLog } from "@/lib/ui/read-failures";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import type {
  DecisionRow,
  IssueRow,
  MeetingRow,
  MilestoneRow,
  RiskRow,
  SubmittalRow,
} from "./_types";

/**
 * The four narrative record lanes of a project control room — risks, issues,
 * decisions, meetings — loaded together because they fail together in exactly
 * the same way.
 *
 * WHY THIS EXISTS. Each lane used to be read as `const { data: risks } = await
 * supabase…`, which discards the error, so `null` meant both "this project has
 * no risks" and "the risk register could not be read". The panel then printed
 * "No risks recorded yet." — a statement about the project — and the header
 * printed a confident `0` next to "Open risks", which is the reassuring
 * direction of the error: a planner who sees zero stops looking.
 *
 * So every lane here returns rows AND whether its read failed, and registers
 * the failure on the page's `ReadFailureLog` so the disclosure names the panel
 * the planner is looking at. Rows are `[]` on failure rather than null: the
 * caller must branch on the flag, never on emptiness.
 */

/** The narrow slice of supabase-js this loader uses. Untyped by convention. */
export type ProjectRecordLaneSupabaseLike = {
  from(table: string): {
    select(columns: string): {
      eq(
        column: string,
        value: string
      ): {
        order(
          column: string,
          options: { ascending: boolean }
        ): {
          limit(count: number): Promise<{
            data: unknown[] | null;
            error: { message?: string | null } | null;
          }>;
        };
      };
    };
  };
};

export type ProjectRecordLanes = {
  risks: RiskRow[];
  issues: IssueRow[];
  decisions: DecisionRow[];
  meetings: MeetingRow[];
  risksReadFailed: boolean;
  issuesReadFailed: boolean;
  decisionsReadFailed: boolean;
  meetingsReadFailed: boolean;
};

/**
 * One lane's table, its projection, and the words the disclosure uses for it.
 *
 * The projection lives here as a literal so it stays greppable: a Supabase
 * `.select()` string is never checked against the schema, so a column dropped
 * from one of these arrives as `undefined` with nothing failing anywhere.
 */
const LANES = {
  risks: {
    table: "project_risks",
    columns: "id, title, description, severity, status, mitigation, created_at",
    label: "project risks",
  },
  issues: {
    table: "project_issues",
    columns: "id, title, description, severity, status, owner_label, assignee_user_id, created_at",
    label: "project issues",
  },
  decisions: {
    table: "project_decisions",
    columns: "id, title, rationale, status, impact_summary, decided_at, created_at",
    label: "project decisions",
  },
  meetings: {
    table: "project_meetings",
    columns: "id, title, notes, meeting_at, attendees_summary, created_at",
    label: "project meetings",
  },
} as const;

/** The display window each lane has always used. */
const LANE_LIMIT = 6;

async function loadLane(
  supabase: ProjectRecordLaneSupabaseLike,
  projectId: string,
  reads: ReadFailureLog,
  lane: (typeof LANES)[keyof typeof LANES]
): Promise<{ rows: unknown[]; failed: boolean }> {
  const result = await supabase
    .from(lane.table)
    .select(lane.columns)
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(LANE_LIMIT);

  const failed = reads.check(lane.label, result);
  return { rows: failed ? [] : result.data ?? [], failed };
}

export async function loadProjectRecordLanes(
  supabase: ProjectRecordLaneSupabaseLike,
  projectId: string,
  reads: ReadFailureLog
): Promise<ProjectRecordLanes> {
  // Sequential, matching the order the page read them in before this was
  // extracted — these are small capped reads and the page already awaits a
  // long chain, so parallelising them would change failure ordering in the
  // disclosure sentence for no measurable gain.
  const risks = await loadLane(supabase, projectId, reads, LANES.risks);
  const issues = await loadLane(supabase, projectId, reads, LANES.issues);
  const decisions = await loadLane(supabase, projectId, reads, LANES.decisions);
  const meetings = await loadLane(supabase, projectId, reads, LANES.meetings);

  return {
    risks: risks.rows as RiskRow[],
    issues: issues.rows as IssueRow[],
    decisions: decisions.rows as DecisionRow[],
    meetings: meetings.rows as MeetingRow[],
    risksReadFailed: risks.failed,
    issuesReadFailed: issues.failed,
    decisionsReadFailed: decisions.failed,
    meetingsReadFailed: meetings.failed,
  };
}

/**
 * The two DATED control lanes — milestones and submittals.
 *
 * They lived inline on the project page until the assignee column arrived and
 * pushed that file past its line cap, which was the nudge to put them where
 * they belonged anyway: beside the other record projections, in the module
 * whose header explains why a `.select()` string is kept as a greppable
 * literal. Their shape differs from the four lanes above — each is ordered by
 * its own date, capped at 8, and tolerates a PENDING MIGRATION separately from
 * a failed read — so they get their own loader rather than another LANES entry.
 *
 * Three outcomes per lane, and the page renders different words for each:
 * pending (apply the migration), failed (say so), or an answer.
 */
const SCHEDULE_LANE_LIMIT = 8;

const MILESTONE_COLUMNS =
  "id, title, summary, milestone_type, phase_code, status, owner_label, assignee_user_id, target_date, actual_date, notes, created_at";
const SUBMITTAL_COLUMNS =
  "id, title, submittal_type, status, agency_label, assignee_user_id, reference_number, due_date, submitted_at, review_cycle, notes, created_at";

export type ProjectScheduleLanes = {
  milestones: MilestoneRow[];
  milestonesPending: boolean;
  milestonesReadFailed: boolean;
  submittals: SubmittalRow[];
  submittalsPending: boolean;
  submittalsReadFailed: boolean;
};

export async function loadProjectScheduleLanes(
  supabase: ProjectRecordLaneSupabaseLike,
  projectId: string,
  reads: ReadFailureLog
): Promise<ProjectScheduleLanes> {
  const milestoneResult = await supabase
    .from("project_milestones")
    .select(MILESTONE_COLUMNS)
    .eq("project_id", projectId)
    .order("target_date", { ascending: true })
    .limit(SCHEDULE_LANE_LIMIT);
  const milestonesPending = looksLikePendingSchema(milestoneResult.error?.message);
  const milestonesReadFailed = milestonesPending
    ? false
    : reads.check("this project's milestones", milestoneResult);

  const submittalResult = await supabase
    .from("project_submittals")
    .select(SUBMITTAL_COLUMNS)
    .eq("project_id", projectId)
    .order("due_date", { ascending: true })
    .limit(SCHEDULE_LANE_LIMIT);
  const submittalsPending = looksLikePendingSchema(submittalResult.error?.message);
  const submittalsReadFailed = submittalsPending
    ? false
    : reads.check("this project's submittals", submittalResult);

  return {
    milestones: milestonesPending ? [] : ((milestoneResult.data ?? []) as MilestoneRow[]),
    milestonesPending,
    milestonesReadFailed,
    submittals: submittalsPending ? [] : ((submittalResult.data ?? []) as SubmittalRow[]),
    submittalsPending,
    submittalsReadFailed,
  };
}
