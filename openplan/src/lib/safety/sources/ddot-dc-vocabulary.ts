/**
 * The District of Columbia adapter's columns and severity rule.
 *
 * THE ONLY FILE IN THE MODULE THAT MAY SPELL A DC VALUE, as
 * `ccrs-vocabulary.ts` is for California.
 *
 * PROVENANCE. Field names were read on 2026-11-01 from DDOT's "Crashes in DC"
 * layer (`DCGIS_DATA/Public_Safety_WebMercator/MapServer/24`, "Vehicular Crash
 * Data", 356,668 crashes), its FGDC metadata on the Open Data DC item
 * (70392a096a8e431381f1f692aaa06afd) and DDOT's crash data page
 * (https://ddotwiki.atlassian.net/wiki/spaces/GIS0225/pages/2053603429/Crash+Data,
 * updated March 10, 2025).
 *
 * THERE IS NO CRASH SEVERITY FIELD. The layer carries counts of people by
 * outcome and mode: fatal, major, minor and unknown injuries for car occupants
 * (`_DRIVER`, "Total number of car occupants with ..."), pedestrians,
 * bicyclists, passengers and "other". DDOT's page defines the outcomes from
 * MPD's injury descriptions: fatal is an injury type of Fatal or a date of
 * death; major includes unconsciousness, apparent broken bones, concussion
 * and severe laceration; minor includes abrasions, bruises, pain and
 * discomfort; unknown is "Unknown". The adapter maps only what that defines:
 *
 *   - any fatal count above zero: `fatal`;
 *   - otherwise any major count above zero: `severe_injury` (DDOT's major
 *     injury, which the research note treats as KABCO A; DDOT does not use
 *     the KABCO letters);
 *   - otherwise any minor count above zero: `injury`. Minor holds both
 *     suspected minor and possible injuries (pain, discomfort), so B and C are
 *     not separated;
 *   - every count a readable zero: `pdo`;
 *   - anything else, including a crash whose only outcome is an unknown
 *     injury or a crash with an unreadable count: `unknown`.
 *
 * ONE METADATA LINE IS WRONG. The metadata describes `MINORINJURIES_PEDESTRIAN`
 * with the unknown-injury sentence of `UNKNOWNINJURIES_PEDESTRIAN`. The two
 * columns hold different data (10,263 and 317 crashes above zero, 12 in
 * both), and every other mode's minor column is described as minor, so the
 * adapter reads it as minor.
 *
 * THE PASSENGER AND "OTHER" COLUMNS are in the layer but not in its metadata.
 * They are read because they do not repeat the car-occupant counts: of 95
 * crashes with a passenger death, 90 have no car-occupant death. The four
 * "other" columns are null on 253,552 crashes reported before June 2024, which
 * makes a crash with no injury unknown rather than property damage only in
 * those years (79 of 20,781 crashes reported in 2023).
 *
 * WHAT IS DELIBERATELY NOT REQUESTED: the MPD case number (CCN), addresses,
 * ward, impairment counts, speeding, taxi and government vehicle counts, and
 * every route and block reference.
 */

import { CRASH_LEVEL_ONLY_DIMENSION_SUPPORT, type CrashDimensionCapability, type CrashSourceVocabularyDescriptor } from "@/lib/safety/vocabulary";

/** DDOT crash layer column names, spelled once. */
export const DDOT_DC_CRASH_COLUMNS = {
  objectId: "OBJECTID",
  crashId: "CRIMEID",
  reportDate: "REPORTDATE",
  totalPedestrians: "TOTAL_PEDESTRIANS",
  totalBicyclists: "TOTAL_BICYCLES",
} as const;

/** People killed, by mode. */
export const DDOT_DC_FATAL_COLUMNS = [
  "FATAL_DRIVER",
  "FATAL_PEDESTRIAN",
  "FATAL_BICYCLIST",
  "FATALPASSENGER",
  "FATALOTHER",
] as const;

/** People with a major injury, by mode. */
export const DDOT_DC_MAJOR_INJURY_COLUMNS = [
  "MAJORINJURIES_DRIVER",
  "MAJORINJURIES_PEDESTRIAN",
  "MAJORINJURIES_BICYCLIST",
  "MAJORINJURIESPASSENGER",
  "MAJORINJURIESOTHER",
] as const;

/** People with a minor injury, by mode. */
export const DDOT_DC_MINOR_INJURY_COLUMNS = [
  "MINORINJURIES_DRIVER",
  "MINORINJURIES_PEDESTRIAN",
  "MINORINJURIES_BICYCLIST",
  "MINORINJURIESPASSENGER",
  "MINORINJURIESOTHER",
] as const;

/** People with an unknown injury, by mode. Never counted as injured. */
export const DDOT_DC_UNKNOWN_INJURY_COLUMNS = [
  "UNKNOWNINJURIES_DRIVER",
  "UNKNOWNINJURIES_PEDESTRIAN",
  "UNKNOWNINJURIES_BICYCLIST",
  "UNKNOWNINJURIESPASSENGER",
  "UNKNOWNINJURIESOTHER",
] as const;

/** Pedestrian and bicyclist outcome columns, for involvement. */
export const DDOT_DC_PEDESTRIAN_OUTCOME_COLUMNS = [
  "FATAL_PEDESTRIAN",
  "MAJORINJURIES_PEDESTRIAN",
  "MINORINJURIES_PEDESTRIAN",
  "UNKNOWNINJURIES_PEDESTRIAN",
] as const;
export const DDOT_DC_BICYCLIST_OUTCOME_COLUMNS = [
  "FATAL_BICYCLIST",
  "MAJORINJURIES_BICYCLIST",
  "MINORINJURIES_BICYCLIST",
  "UNKNOWNINJURIES_BICYCLIST",
] as const;

/**
 * What the DDOT layer can say.
 *
 * `severity` is `supplied`: the major-injury counts separate serious injury,
 * though from DDOT's own grouping, not a KABCO letter. Manner of collision,
 * lighting and weather are not in the layer. `party_role` is `partial`:
 * pedestrian and bicyclist involvement come from the layer's documented
 * counts ("Total number of pedestrians involved in the crash"), and
 * motorcyclist involvement is not recorded.
 */
export const DDOT_DC_DIMENSION_SUPPORT: CrashDimensionCapability = {
  ...CRASH_LEVEL_ONLY_DIMENSION_SUPPORT,
  severity: "supplied",
};

/** No coded fields to translate: severity is derived from counts by the rule above. */
export const DDOT_DC_VOCABULARY: CrashSourceVocabularyDescriptor = {
  sourceId: "ddot-dc",
  support: DDOT_DC_DIMENSION_SUPPORT,
  maps: {},
};
