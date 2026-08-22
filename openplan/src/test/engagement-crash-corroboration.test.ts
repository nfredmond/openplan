import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCrashCorroborationView,
  buildCrashRadiusChoices,
  clampCrashProximityMeters,
  countUnmoderatedMapped,
  DEFAULT_CRASH_PROXIMITY_METERS,
  describeCorroborationBaseline,
  describeYears,
  MAX_CRASH_PROXIMITY_METERS,
  MIN_CRASH_PROXIMITY_METERS,
  summarizeCampaignCorroboration,
  readNearbyCrashes,
  weakestCompleteness,
  type NearbyCrashRow,
} from "@/lib/engagement/crash-corroboration";

/**
 * THE ENGAGEMENT <-> SAFETY READING, and the three ways it could lie.
 *
 * The rows below are shaped exactly as `engagement_items_with_nearby_crashes`
 * returns them — including the detail that decides the hardest test in this
 * file: THE FUNCTION RETURNS ZEROS FOR AN UNCOVERED POINT, because SQL has to
 * return something. Proven against the live function on 2026-08-21, a probe
 * outside every acquisition bbox came back `covered_by_ingest = false` with
 * `crash_total = 0`. If this module carried those zeros forward, a resident who
 * flagged a dangerous corner in a county nobody has acquired data for would be
 * rendered as contradicted by the record.
 *
 * MUTATION-VERIFIED — see the tail of this file for what was reverted.
 */

