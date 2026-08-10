/**
 * Four transit writes were deliberately REFUSED as assistant actions on
 * 2026-08-06, on the day a fifth one — `refresh_gtfs_feed` — was registered.
 * This is the executable form of that decision.
 *
 * WHY A TEST AND NOT A PARAGRAPH. The reasoning lives in CLAUDE.md — but
 * CLAUDE.md is gitignored and untracked in this repository (removed in
 * `00170a8e` so the open-source repo does not publish the owner's tooling), so
 * it exists on one machine and reaches no fresh clone and no other contributor.
 * A convention that survives on exactly one disk is not a guardrail. This file
 * is tracked, runs in CI, and fails the build if a future session registers one
 * of these without re-arguing it.
 *
 * THE DECISION, IN ONE SENTENCE. `refresh_gtfs_feed` is registrable because
 * every value that matters — the download address, the catalog provider, the
 * agency's name, whether the upstream row has been superseded — is read by the
 * route off the feed row the planner already chose, so the model authors
 * nothing. Each refusal below is a way of putting that authorship back: an
 * address the model wrote, bytes the model supplied, a pairing the model chose,
 * or a deletion whose consequences are invisible from the surfaces that cite it.
 *
 * WHAT THE NEIGHBOURING GUARDS DO NOT COVER, AND WHY THAT IS THE POINT.
 * `an-agent-may-not-promote-a-tier` is the structural firewall for claim tiers,
 * and it passes for every action below — none of them writes
 * `median_headway_basis` on a path it can reach. The harm here is a different
 * one: a feed is the EVIDENCE a service level is derived from, and an agent that
 * can choose which archive the evidence comes from does not need to touch the
 * tier to make the number say what it likes.
 *
 * This is a ratchet in one direction only: an entry may be REMOVED from the
 * refused list, but only by a session that writes down why the argument changed.
 */
