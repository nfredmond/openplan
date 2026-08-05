/**
 * RTP project-prioritization criteria taxonomy — the "why" behind an RTP project
 * portfolio. Each project linked to an RTP cycle can be scored (0–3) against these
 * criteria, which span local → county → state → federal priorities and tie to real
 * policy bases. The composite score + structured rationale replace free-text
 * "priority_rationale" so the RTP packet (and a public view) can answer:
 * "why this project, why not just wider roads, and where does the money come from?"
 *
 * Scoring is screening-grade and planner-assigned. Modeling-derived criteria (VMT,
 * GHG) surface the linked model run's evidence to inform — not auto-set — the score,
 * so we never overclaim a project-level forecast.
 */

export type RtpPriorityLevel = "local" | "county" | "state" | "federal";

/** What informs a criterion's score (drives which evidence the UI surfaces). */
export type RtpPriorityEvidence = "modeling_vmt" | "modeling_ghg" | "equity_overlay" | "engagement" | "manual";

export interface RtpPriorityCriterion {
  key: string;
  label: string;
  description: string;
  level: RtpPriorityLevel;
  /** Relative weight in the composite (higher = more influence). */
  weight: number;
  evidence: RtpPriorityEvidence;
}

export const RTP_PRIORITY_MAX_RATING = 3;

/** Rating scale a planner assigns per criterion. 0 = not applicable / not stored. */
export const RTP_PRIORITY_RATING_SCALE = [
  { value: 0, label: "Not applicable" },
  { value: 1, label: "Low" },
  { value: 2, label: "Moderate" },
  { value: 3, label: "High" },
] as const;

/**
 * The criteria themselves are jurisdiction-NEUTRAL. "Reduce VMT" and "maintain
 * existing assets" are things a plan can do anywhere; only the law an agency
 * cites for them changes with the place. So the taxonomy — keys, labels,
 * weights, levels — lives here and is shared by every jurisdiction, while the
 * policy basis is supplied by a framework in `priority-frameworks.ts`.
 *
 * Keeping the KEYS and WEIGHTS shared is what makes stored scores portable: a
 * workspace that corrects its home geography keeps every rating it recorded,
 * and its composite does not move. An earlier design that varied the criteria
 * set per jurisdiction would have silently dropped ratings whose key the new
 * set did not contain (`parsePriorityScores` skips unknown keys), and divided
 * composites by a different denominator.
 */
export const RTP_PRIORITY_CRITERIA: RtpPriorityCriterion[] = [
  {
    key: "vmt_reduction",
    label: "Reduces VMT",
    description: "Lowers vehicle-miles-traveled per capita.",
    level: "state",
    weight: 3,
    evidence: "modeling_vmt",
  },
  {
    key: "ghg_reduction",
    label: "Reduces GHG emissions",
    description: "Cuts transportation greenhouse-gas emissions.",
    level: "state",
    weight: 3,
    evidence: "modeling_ghg",
  },
  {
    key: "safety",
    label: "Improves safety",
    description: "Reduces fatalities and severe injuries under a Safe System approach.",
    level: "federal",
    weight: 3,
    evidence: "manual",
  },
  {
    key: "equity",
    label: "Serves disadvantaged communities",
    description:
      "Delivers benefits to underserved / disadvantaged communities. Planner attestation; not a system-verified designation.",
    level: "federal",
    weight: 2,
    evidence: "equity_overlay",
  },
  {
    key: "multimodal",
    label: "Supports active & transit modes",
    description: "Advances walking, biking, and transit rather than single-occupancy-vehicle capacity.",
    level: "state",
    weight: 2,
    evidence: "manual",
  },
  {
    key: "state_of_good_repair",
    label: "Maintains existing assets",
    description: "Preserves or rehabilitates existing infrastructure (fix-it-first).",
    level: "federal",
    weight: 2,
    evidence: "manual",
  },
  {
    key: "community_support",
    label: "Community-identified priority",
    description: "Reflects public engagement input and local community priorities.",
    level: "local",
    weight: 2,
    evidence: "engagement",
  },
  {
    key: "regional_priority",
    label: "Regional / county priority",
    description: "Aligns with adopted county or regional transportation plan priorities.",
    level: "county",
    weight: 1,
    evidence: "manual",
  },
];

export const RTP_PRIORITY_LEVELS: RtpPriorityLevel[] = ["local", "county", "state", "federal"];

export const RTP_PRIORITY_LEVEL_LABEL: Record<RtpPriorityLevel, string> = {
  local: "Local",
  county: "County / regional",
  state: "State",
  federal: "Federal",
};

const CRITERIA_BY_KEY = new Map(RTP_PRIORITY_CRITERIA.map((criterion) => [criterion.key, criterion]));

export function getRtpPriorityCriterion(key: string): RtpPriorityCriterion | undefined {
  return CRITERIA_BY_KEY.get(key);
}

export function ratingLabel(rating: number): string {
  return RTP_PRIORITY_RATING_SCALE.find((step) => step.value === rating)?.label ?? "—";
}