function row(over: Partial<NearbyCrashRow> = {}): NearbyCrashRow {
  return {
    id: "item-1",
    campaign_id: "campaign-1",
    category_id: null,
    title: null,
    body: "the crossing here is dangerous",
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

describe("engagement × safety — zero has two meanings", () => {
  it("never reports an unmeasured location as a location without collisions", () => {
    // The shape the live function actually returns for an uncovered point:
    // covered false, and zeros in every count column.
    const summary = summarizeCampaignCorroboration(
      [row({ id: "uncovered", covered_by_ingest: false, coverage_years: null })],
      100
    );
    const item = summary.items[0];

    expect(item.coverage).toBe("not_acquired");
    expect(item.sentence).toContain("Nobody has retrieved collisions for this location");
    expect(item.sentence).toContain("This is not a reading of zero.");
    // The words that would make it a reading must not appear.
    expect(item.sentence).not.toContain("No reported collisions within");
    expect(item.coverageYears).toEqual([]);
    // An uncovered point contributes to neither side of the denominator.
    expect(summary.coveredTotal).toBe(0);
    expect(summary.withAnyCrashPct).toBeNull();
  });

  it("says plainly that a covered location had none, which is a real reading", () => {
    const summary = summarizeCampaignCorroboration([row({ id: "quiet" })], 100);

    expect(summary.items[0].coverage).toBe("covered");
    expect(summary.items[0].sentence).toBe("No reported collisions within 100 m in 2022–2025.");
    expect(summary.coveredTotal).toBe(1);
    expect(summary.withAnyCrash).toBe(0);
    expect(summary.withAnyCrashPct).toBe(0);
  });

  it("carries no counts at all from an uncovered row, even when the row carries numbers", () => {
    // A defensive case: were the function ever to return counts alongside
    // covered=false, they must not reach a surface. Coverage decides.
    const summary = summarizeCampaignCorroboration(
      [row({ covered_by_ingest: false, crash_total: 9, fatal_count: 2, killed_total: 2 })],
      100
    );

    expect(summary.items[0].crashTotal).toBe(0);
    expect(summary.items[0].fatal).toBe(0);
    expect(summary.items[0].killed).toBe(0);
    expect(summary.items[0].sentence).not.toContain("9");
  });
});

describe("engagement × safety — the reading itself", () => {
  it("reports counts and a distance, and never a verdict", () => {
    const summary = summarizeCampaignCorroboration(
      [
        row({
          crash_total: 12,
          fatal_count: 1,
          severe_injury_count: 2,
          injury_count: 4,
          pdo_count: 5,
          killed_total: 1,
          injured_total: 7,
          pedestrian_crashes: 3,
          bicyclist_crashes: 1,
          nearest_crash_meters: 5.83,
          earliest_crash_year: 2022,
          latest_crash_year: 2025,
        }),
      ],
      100
    );
    const item = summary.items[0];

    expect(item.sentence).toBe(
      "12 collisions within 100 m in 2022–2025: 1 fatal, 2 serious injury, 4 injury, " +
        "5 property damage only. 1 killed, 7 injured. 3 involving a pedestrian, 1 involving a bicyclist."
    );
    expect(item.nearestMeters).toBe(5.8);
    // The vocabulary that would turn proximity into aboutness.
    for (const word of ["confirm", "validat", "support", "proves", "because"]) {
      expect(item.sentence.toLowerCase()).not.toContain(word);
    }
  });

  it("keeps a gap in the acquired years visible instead of spanning it", () => {
    // A quiet year is exactly what a reader leans on, so a hole must not be
    // presented as a continuous range.
    expect(describeYears([2019, 2020, 2022, 2023])).toBe("2019, 2020, 2022, 2023");
    expect(describeYears([2022, 2023, 2024, 2025])).toBe("2022–2025");
    expect(describeYears([2024])).toBe("2024");
    expect(describeYears([])).toBeNull();
  });

  it("reads a mixed acquisition at its WEAKEST instrument", () => {
    // Two acquisitions cover the point; one could only see fatalities. Anything
    // said about serious injuries is bounded by that one, not by the better one.
    expect(weakestCompleteness(["kabco_full", "fatal_only"])).toBe("fatal_only");
    expect(weakestCompleteness(["kabco_full"])).toBe("kabco_full");
    expect(weakestCompleteness(["fatal_injury_only", "kabco_full"])).toBe("fatal_injury_only");
    expect(weakestCompleteness([])).toBeNull();
    expect(weakestCompleteness(["something-nobody-registered"])).toBeNull();
  });
});

describe("engagement × safety — the denominator that stops a count reading as a finding", () => {
  it("computes the campaign's own distribution, over covered comments only", () => {
    const summary = summarizeCampaignCorroboration(
      [
        row({ id: "a", crash_total: 2 }),
        row({ id: "b", crash_total: 8 }),
        row({ id: "c", crash_total: 0 }),
        row({ id: "d", crash_total: 4 }),
        // Uncovered: it is not evidence either way, so it must not dilute the
        // share by joining the denominator.
        row({ id: "e", covered_by_ingest: false }),
      ],
      100
    );

    expect(summary.mappedTotal).toBe(5);
    expect(summary.coveredTotal).toBe(4);
    expect(summary.withAnyCrash).toBe(3);
    expect(summary.withAnyCrashPct).toBe(75);
    expect(summary.medianCrashesWhereAny).toBe(4);

    const baseline = describeCorroborationBaseline(summary);
    expect(baseline).toContain("3 of the 4 mapped comments inside crash coverage (75%)");
    expect(baseline).toContain("a median of 4 each");
    expect(baseline).toContain("most points have collisions nearby");
  });

  it("says nothing rather than inventing a denominator when nothing is covered", () => {
    const summary = summarizeCampaignCorroboration([row({ covered_by_ingest: false })], 100);
    expect(describeCorroborationBaseline(summary)).toBeNull();
  });

  it("discloses that every count is a floor, and why", () => {
    const summary = summarizeCampaignCorroboration([row({ crash_total: 3, pdo_count: 3 })], 100);

    // Reused from the safety module rather than rewritten here: a shared
    // sentence living in one of its callers gets reimplemented wrongly by the
    // other, which is a defect this repository has already had.
    expect(summary.caveats.some((c) => c.includes("did not geolocate"))).toBe(true);
    expect(summary.caveats.some((c) => c.includes("not modeled estimates"))).toBe(true);
  });

  it("names the unmeasured comments whenever there are any", () => {
    const summary = summarizeCampaignCorroboration(
      [row({ id: "a", crash_total: 1 }), row({ id: "b", covered_by_ingest: false })],
      100
    );
    expect(
      summary.caveats.some((c) => c.includes("outside every completed crash acquisition"))
    ).toBe(true);
  });
});

describe("engagement × safety — the radius is chosen, not assumed", () => {
  it("clamps a requested radius into the defensible band", () => {
    expect(clampCrashProximityMeters(250)).toBe(250);
    expect(clampCrashProximityMeters(1)).toBe(MIN_CRASH_PROXIMITY_METERS);
    expect(clampCrashProximityMeters(99999)).toBe(MAX_CRASH_PROXIMITY_METERS);
    expect(clampCrashProximityMeters("not a number")).toBe(DEFAULT_CRASH_PROXIMITY_METERS);
    expect(clampCrashProximityMeters(undefined)).toBe(DEFAULT_CRASH_PROXIMITY_METERS);
    expect(clampCrashProximityMeters(-5)).toBe(MIN_CRASH_PROXIMITY_METERS);
  });

  it("states the radius it used in every sentence it writes", () => {
    const summary = summarizeCampaignCorroboration([row({ crash_total: 1 })], 250);
    expect(summary.items[0].sentence).toContain("within 250 m");
    expect(describeCorroborationBaseline(summary)).toContain("within 250 m");
  });
});

describe("engagement × safety — what the console is handed", () => {
  it("never turns a failed read into a reading", () => {
    // The defect this binding exists to prevent: an error response carries no
    // rows, so summarizing it would produce a campaign whose every location is
    // collision-free — the most confident possible version of being wrong.
    const view = buildCrashCorroborationView({
      campaignId: "campaign-1",
      query: {},
      radiusMeters: 100,
      rpcResult: { data: null, error: { message: "permission denied" } },
      items: [],
      checkRead: (_label, result) => Boolean(result.error),
    });

    expect(view.unreadable).toBe(true);
    expect(view.summary).toBeNull();
  });

  it("summarizes a successful read and names the lane it checked", () => {
    const labels: string[] = [];
    const view = buildCrashCorroborationView({
      campaignId: "campaign-1",
      query: {},
      radiusMeters: 100,
      rpcResult: { data: [row({ crash_total: 2 })], error: null },
      items: [],
      checkRead: (label) => {
        labels.push(label);
        return false;
      },
    });

    expect(view.unreadable).toBe(false);
    expect(view.summary?.items).toHaveLength(1);
    expect(labels).toEqual(["reported collisions near this campaign's mapped comments"]);
  });

  it("keeps every other search parameter when the distance changes", () => {
    // Losing `tab` here would close the Analysis panel the planner is reading
    // the moment they change the radius.
    const choices = buildCrashRadiusChoices(
      "campaign-1",
      { tab: "analysis", q: "crosswalk", crashRadius: "100" },
      100
    );

    const first = new URL(choices[0].href, "https://example.test");
    expect(first.searchParams.get("tab")).toBe("analysis");
    expect(first.searchParams.get("q")).toBe("crosswalk");
    expect(first.searchParams.get("crashRadius")).toBe("50");
    expect(first.hash).toBe("#crash-corroboration");
    expect(choices.filter((choice) => choice.active).map((c) => c.meters)).toEqual([100]);
  });

  it("counts a mapped comment as held back whether it was pinned or drawn", () => {
    expect(
      countUnmoderatedMapped([
        { status: "pending", latitude: 38.5, longitude: -121.4 },
        { status: "flagged", geometry: { type: "Point", coordinates: [0, 0] } },
        // Approved: it is IN the comparison, so it is not held back.
        { status: "approved", latitude: 38.5, longitude: -121.4 },
        // Pending but unmapped: it could never have been compared anyway.
        { status: "pending", latitude: null, longitude: null },
      ])
    ).toBe(2);
    expect(countUnmoderatedMapped(null)).toBe(0);
  });

  it("sends the campaign and workspace the caller asked about, under the names the function declares", () => {
    // An untyped client cannot catch a renamed argument, so the spellings are
    // asserted here rather than discovered as an unreadable lane in production.
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    readNearbyCrashes(
      {
        rpc: (name, args) => {
          calls.push({ name, args });
          return Promise.resolve({ data: [], error: null });
        },
      },
      "ws-1",
      "campaign-1",
      250
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("engagement_items_with_nearby_crashes");
    expect(calls[0].args).toEqual({
      p_workspace_id: "ws-1",
      p_campaign_id: "campaign-1",
      p_radius_meters: 250,
      p_from_year: null,
      p_to_year: null,
    });

    // Asserted against the MIGRATION, not against this file's own spelling —
    // comparing the call to the constant that produced it proves nothing. This
    // is the only check that can see a rename on either side.
    const sql = readFileSync(
      path.join(process.cwd(), "supabase/migrations/20260821000001_engagement_crash_corroboration.sql"),
      "utf8"
    );
    const declared = [...sql.matchAll(/^\s+(p_[a-z_]+)\s+\w/gm)].map((m) => m[1]);
    expect(new Set(declared)).toEqual(new Set(Object.keys(calls[0].args)));
    expect(sql).toContain("FUNCTION public.engagement_items_with_nearby_crashes(");
  });
});
