import { describe, expect, it } from "vitest";
import {
  BASIC_SERVICE_HEADWAY_MINUTES,
  DepartureHistogram,
  FREQUENT_SERVICE_HEADWAY_MINUTES,
  FREQUENT_SERVICE_TIERS,
  SERVICE_DAY_HOUR_BINS,
  deriveServiceLevelMetrics,
  parseGtfsTimeToSeconds,
} from "@/lib/gtfs/service-levels";
import type { GtfsParseWarningCode } from "@/lib/gtfs/types";

/**
 * The derivation on its own — no zip, no feed, no clock. Every number here is
 * arithmetic somebody can check by hand, which is the point: this is the file
 * that turns a schedule into a figure a planner will cite.
 */

const HOUR = 3600;

function histogram(options?: { maxPairs?: number }) {
  const warnings: GtfsParseWarningCode[] = [];
  const subject = new DepartureHistogram({
    maxPairs: options?.maxPairs ?? 1000,
    onWarning: (code) => warnings.push(code),
    initialCapacity: 16,
  });
  return { subject, warnings };
}

/** Derive from a plain list of departure seconds on one (entity, service). */
function metricsFor(seconds: number[], options?: { source?: "scheduled" | "frequencies" }) {
  const { subject, warnings } = histogram();
  for (const value of seconds) subject.addDeparture(0, 0, value, options?.source ?? "scheduled");
  const aggregated = subject.aggregate(0, [0]);
  expect(aggregated).not.toBeNull();
  return { metrics: deriveServiceLevelMetrics(aggregated!), warnings };
}

describe("reading a GTFS time", () => {
  it("reads the ordinary form", () => {
    expect(parseGtfsTimeToSeconds("07:30:00")).toBe(7 * HOUR + 1800);
    expect(parseGtfsTimeToSeconds("7:30:00")).toBe(7 * HOUR + 1800);
    expect(parseGtfsTimeToSeconds("00:00:00")).toBe(0);
  });

  it("PRESERVES an hour past 24, because that is a different time of day", () => {
    // 24:40:00 is Tuesday's service running forty minutes into Wednesday
    // morning. Read as 00:40:00 it becomes Tuesday DAWN — the same feed, a
    // twenty-four-hour error, and nothing anywhere says so.
    expect(parseGtfsTimeToSeconds("24:40:00")).toBe(24 * HOUR + 2400);
    expect(parseGtfsTimeToSeconds("25:10:00")).toBe(25 * HOUR + 600);
    expect(parseGtfsTimeToSeconds("29:59:59")).toBe(29 * HOUR + 59 * 60 + 59);
  });

  it("accepts HH:MM, which gtfs_skim.py refuses — a deliberate difference", () => {
    expect(parseGtfsTimeToSeconds("07:30")).toBe(7 * HOUR + 1800);
  });

  it("refuses a value that means nothing rather than relocating it", () => {
    // gtfs_skim.py would read 10:99:00 as 10:39. Here it is unreadable and gets
    // counted, because a time that means nothing should be reported.
    expect(parseGtfsTimeToSeconds("10:99:00")).toBeNull();
    expect(parseGtfsTimeToSeconds("10:30:99")).toBeNull();
    expect(parseGtfsTimeToSeconds("-1:00:00")).toBeNull();
    expect(parseGtfsTimeToSeconds("noon")).toBeNull();
    expect(parseGtfsTimeToSeconds("7")).toBeNull();
  });

  it("treats a blank as absent, not as broken", () => {
    // A blank departure_time at a non-timepoint stop is legal GTFS.
    expect(parseGtfsTimeToSeconds("")).toBeNull();
    expect(parseGtfsTimeToSeconds("   ")).toBeNull();
    expect(parseGtfsTimeToSeconds(undefined)).toBeNull();
    expect(parseGtfsTimeToSeconds(null)).toBeNull();
  });
});

