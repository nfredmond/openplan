import { describe, expect, it } from "vitest";

import { accessibilityTransitTerm } from "@/lib/data-sources/scoring";
import { summarizeContributions } from "@/lib/data-sources/transit/gtfs-feed";
import type { StudyAreaBbox } from "@/lib/models/study-area";

/**
 * MORE INFORMATION MUST NEVER PRODUCE A HIGHER TRANSIT TERM.
 *
 * ============================================================== WHAT WENT WRONG
 *
 * `accessibilityTransitTerm` handed back the WHOLE density term whenever
 * `frequentServiceShare` was not a finite number, and `summarizeContributions`
 * sets that share null whenever no ingested feed's own stops span the study area.
 * So a PARTIAL-coverage GTFS run scored 6.45 transit points ABOVE a FULL-coverage
 * run over the identical stops: an agency whose feed covered its corridor
 * completely got a WORSE number than one whose feed covered a third of it.
 *
 * That is the hazard this lane already refuses elsewhere — refusing to measure is
 * not neutral, it rescales the remainder upward, which is exactly why an expired
 * feed still scores.
 *
 * ========================================= WHY THIS IS A PROPERTY, NOT AN EXAMPLE
 *
 * The defect was reachable at every density and every coverage fraction; an
 * example test pins one point on a surface and says nothing about the rest of it.
 * A future change that re-inverts the ordering — a new "confidence" multiplier, a
 * different treatment of truncation, a third source with partial frequency data —
 * would slip past a table of expected numbers and cannot slip past a sweep. So
 * these assertions range over densities from bare to saturated and over every
 * fraction of stops whose frequency could be measured, and they assert an
 * ORDERING rather than a value.
 *
 * The one thing deliberately NOT asserted here: that a frequency-capable source
 * outranks the density-only OpenStreetMap tally. It does not, on purpose. An OSM
 * run keeps the full density term it has always had — nothing may move the score
 * of a workspace that has ingested no feed — so a partly-covered GTFS run can
 * score below it. Those two runs are on different scales and
 * `transitComparabilityRefusal` already refuses to subtract them; the ordering
 * that had to be repaired is the one WITHIN the source that can measure.
 */

/** Bare to well past the 9.1 stops/sq mi saturation point, plus the edges. */
const DENSITIES = [0, 0.4, 1, 2.5, 4.55, 9.09, 9.1, 12, 40];

/** Every coverage fraction between "measured none of them" and "measured all". */
const FRACTIONS = [0, 0.05, 0.125, 0.25, 1 / 3, 0.5, 0.75, 0.9, 1];

function measured(stopsPerSqMile: number, share: number) {
  return accessibilityTransitTerm({
    stopsPerSqMile,
    frequentServiceShare: share,
    measuresFrequency: true,
  });
}

/** A frequency-capable source that could not state a share for this area. */
function withheld(stopsPerSqMile: number) {
  return accessibilityTransitTerm({
    stopsPerSqMile,
    frequentServiceShare: null,
    measuresFrequency: true,
  });
}

/** A source with no opinion on frequency at all — the OpenStreetMap path. */
function densityOnly(stopsPerSqMile: number) {
  return accessibilityTransitTerm({
    stopsPerSqMile,
    frequentServiceShare: null,
    measuresFrequency: false,
  });
}

