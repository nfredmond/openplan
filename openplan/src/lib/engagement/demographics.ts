/**
 * E5a — optional, self-reported respondent demographics for Title VI /
 * representativeness SCREENING. Shared vocabulary (form + zod + display), the
 * insert-row builder, and the k-anonymized aggregate shaper. Privacy is the
 * whole point: coarse bands only, ZIP-3 (never ZIP-5), every field optional,
 * per-campaign opt-in, and only aggregate (cells <5 suppressed) is ever read
 * back. This is screening context, never a statistical sample or a civil-rights
 * finding.
 *
 * Band values MUST match the CHECK constraints in migration 20260719000094.
 */

export const DEMOGRAPHICS_SCREENING_CAVEAT =
  "Self-reported by a self-selected subset of respondents and shown only in aggregate (small groups suppressed). Screening context to check who outreach reached — NOT a statistical sample, a representativeness finding, or a civil-rights determination.";

export const AGE_BANDS = [
  "under_18",
  "18_24",
  "25_34",
  "35_44",
  "45_54",
  "55_64",
  "65_plus",
  "prefer_not_to_say",
] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export const LANGUAGES = [
  "en",
  "es",
  "zh",
  "vi",
  "tl",
  "ko",
  "ar",
  "hy",
  "fa",
  "ru",
  "pa",
  "other",
  "prefer_not_to_say",
] as const;
export type Language = (typeof LANGUAGES)[number];

export const RACE_ETHNICITY = [
  "ai_an",
  "asian",
  "black",
  "hispanic",
  "nhpi",
  "white",
  "mena",
  "other",
  "prefer_not_to_say",
] as const;
export type RaceEthnicity = (typeof RACE_ETHNICITY)[number];

export const HOUSEHOLD_TENURE = ["rent", "own", "other", "prefer_not_to_say"] as const;
export type HouseholdTenure = (typeof HOUSEHOLD_TENURE)[number];

export const DEMOGRAPHIC_LABELS: Record<string, string> = {
  under_18: "Under 18",
  "18_24": "18–24",
  "25_34": "25–34",
  "35_44": "35–44",
  "45_54": "45–54",
  "55_64": "55–64",
  "65_plus": "65+",
  en: "English",
  es: "Spanish",
  zh: "Chinese",
  vi: "Vietnamese",
  tl: "Tagalog",
  ko: "Korean",
  ar: "Arabic",
  hy: "Armenian",
  fa: "Farsi",
  ru: "Russian",
  pa: "Punjabi",
  ai_an: "American Indian / Alaska Native",
  asian: "Asian",
  black: "Black / African American",
  hispanic: "Hispanic / Latino",
  nhpi: "Native Hawaiian / Pacific Islander",
  white: "White",
  mena: "Middle Eastern / North African",
  rent: "Renter",
  own: "Homeowner",
  other: "Other",
  prefer_not_to_say: "Prefer not to say",
  suppressed: "Small groups (suppressed)",
};

export function demographicLabel(band: string): string {
  return DEMOGRAPHIC_LABELS[band] ?? band;
}

/** The optional demographics a respondent may submit. ZIP is collected as 5
 * digits for UX but only the 3-digit prefix is ever persisted. */
export type DemographicsInput = {
  ageBand?: AgeBand;
  zip5?: string;
  primaryLanguage?: Language;
  raceEthnicity?: RaceEthnicity[];
  householdTenure?: HouseholdTenure;
  consented?: boolean;
};

export type DemographicsRow = {
  item_id: string;
  campaign_id: string;
  age_band: AgeBand | null;
  zip3: string | null;
  primary_language: Language | null;
  race_ethnicity: RaceEthnicity[] | null;
  household_tenure: HouseholdTenure | null;
  consented: boolean;
};

/** Build the insert row, coarsening ZIP-5 → ZIP-3. Returns null when the
 * respondent supplied nothing (so we never write an empty demographics row). */
