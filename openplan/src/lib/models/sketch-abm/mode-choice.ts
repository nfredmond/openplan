/**
 * Mode Choice Model
 * Multinomial/Nested Logit model for tour and trip mode choice
 *
 * Ported from FreeChAMP (github.com/nfredmond/FreeChAMP, Apache-2.0),
 * original path: apps/web/src/lib/abm/mode-choice.ts. Domain math kept
 * verbatim, with one exception: the upstream income-cost interaction bug
 * (mode-choice.ts:295 multiplied the whole accumulated utility by raw
 * income, collapsing the MNL softmax to one mode) was fixed in this port —
 * see the comment at the fix site in calculateUtility(). Screening-grade
 * sketch model.
 */

import type { AggregateMode, ModeChoiceInputs, TourPurpose, TravelMode } from "./types";

export type { AggregateMode, ModeChoiceInputs, TravelMode } from "./types";

interface ModeUtilityCoeffs {
  // Alternative-specific constants
  asc_auto_sov: number;
  asc_auto_hov: number;
  asc_transit: number;
  asc_walk: number;
  asc_bike: number;
  asc_tnc: number;

  // Level-of-service
  coef_ivtt: number; // In-vehicle travel time
  coef_ovtt: number; // Out-of-vehicle travel time (walk, wait)
  coef_cost: number; // Generalized cost

  // Sociodemographic interactions
  coef_auto_ownership: number; // Auto availability effect
  coef_income_cost: number; // Income-cost interaction
  coef_age_walk: number; // Age effect on walking
  coef_age_bike: number; // Age effect on biking

  // Destination attributes
  coef_density_walk: number; // Density effect on walk/bike
  coef_parking_cost: number; // Parking cost effect

  // Nest parameters (for nested logit)
  nest_auto: number; // 0-1, lower = stronger substitution
  nest_nonmotor: number;
}

/**
 * Mode choice coefficients — screening-grade assumptions in the style of
 * SF-CHAMP, MTC, and academic literature
 */
