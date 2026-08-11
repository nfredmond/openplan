import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  loadWorkNotifications,
  sweepWorkDeadlines,
  WORK_DEADLINE_HORIZON_DAYS,
  WORK_NOTIFICATION_KINDS,
  WORK_NOTIFICATION_IDEMPOTENCY_COLUMNS,
  WORK_NOTIFICATION_INBOX_COLUMNS,
  WORK_SWEEP_SOURCES,
  type WorkSweepClient,
} from "@/lib/notifications/work";

import {
  FakeWorkDb,
  migrationDeclaresNotNullDueOn,
  migrationExists,
  migrationKindVocabulary,
  workNotificationUniqueKey,
} from "./helpers/fake-work-notification-tables";

/**
 * THE DAILY DEADLINE SWEEP.
 *
 * The four things that decide whether reminders are safe to ship, and the
 * mutation that proves each assertion is real (each reverted after; reported in
 * the lane's handoff):
 *
 *   1. IDEMPOTENCY IS THE INDEX. Removing the `CREATE UNIQUE INDEX` line from
 *      20260811000007 makes "runs twice, mails once" fail — the fake's
 *      uniqueness is read out of that migration, so the guard cannot pass while
 *      the constraint it depends on is gone.
 *   2. MEMBERSHIP IS PER WORKSPACE. Deleting the `isOnRoster` filter in
 *      `sweepWorkDeadlines` makes the decoy test fail: the same person is a
 *      member of workspace two and not of workspace one, so a filter that
 *      merely checked "is this a real user" would pass one fixture and this one
 *      catches it.
 *   3. OVERDUE IS NOT REDEFINED HERE. Replacing `isDeadlinePast` with a local
 *      comparison, or `invoicePriority(...) === 0` with a date test, changes the
 *      digest's counts and fails.
 *   4. NO TRANSPORT STILL RECORDS. Skipping `enqueueEmail` when email is
 *      unconfigured — the tempting "why write a row nobody will read" —
 *      empties the outbox assertion.
 */

const WORKSPACE_ONE = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_TWO = "22222222-2222-4222-8222-222222222222";
const ALICE = "aaaaaaaa-0000-4000-8000-00000000000a";
const BOB = "bbbbbbbb-0000-4000-8000-00000000000b";
/** A member of workspace two ONLY — the cross-workspace decoy. */
const CAROL = "cccccccc-0000-4000-8000-00000000000c";
/** Assigned work, on nobody's roster: someone who has left. */
const DEPARTED = "dddddddd-0000-4000-8000-00000000000d";

const PROJECT_ONE = "10000000-0000-4000-8000-000000000001";
const PROJECT_TWO = "10000000-0000-4000-8000-000000000002";
const PROJECT_THREE = "20000000-0000-4000-8000-000000000003";

const NOW = new Date("2026-08-11T12:00:00.000Z");

function projectOne() {
  return { id: PROJECT_ONE, name: "Corridor study", workspace_id: WORKSPACE_ONE };
}
function projectTwo() {
  return { id: PROJECT_TWO, name: "Safety action plan", workspace_id: WORKSPACE_ONE };
}
function projectThree() {
  return { id: PROJECT_THREE, name: "General plan update", workspace_id: WORKSPACE_TWO };
}

