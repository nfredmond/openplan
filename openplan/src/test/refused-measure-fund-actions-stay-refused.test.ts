import { describe, expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";
import { assistantApprovalActionSchema } from "@/lib/assistant/action-approval-server";

/**
 * THE LOCAL MEASURE FUND REGISTERED NO ASSISTANT ACTION (2026-08-12), and this
 * is the executable form of that decision.
 *
 * Four write capabilities shipped in this lane — recording what the fund
 * received, stating how the ordinance divides it, deciding a claim against it,
 * and publishing the oversight page. Every one is refused as an agent
 * capability, and the arguments are inherited from the recorded refusal
 * principles rather than re-derived:
 *
 *   P1 the model never authors consequential content from outside the system;
 *   P2 an id-only payload can still author a judgement — the PAIRING is content;
 *   P4 never let an agent delete or switch off a caveat on a public surface;
 *   P5 an action that empties a work queue the agent can see is a
 *      completion-signal shape with a standing bad incentive.
 *
 * WHAT IS DIFFERENT ABOUT THIS LANE, and it is worth stating once because it is
 * the reason the refusals are firmer here than on the claimant side of the same
 * seam: THERE IS NO FUNDER DOWNSTREAM. When an agency invoices Caltrans, a
 * wrong figure meets a reviewer whose job is to catch it. Here the agency IS
 * the funder. A wrong approval is money out of a public fund with nobody
 * between the mistake and the bank, and the body that would notice — a
 * citizens' oversight committee — meets quarterly and reads a page a year
 * later.
 *
 * The one thing registrable LATER is a DRAFT oversight narrative a human
 * publishes, on the `create_survey_question_draft` precedent. It is out of
 * scope deliberately and is not built.
 *
 * A ratchet in one direction only: an entry may be removed, but only by a
 * session that writes down why the argument changed.
 */

/**
 * A refused action, described by the NAMES a future session would plausibly
 * reach for.
 *
 * `nameGroups` is a list of alternatives; a kind matches when it contains every
 * word in ANY one group. The per-group `provokes` discipline is copied from
 * `refused-gtfs-actions-stay-refused.test.ts` for the reason recorded there: a
 * whole-entry self-check passed a typo'd group because five siblings still
 * matched, so each group is exercised on its own below.
 */
type RefusedMeasureAction = {
  label: string;
  nameGroups: string[][];
  /** One plausible kind name PER NAME GROUP, in registry naming style. */
  provokes: string[];
  reason: string;
};

const REFUSED: RefusedMeasureAction[] = [
  {
    label: "approving, denying or paying a claim against the fund",
    nameGroups: [
      ["approve", "claim"],
      ["deny", "claim"],
      ["pay", "claim"],
      ["decide", "claim"],
      ["measure_claim", "status"],
      ["settle", "claim"],
    ],
    provokes: [
      "approve_measure_claim",
      "deny_measure_claim",
      "pay_measure_claim",
      "decide_measure_claim",
      "set_measure_claim_status",
      "settle_measure_claim",
    ],
    reason:
      "Money leaving a public fund. The payload {claimId, decision} LOOKS id-only and therefore safe, which " +
      "is exactly the trap principle 2 names: the pairing is the content, and here the content is a " +
      "disbursement. Principle 5 fires as well — claims awaiting a decision are a visible work queue and " +
      "emptying it is a completion signal an agent has a standing incentive to produce. And unlike an " +
      "invoice on the other side of this seam there is no funder downstream to catch the error; the " +
      "oversight committee sees it a year later, in public.",
  },
  {
    label: "recording what the fund received",
    nameGroups: [
      ["record", "receipt"],
      ["measure", "receipt"],
      ["set", "received"],
      ["record", "measure_fund_period"],
      ["open", "measure", "period"],
      ["import", "remittance"],
    ],
    provokes: [
      "record_measure_receipt",
      "update_measure_receipt_amount",
      "set_measure_period_received_amount",
      "record_measure_fund_period",
      "open_measure_fund_period",
      "import_remittance_advice",
    ],
    reason:
      "Principle 1, in its purest form. The figure comes from a treasurer's remittance advice that exists " +
      "outside OpenPlan, and it propagates into every allocation, every recipient's share, the annual " +
      "statement, and the public oversight page. A plausible wrong receipt is indistinguishable from a " +
      "correct one on an approval sheet, and it is wrong in a direction nobody can see: the split is " +
      "percentages of whatever number is entered, so the whole ordinance applies itself faithfully to a " +
      "fiction.",
  },
  {
    label: "stating the ordinance's split or an apportionment figure",
    nameGroups: [
      ["set", "allocation_rule"],
      ["measure", "allocation_rule"],
      ["record", "ordinance"],
      ["set", "basis_value"],
      ["state", "basis"],
      ["allocate", "measure", "period"],
    ],
    provokes: [
      "set_measure_allocation_rule",
      "create_measure_allocation_rule",
      "record_ordinance_split",
      "set_measure_recipient_basis_value",
      "state_measure_basis_figure",
      "allocate_measure_fund_period",
    ],
    reason:
      "An ordinance's percentages and a jurisdiction's population are LEGAL FACTS with a source outside " +
      "this product — the adopted ordinance text and whatever census or assessor roll the ordinance itself " +
      "names. Principle 1 applies to both. A plausible wrong percentage is indistinguishable from a right " +
      "one on an approval sheet and produces a perfectly self-consistent set of allocations, and a wrong " +
      "basis value silently moves money between jurisdictions. The lane's own design already refuses to " +
      "fetch a population automatically for the same reason a person must state it; an agent stating it is " +
      "the same refusal with a different author.",
  },
  {
    label: "switching the public oversight page on",
    nameGroups: [
      ["publish", "measure"],
      ["measure", "public_share"],
      ["share", "oversight"],
      ["enable", "public", "measure"],
      ["set", "public_share_enabled"],
    ],
    provokes: [
      "publish_measure_oversight_page",
      "set_measure_public_share",
      "share_oversight_record",
      "enable_public_measure_page",
      "set_measure_public_share_enabled",
    ],
    reason:
      "Principle 4. Publishing is not a small write: it makes a workspace's own figures — including totals " +
      "that are floors and allocations a person typed by hand — readable by anyone with the link, " +
      "permanently as far as any reader who saved it is concerned. Unpublishing does not unpublish. The " +
      "same principle refuses the other direction: an agent that could switch the page OFF could remove an " +
      "agency's published record of a fund under audit.",
  },
];

const REGISTERED_KINDS = Object.keys(ACTION_METADATA);

function matches(kind: string, group: string[]): boolean {
  return group.every((word) => kind.includes(word));
}

function matchesEntry(kind: string, entry: RefusedMeasureAction): boolean {
  return entry.nameGroups.some((group) => matches(kind, group));
}

describe("the refused local-measure fund actions are still refused", () => {
  for (const entry of REFUSED) {
    it(`does not register ${entry.label}`, () => {
      const offenders = REGISTERED_KINDS.filter((kind) => matchesEntry(kind, entry));
      expect(
        offenders,
        `${offenders.join(", ")} was registered as an assistant action. This was refused deliberately on ` +
          `2026-08-12: ${entry.reason} If the argument has genuinely changed, remove this entry AND record ` +
          "why — do not delete the assertion to make a build pass."
      ).toEqual([]);
    });

    it(`has no approval schema branch for ${entry.label}`, () => {
      // The registry name is only half of it. `assistantApprovalActionSchema`
      // is what turns a kind into a `propose_*` tool, so a zod branch added
      // without a metadata entry would be a reachable capability this file's
      // other assertion cannot see.
      for (const kind of entry.provokes) {
        const parsed = assistantApprovalActionSchema.safeParse({ kind });
        expect(parsed.success, `${kind} parses as an approvable assistant action`).toBe(false);
      }
    });
  }

  it("guards the guard: EVERY name group would catch a registration", () => {
    // Per-GROUP rather than per-entry. The whole-entry form passed a typo'd
    // group once because its siblings still matched, and a group that matches
    // nothing is a hole with no symptom.
    for (const entry of REFUSED) {
      expect(
        entry.provokes.length,
        `${entry.label} must provoke one name per group`
      ).toBe(entry.nameGroups.length);

      entry.nameGroups.forEach((group, index) => {
        expect(
          matches(entry.provokes[index], group),
          `the group [${group.join(", ")}] catches nothing — "${entry.provokes[index]}" escapes it`
        ).toBe(true);
      });
    }
  });

  it("does not catch the actions that ARE registered", () => {
    // Two of the twelve share vocabulary with the matchers above: one is about
    // an invoice on the OTHER side of this seam (the agency claiming from its
    // funder), one creates a funding record. Neither may be caught, or this
    // file would fail for a registration nobody made here.
    for (const innocent of [
      "link_billing_invoice_funding_award",
      "create_funding_opportunity",
      "create_rtp_horizon_bands_from_cycle_horizon",
      "generate_report_artifact",
      "create_survey_question_draft",
    ]) {
      const caught = REFUSED.filter((entry) => matchesEntry(innocent, entry)).map((entry) => entry.label);
      expect(caught, `${innocent} must not be caught by any of these matchers`).toEqual([]);
    }
  });

  it("is reading the real registry, not an empty list", () => {
    // Every assertion above is an emptiness check, so a `REGISTERED_KINDS` that
    // silently became `[]` — a moved export, a renamed constant — would make
    // the whole file vacuously green.
    expect(REGISTERED_KINDS).toContain("launch_model_run");
    expect(REGISTERED_KINDS.length).toBeGreaterThan(5);
  });

  it("leaves the registry at twelve actions — this lane added none", () => {
    // Not a copy of the two lists that already pin the action set: this asserts
    // the LANE's own decision, so a session that registers a measure action has
    // to come back and argue with the entries above rather than only updating
    // an arithmetic constant somewhere else.
    expect(REGISTERED_KINDS.filter((kind) => kind.includes("measure"))).toEqual([]);
  });
});
