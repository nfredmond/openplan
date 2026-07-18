/**
 * Time-of-Day Choice Model
 * Schedules tour departure and arrival times considering:
 * - Activity duration requirements
 * - Peak/off-peak travel time differences
 * - Household coordination
 * - Work/school start time constraints
 *
 * Ported from FreeChAMP (github.com/nfredmond/FreeChAMP, Apache-2.0),
 * original path: apps/web/src/lib/abm/time-of-day-choice.ts. Domain math
 * kept verbatim; the upstream income-cost interaction bug was fixed in this
 * port (see mode-choice.ts). Screening-grade sketch model.
 */

import type { TimeChoice, TimeChoiceInputs, TimePeriod, Tour, TourPurpose } from "./types";

export type { TimeChoice, TimeChoiceInputs, TimePeriod } from "./types";

interface TimeChoiceParams {
  // Preferred arrival times (mean and std dev)
  preferred_arrival_mean: number;
  preferred_arrival_std: number;

  // Activity duration (mean and std dev)
  activity_duration_mean: number;
  activity_duration_std: number;

  // Earliest and latest feasible times
  earliest_departure: number;
  latest_return: number;

  // Peak aversion coefficient (negative = avoid peak)
  peak_aversion: number;

  // Coordination with other household members
  coordination_bonus: number;
}

/**
 * Time choice parameters by tour purpose
 */
const TIME_PARAMS: Record<TourPurpose, TimeChoiceParams> = {
  work: {
    preferred_arrival_mean: 8.5 * 60, // 8:30 AM
    preferred_arrival_std: 60, // 1 hour std dev
    activity_duration_mean: 8 * 60, // 8 hours
    activity_duration_std: 90, // 1.5 hours std dev
    earliest_departure: 5 * 60, // 5:00 AM
    latest_return: 20 * 60, // 8:00 PM
    peak_aversion: -0.5, // Somewhat avoid peak (but must travel)
    coordination_bonus: 0.8, // Coordinate with household
  },
  school: {
    preferred_arrival_mean: 8.0 * 60, // 8:00 AM
    preferred_arrival_std: 30, // Narrow window
    activity_duration_mean: 6.5 * 60, // 6.5 hours
    activity_duration_std: 60,
    earliest_departure: 6.5 * 60, // 6:30 AM
    latest_return: 17 * 60, // 5:00 PM
    peak_aversion: -0.3,
    coordination_bonus: 1.2, // Strong household coordination
  },
  shopping: {
    preferred_arrival_mean: 14 * 60, // 2:00 PM (afternoon)
    preferred_arrival_std: 180, // Very flexible (3 hours)
    activity_duration_mean: 60, // 1 hour
    activity_duration_std: 45,
    earliest_departure: 9 * 60, // 9:00 AM
    latest_return: 21 * 60, // 9:00 PM
    peak_aversion: -1.2, // Strong peak avoidance
    coordination_bonus: 0.5,
  },
  social: {
    preferred_arrival_mean: 18 * 60, // 6:00 PM (evening)
    preferred_arrival_std: 120,
    activity_duration_mean: 150, // 2.5 hours
    activity_duration_std: 60,
    earliest_departure: 16 * 60, // 4:00 PM
    latest_return: 24 * 60, // Midnight
    peak_aversion: -0.8,
    coordination_bonus: 0.6,
  },
  recreation: {
    preferred_arrival_mean: 13 * 60, // 1:00 PM
    preferred_arrival_std: 150,
    activity_duration_mean: 120, // 2 hours
    activity_duration_std: 60,
    earliest_departure: 9 * 60,
    latest_return: 22 * 60, // 10:00 PM
    peak_aversion: -1.0,
    coordination_bonus: 0.7,
  },
  dining: {
    preferred_arrival_mean: 18.5 * 60, // 6:30 PM (dinner time)
    preferred_arrival_std: 90,
    activity_duration_mean: 90, // 1.5 hours
    activity_duration_std: 30,
    earliest_departure: 11 * 60, // 11:00 AM (lunch)
    latest_return: 22 * 60,
    peak_aversion: -0.7,
    coordination_bonus: 0.9,
  },
  escort: {
    preferred_arrival_mean: 8 * 60, // 8:00 AM (school drop-off)
    preferred_arrival_std: 45,
    activity_duration_mean: 15, // Quick drop-off
    activity_duration_std: 10,
    earliest_departure: 6.5 * 60,
    latest_return: 9 * 60,
    peak_aversion: -0.4,
    coordination_bonus: 1.5, // Very coordinated
  },
  personal: {
    preferred_arrival_mean: 11 * 60, // 11:00 AM
    preferred_arrival_std: 120,
    activity_duration_mean: 60,
    activity_duration_std: 45,
    earliest_departure: 9 * 60,
    latest_return: 18 * 60,
    peak_aversion: -1.1,
    coordination_bonus: 0.4,
  },
};