const MODE_COEFFS: Record<TourPurpose, ModeUtilityCoeffs> = {
  work: {
    asc_auto_sov: 0.0, // Base alternative
    asc_auto_hov: -0.8, // HOV less preferred for work
    asc_transit: -0.5, // Transit competitive for work
    asc_walk: -2.5, // Walk less common for work
    asc_bike: -2.0, // Bike moderate for work
    asc_tnc: -3.0, // TNC expensive for daily commute
    coef_ivtt: -0.025, // Value of time ~$15/hr
    coef_ovtt: -0.045, // OVTT weighted 1.8x IVTT
    coef_cost: -0.35, // Cost sensitivity
    coef_auto_ownership: 1.5, // Strong auto availability effect
    coef_income_cost: 0.002, // Higher income less cost-sensitive
    coef_age_walk: -0.015, // Older less likely to walk
    coef_age_bike: -0.020, // Older less likely to bike
    coef_density_walk: 0.0003, // Dense areas encourage walk
    coef_parking_cost: -0.25, // Parking cost deters auto
    nest_auto: 0.7,
    nest_nonmotor: 0.8,
  },
  school: {
    asc_auto_sov: -1.0,
    asc_auto_hov: 0.5, // School often involves HOV (parents)
    asc_transit: -0.3,
    asc_walk: 0.0, // Walk common for school
    asc_bike: 0.2, // Bike popular for school
    asc_tnc: -4.0,
    coef_ivtt: -0.020,
    coef_ovtt: -0.035,
    coef_cost: -0.50, // Students more cost-sensitive
    coef_auto_ownership: 0.8,
    coef_income_cost: 0.001,
    coef_age_walk: 0.005, // Young students more likely to walk
    coef_age_bike: -0.010,
    coef_density_walk: 0.0004,
    coef_parking_cost: -0.10,
    nest_auto: 0.65,
    nest_nonmotor: 0.75,
  },
  shopping: {
    asc_auto_sov: 0.5, // Auto preferred for shopping
    asc_auto_hov: 0.0,
    asc_transit: -1.5,
    asc_walk: -1.0,
    asc_bike: -2.5,
    asc_tnc: -2.0,
    coef_ivtt: -0.022,
    coef_ovtt: -0.040,
    coef_cost: -0.30,
    coef_auto_ownership: 1.8,
    coef_income_cost: 0.0025,
    coef_age_walk: -0.020,
    coef_age_bike: -0.025,
    coef_density_walk: 0.0005,
    coef_parking_cost: -0.15,
    nest_auto: 0.75,
    nest_nonmotor: 0.80,
  },
  social: {
    asc_auto_sov: -0.5,
    asc_auto_hov: 0.5, // Social trips often HOV
    asc_transit: -0.8,
    asc_walk: -0.5,
    asc_bike: -1.5,
    asc_tnc: -1.0, // TNC more common for social
    coef_ivtt: -0.018,
    coef_ovtt: -0.032,
    coef_cost: -0.25, // Less cost-sensitive for social
    coef_auto_ownership: 1.2,
    coef_income_cost: 0.003,
    coef_age_walk: -0.012,
    coef_age_bike: -0.018,
    coef_density_walk: 0.0004,
    coef_parking_cost: -0.18,
    nest_auto: 0.72,
    nest_nonmotor: 0.78,
  },
  recreation: {
    asc_auto_sov: 0.0,
    asc_auto_hov: 0.3,
    asc_transit: -1.0,
    asc_walk: -0.8,
    asc_bike: -0.5, // Bike popular for recreation
    asc_tnc: -1.5,
    coef_ivtt: -0.020,
    coef_ovtt: -0.035,
    coef_cost: -0.28,
    coef_auto_ownership: 1.4,
    coef_income_cost: 0.0028,
    coef_age_walk: -0.015,
    coef_age_bike: -0.015,
    coef_density_walk: 0.0003,
    coef_parking_cost: -0.20,
    nest_auto: 0.73,
    nest_nonmotor: 0.77,
  },
  dining: {
    asc_auto_sov: -0.3,
    asc_auto_hov: 0.2,
    asc_transit: -1.2,
    asc_walk: 0.5, // Walk common for dining
    asc_bike: -1.0,
    asc_tnc: -0.8, // TNC popular for dining out
    coef_ivtt: -0.019,
    coef_ovtt: -0.034,
    coef_cost: -0.22,
    coef_auto_ownership: 1.1,
    coef_income_cost: 0.0035,
    coef_age_walk: -0.010,
    coef_age_bike: -0.020,
    coef_density_walk: 0.0006,
    coef_parking_cost: -0.25,
    nest_auto: 0.74,
    nest_nonmotor: 0.79,
  },
  escort: {
    asc_auto_sov: -2.0, // Escort almost always HOV
    asc_auto_hov: 1.5,
    asc_transit: -3.0,
    asc_walk: -1.5,
    asc_bike: -4.0,
    asc_tnc: -2.5,
    coef_ivtt: -0.023,
    coef_ovtt: -0.042,
    coef_cost: -0.35,
    coef_auto_ownership: 2.0,
    coef_income_cost: 0.002,
    coef_age_walk: -0.018,
    coef_age_bike: -0.030,
    coef_density_walk: 0.0002,
    coef_parking_cost: -0.10,
    nest_auto: 0.68,
    nest_nonmotor: 0.82,
  },
  personal: {
    asc_auto_sov: 0.2,
    asc_auto_hov: -0.3,
    asc_transit: -1.3,
    asc_walk: -0.7,
    asc_bike: -2.0,
    asc_tnc: -1.8,
    coef_ivtt: -0.024,
    coef_ovtt: -0.043,
    coef_cost: -0.32,
    coef_auto_ownership: 1.6,
    coef_income_cost: 0.0022,
    coef_age_walk: -0.017,
    coef_age_bike: -0.024,
    coef_density_walk: 0.0003,
    coef_parking_cost: -0.18,
    nest_auto: 0.71,
    nest_nonmotor: 0.79,
  },
};

/**
 * Calculate utility for a mode alternative
 *
 * Monetary-cost contributions (coef_cost / coef_parking_cost terms) are
 * accumulated separately in `cost_utility` so the income interaction at the
 * bottom can scale the cost term only. The per-term contributions are
 * numerically identical to upstream.
 */
