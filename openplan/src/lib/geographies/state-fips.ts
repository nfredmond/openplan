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
