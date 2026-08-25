/**
 * THE DEADLINE LANE REGISTERED NO ASSISTANT ACTION, and this is the executable
 * form of that decision (2026-08-12, the award lapse-deadline lane).
 *
 * Three writes shipped in this lane: a lapse date on an award, the daily sweep
 * that turns dates into reminders, and the reminder rows themselves. All three
 * are refused as agent capabilities, and the arguments are inherited here
 * rather than left in a comment — the standing rule is that every new write
 * capability ships with a registry entry OR a recorded refusal, and a refusal
 * recorded only in prose is one a future session re-derives from scratch or,
 * more likely, never sees. `refused-rtp-financial-actions-stay-refused.test.ts`
 * is the pattern; the substring matcher is copied from it deliberately so a
 * near-miss spelling is caught too.
 *
 * A ratchet in one direction only: an entry may be removed, but only by a
 * session that writes down why the argument changed.
 */
import { describe, expect, it } from "vitest";

import { ACTION_METADATA } from "@/lib/runtime/action-metadata";

const REFUSED: ReadonlyArray<{ fragment: string; matchOnly?: string; reason: string }> = [
  {
    fragment: "expenditure_deadline",
    reason:
      "A model authoring the date an agency's funds lapse. It is a term of an executed funding agreement, recorded nowhere OpenPlan can read, and a plausible wrong date is indistinguishable from a correct one on an approval sheet — while being wrong in either direction is expensive: a date too late means the money is gone before anyone is warned, a date too early means an agency rushes work it had time for. This is the 2026-08-05 RTP financial refusal applied to a date instead of an amount.",
  },
  {
    fragment: "lapse",
    matchOnly: "award",
    reason:
      "The `lapse` spelling of the same refusal — the field is `expenditure_deadline_at`, but the word a planner uses for it is `lapse`, and a future session naming the action after the concept must hit the same wall as one naming it after the column.",
  },
  {
    fragment: "sweep",
    matchOnly: "deadline",
    reason:
      "Running the deadline sweep. The payload is empty, which is exactly why it LOOKS safe — but what it authors is an email to every planner in a workspace, the idempotency index stops a second run on the same DAY and nothing on the next one, and an agent working a queue of overdue items has a standing incentive to prompt people about them. That is the completion-signal shape that refused the RTP band assignment. Reminders are a scheduled fact about dates, not a lever; it stays a cron.",
  },
  {
    fragment: "digest",
    matchOnly: "send",
    reason:
      "Sending the digest directly, which is the same refusal reached by the other door: an agent that cannot run the sweep but can mail its output has the same capability with none of the idempotency.",
  },
  {
    fragment: "reminder_preferences",
    reason:
      "Changing the advance window or email opt-out changes when another person is interrupted. That is human attention policy, not a mechanical write the assistant may propose or approve for itself.",
  },
  {
    fragment: "reminder_window",
    reason:
      "A second likely spelling of the same human-attention decision. The assistant may explain the current preference, but only an owner or admin changes it through My Work.",
  },
];

const REGISTERED_KINDS = Object.keys(ACTION_METADATA);

function matches(kind: string, entry: { fragment: string; matchOnly?: string }): boolean {
  if (!kind.includes(entry.fragment)) return false;
  return entry.matchOnly ? kind.includes(entry.matchOnly) : true;
}

describe("the refused award-deadline actions are still refused", () => {
  for (const entry of REFUSED) {
    it(`does not register anything matching "${entry.matchOnly ? `${entry.matchOnly}…${entry.fragment}` : entry.fragment}"`, () => {
      const offenders = REGISTERED_KINDS.filter((kind) => matches(kind, entry));
      expect(
        offenders,
        `${offenders.join(", ")} was registered as an assistant action. This was refused deliberately on 2026-08-12: ${entry.reason} If the argument has genuinely changed, remove this entry AND record why — do not delete the assertion to make a build pass.`
      ).toEqual([]);
    });
  }

  it("guards the guard: the matcher would catch a registration if one appeared", () => {
    // Realistic spellings, in the naming style the registry actually uses
    // (verb first, the noun as it appears in the schema). A pretend name nobody
    // would write lets a matcher pass its own self-check while the likely
    // spelling escapes — the 2026-08-10 adversarial review's finding.
    const pretendRegistry = [
      "set_funding_award_expenditure_deadline",
      "record_award_lapse_date",
      "run_work_deadline_sweep",
      "send_work_deadline_digest",
      "configure_workspace_reminder_preferences",
      "set_reminder_window",
      // Innocent bystanders that must match NOTHING: one registered today (its
      // pairing-is-content objection was argued and accepted), one that shares
      // the word "award" with the lapse matcher but authors no date.
      "link_billing_invoice_funding_award",
      "create_funding_opportunity",
    ];

    for (const entry of REFUSED) {
      const caught = pretendRegistry.filter((kind) => matches(kind, entry));
      expect(
        caught.length,
        `the "${entry.fragment}" matcher catches nothing`
      ).toBeGreaterThan(0);
    }

    for (const innocent of ["link_billing_invoice_funding_award", "create_funding_opportunity"]) {
      expect(
        REFUSED.filter((entry) => matches(innocent, entry)),
        `${innocent} must not be caught by any of these matchers`
      ).toEqual([]);
    }
  });

  it("is reading the real registry, not an empty list", () => {
    // Every assertion above is an emptiness check, so a `REGISTERED_KINDS` that
    // silently became `[]` — a moved export, a renamed constant — would make
    // the whole file vacuously green. The count itself is deliberately NOT
    // pinned here: two other tests already hold the action list, and a third
    // copy would make every legitimate registration edit three files.
    expect(REGISTERED_KINDS).toContain("link_billing_invoice_funding_award");
    expect(REGISTERED_KINDS.length).toBeGreaterThan(5);
  });
});