function calculateUtility(mode: TravelMode, inputs: ModeChoiceInputs, coeffs: ModeUtilityCoeffs): number {
  let utility = 0;
  // Monetary-cost portion of utility. Cost coefficients are negative, so
  // this accumulator is <= 0 (a penalty).
  let cost_utility = 0;

  // Alternative-specific constant
  switch (mode) {
    case "auto_sov":
      utility += coeffs.asc_auto_sov;
      utility += coeffs.coef_ivtt * inputs.auto_time;
      cost_utility += coeffs.coef_cost * inputs.auto_cost;
      cost_utility += coeffs.coef_parking_cost * inputs.dest_parking_cost;
      break;

    case "auto_hov2":
    case "auto_hov3":
      utility += coeffs.asc_auto_hov;
      utility += coeffs.coef_ivtt * inputs.auto_time;
      cost_utility += coeffs.coef_cost * (inputs.auto_cost / 2); // Shared cost
      cost_utility += coeffs.coef_parking_cost * (inputs.dest_parking_cost / 2);
      break;

    case "transit_walk":
      utility += coeffs.asc_transit;
      utility += coeffs.coef_ivtt * inputs.transit_ivtt;
      utility += coeffs.coef_ovtt * (inputs.transit_walk_time + inputs.transit_wait_time * 1.5);
      cost_utility += coeffs.coef_cost * inputs.transit_fare;
      break;

    case "walk":
      utility += coeffs.asc_walk;
      utility += coeffs.coef_ovtt * inputs.walk_time;
      utility += coeffs.coef_age_walk * inputs.person_age;
      utility += coeffs.coef_density_walk * inputs.dest_density;
      break;

    case "bike":
      utility += coeffs.asc_bike;
      utility += coeffs.coef_ivtt * inputs.bike_time * 0.6; // Bike time valued less than auto
      utility += coeffs.coef_age_bike * inputs.person_age;
      utility += coeffs.coef_density_walk * inputs.dest_density;
      break;

    case "taxi_tnc":
      utility += coeffs.asc_tnc;
      utility += coeffs.coef_ivtt * inputs.auto_time;
      cost_utility += coeffs.coef_cost * (inputs.auto_cost * 2.5); // TNC more expensive
      utility += coeffs.coef_ovtt * 5; // Wait time for pickup
      break;

    case "transit_drive":
      utility += coeffs.asc_transit - 0.5; // Drive access slightly worse
      utility += coeffs.coef_ivtt * (inputs.transit_ivtt + 5); // Drive access time
      utility += coeffs.coef_ovtt * inputs.transit_wait_time * 1.5;
      cost_utility += coeffs.coef_cost * (inputs.transit_fare + 2); // Parking at station
      break;

    case "school_bus":
      utility += 2.0; // Highly preferred for eligible students
      utility += coeffs.coef_ivtt * inputs.auto_time * 1.2; // School bus slower
      break;
  }

  utility += cost_utility;

  // Auto ownership effect (autos per adult)
  const autos_per_adult = inputs.household_autos / Math.max(1, inputs.household_size);
  if (mode.startsWith("auto")) {
    utility += coeffs.coef_auto_ownership * autos_per_adult;
  } else {
    utility -= coeffs.coef_auto_ownership * autos_per_adult * 0.5; // Less likely to use other modes if auto available
  }

  // Income-cost interaction — BUG FIXED IN PORT.
  // Upstream (FreeChAMP mode-choice.ts:295) read:
  //   utility += coeffs.coef_income_cost * inputs.person_income * utility;
  // person_income is raw dollars and coef_income_cost ~0.001-0.0035, so the
  // whole accumulated utility was multiplied ~100-150x, saturating exp() and
  // collapsing the MNL softmax onto a single mode. The stated intent
  // ("higher income = less cost-sensitive") is an interaction between income
  // and the COST TERM ONLY. `cost_utility` above holds exactly the monetary
  // cost contributions (fare, operating, parking) and is <= 0 because cost
  // coefficients are negative; being less cost-sensitive means adding back a
  // fraction of that penalty as income rises. coef_income_cost is read as the
  // fraction of the cost penalty returned per $1,000 of annual income (e.g.
  // 0.002 -> 12% relief at $60k, 30% at $150k), which keeps the interaction
  // behaviorally visible while staying well below the other utility terms.
  // The relief saturates at 80% so no income level ever flips the cost
  // penalty into a bonus. Screening-grade behavioral assumption, not an
  // estimated elasticity. Modes with no monetary cost (walk, bike,
  // school_bus) are correctly unaffected.
  const incomeCostRelief = Math.min(
    coeffs.coef_income_cost * (inputs.person_income / 1000),
    0.8
  );
  utility += incomeCostRelief * Math.abs(cost_utility);

  return utility;
}

