/**
 * Destination Choice Model
 * Size term + accessibility logsum model for choosing activity locations
 * Implements gravity-based and logsum-based approaches
 *
 * Ported from FreeChAMP (github.com/nfredmond/FreeChAMP, Apache-2.0),
 * original path: apps/web/src/lib/abm/destination-choice.ts. Domain math
 * kept verbatim; the upstream income-cost interaction bug was fixed in this
 * port (see mode-choice.ts). Screening-grade sketch model.
 */

import { calculateLogsum } from "./mode-choice";
import type {
  DestinationChoiceInputs,
  ModeChoiceInputs,
  Tour,
  TourPurpose,
  Zone,
} from "./types";

export type { DestinationChoiceInputs, Zone } from "./types";

interface DestChoiceCoeffs {
  // Size term coefficients (attraction)
  coef_employment: number;
  coef_retail_emp: number;
  coef_service_emp: number;
  coef_office_emp: number;
  coef_households: number;
  coef_population: number;

  // Impedance (typically negative)
  coef_distance: number; // Distance decay
  coef_logsum: number; // Mode choice logsum (accessibility)

  // Purpose-level adjustment constant
  calibration_const: number;

  // Intra-zonal constant
  intra_zonal_const: number;
}

/**
 * Destination choice coefficients by tour purpose — screening-grade
 * assumptions intended to be directionally consistent with observed travel
 * patterns
 */
const DEST_COEFFS: Record<TourPurpose, DestChoiceCoeffs> = {
  work: {
    coef_employment: 1.0, // Total jobs attract work tours
    coef_retail_emp: 0.0,
    coef_service_emp: 0.0,
    coef_office_emp: 0.3, // Office jobs more attractive
    coef_households: 0.0,
    coef_population: 0.0,
    coef_distance: -0.08, // Strong distance decay for work
    coef_logsum: 0.5, // Accessibility matters
    calibration_const: 0.0,
    intra_zonal_const: 0.5, // Some work in home zone
  },
  school: {
    coef_employment: 0.0,
    coef_retail_emp: 0.0,
    coef_service_emp: 0.5, // Schools are service sector
    coef_office_emp: 0.0,
    coef_households: 0.1, // Schools near residential
    coef_population: 0.3, // Population proxy for schools
    coef_distance: -0.15, // Strong distance decay (local schools)
    coef_logsum: 0.3,
    calibration_const: 0.0,
    intra_zonal_const: 0.8, // Many attend school in neighborhood
  },
  shopping: {
    coef_employment: 0.0,
    coef_retail_emp: 1.2, // Retail jobs = stores
    coef_service_emp: 0.3,
    coef_office_emp: 0.0,
    coef_households: 0.0,
    coef_population: 0.0,
    coef_distance: -0.05, // Moderate distance decay
    coef_logsum: 0.6, // Mode accessibility important
    calibration_const: 0.0,
    intra_zonal_const: 0.3,
  },
  social: {
    coef_employment: 0.0,
    coef_retail_emp: 0.2,
    coef_service_emp: 0.4, // Restaurants, entertainment
    coef_office_emp: 0.0,
    coef_households: 0.8, // Visiting friends/family
    coef_population: 0.6,
    coef_distance: -0.04, // Weaker distance decay
    coef_logsum: 0.4,
    calibration_const: 0.0,
    intra_zonal_const: 0.4,
  },
  recreation: {
    coef_employment: 0.0,
    coef_retail_emp: 0.3,
    coef_service_emp: 0.7, // Recreation facilities
    coef_office_emp: 0.0,
    coef_households: 0.0,
    coef_population: 0.2,
    coef_distance: -0.03, // Weak distance decay (willing to travel)
    coef_logsum: 0.5,
    calibration_const: 0.0,
    intra_zonal_const: 0.1,
  },
  dining: {
    coef_employment: 0.0,
    coef_retail_emp: 0.8,
    coef_service_emp: 1.0, // Restaurants are service
    coef_office_emp: 0.0,
    coef_households: 0.0,
    coef_population: 0.3,
    coef_distance: -0.06,
    coef_logsum: 0.5,
    calibration_const: 0.0,
    intra_zonal_const: 0.2,
  },
  escort: {
    coef_employment: 0.0,
    coef_retail_emp: 0.0,
    coef_service_emp: 0.6, // Schools, daycare
    coef_office_emp: 0.0,
    coef_households: 0.4,
    coef_population: 0.5,
    coef_distance: -0.12, // Strong distance decay (local)
    coef_logsum: 0.3,
    calibration_const: 0.0,
    intra_zonal_const: 0.6,
  },
  personal: {
    coef_employment: 0.0,
    coef_retail_emp: 0.5,
    coef_service_emp: 0.8, // Banks, medical, etc.
    coef_office_emp: 0.3,
    coef_households: 0.0,
    coef_population: 0.0,
    coef_distance: -0.07,
    coef_logsum: 0.4,
    calibration_const: 0.0,
    intra_zonal_const: 0.3,
  },
};

/**
 * Calculate size term (attractiveness) of a zone for a purpose
 */
function calculateSizeTerm(zone: Zone, _purpose: TourPurpose, coeffs: DestChoiceCoeffs): number {
  let size = coeffs.calibration_const;

  size += coeffs.coef_employment * zone.total_employment;
  size += coeffs.coef_retail_emp * zone.retail_employment;
  size += coeffs.coef_service_emp * zone.service_employment;
  size += coeffs.coef_office_emp * zone.office_employment;
  size += coeffs.coef_households * zone.total_households;
  size += coeffs.coef_population * zone.population;

  // Ensure positive size (add small constant to avoid log(0))
  return Math.max(0.01, size);
}

