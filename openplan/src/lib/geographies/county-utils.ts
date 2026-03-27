const COUNTY_SUFFIX_PATTERN = /\b(county|parish|borough|census area|municipality|city and borough|city)\b/gi;
const NON_ALPHANUMERIC_PATTERN = /[^A-Za-z0-9]+/g;
const EDGE_DASH_PATTERN = /^-+|-+$/g;

const STATE_ABBREVIATIONS: Record<string, string> = {
  Alabama: "AL",
  Alaska: "AK",
  Arizona: "AZ",
  Arkansas: "AR",
  California: "CA",
  Colorado: "CO",
  Connecticut: "CT",
  Delaware: "DE",
  Florida: "FL",
  Georgia: "GA",
  Hawaii: "HI",
  Idaho: "ID",
  Illinois: "IL",
  Indiana: "IN",
  Iowa: "IA",
  Kansas: "KS",
  Kentucky: "KY",
  Louisiana: "LA",
  Maine: "ME",
  Maryland: "MD",
  Massachusetts: "MA",
  Michigan: "MI",
  Minnesota: "MN",
  Mississippi: "MS",
  Missouri: "MO",
  Montana: "MT",
  Nebraska: "NE",
  Nevada: "NV",
  "New Hampshire": "NH",
  "New Jersey": "NJ",
  "New Mexico": "NM",
  "New York": "NY",
  "North Carolina": "NC",
  "North Dakota": "ND",
  Ohio: "OH",
  Oklahoma: "OK",
  Oregon: "OR",
  Pennsylvania: "PA",
  "Rhode Island": "RI",
  "South Carolina": "SC",
  "South Dakota": "SD",
  Tennessee: "TN",
  Texas: "TX",
  Utah: "UT",
  Vermont: "VT",
  Virginia: "VA",
  Washington: "WA",
  "West Virginia": "WV",
  Wisconsin: "WI",
  Wyoming: "WY",
  "District of Columbia": "DC",
  "Puerto Rico": "PR",
  "American Samoa": "AS",
  Guam: "GU",
  "Northern Mariana Islands": "MP",
  "U.S. Virgin Islands": "VI",
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildCountyPrefix(label: string, fallback = "COUNTY"): string {
  const countyPart = normalizeWhitespace(label.split(",")[0] ?? label)
    .replace(COUNTY_SUFFIX_PATTERN, " ")
    .replace(NON_ALPHANUMERIC_PATTERN, "")
    .toUpperCase();

  return (countyPart || fallback.replace(NON_ALPHANUMERIC_PATTERN, "").toUpperCase() || "COUNTY").slice(0, 24);
}

export function buildCountySlug(label: string, fips?: string | null): string {
  const countyPart = normalizeWhitespace(label.split(",")[0] ?? label)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(NON_ALPHANUMERIC_PATTERN, "-")
    .replace(EDGE_DASH_PATTERN, "");

  if (fips?.trim()) {
    return `${countyPart || "county"}-${fips.trim()}`;
  }
  return countyPart || "county";
}

export function buildCountySuggestedRunName(label: string, fips?: string | null): string {
  return `${buildCountySlug(label, fips)}-runtime`;
}

export function abbreviateCountyLabel(name: string): string {
  const normalized = normalizeWhitespace(name);
  const commaIndex = normalized.lastIndexOf(",");
  if (commaIndex === -1) return normalized;

  const countyName = normalized.slice(0, commaIndex).trim();
  const stateName = normalized.slice(commaIndex + 1).trim();
  const stateAbbreviation = STATE_ABBREVIATIONS[stateName];

  return stateAbbreviation ? `${countyName}, ${stateAbbreviation}` : normalized;
}

export function normalizeCountySearchText(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

export { STATE_ABBREVIATIONS };
