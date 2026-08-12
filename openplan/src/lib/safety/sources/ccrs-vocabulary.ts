/**
 * The California adapter's mapping into the neutral crash vocabulary.
 *
 * THIS IS THE ONLY FILE IN THE MODULE THAT MAY SPELL A CALIFORNIA VALUE.
 * `../vocabulary.ts` holds the jurisdiction-neutral dimensions; this holds one
 * descriptor translating CCRS's own strings into them. Another state's feed
 * becomes a sibling file with its own descriptor and its own adapter — no core
 * type changes, no filter enum changes, no screen changes. If you find yourself
 * wanting to add a value to the neutral vocabulary to accommodate a CCRS
 * spelling, that is the signal that the mapping, not the vocabulary, is wrong.
 *
 * PROVENANCE OF THE VALUE LISTS. Every distribution quoted below was read from
 * data.ca.gov's CKAN DataStore on 2026-08-11 against `Crashes_2025`, and the
 * field lists were confirmed byte-identical across Crashes_2016, 2020, 2025 and
 * 2026 — the schema does not drift between years, so nothing here needs per-year
 * branching. Counts are a snapshot of a source that refreshes daily; they are
 * here to show the SHAPE of each field (closed head, dirty tail, how much null),
 * not as figures anything computes from.
 *
 * WHAT IS DELIBERATELY NOT MAPPED, and why each refusal is real work rather
 * than a gap left open:
 *
 *   - `Primary Collision Factor Violation` — free text. The same handful of
 *     vehicle-code sections appear spelled a dozen ways ('VC 22350', '22350',
 *     'VC 22350 UNSAFE SPEED FOR PREVAILING CONDITIONS', …). The only closed
 *     companion, `Primary Collision Factor Code` (A/B/C/D), has no published
 *     meaning anywhere this repository can reach, so any bucketing would be
 *     invented. Independently of that: a violation category is a FAULT
 *     ALLEGATION about an identifiable person rendered beside a precise
 *     coordinate, before adjudication. Reading the source's data-dictionary
 *     document would settle the first objection; it does not touch the second.
 *   - `Road Condition 1/2` — leading spaces, self-concatenated values, and 40+
 *     compound strings. A closed vocabulary cannot be recovered from it without
 *     guessing.
 *   - `Weather 2` — a secondary observation with no reader; mapping it would
 *     create a column nothing renders.
 *   - `RoadwaySurfaceCode`, `TrafficControlDeviceCode`, `Special Condition`,
 *     `HitRun` — codes with no description column and no published key.
 *   - `IsFreeway` — 46% null; a facet that is absent for half the rows reads as
 *     a finding to anyone who filters on it.
 */

import {
  type CrashDimensionCapability,
  type CrashSourceVocabularyDescriptor,
} from "@/lib/safety/vocabulary";

/**
 * CCRS column names, spelled once.
 *
 * The DataStore is case- and space-sensitive and several of these carry a space
 * in the identifier ("Collision Id", "County Code"). A misspelling is not a
 * silent zero — CKAN answers with an error, `fetchJsonWithRetry` yields null and
 * the adapter throws `CrashSourceUnavailableError` — but it costs a live round
 * trip to discover, so they live in one constant that the query builders and the
 * PII-refusal guard both read.
 */
export const CCRS_CRASH_COLUMNS = {
  collisionId: "Collision Id",
  crashDateTime: "Crash Date Time",
  latitude: "Latitude",
  longitude: "Longitude",
  numberKilled: "NumberKilled",
  numberInjured: "NumberInjured",
  involvedWith: "MotorVehicleInvolvedWithDesc",
  collisionType: "Collision Type Description",
  lighting: "LightingDescription",
  weather: "Weather 1",
  isDeleted: "IsDeleted",
  countyCode: "County Code",
} as const;

/**
 * Manner of collision. Probed 2025: exactly eight values plus 953 nulls, the
 * same eight in 2016.
 *
 * `VEHICLE/PEDESTRAIN` is the source's own misspelling and is matched literally.
 * Correcting it here would mean matching nothing at all — the typo IS the data.
 */
const COLLISION_TYPE_MAP: Readonly<Record<string, string>> = {
  "REAR END": "rear_end",
  "SIDE SWIPE": "sideswipe",
  "HEAD-ON": "head_on",
  BROADSIDE: "angle",
  "HIT OBJECT": "hit_object",
  OVERTURNED: "overturn",
  "VEHICLE/PEDESTRAIN": "vehicle_pedestrian",
  OTHER: "other",
};

/**
 * Lighting. Probed 2025: five values plus null, identical in 2016 — the
 * cleanest field in the feed and the most actionable.
 */
const LIGHTING_MAP: Readonly<Record<string, string>> = {
  DAYLIGHT: "daylight",
  "DUSK-DAWN": "dawn_dusk",
  "DARK-STREET LIGHTS": "dark_lighted",
  "DARK-NO STREET LIGHTS": "dark_unlighted",
  "DARK-STREET LIGHTS NOT FUNCTIONING": "dark_lighting_inoperative",
};