function fixtures() {
  return {
    project_deliverables: [
      // Earliest date first only matters because the sweep orders by it: this
      // row is the FIRST candidate the workspace sees, and its recipient has
      // left — so the roster lookup must move on to the next candidate rather
      // than giving up on the whole workspace.
      {
        id: "d-departed",
        project_id: PROJECT_ONE,
        title: "Draft existing-conditions memo",
        due_date: "2026-07-20",
        status: "in_progress",
        assignee_user_id: DEPARTED,
        projects: projectOne(),
      },
      {
        id: "d-overdue",
        project_id: PROJECT_ONE,
        title: "Public review draft",
        due_date: "2026-08-01",
        status: "in_progress",
        assignee_user_id: ALICE,
        projects: projectOne(),
      },
      {
        id: "d-soon",
        project_id: PROJECT_ONE,
        title: "Technical appendix",
        due_date: "2026-08-14",
        status: "not_started",
        assignee_user_id: ALICE,
        projects: projectOne(),
      },
      // Assigned to a member of the OTHER workspace. Same person, wrong team.
      {
        id: "d-decoy",
        project_id: PROJECT_ONE,
        title: "Decoy — assignee belongs to another workspace",
        due_date: "2026-08-12",
        status: "in_progress",
        assignee_user_id: CAROL,
        projects: projectOne(),
      },
      // Beyond the horizon.
      {
        id: "d-far",
        project_id: PROJECT_ONE,
        title: "Final report",
        due_date: "2026-09-30",
        status: "in_progress",
        assignee_user_id: ALICE,
        projects: projectOne(),
      },
      // Done.
      {
        id: "d-complete",
        project_id: PROJECT_ONE,
        title: "Kickoff agenda",
        due_date: "2026-08-12",
        status: "complete",
        assignee_user_id: ALICE,
        projects: projectOne(),
      },
      // Nobody assigned: an unassigned deadline is real, but it is not a
      // reminder for a person, and inventing a recipient is the one thing the
      // whole assignee lane refuses to do.
      {
        id: "d-unassigned",
        project_id: PROJECT_ONE,
        title: "Unassigned task",
        due_date: "2026-08-13",
        status: "in_progress",
        assignee_user_id: null,
        projects: projectOne(),
      },
      // The same person, in the workspace they ARE a member of.
      {
        id: "d-other-workspace",
        project_id: PROJECT_THREE,
        title: "Housing element outline",
        due_date: "2026-08-14",
        status: "in_progress",
        assignee_user_id: CAROL,
        projects: projectThree(),
      },
    ],
    project_milestones: [
      {
        id: "m-1",
        project_id: PROJECT_TWO,
        title: "Council presentation",
        target_date: "2026-08-15",
        status: "scheduled",
        assignee_user_id: BOB,
        projects: projectTwo(),
      },
    ],
    project_submittals: [
      {
        id: "s-1",
        project_id: PROJECT_TWO,
        title: "Authorization packet",
        due_date: "2026-08-17",
        status: "submitted",
        agency_label: "the state DOT district office",
        assignee_user_id: BOB,
        projects: projectTwo(),
      },
    ],
    funding_opportunities: [
      {
        id: "fo-pending",
        workspace_id: WORKSPACE_ONE,
        project_id: PROJECT_ONE,
        title: "Active transportation program",
        agency_name: "the state grant office",
        decision_due_at: "2026-08-13T00:00:00.000Z",
        opportunity_status: "open",
        decision_state: "monitor",
        created_by: ALICE,
      },
      // Already decided — excluded by the SHARED predicate, not by a filter
      // written here. A local "is it undecided" test is what made two other
      // surfaces disagree.
      {
        id: "fo-decided",
        workspace_id: WORKSPACE_ONE,
        project_id: PROJECT_ONE,
        title: "Already-decided opportunity",
        agency_name: "the state grant office",
        decision_due_at: "2026-08-13T00:00:00.000Z",
        opportunity_status: "open",
        decision_state: "pursue",
        created_by: ALICE,
      },
    ],
    funding_awards: [
      {
        id: "fa-1",
        workspace_id: WORKSPACE_ONE,
        project_id: PROJECT_TWO,
        title: "Safety implementation award",
        obligation_due_at: "2026-08-16T00:00:00.000Z",
        spending_status: "partially_spent",
        created_by: BOB,
      },
      {
        id: "fa-spent",
        workspace_id: WORKSPACE_ONE,
        project_id: PROJECT_TWO,
        title: "Closed-out award",
        obligation_due_at: "2026-08-16T00:00:00.000Z",
        spending_status: "fully_spent",
        created_by: BOB,
      },
    ],
    billing_invoice_records: [
      {
        id: "bi-overdue",
        workspace_id: WORKSPACE_ONE,
        project_id: PROJECT_TWO,
        invoice_number: "2026-014",
        due_date: "2026-08-05",
        status: "submitted",
        submitted_to: "the funding agency",
        created_by: BOB,
      },
      {
        id: "bi-paid",
        workspace_id: WORKSPACE_ONE,
        project_id: PROJECT_TWO,
        invoice_number: "2026-013",
        due_date: "2026-08-05",
        status: "paid",
        submitted_to: "the funding agency",
        created_by: BOB,
      },
    ],
    workspace_members: [
      { workspace_id: WORKSPACE_ONE, user_id: ALICE, role: "member" },
      { workspace_id: WORKSPACE_ONE, user_id: BOB, role: "member" },
      { workspace_id: WORKSPACE_TWO, user_id: CAROL, role: "member" },
    ],
    workspaces: [
      { id: WORKSPACE_ONE, name: "Workspace one" },
      { id: WORKSPACE_TWO, name: "Workspace two" },
    ],
    work_notifications: [],
  };
}

