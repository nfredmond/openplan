/**
 * The Iowa adapter's mapping into the neutral crash vocabulary.
 *
 * THE ONLY FILE IN THE MODULE THAT MAY SPELL AN IOWA VALUE, as
 * `ccrs-vocabulary.ts` is for California.
 *
 * PROVENANCE. Field names, coded domains and every value list below were read
 * on 2026-11-01 from Iowa DOT's `Traffic_Safety/Crash_Data/FeatureServer/0`
 * ("Crash Data", 639,173 crashes, 2015-01-01 to 2026-10-29) and its data
 * dictionary (https://cloud.iowadot.gov/gis/data/metadata/crash/Crash_Data.xlsx),
 * with group-by statistics queries. Counts are a snapshot, kept to show the
 * shape of each field, not as figures anything computes from.
 *
 * SEVERITY IS IOWA DOT'S OWN CRASH SEVERITY, `CSEV`, "Extent of severity of
 * crash with regards to involved persons injury status": 1 Fatal, 2 Major
 * Injury, 3 Minor Injury, 4 Possible/Unknown, 5 Property Damage Only. Probed:
 * 1: 3,611 · 2: 13,851 · 3: 59,062 · 4: 101,602 · 5: 461,046 · null: 1.
 * Iowa DOT's companion person layer (`Crash_Person_Data/FeatureServer/0`)
 * names the same five classes "Fatal Crash", "Suspected Serious Injury
 * Crash", "Suspected Minor Injury Crash", "Possible/Unknown Injury Crash" and
 * "Property Damage Only"; crash 20241471305 is `CSEV` 2 on the crash layer and
 * "Suspected Serious Injury Crash" on the person layer. That is why code 2 may
 * say `severe_injury`. The counts agree with the codes: every `CSEV` 1 crash
 * has `FATALITIES > 0`, every `CSEV` 2 crash has `MAJINJURY > 0` and none has
 * a fatality, and no `CSEV` 5 crash has an injury.
 *
 * CODE 4 COMBINES TWO THINGS and is not declared as either. A crash whose
 * worst outcome is a possible injury (KABCO C) and a crash whose worst outcome
 * is an unknown injury share code 4. The adapter separates them with the
 * documented crash-wide count `POSSINJURY` ("Crashwide total of all possible
 * injuries"): above zero is an injury crash, anything else stays unknown.
 * Probed: 101,602 code-4 crashes; 84,021 with a possible injury, 17,581 with
 * only unknown injuries, none with neither.
 *
 * WHAT IS DELIBERATELY NOT REQUESTED: case numbers, the law-enforcement case
 * number, time of day, route and street text, major cause and the drug and
 * alcohol code (fault allegations next to a coordinate), property damage
 * dollars, and every person-level age and gender column on the person layer.
 * The refusals in `src/test/refused-crash-person-fields.test.ts` apply here as
 * to CCRS.
 */

import { type CrashDimensionCapability, type CrashSourceVocabularyDescriptor } from "@/lib/safety/vocabulary";

/** Iowa DOT crash layer column names, spelled once. */
export const IOWADOT_IA_CRASH_COLUMNS = {
  objectId: "OBJECTID",
  crashKey: "CRASH_KEY",
  crashDate: "CRASH_DATE",
  severity: "CSEV",
  fatalCount: "FATALITIES",
  majorInjuryCount: "MAJINJURY",
  minorInjuryCount: "MININJURY",
  possibleInjuryCount: "POSSINJURY",
  collisionManner: "CRCOMNNR",
  lighting: "LIGHT",
  weather: "WEATHER",
  utmEasting: "XCOORD",
  utmNorthing: "YCOORD",
} as const;

/** Iowa DOT person layer column names, spelled once. Only these two are requested. */
export const IOWADOT_IA_PERSON_COLUMNS = {
  crashKey: "CRASH_KEY",
  year: "CRASH_YEAR",
  nonMotoristType: "NM_TYPE",
} as const;

/**
 * Non-motorist types on the person layer that make a crash a pedestrian or a
 * bicyclist crash. Probed statewide: Pedestrian 8,658 · Pedalcyclist 7,590 ·
 * Pedalcycle passenger 46 person rows. Skaters, wheelchairs, horse and buggy,
 * "Other non-motorist" and "In or on building" are neither.
 */
export const IOWADOT_IA_PEDESTRIAN_TYPES = ["Pedestrian"] as const;
export const IOWADOT_IA_BICYCLIST_TYPES = [
  "Pedalcyclist (bicycle/tricycle/unicycle/pedal car)",
  "Pedalcycle passenger",
] as const;

/**
 * Where Iowa DOT puts a crash it could not locate.
 *
 * Not documented in the dictionary; observed on 2026-11-01. One UTM 15N point,
 * easting 190000 and northing 4460000 (about 96.64 W, 40.23 N, in Nebraska),
 * holds 1,309 crashes; no other point holds more than 150. Such a point is
 * not a location, so the adapter excludes it from every query by these two
 * values rather than relying on no Iowa envelope reaching it.
 */
