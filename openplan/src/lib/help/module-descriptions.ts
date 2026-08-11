/**
 * One plain-language paragraph per registered module, keyed by the module's
 * nav-registry href.
 *
 * The Help page renders these under the registry's own labels and groups, so
 * the description can never disagree with the nav about what a module is
 * called. `help-page.test.tsx` asserts the keys here match `APP_NAV_ENTRIES`
 * exactly — a module added to the nav without a Help paragraph fails the
 * build, and a paragraph for a module that no longer exists does too.
 *
 * VOICE: written for planners, from assistant planner to principal. No
 * internal vocabulary, no table names, no environment variables.
 */
export const MODULE_DESCRIPTIONS: Record<string, string> = {
  "/dashboard":
    "Your workspace home. It shows what is configured, what is waiting on you across every module, your run history, and — for owners and admins — what this deployment is currently able to do.",
  "/my-work":
    "Everything with a date on it, in one queue: what is assigned to you, what nobody has picked up, which projects are held at a stage gate, and the grant, obligation and invoice deadlines the workspace is carrying.",
  "/projects":
    "One record per project, from scoping through delivery: milestones, decisions, risks, issues, meetings, funding, and the stage-gate board your delivery process follows.",
  "/reports":
    "Where analysis, comparisons, and narrative come together into documents you can hand to a board or a funder — with the sources and caveats attached to every claim.",
  "/assistant-activity":
    "A complete record of everything the built-in planning assistant has done in this workspace: what it proposed, who approved it, and what actually ran.",
  "/rtp":
    "Regional transportation plan cycles: project lists, horizon years, the financial picture, performance measures, public draft review, and the comment record.",
  "/plans":
    "The plan documents your agency maintains — chapters, sections, and the evidence behind them.",
  "/programs":
    "Programming cycles and funding windows: which projects are programmed, in which cycle, with what money.",
  "/grants":
    "Funding opportunities from discovery to award: pursue-or-pass decisions, applications, award records, and reimbursement follow-through.",
  "/invoicing":
    "The invoices your agency sends — reimbursement claims to funders and client invoices — with their status. OpenPlan itself never charges you; it is free.",
  "/models":
    "Travel-demand models for any place you choose, and the runs behind analysis evidence. Results are screening-grade: they support prioritization and narrative, not final engineering.",
  "/scenarios":
    "Scenario sets and baselines, and the saved comparisons between them that reports can draw on.",
  "/explore":
    "Corridor analysis: draw or pick a corridor anywhere in the United States and score it against the open data available for it, with a map, metrics, and report-ready output.",
  "/county-runs":
    "Where model results are checked against observed traffic counts, so a run's claims can be labeled by the evidence behind them.",
  "/safety":
    "Crash data pulls and safety screening for your area, with the coverage limits of each data source stated rather than hidden.",
  "/engagement":
    "Public engagement: publish a map or survey where residents comment, review every comment before it counts, and carry what you heard into projects and reports.",
  "/data-hub":
    "The datasets registered to this workspace — where each came from, how fresh it is, and the geometry attached to it.",
  "/aerial":
    "Aerial imagery missions: plan a flight area, track the mission, and keep the resulting imagery as evidence attached to your work.",
  "/knowledge-base":
    "The documents you upload — adopted plans, studies, policies — that grounded citations across OpenPlan are drawn from.",
  "/help":
    "This page: what OpenPlan is, what each module does, where the setup guides live, and who fixes what.",
};
