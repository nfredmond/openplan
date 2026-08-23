/**
 * Two engagement write capabilities shipped on 2026-08-10 with NO assistant
 * registry entry, deliberately. This is the executable form of that decision.
 *
 * WHY THIS FILE EXISTS AT ALL. The arguments were recorded — in the commit
 * message of `48b0f3fb` and, at more length, in
 * `~/.claude/plans/coherence-push-queue-2026-08-10.md`. That path is outside
 * the repository and gitignored, so the fuller reasoning reaches exactly one
 * disk, no fresh clone, and no other contributor. A commit message survives in
 * git but is not executable: nothing fails when a future session, seeing
 * campaign creation and PATCH routes with no recorded refusal anywhere in the
 * tree, wires `propose_apply_campaign_template` or `propose_link_campaign_projects`
 * and ships the two things the disposition refused. That silent middle is what
 * CLAUDE.md's definition-of-done forbids, and the 2026-08-16 review found it
 * here.
 *
 * WHAT IS REFUSED, IN ONE SENTENCE EACH.
 *
 *   Applying a campaign template writes repo-authored, resident-FACING wording
 *   under a planner's click. Making it agent-proposable would let a model
 *   choose which wording residents eventually read, at scale, across every
 *   campaign it touches.
 *
 *   Pairing a campaign to projects is an authored judgement about the world —
 *   which projects a piece of public input actually covers. The payload is
 *   id-only, and that is precisely the trap: the same
 *   an-id-only-payload-is-still-authorship principle that refused the GTFS
 *   catalog attach and the RTP horizon-band assignment.
 *
 * WHAT THE NEIGHBOURING GUARDS DO NOT COVER. `an-agent-may-not-promote-a-tier`
 * passes for both — neither writes a claim tier on any path it can reach.
 * `action-registry-is-complete` only validates actions ALREADY registered, so
 * it cannot see a route that should have had a refusal. The harm here is
 * authorship of what residents read and of which projects their words are
 * counted against, which no tier column records.
 *
 * This is a ratchet in one direction only: an entry may be REMOVED, but only by
 * a session that writes down why the argument changed.
 */
