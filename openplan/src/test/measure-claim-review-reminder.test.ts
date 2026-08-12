import { describe, expect, it } from "vitest";
import {
  WORK_NOTIFICATION_KINDS,
  WORK_SWEEP_SOURCES,
  measureClaimWaitingSentence,
} from "@/lib/notifications/work";
import {
  MEASURE_CLAIM_AWAITING_DECISION_STATUSES,
  MEASURE_CLAIM_STATUSES,
  MEASURE_CLAIM_SWEEP_COLUMNS,
} from "@/lib/measures/claims";
import { migrationKindVocabulary } from "./helpers/fake-work-notification-tables";

/**
 * THE EIGHTH REMINDER — a measure claim nobody has answered.
 *
 * ============================================================================
 * THE PROPERTY THIS FILE EXISTS FOR IS A NEGATIVE ONE
 * ============================================================================
 *
 * Nothing OpenPlan holds says when a decision on a claim is DUE. There is no
 * review-window column on `measure_funds`, and no ordinance text this product
 * parses. So this source must never report a claim as OVERDUE — a digest
 * subject reading "1 overdue" would be OpenPlan telling an agency it had missed
 * a standard nobody adopted, and an agency that learns the product invents
 * deadlines stops believing the seven reminders that do not.
 *
 * `isOverdue: false` is therefore asserted directly, for a claim submitted
 * months ago, and the body is required to SAY that no review deadline is
 * recorded. Both halves matter: the flag keeps it out of the overdue bucket,
 * the sentence keeps a reader from inferring one.
 *
 * ============================================================================
 * WHAT ELSE IS PINNED, AND WHY EACH
 * ============================================================================
 *
 *  * THE VOCABULARY AND THE CHECK AGREE. `work-notification-sweep.test.ts`
 *    already derives the whole vocabulary from the migration corpus; this file
 *    pins the ONE kind it added, so deleting migration 20260812000013 fails
 *    here with a message naming it rather than as an arithmetic mismatch.
 *  * THE SEAM IS THE CONSTANT, NOT A COPY. The select is composed from
 *    `MEASURE_CLAIM_SWEEP_COLUMNS`, and this file asserts the composed string —
 *    Supabase clients are untyped, so a projection typo is a runtime error that
 *    would take the reminder out silently.
 *  * THE STATUS FILTER IS DERIVED BY SUBTRACTION. A hand-written exclusion list
 *    goes stale the day a status is added; the assertion below is written
 *    against the two exported vocabularies so it moves with them.
 *  * AN UNREADABLE CURRENCY OMITS THE AMOUNT. `measure_funds.currency_code` is
 *    NOT NULL, so an absent code means a failed read — and a figure carrying
 *    the wrong unit is worse than no figure.
 *
 * Mutation results are recorded at the bottom of this file.
 */

const SOURCE = WORK_SWEEP_SOURCES.find((source) => source.kind === "measure_claim_review_due");

/** 2026-03-10, the day the sweep is pretending to run. */
const NOW = new Date("2026-03-10T13:00:00Z");

const AWAITING_CLAIM = {
  id: "claim-1",
  workspace_id: "workspace-1",
  measure_fund_id: "fund-1",
  recipient_id: "r-city",
  fiscal_year_label: "FY 2026",
  category_id: "local_streets",
  amount: "412000.00",
  status: "submitted",
  submitted_on: "2026-01-15",
  created_by: "user-1",
};

const CONTEXT = {
  awardLedgers: new Map(),
  awardCurrencyCodes: new Map(),
  measureCurrencyCodes: new Map([["fund-1", "USD"]]),
  unavailable: false,
};

const NO_CONTEXT = {
  awardLedgers: new Map(),
  awardCurrencyCodes: new Map(),
  measureCurrencyCodes: new Map<string, string>(),
  unavailable: true,
};

