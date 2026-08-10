/**
 * Pass 8 guards — the sketch-ABM engine core arithmetic is pinned.
 *
 * The 2026-08-10 mutation audit (Pass 8) found the engine's choice-model
 * arithmetic almost entirely unguarded: 16 of 22 mutations survived the whole
 * reachable test surface — flipped coefficient signs, deleted cost terms,
 * broken availability rules, a degenerate Box-Muller, an inverted peak
 * multiplier. The existing sketch-abm tests assert bands and sums-to-one,
 * which a sign flip sails through. These tests pin the numbers.
 *
 * The mode-choice expected values were derived INDEPENDENTLY of the module
 * (hand-computed term by term, cross-checked against a from-scratch
 * reimplementation of the documented spec), not echoed from the code — the
 * term-by-term derivation is in the comments so a reviewer can re-add it.
 * Seeded statistics use withSeededRandom, so they are deterministic.
 */

import { describe, expect, it } from "vitest";

import { runABM } from "@/lib/models/sketch-abm/abm-runner";
import {
  calculateParkingCost,
  chooseDestination,
} from "@/lib/models/sketch-abm/destination-choice";
import { chooseTourMode } from "@/lib/models/sketch-abm/mode-choice";
import { withSeededRandom } from "@/lib/models/sketch-abm/rng";
import {
  chooseTimeOfDay,
  getTimePeriod,
} from "@/lib/models/sketch-abm/time-of-day-choice";
import { generateToursForPerson } from "@/lib/models/sketch-abm/tour-generation";
import type {
  Household,
  ModeChoiceInputs,
  Person,
  SkimRow,
  TimeChoiceInputs,
  Tour,
  Zone,
} from "@/lib/models/sketch-abm/types";

function tour(purpose: Tour["tour_purpose"]): Tour {
  return {
    id: "t1",
    person_id: "p1",
    household_id: "h1",
    tour_type: purpose === "work" || purpose === "school" ? "mandatory" : "non_mandatory",
    tour_purpose: purpose,
    num_stops_outbound: 0,
    num_stops_inbound: 0,
    origin_taz: "a",
    composition: "alone",
  };
}

function zone(id: string, overrides: Partial<Zone> = {}): Zone {
  return {
    id,
    total_employment: 200,
    retail_employment: 40,
    service_employment: 60,
    office_employment: 50,
    industrial_employment: 20,
    total_households: 150,
    population: 400,
    area_sq_km: 5,
    lon: -120,
    lat: 39,
    ...overrides,
  };
}

function skimRow(overrides: Partial<SkimRow> = {}): SkimRow {
  return {
    auto_time: 20,
    auto_dist: 10,
    auto_cost: 3,
    transit_ivtt: 30,
    transit_walk_time: 8,
    transit_wait_time: 6,
    transit_fare: 2.5,
    walk_time: 120,
    bike_time: 40,
    ...overrides,
  };
}

/**
 * Reference work-tour mode-choice input. Age 40, $60k income, 1 auto for a
 * 2-person household (0.5 autos/adult), walk unavailable (120 min >= 45),
 * bike unavailable (10 km >= 8). Available modes: auto_sov, auto_hov2,
 * transit_walk, transit_drive (dist > 5), taxi_tnc.
 */
function referenceWorkInputs(): ModeChoiceInputs {
  return {
    tour: tour("work"),
    person_age: 40,
    person_income: 60000,
    household_autos: 1,
    household_size: 2,
    origin_taz_id: "a",
    dest_taz_id: "b",
    ...skimRow(),
    dest_density: 1000,
    dest_parking_cost: 5,
  };
}

