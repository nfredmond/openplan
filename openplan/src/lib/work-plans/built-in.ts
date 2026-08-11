/**
 * The work-plan templates shipped with the app.
 *
 * THIS FILE IS THE CONTENT SEAM, and it is separate from `template-registry.ts`
 * on purpose. Growing the template set — Nathaniel's decision of 2026-08-11 is
 * an exhaustive registry across transportation AND land-use planning — means
 * adding an artifact under `templates/` and one line here. The machinery, the
 * validation rules and the resolver never move.
 *
 * TWENTY-FOUR TEMPLATES SHIP TODAY: the generic starter, ten transportation
 * plans, three cross-cutting sequences (grant-funded delivery, environmental
 * review, and the one jurisdiction-labelled variant of it), and ten land-use
 * plans. Every one of them is a STANDARD-PRACTICE STARTING POINT and says so in
 * its own `scope_notes` — no artifact here states what any agency is required
 * to produce, names a funder, quotes a review period, or carries a figure.
 * `src/test/work-plan-template-content.test.ts` fails the build if one starts
 * to: it validates every file on disk against the registry's own validator,
 * bans money and state names outside a labelled jurisdiction, and asserts the
 * phase ordering a planner would notice was wrong.
 *
 * THE REGISTRY MUST LOAD EVERY FILE ON DISK. An artifact under `templates/`
 * that nobody imported here is the shipped-invisible defect class in its purest
 * form — complete, reviewed content no planner can reach — so the content test
 * reads the directory and compares it to what this list produces rather than
 * trusting that the two were kept in step.
 *
 * `generic_project_v0.1` lists NO plan types, so `findForProject` can never
 * return it. That is the registry's no-default rule made concrete: it is
 * reachable only by being chosen by name.
 *
 * NO TEMPLATE CLAIMS `PROJECT_DEFAULT_PLAN_TYPE`. Every project created without
 * a plan type being chosen gets `corridor_plan` from the database default, so a
 * template that claimed it would be suggested for projects whose type nobody
 * ever set — a default arriving through the back door, which is exactly what
 * rule 2 of the registry exists to prevent. The corridor study template claims
 * `corridor_study`, which is a value a planner has to type on purpose.
 */

import genericProjectTemplate from "@/lib/work-plans/templates/generic_project_v0.1.json";
// Transportation.
import corridorStudy from "@/lib/work-plans/templates/corridor_study_v0.1.json";
import roadwaySafetyActionPlan from "@/lib/work-plans/templates/roadway_safety_action_plan_v0.1.json";
import activeTransportationPlan from "@/lib/work-plans/templates/active_transportation_plan_v0.1.json";
import transitDevelopmentPlan from "@/lib/work-plans/templates/transit_development_plan_v0.1.json";
import longRangeTransportationPlan from "@/lib/work-plans/templates/long_range_transportation_plan_v0.1.json";
import transportationImprovementProgramCycle from "@/lib/work-plans/templates/transportation_improvement_program_cycle_v0.1.json";
import completeStreetsPlan from "@/lib/work-plans/templates/complete_streets_plan_v0.1.json";
import travelDemandManagementPlan from "@/lib/work-plans/templates/travel_demand_management_plan_v0.1.json";
import freightPlan from "@/lib/work-plans/templates/freight_plan_v0.1.json";
import feasibilityStudy from "@/lib/work-plans/templates/feasibility_study_v0.1.json";
// Cross-cutting.
import grantFundedProjectDelivery from "@/lib/work-plans/templates/grant_funded_project_delivery_v0.1.json";
import environmentalReview from "@/lib/work-plans/templates/environmental_review_v0.1.json";
import caEnvironmentalReview from "@/lib/work-plans/templates/ca_environmental_review_v0.1.json";
// Land use.
import comprehensivePlanUpdate from "@/lib/work-plans/templates/comprehensive_plan_update_v0.1.json";
import specificAreaPlan from "@/lib/work-plans/templates/specific_area_plan_v0.1.json";
import zoningCodeUpdate from "@/lib/work-plans/templates/zoning_code_update_v0.1.json";
import housingNeedsPlan from "@/lib/work-plans/templates/housing_needs_plan_v0.1.json";
import annexationStudy from "@/lib/work-plans/templates/annexation_study_v0.1.json";
import designGuidelines from "@/lib/work-plans/templates/design_guidelines_v0.1.json";
import downtownRevitalizationPlan from "@/lib/work-plans/templates/downtown_revitalization_plan_v0.1.json";
import parksAndOpenSpacePlan from "@/lib/work-plans/templates/parks_and_open_space_plan_v0.1.json";
import climateAndHazardElement from "@/lib/work-plans/templates/climate_and_hazard_element_v0.1.json";
import historicPreservationPlan from "@/lib/work-plans/templates/historic_preservation_plan_v0.1.json";

import {
  createWorkPlanTemplateRegistry,
  type WorkPlanTemplateRegistration,
} from "@/lib/work-plans/template-registry";

export const BUILT_IN_WORK_PLAN_TEMPLATE_REGISTRATIONS: readonly WorkPlanTemplateRegistration[] = [
  { artifact: genericProjectTemplate },
  // Transportation planning.
  { artifact: corridorStudy },
  { artifact: roadwaySafetyActionPlan },
  { artifact: activeTransportationPlan },
  { artifact: transitDevelopmentPlan },
  { artifact: longRangeTransportationPlan },
  { artifact: transportationImprovementProgramCycle },
  { artifact: completeStreetsPlan },
  { artifact: travelDemandManagementPlan },
  { artifact: freightPlan },
  { artifact: feasibilityStudy },
  // Work that belongs to no single practice area.
  { artifact: grantFundedProjectDelivery },
  { artifact: environmentalReview },
  { artifact: caEnvironmentalReview },
  // Land-use planning.
  { artifact: comprehensivePlanUpdate },
  { artifact: specificAreaPlan },
  { artifact: zoningCodeUpdate },
  { artifact: housingNeedsPlan },
  { artifact: annexationStudy },
  { artifact: designGuidelines },
  { artifact: downtownRevitalizationPlan },
  { artifact: parksAndOpenSpacePlan },
  { artifact: climateAndHazardElement },
  { artifact: historicPreservationPlan },
];

export const workPlanTemplateRegistry = createWorkPlanTemplateRegistry(
  BUILT_IN_WORK_PLAN_TEMPLATE_REGISTRATIONS
);
