/**
 * The Oregon adapter's mapping into the neutral crash vocabulary.
 *
 * THE ONLY FILE IN THE MODULE THAT MAY SPELL AN OREGON VALUE, as
 * `ccrs-vocabulary.ts` is for California.
 *
 * PROVENANCE. Field names and every value list below were read on 2026-11-01
 * from ODOT's published crash layer
 * (`OTSDE_Crash/MapServer/0`, "ODOT Crash Data 2019 - 2024", 273,810 rows)
 * with group-by statistics queries. Counts are a snapshot, kept to show the
 * shape of each field, not as figures anything computes from.
 *
 * SEVERITY IS THE SOURCE'S OWN KABCO LETTER, and that is why this adapter may
 * say `severe_injury`. ODOT's "2024 Motor Vehicle Traffic Crash Analysis and
 * Code Manual" (Injury Severity, PARTIC.INJ_SVRTY_CD, pages 185-186) defines
 * Fatal Injury (K), Suspected Serious Injury (A), Suspected Minor Injury (B),
 * Possible Injury (C) and No Apparent Injury (O) in MMUCC terms, and the
 * layer's `KABCO` field carries the most severe letter in the crash. Probed:
 * K 3,045 · A 14,120 · B 60,627 · C 69,475 · O 126,543, no nulls. K equals the
 * layer's "Fatal" crash-severity count and O equals its "Property Damage Only"
 * count, so the letter and ODOT's crash classification agree.
 *
 * WHAT IS DELIBERATELY NOT REQUESTED: the undocumented "present" flags (see
 * `ODOT_OR_DIMENSION_SUPPORT`), driver and participant sex and age
 * columns, licence-validity flags, alcohol, drug and marijuana flags, crash
 * causes and events (fault allegations next to a coordinate), and every
 * free-text road description. The refusals in
 * `src/test/refused-crash-person-fields.test.ts` apply here as to CCRS.
 */

import { type CrashDimensionCapability, type CrashSourceVocabularyDescriptor } from "@/lib/safety/vocabulary";

/** ODOT layer column names, spelled once. */
export const ODOT_OR_CRASH_COLUMNS = {
  objectId: "OBJECTID",
  crashId: "CRASH_ID",
  year: "CRASH_YR_NO",
  month: "CRASH_MO_NO",
  day: "CRASH_DAY_NO",
  kabco: "KABCO",
  fatalCount: "TOT_FATAL_CNT",
  seriousInjuryCount: "TOT_INJ_LVL_A_CNT",
  moderateInjuryCount: "TOT_INJ_LVL_B_CNT",
  minorInjuryCount: "TOT_INJ_LVL_C_CNT",
  pedestrianCount: "TOT_PED_CNT",
  pedalcyclistCount: "TOT_PEDCYCL_CNT",
  collisionType: "COLLIS_TYP_LONG_DESC",
  lighting: "LGT_COND_LONG_DESC",
  weather: "WTHR_COND_LONG_DESC",
  unlocatable: "UNLOCT_FLG",
} as const;

/**
 * Severity: the KABCO letter, as defined by ODOT's code manual (see header).
 * B and C both become `injury`; the neutral vocabulary does not split them.
 */
const SEVERITY_MAP: Readonly<Record<string, string>> = {
  K: "fatal",
  A: "severe_injury",
  B: "injury",
  C: "injury",
  O: "pdo",
};

/**
 * Manner of collision. Probed: Rear-End 80,275 · Turning Movement 59,237 ·
 * Fixed Object or Other Object 51,252 · Angle 27,890 · Sideswipe - Overtaking
 * 20,181 · Miscellaneous 8,583 · Non-collision 6,148 · Sideswipe - Meeting
 * 5,769 · Pedestrian 4,608 · Head-On 4,168 · Backing 3,650 · Parking Maneuver
 * 2,049.
 *
 * NOT DECLARED, on purpose: Turning Movement, Non-collision, Backing and
 * Parking Maneuver. None of them is one neutral manner. A turning-movement
 * crash can be an angle, a sideswipe or a rear-end; a non-collision can be an
 * overturn or a fall from a vehicle. Mapping any of them would be a guess, so
 * they fall to `other`, keep their raw text and are counted as unmapped.
 */
const COLLISION_TYPE_MAP: Readonly<Record<string, string>> = {
  "REAR-END": "rear_end",
  "SIDESWIPE - OVERTAKING": "sideswipe",
  "SIDESWIPE - MEETING": "sideswipe",
  "HEAD-ON": "head_on",
  ANGLE: "angle",
  "FIXED OBJECT OR OTHER OBJECT": "hit_object",
  PEDESTRIAN: "vehicle_pedestrian",
  MISCELLANEOUS: "other",
};

/** Lighting. Probed: six values, no nulls. */
const LIGHTING_MAP: Readonly<Record<string, string>> = {
  DAYLIGHT: "daylight",
  "DAWN (TWILIGHT)": "dawn_dusk",
  "DUSK (TWILIGHT)": "dawn_dusk",
  "DARKNESS - WITH STREET LIGHTS": "dark_lighted",
  "DARKNESS - NO STREET LIGHTS": "dark_unlighted",
  UNKNOWN: "unknown",
};

/**
 * Weather. Probed: Clear 182,841 · Rain 40,360 · Cloudy 29,649 · Unknown 7,906
 * · Snow 6,883 · Fog 4,561 · Sleet 916 · Smoke 608 · Dust 69 · Ash 17.
 * Sleet, Smoke, Dust and Ash are not declared: sleet is not snow, and the
 * others are not weather categories. They fall to `other` with the raw text.
 */
const WEATHER_MAP: Readonly<Record<string, string>> = {
  CLEAR: "clear",
  CLOUDY: "cloudy",
  RAIN: "rain",
  SNOW: "snow",
  FOG: "fog",
  UNKNOWN: "unknown",
};

/**
 * What the ODOT layer can say.
 *
 * `severity` is `supplied`: the source's own KABCO letter separates suspected
 * serious injury. `party_role` is `partial`: pedestrian and pedalcyclist
 * involvement come from ODOT's documented crash-level counts, person rows do
 * not exist, and motorcyclist involvement is not read (see below).
 *
 * THE LAYER'S "PRESENT" FLAGS ARE NOT READ. `Ped_Pres_Flg` and
 * `Bike_Pres_Flg` look like involvement flags and are not: probed 2026-11-01,
 * no crash with `Ped_Pres_Flg = '1'` has a pedestrian participant
 * (`TOT_PED_CNT > 0`: 4,824 crashes; flag set: 2,960; both: 0), and the same
 * holds for pedalcyclists (3,225; 247; 0). The code manual documents the
 * counts ("Crash Level Summary Fields") and not the flags, so the counts are
 * used. `MTCL_Flg` is undocumented in the manual as well and cannot be checked
 * against a documented field, so motorcyclist involvement stays unread rather
 * than trusted.
 * `person_injury` is `not_supplied` because this layer has no person rows.
 */
export const ODOT_OR_DIMENSION_SUPPORT: CrashDimensionCapability = {
  severity: "supplied",
  collision_type: "supplied",
  lighting: "supplied",
  weather: "supplied",
  party_role: "partial",
  person_injury: "not_supplied",
};

export const ODOT_OR_VOCABULARY: CrashSourceVocabularyDescriptor = {
  sourceId: "odot-or",
  support: ODOT_OR_DIMENSION_SUPPORT,
  maps: {
    severity: SEVERITY_MAP,
    collision_type: COLLISION_TYPE_MAP,
    lighting: LIGHTING_MAP,
    weather: WEATHER_MAP,
  },
};