describe("mode choice utilities are pinned", () => {
  it("computes the hand-derived probabilities for the reference work tour", () => {
    // Work coeffs: asc_hov -0.8, asc_transit -0.5, asc_tnc -3.0, ivtt -0.025,
    // ovtt -0.045, cost -0.35, auto_own 1.5, income_cost 0.002, parking -0.25.
    // autos/adult = 0.5; income relief = min(0.002 * 60, 0.8) = 0.12.
    //
    // auto_sov:   0 - 0.025*20 = -0.5; cost = -0.35*3 - 0.25*5 = -2.3
    //             -0.5 - 2.3 + 1.5*0.5 + 0.12*2.3            = -1.774
    // auto_hov2:  -0.8 - 0.5 = -1.3; cost = -0.35*1.5 - 0.25*2.5 = -1.15
    //             -1.3 - 1.15 + 0.75 + 0.12*1.15             = -1.562
    // transit_wk: -0.5 - 0.025*30 - 0.045*(8 + 6*1.5) = -2.015; cost = -0.875
    //             -2.015 - 0.875 - 1.5*0.5*0.5 + 0.12*0.875  = -3.16
    // transit_dr: -1.0 - 0.025*35 - 0.045*9 = -2.28; cost = -0.35*4.5 = -1.575
    //             -2.28 - 1.575 - 0.375 + 0.12*1.575         = -4.041
    // taxi_tnc:   -3.0 - 0.5 - 0.045*5 = -3.725; cost = -0.35*7.5 = -2.625
    //             -3.725 - 2.625 - 0.375 + 0.12*2.625        = -6.41
    // Softmax over those five utilities:
    const { probabilities } = chooseTourMode(referenceWorkInputs());
    expect(probabilities.auto_sov).toBeCloseTo(0.3846833739, 6);
    expect(probabilities.auto_hov2).toBeCloseTo(0.475525539, 6);
    expect(probabilities.transit_walk).toBeCloseTo(0.0961991566, 6);
    expect(probabilities.transit_drive).toBeCloseTo(0.0398618844, 6);
    expect(probabilities.taxi_tnc).toBeCloseTo(0.0037300461, 6);
    expect(probabilities.walk).toBeUndefined();
    expect(probabilities.bike).toBeUndefined();
  });

  it("offers no transit where no transit system exists", () => {
    const noTransit = {
      ...referenceWorkInputs(),
      ...skimRow({ transit_ivtt: 0 }),
    };
    const { probabilities } = chooseTourMode(noTransit);
    expect(probabilities.transit_walk).toBeUndefined();
    expect(probabilities.transit_drive).toBeUndefined();

    const shortTrip = {
      ...referenceWorkInputs(),
      ...skimRow({ auto_dist: 0.8, walk_time: 10, bike_time: 4 }),
    };
    const shortProbabilities = chooseTourMode(shortTrip).probabilities;
    expect(shortProbabilities.transit_walk).toBeUndefined();
    expect(shortProbabilities.transit_drive).toBeUndefined();
  });

  it("saturates the income-cost relief at 80% of the cost penalty", () => {
    // dining coef_income_cost = 0.0035: relief would be 1.05 at $300k and
    // 1.75 at $500k — both must clamp to 0.8, so the probabilities are
    // identical. Without the clamp the two incomes diverge.
    const base = {
      ...referenceWorkInputs(),
      tour: tour("dining"),
      ...skimRow({ auto_dist: 3, walk_time: 30, bike_time: 12 }),
    };
    const at300k = chooseTourMode({ ...base, person_income: 300000 }).probabilities;
    const at500k = chooseTourMode({ ...base, person_income: 500000 }).probabilities;
    expect(at300k).toEqual(at500k);
  });
});

