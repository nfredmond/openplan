/**
 * The Ohio adapter's mapping into the neutral crash vocabulary.
 *
 * THE ONLY FILE IN THE MODULE THAT MAY SPELL AN OHIO VALUE, as
 * `ccrs-vocabulary.ts` is for California.
 *
 * PROVENANCE. Field names and every value list below were read on 2026-11-01
 * from ODOT's TIMS Safety services, one MapServer per crash year
 * (`Safety/<year>_Crash_Locations/MapServer/0`, 2021 to 2025), with group-by
 * statistics queries, and from each layer's FGDC metadata
 * (`.../MapServer/0/metadata`). The code and text pairs were identical in the
 * 2021, 2023, 2024 and 2025 services. Counts are the 2024 service, a snapshot
 * kept to show the shape of each field.
 *
 * SEVERITY IS ODOT'S OWN FIVE-LEVEL CRASH SEVERITY. The metadata defines
 * `CRASH_SEVERITY_CD` as "Code indicating the five-level severity of the
 * crash" and `CRASH_SEVERITY_TXT` as its text: Fatal 1,077 · Serious Injury
 * Suspected 6,148 · Minor Injury Suspected 32,822 · Injury Possible 24,445 ·
 * PDO/No Injury 186,599. "Serious Injury Suspected" is the MMUCC suspected
 * serious injury class (KABCO A), so it may say `severe_injury`. The text is
 * mapped, not the code, so a renumbering cannot silently move a class.
 *
 * WHAT THE LAYER DOES NOT CARRY: a crash day of month (only month, day of week
 * and hour), people killed or injured, lighting, weather and person rows. Those
 * stay null or `not_supplied`. Not requested: county, district, route and
 * log-point references, functional class and lane count.
 */

import { type CrashDimensionCapability, type CrashSourceVocabularyDescriptor } from "@/lib/safety/vocabulary";

/** ODOT TIMS crash layer column names, spelled once. */
export const ODOT_OH_CRASH_COLUMNS = {
  objectId: "OBJECTID",
  documentNumber: "DOCUMENT_NBR",
  year: "CRASH_YR",
  severity: "CRASH_SEVERITY_TXT",
  crashType: "CRASH_TYPE_TXT",
} as const;

/** The crash-type texts that put a pedestrian or a pedalcyclist in the crash. */
export const ODOT_OH_PEDESTRIAN_CRASH_TYPE = "PEDESTRIAN";
export const ODOT_OH_PEDALCYCLE_CRASH_TYPE = "PEDALCYCLES";

const SEVERITY_MAP: Readonly<Record<string, string>> = {
  FATAL: "fatal",
  "SERIOUS INJURY SUSPECTED": "severe_injury",
  "MINOR INJURY SUSPECTED": "injury",
  "INJURY POSSIBLE": "injury",
  "PDO/NO INJURY": "pdo",
};

/**
 * ODOT's calculated crash type, "similar to manner of collision but expanded
 * for engineering purposes" (metadata). Probed 2024: Rear End 54,471 · Fixed
 * Object 40,308 · Angle 36,241 · Sideswipe - Passing 35,828 · Animal 21,109 ·
 * Left Turn 15,524 · Parked Vehicle 12,509 · Backing 9,849 · Right Turn 7,901 ·
 * Head On 4,844 · Other Non-Collision 3,564 · Pedestrian 2,696 · Overturning
 * 1,793 · Unknown 1,570 · Pedalcycles 1,335 · Other Object 1,324 · Sideswipe -
 * Meeting 161 · Train 63 · Other Non-Vehicle 1.
 *
 * NOT DECLARED, on purpose: Left Turn, Right Turn, Backing, Parked Vehicle,
 * Animal, Train, Pedalcycles, Other Non-Collision and Other Non-Vehicle. A
 * turning crash can be an angle or a sideswipe; a parked-vehicle or train crash
 * has no one manner. They fall to `other`, keep their text and are counted.
 */
const COLLISION_TYPE_MAP: Readonly<Record<string, string>> = {
  "REAR END": "rear_end",
  "SIDESWIPE - PASSING": "sideswipe",
  "SIDESWIPE - MEETING": "sideswipe",
  "HEAD ON": "head_on",
  ANGLE: "angle",
  "FIXED OBJECT": "hit_object",
  "OTHER OBJECT": "hit_object",
  OVERTURNING: "overturn",
  PEDESTRIAN: "vehicle_pedestrian",
  UNKNOWN: "unknown",
};

/**
 * What the ODOT layer can say.
 *
 * `party_role` is `partial`: a crash typed Pedestrian or Pedalcycles involved
 * one, but a pedestrian or cyclist in a crash of another type is not visible,
 * so these flags are a floor. Motorcyclist involvement is not read.
 */
export const ODOT_OH_DIMENSION_SUPPORT: CrashDimensionCapability = {
  severity: "supplied",
  collision_type: "supplied",
  lighting: "not_supplied",
  weather: "not_supplied",
  party_role: "partial",
  person_injury: "not_supplied",
};

export const ODOT_OH_VOCABULARY: CrashSourceVocabularyDescriptor = {
  sourceId: "odot-oh",
  support: ODOT_OH_DIMENSION_SUPPORT,
  maps: {
    severity: SEVERITY_MAP,
    collision_type: COLLISION_TYPE_MAP,
  },
};