/**
 * Time period definitions
 */
const TIME_PERIODS: Record<TimePeriod, { start: number; end: number }> = {
  early_am: { start: 3 * 60, end: 6 * 60 }, // 3:00-6:00 AM
  am_peak: { start: 6 * 60, end: 9 * 60 }, // 6:00-9:00 AM
  midday: { start: 9 * 60, end: 15 * 60 }, // 9:00 AM-3:00 PM
  pm_peak: { start: 15 * 60, end: 19 * 60 }, // 3:00-7:00 PM
  evening: { start: 19 * 60, end: 23 * 60 }, // 7:00-11:00 PM
  late_night: { start: 23 * 60, end: 27 * 60 }, // 11:00 PM-3:00 AM (wraps)
};

/**
 * Get time period for a given time
 */
export function getTimePeriod(time_minutes: number): TimePeriod {
  const normalized = time_minutes % (24 * 60);

  for (const [period, range] of Object.entries(TIME_PERIODS)) {
    if (normalized >= range.start && normalized < range.end) {
      return period as TimePeriod;
    }
  }

  return "late_night";
}

/**
 * Sample from normal distribution (Box-Muller transform)
 */
function sampleNormal(mean: number, std: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * std;
}

/**
 * Calculate peak period travel time multiplier
 */
function getPeakMultiplier(time: number, is_auto: boolean = true): number {
  const period = getTimePeriod(time);

  if (!is_auto) return 1.0; // Transit/walk not affected by congestion

  switch (period) {
    case "am_peak":
    case "pm_peak":
      return 1.4; // 40% longer in peak
    case "early_am":
    case "late_night":
      return 0.9; // Slightly faster at night
    default:
      return 1.0;
  }
}

/**
 * Choose departure and arrival times for a tour
 */
export function chooseTimeOfDay(inputs: TimeChoiceInputs): TimeChoice {
  const params = TIME_PARAMS[inputs.tour.tour_purpose];

  // 1. Sample preferred arrival time
  let arrival_time = Math.round(
    sampleNormal(params.preferred_arrival_mean, params.preferred_arrival_std)
  );

  // Constrain to feasible range
  const min_arrival = params.earliest_departure + inputs.travel_time;
  const max_arrival = params.latest_return - inputs.travel_time - params.activity_duration_mean;
  arrival_time = Math.max(min_arrival, Math.min(max_arrival, arrival_time));

  // 2. Sample activity duration
  let duration = Math.round(
    sampleNormal(params.activity_duration_mean, params.activity_duration_std)
  );
  duration = Math.max(15, duration); // At least 15 minutes

  // 3. Calculate departure time
  let departure_time = arrival_time - inputs.travel_time;

  // Apply peak aversion - shift departure to avoid worst congestion
  const departure_period = getTimePeriod(departure_time);
  if ((departure_period === "am_peak" || departure_period === "pm_peak") && params.peak_aversion < 0) {
    // Randomly shift earlier or later by 15-45 minutes
    const shift = (Math.random() < 0.5 ? -1 : 1) * (15 + Math.random() * 30);
    departure_time += shift;
  }

  // Constrain departure time
  departure_time = Math.max(params.earliest_departure, departure_time);

  // Recalculate arrival with congestion
  const peak_multiplier = getPeakMultiplier(departure_time);
  const congested_travel_time = inputs.travel_time * peak_multiplier;
  arrival_time = departure_time + congested_travel_time;

  // 4. Calculate return time
  const return_time = arrival_time + duration;

  // Constrain return time
  const final_return_time = Math.min(params.latest_return, return_time);
  const final_duration = final_return_time - arrival_time;

  const total_tour_duration = final_return_time - departure_time;

  // Determine periods
  const departure_period_final = getTimePeriod(departure_time);
  const arrival_period_final = getTimePeriod(arrival_time);

  return {
    departure_time: Math.round(departure_time),
    arrival_time: Math.round(arrival_time),
    departure_period: departure_period_final,
    arrival_period: arrival_period_final,
    duration_at_dest: Math.round(final_duration),
    total_tour_duration: Math.round(total_tour_duration),
  };
}

