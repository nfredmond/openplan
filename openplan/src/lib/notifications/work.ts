/**
 * THE DAILY DEADLINE SWEEP — the one place OpenPlan tells a planner that
 * something is due.
 *
 * Nathaniel's decision (2026-08-11): one digest per person per day, covering
 * everything due within a week plus everything already overdue; in-app always,
 * email as well when a transport is configured.
 *
 * ================================================== WHAT THIS MODULE IS NOT
 *
 * It does NOT decide what "overdue" means. That lives in `@/lib/work/deadlines`
 * — the module extracted precisely because the same shaping had grown twice and
 * a third copy is how a milestone reads as overdue on one screen and upcoming on
 * another. `isDeadlinePast` and `invoicePriority` are imported and asked; the
 * only thing this file adds is the WINDOW (seven days ahead), which is a
 * question about reminders, not about lateness.
 *
 * It does not decide who is on a team either: `loadWorkspaceRoster` does, with
 * the service role behind its own caller-membership check, because
 * `members_read_own` makes an RLS roster read return exactly one row. The sweep
 * NEVER reads `workspace_members` itself.
 *
 * ============================== HOW A SERVICE-ROLE SWEEP STAYS AUTHORIZED
 *
 * A cron has no signed-in caller, so there is nobody for the roster helper's
 * membership check to be about — and the temptation is to read the roster
 * "as the system" and be done. This module does not: for each workspace it
 * asks the roster ON BEHALF OF a candidate recipient it found on that
 * workspace's own rows, and takes the first one the helper accepts. Every
 * roster this sweep sees is therefore one that a real member of that workspace
 * would have been allowed to see, and the check that establishes it is the
 * helper's own rather than a second copy written here.
 *
 * It also gets a needed answer for free. A recipient the helper REFUSES
 * (`caller_not_member`) is someone who has left, and a departed member's
 * assignment is nobody's to-do list (`assigneeCountsAsUnassigned`). They are
 * skipped and counted, never mailed.
 *
 * ====================================================== IDEMPOTENCY, EXACTLY
 *
 * The insert names the unique index from 20260811000007 as its ON CONFLICT
 * target and asks for only the rows that were actually created. Those rows —
 * not the candidate list — are what the email is built from. So a second run on
 * the same day inserts nothing and sends nothing, and the guarantee is a
 * database constraint rather than a timestamp comparison somebody has to keep
 * getting right. {@link WORK_NOTIFICATION_IDEMPOTENCY_COLUMNS} is pinned
 * against the migration's index by `work-notification-sweep.test.ts`.
 *
 * ================================================ THE OUTBOX ROW IS ALWAYS
 *
 * Email goes out through `enqueueEmail`, which writes the
 * `engagement_email_outbox` row BEFORE it attempts delivery and marks it
 * `skipped` when no transport is configured — the honest $0 default. This
 * module therefore never touches that table by name; the reader-inventory guard
 * confines it to one module and this one reaches it through the export. The
 * `campaign_id` is NULL, which that column has allowed since 20260722000009:
 * a deadline digest is not a public-engagement broadcast and must not be
 * attributed to a campaign.
 *
 * A row with NO email address (the auth lookup failed) is reported as
 * `emailUnavailable`, never as a delivery.
 *
 * ================ NO ASSISTANT ACTION WAS REGISTERED. Refused, argued here.
 *
 * The standing rule is that every new write capability gets an action-registry
 * entry when it ships, so the eventual agentic layer is a switch and not a
 * retrofit. Two writes land in this lane and both are refused, for reasons a
 * future session should inherit rather than re-derive:
 *
 * RUNNING THE SWEEP is refused, and the payload shape is exactly why it LOOKS
 * safe: there is no payload at all. But the id test is a PROXY for "the model
 * authors nothing consequential", and what this authors is an EMAIL TO EVERY
 * PLANNER IN A WORKSPACE. An agent that can run it can run it repeatedly — the
 * idempotency index stops a second run on the same DAY, and stops nothing on
 * the next one — and an agent working a queue of overdue items has a standing
 * incentive to prompt people about them, which is the completion-signal shape
 * that refused the RTP band assignment. Reminders are a scheduled fact about
 * dates, not a lever. It stays a cron.
 *
 * MARKING A REMINDER READ is refused for the opposite reason: it is too small
 * to be worth an entry, and it is not too small to be harmful. `is_read` is the
 * record that a PERSON has seen a deadline; an agent that clears it removes the
 * one signal that says nobody has looked, and it does so on a row whose whole
 * purpose is to prove somebody was told. Agent proposes, evidence decides —
 * and being told is evidence.
 *
 * SETTING AN AWARD'S LAPSE DATE (2026-08-12, the seventh source below) is
 * refused too: it is a term of an executed funding agreement, recorded nowhere
 * OpenPlan can read, and a plausible wrong date is indistinguishable from a
 * correct one on an approval sheet. All three refusals are now EXECUTABLE, in
 * `src/test/refused-award-deadline-actions-stay-refused.test.ts` — prose in a
 * header is a convention, and every convention only written down has been
 * violated at least once.
 */

import {
  buildAwardDrawdownLedger,
  toDrawdownInvoiceRead,
  type AwardDrawdownLedger,
  type DrawdownInvoiceLike,
} from "@/lib/invoicing/drawdown-ledger";
import { resolveReimbursementProfile } from "@/lib/invoicing/reimbursement-profile-binding";
import {
  MEASURE_CLAIM_AWAITING_DECISION_STATUSES,
  MEASURE_CLAIM_STATUSES,
  MEASURE_CLAIM_SWEEP_COLUMNS,
} from "@/lib/measures/claims";
import { parseWorkspaceHomeGeography, resolveJurisdiction } from "@/lib/workspaces/home-geography";
import { isPendingFundingDecision } from "@/lib/operations/funding-decision-status";
import { looksLikePendingSchema } from "@/lib/supabase/pending-schema";
import {
  CLOSED_DELIVERABLE_STATUS,
  CLOSED_MILESTONE_STATUS,
  CLOSED_SUBMITTAL_STATUS,
  formatWorkDeadlineDate,
  invoicePriority,
  isDeadlinePast,
  SETTLED_INVOICE_STATUSES,
} from "@/lib/work/deadlines";
import {
  isOnRoster,
  loadWorkspaceRoster,
  type RosterMember,
  type RosterServiceClient,
} from "@/lib/workspaces/roster";

import { enqueueEmail } from "./engagement";
import { formatMoney } from "@/lib/money/format";
import {
  DEFAULT_REMINDER_ADVANCE_DAYS,
  parseReminderPreference,
  type WorkspaceReminderPreference,
} from "./reminder-preferences";

/**
 * The `kind` vocabulary, matching the CHECK constraint as the migration corpus
 * leaves it — 20260811000007 created six, 20260812000010 added the seventh,
 * 20260812000013 the eighth.
 */
export const WORK_NOTIFICATION_KINDS = [
  "deliverable_due",
  "milestone_due",
  "submittal_due",
  "invoice_due",
  "grant_decision_due",
  "award_obligation_due",
  "award_expenditure_due",
  "measure_claim_review_due",
] as const;

export type WorkNotificationKind = (typeof WORK_NOTIFICATION_KINDS)[number];

/**
 * The unique index that makes the sweep idempotent. Named here because the
 * insert has to send it as its ON CONFLICT target, and asserted against the
 * migration so the two can never drift.
 */
export const WORK_NOTIFICATION_IDEMPOTENCY_COLUMNS = [
  "subject_table",
  "subject_id",
  "recipient_user_id",
  "due_on",
] as const;

/** How far ahead a reminder looks. Everything already overdue is included regardless. */
export const WORK_DEADLINE_HORIZON_DAYS = 7;

/**
 * Per-source read cap for one sweep. This is a cross-workspace read, so it is
 * the only place in the product where one query spans every tenant — a cap is
 * not optional. Hitting it is DISCLOSED (`truncated`) rather than absorbed: a
 * reminder sweep that silently stopped halfway is worse than one that says it
 * did.
 */