import { describe, expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";
import { assistantApprovalActionSchema } from "@/lib/assistant/action-approval-server";

/**
 * A refused capability, described by the NAMES a future session would plausibly
 * reach for rather than by one exact string.
 *
 * `nameGroups` is a list of alternatives; a kind matches when it contains every
 * word in ANY one group. `provokes` pairs each group with the spelling that
 * group exists to catch, one per group — the sibling GTFS file learned this the
 * hard way, when a typo in one group survived because five others still matched
 * the single pretend name. A group that matches nothing is a hole with no
 * symptom.
 */
type RefusedEngagementAction = {
  label: string;
  nameGroups: string[][];
  provokes: string[];
  reason: string;
};

const REFUSED: RefusedEngagementAction[] = [
  {
    label: "applying a campaign template",
    nameGroups: [
      ["apply", "template"],
      ["campaign", "template"],
      ["seed", "campaign"],
      ["template", "questions"],
    ],
    provokes: [
      "apply_campaign_template",
      "create_campaign_from_template",
      "seed_campaign_content",
      "add_template_questions",
    ],
    reason:
      "A template writes repo-authored resident-FACING wording — category labels and survey question prompts " +
      "— under a single click. The questions land as drafts unconditionally, which is what makes the planner-" +
      "driven version safe and is NOT what makes an agent-driven one safe: the refusal is about who chooses " +
      "which wording residents eventually read, at scale, across every campaign an agent touches. A model " +
      "picking a template is authoring the framing of a public consultation, and an approval sheet showing a " +
      "template name is not evidence about the sentences inside it. Refuse until argued per template.",
  },
  {
    label: "pairing a campaign to projects",
    nameGroups: [
      ["link", "campaign", "project"],
      ["campaign", "projects"],
      ["attach", "campaign"],
      ["assign", "campaign"],
    ],
    provokes: [
      "link_campaign_projects",
      "set_campaign_projects",
      "attach_campaign_to_project",
      "assign_campaign_scope",
    ],
    reason:
      "REFUSED DESPITE AN ID-ONLY PAYLOAD, the same shape as the GTFS catalog attach and the RTP horizon-band " +
      "assignment. Which projects a campaign's public input covers is an authored judgement about the world, " +
      "not a lookup — nothing in the schema records it, which is exactly why a row has to be written. Get it " +
      "wrong and residents' comments are counted as support for, or objection to, a project they never saw; " +
      "the pairing then rides into RTP comment-response chapters and grant narratives as evidence.",
  },
];

const REGISTERED_KINDS = Object.keys(ACTION_METADATA);

/** Does this kind name match the entry? See `RefusedEngagementAction.nameGroups`. */
function matchesRefusal(kind: string, entry: RefusedEngagementAction): boolean {
  return entry.nameGroups.some((group) => group.every((word) => kind.includes(word)));
}

describe("the refused engagement campaign actions are still refused", () => {
  for (const entry of REFUSED) {
    it(`does not register anything matching "${entry.label}"`, () => {
      const offenders = REGISTERED_KINDS.filter((kind) => matchesRefusal(kind, entry));

      expect(
        offenders,
        `${offenders.join(", ")} was registered as an assistant action. This was refused deliberately on ` +
          `2026-08-10: ${entry.reason} If the argument has genuinely changed, remove this entry AND record ` +
          "why — do not delete the assertion to make a build pass."
      ).toEqual([]);
    });
  }

  it("guards the guard: the matchers would catch a registration if one appeared", () => {
    // Without this, a typo in a name group (or an empty REFUSED list) makes
    // every assertion above vacuously true — a test that converts an unchecked
    // area into one everybody believes is checked.
    const pretendRegistry = [
      "apply_campaign_template",
      "link_campaign_projects",
      "create_survey_question_draft", // registered on purpose; must NOT match
    ];

    for (const entry of REFUSED) {
      const caught = pretendRegistry.filter((kind) => matchesRefusal(kind, entry));
      expect(caught.length, `the "${entry.label}" matcher catches nothing`).toBeGreaterThan(0);
    }
  });

  it("exercises every name group individually via its provoking spelling", () => {
    for (const entry of REFUSED) {
      expect(entry.provokes.length, `"${entry.label}" provokes/groups mismatch`).toBe(
        entry.nameGroups.length
      );
      entry.nameGroups.forEach((group, index) => {
        const provoke = entry.provokes[index];
        expect(
          group.every((word) => provoke.includes(word)),
          `"${entry.label}" group ${index} [${group.join(", ")}] does not match its provoking spelling "${provoke}"`
        ).toBe(true);
      });
    }
  });

  it("does not refuse the engagement action that IS registered", () => {
    /**
     * THE ASSERTION THAT MAKES THE TWO ABOVE MEAN SOMETHING.
     *
     * `create_survey_question_draft` is registered, and is the 2026-08-03
     * "agent survey questions: draft-only, a human publishes" decision in
     * force. A matcher wide enough to catch every spelling of "apply a
     * template" is one word away from catching it, and if it did, the only way
     * back to a green build would be to weaken the matchers — which is how a
     * refusal list quietly stops refusing anything.
     */
    expect(REGISTERED_KINDS).toContain("create_survey_question_draft");

    const wrongfullyRefused = REFUSED.filter((entry) =>
      matchesRefusal("create_survey_question_draft", entry)
    );
    expect(
      wrongfullyRefused.map((entry) => entry.label),
      "a refusal matcher also matches create_survey_question_draft, which is registered on purpose. Narrow " +
        "the matcher; do not remove the refusal."
    ).toEqual([]);
  });

  /*
    A NARROW ACTION MAY NOT RIDE A WIDE ROUTE. The approval hash covers the
    payload the route rebuilds, so an extra field that the schema tolerates
    hashes identically to what a planner approved and is then written. The
    registered survey-question action must therefore not be able to carry either
    refused capability as a passenger.
  */
  it("the registered survey-question action's payload names no template and no project list", () => {
    const branch = (() => {
      for (const option of assistantApprovalActionSchema.options) {
        const candidate = option as unknown as { shape?: Record<string, unknown> };
        const kindSchema = candidate.shape?.kind as
          | { safeParse(value: unknown): { success: boolean } }
          | undefined;
        if (kindSchema?.safeParse("create_survey_question_draft").success) {
          return candidate.shape as Record<string, unknown>;
        }
      }
      throw new Error("create_survey_question_draft has no branch in assistantApprovalActionSchema");
    })();

    const forbidden = ["templateId", "template", "projectIds", "campaignProjectIds"];
    for (const field of forbidden) {
      expect(
        Object.keys(branch),
        `create_survey_question_draft's payload accepts "${field}". That is one of the two capabilities ` +
          "refused on 2026-08-10 arriving as a passenger on an action that was argued without it."
      ).not.toContain(field);
    }
  });
});