describe("destination choice utilities are pinned", () => {
  it("gives a zone with no skim exactly zero probability", () => {
    const reachable = zone("b");
    const unreachable = zone("c");
    const { probabilities } = chooseDestination({
      tour: tour("work"),
      origin_zone: zone("a"),
      destination_zones: [reachable, unreachable],
      person_age: 40,
      person_income: 60000,
      household_autos: 1,
      household_size: 2,
      skims: { b: skimRow() },
    });
    expect(probabilities.c).toBe(0);
    expect(probabilities.b).toBeCloseTo(1, 10);
  });

  it("applies the intra-zonal bonus as exp(+0.5) for work tours", () => {
    // Twin zones with identical attributes and identical skims: the only
    // utility difference is intra_zonal_const (work: 0.5), so
    // P(home zone) / P(twin) = e^0.5 = 1.6487212707.
    const home = zone("a");
    const twin = zone("b");
    const { probabilities } = chooseDestination({
      tour: tour("work"),
      origin_zone: home,
      destination_zones: [home, twin],
      person_age: 40,
      person_income: 60000,
      household_autos: 1,
      household_size: 2,
      skims: { a: skimRow(), b: skimRow() },
    });
    expect((probabilities.a ?? 0) / (probabilities.b ?? 0)).toBeCloseTo(1.6487212707, 6);
  });

  it("applies work distance decay as exp(-0.08 per km), nearer wins", () => {
    // Twin destinations whose skims differ ONLY in auto_dist (2 km vs 4 km).
    // auto_dist does not enter the mode utilities or the logsum, so the only
    // utility difference is coef_distance * Δdist = -0.08 * (2 - 4) = +0.16
    // for the nearer zone: P(near) / P(far) = e^0.16 = 1.1735108709.
    const near = zone("b");
    const far = zone("c");
    const { probabilities } = chooseDestination({
      tour: tour("work"),
      origin_zone: zone("a"),
      destination_zones: [near, far],
      person_age: 40,
      person_income: 60000,
      household_autos: 1,
      household_size: 2,
      skims: {
        b: skimRow({ auto_dist: 2 }),
        c: skimRow({ auto_dist: 4 }),
      },
    });
    expect((probabilities.b ?? 0) / (probabilities.c ?? 0)).toBeCloseTo(1.1735108709, 6);
  });

  it("prices parking by the density bands 15/8/3/0 — one model for the pipeline", () => {
    // calculateParkingCost is the ONE parking-cost model for the sketch
    // pipeline. abm-runner previously carried a divergent inline copy
    // (total_employment > 5000 ? 10 : 0), so mode choice and destination
    // choice saw different parking costs for the same zone.
    const dense = (density: number) =>
      zone("z", { area_sq_km: 1, total_employment: density, total_households: 0 });
    expect(calculateParkingCost(dense(20000))).toBe(15);
    expect(calculateParkingCost(dense(6000))).toBe(8);
    expect(calculateParkingCost(dense(3000))).toBe(3);
    expect(calculateParkingCost(dense(100))).toBe(0);
  });
});

describe("tour generation rates are pinned (seeded)", () => {
  const personBase: Person = {
    id: "p1",
    household_id: "h1",
    age: 40,
    sex: "F",
    worker: false,
    student: false,
    income_category: 5,
  };

  function countPurposes(person: Person, seed: number): Record<string, number> {
    return withSeededRandom(seed, () => {
      const counts: Record<string, number> = {};
      for (let i = 0; i < 2000; i++) {
        for (const t of generateToursForPerson(person, "a", false)) {
          counts[t.tour_purpose] = (counts[t.tour_purpose] ?? 0) + 1;
        }
      }
      return counts;
    });
  }

  it("applies the shopping income factor and the base rates (seeded exact counts)", () => {
    // 2000 seeded person-days. Expected shopping draws: base 0.35 x income
    // factor 1.15 = 0.4025 for income category 5 -> ~805 (827 with this
    // seed); base 0.35 for category 2 -> ~700 (744 with this seed). Dining
    // is a flat 0.22 -> ~440 (435 with this seed). Exact counts are
    // deterministic under withSeededRandom; any rate or factor change moves
    // them far outside float noise.
    const high = countPurposes(personBase, 4242);
    expect(high.shopping).toBe(827);
    expect(high.dining).toBe(435);
    expect(high.personal).toBe(292);

    const low = countPurposes({ ...personBase, income_category: 2 }, 4242);
    expect(low.shopping).toBe(744);
  });
});

