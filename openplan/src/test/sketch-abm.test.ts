/**
 * Sketch ABM port tests (FreeChAMP -> openplan/src/lib/models/sketch-abm).
 *
 * Covers each module plus the regression test for the upstream income-cost
 * interaction bug that was fixed in the port (mode-choice.ts). All
 * Math.random draws are replaced with a seeded PRNG so the suite is
 * deterministic.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runABM } from "@/lib/models/sketch-abm/abm-runner";
import {
  calculateAccessibility,
  chooseDestination,
  getTopDestinations,
} from "@/lib/models/sketch-abm/destination-choice";
import {
  aggregateMode,
  calculateLogsum,
  chooseTourMode,
} from "@/lib/models/sketch-abm/mode-choice";
import {
  chooseTimeOfDay,
  formatTime,
  getTimePeriod,
  scheduleTours,
} from "@/lib/models/sketch-abm/time-of-day-choice";
import {
  applyHouseholdCDAP,
  generateTourFrequency,
  generateToursForPerson,
  getMaxToursPerDay,
  getTourStatistics,
} from "@/lib/models/sketch-abm/tour-generation";
import type {
  ABMInputs,
  DestinationChoiceInputs,
  Household,
  ModeChoiceInputs,
  Person,
  SkimRow,
  TimeChoiceInputs,
  TimePeriod,
  Tour,
  TourPurpose,
  Zone,
} from "@/lib/models/sketch-abm/types";

/** Deterministic PRNG (mulberry32) substituted for Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

beforeEach(() => {
  vi.spyOn(Math, "random").mockImplementation(mulberry32(20260717));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePerson(id: string, overrides: Partial<Person> = {}): Person {
  return {
    id,
    household_id: `hh-${id}`,
    age: 40,
    sex: "F",
    worker: true,
    student: false,
    income_category: 4,
    ...overrides,
  };
}

function makeTour(purpose: TourPurpose, overrides: Partial<Tour> = {}): Tour {
  return {
    id: `tour-${purpose}`,
    person_id: "p1",
    household_id: "hh-1",
    tour_type: purpose === "work" || purpose === "school" ? "mandatory" : "non_mandatory",
    tour_purpose: purpose,
    num_stops_outbound: 0,
    num_stops_inbound: 0,
    origin_taz: "A",
    composition: "alone",
    ...overrides,
  };
}

function makeSkim(overrides: Partial<SkimRow> = {}): SkimRow {
  return {
    auto_time: 15,
    auto_dist: 6,
    auto_cost: 2.5,
    transit_ivtt: 20,
    transit_walk_time: 8,
    transit_wait_time: 6,
    transit_fare: 2.5,
    walk_time: 40,
    bike_time: 25,
    ...overrides,
  };
}

function makeZone(id: string, overrides: Partial<Zone> = {}): Zone {
  return {
    id,
    total_employment: 1000,
    retail_employment: 200,
    service_employment: 300,
    office_employment: 200,
    industrial_employment: 100,
    total_households: 500,
    population: 1200,
    area_sq_km: 4,
    lon: 0,
    lat: 0,
    ...overrides,
  };
}

/** Mode-choice fixture where several modes are plausibly available. */
function makeModeInputs(income: number, overrides: Partial<ModeChoiceInputs> = {}): ModeChoiceInputs {
  return {
    tour: makeTour("work"),
    person_age: 35,
    person_income: income,
    household_autos: 1,
    household_size: 2,
    origin_taz_id: "A",
    dest_taz_id: "B",
    ...makeSkim(),
    dest_density: 3000,
    dest_parking_cost: 5,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tour generation (CDAP + frequency)
// ---------------------------------------------------------------------------

describe("sketch-abm tour generation", () => {
  it("applies CDAP patterns coherently across a synthetic population", () => {
    const workers = Array.from({ length: 400 }, (_, i) => makePerson(`w${i}`));
    const toddlers = Array.from({ length: 50 }, (_, i) =>
      makePerson(`t${i}`, { age: 3, worker: false, student: false })
    );
    const seniors = Array.from({ length: 50 }, (_, i) =>
      makePerson(`s${i}`, { age: 80, worker: false, student: false })
    );

    const worker_patterns = applyHouseholdCDAP(workers, "A");
    const toddler_patterns = applyHouseholdCDAP(toddlers, "A");
    const senior_patterns = applyHouseholdCDAP(seniors, "A");

    const mandatory_share =
      worker_patterns.filter(p => p.pattern === "Mandatory").length / workers.length;
    expect(mandatory_share).toBeGreaterThan(0.78);
    expect(mandatory_share).toBeLessThan(0.92);

    toddler_patterns.forEach(p => expect(p.pattern).toBe("Home"));
    senior_patterns.forEach(p => expect(["Home", "NonMandatory"]).toContain(p.pattern));
  });

  it("produces tour frequencies that sum sensibly for each CDAP pattern", () => {
    const person = makePerson("p1");
    const max_tours = getMaxToursPerDay();

    // Home pattern: no tours at all
    const home_freq = generateTourFrequency(person, { person_id: "p1", pattern: "Home" });
    expect(Object.values(home_freq).reduce((a, b) => a + b, 0)).toBe(0);

    for (let i = 0; i < 200; i++) {
      const mand = generateTourFrequency(person, { person_id: "p1", pattern: "Mandatory" });
      expect(mand.work_tours).toBe(1); // Worker on a mandatory day always has a work tour
      const mand_total = Object.values(mand).reduce((a, b) => a + b, 0);
      expect(mand_total).toBeGreaterThanOrEqual(1);
      expect(mand_total).toBeLessThanOrEqual(max_tours);

      const non_mand = generateTourFrequency(person, { person_id: "p1", pattern: "NonMandatory" });
      expect(non_mand.work_tours).toBe(0);
      const non_mand_total = Object.values(non_mand).reduce((a, b) => a + b, 0);
      expect(non_mand_total).toBeGreaterThanOrEqual(0);
      expect(non_mand_total).toBeLessThanOrEqual(max_tours);
    }
  });

  it("generates weekday tours with a high work-tour share for workers", () => {
    const n = 300;
    let persons_with_work_tour = 0;
    const all_tours: Tour[] = [];

    for (let i = 0; i < n; i++) {
      const person = makePerson(`p${i}`);
      const tours = generateToursForPerson(person, "A", false);
      expect(tours.length).toBeLessThanOrEqual(6);
      tours.forEach(tour => {
        expect(tour.origin_taz).toBe("A");
        expect(tour.person_id).toBe(person.id);
      });
      if (tours.some(t => t.tour_purpose === "work")) persons_with_work_tour++;
      all_tours.push(...tours);
    }

    const work_share = persons_with_work_tour / n;
    expect(work_share).toBeGreaterThan(0.88);
    expect(work_share).toBeLessThanOrEqual(1);

    const stats = getTourStatistics(all_tours);
    expect(stats.total_tours).toBe(all_tours.length);
    expect(stats.by_purpose.work).toBe(
      all_tours.filter(t => t.tour_purpose === "work").length
    );
    expect(stats.avg_tours_per_person).toBeGreaterThan(0);
    expect(stats.avg_tours_per_person).toBeLessThanOrEqual(getMaxToursPerDay() + 1);
  });

  it("never generates work tours on weekends", () => {
    for (let i = 0; i < 100; i++) {
      const tours = generateToursForPerson(makePerson(`p${i}`), "A", true);
      expect(tours.every(t => t.tour_purpose !== "work")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Destination choice
// ---------------------------------------------------------------------------

describe("sketch-abm destination choice", () => {
  function makeDestInputs(): DestinationChoiceInputs {
    const origin = makeZone("O", {
      total_employment: 200,
      retail_employment: 50,
      service_employment: 50,
      office_employment: 20,
      total_households: 800,
      population: 2000,
      area_sq_km: 5,
    });
    // D1 and D2 are identical except for retail employment (the shopping
    // size term), so probability ratio must follow the size-term ratio.
    const big_retail = makeZone("D1", {
      total_employment: 2000,
      retail_employment: 1000,
      service_employment: 500,
      office_employment: 200,
      total_households: 300,
      population: 900,
    });
    const small_retail = makeZone("D2", {
      total_employment: 2000,
      retail_employment: 100,
      service_employment: 500,
      office_employment: 200,
      total_households: 300,
      population: 900,
    });

    return {
      tour: makeTour("shopping", { origin_taz: "O" }),
      origin_zone: origin,
      destination_zones: [origin, big_retail, small_retail],
      person_age: 40,
      person_income: 60000,
      household_autos: 1,
      household_size: 2,
      skims: {
        O: makeSkim({ auto_time: 4, auto_dist: 1, walk_time: 10, bike_time: 4 }),
        D1: makeSkim(),
        D2: makeSkim(),
      },
    };
  }

  it("returns probabilities that sum to 1 with all values in [0, 1]", () => {
    const inputs = makeDestInputs();
    const { chosen_zone, probabilities } = chooseDestination(inputs);

    const values = Object.values(probabilities);
    expect(values).toHaveLength(3);
    expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    values.forEach(p => {
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    });
    expect(inputs.destination_zones.map(z => z.id)).toContain(chosen_zone.id);
  });

  it("respects size terms: bigger retail zone wins for shopping, in exact size-term ratio", () => {
    const inputs = makeDestInputs();
    const { probabilities } = chooseDestination(inputs);

    expect(probabilities.D1).toBeGreaterThan(probabilities.D2);
    // Shopping size term = 1.2*retail + 0.3*service:
    // D1 = 1.2*1000 + 0.3*500 = 1350; D2 = 1.2*100 + 0.3*500 = 270.
    // Everything else identical -> probability ratio = 1350/270 = 5.
    expect(probabilities.D1 / probabilities.D2).toBeCloseTo(5, 6);

    const top = getTopDestinations(inputs, 2);
    expect(top[0].zone.id).toBe("D1");
    expect(top[0].probability).toBeGreaterThanOrEqual(top[1].probability);
  });

  it("computes a positive, size-weighted accessibility measure", () => {
    const inputs = makeDestInputs();
    const access = calculateAccessibility(
      inputs.origin_zone,
      inputs.destination_zones,
      "shopping",
      inputs.skims
    );
    expect(Number.isFinite(access)).toBe(true);
    expect(access).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Mode choice — including the income-cost interaction regression test
// ---------------------------------------------------------------------------

describe("sketch-abm mode choice", () => {
  it("regression: fixed income-cost interaction keeps the MNL non-degenerate across incomes", () => {
    const incomes = [20000, 60000, 150000];
    const results = incomes.map(income => chooseTourMode(makeModeInputs(income)).probabilities);

    results.forEach(probabilities => {
      const values = Object.values(probabilities);
      // Fixture makes auto_sov, auto_hov2, transit_walk, transit_drive,
      // walk, bike, and taxi_tnc all available.
      expect(values.length).toBeGreaterThanOrEqual(5);

      expect(values.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      values.forEach(p => {
        expect(p).toBeGreaterThan(0);
        // The upstream bug collapsed the softmax onto a single mode; the
        // fixed interaction must keep every mode below 0.99 on this fixture.
        expect(p).toBeLessThan(0.99);
      });
    });

    // Directional sanity: higher income means less cost sensitivity, so the
    // probability of costly modes must rise with income — and MATERIALLY so.
    // Non-strict assertions would also pass with the interaction deleted
    // outright (identical probabilities at every income), so the high-low
    // deltas are asserted against a visible floor: the income relief on this
    // fixture returns ~4% of the cost penalty at $20k vs ~30% at $150k,
    // which must move auto_sov by well over half a percentage point.
    const [low, mid, high] = results;
    const costly_modes = ["auto_sov", "taxi_tnc"] as const;
    costly_modes.forEach(mode => {
      expect(mid[mode]!).toBeGreaterThan(low[mode]!);
      expect(high[mode]!).toBeGreaterThan(mid[mode]!);
    });
    expect(high.auto_sov! - low.auto_sov!).toBeGreaterThan(0.005);

    // Zero-monetary-cost modes must cede share as costly modes recover it.
    expect(high.walk!).toBeLessThan(low.walk!);
    expect(high.bike!).toBeLessThan(low.bike!);
  });

  it("chooses only from available modes and reports finite logsums", () => {
    const inputs = makeModeInputs(60000);
    const { chosen_mode, probabilities } = chooseTourMode(inputs);
    expect(Object.keys(probabilities)).toContain(chosen_mode);

    const logsum = calculateLogsum(inputs);
    expect(Number.isFinite(logsum)).toBe(true);
  });

  it("aggregates detailed modes into reporting categories", () => {
    expect(aggregateMode("auto_sov")).toBe("auto");
    expect(aggregateMode("auto_hov3")).toBe("auto");
    expect(aggregateMode("transit_walk")).toBe("transit");
    expect(aggregateMode("school_bus")).toBe("transit");
    expect(aggregateMode("walk")).toBe("walk");
    expect(aggregateMode("bike")).toBe("bike");
    expect(aggregateMode("taxi_tnc")).toBe("shared");
  });
});

// ---------------------------------------------------------------------------
// Time-of-day choice
// ---------------------------------------------------------------------------

describe("sketch-abm time-of-day choice", () => {
  const VALID_PERIODS: TimePeriod[] = [
    "early_am",
    "am_peak",
    "midday",
    "pm_peak",
    "evening",
    "late_night",
  ];

  function makeTimeInputs(purpose: TourPurpose, overrides: Partial<TimeChoiceInputs> = {}): TimeChoiceInputs {
    return {
      tour: makeTour(purpose),
      person_age: 40,
      is_worker: true,
      is_student: false,
      travel_time: 20,
      household_has_preschool_children: false,
      num_mandatory_tours: 1,
      ...overrides,
    };
  }

  it("produces a valid work-tour time distribution", () => {
    const samples = Array.from({ length: 200 }, () => chooseTimeOfDay(makeTimeInputs("work")));

    let arrival_sum = 0;
    samples.forEach(tc => {
      expect(tc.arrival_time).toBeGreaterThan(tc.departure_time);
      expect(tc.departure_time).toBeGreaterThanOrEqual(5 * 60); // Work earliest departure
      expect(tc.duration_at_dest).toBeGreaterThanOrEqual(15);
      expect(VALID_PERIODS).toContain(tc.departure_period);
      expect(VALID_PERIODS).toContain(tc.arrival_period);
      // Internal consistency (each field rounded independently)
      expect(
        Math.abs(tc.total_tour_duration - (tc.arrival_time - tc.departure_time + tc.duration_at_dest))
      ).toBeLessThanOrEqual(2);
      arrival_sum += tc.arrival_time;
    });

    const mean_arrival = arrival_sum / samples.length;
    expect(mean_arrival).toBeGreaterThan(7 * 60);
    expect(mean_arrival).toBeLessThan(10.5 * 60);
  });

  it("schedules multiple tours without overlaps", () => {
    const work = makeTour("work", { id: "t-work" });
    const social = makeTour("social", { id: "t-social" });
    const inputs = [makeTimeInputs("work"), makeTimeInputs("social", { tour: social })];

    for (let i = 0; i < 50; i++) {
      const scheduled = scheduleTours([work, social], inputs);
      expect(scheduled).toHaveLength(2);
      const work_end = scheduled[0].arrival_time + scheduled[0].duration_at_dest;
      expect(scheduled[1].departure_time).toBeGreaterThanOrEqual(work_end);
    }
  });

  it("throws when tours and inputs arrays are mismatched", () => {
    expect(() => scheduleTours([makeTour("work")], [])).toThrow();
  });

  it("maps minutes to periods and formats times", () => {
    expect(getTimePeriod(6 * 60)).toBe("am_peak");
    expect(getTimePeriod(12 * 60)).toBe("midday");
    expect(getTimePeriod(17 * 60)).toBe("pm_peak");
    expect(getTimePeriod(2 * 60)).toBe("late_night");
    expect(formatTime(510)).toBe("08:30");
    expect(formatTime(0)).toBe("00:00");
  });
});

// ---------------------------------------------------------------------------
// End-to-end runner on a tiny synthetic 3-zone fixture
// ---------------------------------------------------------------------------

describe("sketch-abm runner", () => {
  function makeRunnerFixture(): ABMInputs {
    const zones: Zone[] = [
      makeZone("A", {
        total_employment: 300,
        retail_employment: 50,
        service_employment: 100,
        office_employment: 50,
        industrial_employment: 50,
        total_households: 1200,
        population: 3000,
        area_sq_km: 6,
      }),
      makeZone("B", {
        total_employment: 8000,
        retail_employment: 1200,
        service_employment: 3000,
        office_employment: 3200,
        industrial_employment: 600,
        total_households: 400,
        population: 900,
        area_sq_km: 3,
      }),
      makeZone("C", {
        total_employment: 1500,
        retail_employment: 700,
        service_employment: 500,
        office_employment: 200,
        industrial_employment: 100,
        total_households: 600,
        population: 1500,
        area_sq_km: 5,
      }),
    ];

    const pair = (auto_time: number, auto_dist: number): SkimRow =>
      makeSkim({
        auto_time,
        auto_dist,
        auto_cost: auto_dist * 0.4,
        transit_ivtt: auto_time * 1.4,
        walk_time: auto_dist * 12,
        bike_time: auto_dist * 4,
      });

    const skims: ABMInputs["skims"] = {
      A: { A: pair(4, 1), B: pair(18, 8), C: pair(12, 5) },
      B: { A: pair(18, 8), B: pair(4, 1), C: pair(14, 6) },
      C: { A: pair(12, 5), B: pair(14, 6), C: pair(4, 1) },
    };

    const households: Household[] = Array.from({ length: 12 }, (_, i) => ({
      id: `hh-${i}`,
      home_taz_id: "A",
      persons: [
        makePerson(`hh${i}-p1`, { household_id: `hh-${i}`, age: 38 }),
        i % 3 === 0
          ? makePerson(`hh${i}-p2`, {
              household_id: `hh-${i}`,
              age: 15,
              worker: false,
              student: true,
            })
          : makePerson(`hh${i}-p2`, { household_id: `hh-${i}`, age: 45, worker: false }),
      ],
      income: 30000 + i * 10000,
      vehicles: 1 + (i % 2),
      building_type: "single_family" as const,
    }));

    return { households, zones, skims };
  }

  it("produces a coherent end-to-end result", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    const inputs = makeRunnerFixture();
    const zone_ids = new Set(inputs.zones.map(z => z.id));
    const out = await runABM(inputs);

    // Volume coherence
    expect(out.tours.length).toBeGreaterThan(0);
    expect(out.trips.length).toBe(2 * out.tours.length);
    expect(out.summary.total_tours).toBe(out.tours.length);
    expect(out.summary.total_trips).toBe(out.trips.length);
    expect(out.summary.total_households).toBe(12);
    expect(out.summary.total_persons).toBe(24);
    expect(out.summary.tour_statistics.total_tours).toBe(out.tours.length);
    expect(out.summary.avg_trips_per_person).toBeCloseTo(out.trips.length / 24, 9);
    expect(out.summary.avg_trip_length_km).toBeGreaterThan(0);

    // Trip legs pair up
    expect(out.trips.filter(t => t.is_outbound).length).toBe(out.tours.length);
    expect(out.trips.filter(t => !t.is_outbound).length).toBe(out.tours.length);

    // Every trip references real zones and moves forward in time
    out.trips.forEach(trip => {
      expect(zone_ids.has(trip.origin_taz)).toBe(true);
      expect(zone_ids.has(trip.dest_taz)).toBe(true);
      expect(trip.arrival_time).toBeGreaterThanOrEqual(trip.departure_time);
      expect(trip.travel_time).toBeGreaterThan(0);
      expect(trip.distance_km).toBeGreaterThan(0);
      expect(["auto", "transit", "walk", "bike", "shared"]).toContain(trip.mode_agg);
    });

    // Tours carry destination, mode, and schedule
    out.tours.forEach(tour => {
      expect(zone_ids.has(tour.dest_zone)).toBe(true);
      expect(tour.destination_taz).toBe(tour.dest_zone);
      expect(tour.time_choice.arrival_time).toBeGreaterThan(tour.time_choice.departure_time);
    });

    // Mode split is expressed in percentages that sum to 100
    const split_sum = Object.values(out.summary.mode_split).reduce((a, b) => a + b, 0);
    expect(split_sum).toBeCloseTo(100, 6);
  });
});