/**
 * Schedule multiple tours for a person, considering constraints
 */
export function scheduleTours(tours: Tour[], inputs_per_tour: TimeChoiceInputs[]): TimeChoice[] {
  if (tours.length !== inputs_per_tour.length) {
    throw new Error("Tours and inputs arrays must have same length");
  }

  const scheduled: TimeChoice[] = [];

  // Sort tours: mandatory first, then by preference
  const tour_order = tours
    .map((tour, idx) => ({ tour, inputs: inputs_per_tour[idx], idx }))
    .sort((a, b) => {
      // Mandatory tours first
      if (a.tour.tour_type === "mandatory" && b.tour.tour_type !== "mandatory") return -1;
      if (a.tour.tour_type !== "mandatory" && b.tour.tour_type === "mandatory") return 1;

      // Then by preferred arrival time
      const params_a = TIME_PARAMS[a.tour.tour_purpose];
      const params_b = TIME_PARAMS[b.tour.tour_purpose];
      return params_a.preferred_arrival_mean - params_b.preferred_arrival_mean;
    });

  let last_return_time = 0;

  for (const { inputs, idx } of tour_order) {
    // Schedule tour
    const time_choice = chooseTimeOfDay(inputs);

    // Ensure tours don't overlap
    if (time_choice.departure_time < last_return_time) {
      // Shift departure to after previous tour
      const shift = last_return_time - time_choice.departure_time + 15; // 15 min buffer
      time_choice.departure_time += shift;
      time_choice.arrival_time += shift;
      time_choice.departure_period = getTimePeriod(time_choice.departure_time);
      time_choice.arrival_period = getTimePeriod(time_choice.arrival_time);
    }

    scheduled[idx] = time_choice;
    last_return_time = time_choice.arrival_time + time_choice.duration_at_dest;
  }

  return scheduled;
}

/**
 * Format time as HH:MM string
 */
export function formatTime(minutes: number): string {
  const normalized = minutes % (24 * 60);
  const hours = Math.floor(normalized / 60);
  const mins = Math.round(normalized % 60);
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

/**
 * Get typical departure time for a purpose (for quick estimates)
 */
export function getTypicalDepartureTime(purpose: TourPurpose): number {
  const params = TIME_PARAMS[purpose];
  const typical_arrival = params.preferred_arrival_mean;
  const typical_travel_time = 20; // Assume 20 min average

  return typical_arrival - typical_travel_time;
}

/**
 * Check if tour times are feasible (no conflicts)
 */
export function checkTourFeasibility(scheduled: TimeChoice[]): {
  feasible: boolean;
  conflicts: string[];
} {
  const conflicts: string[] = [];

  for (let i = 0; i < scheduled.length - 1; i++) {
    const tour_i_end = scheduled[i].arrival_time + scheduled[i].duration_at_dest;

    for (let j = i + 1; j < scheduled.length; j++) {
      const tour_j_start = scheduled[j].departure_time;

      if (tour_i_end > tour_j_start) {
        conflicts.push(
          `Tour ${i + 1} ends at ${formatTime(tour_i_end)} but Tour ${j + 1} starts at ${formatTime(tour_j_start)}`
        );
      }
    }
  }

  return {
    feasible: conflicts.length === 0,
    conflicts,
  };
}