describe("time-of-day choice is pinned (seeded)", () => {
  it("labels the periods correctly across the day", () => {
    expect(getTimePeriod(2 * 60)).toBe("late_night");
    expect(getTimePeriod(5 * 60)).toBe("early_am");
    expect(getTimePeriod(6 * 60)).toBe("am_peak");
    expect(getTimePeriod(7.5 * 60)).toBe("am_peak");
    expect(getTimePeriod(8 * 60 + 59)).toBe("am_peak");
    expect(getTimePeriod(12 * 60)).toBe("midday");
    expect(getTimePeriod(16 * 60)).toBe("pm_peak");
    expect(getTimePeriod(20 * 60)).toBe("evening");
    expect(getTimePeriod(23.5 * 60)).toBe("late_night");
  });

  function workDraws(): { departures: number[]; peakDiffs: number[] } {
    const inputs: TimeChoiceInputs = {
      tour: tour("work"),
      person_age: 40,
      is_worker: true,
      is_student: false,
      travel_time: 30,
      household_has_preschool_children: false,
      num_mandatory_tours: 1,
    };
    return withSeededRandom(777, () => {
      const departures: number[] = [];
      const peakDiffs: number[] = [];
      for (let i = 0; i < 500; i++) {
        const choice = chooseTimeOfDay(inputs);
        departures.push(choice.departure_time);
        if (choice.departure_period === "am_peak" || choice.departure_period === "pm_peak") {
          peakDiffs.push(choice.arrival_time - choice.departure_time);
        }
      }
      return { departures, peakDiffs };
    });
  }

  it("departs before the preferred arrival, by about the travel time (seeded)", () => {
    // Preferred work arrival is 8:30 (510); with 30 min of travel the mean
    // departure over 500 seeded draws is ~8:00 (479.1 with this seed).
    // Adding the travel time instead of subtracting it pushes the mean past
    // 9:00.
    const { departures } = workDraws();
    const mean = departures.reduce((s, d) => s + d, 0) / departures.length;
    expect(mean).toBeGreaterThan(455);
    expect(mean).toBeLessThan(505);
  });

  it("stretches peak-departure travel by exactly the 1.4 congestion multiplier (seeded)", () => {
    // Whenever the chosen departure falls in am_peak or pm_peak, the arrival
    // is recomputed with the 1.4 multiplier: 30 min of travel becomes exactly
    // 42. With this seed 341 of 500 draws depart in a peak, every one 42.
    const { peakDiffs } = workDraws();
    expect(peakDiffs.length).toBeGreaterThan(250);
    for (const diff of peakDiffs) {
      expect(diff).toBe(42);
    }
  });

  function shoppingArrivals(): number[] {
    const inputs: TimeChoiceInputs = {
      tour: tour("shopping"),
      person_age: 40,
      is_worker: false,
      is_student: false,
      travel_time: 20,
      household_has_preschool_children: false,
      num_mandatory_tours: 0,
    };
    return withSeededRandom(888, () => {
      const arrivals: number[] = [];
      for (let i = 0; i < 500; i++) {
        arrivals.push(chooseTimeOfDay(inputs).arrival_time);
      }
      return arrivals;
    });
  }

  it("samples arrivals from a real normal — the tail beyond 1.5 sigma exists (seeded)", () => {
    // Shopping arrivals are N(840, 180) clamped to [560, ...]. A true normal
    // puts ~6% of draws at or below the 560 clamp (z <= -1.56): 29 of 500
    // with this seed. A degenerate Box-Muller (e.g. dropping the sqrt(-2 ln u)
    // radius) has no mass beyond one sigma and can never reach 560.
    const arrivals = shoppingArrivals();
    const lowTail = arrivals.filter((a) => a <= 560).length;
    expect(lowTail).toBeGreaterThanOrEqual(10);

    const mean = arrivals.reduce((s, a) => s + a, 0) / arrivals.length;
    expect(mean).toBeGreaterThan(820);
    expect(mean).toBeLessThan(890);
  });
});

describe("the runner's trip arithmetic is pinned (seeded)", () => {
  it("reports avg trip length in km straight from the skim distance", () => {
    const zones = [zone("a"), zone("b")];
    const row = skimRow({ auto_dist: 10, auto_time: 20, transit_ivtt: 0 });
    const household: Household = {
      id: "h1",
      home_taz_id: "a",
      persons: [
        { id: "p1", household_id: "h1", age: 40, sex: "F", worker: true, student: false, income_category: 3 },
        { id: "p2", household_id: "h1", age: 42, sex: "M", worker: true, student: false, income_category: 3 },
      ],
      income: 60000,
      vehicles: 2,
      building_type: "single_family",
    };
    return runABM(
      { households: [household], zones, skims: { a: { a: row, b: row } } },
      { seed: 1234 }
    ).then((out) => {
      expect(out.summary.total_trips).toBeGreaterThan(0);
      // Every skim row says 10 km, so every trip is 10 km and the average
      // must be exactly 10 — not the 20-minute travel time.
      expect(out.summary.avg_trip_length_km).toBeCloseTo(10, 10);
      for (const trip of out.trips) {
        expect(trip.distance_km).toBe(10);
      }
    });
  });
});
