/**
 * The aerial writes below were deliberately REFUSED as assistant actions —
 * the flight-plan writes and the mission-imagery writes, both on 2026-08-11 —
 * and this is the executable form of those decisions.
 *
 * WHY A TEST AND NOT A PARAGRAPH. The reasoning lives in the flight-plan
 * route's own header and in CLAUDE.md — but CLAUDE.md is gitignored, so it
 * exists on one machine, and a route header is prose a capable successor may
 * reasonably override. This file is tracked, runs in CI, and fails the build
 * if a future session registers one of these without re-arguing it.
 *
 * THE DECISION, IN ONE SENTENCE. Altitude, speed and overlap are consequential
 * safety-relevant numbers a crew physically flies, and a model registering a
 * flight-plan action would author them from OUTSIDE the system — the
 * campaign-accessibility-contact precedent, where the only control is the
 * approver noticing a plausible wrong number — while the snapshot save
 * additionally ARMS the export lane: a saved `generatedPlan` is what makes
 * `/flight-plan/export` serve a flyable .kmz/CSV a pilot loads into a real
 * aircraft, so an agent that can save one holds both halves of author-and-arm.
 *
 * WHAT THE NEIGHBOURING GUARDS DO NOT COVER. `an-agent-may-not-promote-a-tier`
 * passes for every kind below: a flight parameter is not a claim tier, and no
 * tier column is on any path these writes reach. The harm is physical, not
 * epistemic — which is exactly why it needs its own refusal file rather than
 * riding a guard built for provenance.
 *
 * A ratchet in one direction only: an entry may be REMOVED, but only by a
 * session that writes down why the argument changed.
 */
import { describe, expect, it } from "vitest";
import { ACTION_METADATA } from "@/lib/runtime/action-metadata";

type RefusedAerialAction = {
  label: string;
  /**
   * Alternative spellings a future session might reach for. A kind matches
   * when it contains every word in ANY one group. The single-word groups
   * (`altitude`, `overlap`) are deliberately broad: both words are aerial to
   * their core, and a false positive costs one session an argument while a
   * miss costs a crew a wrong number. A future NON-aerial kind that genuinely
   * needs one of these words (say, an RTP horizon-band `overlap` repair) must
   * pick a different name or narrow the matcher WITH a recorded reason — do
   * not widen silently.
   */
  nameGroups: string[][];
  /** One plausible kind name PER GROUP, so a group matching nothing is caught. */
  provokes: string[];
  reason: string;
};