export const WORK_SWEEP_SOURCE_LIMIT = 2000;

export type WorkNotificationRow = {
  workspace_id: string;
  recipient_user_id: string;
  kind: WorkNotificationKind;
  subject_table: string;
  subject_id: string;
  project_id: string | null;
  due_on: string;
  title: string;
  body: string;
};

/** A candidate before the roster has been consulted. */
type Candidate = WorkNotificationRow & { isOverdue: boolean };

export type WorkSweepSourceOutcome = {
  /** Rows the database returned. */
  scanned: number;
  /** Of those, rows that became a notification candidate. */
  candidates: number;
  /** The deployment is behind 20260811000007 or an earlier migration. */
  pending: boolean;
  failed: boolean;
  message: string | null;
  /** The read filled its cap, so this sweep saw a floor and not the total. */
  truncated: boolean;
  /**
   * A source that needs a SECOND read (see `loadContext`) could not get it, so
   * its reminders went out without the figure that read would have carried.
   * Reported rather than absorbed, for the same reason
   * `workspaceNamesUnavailable` is: the reminder is worth more than its
   * detail, and a swallowed read is how a page starts stating things nobody
   * established. False for every source that needs no second read.
   */
  contextUnavailable: boolean;
};

export type WorkSweepResult = {
  /** When the sweep considered itself to be running. */
  now: string;
  horizonDays: number;
  perSource: Record<WorkNotificationKind, WorkSweepSourceOutcome>;
  /** Notification rows the database actually created (duplicates are not counted). */
  notificationsCreated: number;
  /** Digest emails composed — one per recipient with at least one new notification. */
  digestsComposed: number;
  emailsDelivered: number;
  /** Recorded in the outbox but not sent, because no transport is configured. */
  emailsSkipped: number;
  emailsFailed: number;
  /** Recipients with new reminders whose email address could not be resolved. */
  emailUnavailable: number;
  /** Candidates dropped because the recipient is no longer a member of that workspace. */
  departedRecipients: number;
  /** Workspaces skipped because no roster read succeeded — named, never silent. */
  workspacesWithoutRoster: string[];
  /** The insert's own failure, if the database refused it. */
  writeError: string | null;
  /**
   * The digest names the workspace it is about. True when that read failed, so
   * the emails went out WITHOUT the name — the reminder still matters more than
   * its heading, but a swallowed read is how a page starts stating things
   * nobody established, and this one is reported instead.
   */
  workspaceNamesUnavailable: boolean;
  reminderPreferencesUnavailable: boolean;
  emailDigestsDisabled: number;
};

// ── the seven sources ───────────────────────────────────────────────────────

type StaticFilter =
  | { kind: "neq"; column: string; value: string }
  | { kind: "notIn"; column: string; values: readonly string[] };

/**
 * What a SECOND read gives a source, when one row is not enough to say the
 * thing the reminder has to say.
 *
 * Exactly one source needs this today: an expenditure deadline is only
 * actionable next to the money it threatens, and that money is a position over
 * an award's whole invoice register rather than a column on the award. Rather
 * than let the sweep compute it — a second definition of a figure the ledger
 * already owns — the context read hands `buildAwardDrawdownLedger` its rows and
 * the source quotes the result.
 *
 * `unavailable` is the honest middle: the reminder still goes out, and it says
 * the amount could not be read instead of printing a number that would be
 * wrong. A capped read counts as unavailable too — a truncated invoice list
 * UNDERSTATES what has been claimed and therefore OVERSTATES what is left,
 * which is the direction that would tell an agency it has money it does not.
 */
export type SweepSourceContext = {
  /** Award id → its drawdown position. Empty unless a source asked for one. */
  awardLedgers: ReadonlyMap<string, AwardDrawdownLedger>;
  /**
   * Award id → the ISO-4217 code its workspace's reimbursement process
   * declares. Absent means no profile declared one; the sentence then says USD
   * and says that it is an assumption. Never defaulted silently — a reminder
   * whose whole purpose is a dollar figure must not name the wrong unit.
   */
  awardCurrencyCodes: ReadonlyMap<string, string>;
  /**
   * Measure fund id → the currency the ordinance's fund is denominated in.
   *
   * `measure_funds.currency_code` is NOT NULL with NO DEFAULT (20260812000011),
   * deliberately, so the code exists for every fund that exists — which means
   * an absence here is a FAILED READ and never a fund with no currency. The
   * claim-review reminder therefore states the amount only when the code is
   * present, and says the amount could not be read otherwise. It does not fall
   * back to USD: a reminder about a Canadian county's fund that prints a US
   * figure is worse than one that prints none, and this architecture may not
   * assume the US.
   */
  measureCurrencyCodes: ReadonlyMap<string, string>;
  unavailable: boolean;
};

const EMPTY_SWEEP_CONTEXT: SweepSourceContext = {
  awardLedgers: new Map(),
  awardCurrencyCodes: new Map(),
  measureCurrencyCodes: new Map(),
  unavailable: false,
};

type SweepSource = {
  kind: WorkNotificationKind;
  table: string;
  select: string;
  /** The column holding the deadline. */
  dateColumn: string;
  /**
   * `date` columns and `timestamptz` columns cannot take the same upper bound:
   * PostgREST passes the literal through to Postgres, and a full ISO timestamp
   * compared against a `date` column is an invalid date literal, not a wider
   * window. Four of these six are `date`; two are `timestamptz`.
   */
  dateColumnKind: "date" | "timestamptz";
  /** The column naming the person this reminder is for. */
  recipientColumn: string;
  staticFilters: readonly StaticFilter[];
  /**
   * An optional second read, run only when the first returned rows. It may
   * fail without failing the source: what it carries is detail, and the
   * deadline is the reminder.
   */
  loadContext?: (
    client: WorkSweepClient,
    rows: Array<Record<string, unknown>>,
    limit: number
  ) => Promise<SweepSourceContext>;
  /**
   * Rows → candidates. Per-source because two sources filter on shared
   * predicates. `context` is `EMPTY_SWEEP_CONTEXT` for every source that
   * declares no `loadContext`, so the six original sources ignore it.
   */
  toCandidates: (
    rows: Array<Record<string, unknown>>,
    now: Date,
    context: SweepSourceContext
  ) => Candidate[];
};