describe("the transit term is monotone in how much frequency was measured", () => {
  it("never scores a withheld share above a measured one, at any density", () => {
    for (const density of DENSITIES) {
      for (const share of FRACTIONS) {
        expect(
          measured(density, share),
          `density ${density}, share ${share}: measuring must not score below withholding`
        ).toBeGreaterThanOrEqual(withheld(density));
      }
    }
  });

  it("rises with the share and never falls, across every density", () => {
    for (const density of DENSITIES) {
      let previous = withheld(density);
      for (const share of FRACTIONS) {
        const term = measured(density, share);
        expect(term, `density ${density}, share ${share} fell below the previous share`).toBeGreaterThanOrEqual(
          previous
        );
        previous = term;
      }
    }
  });

  it("treats a share that could not be stated as exactly a share of zero", () => {
    // The two are the SAME point, not merely ordered. That is what makes the
    // ordering hold by construction rather than by the numbers happening to line
    // up: withholding is the floor of measuring, never a value outside its range.
    for (const density of DENSITIES) {
      expect(withheld(density)).toBe(measured(density, 0));
    }
  });

  it("keeps the term inside the ceiling the composite's weighting depends on", () => {
    // The ceiling is why this change touches no other component. Accessibility is
    // a weighted average over component maxima; moving this one would silently
    // re-weight accessibility against safety and equity in every run.
    for (const density of [...DENSITIES, 1e6]) {
      for (const share of [...FRACTIONS, 4, -3, Number.NaN]) {
        const term = measured(density, share);
        expect(Number.isFinite(term), `density ${density}, share ${share} produced ${term}`).toBe(true);
        expect(term).toBeGreaterThanOrEqual(0);
        expect(term).toBeLessThanOrEqual(20);
      }
      expect(densityOnly(density)).toBeLessThanOrEqual(20);
    }
  });

  it("leaves the density-only source exactly where it was", () => {
    // A workspace that has ingested no feed must score today what it scored
    // before any of this existed: `min(20, density × 2.2)`, whole.
    for (const density of DENSITIES) {
      expect(densityOnly(density)).toBeCloseTo(Math.min(20, density * 2.2), 10);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* The same property, through the real summariser                              */
/* -------------------------------------------------------------------------- */

/**
 * A one-degree square, so the density arithmetic is real rather than mocked.
 * `summarizeContributions` divides by `bboxAreaSquareMiles(bbox)`.
 */
const BBOX: StudyAreaBbox = { minLon: -121.8, minLat: 38.5, maxLon: -121.7, maxLat: 38.6 };

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday"] as const;

type StopSpec = { stopId: string; peakHeadwaySeconds: number | null };

/**
 * Build the contribution shape `summarizeContributions` consumes.
 *
 * `covering` is what makes coverage FULL: the summariser asks whether one feed's
 * own stop extent contains the study area, so an extent drawn around the bbox is
 * the difference between a reported share and a withheld one.
 */
function contribution(stops: StopSpec[], covering: boolean) {
  return {
    version: {
      id: "ver-1",
      feed_id: "feed-1",
      service_end_date: null,
      frequency_trip_count: 0,
      parse_warnings: [],
      route_service_level_rows: 10,
    },
    feed: { id: "feed-1", agency_name: "Agency", city: null, state: null },
    extent: covering
      ? { minLon: -122.5, minLat: 38.0, maxLon: -121.0, maxLat: 39.0 }
      : { minLon: -121.78, minLat: 38.52, maxLon: -121.72, maxLat: 38.58 },
    rows: stops.flatMap((stop) =>
      WEEKDAYS.map((day) => ({
        stop_id: stop.stopId,
        service_day: day,
        trips_per_day: 40,
        first_departure_seconds: 21_600,
        last_departure_seconds: 79_200,
        peak_headway_seconds: stop.peakHeadwaySeconds,
        peak_window_start_seconds: 28_800,
      }))
    ),
    truncated: false,
  };
}

/**
 * Twenty stops of which `frequent` are frequent, `measurable` have a derivable
 * peak headway at all, and the rest have none — a weekend-only stop, or a stop
 * with a single daily trip and therefore no interval.
 */
function twentyStops(measurable: number, frequent: number): StopSpec[] {
  return Array.from({ length: 20 }, (_, index) => ({
    stopId: `stop-${index}`,
    peakHeadwaySeconds: index >= measurable ? null : index < frequent ? 720 : 3_600,
  }));
}

describe("the summariser's share is monotone in how many stops it could measure", () => {
  it("counts every stop in the denominator, so measuring one more can only raise it", () => {
    // THE DENOMINATOR IS THE WHOLE POINT. It used to be stops-WITH-A-HEADWAY,
    // while the narrative, the report table and the results tile all called it a
    // share of the corridor's stops. With that denominator, measuring one more
    // stop and finding it infrequent LOWERED nothing and finding it frequent
    // raised nothing — the share was a fact about a set nothing on screen named.
    let previous = -1;
    for (let measurable = 4; measurable <= 20; measurable += 4) {
      const summary = summarizeContributions(BBOX, [contribution(twentyStops(measurable, 4), true)]);
      expect(summary.totalStops).toBe(20);
      // Four frequent stops out of twenty, whatever else was measurable.
      expect(summary.frequentServiceShare).toBeCloseTo(4 / 20, 10);
      expect(summary.frequentServiceShare!).toBeGreaterThanOrEqual(previous);
      previous = summary.frequentServiceShare!;
    }
  });

  it("raises the share only when a newly measured stop is actually frequent", () => {
    const shares = [0, 5, 10, 20].map((frequent) => {
      const summary = summarizeContributions(BBOX, [contribution(twentyStops(20, frequent), true)]);
      return summary.frequentServiceShare!;
    });

    expect(shares).toEqual([0, 0.25, 0.5, 1]);
    for (let index = 1; index < shares.length; index += 1) {
      expect(shares[index]).toBeGreaterThanOrEqual(shares[index - 1]);
    }
  });

  it("scores full coverage at or above partial coverage over the identical stops", () => {
    // THE DEFECT, AS A TEST. Same twenty stops, same density, same feed — only
    // the feed's own extent differs. Before this was fixed the partial run scored
    // 6.45 points HIGHER.
    const fullTerms: number[] = [];

    for (const frequent of [0, 1, 4, 10, 20]) {
      const stops = twentyStops(20, frequent);
      const full = summarizeContributions(BBOX, [contribution(stops, true)]);
      const partial = summarizeContributions(BBOX, [contribution(stops, false)]);

      expect(full.stopsPerSqMile).toBe(partial.stopsPerSqMile);
      expect(partial.frequentServiceShare).toBeNull();

      const fullTerm = accessibilityTransitTerm(full);
      const partialTerm = accessibilityTransitTerm(partial);
      expect(
        fullTerm,
        `${frequent}/20 frequent: full coverage must not score below partial coverage`
      ).toBeGreaterThanOrEqual(partialTerm);
      fullTerms.push(fullTerm);

      // A corridor whose feed spans it and found NO frequent stop scores exactly
      // what a withheld share scores. That equality is the seam: it is what makes
      // "could not measure" the floor of "measured" rather than a value beside it.
      if (frequent === 0) expect(fullTerm).toBe(partialTerm);
    }

    // And the frequency half must actually be REACHED by a real summary — a
    // summariser that reported itself unable to measure frequency would satisfy
    // every ordering above by scoring one flat number for all five corridors.
    for (let index = 1; index < fullTerms.length; index += 1) {
      expect(fullTerms[index], "the measured share must move the term").toBeGreaterThan(
        fullTerms[index - 1]
      );
    }
  });

  it("says so wherever the figure is printed, rather than moving a score in silence", () => {
    const partial = summarizeContributions(BBOX, [contribution(twentyStops(20, 4), false)]);
    // A planner whose number moved because their feed covers part of the corridor
    // has to be able to find that out from the run itself.
    expect(partial.method.frequencyTermApplied).toBe(false);
    expect(partial.method.detail).toMatch(/scored as ZERO/);
    expect(partial.method.detail).toMatch(/unmeasured half is not an earned one/i);
  });
});