/**
 * The db AND the fixture tables it reads, so a test can add a record BETWEEN
 * two sweeps. Without a handle on the tables, every second run necessarily sees
 * the same world as the first, and the only second-run case the suite can
 * express is "everything is a duplicate" — which is how the digest's
 * newly-created filter went untested. See the incremental-day test below.
 */
function makeDbWithFixtures() {
  const tables = fixtures();
  const db = new FakeWorkDb({ tables });
  db.emails.set(ALICE, "alice@example.gov");
  db.emails.set(BOB, "bob@example.gov");
  db.emails.set(CAROL, "carol@example.gov");
  return { db, tables };
}

function makeDb() {
  return makeDbWithFixtures().db;
}

async function run(db: FakeWorkDb, options: Record<string, unknown> = {}) {
  return sweepWorkDeadlines(db as unknown as WorkSweepClient, {
    now: NOW,
    appOrigin: "https://plan.example.gov",
    ...options,
  });
}

let savedResendKey: string | undefined;

beforeEach(() => {
  savedResendKey = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
});

afterEach(() => {
  if (savedResendKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = savedResendKey;
});

describe("the daily deadline sweep", () => {
  it("is backed by a migration whose unique index is what makes it idempotent", () => {
    expect(migrationExists()).toBe(true);
    // The code names these columns as its ON CONFLICT target; the database
    // enforces them. Pinning the two together is what stops a rename in one
    // place from turning the guarantee off in the other.
    expect(workNotificationUniqueKey()).toEqual([...WORK_NOTIFICATION_IDEMPOTENCY_COLUMNS]);
  });

  it("uses the kind vocabulary the database will accept, and no other", () => {
    // The CHECK constraint is the vocabulary; this module holds a copy of it,
    // and a copy that drifts becomes a sweep whose every insert is rejected at
    // 13:00 UTC with nobody watching. Derived from the migration rather than
    // retyped here, so the assertion cannot agree with a stale list.
    expect(migrationKindVocabulary().sort()).toEqual([...WORK_NOTIFICATION_KINDS].sort());
    // Every kind is actually produced by a source — a vocabulary entry nothing
    // emits is a capability that looks shipped and is not.
    expect(WORK_SWEEP_SOURCES.map((source) => source.kind).sort()).toEqual(
      [...WORK_NOTIFICATION_KINDS].sort()
    );
  });

  it("keeps due_on NOT NULL, or the unique index would guarantee nothing", () => {
    // NULLs are DISTINCT in a unique index. A nullable `due_on` would leave the
    // constraint in place and silently stop de-duplicating, which is the worst
    // shape of this defect: the guard above still finds an index, and the digest
    // goes out every day.
    expect(migrationDeclaresNotNullDueOn()).toBe(true);
  });

  it("writes one reminder per person per record, in the workspace the record belongs to", async () => {
    const db = makeDb();
    const result = await run(db);

    expect(result.writeError).toBeNull();
    const bySubject = db.notifications.map((row) => `${row.recipient_user_id}:${row.subject_id}`).sort();
    expect(bySubject).toEqual(
      [
        `${ALICE}:d-overdue`,
        `${ALICE}:d-soon`,
        `${ALICE}:fo-pending`,
        `${BOB}:bi-overdue`,
        `${BOB}:fa-1`,
        `${BOB}:m-1`,
        `${BOB}:s-1`,
        `${CAROL}:d-other-workspace`,
      ].sort()
    );

    // Each row carries the workspace of its OWN record, not of the sweep.
    const carolRow = db.notifications.find((row) => row.recipient_user_id === CAROL);
    expect(carolRow?.workspace_id).toBe(WORKSPACE_TWO);
    expect(db.notifications.filter((row) => row.workspace_id === WORKSPACE_ONE)).toHaveLength(7);

    expect(result.notificationsCreated).toBe(8);
    expect(result.digestsComposed).toBe(3);
    expect(result.horizonDays).toBe(WORK_DEADLINE_HORIZON_DAYS);
  });

  it("refuses a recipient who is not a member of THAT workspace, though they are of another", async () => {
    // THE DECOY, and the binding varied: one fixture, one person, two
    // workspaces, opposite answers. A membership check that asked "is this a
    // real user" — or that consulted the wrong workspace's roster — would put
    // Carol's name on workspace one's deliverable and pass a single-workspace
    // fixture.
    const db = makeDb();
    const result = await run(db);

    const carolsWorkspaceOneRows = db.notifications.filter(
      (row) => row.recipient_user_id === CAROL && row.workspace_id === WORKSPACE_ONE
    );
    expect(carolsWorkspaceOneRows).toEqual([]);
    expect(
      db.notifications.filter((row) => row.recipient_user_id === CAROL && row.workspace_id === WORKSPACE_TWO)
    ).toHaveLength(1);

    // The departed assignee, and Carol-in-the-wrong-workspace.
    expect(result.departedRecipients).toBe(2);
    expect(db.notifications.some((row) => row.recipient_user_id === DEPARTED)).toBe(false);
    // A departed FIRST candidate must not cost the workspace its roster: the
    // lookup moves on rather than giving up.
    expect(result.workspacesWithoutRoster).toEqual([]);
  });

  it("runs twice and creates nothing, and mails nothing, the second time", async () => {
    const db = makeDb();
    const first = await run(db);
    expect(first.notificationsCreated).toBe(8);
    expect(first.digestsComposed).toBe(3);
    const outboxAfterFirst = db.outbox.length;
    expect(outboxAfterFirst).toBe(3);

    const second = await run(db);

    expect(second.notificationsCreated).toBe(0);
    expect(second.digestsComposed).toBe(0);
    expect(db.notifications).toHaveLength(8);
    expect(db.outbox).toHaveLength(outboxAfterFirst);

    // And it did TRY — the idempotency is the database's, not a pre-read that
    // could get out of step with it.
    expect(db.upsertCalls).toHaveLength(2);
    expect(db.upsertCalls[1].ignoreDuplicates).toBe(true);
    expect(db.upsertCalls[1].onConflict).toBe(WORK_NOTIFICATION_IDEMPOTENCY_COLUMNS.join(","));
  });

  it("mails a second digest that contains ONLY what is genuinely new", async () => {
    /**
     * THE INCREMENTAL DAY — the case the sweep exists for and the suite could
     * not previously express.
     *
     * `newlyNotified` filters `eligible` down to the rows the database actually
     * created, and replacing that filter with `eligible` outright survived the
     * ENTIRE suite: the early exit at `if (created.length === 0) return` meant
     * the only second run ever exercised was the all-duplicate one, where the
     * two are indistinguishable because neither sends anything. It takes a run
     * in which SOME rows are new and some are not — i.e. an ordinary Tuesday —
     * to tell them apart. Without that, a planner who was told about a memo on
     * Monday would be told about it again every single morning until it was
     * due, which is how a reminder system trains people to ignore it.
     *
     * The new deliverable is due the SAME DAY as one Alice was already told
     * about, deliberately: the filter is per-record, not per-day, and a
     * date-based shortcut would pass a fixture where the new item stood alone
     * on its own date.
     */
    const { db, tables } = makeDbWithFixtures();

    const first = await run(db);
    expect(first.notificationsCreated).toBe(8);
    expect(first.digestsComposed).toBe(3);
    expect(db.outbox).toHaveLength(3);

    tables.project_deliverables.push({
      id: "d-new",
      project_id: PROJECT_ONE,
      title: "Council packet cover memo",
      due_date: "2026-08-14",
      status: "in_progress",
      assignee_user_id: ALICE,
      projects: projectOne(),
    });

    const second = await run(db);

    expect(second.notificationsCreated).toBe(1);
    // ONE digest — Alice's. Bob and Carol have nothing new, so they hear
    // nothing at all rather than hearing yesterday's list again.
    expect(second.digestsComposed).toBe(1);
    expect(db.outbox).toHaveLength(4);

    const digest = db.outbox[3];
    expect(digest.to_email).toBe("alice@example.gov");
    expect(String(digest.body)).toContain("Council packet cover memo");
    // …and NOT the three she was told about yesterday.
    for (const alreadyNotified of [
      "Public review draft",
      "Technical appendix",
      "Active transportation program",
    ]) {
      expect(
        String(digest.body),
        `${alreadyNotified} was already notified and must not be repeated`
      ).not.toContain(alreadyNotified);
    }
    // The counts are built from the same filtered list, so they cannot drift
    // from the body: one upcoming item, nothing overdue.
    expect(digest.subject).toBe("OpenPlan: 1 due in the next 7 days");
    expect((digest.payload_json as { itemCount: number }).itemCount).toBe(1);
  });

  it("records every digest in the outbox even though no transport is configured", async () => {
    const db = makeDb();
    const result = await run(db);

    expect(result.emailsDelivered).toBe(0);
    expect(result.emailsSkipped).toBe(3);
    expect(result.emailsFailed).toBe(0);
    expect(result.emailUnavailable).toBe(0);

    expect(db.outbox).toHaveLength(3);
    for (const row of db.outbox) {
      // NULL campaign, always: a deadline reminder is not a public-engagement
      // broadcast and must not be attributed to one.
      expect(row.campaign_id).toBeNull();
      expect(row.template).toBe("work_deadline_digest");
      // Recorded, then honestly marked as not sent.
      expect(row.status).toBe("skipped");
      expect(row.transport).toBe("none");
    }
    expect(db.outbox.map((row) => row.to_email).sort()).toEqual([
      "alice@example.gov",
      "bob@example.gov",
      "carol@example.gov",
    ]);
  });

  it("says the deadline is overdue only when the shared predicate says so", async () => {
    const db = makeDb();
    await run(db);

    const alice = db.outbox.find((row) => row.to_email === "alice@example.gov");
    // Two overdue for Alice? No — one: the 1 August draft. The 14 August
    // appendix and the 13 August grant decision are ahead of `now`.
    expect(alice?.subject).toBe("OpenPlan: 1 overdue, 2 due in the next 7 days");
    expect(String(alice?.body)).toContain("Overdue (1):");
    expect(String(alice?.body)).toContain("Public review draft");
    expect(String(alice?.body)).toContain("Due in the next 7 days (2):");
    expect(String(alice?.body)).toContain("https://plan.example.gov/my-work");
    expect(String(alice?.body)).toContain("Workspace one");

    // Bob's invoice is overdue by `invoicePriority`, not by a second date test
    // written here: unsettled AND past due.
    const bob = db.outbox.find((row) => row.to_email === "bob@example.gov");
    expect(bob?.subject).toBe("OpenPlan: 1 overdue, 3 due in the next 7 days");
    expect(String(bob?.body)).toContain("Invoice 2026-014");

    const overdueRow = db.notifications.find((row) => row.subject_id === "d-overdue");
    expect(String(overdueRow?.body)).toContain("is now overdue");
    const upcomingRow = db.notifications.find((row) => row.subject_id === "d-soon");
    expect(String(upcomingRow?.body)).toContain("due Aug 14, 2026");
    expect(String(upcomingRow?.body)).not.toContain("overdue");
  });

  it("leaves out records that are closed, settled, already decided, unassigned or beyond the week", async () => {
    const db = makeDb();
    await run(db);

    const subjects = db.notifications.map((row) => row.subject_id);
    for (const excluded of ["d-complete", "d-far", "d-unassigned", "fo-decided", "fa-spent", "bi-paid"]) {
      expect(subjects, `${excluded} must not produce a reminder`).not.toContain(excluded);
    }
  });

  it("dates the reminder by the calendar day the record is due, in UTC", async () => {
    const db = makeDb();
    await run(db);

    // A `date` column passes straight through; a `timestamptz` is reduced to
    // its UTC day, so a one-second edit to a grant deadline does not re-notify.
    expect(db.notifications.find((row) => row.subject_id === "d-soon")?.due_on).toBe("2026-08-14");
    expect(db.notifications.find((row) => row.subject_id === "fo-pending")?.due_on).toBe("2026-08-13");
  });

  it("reports a source that failed without emptying the ones that did not", async () => {
    const db = new FakeWorkDb({
      tables: fixtures(),
      errors: { project_milestones: { message: "permission denied for table project_milestones" } },
    });
    db.emails.set(ALICE, "alice@example.gov");
    db.emails.set(BOB, "bob@example.gov");
    db.emails.set(CAROL, "carol@example.gov");

    const result = await run(db);

    expect(result.perSource.milestone_due.failed).toBe(true);
    expect(result.perSource.milestone_due.pending).toBe(false);
    expect(result.perSource.milestone_due.message).toContain("permission denied");
    // The other five still ran, and the milestone is simply absent — never
    // rendered as "no milestone is due".
    expect(result.perSource.deliverable_due.candidates).toBeGreaterThan(0);
    expect(db.notifications.some((row) => row.subject_id === "m-1")).toBe(false);
    expect(db.notifications.some((row) => row.subject_id === "s-1")).toBe(true);
  });

  it("calls a deployment behind the migration pending, not broken", async () => {
    const db = new FakeWorkDb({
      tables: fixtures(),
      errors: {
        project_deliverables: {
          message: 'column project_deliverables.assignee_user_id does not exist',
        },
      },
    });
    const result = await run(db);

    expect(result.perSource.deliverable_due.pending).toBe(true);
    expect(result.perSource.deliverable_due.failed).toBe(false);
  });

  it("discloses a capped read rather than absorbing it", async () => {
    const db = makeDb();
    const result = await run(db, { limitPerSource: 2 });

    expect(result.perSource.deliverable_due.truncated).toBe(true);
    expect(result.perSource.milestone_due.truncated).toBe(false);
  });

  it("never writes when a workspace's roster cannot be read", async () => {
    const db = makeDb();
    const result = await run(db, {
      loadRoster: async () => ({ ok: false as const, reason: "roster_read_failed" as const, message: "boom" }),
    });

    expect(db.notifications).toEqual([]);
    expect(db.outbox).toEqual([]);
    // Named, not silent — an operator can tell this from "nothing was due".
    expect(result.workspacesWithoutRoster.sort()).toEqual([WORKSPACE_ONE, WORKSPACE_TWO].sort());
    expect(result.notificationsCreated).toBe(0);
  });

  it("still sends the digest when the workspace name cannot be read, and says so", async () => {
    const db = new FakeWorkDb({
      tables: fixtures(),
      errors: { workspaces: { message: "permission denied for table workspaces" } },
    });
    db.emails.set(ALICE, "alice@example.gov");
    db.emails.set(BOB, "bob@example.gov");
    db.emails.set(CAROL, "carol@example.gov");

    const result = await run(db);

    // The reminder matters more than its heading — nobody's digest is withheld.
    expect(result.notificationsCreated).toBe(8);
    expect(db.outbox).toHaveLength(3);
    const alice = db.outbox.find((row) => row.to_email === "alice@example.gov");
    expect(String(alice?.body)).toContain("Here is what is on your plate.");
    expect(String(alice?.body)).not.toContain("Workspace one");
    // … but the swallowed read is reported rather than absorbed.
    expect(result.workspaceNamesUnavailable).toBe(true);
  });

  it("records the reminder in-app when a recipient has no email address", async () => {
    const db = new FakeWorkDb({ tables: fixtures() });
    // No emails resolved at all: the auth lookup answered null for everyone.
    const result = await run(db);

    expect(result.notificationsCreated).toBe(8);
    expect(result.digestsComposed).toBe(3);
    expect(result.emailUnavailable).toBe(3);
    expect(result.emailsSkipped).toBe(0);
    expect(db.outbox).toEqual([]);
  });
});

describe("the reminder inbox read", () => {
  it("asks the database for the columns the panel renders", async () => {
    const db = new FakeWorkDb({
      tables: {
        work_notifications: [
          {
            id: "n-1",
            recipient_user_id: ALICE,
            is_read: false,
            kind: "deliverable_due",
            title: "Public review draft",
            body: "Deliverable on Corridor study — was due Aug 1, 2026 and is now overdue.",
            due_on: "2026-08-01",
            project_id: PROJECT_ONE,
            created_at: "2026-08-11T13:00:00.000Z",
          },
          {
            id: "n-read",
            recipient_user_id: ALICE,
            is_read: true,
            kind: "milestone_due",
            title: "Already read",
            body: "",
            due_on: "2026-08-02",
            project_id: null,
            created_at: "2026-08-10T13:00:00.000Z",
          },
          {
            id: "n-someone-else",
            recipient_user_id: BOB,
            is_read: false,
            kind: "invoice_due",
            title: "Not Alice's",
            body: "",
            due_on: "2026-08-03",
            project_id: null,
            created_at: "2026-08-11T13:00:00.000Z",
          },
        ],
      },
    });

    const inbox = await loadWorkNotifications(db, ALICE);

    expect(inbox.ok).toBe(true);
    if (!inbox.ok) return;
    expect(inbox.rows.map((row) => row.id)).toEqual(["n-1"]);
    expect(inbox.rows[0].title).toBe("Public review draft");

    // THE PROJECTION ITSELF. A mocked client returns the fixture whatever was
    // asked for, so deleting a column from the select would leave every
    // assertion above green while the panel rendered `undefined`.
    const read = db.reads.find((entry) => entry.table === "work_notifications");
    expect(read?.select).toBe(WORK_NOTIFICATION_INBOX_COLUMNS);
    for (const column of ["id", "kind", "title", "body", "due_on", "project_id"]) {
      expect(read?.select).toContain(column);
    }
  });

  it("reports a failed read as unavailable, never as an empty inbox", async () => {
    const db = new FakeWorkDb({
      tables: { work_notifications: [] },
      errors: { work_notifications: { message: "connection reset" } },
    });

    const inbox = await loadWorkNotifications(db, ALICE);
    expect(inbox).toEqual({ ok: false, pending: false, message: "connection reset" });
  });

  it("names the missing migration when the deployment is behind", async () => {
    const db = new FakeWorkDb({
      tables: { work_notifications: [] },
      errors: {
        work_notifications: { message: 'relation "public.work_notifications" does not exist' },
      },
    });

    const inbox = await loadWorkNotifications(db, ALICE);
    expect(inbox.ok).toBe(false);
    if (inbox.ok) return;
    expect(inbox.pending).toBe(true);
  });
});
