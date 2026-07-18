/**
 * Tour Generation Model
 * Generates daily activity tours for synthetic persons based on demographics
 * Implements tour-based modeling framework similar to ActivitySim
 *
 * Ported from FreeChAMP (github.com/nfredmond/FreeChAMP, Apache-2.0),
 * original path: apps/web/src/lib/abm/tour-generation.ts. Domain math kept
 * verbatim; the upstream income-cost interaction bug was fixed in this port
 * (see mode-choice.ts). Screening-grade sketch model.
 */

import type {
  DailyActivityPattern,
  Person,
  Tour,
  TourFrequency,
  TourPurpose,
  TourStatistics,
  TourType,
} from "./types";

export type {
  DailyActivityPattern,
  Person,
  Tour,
  TourFrequency,
  TourPurpose,
  TourStatistics,
  TourType,
} from "./types";

interface TourFrequencyParams {
  work: {
    fulltime_worker: number;
    parttime_worker: number;
    retired: number;
  };
  school: {
    preschool: number;
    k12: number;
    college: number;
  };
  shopping: {
    base_prob: number;
    income_factor: number;
    age_factor: number;
  };
  social: {
    base_prob: number;
    weekend_factor: number;
  };
  recreation: {
    base_prob: number;
    age_young_factor: number;
  };
}

/**
 * Tour frequency parameters — screening-grade assumptions informed by NHTS
 * travel patterns
 */
const TOUR_PARAMS: TourFrequencyParams = {
  work: {
    fulltime_worker: 0.95, // 95% of full-time workers make work tour
    parttime_worker: 0.75, // 75% of part-time workers
    retired: 0.05, // 5% of retired make "work" tours (volunteering, etc.)
  },
  school: {
    preschool: 0.80, // 80% of preschool age
    k12: 0.92, // 92% of K-12 students
    college: 0.85, // 85% of college students
  },
  shopping: {
    base_prob: 0.35,
    income_factor: 1.15, // Higher income = more shopping tours
    age_factor: 0.85, // Older adults make slightly fewer shopping tours
  },
  social: {
    base_prob: 0.25,
    weekend_factor: 1.8, // Much higher on weekends
  },
  recreation: {
    base_prob: 0.18,
    age_young_factor: 1.4, // Younger adults make more recreation tours
  },
};

/**
 * Generate tours for a person based on demographics
 */
export function generateToursForPerson(person: Person, home_taz: string, is_weekend: boolean = false): Tour[] {
  const tours: Tour[] = [];
  let tour_id_counter = 0;

  const createTour = (type: TourType, purpose: TourPurpose): Tour => ({
    id: `${person.id}-tour-${++tour_id_counter}`,
    person_id: person.id,
    household_id: person.household_id,
    tour_type: type,
    tour_purpose: purpose,
    num_stops_outbound: 0,
    num_stops_inbound: 0,
    origin_taz: home_taz,
    composition: "alone",
  });

  // 1. MANDATORY TOURS (Work and School)

  // Work tours
  if (person.worker && !is_weekend) {
    const work_prob = person.age >= 65
      ? TOUR_PARAMS.work.retired
      : TOUR_PARAMS.work.fulltime_worker;

    if (Math.random() < work_prob) {
      const work_tour = createTour("mandatory", "work");

      // Some workers make additional at-work subtours
      if (Math.random() < 0.35) { // 35% make at-work subtours
        work_tour.num_stops_outbound = Math.random() < 0.6 ? 1 : 0;
        work_tour.num_stops_inbound = Math.random() < 0.6 ? 1 : 0;
      }

      tours.push(work_tour);
    }
  }

  // School tours
  if (person.student && !is_weekend) {
    let school_prob = TOUR_PARAMS.school.k12;

    if (person.age < 5) {
      school_prob = TOUR_PARAMS.school.preschool;
    } else if (person.age >= 18 && person.age <= 25) {
      school_prob = TOUR_PARAMS.school.college;
    }

    if (Math.random() < school_prob) {
      tours.push(createTour("mandatory", "school"));
    }
  }

  // 2. NON-MANDATORY TOURS

  // Shopping tours
  const shopping_prob = TOUR_PARAMS.shopping.base_prob *
    (person.income_category > 3 ? TOUR_PARAMS.shopping.income_factor : 1.0) *
    (person.age > 65 ? TOUR_PARAMS.shopping.age_factor : 1.0);

  if (Math.random() < shopping_prob) {
    const shopping_tour = createTour("non_mandatory", "shopping");
    // Shopping tours often have multiple stops
    shopping_tour.num_stops_outbound = Math.random() < 0.4 ? 1 : 0;
    shopping_tour.num_stops_inbound = Math.random() < 0.5 ? 1 : 0;
    tours.push(shopping_tour);
  }

  // Social tours
  const social_prob = TOUR_PARAMS.social.base_prob *
    (is_weekend ? TOUR_PARAMS.social.weekend_factor : 1.0);

  if (Math.random() < social_prob) {
    const social_tour = createTour("non_mandatory", "social");
    social_tour.composition = Math.random() < 0.6 ? "with_adults" : "alone";
    tours.push(social_tour);
  }

  // Recreation tours
  const recreation_prob = TOUR_PARAMS.recreation.base_prob *
    (person.age >= 18 && person.age <= 45 ? TOUR_PARAMS.recreation.age_young_factor : 1.0);

  if (Math.random() < recreation_prob) {
    const recreation_tour = createTour("non_mandatory", "recreation");
    tours.push(recreation_tour);
  }

  // Dining tours (eating out)
  if (Math.random() < 0.22) { // 22% make dining tours
    const dining_tour = createTour("non_mandatory", "dining");
    dining_tour.composition = Math.random() < 0.7 ? "with_adults" : "alone";
    tours.push(dining_tour);
  }

  // Personal business tours
  if (Math.random() < 0.15) { // 15% make personal business tours
    tours.push(createTour("non_mandatory", "personal"));
  }

  // Escort tours (for households with children)
  // This would typically be coordinated at household level
  // Simplified here for individual generation

  return tours;
}

