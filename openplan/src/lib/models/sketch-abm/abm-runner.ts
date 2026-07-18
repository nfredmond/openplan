/**
 * Activity-Based Model Runner
 * Orchestrates the complete ABM simulation pipeline:
 * 1. Population synthesis
 * 2. Tour generation (CDAP + frequency)
 * 3. Destination choice
 * 4. Mode choice
 * 5. Time-of-day choice
 * 6. Trip generation from tours
 * 7. Final trip table assembly
 *
 * Ported from FreeChAMP (github.com/nfredmond/FreeChAMP, Apache-2.0),
 * original path: apps/web/src/lib/abm/abm-runner.ts. Domain math kept
 * verbatim; the upstream income-cost interaction bug was fixed in this port
 * (see mode-choice.ts). Screening-grade sketch model.
 */

import { chooseDestination } from "./destination-choice";
import { aggregateMode, chooseTourMode } from "./mode-choice";
import { scheduleTours } from "./time-of-day-choice";
import {
  applyHouseholdCDAP,
  generateToursForPerson,
  getTourStatistics,
} from "./tour-generation";
import type {
  ABMInputs,
  ABMOutputs,
  DestinationChoiceInputs,
  ScheduledTour,
  TimeChoiceInputs,
  TravelMode,
  Trip,
} from "./types";

export type { ABMInputs, ABMOutputs, Household, ScheduledTour, Trip } from "./types";

/**
 * Run complete Activity-Based Model simulation
 */