export function demographicsRowFromInput(
  itemId: string,
  campaignId: string,
  input: DemographicsInput | undefined | null
): DemographicsRow | null {
  if (!input) return null;
  const race = input.raceEthnicity && input.raceEthnicity.length > 0 ? input.raceEthnicity : null;
  const zip3 = input.zip5 && /^\d{5}$/.test(input.zip5) ? input.zip5.slice(0, 3) : null;
  const provided =
    input.ageBand || zip3 || input.primaryLanguage || race || input.householdTenure;
  if (!provided) return null;
  return {
    item_id: itemId,
    campaign_id: campaignId,
    age_band: input.ageBand ?? null,
    zip3,
    primary_language: input.primaryLanguage ?? null,
    race_ethnicity: race,
    household_tenure: input.householdTenure ?? null,
    consented: Boolean(input.consented),
  };
}

export type DemographicsSummaryRow = {
  dimension: string;
  band: string;
  respondent_count: number | string;
};

export type DemographicsBand = { band: string; label: string; count: number };

export type DemographicsSummary = {
  respondentsWithDemographics: number;
  dimensions: {
    age_band: DemographicsBand[];
    primary_language: DemographicsBand[];
    household_tenure: DemographicsBand[];
    race_ethnicity: DemographicsBand[];
  };
  hasAny: boolean;
  hasSuppressed: boolean;
  caveat: string;
};

const DIMENSION_KEYS = ["age_band", "primary_language", "household_tenure", "race_ethnicity"] as const;

/** Shape the k-anon RPC rows into per-dimension band lists. 'suppressed' sorts
 * last; '__meta__' carries the respondent total. Pure/deterministic. */
export function shapeDemographicsSummary(rows: DemographicsSummaryRow[]): DemographicsSummary {
  const dimensions: DemographicsSummary["dimensions"] = {
    age_band: [],
    primary_language: [],
    household_tenure: [],
    race_ethnicity: [],
  };
  let respondents = 0;
  let hasSuppressed = false;

  for (const row of rows) {
    const count = typeof row.respondent_count === "number" ? row.respondent_count : Number(row.respondent_count);
    if (!Number.isFinite(count)) continue;
    if (row.dimension === "__meta__") {
      if (row.band === "respondents_with_demographics") respondents = count;
      continue;
    }
    if (!(DIMENSION_KEYS as readonly string[]).includes(row.dimension)) continue;
    if (row.band === "suppressed") hasSuppressed = true;
    dimensions[row.dimension as (typeof DIMENSION_KEYS)[number]].push({
      band: row.band,
      label: demographicLabel(row.band),
      count,
    });
  }

  for (const key of DIMENSION_KEYS) {
    dimensions[key].sort((a, b) => {
      if (a.band === "suppressed") return 1;
      if (b.band === "suppressed") return -1;
      return b.count - a.count;
    });
  }

  const hasAny = DIMENSION_KEYS.some((k) => dimensions[k].length > 0);
  return { respondentsWithDemographics: respondents, dimensions, hasAny, hasSuppressed, caveat: DEMOGRAPHICS_SCREENING_CAVEAT };
}

type RpcClientLike = {
  rpc: (
    fn: string,
    params: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

/** Load + shape the k-anon demographics aggregate for a campaign. Injected
 * client so it is unit-testable; returns an empty summary on error. */
export async function loadDemographicsSummary(
  supabase: unknown,
  campaignId: string
): Promise<{ summary: DemographicsSummary; error: string | null }> {
  const client = supabase as RpcClientLike;
  const { data, error } = await client.rpc("engagement_demographics_summary", {
    p_campaign_id: campaignId,
  });
  if (error) {
    return { summary: shapeDemographicsSummary([]), error: error.message };
  }
  const rows = (Array.isArray(data) ? data : []) as DemographicsSummaryRow[];
  return { summary: shapeDemographicsSummary(rows), error: null };
}