/**
 * Weather. Probed 2025 head, in order: CLEAR 342,515 · CLOUDY 39,977 ·
 * RAINING 14,252 · FOG/VISIBILITY 1,749 · WIND 443 · SNOWING 424 · OTHER 314 ·
 * UNKNOWN 31 — 99.6% of rows between them.
 *
 * The remaining 0.4% is roughly forty one-off operator strings. They are NOT
 * mapped: they land on `other`, keep their raw text on the row, and are counted
 * so the ingest can disclose how many fell through. `UNKNOWN` is declared
 * explicitly because a source that positively states "unknown" is making a
 * different statement from a source that left the field empty, even though both
 * store the same neutral value — declaring it keeps 31 rows out of the
 * unmapped tally, where they would misreport how dirty the field is.
 */
const WEATHER_MAP: Readonly<Record<string, string>> = {
  CLEAR: "clear",
  CLOUDY: "cloudy",
  RAINING: "rain",
  SNOWING: "snow",
  "FOG/VISIBILITY": "fog",
  WIND: "wind",
  OTHER: "other",
  UNKNOWN: "unknown",
};

/**
 * Party role. Probed `PartyType` across 2025: Driver 695,899 ·
 * ParkedVehicle 56,601 · Pedestrian 13,873 · Bicyclist 12,166 · Other 3,959 ·
 * AutonomousVehicle 283.
 *
 * `AutonomousVehicle` maps to `driver`, not to `other`: it is a statement about
 * the vehicle's automation, not about a different kind of road user, and `other`
 * would drop a party out of the driver counts entirely. The raw value is
 * preserved on the row, so the fact is not lost.
 *
 * Motorcyclists are ABSENT from this field — CCRS records them as drivers, and
 * the vehicle type is what separates them. That derivation is in
 * `deriveCcrsPartyRole`, declared and tested, in the same spirit as the
 * severity derivation.
 */
const PARTY_ROLE_MAP: Readonly<Record<string, string>> = {
  DRIVER: "driver",
  PASSENGER: "passenger",
  PEDESTRIAN: "pedestrian",
  BICYCLIST: "bicyclist",
  PARKEDVEHICLE: "parked_vehicle",
  AUTONOMOUSVEHICLE: "driver",
  OTHER: "other",
};

/**
 * Person-level injury outcome. Probed `ExtentOfInjuryCode` 2025:
 * Fatal 3,332 · SuspectSerious 16,006 · SevereInactive 993 ·
 * SuspectMinor 81,188 · OtherVisibleInactive 4,405 · PossibleInjury 118,326 ·
 * ComplaintOfPainInactive 12,379 · null 244,788.
 *
 * The four `*Inactive` spellings are retired codes still present in the data.
 * Folding them in is not tidying: dropping `SevereInactive` would undercount
 * suspected serious injuries — the numerator of the KSI measure — in older
 * years, silently.
 *
 * NULL is NOT mapped here and must not be. It is overwhelmingly a witness or an
 * uninjured passenger, and it is also every row whose outcome was never filled
 * in; the data does not separate the two. It therefore falls through to the
 * dimension's absent value, `unknown`. Reading it as `no_apparent_injury` would
 * turn a quarter of a million unanswered questions into a quarter of a million
 * findings.
 */
const PERSON_INJURY_MAP: Readonly<Record<string, string>> = {
  FATAL: "fatal",
  SUSPECTSERIOUS: "suspected_serious",
  SEVEREINACTIVE: "suspected_serious",
  SUSPECTMINOR: "suspected_minor",
  OTHERVISIBLEINACTIVE: "suspected_minor",
  POSSIBLEINJURY: "possible",
  COMPLAINTOFPAININACTIVE: "possible",
};

/**
 * What CCRS can say, dimension by dimension.
 *
 * `severity` is `partial` rather than `supplied`, and that is the honest word:
 * the crash table carries only killed and injured counts, so the fatal / injury
 * / property-damage split is real but the suspected-serious band is not
 * reachable from it — it arrives, when it arrives, from the person-level join.
 * A run where that join failed keeps this reading `partial`, which is what stops
 * "0 serious injuries" from being rendered as a finding.
 */
export const CCRS_DIMENSION_SUPPORT: CrashDimensionCapability = {
  severity: "partial",
  collision_type: "supplied",
  lighting: "supplied",
  weather: "supplied",
  party_role: "supplied",
  person_injury: "supplied",
};

export const CCRS_VOCABULARY: CrashSourceVocabularyDescriptor = {
  sourceId: "ccrs-ca",
  support: CCRS_DIMENSION_SUPPORT,
  maps: {
    collision_type: COLLISION_TYPE_MAP,
    lighting: LIGHTING_MAP,
    weather: WEATHER_MAP,
    party_role: PARTY_ROLE_MAP,
    person_injury: PERSON_INJURY_MAP,
  },
};

/**
 * CCRS spells the vehicle type on the party row; a motorcyclist is a DRIVER of a
 * vehicle whose type is a motorcycle.
 *
 * A declared two-column derivation, exactly like the severity derivation, rather
 * than a hidden special case: probed 2025 shows 12,513 crashes involving a
 * motorcycle, a road-user group that is invisible at every layer of this product
 * without it.
 *
 * The vehicle type is read for THIS and nothing else, and is never stored raw —
 * a make, model, colour and year beside a date and a coordinate identifies a
 * household.
 */
export function isCcrsMotorcycleVehicle(vehicleTypeDesc: unknown): boolean {
  return typeof vehicleTypeDesc === "string" && vehicleTypeDesc.trim().toUpperCase() === "MOTORCYCLE";
}