import { describe, expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";
import { assistantApprovalActionSchema } from "@/lib/assistant/action-approval-server";

/**
 * A refused action, described by the NAMES a future session would plausibly
 * reach for rather than by one exact string.
 *
 * `nameGroups` is a list of alternatives; a kind matches the entry when it
 * contains every word in ANY one group. Conjunctions rather than single
 * fragments because the single-fragment form cannot express the thing that
 * matters most here — `refresh_gtfs_feed` IS registered, so a bare "gtfs" or
 * "feed" fragment would fail this file against the one action it is written to
 * permit.
 */
type RefusedGtfsAction = {
  label: string;
  nameGroups: string[][];
  /**
   * One plausible kind name PER NAME GROUP, and the reason this field exists is
   * a survived mutation rather than tidiness.
   *
   * The obvious "guards the guard" test — one pretend registry, assert each
   * ENTRY catches something — was run against a typo in a single group and
   * SURVIVED, because five of that entry's six groups still matched the one
   * pretend name. It proved the entry catches, which is not the property being
   * relied on: each group is there to catch a different spelling a future
   * session might reach for, and a group that matches nothing is a hole with no
   * symptom. Every group is now exercised individually below.
   */
  provokes: string[];
  reason: string;
};

const REFUSED: RefusedGtfsAction[] = [
  {
    label: "ingesting a transit feed from a URL",
    nameGroups: [
      ["ingest", "feed"],
      ["gtfs", "url"],
      ["transit", "url"],
      ["create", "gtfs_feed"],
      ["add", "gtfs_feed"],
      ["register", "feed"],
    ],
    provokes: [
      "ingest_transit_feed",
      "load_gtfs_from_url",
      "fetch_transit_from_url",
      "create_gtfs_feed",
      "add_gtfs_feed",
      "register_feed",
    ],
    reason:
      "The model authors a URL — consequential content from outside the system, which no registered action " +
      "does today. An approval sheet shows a plausible address and cannot distinguish the agency's own feed " +
      "from a neighbouring operator's, a frozen mirror of a schedule that stopped running, or an attacker's " +
      "host; every derived service level would then carry the wrong agency's name in its provenance columns. " +
      "Independently of that, it hands a model an SSRF primitive: the fetch lane is address-checked precisely " +
      "because the address comes from a person, and pointing it is exactly the capability this would grant.",
  },
  {
    label: "uploading a transit feed archive",
    nameGroups: [
      ["upload", "feed"],
      ["upload", "gtfs"],
      ["upload", "transit"],
    ],
    provokes: ["upload_feed_archive", "upload_gtfs", "upload_transit_schedule"],
    reason:
      "The payload is up to 200 MiB of bytes. Nothing about \"approve this zip\" is reviewable — the approval " +
      "sheet can show a filename and a size, and neither is evidence about what is inside. Every other " +
      "registered action's payload is an id verified against a workspace row or a value from a closed enum.",
  },
  {
    label: "attaching a catalog feed to a workspace",
    nameGroups: [
      ["attach", "catalog"],
      ["attach", "gtfs"],
      ["attach", "transit"],
      ["catalog", "feed"],
      ["select", "catalog"],
    ],
    provokes: [
      "attach_catalog_row",
      "attach_gtfs",
      "attach_transit_operator",
      "adopt_catalog_feed",
      "select_catalog_entry",
    ],
    reason:
      "REFUSED DESPITE AN ID-ONLY PAYLOAD — the horizon-band case, in another module. The consequential " +
      "content is the PAIRING: nothing in the schema records which operator serves an agency, so choosing a " +
      "catalog row for a workspace is an authored judgement about the world, not a lookup. And the catalog is " +
      "not clean — 344 of 1,177 US rows were superseded when this lane was written — so an agent optimising " +
      "for \"a feed got attached\" has a high-probability path to a plausible wrong one, whose service levels " +
      "then read as this agency's.",
  },
  {
    label: "deleting a transit feed",
    nameGroups: [
      ["delete", "feed"],
      ["delete", "gtfs"],
      ["remove", "feed"],
      ["remove", "gtfs"],
    ],
    provokes: ["delete_feed", "delete_gtfs_version", "remove_feed", "remove_gtfs"],
    reason:
      "One verified uuid, which is exactly why it looks safe. The cascade destroys the derived service levels " +
      "an RTP chapter or a Title VI service-equity finding may already cite — and the deletion of a citation's " +
      "SOURCE is invisible on the surface that cites it, so the first sign of the loss is a number nobody can " +
      "trace. A deletion is also the one operation the append-only habits of this codebase cannot supersede.",
  },
];

const REGISTERED_KINDS = Object.keys(ACTION_METADATA);

/** Does this kind name match the entry? See `RefusedGtfsAction.nameGroups`. */
function matchesRefusal(kind: string, entry: RefusedGtfsAction): boolean {
  return entry.nameGroups.some((group) => group.every((word) => kind.includes(word)));
}

describe("the refused GTFS actions are still refused", () => {
  for (const entry of REFUSED) {
    it(`does not register anything matching "${entry.label}"`, () => {
      const offenders = REGISTERED_KINDS.filter((kind) => matchesRefusal(kind, entry));

      expect(
        offenders,
        `${offenders.join(", ")} was registered as an assistant action. This was refused deliberately on ` +
          `2026-08-06: ${entry.reason} If the argument has genuinely changed, remove this entry AND record ` +
          "why — do not delete the assertion to make a build pass."
      ).toEqual([]);
    });
  }

  it("guards the guard: the matchers would catch a registration if one appeared", () => {
    // Without this, a typo in a name group (or an empty REFUSED list) would make
    // every assertion above vacuously true — the exact shape of a test that
    // converts an unchecked area into one everybody believes is checked.
    const pretendRegistry = [
      "ingest_gtfs_feed_from_url",
      "upload_gtfs_feed_archive",
      "attach_gtfs_catalog_feed",
      "delete_gtfs_feed",
      "create_funding_opportunity", // an innocent bystander that must NOT match
    ];

    for (const entry of REFUSED) {
      const caught = pretendRegistry.filter((kind) => matchesRefusal(kind, entry));
      expect(caught.length, `the "${entry.label}" matcher catches nothing`).toBeGreaterThan(0);
    }

    // And the innocent one is untouched by every matcher.
    const innocentHits = REFUSED.filter((entry) => matchesRefusal("create_funding_opportunity", entry));
    expect(innocentHits.map((entry) => entry.label)).toEqual([]);
  });

  it("exercises every name group individually via its provoking spelling", () => {
    /**
     * The per-ENTRY check above survived a mutation: a typo in one group left
     * five others still matching the one pretend name, so a dead group had no
     * symptom. `provokes` pairs each group with the spelling it exists to
     * catch — group i must match provokes[i] on its own, so a typo in ANY
     * group fails by name.
     */
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

  it("does not refuse the one transit action that IS registered", () => {
    /**
     * THE ASSERTION THAT MAKES THE FOUR ABOVE MEAN SOMETHING.
     *
     * A matcher wide enough to catch every plausible spelling of "ingest a feed"
     * is one word away from catching `refresh_gtfs_feed`, and if it did, the
     * only way to get a green build would be to weaken the matchers — which is
     * how a refusal list quietly stops refusing anything. Stated here so the
     * failure names the real problem instead of looking like a bad registration.
     */
    expect(REGISTERED_KINDS).toContain("refresh_gtfs_feed");

    const wrongfullyRefused = REFUSED.filter((entry) => matchesRefusal("refresh_gtfs_feed", entry));
    expect(
      wrongfullyRefused.map((entry) => entry.label),
      "a refusal matcher also matches refresh_gtfs_feed, which is registered on purpose. Narrow the matcher; " +
        "do not remove the refusal."
    ).toEqual([]);
  });
});

describe("the registered transit action stays as narrow as the argument for it", () => {
  /**
   * The refusals above rest on ONE property of `refresh_gtfs_feed`: the model
   * authors nothing. That property lives in the payload, and the payload is a
   * hand-written zod branch nothing compares to the action type — so it is
   * asserted here rather than assumed.
   *
   * If this fails, the four refusals above have lost their premise. The fix is
   * to narrow the payload back, or to re-argue all five together.
   */
  function refreshBranchShape(): Record<string, unknown> {
    for (const option of assistantApprovalActionSchema.options) {
      const branch = option as unknown as { shape?: Record<string, unknown> };
      const kindSchema = branch.shape?.kind as { safeParse(value: unknown): { success: boolean } } | undefined;
      if (kindSchema?.safeParse("refresh_gtfs_feed").success) return branch.shape as Record<string, unknown>;
    }
    throw new Error("refresh_gtfs_feed has no branch in assistantApprovalActionSchema");
  }

  it("accepts two ids and the presentation-only chaining fields, and nothing else", () => {
    expect(Object.keys(refreshBranchShape()).sort()).toEqual([
      "gtfsFeedId",
      "kind",
      "postActionPrompt",
      "postActionPromptLabel",
      "postActionWorkflowId",
      "workspaceId",
    ]);
  });

  it("names no address, no bytes and no adoption override", () => {
    /**
     * The four forbidden shapes, one per refusal above plus the collapse
     * override that made this route wider than its action.
     *
     * `adoptDespiteCollapse` is the sharpest of them and the least obvious: the
     * approval hash covers the action the route rebuilds, not the request body,
     * so a payload that could express it would hash identically to what a
     * planner approved while adopting a refetch the collapse check had
     * deliberately withheld. It is refused in the payload AND at the route
     * (`refuseOutOfScopeAgentRequest`), because the type lives in the browser
     * bundle and only the route check survives a hand-written fetch.
     */
    const forbidden = [
      "url",
      "feedUrl",
      "downloadUrl",
      "catalogId",
      "catalogSourceId",
      "file",
      "archive",
      "bytes",
      "adoptDespiteCollapse",
    ];

    const shape = refreshBranchShape();
    for (const field of forbidden) {
      expect(
        Object.keys(shape),
        `refresh_gtfs_feed's payload accepts "${field}". The whole argument for registering this action is ` +
          "that the model authors nothing — every address and every byte is read by the route off the stored " +
          "feed row. A payload carrying one of these is a different action, and it has not been argued."
      ).not.toContain(field);
    }
  });
});