function asString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** A to-one PostgREST embed, normalized (supabase-js can hand back an array). */
function embedded(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

/**
 * The calendar day a deadline falls on, in UTC.
 *
 * UTC for the same reason `formatWorkDeadlineDate` renders in it: half these
 * columns are plain `DATE`, and resolving them through a server's local zone
 * moves a deadline of the 20th to the 19th for anyone west of UTC — which here
 * would also change the idempotency key and re-send the digest.
 */
export function workDeadlineDueOn(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/** The upper bound of the reminder window, in the literal the column accepts. */
export function horizonBound(now: Date, horizonDays: number, kind: "date" | "timestamptz"): string {
  const end = new Date(now.getTime() + horizonDays * 86400000);
  return kind === "date" ? end.toISOString().slice(0, 10) : end.toISOString();
}

function projectContext(row: Record<string, unknown>): { workspaceId: string | null; projectName: string | null } {
  const project = embedded(row.projects);
  return {
    workspaceId: asString(project?.workspace_id),
    projectName: asString(project?.name),
  };
}

/** The sentence in the notification body. Planner voice, and never a bare date. */
function deadlineSentence(
  noun: string,
  context: string | null,
  dueOn: string,
  isOverdue: boolean
): string {
  const where = context ? ` on ${context}` : "";
  const when = formatWorkDeadlineDate(dueOn) ?? dueOn;
  return isOverdue
    ? `${noun}${where} — was due ${when} and is now overdue.`
    : `${noun}${where} — due ${when}.`;
}

const deliverablesSource: SweepSource = {
  kind: "deliverable_due",
  table: "project_deliverables",
  select: "id, project_id, title, due_date, status, assignee_user_id, projects!inner(id, name, workspace_id)",
  dateColumn: "due_date",
  dateColumnKind: "date",
  recipientColumn: "assignee_user_id",
  staticFilters: [{ kind: "neq", column: "status", value: CLOSED_DELIVERABLE_STATUS }],
  toCandidates: (rows, now) =>
    rows.flatMap((row) => {
      const { workspaceId, projectName } = projectContext(row);
      const dueOn = workDeadlineDueOn(asString(row.due_date));
      const recipient = asString(row.assignee_user_id);
      if (!workspaceId || !dueOn || !recipient) return [];
      const isOverdue = isDeadlinePast(asString(row.due_date), now);
      const title = asString(row.title) ?? "(untitled deliverable)";
      return [
        {
          workspace_id: workspaceId,
          recipient_user_id: recipient,
          kind: "deliverable_due" as const,
          subject_table: "project_deliverables",
          subject_id: String(row.id),
          project_id: asString(row.project_id),
          due_on: dueOn,
          title,
          body: deadlineSentence("Deliverable", projectName, dueOn, isOverdue),
          isOverdue,
        },
      ];
    }),
};

const milestonesSource: SweepSource = {
  kind: "milestone_due",
  table: "project_milestones",
  select: "id, project_id, title, target_date, status, assignee_user_id, projects!inner(id, name, workspace_id)",
  dateColumn: "target_date",
  dateColumnKind: "date",
  recipientColumn: "assignee_user_id",
  staticFilters: [{ kind: "neq", column: "status", value: CLOSED_MILESTONE_STATUS }],
  toCandidates: (rows, now) =>
    rows.flatMap((row) => {
      const { workspaceId, projectName } = projectContext(row);
      const dueOn = workDeadlineDueOn(asString(row.target_date));
      const recipient = asString(row.assignee_user_id);
      if (!workspaceId || !dueOn || !recipient) return [];
      const isOverdue = isDeadlinePast(asString(row.target_date), now);
      return [
        {
          workspace_id: workspaceId,
          recipient_user_id: recipient,
          kind: "milestone_due" as const,
          subject_table: "project_milestones",
          subject_id: String(row.id),
          project_id: asString(row.project_id),
          due_on: dueOn,
          title: asString(row.title) ?? "(untitled milestone)",
          body: deadlineSentence("Milestone", projectName, dueOn, isOverdue),
          isOverdue,
        },
      ];
    }),
};

const submittalsSource: SweepSource = {
  kind: "submittal_due",
  table: "project_submittals",
  select: "id, project_id, title, due_date, status, agency_label, assignee_user_id, projects!inner(id, name, workspace_id)",
  dateColumn: "due_date",
  dateColumnKind: "date",
  recipientColumn: "assignee_user_id",
  staticFilters: [{ kind: "neq", column: "status", value: CLOSED_SUBMITTAL_STATUS }],
  toCandidates: (rows, now) =>
    rows.flatMap((row) => {
      const { workspaceId, projectName } = projectContext(row);
      const dueOn = workDeadlineDueOn(asString(row.due_date));
      const recipient = asString(row.assignee_user_id);
      if (!workspaceId || !dueOn || !recipient) return [];
      const isOverdue = isDeadlinePast(asString(row.due_date), now);
      const agency = asString(row.agency_label);
      return [
        {
          workspace_id: workspaceId,
          recipient_user_id: recipient,
          kind: "submittal_due" as const,
          subject_table: "project_submittals",
          subject_id: String(row.id),
          project_id: asString(row.project_id),
          due_on: dueOn,
          title: asString(row.title) ?? "(untitled submittal)",
          body: deadlineSentence(
            agency ? `Submittal to ${agency}` : "Submittal",
            projectName,
            dueOn,
            isOverdue
          ),
          isOverdue,
        },
      ];
    }),
};

/**
 * ── THE THREE WORKSPACE-SCOPED SOURCES, AND WHO THEY GO TO ────────────────
 *
 * `funding_opportunities`, `funding_awards` and `billing_invoice_records` carry
 * no assignee column, and /my-work is careful never to present them as
 * belonging to anyone. A REMINDER still has to reach a person, though, or the
 * deadline nobody owns is exactly the one that is missed.
 *
 * It goes to `created_by` — the person who put the record into OpenPlan. That
 * is a fact the database already holds, not an owner this module invented, and
 * the body says so in words: the reminder tells them they recorded it and that
 * nobody is assigned. Fanning it out to the whole team instead would mail every
 * viewer about every invoice, and picking "the owners and admins" would be this
 * module inventing an accountability rule the product does not otherwise have.
 * If the author has left the workspace the roster refuses them and nobody is
 * mailed, which is honest — and visible in `departedRecipients`.
 */
const grantDecisionsSource: SweepSource = {
  kind: "grant_decision_due",
  table: "funding_opportunities",
  select:
    "id, workspace_id, project_id, title, agency_name, decision_due_at, opportunity_status, decision_state, created_by",
  dateColumn: "decision_due_at",
  dateColumnKind: "timestamptz",
  recipientColumn: "created_by",
  staticFilters: [],
  toCandidates: (rows, now) =>
    rows.flatMap((row) => {
      // The shared predicate, used verbatim. `decision_state` is TEXT NOT NULL
      // DEFAULT 'monitor', so "undecided" is `=== 'monitor'` and never a null
      // check — two surfaces had already got that wrong in opposite ways.
      if (
        !isPendingFundingDecision({
          opportunityStatus: asString(row.opportunity_status),
          decisionState: asString(row.decision_state),
        })
      ) {
        return [];
      }
      const workspaceId = asString(row.workspace_id);
      const dueOn = workDeadlineDueOn(asString(row.decision_due_at));
      const recipient = asString(row.created_by);
      if (!workspaceId || !dueOn || !recipient) return [];
      const isOverdue = isDeadlinePast(asString(row.decision_due_at), now);
      const agency = asString(row.agency_name);
      return [
        {
          workspace_id: workspaceId,
          recipient_user_id: recipient,
          kind: "grant_decision_due" as const,
          subject_table: "funding_opportunities",
          subject_id: String(row.id),
          project_id: asString(row.project_id),
          due_on: dueOn,
          title: asString(row.title) ?? "(untitled opportunity)",
          body: `${deadlineSentence(
            agency ? `Pursue-or-skip decision on the ${agency} opportunity` : "Pursue-or-skip decision",
            null,
            dueOn,
            isOverdue
          )} You recorded this opportunity; grant deadlines carry no assignee.`,
          isOverdue,
        },
      ];
    }),
};

const awardObligationsSource: SweepSource = {
  kind: "award_obligation_due",
  table: "funding_awards",
  select: "id, workspace_id, project_id, title, obligation_due_at, spending_status, created_by",
  dateColumn: "obligation_due_at",
  dateColumnKind: "timestamptz",
  recipientColumn: "created_by",
  // Money already fully spent has met its obligation deadline by definition.
  staticFilters: [{ kind: "neq", column: "spending_status", value: "fully_spent" }],
  toCandidates: (rows, now) =>
    rows.flatMap((row) => {
      const workspaceId = asString(row.workspace_id);
      const dueOn = workDeadlineDueOn(asString(row.obligation_due_at));
      const recipient = asString(row.created_by);
      if (!workspaceId || !dueOn || !recipient) return [];
      const isOverdue = isDeadlinePast(asString(row.obligation_due_at), now);
      return [
        {
          workspace_id: workspaceId,
          recipient_user_id: recipient,
          kind: "award_obligation_due" as const,
          subject_table: "funding_awards",
          subject_id: String(row.id),
          project_id: asString(row.project_id),
          due_on: dueOn,
          title: asString(row.title) ?? "(untitled award)",
          body: `${deadlineSentence("Award funds must be obligated", null, dueOn, isOverdue)} You recorded this award; obligation deadlines carry no assignee.`,
          isOverdue,
        },
      ];
    }),
};

/**
 * ── THE LAPSE DEADLINE, AND THE MONEY IT THREATENS ────────────────────────
 *
 * `expenditure_deadline_at` (20260812000010) is the date an unspent balance
 * goes back to the funder. It is NOT a near-duplicate of the obligation
 * deadline above: obligating is committing the money and expending is spending
 * it, and a planner told the wrong one of the two is worse off than one told
 * nothing. Two columns, two kinds, two sentences.
 *
 * WHY THIS ONE CARRIES A FIGURE when no other reminder does. "A deadline is
 * coming" is enough for a deliverable; for a lapse it is not, because the
 * action it should trigger depends entirely on whether there is $2,000 or
 * $2,000,000 left to draw down. The figure is the drawdown ledger's
 * `remainingAuthorized` — authorized minus claimed — and it is QUOTED, never
 * recomputed: `buildAwardDrawdownLedger` is the one definition of what an award
 * has claimed, and a second one written here would be a number that disagrees
 * with the ledger panel on the same award.
 *
 * A ZERO IS NEVER PRINTED AS THE AMOUNT AT RISK. Unread invoices, a capped
 * read, and an award with no amount recorded each get their own sentence saying
 * so. "$0 at risk" is the one thing this reminder must never say when what it
 * means is "we could not tell".
 */
const AWARD_LEDGER_INVOICE_COLUMNS =
  "funding_award_id, status, amount, retention_percent, retention_amount";

async function loadAwardDrawdownLedgers(
  client: WorkSweepClient,
  rows: Array<Record<string, unknown>>,
  limit: number
): Promise<SweepSourceContext> {
  const unavailable: SweepSourceContext = {
    awardLedgers: new Map(),
    awardCurrencyCodes: new Map(),
    measureCurrencyCodes: new Map(),
    unavailable: true,
  };
  const awardIds = [...new Set(rows.map((row) => asString(row.id)).filter((id): id is string => !!id))];
  if (awardIds.length === 0) return EMPTY_SWEEP_CONTEXT;

  try {
    const result = await client
      .from("billing_invoice_records")
      // Deliberately NOT `DRAWDOWN_INVOICE_COLUMNS`: this read needs only the
      // four fields the claimed total is built from, and asking for a column
      // this sentence does not use would make the whole reminder fail on any
      // deployment that has one of the two 2026-08-12 migrations and not the
      // other.
      .select(AWARD_LEDGER_INVOICE_COLUMNS)
      .in("funding_award_id", awardIds)
      .limit(limit);

    const read = toDrawdownInvoiceRead({
      data: (result.data ?? null) as DrawdownInvoiceLike[] | null,
      error: result.error,
    });
    if (!read.ok) return unavailable;
    // A capped invoice read understates what has been claimed and therefore
    // OVERSTATES what is left to spend. Wrong in the direction that tells an
    // agency it has money it does not, so it is reported as unread instead.
    // The cap counts only the invoices of awards whose lapse date falls inside
    // the seven-day window — a handful on any ordinary day — so reaching it is
    // remarkable, and on the day it happens the sweep says so.
    if (read.invoices.length >= limit) return unavailable;

    const byAward = new Map<string, DrawdownInvoiceLike[]>();
    for (const invoice of read.invoices) {
      const awardId = asString((invoice as Record<string, unknown>).funding_award_id);
      if (!awardId) continue;
      const existing = byAward.get(awardId) ?? [];
      existing.push(invoice);
      byAward.set(awardId, existing);
    }

    const awardLedgers = new Map<string, AwardDrawdownLedger>();
    for (const row of rows) {
      const awardId = asString(row.id);
      if (!awardId) continue;
      const built = buildAwardDrawdownLedger({
        award: {
          awarded_amount: (row.awarded_amount ?? null) as number | string | null,
          match_amount: (row.match_amount ?? null) as number | string | null,
          match_posture: asString(row.match_posture),
        },
        invoiceRead: { ok: true, invoices: byAward.get(awardId) ?? [] },
      });
      if (built.ok) awardLedgers.set(awardId, built.ledger);
    }

    return {
      awardLedgers,
      awardCurrencyCodes: await loadAwardCurrencyCodes(client, rows),
      measureCurrencyCodes: new Map(),
      unavailable: false,
    };
  } catch {
    return unavailable;
  }
}

/**
 * The currency each award's reminder should name, from its workspace's bound
 * reimbursement process.
 *
 * WHY THIS READS THE WORKSPACE. The currency is a property of the funding
 * process, and the process is resolved from where the workspace operates — the
 * same resolution the reimbursement worksheet performs. Without it this
 * reminder formatted the figure as US dollars unconditionally, so an agency
 * outside the US was told a plausible number in the wrong unit, on the one
 * notification in the product whose entire point is the amount.
 *
 * A FAILURE HERE IS NOT A FAILURE OF THE SWEEP. An unreadable workspace row
 * costs the reminder its currency label, not its existence: the sentence falls
 * back to naming USD as an assumption. Losing a lapse warning entirely because
 * a name lookup failed would be far worse than labelling it conservatively.
 */
async function loadAwardCurrencyCodes(
  client: WorkSweepClient,
  rows: Array<Record<string, unknown>>
): Promise<Map<string, string>> {
  const byAward = new Map<string, string>();
  const workspaceIds = [
    ...new Set(rows.map((row) => asString(row.workspace_id)).filter((id): id is string => !!id)),
  ];
  if (workspaceIds.length === 0) return byAward;

  try {
    const result = await client
      .from("workspaces")
      .select("id, home_geography_source, home_geography_kind, home_geography_ref, home_country_code, home_subdivision_code")
      .in("id", workspaceIds);

    if (result.error || !result.data) return byAward;

    const codeByWorkspace = new Map<string, string>();
    for (const workspace of result.data as Array<Record<string, unknown>>) {
      const workspaceId = asString(workspace.id);
      if (!workspaceId) continue;
      const resolution = resolveReimbursementProfile({
        workspaceJurisdiction: resolveJurisdiction(parseWorkspaceHomeGeography(workspace)),
      });
      const code = resolution.kind === "resolved" ? resolution.binding.currencyCode : null;
      if (code) codeByWorkspace.set(workspaceId, code);
    }

    for (const row of rows) {
      const awardId = asString(row.id);
      const workspaceId = asString(row.workspace_id);
      if (!awardId || !workspaceId) continue;
      const code = codeByWorkspace.get(workspaceId);
      if (code) byAward.set(awardId, code);
    }
  } catch {
    // Deliberately swallowed: see the note above. The reminder still goes out.
  }

  return byAward;
}

/**
 * Money in a reminder, to the cent.
 *
 * Not `formatCurrency` from the grants page helper: that one rounds to whole
 * dollars and renders a null as `$0`. Both are wrong here — this figure is the
 * reason the reminder exists, and a null that reads as zero is the defect this
 * whole lane is written against.
 */
function reminderMoney(value: number, currencyCode: string | null | undefined): string {
  // The CODE, not the symbol. This sentence is one line in an inbox with no
  // room for a currency footnote, and "$119,999.67" is the same string for US,
  // Canadian, Australian and a dozen other dollars. The figure is the whole
  // reason the reminder exists; naming its unit costs four characters. An
  // unrecognized code falls back inside `formatMoney` to the code beside the
  // number — it must not cost a planner their lapse warning.
  return formatMoney(value, { precision: "cents", currency: currencyCode, currencyDisplay: "code" });
}

/**
 * What is at stake on the lapse date — or, honestly, why that cannot be said.
 *
 * FIVE BRANCHES, and none of them may collapse into another. The two that state
 * no figure are the point of the function: an unread invoice register and an
 * award with no recorded amount both mean "OpenPlan cannot tell you", and the
 * one thing this sentence must never say in either case is "$0 at risk", which
 * reads as a finding and would stop a planner acting. `remaining === 0` is a
 * genuinely different fact — every authorized dollar HAS been claimed — and it
 * gets its own words for that reason.
 *
 * Exported for test: all five were reachable only through the sweep, and three
 * of them survived mutation because no fixture ever produced them.
 */
export function expenditureAtRiskSentence(
  ledger: AwardDrawdownLedger | undefined,
  contextUnavailable: boolean,
  currencyCode?: string | null
): string {
  if (contextUnavailable || !ledger) {
    return "OpenPlan could not read this award's invoices, so the amount at risk is not stated here.";
  }
  const remaining = ledger.remainingAuthorized;
  if (remaining === null) {
    return "No awarded amount is recorded on this award, so OpenPlan cannot say how much is at risk.";
  }
  if (remaining > 0) {
    return `${reminderMoney(remaining, currencyCode)} of this award is authorized and not yet claimed.`;
  }
  if (remaining === 0) {
    return "Every authorized dollar on this award has already been claimed.";
  }
  return `Claims against this award already exceed the authorized amount by ${reminderMoney(
    Math.abs(remaining),
    currencyCode
  )}.`;
}

const awardExpendituresSource: SweepSource = {
  kind: "award_expenditure_due",
  table: "funding_awards",
  select:
    "id, workspace_id, project_id, title, expenditure_deadline_at, spending_status, awarded_amount, match_amount, match_posture, created_by",
  dateColumn: "expenditure_deadline_at",
  dateColumnKind: "timestamptz",
  recipientColumn: "created_by",
  // Money already fully spent cannot lapse — the same filter the obligation
  // source uses, and for the same reason.
  staticFilters: [{ kind: "neq", column: "spending_status", value: "fully_spent" }],
  loadContext: loadAwardDrawdownLedgers,
  toCandidates: (rows, now, context) =>
    rows.flatMap((row) => {
      const workspaceId = asString(row.workspace_id);
      const dueOn = workDeadlineDueOn(asString(row.expenditure_deadline_at));
      const recipient = asString(row.created_by);
      if (!workspaceId || !dueOn || !recipient) return [];
      const isOverdue = isDeadlinePast(asString(row.expenditure_deadline_at), now);
      const title = asString(row.title) ?? "(untitled award)";
      const awardId = asString(row.id);
      const atRisk = expenditureAtRiskSentence(
        awardId ? context.awardLedgers.get(awardId) : undefined,
        context.unavailable,
        awardId ? context.awardCurrencyCodes.get(awardId) : undefined
      );
      return [
        {
          workspace_id: workspaceId,
          recipient_user_id: recipient,
          kind: "award_expenditure_due" as const,
          subject_table: "funding_awards",
          subject_id: String(row.id),
          project_id: asString(row.project_id),
          due_on: dueOn,
          title,
          body: `${deadlineSentence(
            `Funds on ${title} must be expended`,
            null,
            dueOn,
            isOverdue
          )} ${atRisk} You recorded this award; expenditure deadlines carry no assignee.`,
          isOverdue,
        },
      ];
    }),
};

const invoiceWindowsSource: SweepSource = {
  kind: "invoice_due",
  table: "billing_invoice_records",
  select: "id, workspace_id, project_id, invoice_number, due_date, status, submitted_to, created_by",
  dateColumn: "due_date",
  dateColumnKind: "date",
  recipientColumn: "created_by",
  staticFilters: [{ kind: "notIn", column: "status", values: SETTLED_INVOICE_STATUSES }],
  toCandidates: (rows, now) =>
    rows.flatMap((row) => {
      const workspaceId = asString(row.workspace_id);
      const dueOn = workDeadlineDueOn(asString(row.due_date));
      const recipient = asString(row.created_by);
      if (!workspaceId || !dueOn || !recipient) return [];
      // The control room's definition, asked rather than re-derived: priority 0
      // is exactly "unsettled and past its due date".
      const isOverdue =
        invoicePriority({ status: asString(row.status), due_date: asString(row.due_date) }, now) === 0;
      const submittedTo = asString(row.submitted_to);
      return [
        {
          workspace_id: workspaceId,
          recipient_user_id: recipient,
          kind: "invoice_due" as const,
          subject_table: "billing_invoice_records",
          subject_id: String(row.id),
          project_id: asString(row.project_id),
          due_on: dueOn,
          title: `Invoice ${asString(row.invoice_number) ?? "(unnumbered)"}`,
          body: `${deadlineSentence(
            submittedTo ? `Reimbursement invoice to ${submittedTo}` : "Reimbursement invoice",
            null,
            dueOn,
            isOverdue
          )} You recorded this invoice; invoice windows carry no assignee.`,
          isOverdue,
        },
      ];
    }),
};

/* ── the eighth source: a measure claim nobody has answered ─────────────── */

/**
 * The statuses a claim must NOT be in to be waiting on the agency.
 *
 * Derived by SUBTRACTION from the two vocabularies `claims.ts` exports, never
 * retyped. `staticFilters` can express `notIn` but not `in`, and the obvious
 * fix — writing out `['draft','approved','paid','denied','withdrawn']` here —
 * would be a third copy of the lifecycle that goes stale the day a status is
 * added. Adding one there now automatically excludes it here, which is the safe
 * direction: a new status the sweep has never heard of should not start
 * generating reminders on its own.
 */
const MEASURE_CLAIM_SETTLED_STATUSES: readonly string[] = MEASURE_CLAIM_STATUSES.filter(
  (status) => !(MEASURE_CLAIM_AWAITING_DECISION_STATUSES as readonly string[]).includes(status)
);

/** Whole days between two ISO dates, in UTC. Never negative. */
function daysWaiting(submittedOn: string, now: Date): number {
  const submitted = new Date(`${submittedOn}T00:00:00Z`).getTime();
  if (Number.isNaN(submitted)) return 0;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((today - submitted) / 86400000));
}

/**
 * The sentence in a claim-review reminder. Exported because it is the only
 * place this lane states an amount, and a sentence reachable only through the
 * whole sweep is a sentence no fixture ever produces.
 *
 * THE AMOUNT IS OMITTED RATHER THAN GUESSED. `measure_funds.currency_code` is
 * NOT NULL, so a missing code means the second read failed — and a figure with
 * the wrong unit on it is worse than no figure at all.
 */
export function measureClaimWaitingSentence(input: {
  amount: number | null;
  currencyCode: string | null;
  submittedOn: string;
  waitedDays: number;
}): string {
  const when = formatWorkDeadlineDate(input.submittedOn) ?? input.submittedOn;
  const howLong =
    input.waitedDays === 0
      ? "It arrived today."
      : `It has been waiting ${input.waitedDays} ${input.waitedDays === 1 ? "day" : "days"}.`;
  const money =
    input.amount !== null && input.currencyCode
      ? `The claim is for ${reminderMoney(input.amount, input.currencyCode)}.`
      : "OpenPlan could not read this fund's currency, so the amount is not stated here.";
  return (
    `Submitted ${when} and still waiting on a decision. ${howLong} ${money} ` +
    "No review deadline is recorded for this measure, so this is not an overdue notice — it is a claim " +
    "nobody has answered yet."
  );
}

/**
 * The currency each measure fund is denominated in, for the claims just read.
 *
 * A second read rather than an embed: `measure_claims` reaches `measure_funds`
 * through a COMPOSITE foreign key `(measure_fund_id, workspace_id)`
 * (20260812000011), and PostgREST's embed resolution over composite keys is not
 * something a cron should depend on. One `in()` over the handful of funds in
 * the batch is cheaper to reason about and fails visibly.
 */
async function loadMeasureFundCurrencies(
  client: WorkSweepClient,
  rows: Array<Record<string, unknown>>,
  limit: number
): Promise<SweepSourceContext> {
  const unavailable: SweepSourceContext = {
    awardLedgers: new Map(),
    awardCurrencyCodes: new Map(),
    measureCurrencyCodes: new Map(),
    unavailable: true,
  };
  const fundIds = [
    ...new Set(rows.map((row) => asString(row.measure_fund_id)).filter((id): id is string => !!id)),
  ];
  if (fundIds.length === 0) return EMPTY_SWEEP_CONTEXT;

  try {
    const result = await client
      .from("measure_funds")
      .select("id, currency_code")
      .in("id", fundIds)
      .limit(limit);
    if (result.error) return unavailable;

    const measureCurrencyCodes = new Map<string, string>();
    for (const row of (result.data ?? []) as Array<Record<string, unknown>>) {
      const id = asString(row.id);
      const code = asString(row.currency_code);
      if (id && code) measureCurrencyCodes.set(id, code);
    }
    return {
      awardLedgers: new Map(),
      awardCurrencyCodes: new Map(),
      measureCurrencyCodes,
      unavailable: false,
    };
  } catch {
    return unavailable;
  }
}

/**
 * A CLAIM AGAINST A LOCAL MEASURE FUND THAT NOBODY HAS DECIDED.
 *
 * ============================================================================
 * THIS SOURCE IS THE ONE THAT IS NOT ABOUT A DEADLINE
 * ============================================================================
 *
 * Nothing OpenPlan holds says when a decision on a claim is DUE. There is no
 * review-window column on `measure_funds` and no ordinance text this product
 * parses. So `isOverdue` is FALSE unconditionally — not "false for now", not
 * "false unless the claim is old". A 30-day default invented here would be
 * OpenPlan telling an agency it had missed a standard nobody adopted, printed
 * in a digest subject line as "1 overdue".
 *
 * What the reminder does instead is state the facts it has: the day the claim
 * arrived, how long it has waited, and how much it is for. Those are enough for
 * the person who recorded it to act, and none of them is invented.
 *
 * `due_on` is `submitted_on`, which never changes once a claim leaves draft
 * (`measure_claims_left_draft_has_a_date`), so the idempotency index produces
 * exactly ONE reminder per claim per person, ever. This is deliberately not a
 * daily nag: a queue somebody is already working through does not need to be
 * re-announced, and a reminder that arrives every morning is one people filter.
 *
 * THE RECIPIENT is `created_by`, the invoice-window posture: sub-recipients do
 * not have OpenPlan accounts, so the person who recorded the claim is the one
 * who will chase it. Claims carry no assignee and the reminder says so.
 */
const measureClaimReviewsSource: SweepSource = {
  kind: "measure_claim_review_due",
  table: "measure_claims",
  // SEAM L2 -> L3: the narrow sweep projection Lane 2 exports, plus the one
  // column it does not carry. `created_by` is appended rather than added to
  // that constant because the constant is Lane 2's and the recipient question
  // is this module's — but the append is the whole extent of the re-spelling,
  // and `measure-claim-review-reminder.test.ts` asserts the composed string.
  select: `${MEASURE_CLAIM_SWEEP_COLUMNS}, created_by`,
  dateColumn: "submitted_on",
  dateColumnKind: "date",
  recipientColumn: "created_by",
  staticFilters: [{ kind: "notIn", column: "status", values: MEASURE_CLAIM_SETTLED_STATUSES }],
  loadContext: loadMeasureFundCurrencies,
  toCandidates: (rows, now, context) =>
    rows.flatMap((row) => {
      const workspaceId = asString(row.workspace_id);
      const submittedOn = workDeadlineDueOn(asString(row.submitted_on));
      const recipient = asString(row.created_by);
      if (!workspaceId || !submittedOn || !recipient) return [];

      const fundId = asString(row.measure_fund_id);
      const currencyCode = fundId ? context.measureCurrencyCodes.get(fundId) ?? null : null;
      const rawAmount = row.amount;
      const amount =
        typeof rawAmount === "number"
          ? rawAmount
          : typeof rawAmount === "string" && rawAmount.trim() && Number.isFinite(Number(rawAmount))
            ? Number(rawAmount)
            : null;

      const reference = asString(row.id);
      const year = asString(row.fiscal_year_label);
      return [
        {
          workspace_id: workspaceId,
          recipient_user_id: recipient,
          kind: "measure_claim_review_due" as const,
          subject_table: "measure_claims",
          subject_id: String(reference ?? ""),
          // Measure claims belong to a fund, not to a project. NULL rather than
          // a guess: `work_notifications.project_id` is a real foreign key and
          // attaching an unrelated project would file the reminder under the
          // wrong piece of work on /my-work.
          project_id: null,
          due_on: submittedOn,
          title: `Measure claim awaiting a decision${year ? ` · ${year}` : ""}`,
          body: `${measureClaimWaitingSentence({
            amount,
            currencyCode,
            submittedOn,
            waitedDays: daysWaiting(submittedOn, now),
          })} You recorded this claim; measure claims carry no assignee.`,
          // NOT A DEADLINE. See the source header — this is the one deliberate
          // constant in the file, and changing it to `isDeadlinePast(...)` would
          // report every claim submitted before today as overdue.
          isOverdue: false,
        },
      ];
    }),
};

export const WORK_SWEEP_SOURCES: readonly SweepSource[] = [
  deliverablesSource,
  milestonesSource,
  submittalsSource,
  grantDecisionsSource,
  awardObligationsSource,
  awardExpendituresSource,
  invoiceWindowsSource,
  measureClaimReviewsSource,
];

// ── the client slice ────────────────────────────────────────────────────────

type SweepReadResult = { data: unknown; error: { message?: string | null } | null };

type SweepQuery = PromiseLike<SweepReadResult> & {
  eq(column: string, value: string): SweepQuery;
  neq(column: string, value: string): SweepQuery;
  not(column: string, operator: string, value: unknown): SweepQuery;
  lte(column: string, value: string): SweepQuery;
  in(column: string, values: readonly string[]): SweepQuery;
  order(column: string, options: { ascending: boolean }): SweepQuery;
  limit(count: number): SweepQuery;
};

/**
 * Declared standalone rather than as `RosterServiceClient & {…}`: an
 * intersection of two object types that both declare `from` resolves to the
 * FIRST signature, so every sweep query would have been type-checked against
 * the roster helper's much narrower chain. The roster half is reached by an
 * explicit cast at the one call site instead — the repo's untyped-client
 * convention, and visible where it happens.
 */
export type WorkSweepClient = {
  from(table: string): {
    select(columns: string): SweepQuery;
    upsert(
      rows: readonly WorkNotificationRow[],
      options: { onConflict: string; ignoreDuplicates: boolean }
    ): { select(columns: string): PromiseLike<SweepReadResult> };
  };
  auth: RosterServiceClient["auth"];
};

export type SweepWorkDeadlinesOptions = {
  now?: Date;
  horizonDays?: number;
  limitPerSource?: number;
  /** Where the email's link points. Taken from the cron request, so no new env var. */
  appOrigin?: string | null;
  /** Injected by the tests; production uses the real roster helper. */
  loadRoster?: typeof loadWorkspaceRoster;
};

function emptyOutcome(): WorkSweepSourceOutcome {
  return {
    scanned: 0,
    candidates: 0,
    pending: false,
    failed: false,
    message: null,
    truncated: false,
    contextUnavailable: false,
  };
}

async function readSource(
  client: WorkSweepClient,
  source: SweepSource,
  now: Date,
  horizonDays: number,
  limit: number
): Promise<{ rows: Array<Record<string, unknown>>; outcome: WorkSweepSourceOutcome }> {
  const outcome = emptyOutcome();
  try {
    let query = client
      .from(source.table)
      .select(source.select)
      .not(source.dateColumn, "is", null)
      .lte(source.dateColumn, horizonBound(now, horizonDays, source.dateColumnKind))
      .not(source.recipientColumn, "is", null);

    for (const filter of source.staticFilters) {
      query =
        filter.kind === "neq"
          ? query.neq(filter.column, filter.value)
          : query.not(filter.column, "in", `(${filter.values.join(",")})`);
    }

    const result = await query.order(source.dateColumn, { ascending: true }).limit(limit);
    if (result.error) {
      const message = result.error.message ?? "the database returned no reason";
      if (looksLikePendingSchema(message)) outcome.pending = true;
      else outcome.failed = true;
      outcome.message = message;
      return { rows: [], outcome };
    }
    const rows = (result.data ?? []) as Array<Record<string, unknown>>;
    outcome.scanned = rows.length;
    outcome.truncated = rows.length >= limit;
    return { rows, outcome };
  } catch (error) {
    // A thrown read is a failed read, not an empty source.
    outcome.failed = true;
    outcome.message = error instanceof Error ? error.message : "read threw";
    return { rows: [], outcome };
  }
}

/**
 * The roster for one workspace, asked on behalf of a member of it.
 *
 * Candidates are tried in order until the helper accepts one. A refusal
 * (`caller_not_member`) is not a failure — it is the answer that this candidate
 * has left — so the next candidate is tried. A genuine read failure stops the
 * workspace, because continuing would mean guessing at membership.
 */
async function rosterForWorkspace(
  client: WorkSweepClient,
  workspaceId: string,
  candidateIds: readonly string[],
  loadRoster: typeof loadWorkspaceRoster
): Promise<readonly RosterMember[] | null> {
  for (const candidateId of candidateIds) {
    const result = await loadRoster(client as unknown as RosterServiceClient, candidateId, workspaceId);
    if (result.ok) return result.members;
    if (result.reason !== "caller_not_member") return null;
  }
  return null;
}

function digestSubject(overdue: number, upcoming: number, horizonDays: number): string {
  if (overdue > 0 && upcoming > 0) {
    return `OpenPlan: ${overdue} overdue, ${upcoming} due in the next ${horizonDays} days`;
  }
  if (overdue > 0) {
    return `OpenPlan: ${overdue} overdue ${overdue === 1 ? "deadline" : "deadlines"}`;
  }
  return `OpenPlan: ${upcoming} due in the next ${horizonDays} days`;
}

function digestBody(
  items: readonly Candidate[],
  workspaceName: string | null,
  horizonDays: number,
  appOrigin: string | null
): string {
  const overdue = items.filter((item) => item.isOverdue);
  const upcoming = items.filter((item) => !item.isOverdue);
  const line = (item: Candidate) =>
    `  - ${item.title} — ${formatWorkDeadlineDate(item.due_on) ?? item.due_on}`;

  const parts: string[] = [
    workspaceName
      ? `Here is what is on your plate in ${workspaceName}.`
      : "Here is what is on your plate.",
    "",
  ];
  if (overdue.length > 0) {
    parts.push(`Overdue (${overdue.length}):`, ...overdue.map(line), "");
  }
  if (upcoming.length > 0) {
    parts.push(`Due in the next ${horizonDays} days (${upcoming.length}):`, ...upcoming.map(line), "");
  }
  parts.push(
    appOrigin ? `See everything: ${appOrigin}/my-work` : "See everything on the My Work page in OpenPlan.",
    "",
    `This is a once-a-day summary of deadlines recorded in OpenPlan. It is sent only when something is due within the next ${horizonDays} ${horizonDays === 1 ? "day" : "days"} or already overdue.`
  );
  return parts.join("\n");
}

/**
 * Run one sweep.
 *
 * Returns what it did in enough detail for an operator to tell "nothing was
 * due" from "three sources could not be read" — the two answers a reminder
 * system must never merge.
 */
export async function sweepWorkDeadlines(
  client: WorkSweepClient,
  options: SweepWorkDeadlinesOptions = {}
): Promise<WorkSweepResult> {
  const now = options.now ?? new Date();
  let preferencesUnavailable = false;
  const preferences = new Map<string, WorkspaceReminderPreference>();
  if (options.horizonDays === undefined) {
    try {
      const read = await client
        .from("workspace_reminder_preferences")
        .select("workspace_id, advance_days, email_digest_enabled");
      if (read.error) preferencesUnavailable = true;
      else {
        for (const row of (read.data ?? []) as Array<Record<string, unknown>>) {
          const workspaceId = typeof row.workspace_id === "string" ? row.workspace_id : null;
          if (workspaceId) preferences.set(workspaceId, parseReminderPreference(row, workspaceId));
        }
      }
    } catch {
      preferencesUnavailable = true;
    }
  }
  const horizonDays = options.horizonDays ?? Math.max(
    DEFAULT_REMINDER_ADVANCE_DAYS,
    ...[...preferences.values()].map((preference) => preference.advanceDays)
  );
  const limit = options.limitPerSource ?? WORK_SWEEP_SOURCE_LIMIT;
  const appOrigin = options.appOrigin ?? null;
  const loadRoster = options.loadRoster ?? loadWorkspaceRoster;

  const perSource = Object.fromEntries(
    WORK_SWEEP_SOURCES.map((source) => [source.kind, emptyOutcome()])
  ) as Record<WorkNotificationKind, WorkSweepSourceOutcome>;

  const candidates: Candidate[] = [];
  for (const source of WORK_SWEEP_SOURCES) {
    const { rows, outcome } = await readSource(client, source, now, horizonDays, limit);
    // The second read, when a source declares one, and only when the first
    // found something: a failure here costs the reminder its figure, never the
    // reminder itself.
    const context =
      source.loadContext && rows.length > 0
        ? await source.loadContext(client, rows, limit)
        : EMPTY_SWEEP_CONTEXT;
    outcome.contextUnavailable = context.unavailable;
    const produced = source.toCandidates(rows, now, context);
    const filtered = produced.filter((candidate) => {
      if (candidate.isOverdue) return true;
      const preference = preferences.get(candidate.workspace_id);
      const advanceDays = options.horizonDays ?? preference?.advanceDays ?? DEFAULT_REMINDER_ADVANCE_DAYS;
      return new Date(candidate.due_on).getTime() <= now.getTime() + advanceDays * 86400000;
    });
    outcome.candidates = filtered.length;
    perSource[source.kind] = outcome;
    candidates.push(...filtered);
  }

  const result: WorkSweepResult = {
    now: now.toISOString(),
    horizonDays,
    perSource,
    notificationsCreated: 0,
    digestsComposed: 0,
    emailsDelivered: 0,
    emailsSkipped: 0,
    emailsFailed: 0,
    emailUnavailable: 0,
    departedRecipients: 0,
    workspacesWithoutRoster: [],
    writeError: null,
    workspaceNamesUnavailable: false,
    reminderPreferencesUnavailable: preferencesUnavailable,
    emailDigestsDisabled: 0,
  };

  if (candidates.length === 0) return result;

  // ── membership: only a current member of THAT workspace is reminded ──
  const byWorkspace = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    const existing = byWorkspace.get(candidate.workspace_id) ?? [];
    existing.push(candidate);
    byWorkspace.set(candidate.workspace_id, existing);
  }

  const rosters = new Map<string, readonly RosterMember[]>();
  for (const [workspaceId, workspaceCandidates] of byWorkspace) {
    const candidateIds = [...new Set(workspaceCandidates.map((item) => item.recipient_user_id))];
    const members = await rosterForWorkspace(client, workspaceId, candidateIds, loadRoster);
    if (!members) {
      result.workspacesWithoutRoster.push(workspaceId);
      continue;
    }
    rosters.set(workspaceId, members);
  }

  const eligible = candidates.filter((candidate) => {
    const members = rosters.get(candidate.workspace_id);
    if (!members) return false;
    if (isOnRoster(members, candidate.recipient_user_id)) return true;
    result.departedRecipients += 1;
    return false;
  });

  if (eligible.length === 0) return result;

  // ── the write. ON CONFLICT DO NOTHING against the migration's unique index,
  // returning ONLY what was created — which is what the digest is built from.
  let created: Array<Record<string, unknown>> = [];
  try {
    const write = await client
      .from("work_notifications")
      .upsert(
        eligible.map(({ isOverdue: _isOverdue, ...row }) => row),
        { onConflict: WORK_NOTIFICATION_IDEMPOTENCY_COLUMNS.join(","), ignoreDuplicates: true }
      )
      .select("subject_table, subject_id, recipient_user_id, due_on, workspace_id");
    if (write.error) {
      result.writeError = write.error.message ?? "the database returned no reason";
      return result;
    }
    created = (write.data ?? []) as Array<Record<string, unknown>>;
  } catch (error) {
    result.writeError = error instanceof Error ? error.message : "the reminder write threw";
    return result;
  }

  result.notificationsCreated = created.length;
  if (created.length === 0) return result;

  // ── the digest: one email per recipient, for the rows just created ──
  const createdKeys = new Set(
    created.map(
      (row) =>
        `${asString(row.subject_table)}::${asString(row.subject_id)}::${asString(row.recipient_user_id)}`
    )
  );
  const newlyNotified = eligible.filter((candidate) =>
    createdKeys.has(
      `${candidate.subject_table}::${candidate.subject_id}::${candidate.recipient_user_id}`
    )
  );

  const workspaceNames = await loadWorkspaceNames(client, [
    ...new Set(newlyNotified.map((item) => item.workspace_id)),
  ]);
  result.workspaceNamesUnavailable = workspaceNames.failed;

  const byRecipient = new Map<string, Candidate[]>();
  for (const item of newlyNotified) {
    const key = `${item.workspace_id}::${item.recipient_user_id}`;
    const existing = byRecipient.get(key) ?? [];
    existing.push(item);
    byRecipient.set(key, existing);
  }

  for (const [key, items] of byRecipient) {
    const [workspaceId, recipientId] = key.split("::");
    const preference = preferences.get(workspaceId) ?? {
      workspaceId,
      advanceDays: options.horizonDays ?? DEFAULT_REMINDER_ADVANCE_DAYS,
      emailDigestEnabled: true,
    };
    if (!preference.emailDigestEnabled) {
      result.emailDigestsDisabled += 1;
      continue;
    }
    result.digestsComposed += 1;
    const member = rosters.get(workspaceId)?.find((candidate) => candidate.userId === recipientId);
    const email = member?.email ?? null;
    if (!email) {
      // In-app only. NOT a delivery, and not a failure of the transport —
      // there was no address to send to.
      result.emailUnavailable += 1;
      continue;
    }

    const overdue = items.filter((item) => item.isOverdue).length;
    // The cast is the repo's untyped-client convention (`service as
    // RosterServiceClient`): every Supabase client here is structural, and the
    // outbox helper declares the slice it needs rather than the whole client.
    const outcome = await enqueueEmail(client as unknown as Parameters<typeof enqueueEmail>[0], {
      campaignId: null,
      to: email,
      subject: digestSubject(overdue, items.length - overdue, preference.advanceDays),
      text: digestBody(items, workspaceNames.names.get(workspaceId) ?? null, preference.advanceDays, appOrigin),
      template: "work_deadline_digest",
      payload: { workspaceId, recipientUserId: recipientId, itemCount: items.length, overdue },
    });
    if (outcome.status === "sent") result.emailsDelivered += 1;
    else if (outcome.status === "skipped") result.emailsSkipped += 1;
    else result.emailsFailed += 1;
  }

  return result;
}