describe("the measure claim review reminder", () => {
  it("is a kind the database will accept", () => {
    expect(WORK_NOTIFICATION_KINDS).toContain("measure_claim_review_due");
    // Derived from the migration corpus, so the assertion cannot agree with a
    // stale list. Deleting 20260812000013 fails here.
    expect(migrationKindVocabulary()).toContain("measure_claim_review_due");
  });

  it("is emitted by a registered sweep source", () => {
    expect(SOURCE).toBeDefined();
    expect(SOURCE?.table).toBe("measure_claims");
    expect(SOURCE?.dateColumn).toBe("submitted_on");
    // `submitted_on` is a DATE column; a full ISO timestamp compared against
    // one is an invalid literal, not a wider window.
    expect(SOURCE?.dateColumnKind).toBe("date");
    expect(SOURCE?.recipientColumn).toBe("created_by");
  });

  it("reads Lane 2's sweep projection plus the one column it does not carry", () => {
    // The seam, asserted as a composed string rather than retyped. A typo in
    // either half is a runtime PostgREST error, and this is the only place that
    // can see it before deployment.
    expect(SOURCE?.select).toBe(`${MEASURE_CLAIM_SWEEP_COLUMNS}, created_by`);
    expect(SOURCE?.select).toContain("submitted_on");
    expect(SOURCE?.select).toContain("amount");
    expect(SOURCE?.select).toContain("measure_fund_id");
    // Not in the sweep projection on purpose — a cross-tenant cron has no
    // business pulling a claim's description into a notification job.
    expect(SOURCE?.select).not.toContain("description");
    expect(SOURCE?.select).not.toContain("decision_note");
  });

  it("excludes exactly the statuses that are not waiting on the agency", () => {
    const filter = SOURCE?.staticFilters.find((entry) => entry.kind === "notIn");
    expect(filter).toBeDefined();
    expect(filter?.column).toBe("status");

    const excluded = [...((filter as { values: readonly string[] }).values ?? [])].sort();
    const expected = MEASURE_CLAIM_STATUSES.filter(
      (status) => !(MEASURE_CLAIM_AWAITING_DECISION_STATUSES as readonly string[]).includes(status)
    )
      .slice()
      .sort();
    expect(excluded).toEqual(expected);
    // Concretely: the two that ARE waiting must not be excluded.
    expect(excluded).not.toContain("submitted");
    expect(excluded).not.toContain("under_review");
    // And the five that are settled must be.
    expect(excluded).toEqual(["approved", "denied", "draft", "paid", "withdrawn"]);
  });

  it("NEVER reports a waiting claim as overdue", () => {
    const [candidate] = SOURCE!.toCandidates([{ ...AWAITING_CLAIM }], NOW, CONTEXT);

    // The whole point of the file. A claim submitted 54 days ago is waiting,
    // not late — OpenPlan holds no review deadline to have missed.
    expect(candidate.isOverdue).toBe(false);
    expect(candidate.body).toContain("this is not an overdue notice");
    expect(candidate.body).toContain("No review deadline is recorded for this measure");
  });

  it("keys the reminder on the submission date, so it fires once per claim", () => {
    const [candidate] = SOURCE!.toCandidates([{ ...AWAITING_CLAIM }], NOW, CONTEXT);

    // `submitted_on` never changes once a claim leaves draft, and the
    // idempotency index is (subject_table, subject_id, recipient, due_on).
    expect(candidate.due_on).toBe("2026-01-15");
    expect(candidate.subject_table).toBe("measure_claims");
    expect(candidate.subject_id).toBe("claim-1");
    expect(candidate.recipient_user_id).toBe("user-1");
    expect(candidate.workspace_id).toBe("workspace-1");
    // A measure claim belongs to a fund, not a project; `project_id` is a real
    // foreign key and a guess would file the reminder under the wrong work.
    expect(candidate.project_id).toBeNull();
  });

  it("states the amount, the day it arrived and how long it has waited", () => {
    const [candidate] = SOURCE!.toCandidates([{ ...AWAITING_CLAIM }], NOW, CONTEXT);

    // 2026-01-15 to 2026-03-10 is 16 days of January left + 28 (2026 is not a
    // leap year) + 10 = 54 days.
    expect(candidate.body).toContain("It has been waiting 54 days.");
    expect(candidate.body).toContain("Submitted Jan 15, 2026");
    expect(candidate.body.replaceAll(" ", " ")).toContain("The claim is for USD 412,000.00.");
    expect(candidate.title).toBe("Measure claim awaiting a decision · FY 2026");
    expect(candidate.body).toContain("measure claims carry no assignee");
  });

  it("omits the amount rather than guessing a currency when the fund could not be read", () => {
    const [candidate] = SOURCE!.toCandidates([{ ...AWAITING_CLAIM }], NOW, NO_CONTEXT);

    expect(candidate.body).toContain("could not read this fund's currency, so the amount is not stated here");
    // The reminder still goes out — the deadline-adjacent fact matters more
    // than its detail — but it never says USD about a fund it did not read.
    expect(candidate.body.replaceAll(" ", " ")).not.toContain("USD 412,000.00");
    expect(candidate.due_on).toBe("2026-01-15");
  });

  it("says 'today' rather than 'waiting 0 days'", () => {
    const [candidate] = SOURCE!.toCandidates(
      [{ ...AWAITING_CLAIM, submitted_on: "2026-03-10" }],
      NOW,
      CONTEXT
    );
    expect(candidate.body).toContain("It arrived today.");
    expect(candidate.body).not.toContain("waiting 0 days");
  });

  it("drops a claim with nobody to tell, rather than inventing a recipient", () => {
    expect(SOURCE!.toCandidates([{ ...AWAITING_CLAIM, created_by: null }], NOW, CONTEXT)).toEqual([]);
    expect(SOURCE!.toCandidates([{ ...AWAITING_CLAIM, submitted_on: null }], NOW, CONTEXT)).toEqual([]);
    expect(SOURCE!.toCandidates([{ ...AWAITING_CLAIM, workspace_id: null }], NOW, CONTEXT)).toEqual([]);
  });

  it("builds the same sentence outside the sweep, so a fixture can reach it", () => {
    // The award lane learned this the hard way: three of five sentences
    // survived mutation because no fixture ever produced them.
    expect(
      measureClaimWaitingSentence({
        amount: 412000,
        currencyCode: "USD",
        submittedOn: "2026-01-15",
        waitedDays: 1,
      })
    ).toContain("It has been waiting 1 day.");
    expect(
      measureClaimWaitingSentence({
        amount: null,
        currencyCode: null,
        submittedOn: "2026-01-15",
        waitedDays: 3,
      })
    ).toContain("the amount is not stated here");
  });
});