/**
 * Calculate utility of choosing a destination zone
 */
function calculateDestUtility(
  origin: Zone,
  dest: Zone,
  tour: Tour,
  inputs: DestinationChoiceInputs,
  coeffs: DestChoiceCoeffs
): number {
  // Size term (attraction)
  const size_term = calculateSizeTerm(dest, tour.tour_purpose, coeffs);
  let utility = Math.log(size_term);

  // Intra-zonal bonus
  if (origin.id === dest.id) {
    utility += coeffs.intra_zonal_const;
  }

  // Get impedance (travel time, cost)
  const skim = inputs.skims[dest.id];
  if (!skim) {
    return -Infinity; // Zone not reachable
  }

  // Distance decay
  const distance = skim.auto_dist;
  utility += coeffs.coef_distance * distance;

  // Mode choice logsum (accessibility measure)
  // This captures the composite utility of all travel modes to this destination
  const mode_inputs: ModeChoiceInputs = {
    tour,
    person_age: inputs.person_age,
    person_income: inputs.person_income,
    household_autos: inputs.household_autos,
    household_size: inputs.household_size,
    origin_taz_id: origin.id,
    dest_taz_id: dest.id,
    auto_time: skim.auto_time,
    auto_dist: skim.auto_dist,
    auto_cost: skim.auto_cost,
    transit_ivtt: skim.transit_ivtt,
    transit_walk_time: skim.transit_walk_time,
    transit_wait_time: skim.transit_wait_time,
    transit_fare: skim.transit_fare,
    walk_time: skim.walk_time,
    bike_time: skim.bike_time,
    dest_density: (dest.total_employment + dest.total_households) / Math.max(0.01, dest.area_sq_km),
    dest_parking_cost: calculateParkingCost(dest),
  };

  const logsum = calculateLogsum(mode_inputs);
  utility += coeffs.coef_logsum * logsum;

  return utility;
}

/**
 * Estimate parking cost based on zone density
 */
function calculateParkingCost(zone: Zone): number {
  const density = (zone.total_employment + zone.total_households) / Math.max(0.01, zone.area_sq_km);

  if (density > 10000) return 15; // Downtown
  if (density > 5000) return 8; // Urban
  if (density > 2000) return 3; // Suburban
  return 0; // Rural
}

/**
 * Choose destination for a tour
 * Uses multinomial logit with size terms and accessibility logsums
 */
export function chooseDestination(inputs: DestinationChoiceInputs): {
  chosen_zone: Zone;
  probabilities: Record<string, number>;
} {
  const coeffs = DEST_COEFFS[inputs.tour.tour_purpose];
  const utilities: Record<string, number> = {};
  const exp_utilities: Record<string, number> = {};
  let sum_exp = 0;

  // Calculate utilities for all destination zones
  inputs.destination_zones.forEach(zone => {
    const utility = calculateDestUtility(
      inputs.origin_zone,
      zone,
      inputs.tour,
      inputs,
      coeffs
    );

    utilities[zone.id] = utility;

    // For very negative utilities, set exp to 0 to avoid overflow
    if (utility < -50) {
      exp_utilities[zone.id] = 0;
    } else {
      exp_utilities[zone.id] = Math.exp(utility);
      sum_exp += exp_utilities[zone.id];
    }
  });

  // Calculate probabilities
  const probabilities: Record<string, number> = {};
  inputs.destination_zones.forEach(zone => {
    probabilities[zone.id] = sum_exp > 0 ? exp_utilities[zone.id] / sum_exp : 0;
  });

  // Sample destination based on probabilities
  const random = Math.random();
  let cumulative = 0;
  let chosen_zone = inputs.destination_zones[0]; // Default

  for (const zone of inputs.destination_zones) {
    cumulative += probabilities[zone.id];
    if (random <= cumulative) {
      chosen_zone = zone;
      break;
    }
  }

  return { chosen_zone, probabilities };
}

/**
 * Sample destinations with replacement (for Monte Carlo simulation)
 */
export function sampleDestinations(inputs: DestinationChoiceInputs, num_samples: number): Zone[] {
  const samples: Zone[] = [];

  for (let i = 0; i < num_samples; i++) {
    const { chosen_zone } = chooseDestination(inputs);
    samples.push(chosen_zone);
  }

  return samples;
}

/**
 * Calculate accessibility measure for a zone
 * Sum of size terms weighted by impedance
 */
export function calculateAccessibility(
  origin: Zone,
  all_zones: Zone[],
  purpose: TourPurpose,
  skims: DestinationChoiceInputs["skims"]
): number {
  const coeffs = DEST_COEFFS[purpose];
  let accessibility = 0;

  all_zones.forEach(dest => {
    const skim = skims[dest.id];
    if (!skim) return;

    const size = calculateSizeTerm(dest, purpose, coeffs);
    const impedance = Math.exp(coeffs.coef_distance * skim.auto_dist);

    accessibility += size * impedance;
  });

  return accessibility;
}

/**
 * Get top N most probable destinations
 */
export function getTopDestinations(
  inputs: DestinationChoiceInputs,
  top_n: number
): Array<{ zone: Zone; probability: number }> {
  const { probabilities } = chooseDestination(inputs);

  const sorted = inputs.destination_zones
    .map(zone => ({
      zone,
      probability: probabilities[zone.id] || 0,
    }))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, top_n);

  return sorted;
}