describe("the histogram has thirty bins, and the six past midnight are load-bearing", () => {
  it("keeps a 25:10 departure in hour 25 rather than wrapping it to hour 1", () => {
    const { metrics } = metricsFor([
      5 * HOUR + 300, // 05:05
      25 * HOUR + 600, // 25:10 — BART's real last train at Embarcadero
    ]);
    expect(metrics.tripsPerDay).toBe(2);
    expect(metrics.firstDepartureSeconds).toBe(5 * HOUR + 300);
    expect(metrics.lastDepartureSeconds).toBe(25 * HOUR + 600);
    // Span is twenty hours of service. Wrapped into 24 bins it would read as
    // MINUS four hours, or as a four-hour day.
    expect(metrics.spanSeconds).toBe(20 * HOUR + 300);
    expect(metrics.spanHours).toBe(21);
  });

  it("puts the late-evening peak in hour 24, not hour 0", () => {
    const departures = [
      ...Array.from({ length: 3 }, (_, i) => 6 * HOUR + i * 600),
      ...Array.from({ length: 8 }, (_, i) => 24 * HOUR + i * 300),
    ];
    const { metrics } = metricsFor(departures);
    expect(metrics.peakHour).toBe(24);
    expect(metrics.peakHourDepartures).toBe(8);
  });

  it("counts a departure past the last bin but refuses to fold it into one", () => {
    const { metrics, warnings } = metricsFor([6 * HOUR, 6 * HOUR + 600, 31 * HOUR]);
    expect(metrics.tripsPerDay).toBe(3);
    expect(metrics.departuresBeyondBinRange).toBe(1);
    // The peak is still 06:00 with two. Folding 31:00 into the last bin would
    // have invented a 29:00 peak that no vehicle ever ran in.
    expect(metrics.peakHour).toBe(6);
    expect(metrics.peakHourDepartures).toBe(2);
    expect(warnings).toContain("departure_past_bin_range");
  });

  it("exposes exactly thirty bins", () => {
    const { subject } = histogram();
    subject.addDeparture(0, 0, 0, "scheduled");
    expect(subject.aggregate(0, [0])!.bins).toHaveLength(SERVICE_DAY_HOUR_BINS);
    expect(SERVICE_DAY_HOUR_BINS).toBe(30);
  });
});

describe("the peak window is derived from the data, never assumed", () => {
  it("finds a midday peak instead of reporting the morning", () => {
    // A school-and-shopping system. An assumed 6-9 AM peak reports 1 departure
    // an hour here and calls it the peak.
    const departures = [
      7 * HOUR,
      ...Array.from({ length: 6 }, (_, i) => 13 * HOUR + i * 600),
      18 * HOUR,
    ];
    const { metrics } = metricsFor(departures);
    expect(metrics.peakHour).toBe(13);
    expect(metrics.peakHourDepartures).toBe(6);
    expect(metrics.peakHeadwayMinutes).toBe(10);
  });

  it("breaks a tie toward the earliest hour, so the same feed always derives the same peak", () => {
    // BART's real Embarcadero platform ties at 15 departures in every hour from
    // 06:00 to 19:00. Without a rule the peak would depend on iteration order.
    const departures = [
      ...Array.from({ length: 4 }, (_, i) => 6 * HOUR + i * 900),
      ...Array.from({ length: 4 }, (_, i) => 15 * HOUR + i * 900),
    ];
    expect(metricsFor(departures).metrics.peakHour).toBe(6);
  });

  it("reports the peak hour alongside the headway so it can be audited", () => {
    const { metrics } = metricsFor(Array.from({ length: 4 }, (_, i) => 17 * HOUR + i * 900));
    expect(metrics.peakHour).toBe(17);
    expect(metrics.peakHeadwayMinutes).toBe(15);
  });
});

describe("a headway is an hourly average, and says so when it is only a bound", () => {
  it("derives 60 / departures in the peak hour", () => {
    expect(metricsFor(Array.from({ length: 6 }, (_, i) => 8 * HOUR + i * 600)).metrics.peakHeadwayMinutes).toBe(10);
    expect(metricsFor(Array.from({ length: 4 }, (_, i) => 8 * HOUR + i * 900)).metrics.peakHeadwayMinutes).toBe(15);
    expect(metricsFor(Array.from({ length: 15 }, (_, i) => 8 * HOUR + i * 240)).metrics.peakHeadwayMinutes).toBe(4);
  });

  it("cannot tell a clustered hour from an even one — the trade, asserted", () => {
    const even = metricsFor(Array.from({ length: 6 }, (_, i) => 8 * HOUR + i * 600)).metrics;
    const clustered = metricsFor(Array.from({ length: 6 }, (_, i) => 8 * HOUR + i * 60)).metrics;
    expect(clustered.peakHeadwayMinutes).toBe(even.peakHeadwayMinutes);
    // If this ever stops being true the caveat in caveats.ts is wrong and must
    // change with it.
  });

  it("flags a once-an-hour stop as a LOWER BOUND, not as hourly service", () => {
    const { metrics } = metricsFor([6 * HOUR, 18 * HOUR]);
    expect(metrics.peakHourDepartures).toBe(1);
    expect(metrics.peakHeadwayMinutes).toBe(60);
    expect(metrics.peakHeadwayIsLowerBound).toBe(true);
  });

  it("does not flag a genuinely measured hour", () => {
    expect(metricsFor([6 * HOUR, 6 * HOUR + 1800]).metrics.peakHeadwayIsLowerBound).toBe(false);
  });
});