/**
 * Generate stop patterns for a tour
 * Determines number and types of intermediate stops
 */
export function generateStopPattern(tour: Tour): {
  outbound_stops: string[];
  inbound_stops: string[];
} {
  const stop_purposes = ["dining", "shopping", "personal", "work-related"];

  const outbound_stops: string[] = [];
  for (let i = 0; i < tour.num_stops_outbound; i++) {
    outbound_stops.push(stop_purposes[Math.floor(Math.random() * stop_purposes.length)]);
  }

  const inbound_stops: string[] = [];
  for (let i = 0; i < tour.num_stops_inbound; i++) {
    inbound_stops.push(stop_purposes[Math.floor(Math.random() * stop_purposes.length)]);
  }

  return { outbound_stops, inbound_stops };
}

/**
 * Constrain tour generation by coordinated daily activity pattern (CDAP)
 * This ensures household members' activities are coordinated
 */
export function applyHouseholdCDAP(persons: Person[], _home_taz: string): DailyActivityPattern[] {
  // Simplified CDAP - in production, use multinomial logit with household interaction terms
  return persons.map(person => {
    let pattern: "Mandatory" | "NonMandatory" | "Home";

    if (person.worker || person.student) {
      pattern = Math.random() < 0.85 ? "Mandatory" : "NonMandatory";
    } else if (person.age < 5) {
      pattern = "Home";
    } else if (person.age > 75) {
      pattern = Math.random() < 0.6 ? "Home" : "NonMandatory";
    } else {
      const rand = Math.random();
      if (rand < 0.20) {
        pattern = "Home";
      } else {
        pattern = "NonMandatory";
      }
    }

    return {
      person_id: person.id,
      pattern,
    };
  });
}

/**
 * Generate tour frequency alternatives
 * Returns number of tours by type for a person
 */
export function generateTourFrequency(person: Person, daily_pattern: DailyActivityPattern): TourFrequency {
  const freq: TourFrequency = {
    work_tours: 0,
    school_tours: 0,
    shopping_tours: 0,
    other_maintenance_tours: 0,
    eating_out_tours: 0,
    discretionary_tours: 0,
  };

  if (daily_pattern.pattern === "Home") {
    return freq; // Stay home
  }

  if (daily_pattern.pattern === "Mandatory") {
    if (person.worker) {
      freq.work_tours = 1;
      // Some probability of work+other tour
      if (Math.random() < 0.25) {
        freq.shopping_tours = Math.random() < 0.6 ? 1 : 0;
        freq.eating_out_tours = Math.random() < 0.4 ? 1 : 0;
      }
    }
    if (person.student) {
      freq.school_tours = 1;
    }
  }

  if (daily_pattern.pattern === "NonMandatory") {
    // Discretionary activity day
    freq.shopping_tours = Math.random() < 0.45 ? 1 : 0;
    freq.other_maintenance_tours = Math.random() < 0.35 ? 1 : 0;
    freq.eating_out_tours = Math.random() < 0.30 ? 1 : 0;
    freq.discretionary_tours = Math.random() < 0.40 ? 1 : 0;
  }

  return freq;
}

/**
 * Calculate maximum tour frequency for sensitivity analysis
 */
export function getMaxToursPerDay(): number {
  return 5; // Most people make 0-3 tours, max of 5 is reasonable
}

/**
 * Get tour generation statistics for a population
 */
export function getTourStatistics(tours: Tour[]): TourStatistics {
  const by_purpose: Record<TourPurpose, number> = {
    work: 0,
    school: 0,
    shopping: 0,
    social: 0,
    recreation: 0,
    dining: 0,
    escort: 0,
    personal: 0,
  };

  const by_type: Record<TourType, number> = {
    mandatory: 0,
    non_mandatory: 0,
    at_work: 0,
  };

  tours.forEach(tour => {
    by_purpose[tour.tour_purpose]++;
    by_type[tour.tour_type]++;
  });

  const total_stops = tours.reduce((sum, t) => sum + t.num_stops_outbound + t.num_stops_inbound, 0);
  const unique_persons = new Set(tours.map(t => t.person_id)).size;

  return {
    total_tours: tours.length,
    by_purpose,
    by_type,
    avg_tours_per_person: unique_persons > 0 ? tours.length / unique_persons : 0,
    avg_stops_per_tour: tours.length > 0 ? total_stops / tours.length : 0,
  };
}