export const IOWADOT_IA_UNLOCATED_POINT = { easting: 190000, northing: 4460000 } as const;

/**
 * Severity from `CSEV`. Code 4 is declared `unknown` here and raised to
 * `injury` only by a positive `POSSINJURY` count (see the header).
 */
const SEVERITY_MAP: Readonly<Record<string, string>> = {
  "1": "fatal",
  "2": "severe_injury",
  "3": "injury",
  "4": "unknown",
  "5": "pdo",
};

/** The `CSEV` code whose meaning needs the possible-injury count. */
export const IOWADOT_IA_POSSIBLE_OR_UNKNOWN_CODE = "4";

/**
 * Manner of crash/collision, `CRCOMNNR`. Probed: 1 Non-collision 189,591 ·
 * 3 Rear-end 147,326 · 5 Broadside 110,344 · 6 Sideswipe same direction
 * 66,355 · 77 Not Reported 37,085 · 4 Angle, oncoming left turn 26,332 ·
 * 98 Other 17,357 · 2 Head-on 14,906 · 9 Rear to side 12,316 · 7 Sideswipe
 * opposite direction 10,447 · 99 Unknown 4,161 · 8 Rear to rear 2,952.
 *
 * NOT DECLARED, on purpose: 1 Non-collision (an overturn, a fall from a
 * vehicle or a fixed-object strike), 8 Rear to rear and 9 Rear to side. None of
 * them is one neutral manner, so they fall to `other`, keep their code and are
 * counted as unmapped.
 */
const COLLISION_TYPE_MAP: Readonly<Record<string, string>> = {
  "2": "head_on",
  "3": "rear_end",
  "4": "angle",
  "5": "angle",
  "6": "sideswipe",
  "7": "sideswipe",
  "98": "other",
  "99": "unknown",
  "77": "unknown",
};

/**
 * Light conditions, `LIGHT`. Probed: 1 Daylight 393,729 · 4 Dark, roadway
 * lighted 81,900 · 77 Not Reported 70,142 · 5 Dark, roadway not lighted 60,866
 * · 2 Dusk 14,947 · 3 Dawn 11,697 · 6 Dark, unknown roadway lighting 3,076 ·
 * 9 Unknown 2,816. Code 6 is not declared: it is dark, but whether the road
 * was lit is the thing the neutral vocabulary separates.
 */
const LIGHTING_MAP: Readonly<Record<string, string>> = {
  "1": "daylight",
  "2": "dawn_dusk",
  "3": "dawn_dusk",
  "4": "dark_lighted",
  "5": "dark_unlighted",
  "9": "unknown",
  "77": "unknown",
};

/**
 * Weather, `WEATHER`. Probed: 1 Clear 379,411 · 2 Cloudy 107,745 · 77 Not
 * Reported 71,006 · 5 Rain 29,816 · 7 Snow 24,974 · 4 Freezing rain/drizzle
 * 8,485 · 8 Blowing snow 5,674 · 99 Unknown 4,640 · 3 Fog, smoke, smog 4,020 ·
 * 9 Severe winds 1,692 · 98 Other 828 · 6 Sleet, hail 730 · 10 Blowing sand,
 * soil, dirt 152. Not declared: 3 (fog and smoke share one code), 4 and 6
 * (freezing rain, sleet and hail are not rain or snow), 8 and 10 (blowing
 * snow and sand are not one category). They fall to `other` with the code.
 */
const WEATHER_MAP: Readonly<Record<string, string>> = {
  "1": "clear",
  "2": "cloudy",
  "5": "rain",
  "7": "snow",
  "9": "wind",
  "98": "other",
  "99": "unknown",
  "77": "unknown",
};

/**
 * What the Iowa layers can say.
 *
 * `severity` is `supplied`: Iowa DOT's own crash severity separates suspected
 * serious injury. `party_role` is `partial`: pedestrian and bicyclist
 * involvement come from the person layer's non-motorist type, and
 * motorcyclist involvement is not read. `person_injury` is `not_supplied`
 * because this adapter returns no person rows.
 */
export const IOWADOT_IA_DIMENSION_SUPPORT: CrashDimensionCapability = {
  severity: "supplied",
  collision_type: "supplied",
  lighting: "supplied",
  weather: "supplied",
  party_role: "partial",
  person_injury: "not_supplied",
};

export const IOWADOT_IA_VOCABULARY: CrashSourceVocabularyDescriptor = {
  sourceId: "iowadot-ia",
  support: IOWADOT_IA_DIMENSION_SUPPORT,
  maps: {
    severity: SEVERITY_MAP,
    collision_type: COLLISION_TYPE_MAP,
    lighting: LIGHTING_MAP,
    weather: WEATHER_MAP,
  },
};
