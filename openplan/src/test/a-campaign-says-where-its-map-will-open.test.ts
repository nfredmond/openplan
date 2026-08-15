import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";

import { getPublicPortalReadiness } from "@/lib/engagement/public-portal";

/**
 * PUBLISHING MUST SAY WHERE THE RESIDENT MAP WILL OPEN.
 *
 * WHERE THIS CAME FROM. A tester published a corridor campaign with no area
 * set, opened the resident link, and dropped a pin without panning first. It
 * landed at the geographic centre of the United States — which is where a map
 * with nothing to frame it opens. The publish checklist had said nothing about
 * this, while the same console warned elsewhere that an area was needed for the
 * map to open in the right place.
 *
 * IT REPORTS, IT DOES NOT BLOCK, and that is the design decision. Absent is
 * legitimate: a county-wide comment collection, or a question that is not about
 * one place, genuinely has no area. Refusing to publish those would be the
 * tidier rule and the wrong one. So the step states the consequence in the
 * words of what a resident will experience, and a planner decides.
 *
 * AND AN UNREADABLE AREA IS NOT A MISSING ONE. A failed read passes this step
 * rather than sending somebody to set an area that may already be on record —
 * the same distinction the rest of the console already makes, and the reason
 * this takes the three-state area instead of re-deriving one.
 */
const CAMPAIGN = {
  status: "active",
  share_token: "abc123",
  public_description: "A long enough public description for the readiness check to pass.",
  allow_public_submissions: true,
  submissions_closed_at: null,
};

function mapCheck(areaState: "set" | "unset" | "unreadable") {
  const readiness = getPublicPortalReadiness(CAMPAIGN, areaState);
  const check = readiness.checks.find((entry) => entry.id === "map_opens_somewhere");
  expect(check, "the publish checklist has no step about where the map opens").toBeTruthy();
  return check!;
}

describe("a campaign says where its map will open", () => {
  it("fails the step when no area is set, and says what a resident will see", () => {
    const check = mapCheck("unset");
    expect(check.passed).toBe(false);
    // Named consequence, not a vague "recommended".
    expect(check.detail).toMatch(/middle of the country/i);
    // And it says the absence can be deliberate, so the step is not a scold.
    expect(check.detail).toMatch(/not about one place/i);
  });

  it("passes when an area is set", () => {
    expect(mapCheck("set").passed).toBe(true);
  });

  it("does not treat a failed read as a missing area", () => {
    const check = mapCheck("unreadable");
    expect(check.passed).toBe(true);
    expect(check.detail).toMatch(/failed read, not a missing area/i);
    // It must not tell somebody to go set an area that may already exist.
    expect(check.detail).not.toMatch(/middle of the country/i);
  });

  it("does not stop a campaign with no area from being publishable", () => {
    // The whole point: this informs. A campaign that is not about one place is
    // still a campaign, and the checklist's own count reflects the step without
    // the flow refusing.
    const readiness = getPublicPortalReadiness(CAMPAIGN, "unset");
    expect(readiness.totalChecks).toBeGreaterThan(readiness.completeCount);
    expect(readiness.checks.every((entry) => typeof entry.detail === "string")).toBe(true);
  });

  it("gives every readiness check a place in the flow's display order", () => {
    /*
      THE DEFECT THIS CAUGHT, on the way in. The publish flow keeps its own
      `stepOrder` array for display, separate from the readiness checks. Adding
      a check without adding it there left the header counting five steps while
      four rendered — the count and the list disagreeing on one screen, which is
      the shape that has cost this product more than any other this week.

      Read from source rather than by rendering, so it covers every check
      including ones no fixture happens to produce.
    */
    const flow = readFileSync(
      "src/components/engagement/campaign-publish-flow.tsx",
      "utf8"
    );
    const order = flow.slice(flow.indexOf("const stepOrder"), flow.indexOf("];", flow.indexOf("const stepOrder")));

    for (const check of getPublicPortalReadiness(CAMPAIGN, "unset").checks) {
      expect(
        order.includes(`"${check.id}"`),
        `readiness check "${check.id}" counts toward the step total but has no place in the flow's stepOrder, so it renders nowhere`
      ).toBe(true);
    }
  });
});
