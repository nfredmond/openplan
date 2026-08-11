import type { EngagementType } from "./catalog";
import type { SurveyQuestionType } from "./survey";

/**
 * CAMPAIGN TEMPLATES — starter content for the four engagement shapes planners
 * reach for most, expressed as DATA and applied through the same server-side
 * validation the manual builder uses.
 *
 * Three properties of this registry are load-bearing:
 *
 * 1. NOTHING PLACE-SPECIFIC. A template must work verbatim for a planner in any
 *    jurisdiction, so no place name, coordinate, camera (`center`/`zoom`),
 *    bounding box, or agency name may appear anywhere in this file. The
 *    registry test serializes every template and refuses those keys — a
 *    map_point question inherits its frame from the campaign's own area at
 *    render time (see `resolveMapPointQuestionView`), which is the only correct
 *    source for it.
 *
 * 2. A TEMPLATE CANNOT SAY "PUBLISHED". `CampaignTemplateQuestion` carries no
 *    status, no publish flag, and no `is_active` — the vocabulary to
 *    auto-publish does not exist in this type, and the apply path writes the
 *    'draft' literal unconditionally. This is the same argument that lets the
 *    Planner Agent draft survey questions (decision of 2026-08-03): wording the
 *    signed-in planner did not write lands where they review it, badged,
 *    invisible to the public, and a person publishes it from the survey
 *    builder. Template wording was authored in this repo, not by the planner
 *    creating the campaign, so it gets exactly the same treatment.
 *
 * 3. QUESTION PROMPTS AND HELP TEXT ARE RESIDENT-FACING. Once a planner
 *    publishes a drafted question, its words appear on the public portal under
 *    the agency's name — so they are written for the person answering, never
 *    for the operator. Operator-facing guidance lives in `label`,
 *    `description`, and `suggestedSummary` only.
 *
 * Sort orders are spaced by ten so a planner can slot their own entries between
 * template ones without renumbering.
 */

export type CampaignTemplateCategory = {
  label: string;
  description: string;
  sortOrder: number;
};

export type CampaignTemplateOption = {
  /** Resident-facing answer choice, created via the survey options table. */
  label: string;
  sortOrder: number;
};

export type CampaignTemplateQuestion = {
  questionType: SurveyQuestionType;
  /** Resident-facing. Shown on the public portal once a planner publishes the draft. */
  prompt: string;
  /** Resident-facing. */
  helpText?: string;
  required?: boolean;
  sortOrder: number;
  /**
   * Validated against the question type's own config schema
   * (`validateSurveyConfig`) at apply time — the same path the survey builder
   * uses. Must never carry `center`/`zoom` (a place) or `visible_when`
   * (conditions reference question ids that do not exist until apply time).
   */
  config?: Record<string, unknown>;
  /** Required for question types with `usesOptions`; forbidden otherwise. */
  options?: CampaignTemplateOption[];
};

export type CampaignTemplate = {
  id: string;
  /** Operator-facing name shown in the creator's template picker. */
  label: string;
  /** Operator-facing: what this template sets up and who it is for. */
  description: string;
  engagementType: EngagementType;
  /** Operator-facing campaign summary, prefilled into the creator and editable there. */
  suggestedSummary: string;
  /**
   * Resident-facing text written to `engagement_campaigns.public_description`.
   * The campaign is created in 'draft' status, so nothing is public until the
   * planner activates and shares it — but this text is written to be shown to
   * residents as-is, and the planner can edit it in the campaign console.
   */
  suggestedPublicDescription: string;
  categories: CampaignTemplateCategory[];
  questions: CampaignTemplateQuestion[];
};