// ── the inbox read ──────────────────────────────────────────────────────────

/**
 * ONE MODULE OWNS THIS TABLE, reads included.
 *
 * The read below uses the CALLER'S RLS client, not the service role, and that
 * asymmetry with the sweep above is the point: `work_notifications`' SELECT
 * policy is `recipient_user_id = auth.uid() AND <member>`, so the database is
 * already the access control and a service-role read here would replace it with
 * an `.eq()` nobody checks. The sweep needs the service role because a cron has
 * no `auth.uid()`; the inbox has one.
 */
export type WorkNotificationInboxRow = {
  id: string;
  kind: WorkNotificationKind | string;
  title: string;
  body: string;
  dueOn: string;
  projectId: string | null;
  createdAt: string | null;
};

export type WorkNotificationInbox =
  | { ok: true; rows: WorkNotificationInboxRow[]; truncated: boolean }
  /**
   * A failed read is NEVER an empty inbox. "You have no reminders" is a claim
   * about the world; a broken query establishes nothing, and a planner who
   * reads the first sentence acts on it by going home.
   */
  | { ok: false; pending: boolean; message: string };

/** The columns the panel renders — asserted as a projection by its test. */
export const WORK_NOTIFICATION_INBOX_COLUMNS =
  "id, kind, title, body, due_on, project_id, created_at";