describe("the median headway refuses to answer rather than inventing hourly service", () => {
  it("is the median of hourly averages when the span is actually served", () => {
    const departures: number[] = [];
    for (let hour = 6; hour <= 10; hour += 1) {
      for (let n = 0; n < 4; n += 1) departures.push(hour * HOUR + n * 900);
    }
    const { metrics } = metricsFor(departures);
    expect(metrics.medianHeadwayMinutes).toBe(15);
    expect(metrics.medianHeadwayBasis).toBe("hourly_average_over_span");
    expect(metrics.servedHours).toBe(5);
    expect(metrics.spanHours).toBe(5);
  });

  it("REFUSES when more than half the span has no departure at all", () => {
    // One bus at 06:10 and one at 18:40. A median over served hours only would
    // read 60 minutes and a planner would see hourly service on a route that
    // runs twice a day.
    const { metrics } = metricsFor([6 * HOUR + 600, 18 * HOUR + 2400]);
    expect(metrics.medianHeadwayMinutes).toBeNull();
    expect(metrics.medianHeadwayBasis).toBe("not_determined_span_mostly_unserved");
    // The facts that ARE known are still reported.
    expect(metrics.tripsPerDay).toBe(2);
    expect(metrics.servedHours).toBe(2);
    expect(metrics.spanHours).toBe(13);
  });

  it("refuses when there are fewer than two departures", () => {
    const { metrics } = metricsFor([9 * HOUR]);
    expect(metrics.medianHeadwayMinutes).toBeNull();
    expect(metrics.medianHeadwayBasis).toBe("not_determined_too_few_departures");
    expect(metrics.tripsPerDay).toBe(1);
  });

  it("still answers when a minority of the span is unserved", () => {
    const departures: number[] = [];
    for (const hour of [6, 7, 8, 10, 11]) {
      for (let n = 0; n < 2; n += 1) departures.push(hour * HOUR + n * 1800);
    }
    const { metrics } = metricsFor(departures);
    expect(metrics.servedHours).toBe(5);
    expect(metrics.spanHours).toBe(6);
    expect(metrics.medianHeadwayMinutes).toBe(30);
  });
});

describe("frequent-service tiers", () => {
  it("ships exactly two, and they are the named constants", () => {
    expect(FREQUENT_SERVICE_HEADWAY_MINUTES).toBe(15);
    expect(BASIC_SERVICE_HEADWAY_MINUTES).toBe(30);
    expect(FREQUENT_SERVICE_TIERS).toEqual([15, 30]);
  });

  it("reports the TIGHTEST tier a stop meets", () => {
    expect(metricsFor(Array.from({ length: 6 }, (_, i) => 8 * HOUR + i * 600)).metrics.frequentServiceTierMinutes).toBe(15);
    expect(metricsFor(Array.from({ length: 4 }, (_, i) => 8 * HOUR + i * 900)).metrics.frequentServiceTierMinutes).toBe(15);
    expect(metricsFor(Array.from({ length: 3 }, (_, i) => 8 * HOUR + i * 1200)).metrics.frequentServiceTierMinutes).toBe(30);
    expect(metricsFor(Array.from({ length: 2 }, (_, i) => 8 * HOUR + i * 1800)).metrics.frequentServiceTierMinutes).toBe(30);
  });

  it("gives an hourly rural stop no tier rather than a flattering one", () => {
    const departures = Array.from({ length: 8 }, (_, i) => (7 + i) * HOUR);
    expect(metricsFor(departures).metrics.frequentServiceTierMinutes).toBeNull();
  });
});

describe("provenance survives onto every row", () => {
  it("says scheduled when nothing was expanded", () => {
    const { metrics } = metricsFor([8 * HOUR, 9 * HOUR]);
    expect(metrics.derivationMethod).toBe("scheduled");
    expect(metrics.scheduledTripCount).toBe(2);
    expect(metrics.frequencyTripCount).toBe(0);
  });

  it("says frequencies when every departure was expanded", () => {
    const { metrics } = metricsFor([8 * HOUR, 9 * HOUR], { source: "frequencies" });
    expect(metrics.derivationMethod).toBe("frequencies");
    expect(metrics.frequencyTripCount).toBe(2);
    expect(metrics.scheduledTripCount).toBe(0);
  });

  it("says mixed when both produced departures at the same stop", () => {
    const { subject } = histogram();
    subject.addDeparture(0, 0, 8 * HOUR, "scheduled");
    subject.addDeparture(0, 0, 8 * HOUR + 900, "frequencies");
    const metrics = deriveServiceLevelMetrics(subject.aggregate(0, [0])!);
    expect(metrics.derivationMethod).toBe("mixed");
    expect(metrics.scheduledTripCount).toBe(1);
    expect(metrics.frequencyTripCount).toBe(1);
  });
});