export const CAMPAIGN_TEMPLATES: readonly CampaignTemplate[] = [
  {
    id: "corridor-safety-study",
    label: "Corridor safety study",
    description:
      "Location-based safety feedback along a street or corridor: crossing, walking, biking, transit access, and driver-behavior categories, plus a short survey that pairs a map question with travel-habit context.",
    engagementType: "map_feedback",
    suggestedSummary:
      "Collects location-specific safety and comfort feedback along the study corridor — public map comments, survey responses, and staff-entered observations — to surface recurring problem locations and candidate countermeasures for project review.",
    suggestedPublicDescription:
      "We are studying safety along this corridor and want to hear from the people who use it. Share the specific places where walking, biking, driving, or reaching transit feels unsafe or uncomfortable, and what you think would improve them. Your comments are reviewed by the project team and inform which improvements are studied.",
    categories: [
      {
        label: "Crossing safety",
        description:
          "Crosswalk visibility, crossing distance, signal timing, turning conflicts, and near-miss locations.",
        sortOrder: 10,
      },
      {
        label: "Sidewalks and accessibility",
        description:
          "Sidewalk gaps, narrow walkways, ADA barriers, surface conditions, and curb ramp issues.",
        sortOrder: 20,
      },
      {
        label: "Bicycle comfort and network gaps",
        description:
          "Bicycle stress points, missing links, uncomfortable crossings, and route continuity concerns.",
        sortOrder: 30,
      },
      {
        label: "Transit access and stops",
        description:
          "Stop placement, stop amenities, crossings to stops, and first/last-mile access.",
        sortOrder: 40,
      },
      {
        label: "Driver behavior and speed",
        description:
          "Speeding, red-light and stop-sign running, aggressive turning, and passing too close.",
        sortOrder: 50,
      },
      {
        label: "Maintenance, lighting, and visibility",
        description:
          "Vegetation, pavement, drainage, lighting, signage, striping, and sight-line maintenance issues.",
        sortOrder: 60,
      },
      {
        label: "Other / needs follow-up",
        description:
          "Useful comments that are still too broad, mixed, or ambiguous for a tighter category assignment.",
        sortOrder: 70,
      },
    ],
    questions: [
      {
        questionType: "map_point",
        prompt: "Where along this corridor do you feel unsafe or uncomfortable?",
        helpText:
          "Drop a point on each location you want the project team to look at. You can add a note describing what happens there.",
        sortOrder: 10,
        config: { geometry_types: ["Point"] },
      },
      {
        questionType: "single_choice",
        prompt: "How do you most often travel along this corridor?",
        sortOrder: 20,
        config: { allow_other: true },
        options: [
          { label: "Walking", sortOrder: 10 },
          { label: "Bicycle or scooter", sortOrder: 20 },
          { label: "Driving", sortOrder: 30 },
          { label: "Public transit", sortOrder: 40 },
        ],
      },
      {
        questionType: "likert",
        prompt: "How safe do you feel traveling along this corridor today?",
        helpText: "1 means very unsafe, 5 means very safe.",
        sortOrder: 30,
        config: { scale: 5 },
      },
      {
        questionType: "free_text",
        prompt: "What single change would most improve safety along this corridor?",
        sortOrder: 40,
        config: { max_length: 2000 },
      },
    ],
  },
  {
    id: "safe-routes-to-school",
    label: "Safe routes to school",
    description:
      "Walking and biking access to a school: crossing, sidewalk, pickup/drop-off, and visibility categories drawn from safe-routes practice, plus a survey about how students travel today and what would change that.",
    engagementType: "map_feedback",
    suggestedSummary:
      "Captures location-specific safety and access feedback on walking and biking routes to school — from families, school staff, and neighbors — to identify barrier locations, arrival/dismissal conflicts, and improvements that would let more students walk and bike.",
    suggestedPublicDescription:
      "We are looking at how students get to school and where the walk or ride could be safer. Tell us about the specific crossings, sidewalks, and streets your household uses, what happens at arrival and dismissal, and what would make walking or biking to school a realistic choice. The project team reviews every comment.",
    categories: [
      {
        label: "Crossing safety",
        description:
          "Crosswalk visibility, crossing distance, turning conflicts, school pickup conflicts, and near-miss locations.",
        sortOrder: 10,
      },
      {
        label: "Sidewalks and accessibility",
        description:
          "Sidewalk gaps, narrow walkways, ADA barriers, surface conditions, and curb ramp issues.",
        sortOrder: 20,
      },
      {
        label: "Bicycle comfort and network gaps",
        description:
          "Bicycle stress points, missing links, uncomfortable crossings, and route continuity concerns.",
        sortOrder: 30,
      },
      {
        label: "Pickup, drop-off, and curb use",
        description:
          "Arrival and dismissal circulation, queuing, double parking, and conflicts between vehicles and students on foot or bike.",
        sortOrder: 40,
      },
      {
        label: "Maintenance, lighting, and visibility",
        description:
          "Vegetation, pavement, drainage, lighting, signage, striping, and sight-line maintenance issues.",
        sortOrder: 50,
      },
      {
        label: "Support / positive signal",
        description:
          "Positive support, reinforcement of proposed changes, or appreciation without a separate primary issue.",
        sortOrder: 60,
      },
      {
        label: "Other / needs follow-up",
        description:
          "Useful comments that are still too broad, mixed, or ambiguous for a tighter category assignment.",
        sortOrder: 70,
      },
    ],
    questions: [
      {
        questionType: "map_point",
        prompt: "Where on the walk or ride to school does something feel unsafe?",
        helpText:
          "Drop a point on each crossing, sidewalk, or street segment you are concerned about, and describe what happens there.",
        sortOrder: 10,
        config: { geometry_types: ["Point"] },
      },
      {
        questionType: "multiple_choice",
        prompt: "How do students in your household usually get to school?",
        helpText: "Select all that apply.",
        sortOrder: 20,
        config: { allow_other: true },
        options: [
          { label: "Walking", sortOrder: 10 },
          { label: "Bicycle or scooter", sortOrder: 20 },
          { label: "School bus", sortOrder: 30 },
          { label: "Public transit", sortOrder: 40 },
          { label: "Family vehicle", sortOrder: 50 },
          { label: "Carpool with another family", sortOrder: 60 },
        ],
      },
      {
        questionType: "likert",
        prompt:
          "How comfortable would you be having a student in your household walk or bike to school on today's routes?",
        helpText: "1 means not at all comfortable, 5 means completely comfortable.",
        sortOrder: 30,
        config: { scale: 5 },
      },
      {
        questionType: "free_text",
        prompt: "What would need to change for more students to walk or bike to school?",
        sortOrder: 40,
        config: { max_length: 2000 },
      },
    ],
  },
  {
    id: "long-range-plan-input",
    label: "General plan / long-range plan input",
    description:
      "Community-wide input for a general plan, regional transportation plan, or other long-range plan: topic categories spanning plan elements, plus a survey that pairs open questions with a priorities ranking.",
    engagementType: "comment_collection",
    suggestedSummary:
      "Collects community-wide input for the long-range planning effort — values, concerns, and priorities across plan topics — to ground the plan's goals and policies in what residents actually said, with a comment record that carries into the plan's documentation.",
    suggestedPublicDescription:
      "We are updating the long-range plan that guides how this community grows and invests over the coming decades. Share what you value, what concerns you, and what you want prioritized. Your input shapes the plan's goals and is part of its public record.",
    categories: [
      {
        label: "Housing and land use",
        description:
          "Housing supply, affordability, neighborhood character, and where growth should go.",
        sortOrder: 10,
      },
      {
        label: "Transportation and mobility",
        description:
          "Streets, transit, walking, biking, freight, and how people and goods move.",
        sortOrder: 20,
      },
      {
        label: "Parks, trails, and open space",
        description: "Parks, trails, recreation, and access to open space.",
        sortOrder: 30,
      },
      {
        label: "Economic development",
        description: "Jobs, local business, downtown and commercial vitality.",
        sortOrder: 40,
      },
      {
        label: "Environment and resilience",
        description:
          "Natural resources, hazards, climate resilience, and environmental quality.",
        sortOrder: 50,
      },
      {
        label: "Public services and facilities",
        description:
          "Schools, libraries, utilities, public safety, and community facilities.",
        sortOrder: 60,
      },
      {
        label: "Other / needs follow-up",
        description:
          "Useful comments that are still too broad, mixed, or ambiguous for a tighter category assignment.",
        sortOrder: 70,
      },
    ],
    questions: [
      {
        questionType: "free_text",
        prompt: "What do you value most about living, working, or spending time in this community?",
        sortOrder: 10,
        config: { max_length: 2000 },
      },
      {
        questionType: "free_text",
        prompt: "What is the biggest challenge you think this community will face over the life of the plan?",
        sortOrder: 20,
        config: { max_length: 2000 },
      },
      {
        questionType: "ranking",
        prompt: "Rank these topics by how much attention you want the plan to give them.",
        helpText: "Drag to order them, with your highest priority first. You do not have to rank all of them.",
        sortOrder: 30,
        config: { require_full: false },
        options: [
          { label: "Housing choices and affordability", sortOrder: 10 },
          { label: "Safer streets for walking and biking", sortOrder: 20 },
          { label: "Better public transit", sortOrder: 30 },
          { label: "Parks, trails, and open space", sortOrder: 40 },
          { label: "Jobs and economic opportunity", sortOrder: 50 },
          { label: "Climate resilience and the environment", sortOrder: 60 },
        ],
      },
      {
        questionType: "rating",
        prompt: "How well do today's plans and investments reflect your priorities?",
        helpText: "1 means not at all, 5 means very well.",
        sortOrder: 40,
        config: { max: 5 },
      },
    ],
  },
  {
    id: "project-open-house",
    label: "Project open house",
    description:
      "Intake for an open house or public meeting on a specific project: categories for design comments, access, construction, and questions for the team, plus a short survey mirroring a comment card.",
    engagementType: "meeting_intake",
    suggestedSummary:
      "Records comments from the project open house and related outreach — comment cards, table notes, and follow-up submissions — in one moderated place, so the project team can categorize what was raised and carry it into design review and the project record.",
    suggestedPublicDescription:
      "Thank you for taking part in the open house for this project. Use this page to share your comments on the proposal — what works, what you would change, and any questions you want the project team to answer. Every comment is reviewed by the project team.",
    categories: [
      {
        label: "Design comments",
        description:
          "Reactions to the proposed design: layout, features, trade-offs, and alternatives.",
        sortOrder: 10,
      },
      {
        label: "Access and circulation",
        description:
          "How people would reach and move through the project area: driveways, walking and biking routes, transit, and parking.",
        sortOrder: 20,
      },
      {
        label: "Construction concerns",
        description:
          "Construction-period impacts: detours, noise, dust, duration, and business or residence access during work.",
        sortOrder: 30,
      },
      {
        label: "Support / positive signal",
        description:
          "Positive support, reinforcement of proposed changes, or appreciation without a separate primary issue.",
        sortOrder: 40,
      },
      {
        label: "Questions for the project team",
        description:
          "Direct questions that need an answer back, tracked so responses can be closed out.",
        sortOrder: 50,
      },
      {
        label: "Other / needs follow-up",
        description:
          "Useful comments that are still too broad, mixed, or ambiguous for a tighter category assignment.",
        sortOrder: 60,
      },
    ],
    questions: [
      {
        questionType: "single_choice",
        prompt: "Which best describes your connection to the project area?",
        sortOrder: 10,
        config: { allow_other: true },
        options: [
          { label: "I live nearby", sortOrder: 10 },
          { label: "I work or own a business nearby", sortOrder: 20 },
          { label: "I travel through the area", sortOrder: 30 },
          { label: "I visit the area for shopping, services, or recreation", sortOrder: 40 },
        ],
      },
      {
        questionType: "likert",
        prompt: "How well does the proposed design meet the needs you see in the project area?",
        helpText: "1 means not at all, 5 means very well.",
        sortOrder: 20,
        config: { scale: 5 },
      },
      {
        questionType: "free_text",
        prompt: "What would you change about the proposal before it moves forward?",
        sortOrder: 30,
        config: { max_length: 2000 },
      },
      {
        questionType: "free_text",
        prompt: "Is there anything else you want the project team to know?",
        sortOrder: 40,
        config: { max_length: 2000 },
      },
    ],
  },
];

export function getCampaignTemplate(id: string): CampaignTemplate | null {
  return CAMPAIGN_TEMPLATES.find((template) => template.id === id) ?? null;
}