export async function runABM(inputs: ABMInputs): Promise<ABMOutputs> {
  console.log("[ABM] Starting simulation...");
  console.log(`[ABM] Households: ${inputs.households.length}, Zones: ${inputs.zones.length}`);

  const all_tours: ScheduledTour[] = [];
  const all_trips: Trip[] = [];

  let trip_id_counter = 0;

  // Process each household
  for (const household of inputs.households) {
    // 1. Apply CDAP (Coordinated Daily Activity Pattern)
    const cdap = applyHouseholdCDAP(household.persons, household.home_taz_id);

    // 2. Generate tours for each person
    for (const person of household.persons) {
      const person_pattern = cdap.find(p => p.person_id === person.id);
      if (!person_pattern || person_pattern.pattern === "Home") {
        continue; // Person stays home
      }

      // Generate tours
      const tours = generateToursForPerson(person, household.home_taz_id, false);

      if (tours.length === 0) continue;

      // Find home zone
      const home_zone = inputs.zones.find(z => z.id === household.home_taz_id);
      if (!home_zone) continue;

      // 3. Destination choice for each tour
      const tours_with_destinations = tours.map(tour => {
        const dest_inputs: DestinationChoiceInputs = {
          tour,
          origin_zone: home_zone,
          destination_zones: inputs.zones,
          person_age: person.age,
          person_income: household.income,
          household_autos: household.vehicles,
          household_size: household.persons.length,
          skims: inputs.skims[household.home_taz_id] || {},
        };

        const { chosen_zone } = chooseDestination(dest_inputs);
        tour.destination_taz = chosen_zone.id;

        return { tour, dest_zone: chosen_zone };
      });

      // 4. Mode choice for each tour
      const tours_with_mode = tours_with_destinations.map(({ tour, dest_zone }) => {
        const skim = inputs.skims[household.home_taz_id]?.[dest_zone.id];

        if (!skim) {
          // Default to auto if no skim available
          return { tour, dest_zone, mode: "auto_sov" as TravelMode };
        }

        const mode_inputs = {
          tour,
          person_age: person.age,
          person_income: household.income,
          household_autos: household.vehicles,
          household_size: household.persons.length,
          origin_taz_id: household.home_taz_id,
          dest_taz_id: dest_zone.id,
          ...skim,
          dest_density: (dest_zone.total_employment + dest_zone.total_households) / Math.max(0.01, dest_zone.area_sq_km),
          dest_parking_cost: dest_zone.total_employment > 5000 ? 10 : 0,
        };

        const { chosen_mode } = chooseTourMode(mode_inputs);

        return { tour, dest_zone, mode: chosen_mode };
      });

      // 5. Time-of-day choice
      const time_inputs: TimeChoiceInputs[] = tours_with_mode.map(({ tour, dest_zone }) => {
        const skim = inputs.skims[household.home_taz_id]?.[dest_zone.id];
        const travel_time = skim?.auto_time || 20; // Default 20 min

        return {
          tour,
          person_age: person.age,
          is_worker: person.worker,
          is_student: person.student,
          travel_time,
          household_has_preschool_children: household.persons.some(p => p.age < 5),
          num_mandatory_tours: tours.filter(t => t.tour_type === "mandatory").length,
        };
      });

      const time_choices = scheduleTours(tours.map((_, i) => tours_with_mode[i].tour), time_inputs);

      // 6. Generate trips from tours
      tours_with_mode.forEach(({ tour, dest_zone, mode }, tour_idx) => {
        const time_choice = time_choices[tour_idx];
        const skim = inputs.skims[household.home_taz_id]?.[dest_zone.id];

        // Store completed tour
        all_tours.push({
          ...tour,
          mode,
          time_choice,
          dest_zone: dest_zone.id,
        });

        // Outbound trip (home -> destination)
        const outbound_trip: Trip = {
          trip_id: `trip-${++trip_id_counter}`,
          person_id: person.id,
          household_id: household.id,
          tour_id: tour.id,
          origin_taz: household.home_taz_id,
          dest_taz: dest_zone.id,
          purpose: tour.tour_purpose,
          mode,
          mode_agg: aggregateMode(mode),
          departure_time: time_choice.departure_time,
          arrival_time: time_choice.arrival_time,
          travel_time: skim?.auto_time || 20,
          distance_km: skim?.auto_dist || 5,
          is_outbound: true,
        };

        all_trips.push(outbound_trip);

        // Inbound trip (destination -> home)
        const return_departure = time_choice.arrival_time + time_choice.duration_at_dest;
        const return_arrival = return_departure + (skim?.auto_time || 20);

        const inbound_trip: Trip = {
          trip_id: `trip-${++trip_id_counter}`,
          person_id: person.id,
          household_id: household.id,
          tour_id: tour.id,
          origin_taz: dest_zone.id,
          dest_taz: household.home_taz_id,
          purpose: tour.tour_purpose,
          mode,
          mode_agg: aggregateMode(mode),
          departure_time: return_departure,
          arrival_time: return_arrival,
          travel_time: skim?.auto_time || 20,
          distance_km: skim?.auto_dist || 5,
          is_outbound: false,
        };

        all_trips.push(inbound_trip);

        // TODO: Add intermediate stops if tour.num_stops_outbound > 0
      });
    }
  }

  // Calculate summary statistics
  const mode_split: Record<string, number> = {
    auto: 0,
    transit: 0,
    walk: 0,
    bike: 0,
    shared: 0,
  };

  all_trips.forEach(trip => {
    mode_split[trip.mode_agg]++;
  });

  const total_trips = all_trips.length;
  Object.keys(mode_split).forEach(mode => {
    mode_split[mode] = total_trips > 0 ? (mode_split[mode] / total_trips) * 100 : 0;
  });

  const total_distance = all_trips.reduce((sum, trip) => sum + trip.distance_km, 0);
  const total_persons = inputs.households.reduce((sum, hh) => sum + hh.persons.length, 0);

  const summary = {
    total_households: inputs.households.length,
    total_persons,
    total_tours: all_tours.length,
    total_trips: all_trips.length,
    mode_split,
    tour_statistics: getTourStatistics(all_tours),
    avg_trip_length_km: total_trips > 0 ? total_distance / total_trips : 0,
    avg_trips_per_person: total_persons > 0 ? total_trips / total_persons : 0,
  };

  console.log("[ABM] Simulation complete!");
  console.log(`[ABM] Generated ${all_tours.length} tours and ${all_trips.length} trips`);
  console.log(`[ABM] Mode split - Auto: ${mode_split.auto.toFixed(1)}%, Transit: ${mode_split.transit.toFixed(1)}%`);

  return {
    trips: all_trips,
    tours: all_tours,
    summary,
  };
}

/**
 * Run ABM for a sample of households (for testing/development)
 */
export async function runABMSample(inputs: ABMInputs, sample_rate: number): Promise<ABMOutputs> {
  const sampled_households = inputs.households.filter(() => Math.random() < sample_rate);

  return runABM({
    ...inputs,
    households: sampled_households,
  });
}

/**
 * Export trip table to CSV format
 */
export function exportTripsToCSV(trips: Trip[]): string {
  const header = [
    "trip_id",
    "person_id",
    "household_id",
    "origin_taz",
    "dest_taz",
    "purpose",
    "mode",
    "departure_time",
    "arrival_time",
    "travel_time",
    "distance_km",
  ].join(",");

  const rows = trips.map(trip =>
    [
      trip.trip_id,
      trip.person_id,
      trip.household_id,
      trip.origin_taz,
      trip.dest_taz,
      trip.purpose,
      trip.mode,
      trip.departure_time,
      trip.arrival_time,
      trip.travel_time,
      trip.distance_km,
    ].join(",")
  );

  return [header, ...rows].join("\n");
}
