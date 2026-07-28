import { STATE_ABBREVIATIONS } from "@/lib/geographies/county-utils";

/**
 * State/territory FIPS (2-digit) → USPS postal abbreviation.
 *
 * Used to build human-readable place labels (e.g. "Davis, CA") from TIGERweb
 * features, which carry the numeric STATE FIPS but not the postal code.
 * Mirrors the worker-side `STATE_FIPS_TO_ABBR` in
 * `workers/aequilibrae_worker/lodes.py` (kept in sync intentionally).
 */
export const STATE_FIPS_TO_USPS: Record<string, string> = {
  "01": "AL",
  "02": "AK",
  "04": "AZ",
  "05": "AR",
  "06": "CA",
  "08": "CO",
  "09": "CT",
  "10": "DE",
  "11": "DC",
  "12": "FL",
  "13": "GA",
  "15": "HI",
  "16": "ID",
  "17": "IL",
  "18": "IN",
  "19": "IA",
  "20": "KS",
  "21": "KY",
  "22": "LA",
  "23": "ME",
  "24": "MD",
  "25": "MA",
  "26": "MI",
  "27": "MN",
  "28": "MS",
  "29": "MO",
  "30": "MT",
  "31": "NE",
  "32": "NV",
  "33": "NH",
  "34": "NJ",
  "35": "NM",
  "36": "NY",
  "37": "NC",
  "38": "ND",
  "39": "OH",
  "40": "OK",
  "41": "OR",
  "42": "PA",
  "44": "RI",
  "45": "SC",
  "46": "SD",
  "47": "TN",
  "48": "TX",
  "49": "UT",
  "50": "VT",
  "51": "VA",
  "53": "WA",
  "54": "WV",
  "55": "WI",
  "56": "WY",
  "60": "AS",
  "66": "GU",
  "69": "MP",
  "72": "PR",
  "78": "VI",
};

/**
 * Resolve a USPS abbreviation from a 2-digit state FIPS. Tolerates a longer
 * GEOID by taking its first two characters, and left-pads a single digit.
 * Returns null for unknown / missing input.
 */
export function stateUspsFromFips(fips: string | null | undefined): string | null {
  if (!fips) return null;
  const key = fips.padStart(2, "0").slice(0, 2);
  return STATE_FIPS_TO_USPS[key] ?? null;
}

/**
 * USPS abbreviation → state FIPS, and full state name → state FIPS.
 *
 * Derived from the two tables that already exist rather than hand-written a
 * third time: `STATE_FIPS_TO_USPS` above, and `STATE_ABBREVIATIONS`
 * (name → USPS) in `county-utils`. A hand-copied third list would be one
 * territory away from disagreeing with the other two.
 */
const USPS_TO_STATE_FIPS: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_FIPS_TO_USPS).map(([fips, usps]) => [usps, fips])
);

const STATE_NAME_TO_FIPS: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_ABBREVIATIONS).flatMap(([name, usps]) => {
    const fips = USPS_TO_STATE_FIPS[usps];
    return fips ? [[name.toLowerCase(), fips] as [string, string]] : [];
  })
);

/** Resolve a state FIPS from a USPS abbreviation ("OH" → "39"). Case-insensitive. */
export function stateFipsFromUsps(usps: string | null | undefined): string | null {
  if (!usps) return null;
  return USPS_TO_STATE_FIPS[usps.trim().toUpperCase()] ?? null;
}

/** Resolve a state FIPS from a full state name ("Ohio" → "39"). Case-insensitive. */
export function stateFipsFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  return STATE_NAME_TO_FIPS[name.trim().toLowerCase()] ?? null;
}

export interface StateQualifiedQuery {
  /** The place name with any trailing state qualifier removed. */
  name: string;
  /** The state FIPS the query named, or null when it named none. */
  stateFips: string | null;
}

/**
 * Split a trailing state qualifier off a place query: "Franklin County, OH" →
 * `{ name: "Franklin County", stateFips: "39" }`.
 *
 * WHY THIS EXISTS. Before this, no caller parsed the ", XX" form at all. It
 * appeared to work for counties purely by accident — the county catalog ranks
 * against a label that already ends in ", OH", so the comma survived
 * normalization into an exact-string match. It did NOT work for anything served
 * by TIGERweb: `sanitizeLikeQuery` rewrites the comma to a space, so
 * "Columbus, OH" became `LIKE 'COLUMBUS OH%'` and matched nothing at all.
 *
 * Both the abbreviation and the spelled-out name are accepted, because a planner
 * typing their own state usually spells it. A trailing fragment that names no
 * state is left alone rather than silently dropped — "Lake, Charles" must keep
 * searching for that text, not become a search for "Lake".
 */
export function splitStateQualifier(raw: string): StateQualifiedQuery {
  const trimmed = raw.trim();
  const commaIndex = trimmed.lastIndexOf(",");
  if (commaIndex === -1) return { name: trimmed, stateFips: null };

  const head = trimmed.slice(0, commaIndex).trim();
  const tail = trimmed.slice(commaIndex + 1).trim();
  if (!head || !tail) return { name: trimmed, stateFips: null };

  const stateFips = stateFipsFromUsps(tail) ?? stateFipsFromName(tail);
  return stateFips ? { name: head, stateFips } : { name: trimmed, stateFips: null };
}