const REFUSED: RefusedAerialAction[] = [
  {
    label: "saving or authoring a flight plan",
    nameGroups: [
      ["flight", "plan"],
      ["save", "flight"],
      ["generate", "flight"],
    ],
    provokes: ["save_aerial_flight_plan", "save_flight_parameters", "generate_flight_grid"],
    reason:
      "The parameter save authors altitude, speed and overlap — consequential safety-relevant numbers a crew " +
      "flies — from outside the system, which no registered action does (the campaign-accessibility-contact " +
      "precedent: the only control is the approver noticing a plausible wrong number). The snapshot save is " +
      "worse for looking derived: a saved `generatedPlan` is what arms the export route to serve a flyable " +
      ".kmz/CSV, so the agent would hold both halves of author-and-arm.",
  },
  {
    label: "authoring a flight altitude",
    nameGroups: [["altitude"]],
    provokes: ["set_mission_altitude"],
    reason:
      "Altitude above ground is the single most safety-consequential number in the aerial lane: it decides " +
      "obstacle clearance and regulatory ceiling compliance, and the planner applies no regulatory ceiling of " +
      "its own — the human is the ceiling check. A model-authored altitude on an approval sheet is " +
      "indistinguishable from a correct one.",
  },
  {
    label: "authoring survey overlap",
    nameGroups: [["overlap"]],
    provokes: ["set_survey_overlap"],
    reason:
      "Overlap percentages decide whether photogrammetric reconstruction succeeds at all; a low overlap " +
      "degrades the product silently — the mission flies, the photos land, and the failure surfaces only in " +
      "processing, after the crew has gone home. A number whose wrongness is invisible until it is expensive " +
      "is exactly the shape the registry refuses.",
  },
  // ---- Mission imagery (2026-08-11, the imagery-intake lane) ----------------
  {
    label: "uploading mission imagery",
    nameGroups: [
      ["upload", "imagery"],
      ["upload", "photo"],
      ["add", "imagery"],
    ],
    provokes: ["upload_aerial_imagery", "upload_mission_photo", "add_aerial_imagery"],
    reason:
      "The consequential payload is megabytes of binary photo evidence the model would author from OUTSIDE " +
      "the system — the offline comment-import refusal wearing wings, at 64 MiB per file instead of 4 MB of " +
      "CSV — and no approval sheet can render what the planner would be consenting to. Worse, uploaded photos " +
      "are the SOURCE evidence every processed output (orthomosaic, DSM, point cloud) derives from, so a " +
      "fabricated or substituted frame would sit invisibly under later deliverables. Upload is a human " +
      "console write; the route exists and is member-gated.",
  },
  {
    label: "deleting mission imagery",
    nameGroups: [
      ["delete", "imagery"],
      ["delete", "photo"],
      ["remove", "imagery"],
    ],
    provokes: ["delete_aerial_imagery", "delete_mission_photo", "remove_aerial_imagery"],
    reason:
      "Deletion destroys source evidence under processed outputs, and the id-only payload is why it LOOKS " +
      "safe and is not (the horizon-band-delete precedent): the id test is a proxy for 'the model authors no " +
      "consequential content', and here the content is an erasure. An agent optimizing for a tidy photo set " +
      "has a standing incentive to thin exactly the frames a reviewer would want — the submission-geofence " +
      "shape. The human route already refuses deletion once processing has been dispatched, because OpenPlan " +
      "cannot prove after the fact which photos a job consumed.",
  },
];

const REGISTERED_KINDS = Object.keys(ACTION_METADATA);

function matchesRefusal(kind: string, entry: RefusedAerialAction): boolean {
  return entry.nameGroups.some((group) => group.every((word) => kind.includes(word)));
}

describe("the refused aerial actions are still refused", () => {
  for (const entry of REFUSED) {
    it(`does not register anything matching "${entry.label}"`, () => {
      const offenders = REGISTERED_KINDS.filter((kind) => matchesRefusal(kind, entry));

      expect(
        offenders,
        `${offenders.join(", ")} was registered as an assistant action. This was refused deliberately on ` +
          `2026-08-11: ${entry.reason} If the argument has genuinely changed, remove this entry AND record ` +
          "why — do not delete the assertion to make a build pass."
      ).toEqual([]);
    });
  }

  it("guards the guard: every name group would catch a registration", () => {
    // A group matching nothing is a hole with no symptom; the GTFS guard once
    // survived a typo in one of six groups because only the ENTRY was checked.
    for (const entry of REFUSED) {
      expect(
        entry.provokes.length,
        `"${entry.label}" must provoke one name per group`
      ).toBe(entry.nameGroups.length);

      entry.nameGroups.forEach((group, index) => {
        const provoker = entry.provokes[index];
        expect(
          group.every((word) => provoker.includes(word)),
          `group [${group.join(", ")}] of "${entry.label}" does not match its own provoker ${provoker}`
        ).toBe(true);
      });
    }
  });

  it("leaves innocent registered actions alone", () => {
    // Three real registered kinds, including the two the aerial matchers sit
    // closest to in spirit (a launch and a scaffold).
    for (const innocent of [
      "create_funding_opportunity",
      "launch_model_run",
      "create_rtp_horizon_bands_from_cycle_horizon",
    ]) {
      expect(REGISTERED_KINDS, `${innocent} must exist for this check to mean anything`).toContain(innocent);
      const hits = REFUSED.filter((entry) => matchesRefusal(innocent, entry));
      expect(hits.map((entry) => entry.label), innocent).toEqual([]);
    }
  });
});
