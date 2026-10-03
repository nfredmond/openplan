import { unreadableLanes, type PageTabDefinition } from "@/lib/ui/page-tabs";

type PlanTabKey = "overview" | "linked" | "edit";

/** Which of this plan's reads FAILED, in the page's own vocabulary. */
type PlanTabReadFlags = {
  overview: { readinessBasis: boolean; planLinks: boolean };
  linked: {
    projects: boolean;
    scenarios: boolean;
    campaigns: boolean;
    reports: boolean;
    supportingModels: boolean;
    supportingModelLinks: boolean;
    planLinks: boolean;
  };
};

/**
 * THE THREE TABS OF A PLAN: where it stands, the work linked to it, and the
 * editor. `unreadable` names every lane whose read failed, because the panel
 * that would disclose it may be behind a closed tab. Linked work used to be
 * marked only for scenarios, campaigns and reports.
 */
export function buildPlanTabs(flags: PlanTabReadFlags): PageTabDefinition<PlanTabKey>[] {
  return [
    {
      key: "overview",
      label: "Overview",
      unreadable: unreadableLanes([
        ["readiness checks", flags.overview.readinessBasis],
        ["the plan's own links", flags.overview.planLinks],
      ]),
    },
    {
      key: "linked",
      label: "Linked work",
      unreadable: unreadableLanes([
        ["projects", flags.linked.projects],
        ["scenarios", flags.linked.scenarios],
        ["engagement campaigns", flags.linked.campaigns],
        ["reports", flags.linked.reports],
        ["supporting models", flags.linked.supportingModels],
        ["supporting model link sets", flags.linked.supportingModelLinks],
        ["the plan's own links", flags.linked.planLinks],
      ]),
    },
    { key: "edit", label: "Edit plan" },
  ];
}