describe("the accumulator itself", () => {
  it("keeps memory proportional to pairs, not to departures", () => {
    const { subject } = histogram();
    for (let i = 0; i < 50_000; i += 1) subject.addDeparture(0, 0, 8 * HOUR + (i % 3600), "scheduled");
    // Fifty thousand departures. One pair.
    expect(subject.pairCount).toBe(1);
    expect(subject.aggregate(0, [0])!.bins[8]).toBe(50_000);
  });

  it("sums a day name across every service active on it", () => {
    // A Tuesday served by two service ids — the ordinary case for an agency
    // with a separate school-day service.
    const { subject } = histogram();
    subject.addDeparture(0, 0, 8 * HOUR, "scheduled");
    subject.addDeparture(0, 0, 8 * HOUR + 1800, "scheduled");
    subject.addDeparture(0, 1, 8 * HOUR + 900, "scheduled");
    subject.addDeparture(0, 1, 15 * HOUR, "scheduled");

    const both = subject.aggregate(0, [0, 1])!;
    expect(both.bins[8]).toBe(3);
    expect(both.firstDepartureSeconds).toBe(8 * HOUR);
    expect(both.lastDepartureSeconds).toBe(15 * HOUR);

    const onlyFirst = subject.aggregate(0, [0])!;
    expect(onlyFirst.bins[8]).toBe(2);
    expect(onlyFirst.lastDepartureSeconds).toBe(8 * HOUR + 1800);
  });

  it("returns null for an entity that ran on none of those services", () => {
    const { subject } = histogram();
    subject.addDeparture(0, 0, 8 * HOUR, "scheduled");
    // Not a row of zeroes: the stop is not in Sunday's service at all, and
    // "unserved" and "not scheduled" are different claims.
    expect(subject.aggregate(0, [7])).toBeNull();
    expect(subject.aggregate(99, [0])).toBeNull();
  });

  it("refuses a new pair past the ceiling instead of quietly truncating", () => {
    const { subject } = histogram({ maxPairs: 2 });
    expect(subject.addDeparture(0, 0, HOUR, "scheduled")).toBe(true);
    expect(subject.addDeparture(1, 0, HOUR, "scheduled")).toBe(true);
    expect(subject.addDeparture(2, 0, HOUR, "scheduled")).toBe(false);
    // An existing pair still accepts departures — the ceiling is on pairs.
    expect(subject.addDeparture(0, 0, 2 * HOUR, "scheduled")).toBe(true);
  });

  it("grows past its initial capacity without losing what it already held", () => {
    const { subject } = histogram();
    for (let entity = 0; entity < 200; entity += 1) {
      subject.addDeparture(entity, 0, (6 + (entity % 10)) * HOUR, "scheduled");
    }
    expect(subject.pairCount).toBe(200);
    expect(subject.aggregate(0, [0])!.bins[6]).toBe(1);
    expect(subject.aggregate(199, [0])!.bins[6 + (199 % 10)]).toBe(1);
  });

  it("records a saturated bin instead of wrapping it to zero", () => {
    // 65,536 departures in one hour cannot happen, but an unchecked Uint16
    // increment would report the busiest hour in the feed as the emptiest.
    const { subject, warnings } = histogram();
    for (let i = 0; i < 65_540; i += 1) subject.addDeparture(0, 0, 8 * HOUR, "scheduled");
    expect(subject.aggregate(0, [0])!.bins[8]).toBe(65_535);
    expect(warnings.filter((code) => code === "bin_saturated")).toHaveLength(5);
  });

  it("does not warn about anything on an ordinary feed", () => {
    const { warnings } = metricsFor([6 * HOUR, 7 * HOUR, 8 * HOUR]);
    expect(warnings).toEqual([]);
  });
});

describe("a stop with no departures produces nothing at all", () => {
  it("derives zeroes only from an explicitly empty aggregate", () => {
    const metrics = deriveServiceLevelMetrics({
      bins: new Uint32Array(SERVICE_DAY_HOUR_BINS),
      firstDepartureSeconds: null,
      lastDepartureSeconds: null,
      frequencyDepartures: 0,
      departuresBeyondBinRange: 0,
    });
    expect(metrics.tripsPerDay).toBe(0);
    expect(metrics.peakHour).toBeNull();
    expect(metrics.peakHeadwayMinutes).toBeNull();
    expect(metrics.frequentServiceTierMinutes).toBeNull();
    expect(metrics.spanSeconds).toBeNull();
    expect(metrics.medianHeadwayBasis).toBe("not_determined_too_few_departures");
  });
});