/**
 * Choose mode using multinomial logit
 */
export function chooseTourMode(inputs: ModeChoiceInputs): {
  chosen_mode: TravelMode;
  probabilities: Partial<Record<TravelMode, number>>;
} {
  const coeffs = MODE_COEFFS[inputs.tour.tour_purpose];

  // Available modes based on distance and age
  const available_modes: TravelMode[] = ["auto_sov", "auto_hov2"];

  // Transit available if system exists and distance > 1km
  if (inputs.transit_ivtt > 0 && inputs.auto_dist > 1) {
    available_modes.push("transit_walk");
    if (inputs.auto_dist > 5) {
      available_modes.push("transit_drive");
    }
  }

  // Walk available if < 3km and person not too old
  if (inputs.walk_time < 45 && inputs.person_age < 75) {
    available_modes.push("walk");
  }

  // Bike available if < 8km and age appropriate
  if (inputs.auto_dist < 8 && inputs.person_age >= 12 && inputs.person_age < 70) {
    available_modes.push("bike");
  }

  // TNC always available
  available_modes.push("taxi_tnc");

  // School bus for school tours (children)
  if (inputs.tour.tour_purpose === "school" && inputs.person_age < 18) {
    available_modes.push("school_bus");
  }

  // Calculate utilities
  const utilities: Record<string, number> = {};
  available_modes.forEach(mode => {
    utilities[mode] = calculateUtility(mode, inputs, coeffs);
  });

  // Apply nested logit structure (simplified - full implementation would use log-sum)
  // For now, use simple multinomial logit
  const exp_utilities: Record<string, number> = {};
  let sum_exp = 0;

  available_modes.forEach(mode => {
    exp_utilities[mode] = Math.exp(utilities[mode]);
    sum_exp += exp_utilities[mode];
  });

  // Calculate probabilities
  // Only available modes get entries — Partial keeps consumers honest
  // about missing (unavailable) modes instead of implying every key exists.
  const probabilities: Partial<Record<TravelMode, number>> = {};
  available_modes.forEach(mode => {
    probabilities[mode] = exp_utilities[mode] / sum_exp;
  });

  // Sample mode based on probabilities
  const random = Math.random();
  let cumulative = 0;
  let chosen_mode: TravelMode = "auto_sov";

  for (const mode of available_modes) {
    // Every available mode was just assigned a probability above; ?? 0 keeps
    // the Partial type honest without changing behavior.
    cumulative += probabilities[mode] ?? 0;
    if (random <= cumulative) {
      chosen_mode = mode;
      break;
    }
  }

  return { chosen_mode, probabilities };
}

/**
 * Aggregate mode to simple categories for reporting
 */
export function aggregateMode(mode: TravelMode): AggregateMode {
  if (mode.startsWith("auto")) return "auto";
  if (mode.startsWith("transit")) return "transit";
  if (mode === "walk") return "walk";
  if (mode === "bike") return "bike";
  if (mode === "taxi_tnc") return "shared";
  if (mode === "school_bus") return "transit";
  return "auto";
}

/**
 * Calculate mode choice logsums for accessibility
 * Used in destination choice and other models
 */
export function calculateLogsum(inputs: ModeChoiceInputs): number {
  const coeffs = MODE_COEFFS[inputs.tour.tour_purpose];
  const available_modes: TravelMode[] = ["auto_sov", "auto_hov2", "transit_walk", "walk", "bike"];

  let sum_exp = 0;
  available_modes.forEach(mode => {
    const utility = calculateUtility(mode, inputs, coeffs);
    sum_exp += Math.exp(utility);
  });

  return Math.log(sum_exp);
}
