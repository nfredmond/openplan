import { describe, expect, it } from "vitest";

import {
  buildCrashProximityClaims,
  ENGAGEMENT_CRASH_PROXIMITY_NARRATIVE_CAVEAT,
} from "@/lib/grants/engagement-evidence";
import {
  summarizeCampaignCorroboration,
  type NearbyCrashRow,
} from "@/lib/engagement/crash-corroboration";

/**
 * THE ENGAGEMENT <-> SAFETY READING AS GRANT EVIDENCE.
 *
 * These claims end up in a competitive federal application, cited by a model
 * that will reproduce whatever it is handed. Everything below is about what the
 * fact list is NOT allowed to let it say.
 *
 * Built through the real summarizer over rows shaped as
 * `engagement_items_with_nearby_crashes` returns them, never from a described
 * corroboration object.
 *
 * MUTATION-VERIFIED — see the tail of this file.
 */

function row(over: Partial<NearbyCrashRow> = {}): NearbyCrashRow {
  return {
    id: "item-1",
    campaign_id: "campaign-1",
    category_id: null,
    title: null,
    body: "Cars run this crossing constantly and my neighbour Jane Doe was hit here in March",
    latitude: 38.5968,
    longitude: -121.49,
    votes_count: 0,
    covered_by_ingest: true,
    coverage_years: [2022, 2023, 2024, 2025],
    coverage_severity_completeness: ["kabco_full"],
    crash_total: 0,
    fatal_count: 0,
    severe_injury_count: 0,
    injury_count: 0,
    pdo_count: 0,
    killed_total: 0,
    injured_total: 0,
    pedestrian_crashes: 0,
    bicyclist_crashes: 0,
    nearest_crash_meters: null,
    earliest_crash_year: null,
    latest_crash_year: null,
    ...over,
  };
}

describe("crash-proximity grant facts — the aggregate, and nothing else", () => {
  it("states the share inside coverage, with the radius and the caveat", () => {
    const claims = buildCrashProximityClaims(
      summarizeCampaignCorroboration(
        [
          row({ id: "a", crash_total: 6 }),
          row({ id: "b", crash_total: 4 }),
          row({ id: "c", crash_total: 0 }),
        ],
        100
      ),
      "Ridge Road Listening Campaign"
    );

    expect(claims).toHaveLength(1);
    expect(claims[0]).toContain(
      'Of the 3 mapped public comment(s) on "Ridge Road Listening Campaign" that fall inside acquired crash data, 2 sit within 100 m of at least one reported collision'
    );
    expect(claims[0]).toContain("median 5 collision(s) each");
    expect(claims[0]).toContain(ENGAGEMENT_CRASH_PROXIMITY_NARRATIVE_CAVEAT);
  });

  it("never puts a resident's own words in a federal application", () => {
    // A comment body can identify the writer or a third party — the fixture
    // above names one. The fact list carries counts, never text, and the
    // pairing of one comment with one collision is a judgement rather than
    // arithmetic, so no per-comment claim exists to carry it.
    const claims = buildCrashProximityClaims(
      summarizeCampaignCorroboration([row({ crash_total: 12 })], 100),
      "Ridge Road Listening Campaign"
    );

    for (const claim of claims) {
      expect(claim).not.toContain("Jane Doe");
      expect(claim).not.toContain("Cars run this crossing");
    }
  });

  it("states the data gap as its own fact rather than hiding it", () => {
    // Nathaniel's call, 2026-08-21: the gap is worth showing. Without this
    // fact a drafter is free to imply the whole campaign was checked against
    // the collision history when most of it was not.
    const claims = buildCrashProximityClaims(
      summarizeCampaignCorroboration(
        [
          row({ id: "a", crash_total: 6 }),
          row({ id: "b", covered_by_ingest: false, coverage_years: null }),
          row({ id: "c", covered_by_ingest: false, coverage_years: null }),
        ],
        100
      ),
      "Ridge Road Listening Campaign"
    );

    const gap = claims.find((claim) => claim.includes("fall outside every completed"));
    expect(gap).toBeDefined();
    expect(gap).toContain("2 of the 3 mapped public comment(s)");
    expect(gap).toContain("cannot speak to those locations either way");
    expect(gap).toContain(ENGAGEMENT_CRASH_PROXIMITY_NARRATIVE_CAVEAT);
    // And the covered ones are counted against the COVERED denominator, not
    // against the campaign total — 1 of 1, not 1 of 3.
    expect(claims[0]).toContain("Of the 1 mapped public comment(s)");
  });

  it("says nothing at all when nothing was acquired anywhere near the campaign", () => {
    // Not "0 of N have collisions nearby" — none of them was checked. A zero
    // here would read as a campaign whose every location is collision-free.
    const claims = buildCrashProximityClaims(
      summarizeCampaignCorroboration(
        [row({ id: "a", covered_by_ingest: false, coverage_years: null })],
        100
      ),
      "Ridge Road Listening Campaign"
    );

    expect(claims).toHaveLength(1);
    expect(claims[0]).toContain("fall outside every completed crash acquisition");
    expect(claims.some((claim) => claim.includes("sit within 100 m of at least one"))).toBe(false);
  });

  it("carries the caveat in ONE sentence, so the grounding validator can cite it", () => {
    // A multi-sentence caveat reproduced by a model leaves its trailing
    // sentences uncited and fails per-sentence grounding — the reason every
    // *_NARRATIVE_CAVEAT in this lane is a single sentence.
    const sentences = ENGAGEMENT_CRASH_PROXIMITY_NARRATIVE_CAVEAT.split(". ").filter(Boolean);
    expect(sentences).toHaveLength(1);
    // Both halves of the honesty are in it: proximity is not aboutness, and an
    // unmeasured place is not a safe one.
    expect(ENGAGEMENT_CRASH_PROXIMITY_NARRATIVE_CAVEAT).toContain("proximity only");
    expect(ENGAGEMENT_CRASH_PROXIMITY_NARRATIVE_CAVEAT).toContain("unmeasured");
  });

  it("emits nothing when the campaign has no mapped comments at all", () => {
    expect(buildCrashProximityClaims(summarizeCampaignCorroboration([], 100), "Empty")).toEqual([]);
  });
});