export const WORK_NOTIFICATION_INBOX_LIMIT = 50;

type InboxReadClient = {
  from(table: string): { select(columns: string): InboxQuery };
};

type InboxQuery = PromiseLike<SweepReadResult> & {
  eq(column: string, value: string | boolean): InboxQuery;
  order(column: string, options: { ascending: boolean }): InboxQuery;
  limit(count: number): InboxQuery;
};

/**
 * This person's UNREAD reminders, soonest deadline first.
 *
 * Unread only, deliberately: the queue on the same page already lists every
 * deadline that exists, so a reminder that has been read has nothing left to
 * add. What the panel is for is the one thing the queue cannot say — "you were
 * told about this".
 */
export async function loadWorkNotifications(
  supabase: unknown,
  recipientUserId: string,
  options: { limit?: number } = {}
): Promise<WorkNotificationInbox> {
  const client = supabase as InboxReadClient;
  const limit = options.limit ?? WORK_NOTIFICATION_INBOX_LIMIT;
  try {
    const result = await client
      .from("work_notifications")
      .select(WORK_NOTIFICATION_INBOX_COLUMNS)
      // Redundant with the RLS policy and kept anyway: a query that is correct
      // on its own terms does not depend on a policy staying written.
      .eq("recipient_user_id", recipientUserId)
      .eq("is_read", false)
      .order("due_on", { ascending: true })
      .limit(limit);

    if (result.error) {
      const message = result.error.message ?? "the database returned no reason";
      return { ok: false, pending: looksLikePendingSchema(message), message };
    }

    const rows = ((result.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id),
      kind: asString(row.kind) ?? "deliverable_due",
      title: asString(row.title) ?? "(untitled reminder)",
      body: asString(row.body) ?? "",
      dueOn: asString(row.due_on) ?? "",
      projectId: asString(row.project_id),
      createdAt: asString(row.created_at),
    }));

    return { ok: true, rows, truncated: rows.length >= limit };
  } catch (error) {
    const message = error instanceof Error ? error.message : "the reminder read threw";
    return { ok: false, pending: looksLikePendingSchema(message), message };
  }
}

/**
 * Workspace names for the digest's opening line.
 *
 * The error is BOUND and returned, not destructured away. A reminder is worth
 * more than its heading, so a failed read here does not withhold anybody's
 * digest — but "the emails went out without naming the workspace" is a fact the
 * sweep reports rather than absorbs, which is the rule
 * `a-library-may-not-discard-a-read-error` exists to keep.
 */
async function loadWorkspaceNames(
  client: WorkSweepClient,
  workspaceIds: readonly string[]
): Promise<{ names: Map<string, string>; failed: boolean }> {
  const names = new Map<string, string>();
  if (workspaceIds.length === 0) return { names, failed: false };
  try {
    const { data, error } = await client.from("workspaces").select("id, name").in("id", workspaceIds);
    if (error) return { names, failed: true };
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const id = asString(row.id);
      const name = asString(row.name);
      if (id && name) names.set(id, name);
    }
  } catch {
    return { names, failed: true };
  }
  return { names, failed: false };
}