/**
 * ============================================================================
 * MUTATION LOG — recorded after a GREEN BASELINE and a NEGATIVE CONTROL.
 * ============================================================================
 *
 * BASELINE: 11 passed before any mutation.
 * NEGATIVE CONTROL: a semantically neutral rename in `daysWaiting`
 * (`today` -> `todayUtc`) left it green, so the runner distinguishes a pass
 * from a failure rather than exiting non-zero unconditionally.
 *
 * Applied to the source, RUN, and reverted:
 *
 *  R1  `isOverdue: false` -> `isDeadlinePast(row.submitted_on, now)`
 *      -> 'NEVER reports a waiting claim as overdue' fails. This is the
 *      mutation the whole file exists for: it is the one line standing between
 *      this product and a digest that says 'overdue' about a standard nobody
 *      adopted.
 *  R2  the 'not an overdue notice' clause deleted from
 *      `measureClaimWaitingSentence` -> the same test fails on its OTHER
 *      assertion, so the flag and the words are guarded independently.
 *  R3  `daysWaiting` sign flipped -> clamped to 0, so a January claim reads
 *      'It arrived today.' 1 failed.
 *  R4  `daysWaiting` divides by an hour instead of a day -> 1,296. 1 failed.
 *  R5  the currency falls back to 'USD' when the fund read failed
 *      -> 'omits the amount rather than guessing a currency' fails.
 *  R6  the settled-status list hardcoded to the EXCLUDED partition
 *      (`draft/denied/withdrawn` — the plausible wrong choice, since that
 *      constant exists and is right for the ledger) -> the filter assertion
 *      fails naming `approved` and `paid`. Unkilled, this would have
 *      reminded somebody about every claim the agency had already settled.
 *  R7  `select` reverted to the bare sweep projection -> the composed-string
 *      assertion fails. In production this reads no `created_by`, produces no
 *      candidates, and fails silently at 13:00 UTC.
 *  R8  `due_on` set to today instead of the submission date -> 2 failed. The
 *      reminder would have re-fired every single day.
 *  R9  `project_id` guessed from `recipient_id` -> 1 failed. A recipient id
 *      is not a project id and the foreign key would have rejected the whole
 *      insert batch.
 *  R10 a NUMERIC arriving as a string parsed as absent -> the amount drops out
 *      of the sentence. 1 failed. PostgREST returns NUMERIC as a string, so
 *      this is the live path, not the edge case.
 *
 * 10 mutations, 10 killed.
 */
