/**
 * Shared domain types for the sketch activity-based model.
 *
 * Ported from FreeChAMP (github.com/nfredmond/FreeChAMP, Apache-2.0).
 * Upstream scattered these types across apps/web/src/lib/abm/
 * (tour-generation.ts, destination-choice.ts, mode-choice.ts,
 * time-of-day-choice.ts, abm-runner.ts); they are consolidated here
 * unchanged, except that the skim row shape upstream declared inline in two
 * places is deduplicated into `SkimRow`. The upstream income-cost interaction
 * bug (mode-choice.ts:295) was fixed in this port — see mode-choice.ts.
 *
 * Screening-grade sketch model: outputs are exploratory estimates for
 * comparing scenarios, not authoritative results.
 */

export type TourPurpose =
  | "work"
  | "school"
  | "shopping"
  | "social"
  | "recreation"
  | "dining"
  | "escort"
  | "personal";

export type TourType = "mandatory" | "non_mandatory" | "at_work";

export interface Person {
  id: string;
  household_id: string;
  age: number;
  sex: "M" | "F";
  worker: boolean;
  student: boolean;
  income_category: number; // 1-6
}

export interface Tour {
  id: string;
  person_id: string;
  household_id: string;
  tour_type: TourType;
  tour_purpose: TourPurpose;
  num_stops_outbound: number;
  num_stops_inbound: number;
  origin_taz: string;
  destination_taz?: string; // Set by destination choice
  primary_dest_arrive_time?: number; // Minutes from midnight
  primary_dest_depart_time?: number;
  composition: "alone" | "with_adults" | "with_children" | "with_household";
}

/**
 * Coordinated daily activity pattern (CDAP) assignment for a person.
 */
export interface DailyActivityPattern {
  person_id: string;
  pattern: "Mandatory" | "NonMandatory" | "Home";
}

/**
 * Number of tours by type for a person.
 */
export interface TourFrequency {
  work_tours: number;
  school_tours: number;
  shopping_tours: number;
  other_maintenance_tours: number;
  eating_out_tours: number;
  discretionary_tours: number;
}

export interface TourStatistics {
  total_tours: number;
  by_purpose: Record<TourPurpose, number>;
  by_type: Record<TourType, number>;
  avg_tours_per_person: number;
  avg_stops_per_tour: number;
}

export interface Zone {
  id: string;
  // Size terms (attraction variables)
  total_employment: number;
  retail_employment: number;
  service_employment: number;
  office_employment: number;
  industrial_employment: number;
  total_households: number;
  population: number;
  // Area
  area_sq_km: number;
  // Centroid for distance calculation
  lon: number;
  lat: number;
}

/**
 * Level-of-service attributes for one origin-destination pair.
 * Upstream declared this shape inline in destination-choice.ts and
 * abm-runner.ts; deduplicated here.
 */
export interface SkimRow {
  auto_time: number; // minutes
  auto_dist: number; // km
  auto_cost: number; // dollars (fuel + parking)
  transit_ivtt: number; // in-vehicle travel time
  transit_walk_time: number; // access + egress time
  transit_wait_time: number; // waiting time
  transit_fare: number; // dollars
  walk_time: number; // minutes
  bike_time: number; // minutes
}

/** Skims from one origin to all destinations. */
export type ZoneSkims = {
  [dest_id: string]: SkimRow;
};

export type TravelMode =
  | "auto_sov"
  | "auto_hov2"
  | "auto_hov3"
  | "transit_walk"
  | "transit_drive"
  | "walk"
  | "bike"
  | "taxi_tnc"
  | "school_bus";

export type AggregateMode = "auto" | "transit" | "walk" | "bike" | "shared";

export interface ModeChoiceInputs extends SkimRow {
  tour: Tour;
  person_age: number;
  person_income: number;
  household_autos: number;
  household_size: number;
  origin_taz_id: string;
  dest_taz_id: string;
  // Zone attributes
  dest_density: number; // jobs/hh per sq km
  dest_parking_cost: number; // $/day
}

export interface DestinationChoiceInputs {
  tour: Tour;
  origin_zone: Zone;
  destination_zones: Zone[];
  person_age: number;
  person_income: number;
  household_autos: number;
  household_size: number;
  // Skim matrices (origin to all destinations)
  skims: ZoneSkims;
}

export type TimePeriod =
  | "early_am"
  | "am_peak"
  | "midday"
  | "pm_peak"
  | "evening"
  | "late_night";

export interface TimeChoice {
  departure_time: number; // Minutes from midnight (0-1439)
  arrival_time: number; // Minutes from midnight
  departure_period: TimePeriod;
  arrival_period: TimePeriod;
  duration_at_dest: number; // Minutes
  total_tour_duration: number; // Minutes
}

export interface TimeChoiceInputs {
  tour: Tour;
  person_age: number;
  is_worker: boolean;
  is_student: boolean;
  travel_time: number; // One-way travel time in minutes
  household_has_preschool_children: boolean;
  num_mandatory_tours: number; // For scheduling around mandatory activities
}

export interface Household {
  id: string;
  home_taz_id: string;
  persons: Person[];
  income: number; // Annual income
  vehicles: number;
  building_type: "single_family" | "multi_family" | "mobile_home";
}

export interface Trip {
  trip_id: string;
  person_id: string;
  household_id: string;
  tour_id: string;
  origin_taz: string;
  dest_taz: string;
  purpose: string;
  mode: TravelMode;
  mode_agg: AggregateMode;
  departure_time: number;
  arrival_time: number;
  travel_time: number;
  distance_km: number;
  is_outbound: boolean; // Outbound vs inbound leg
}

export interface ABMInputs {
  households: Household[];
  zones: Zone[];
  // Skim matrices: [origin][destination] -> level-of-service
  skims: {
    [origin_id: string]: ZoneSkims;
  };
}

/** A tour after destination, mode, and time-of-day choice. */
export interface ScheduledTour extends Tour {
  mode: TravelMode;
  time_choice: TimeChoice;
  dest_zone: string;
}

export interface ABMOutputs {
  trips: Trip[];
  tours: ScheduledTour[];
  summary: {
    total_households: number;
    total_persons: number;
    total_tours: number;
    total_trips: number;
    mode_split: Record<string, number>;
    tour_statistics: TourStatistics;
    avg_trip_length_km: number;
    avg_trips_per_person: number;
  };
}
